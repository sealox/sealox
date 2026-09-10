import { spawn, type ChildProcess } from 'child_process'
import { createInterface, type Interface } from 'readline'
import { desktopHost } from '../desktop-host'
import { codexEnvironment } from './codex-environment'
import { ProcessOutputTail, redactProcessOutput } from './process-output'

export type CodexRequestId = number | string

export interface CodexProtocolMessage {
  id?: CodexRequestId
  method?: string
  params?: Record<string, unknown>
  result?: unknown
  error?: { code?: number; message?: string; data?: unknown }
}

export interface CodexThreadListener {
  onMessage(message: CodexProtocolMessage): void
  onExit(error: Error): void
}

interface PendingRequest {
  resolve(value: unknown): void
  reject(error: Error): void
  timer: NodeJS.Timeout
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  return value as Record<string, unknown>
}

function protocolError(value: unknown): Error {
  const error = asRecord(value)
  const message =
    typeof error?.message === 'string' && error.message.trim()
      ? error.message.trim()
      : 'Codex app-server 请求失败'
  return new Error(message)
}

function messageThreadId(message: CodexProtocolMessage): string | null {
  const direct = message.params?.threadId
  if (typeof direct === 'string' && direct) return direct
  const thread = asRecord(message.params?.thread)
  return typeof thread?.id === 'string' && thread.id ? thread.id : null
}

export class CodexAppServerClient {
  private process: ChildProcess | null = null
  private lines: Interface | null = null
  private command = 'codex'
  private nextId = 1
  private ready: Promise<void> | null = null
  private stopping = false
  private stderrTail = new ProcessOutputTail(12, 12_000)
  private readonly pending = new Map<string, PendingRequest>()
  private readonly listeners = new Map<string, Set<CodexThreadListener>>()

  async request<T = unknown>(
    command: string,
    method: string,
    params: Record<string, unknown>,
    timeoutMs = 30_000
  ): Promise<T> {
    await this.ensureStarted(command)
    return this.requestRaw<T>(method, params, timeoutMs)
  }

  notify(method: string, params?: Record<string, unknown>): void {
    this.write(params ? { method, params } : { method })
  }

  respond(id: CodexRequestId, result: unknown): void {
    this.write({ id, result })
  }

  respondError(id: CodexRequestId, message: string, code = -32601): void {
    this.write({ id, error: { code, message } })
  }

  subscribe(threadId: string, listener: CodexThreadListener): () => void {
    const entries = this.listeners.get(threadId) ?? new Set<CodexThreadListener>()
    entries.add(listener)
    this.listeners.set(threadId, entries)
    return () => {
      entries.delete(listener)
      if (entries.size === 0) this.listeners.delete(threadId)
    }
  }

