import { app, BrowserWindow } from 'electron'
import { spawn, type ChildProcess, execFileSync } from 'child_process'
import { existsSync } from 'fs'
import { join } from 'path'
import type { AgentStatus, ChatEvent } from '../../shared/types'
import { getStatus } from '../sealos/auth'
import { ensureHeliosKey } from '../sealos/aiproxy'

const EVE_HOST = '127.0.0.1'
const EVE_PORT = 24721
const EVE_ORIGIN = `http://${EVE_HOST}:${EVE_PORT}`
const HEALTH_TIMEOUT_MS = 90_000
const STOP_TIMEOUT_MS = 4_000

let child: ChildProcess | null = null
let status: AgentStatus = { state: 'stopped' }
let startEpoch = 0
let sessionId: string | null = null
let streamAbort: AbortController | null = null
let turnBusy = false
let turnWaiter: {
  resolve: () => void
  reject: (err: Error) => void
} | null = null

function broadcast(channel: string, payload: unknown): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send(channel, payload)
  }
}

function setStatus(next: AgentStatus): void {
  status = next
  broadcast('helios:agent-status', next)
}

export function getAgentStatus(): AgentStatus {
  return status
}

function eveAppRoot(): string {
  const candidates = [join(app.getAppPath(), '..', 'eve'), join(__dirname, '../../../eve')]
  for (const dir of candidates) {
    if (existsSync(join(dir, 'package.json'))) return dir
  }
  throw new Error(`找不到 eve 应用目录（试过 ${candidates.join(', ')}）`)
}

function nodeExecutable(): string {
  const fromNpm = process.env.npm_node_execpath
  if (fromNpm && existsSync(fromNpm)) return fromNpm
  return 'node'
}

function killPortListeners(port: number): void {
  try {
    const out = execFileSync('lsof', ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN', '-t'], {
      encoding: 'utf8'
    })
    for (const pidText of out.split('\n')) {
      const pid = Number(pidText.trim())
      if (!Number.isInteger(pid) || pid <= 0 || pid === process.pid) continue
      try {
        process.kill(pid, 'SIGTERM')
      } catch {
        // 进程已经退出
      }
    }
  } catch {
    // 没有占用该端口
  }
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms)
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(timer)
        reject(signal.reason instanceof Error ? signal.reason : new Error('aborted'))
      },
      { once: true }
    )
  })
}

async function waitForHealth(signal: AbortSignal): Promise<void> {
  const deadline = Date.now() + HEALTH_TIMEOUT_MS
  let lastError = '未开始探测'
  while (Date.now() < deadline) {
    if (signal.aborted) throw new Error('启动已取消')
    try {
      const resp = await fetch(`${EVE_ORIGIN}/eve/v1/health`, {
        signal: AbortSignal.any([signal, AbortSignal.timeout(2_000)])
      })
      if (resp.ok) return
      lastError = `HTTP ${resp.status}`
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err)
    }
    await sleep(400, signal)
  }
  throw new Error(`eve 启动超时：${lastError}`)
}

function emitChat(event: ChatEvent): void {
  broadcast('helios:chat-event', event)
}

function failTurn(message: string): void {
  emitChat({ type: 'error', message })
  turnWaiter?.reject(new Error(message))
  turnWaiter = null
}

function settleTurn(): void {
  emitChat({ type: 'done' })
  turnWaiter?.resolve()
  turnWaiter = null
}

function handleStreamEvent(event: { type?: string; data?: Record<string, unknown> }): void {
  switch (event.type) {
    case 'message.appended': {
      const soFar = event.data?.messageSoFar
      if (typeof soFar === 'string') emitChat({ type: 'delta', text: soFar })
      break
    }
    case 'session.waiting':
      settleTurn()
      break
    case 'turn.failed':
    case 'session.failed': {
      const message =
        (typeof event.data?.message === 'string' && event.data.message) ||
        (typeof event.data?.error === 'string' && event.data.error) ||
        '模型调用失败'
      failTurn(message)
      break
    }
    default:
      break
  }
}

async function followSession(id: string, signal: AbortSignal): Promise<void> {
  let startIndex = 0
  while (!signal.aborted) {
    const resp = await fetch(`${EVE_ORIGIN}/eve/v1/session/${id}/stream?startIndex=${startIndex}`, {
      signal
    })
    if (!resp.ok || !resp.body) {
      throw new Error(`eve 事件流失败（HTTP ${resp.status}）`)
    }
    const reader = resp.body.getReader()
    const decoder = new TextDecoder()
    let buf = ''
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      buf += decoder.decode(value, { stream: true })
      const lines = buf.split('\n')
      buf = lines.pop() ?? ''
      for (const line of lines) {
        if (!line.trim()) continue
        startIndex += 1
        try {
          handleStreamEvent(JSON.parse(line) as { type?: string; data?: Record<string, unknown> })
        } catch {
          // 忽略半包或非 JSON 行
        }
      }
    }
    await sleep(250, signal)
  }
}

