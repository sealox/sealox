import { app, BrowserWindow } from 'electron'
import { spawn, type ChildProcess, execFileSync } from 'child_process'
import { randomBytes } from 'crypto'
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import type { AgentStatus, ChatActivity, ChatEvent } from '../../shared/types'
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

const EVE_BASIC_USER = 'helios'

function evePassword(): string {
  const file = join(app.getPath('userData'), 'eve-local-auth')
  try {
    const existing = readFileSync(file, 'utf8').trim()
    if (existing) return existing
  } catch {
    // 首次启动
  }
  const created = randomBytes(32).toString('base64url')
  mkdirSync(app.getPath('userData'), { recursive: true })
  writeFileSync(file, created, { mode: 0o600 })
  return created
}

function eveAuthHeaders(extra: Record<string, string> = {}): Record<string, string> {
  const token = Buffer.from(`${EVE_BASIC_USER}:${evePassword()}`, 'utf8').toString('base64')
  return { ...extra, Authorization: `Basic ${token}` }
}

function eveAppRoot(): string {
  if (app.isPackaged) {
    const src = join(process.resourcesPath, 'eve')
    const dest = join(app.getPath('userData'), 'eve-runtime')
    const srcStamp = join(src, '.output', 'nitro.json')
    const destStamp = join(dest, '.output', 'nitro.json')
    if (!existsSync(srcStamp)) throw new Error(`打包资源缺少 eve 产物：${srcStamp}`)
    const same =
      existsSync(destStamp) && readFileSync(destStamp, 'utf8') === readFileSync(srcStamp, 'utf8')
    if (!same) {
      rmSync(dest, { recursive: true, force: true })
      cpSync(src, dest, { recursive: true })
    }
    return dest
  }
  const candidates = [join(app.getAppPath(), '..', 'eve'), join(__dirname, '../../../eve')]
  for (const dir of candidates) {
    if (existsSync(join(dir, 'package.json'))) return dir
  }
  throw new Error(`找不到 eve 应用目录（试过 ${candidates.join(', ')}）`)
}

function nodeExecutable(): string {
  if (app.isPackaged) {
    const bundled = join(process.resourcesPath, 'node', 'bin', 'node')
    if (!existsSync(bundled)) throw new Error(`打包资源缺少 Node：${bundled}`)
    return bundled
  }
  const fromNpm = process.env.npm_node_execpath
  if (fromNpm && existsSync(fromNpm)) return fromNpm
  return 'node'
}

function eveSpawnArgs(root: string): { args: string[]; extraEnv: NodeJS.ProcessEnv } {
  const password = evePassword()
  const extraEnv: NodeJS.ProcessEnv = { HELIOS_EVE_PASSWORD: password }
  if (app.isPackaged) {
    extraEnv.HOST = EVE_HOST
    extraEnv.NITRO_HOST = EVE_HOST
    extraEnv.NITRO_PORT = String(EVE_PORT)
    extraEnv.PORT = String(EVE_PORT)
    return { args: [join(root, '.output', 'server', 'index.mjs')], extraEnv }
  }
  extraEnv.PORT = String(EVE_PORT)
  return {
    args: [join(root, 'node_modules/eve/bin/eve.js'), 'dev', '--no-ui', '--host', EVE_HOST, '--port', String(EVE_PORT)],
    extraEnv
  }
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
  const waiter = turnWaiter
  turnWaiter = null
  if (!waiter) return
  emitChat({ type: 'error', message })
  waiter.reject(new Error(message))
}

function settleTurn(): void {
  emitChat({ type: 'done' })
  turnWaiter?.resolve()
  turnWaiter = null
}

let lastAssistant = ''
let answerByStep = new Map<number, string>()
let reasoningByStep = new Map<number, string>()
const activities = new Map<string, ChatActivity>()