  async stop(): Promise<void> {
    this.stopping = true
    this.ready = null
    this.lines?.close()
    this.lines = null
    const proc = this.process
    this.process = null
    if (!proc || proc.exitCode !== null || proc.killed) {
      this.rejectPending(new Error('Codex app-server 已停止'))
      return
    }
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        if (proc.exitCode === null) proc.kill('SIGKILL')
      }, 2_000)
      proc.once('exit', () => {
        clearTimeout(timer)
        resolve()
      })
      proc.kill('SIGTERM')
    })
    this.rejectPending(new Error('Codex app-server 已停止'))
  }

  private async ensureStarted(command: string): Promise<void> {
    if (this.process && this.process.exitCode === null && this.ready) return this.ready
    if (this.ready) return this.ready
    this.command = command
    this.ready = this.start().catch((error: unknown) => {
      this.ready = null
      throw error
    })
    return this.ready
  }

  private async start(): Promise<void> {
    this.stopping = false
    this.stderrTail = new ProcessOutputTail(12, 12_000)
    const cwd = desktopHost().appRoot
    const proc = spawn(this.command, ['app-server'], {
      cwd,
      env: await codexEnvironment(),
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true
    })
    this.process = proc
    this.lines = createInterface({ input: proc.stdout!, crlfDelay: Infinity })
    this.lines.on('line', (line) => this.handleLine(line))
    proc.stderr?.on('data', (chunk: Buffer) => {
      this.stderrTail.push(chunk.toString())
      const line = redactProcessOutput(chunk.toString().trim())
      if (line) console.error('[codex app-server]', line)
    })
    proc.once('error', (error) => this.handleExit(proc, error))
    proc.once('close', (code, signal) => {
      const detail = this.stderrTail.summary()
      const suffix = detail ? `：${detail}` : ''
      this.handleExit(
        proc,
        new Error(
          `Codex app-server 退出（code=${code ?? 'none'} signal=${signal ?? 'none'}）${suffix}`
        )
      )
    })

    await this.requestRaw(
      'initialize',
      {
        clientInfo: {
          name: 'helios',
          title: 'Helios',
          version: desktopHost().appVersion
        },
        capabilities: {
          experimentalApi: true,
          requestAttestation: false
        }
      },
      20_000
    )
    this.notify('initialized')
  }

  private requestRaw<T>(
    method: string,
    params: Record<string, unknown>,
    timeoutMs: number
  ): Promise<T> {
    const id = this.nextId++
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(String(id))
        reject(new Error(`Codex app-server 请求超时：${method}`))
      }, timeoutMs)
      timer.unref?.()
      this.pending.set(String(id), {
        resolve: (value) => resolve(value as T),
        reject,
        timer
      })
      try {
        this.write({ method, id, params })
      } catch (error) {
        clearTimeout(timer)
        this.pending.delete(String(id))
        reject(error)
      }
    })
  }

  private write(message: CodexProtocolMessage): void {
    const stdin = this.process?.stdin
    if (!stdin || stdin.destroyed || !stdin.writable) throw new Error('Codex app-server 未连接')
    stdin.write(`${JSON.stringify(message)}\n`)
  }

  private handleLine(line: string): void {
    let message: CodexProtocolMessage
    try {
      message = JSON.parse(line) as CodexProtocolMessage
    } catch {
      return
    }

    if (message.id !== undefined && !message.method) {
      const request = this.pending.get(String(message.id))
      if (!request) return
      clearTimeout(request.timer)
      this.pending.delete(String(message.id))
      if (message.error) request.reject(protocolError(message.error))
      else request.resolve(message.result)
      return
    }

    const threadId = messageThreadId(message)
    if (!threadId) {
      if (message.id !== undefined && message.method) {
        this.respondError(message.id, `Helios 不支持 Codex 请求：${message.method}`)
      }
      return
    }
    const entries = this.listeners.get(threadId)
    if (!entries?.size) {
      if (message.id !== undefined && message.method) {
        this.respondError(message.id, '对应的 Helios 对话已关闭', -32000)
      }
      return
    }
    for (const listener of entries) listener.onMessage(message)
  }

  private handleExit(proc: ChildProcess, error: Error): void {
    if (this.process !== proc) return
    this.process = null
    this.ready = null
    this.lines?.close()
    this.lines = null
    this.rejectPending(error)
    if (!this.stopping) {
      for (const entries of this.listeners.values()) {
        for (const listener of entries) listener.onExit(error)
      }
    }
  }

  private rejectPending(error: Error): void {
    for (const request of this.pending.values()) {
      clearTimeout(request.timer)
      request.reject(error)
    }
    this.pending.clear()
  }
}

const client = new CodexAppServerClient()

export function requestCodex<T = unknown>(
  command: string,
  method: string,
  params: Record<string, unknown>,
  timeoutMs?: number
): Promise<T> {
  return client.request<T>(command, method, params, timeoutMs)
}

export function subscribeCodexThread(threadId: string, listener: CodexThreadListener): () => void {
  return client.subscribe(threadId, listener)
}

export function respondCodexRequest(id: CodexRequestId, result: unknown): void {
  client.respond(id, result)
}

export function rejectCodexRequest(id: CodexRequestId, message: string): void {
  client.respondError(id, message)
}

export function stopCodexAppServer(): Promise<void> {
  return client.stop()
}