async function postSession(path: string, message: string): Promise<{ sessionId: string }> {
  const resp = await fetch(`${EVE_ORIGIN}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message }),
    signal: AbortSignal.timeout(30_000)
  })
  const body = (await resp.json().catch(() => null)) as {
    ok?: boolean
    sessionId?: string
    error?: string
    code?: string
  } | null
  if (!resp.ok || !body?.sessionId) {
    throw new Error(body?.error || `eve 会话请求失败（HTTP ${resp.status}）`)
  }
  return { sessionId: body.sessionId }
}

function openStream(id: string): void {
  streamAbort?.abort()
  streamAbort = new AbortController()
  const signal = streamAbort.signal
  void followSession(id, signal).catch((err: unknown) => {
    if (signal.aborted) return
    failTurn(err instanceof Error ? err.message : String(err))
  })
}

export async function sendHomeMessage(text: string): Promise<void> {
  const trimmed = text.trim()
  if (!trimmed) throw new Error('消息不能为空')
  if (status.state !== 'ready') {
    throw new Error(status.detail || 'AI 服务还没准备好')
  }
  if (turnBusy) throw new Error('上一轮还在回复')
  turnBusy = true
  const settled = waitForTurnSettle()
  try {
    try {
      if (!sessionId) {
        const created = await postSession('/eve/v1/session', trimmed)
        sessionId = created.sessionId
        openStream(sessionId)
      } else {
        try {
          await postSession(`/eve/v1/session/${sessionId}`, trimmed)
        } catch {
          const created = await postSession('/eve/v1/session', trimmed)
          sessionId = created.sessionId
          openStream(sessionId)
        }
      }
    } catch (err) {
      failTurn(err instanceof Error ? err.message : String(err))
    }
    await settled
  } finally {
    turnBusy = false
  }
}

function waitForTurnSettle(): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      turnWaiter = null
      reject(new Error('等待模型回复超时'))
    }, 120_000)
    turnWaiter = {
      resolve: () => {
        clearTimeout(timer)
        resolve()
      },
      reject: (err) => {
        clearTimeout(timer)
        reject(err)
      }
    }
  })
}

async function killChild(proc: ChildProcess): Promise<void> {
  if (proc.killed || proc.exitCode !== null) return
  await new Promise<void>((resolve) => {
    const timer = setTimeout(() => {
      if (proc.exitCode === null) proc.kill('SIGKILL')
    }, STOP_TIMEOUT_MS)
    proc.once('exit', () => {
      clearTimeout(timer)
      resolve()
    })
    proc.kill('SIGTERM')
  })
}

export async function stopAgent(): Promise<void> {
  startEpoch += 1
  await stopAgentQuiet()
  setStatus({ state: 'stopped' })
}

export async function startAgent(): Promise<void> {
  if (!getStatus().authenticated) {
    await stopAgent()
    return
  }
  const epoch = ++startEpoch
  await stopAgentQuiet()
  if (epoch !== startEpoch) return

  setStatus({ state: 'starting', detail: '正在准备 AI 服务…' })
  try {
    const cred = await ensureHeliosKey()
    if (epoch !== startEpoch) return
    setStatus({ state: 'starting', detail: `正在启动 AI 服务（${cred.model}）…` })

    const root = eveAppRoot()
    const bin = join(root, 'node_modules/eve/bin/eve.js')
    if (!existsSync(bin)) throw new Error(`找不到 eve CLI：${bin}`)

    killPortListeners(EVE_PORT)
    await sleep(200)

    const proc = spawn(
      nodeExecutable(),
      [bin, 'dev', '--no-ui', '--host', EVE_HOST, '--port', String(EVE_PORT)],
      {
        cwd: root,
        env: {
          ...process.env,
          HELIOS_AI_BASE_URL: cred.endpoint,
          HELIOS_AI_KEY: cred.apiKey,
          HELIOS_AI_MODEL: cred.model,
          PORT: String(EVE_PORT)
        },
        stdio: ['ignore', 'pipe', 'pipe']
      }
    )
    child = proc
    proc.stdout?.on('data', (buf: Buffer) => {
      const line = buf.toString().trim()
      if (line) console.log('[eve]', line)
    })
    proc.stderr?.on('data', (buf: Buffer) => {
      const line = buf.toString().trim()
      if (line) console.error('[eve]', line)
    })
    proc.on('exit', (code, signalName) => {
      if (child !== proc) return
      child = null
      sessionId = null
      streamAbort?.abort()
      streamAbort = null
      if (status.state === 'starting' || status.state === 'ready') {
        setStatus({
          state: 'error',
          detail: `eve 退出（code=${code ?? 'null'} signal=${signalName ?? 'none'}）`
        })
      }
    })

    const abort = new AbortController()
    const cancel = (): void => abort.abort()
    const watcher = setInterval(() => {
      if (epoch !== startEpoch || child !== proc) cancel()
    }, 200)
    try {
      await waitForHealth(abort.signal)
    } finally {
      clearInterval(watcher)
    }
    if (epoch !== startEpoch || child !== proc) return
    setStatus({ state: 'ready' })
  } catch (err) {
    if (epoch !== startEpoch) return
    const detail = err instanceof Error ? err.message : String(err)
    setStatus({ state: 'error', detail })
  }
}

async function stopAgentQuiet(): Promise<void> {
  if (turnWaiter) {
    turnWaiter.reject(new Error('AI 服务已停止'))
    turnWaiter = null
  }
  streamAbort?.abort()
  streamAbort = null
  sessionId = null
  turnBusy = false
  const proc = child
  child = null
  if (proc) await killChild(proc)
}

export async function restartAgent(): Promise<void> {
  await startAgent()
}