function resetTurnTrace(): void {
  lastAssistant = ''
  answerByStep = new Map()
  reasoningByStep = new Map()
  activities.clear()
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  return value as Record<string, unknown>
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function clip(text: string, max = 160): string {
  const one = text.replace(/\s+/g, ' ').trim()
  return one.length <= max ? one : `${one.slice(0, max - 1)}…`
}

function joinSteps(blocks: Map<number, string>): string {
  return [...blocks.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([, text]) => text)
    .filter(Boolean)
    .join('\n\n')
}

function emitAnswer(): void {
  lastAssistant = joinSteps(answerByStep)
  emitChat({ type: 'delta', text: lastAssistant })
}

function describeAction(action: Record<string, unknown>): Pick<ChatActivity, 'label' | 'detail'> {
  const kind = asString(action.kind)
  const input = asRecord(action.input)
  if (kind === 'load-skill') {
    return { label: '加载 skill', detail: asString(input?.skill) }
  }
  if (kind === 'subagent-call' || kind === 'remote-agent-call') {
    return {
      label: '子任务',
      detail: asString(action.subagentName) ?? asString(action.remoteAgentName) ?? asString(action.name)
    }
  }
  const tool = asString(action.toolName) ?? 'tool'
  if (tool === 'bash') return { label: 'bash', detail: asString(input?.command) }
  if (tool === 'read_file') return { label: '读文件', detail: asString(input?.path) }
  if (tool === 'write_file') return { label: '写文件', detail: asString(input?.path) }
  if (tool === 'glob') return { label: '找文件', detail: asString(input?.pattern) ?? asString(input?.glob) }
  if (tool === 'grep') return { label: '搜内容', detail: asString(input?.pattern) }
  if (tool === 'web_fetch') return { label: '抓取网页', detail: asString(input?.url) }
  if (tool === 'web_search') return { label: '搜索', detail: asString(input?.query) }
  if (tool === 'todo') return { label: '更新待办' }
  if (tool === 'ask_question') return { label: '提问' }
  return { label: tool, detail: input ? clip(JSON.stringify(input)) : undefined }
}

function emitActivity(item: ChatActivity): void {
  const detail = item.detail ? clip(item.detail) : undefined
  const next = { ...item, detail }
  activities.set(next.id, next)
  emitChat({ type: 'activity', item: next })
}

function handleActionsRequested(data: Record<string, unknown> | undefined): void {
  const list = data?.actions
  if (!Array.isArray(list)) return
  for (const raw of list) {
    const action = asRecord(raw)
    if (!action) continue
    const id = asString(action.callId)
    if (!id) continue
    emitActivity({ id, status: 'running', ...describeAction(action) })
  }
}

function handleActionResult(data: Record<string, unknown> | undefined): void {
  const result = asRecord(data?.result)
  const id = asString(result?.callId)
  if (!result || !id) return
  const prev = activities.get(id)
  const status = data?.status === 'failed' || data?.status === 'rejected' || result?.isError === true ? 'error' : 'done'
  const fromResult =
    asString(result?.kind) === 'load-skill-result'
      ? { label: '加载 skill', detail: asString(result?.name) }
      : describeAction(result)
  emitActivity({
    id,
    status,
    label: prev?.label ?? fromResult.label,
    detail: prev?.detail ?? fromResult.detail
  })
}

function inputRequestText(data: Record<string, unknown> | undefined): string {
  const requests = data?.requests
  if (!Array.isArray(requests)) return ''
  const lines: string[] = []
  for (const item of requests) {
    if (!item || typeof item !== 'object') continue
    const req = item as Record<string, unknown>
    if (typeof req.prompt === 'string' && req.prompt.trim()) {
      lines.push(req.prompt.trim())
      const options = req.options
      if (Array.isArray(options)) {
        for (const option of options) {
          if (!option || typeof option !== 'object') continue
          const opt = option as Record<string, unknown>
          const label = typeof opt.label === 'string' ? opt.label : typeof opt.id === 'string' ? opt.id : ''
          if (label) lines.push(`- ${label}`)
        }
      }
      continue
    }
    if (req.kind === 'tool-approval') {
      const tool = typeof req.toolName === 'string' ? req.toolName : 'tool'
      lines.push(`需要确认才能执行 ${tool}。回复 approve 或 cancel。`)
    }
  }
  return lines.join('\n')
}

function handleStreamEvent(event: { type?: string; data?: Record<string, unknown> }): void {
  switch (event.type) {
    case 'turn.started':
      resetTurnTrace()
      break
    case 'reasoning.appended': {
      const step = typeof event.data?.stepIndex === 'number' ? event.data.stepIndex : 0
      const soFar = event.data?.reasoningSoFar
      if (typeof soFar === 'string') {
        reasoningByStep.set(step, soFar)
        emitChat({ type: 'reasoning', text: joinSteps(reasoningByStep) })
      }
      break
    }
    case 'message.appended': {
      const step = typeof event.data?.stepIndex === 'number' ? event.data.stepIndex : 0
      const soFar = event.data?.messageSoFar
      if (typeof soFar === 'string') {
        answerByStep.set(step, soFar)
        emitAnswer()
      }
      break
    }
    case 'actions.requested':
      handleActionsRequested(event.data)
      break
    case 'action.result':
      handleActionResult(event.data)
      break
    case 'input.requested': {
      const question = inputRequestText(event.data)
      if (!question) break
      const text = lastAssistant ? `${lastAssistant}\n\n${question}` : question
      lastAssistant = text
      emitChat({ type: 'delta', text })
      break
    }
    case 'session.waiting':
    case 'session.completed':
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
      headers: eveAuthHeaders(),
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
    headers: eveAuthHeaders({ 'Content-Type': 'application/json' }),
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
    if (sessionId === id) sessionId = null
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
    turnWaiter = { resolve, reject }
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
    const { args, extraEnv } = eveSpawnArgs(root)
    killPortListeners(EVE_PORT)
    await sleep(200)

    const proc = spawn(nodeExecutable(), args, {
      cwd: root,
      env: {
        ...process.env,
        HELIOS_AI_BASE_URL: cred.endpoint,
        HELIOS_AI_KEY: cred.apiKey,
        HELIOS_AI_MODEL: cred.model,
        ...extraEnv
      },
      stdio: ['ignore', 'pipe', 'pipe']
    })
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
      const detail = `eve 退出（code=${code ?? 'null'} signal=${signalName ?? 'none'}）`
      if (turnWaiter) failTurn(detail)
      if (status.state === 'starting' || status.state === 'ready') {
        setStatus({ state: 'error', detail })
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
  resetTurnTrace()
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
