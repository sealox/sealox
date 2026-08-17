import { app, BrowserWindow } from 'electron'
import { spawn, type ChildProcess, execFileSync } from 'child_process'
import { randomBytes, randomUUID } from 'crypto'
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import type {
  AgentStatus,
  ChatActivity,
  ChatAttachment,
  ChatConversation,
  ChatEvent,
  ChatInputResponse,
  ChatListItem,
  ChatMessage,
  ChatQuestion,
  ChatTraceItem
} from '../../shared/types'
import { readDeepseekCredential } from '../model-settings'
import { getStatus } from '../sealos/auth'
import { ensureHeliosKey } from '../sealos/aiproxy'
import {
  currentWorkspaceId,
  deleteConversation,
  isConversationId,
  listConversations,
  readConversation,
  titleFromMessage,
  writeConversation
} from './chat-store'
import { readChatFiles } from './chat-files'

const EVE_HOST = '127.0.0.1'
const EVE_PORT = 24721
const EVE_ORIGIN = `http://${EVE_HOST}:${EVE_PORT}`
const HEALTH_TIMEOUT_MS = 90_000
const STOP_TIMEOUT_MS = 4_000

let child: ChildProcess | null = null
let status: AgentStatus = { state: 'stopped' }
let startEpoch = 0

interface LiveSession {
  conversationId: string
  workspaceId: string
  eveSessionId: string | null
  streamIndex: number
  streamAbort: AbortController | null
  turnBusy: boolean
  turnWaiter: {
    resolve: () => void
    reject: (err: Error) => void
  } | null
  lastAssistant: string
  answerByStep: Map<number, string>
  activities: Map<string, ChatActivity>
  record: ChatConversation
}

const live = new Map<string, LiveSession>()

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
    args: [
      join(root, 'node_modules/eve/bin/eve.js'),
      'dev',
      '--no-ui',
      '--host',
      EVE_HOST,
      '--port',
      String(EVE_PORT)
    ],
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

function cloneRecord(record: ChatConversation): ChatConversation {
  return JSON.parse(JSON.stringify(record)) as ChatConversation
}

function emitChat(event: ChatEvent): void {
  broadcast('helios:chat-event', event)
}

function emitSnapshot(session: LiveSession): void {
  emitChat({ type: 'snapshot', conversation: cloneRecord(session.record) })
}

async function emitIndex(workspaceId: string): Promise<void> {
  const items = await listConversations(workspaceId)
  emitChat({ type: 'index', workspaceId, items })
}

async function persist(session: LiveSession): Promise<void> {
  if (live.get(session.conversationId) !== session) return
  session.record.updatedAt = new Date().toISOString()
  session.record.streamIndex = session.streamIndex
  session.record.eveSessionId = session.eveSessionId
  await writeConversation(session.record)
  await emitIndex(session.workspaceId)
}

function lastAssistantMessage(session: LiveSession): ChatMessage | undefined {
  for (let i = session.record.messages.length - 1; i >= 0; i -= 1) {
    if (session.record.messages[i].role === 'assistant') return session.record.messages[i]
  }
  return undefined
}

function resetTurnTrace(session: LiveSession): void {
  session.lastAssistant = ''
  session.answerByStep = new Map()
  session.activities.clear()
}

function settleTurn(session: LiveSession, err?: Error): void {
  const waiter = session.turnWaiter
  session.turnWaiter = null
  session.turnBusy = false
  if (!waiter) return
  if (err) waiter.reject(err)
  else waiter.resolve()
}

function failTurn(session: LiveSession, message: string): void {
  const last = lastAssistantMessage(session)
  if (last) {
    last.pending = false
    last.error = message
  }
  session.record.questions = undefined
  emitChat({ type: 'error', conversationId: session.conversationId, message })
  emitSnapshot(session)
  void persist(session)
  settleTurn(session, new Error(message))
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

function describeAction(action: Record<string, unknown>): Pick<ChatActivity, 'label' | 'detail'> {
  const kind = asString(action.kind)
  const input = asRecord(action.input)
  if (kind === 'load-skill') {
    return { label: '加载 skill', detail: asString(input?.skill) }
  }
  if (kind === 'subagent-call' || kind === 'remote-agent-call') {
    return {
      label: '子任务',
      detail:
        asString(action.subagentName) ?? asString(action.remoteAgentName) ?? asString(action.name)
    }
  }
  const tool = asString(action.toolName) ?? 'tool'
  if (tool === 'bash') return { label: 'bash', detail: asString(input?.command) }
  if (tool === 'read_file') return { label: '读文件', detail: asString(input?.path) }
  if (tool === 'write_file') return { label: '写文件', detail: asString(input?.path) }
  if (tool === 'glob')
    return { label: '找文件', detail: asString(input?.pattern) ?? asString(input?.glob) }
  if (tool === 'grep') return { label: '搜内容', detail: asString(input?.pattern) }
  if (tool === 'web_fetch') return { label: '抓取网页', detail: asString(input?.url) }
  if (tool === 'web_search') return { label: '搜索', detail: asString(input?.query) }
  if (tool === 'todo') return { label: '更新待办' }
  if (tool === 'ask_question') return { label: '提问' }
  return { label: tool, detail: input ? clip(JSON.stringify(input)) : undefined }
}

function assistantTrace(session: LiveSession): ChatTraceItem[] {
  const last = lastAssistantMessage(session)
  if (!last) return []
  if (!last.trace) last.trace = []
  return last.trace
}

function emitTrace(session: LiveSession): void {
  const last = lastAssistantMessage(session)
  if (!last?.trace) return
  emitChat({
    type: 'trace',
    conversationId: session.conversationId,
    items: last.trace.map((item) => ({ ...item }))
  })
}

function upsertThinking(session: LiveSession, stepIndex: number, text: string): void {
  const last = lastAssistantMessage(session)
  if (!last) return
  const trace = assistantTrace(session)
  const existing = trace.findIndex(
    (item) => item.type === 'thinking' && item.stepIndex === stepIndex
  )
  if (existing >= 0) {
    trace[existing] = { type: 'thinking', stepIndex, text }
  } else {
    trace.push({ type: 'thinking', stepIndex, text })
  }
  last.reasoning = undefined
  emitTrace(session)
}

function emitActivity(session: LiveSession, item: ChatActivity): void {
  const detail = item.detail ? clip(item.detail) : undefined
  const next = { ...item, detail }
  session.activities.set(next.id, next)
  const last = lastAssistantMessage(session)
  if (!last) return
  const trace = assistantTrace(session)
  const existing = trace.findIndex((row) => row.type === 'activity' && row.id === next.id)
  const block: ChatTraceItem = { type: 'activity', ...next }
  if (existing >= 0) trace[existing] = block
  else trace.push(block)
  last.activities = undefined
  emitTrace(session)
}

function handleActionsRequested(
  session: LiveSession,
  data: Record<string, unknown> | undefined
): void {
  const list = data?.actions
  if (!Array.isArray(list)) return
  for (const raw of list) {
    const action = asRecord(raw)
    if (!action) continue
    const id = asString(action.callId)
    if (!id) continue
    emitActivity(session, { id, status: 'running', ...describeAction(action) })
  }
}

function handleActionResult(session: LiveSession, data: Record<string, unknown> | undefined): void {
  const result = asRecord(data?.result)
  const id = asString(result?.callId)
  if (!result || !id) return
  const prev = session.activities.get(id)
  const status =
    data?.status === 'failed' || data?.status === 'rejected' || result?.isError === true
      ? 'error'
      : 'done'
  const fromResult =
    asString(result?.kind) === 'load-skill-result'
      ? { label: '加载 skill', detail: asString(result?.name) }
      : describeAction(result)
  emitActivity(session, {
    id,
    status,
    label: prev?.label ?? fromResult.label,
    detail: prev?.detail ?? fromResult.detail
  })
}

function parseQuestions(data: Record<string, unknown> | undefined): ChatQuestion[] {
  const requests = data?.requests
  if (!Array.isArray(requests)) return []
  const questions: ChatQuestion[] = []
  for (const item of requests) {
    const req = asRecord(item)
    if (!req) continue
    const requestId = asString(req.requestId)
    if (!requestId) continue
    const kind = asString(req.kind) ?? 'question'
    const prompt =
      asString(req.prompt) ??
      (kind === 'tool-approval'
        ? `需要确认才能执行 ${asString(req.toolName) ?? 'tool'}`
        : '需要你的回复')
    const options: ChatQuestion['options'] = []
    if (Array.isArray(req.options)) {
      for (const raw of req.options) {
        const opt = asRecord(raw)
        if (!opt) continue
        const id = asString(opt.id)
        if (!id) continue
        options.push({ id, label: asString(opt.label) ?? id })
      }
    }
    if (options.length === 0 && kind === 'tool-approval') {
      options.push({ id: 'approve', label: '允许' }, { id: 'cancel', label: '拒绝' })
    }
    questions.push({
      requestId,
      kind,
      prompt,
      options: options.length > 0 ? options : undefined,
      allowFreeform: req.allowFreeform === true,
      toolName: asString(req.toolName)
    })
  }
  return questions
}

function handleStreamEvent(
  session: LiveSession,
  event: { type?: string; data?: Record<string, unknown> }
): void {
  switch (event.type) {
    case 'turn.started':
      resetTurnTrace(session)
      break
    case 'reasoning.appended': {
      const step = typeof event.data?.stepIndex === 'number' ? event.data.stepIndex : 0
      const soFar = event.data?.reasoningSoFar
      if (typeof soFar === 'string' && soFar.trim()) {
        upsertThinking(session, step, soFar)
      }
      break
    }
    case 'message.appended': {
      const step = typeof event.data?.stepIndex === 'number' ? event.data.stepIndex : 0
      const soFar = event.data?.messageSoFar
      if (typeof soFar === 'string') {
        session.answerByStep.set(step, soFar)
        session.lastAssistant = joinSteps(session.answerByStep)
        const last = lastAssistantMessage(session)
        if (last) {
          last.text = session.lastAssistant
          last.error = undefined
        }
        emitChat({
          type: 'delta',
          conversationId: session.conversationId,
          text: session.lastAssistant
        })
      }
      break
    }
    case 'actions.requested':
      handleActionsRequested(session, event.data)
      break
    case 'action.result':
      handleActionResult(session, event.data)
      break
    case 'input.requested': {
      const questions = parseQuestions(event.data)
      if (questions.length === 0) break
      session.record.questions = questions
      emitChat({ type: 'question', conversationId: session.conversationId, questions })
      break
    }
    case 'turn.cancelled': {
      const last = lastAssistantMessage(session)
      if (last) last.pending = false
      session.record.questions = undefined
      emitChat({ type: 'cancelled', conversationId: session.conversationId })
      emitSnapshot(session)
      void persist(session)
      settleTurn(session)
      break
    }
    case 'session.waiting':
    case 'session.completed': {
      if (!session.turnWaiter) break
      const last = lastAssistantMessage(session)
      if (last) last.pending = false
      if (session.record.questions?.length) {
        emitChat({ type: 'waiting', conversationId: session.conversationId })
      } else {
        emitChat({ type: 'done', conversationId: session.conversationId })
      }
      emitSnapshot(session)
      void persist(session)
      settleTurn(session)
      break
    }
    case 'turn.failed':
    case 'session.failed': {
      const message =
        (typeof event.data?.message === 'string' && event.data.message) ||
        (typeof event.data?.error === 'string' && event.data.error) ||
        '模型调用失败'
      failTurn(session, message)
      break
    }
    default:
      break
  }
}

async function followSession(session: LiveSession, signal: AbortSignal): Promise<void> {
  while (!signal.aborted) {
    const id = session.eveSessionId
    if (!id) return
    const resp = await fetch(
      `${EVE_ORIGIN}/eve/v1/session/${id}/stream?startIndex=${session.streamIndex}`,
      {
        headers: eveAuthHeaders(),
        signal
      }
    )
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
        session.streamIndex += 1
        try {
          handleStreamEvent(
            session,
            JSON.parse(line) as { type?: string; data?: Record<string, unknown> }
          )
        } catch {
          // 忽略半包或非 JSON 行
        }
      }
    }
    await sleep(250, signal)
  }
}

function openStream(session: LiveSession): void {
  if (session.streamAbort || !session.eveSessionId) return
  session.streamAbort = new AbortController()
  const signal = session.streamAbort.signal
  const conversationId = session.conversationId
  void followSession(session, signal).catch((err: unknown) => {
    if (signal.aborted) return
    const current = live.get(conversationId)
    if (current !== session) return
    session.streamAbort = null
    session.eveSessionId = null
    failTurn(session, err instanceof Error ? err.message : String(err))
  })
}

function closeStream(session: LiveSession): void {
  session.streamAbort?.abort()
  session.streamAbort = null
}

class EveHttpError extends Error {
  constructor(
    message: string,
    readonly httpStatus: number,
    readonly code?: string
  ) {
    super(message)
  }
}

function isSessionGone(err: unknown): boolean {
  return (
    err instanceof EveHttpError && (err.httpStatus === 409 || err.code === 'session_not_active')
  )
}

type EveFilePart = {
  type: 'file'
  data: string
  mediaType: string
  filename: string
}

type EveTextPart = { type: 'text'; text: string }

type EveMessage = string | Array<EveTextPart | EveFilePart>

type SessionPostBody = { message: EveMessage } | { inputResponses: ChatInputResponse[] }

async function postSession(
  path: string,
  body: SessionPostBody,
  timeoutMs = 30_000
): Promise<{ sessionId: string }> {
  const resp = await fetch(`${EVE_ORIGIN}${path}`, {
    method: 'POST',
    headers: eveAuthHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs)
  })
  const parsed = (await resp.json().catch(() => null)) as {
    ok?: boolean
    sessionId?: string
    error?: string
    code?: string
  } | null
  if (!resp.ok || !parsed?.sessionId) {
    throw new EveHttpError(
      parsed?.error || `eve 会话请求失败（HTTP ${resp.status}）`,
      resp.status,
      parsed?.code
    )
  }
  return { sessionId: parsed.sessionId }
}

async function postCancel(sessionId: string): Promise<void> {
  const resp = await fetch(`${EVE_ORIGIN}/eve/v1/session/${sessionId}/cancel`, {
    method: 'POST',
    headers: eveAuthHeaders({ 'Content-Type': 'application/json' }),
    body: '{}',
    signal: AbortSignal.timeout(15_000)
  })
  if (!resp.ok && resp.status !== 200 && resp.status !== 202) {
    const parsed = (await resp.json().catch(() => null)) as { error?: string } | null
    throw new Error(parsed?.error || `停止失败（HTTP ${resp.status}）`)
  }
}

async function postReset(sessionId: string): Promise<void> {
  await fetch(`${EVE_ORIGIN}/eve/v1/session/${sessionId}/reset`, {
    method: 'POST',
    headers: eveAuthHeaders({ 'Content-Type': 'application/json' }),
    body: '{}',
    signal: AbortSignal.timeout(8_000)
  }).catch(() => undefined)
}

function makeLive(record: ChatConversation): LiveSession {
  return {
    conversationId: record.id,
    workspaceId: record.workspaceId,
    eveSessionId: record.eveSessionId,
    streamIndex: record.streamIndex,
    streamAbort: null,
    turnBusy: false,
    turnWaiter: null,
    lastAssistant: '',
    answerByStep: new Map(),
    activities: new Map(),
    record
  }
}

async function hydrate(id: string): Promise<LiveSession> {
  if (!isConversationId(id)) throw new Error('对话 id 不合法')
  const workspaceId = currentWorkspaceId()
  const existing = live.get(id)
  if (existing) {
    if (existing.workspaceId !== workspaceId) throw new Error('对话不属于当前工作空间')
    return existing
  }
  const record = await readConversation(workspaceId, id)
  if (!record) throw new Error('对话不存在')
  const session = makeLive(record)
  live.set(id, session)
  return session
}

function waitForTurnSettle(session: LiveSession): Promise<void> {
  return new Promise((resolve, reject) => {
    session.turnWaiter = { resolve, reject }
  })
}

async function ensureEveSession(
  session: LiveSession,
  message: EveMessage,
  timeoutMs = 30_000
): Promise<void> {
  if (session.eveSessionId) {
    openStream(session)
    try {
      await postSession(`/eve/v1/session/${session.eveSessionId}`, { message }, timeoutMs)
      return
    } catch (err) {
      if (!isSessionGone(err)) throw err
      closeStream(session)
      session.eveSessionId = null
      session.streamIndex = 0
      session.record.eveSessionId = null
    }
  }
  const created = await postSession('/eve/v1/session', { message }, timeoutMs)
  session.eveSessionId = created.sessionId
  session.record.eveSessionId = created.sessionId
  session.streamIndex = 0
  openStream(session)
}

export { pickChatFiles } from './chat-files'

export async function listChats(): Promise<ChatListItem[]> {
  return listConversations(currentWorkspaceId())
}

export async function getChat(id: string): Promise<ChatConversation | null> {
  if (!isConversationId(id)) return null
  const workspaceId = currentWorkspaceId()
  const existing = live.get(id)
  if (existing && existing.workspaceId === workspaceId) return cloneRecord(existing.record)
  const record = await readConversation(workspaceId, id)
  return record ? cloneRecord(record) : null
}

export async function sendChatMessage(
  conversationId: string,
  text: string,
  attachments: ChatAttachment[] = []
): Promise<void> {
  const trimmed = text.trim()
  if (!trimmed && attachments.length === 0) throw new Error('消息不能为空')
  if (!isConversationId(conversationId)) throw new Error('对话 id 不合法')
  if (status.state !== 'ready') {
    throw new Error(status.detail || 'AI 服务还没准备好')
  }
  const workspaceId = currentWorkspaceId()
  let session = live.get(conversationId)
  if (session && session.workspaceId !== workspaceId) {
    throw new Error('对话不属于当前工作空间')
  }
  const titleSource = trimmed || attachments[0]?.filename || '新对话'
  if (!session) {
    const existing = await readConversation(workspaceId, conversationId)
    session = makeLive(
      existing ?? {
        id: conversationId,
        title: titleFromMessage(titleSource),
        workspaceId,
        eveSessionId: null,
        streamIndex: 0,
        messages: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      }
    )
    live.set(conversationId, session)
  }
  if (session.turnBusy) throw new Error('上一轮还在回复')
  const files = attachments.length > 0 ? await readChatFiles(attachments) : []
  const eveMessage: EveMessage =
    files.length === 0
      ? trimmed
      : [
          ...(trimmed ? [{ type: 'text' as const, text: trimmed }] : []),
          ...files.map((file) => ({
            type: 'file' as const,
            data: file.dataUrl,
            mediaType: file.mediaType,
            filename: file.filename
          }))
        ]
  session.turnBusy = true
  if (!session.record.messages.some((msg) => msg.role === 'user')) {
    session.record.title = titleFromMessage(titleSource)
  }
  session.record.questions = undefined
  session.record.messages.push(
    {
      id: randomUUID(),
      role: 'user',
      text: trimmed,
      attachments:
        files.length > 0
          ? files.map((file) => ({
              filename: file.filename,
              mediaType: file.mediaType,
              size: file.size
            }))
          : undefined
    },
    { id: randomUUID(), role: 'assistant', text: '', pending: true }
  )
  const settled = waitForTurnSettle(session)
  try {
    try {
      emitSnapshot(session)
      await persist(session)
      await ensureEveSession(session, eveMessage, files.length > 0 ? 120_000 : 30_000)
    } catch (err) {
      failTurn(session, err instanceof Error ? err.message : String(err))
    }
    await settled
  } finally {
    session.turnBusy = false
  }
}

export async function cancelChat(conversationId: string): Promise<void> {
  const session = live.get(conversationId)
  if (!session?.eveSessionId) throw new Error('没有进行中的回复')
  await postCancel(session.eveSessionId)
}

export async function respondChat(
  conversationId: string,
  responses: ChatInputResponse[]
): Promise<void> {
  if (responses.length === 0) throw new Error('没有作答')
  if (status.state !== 'ready') {
    throw new Error(status.detail || 'AI 服务还没准备好')
  }
  const session = await hydrate(conversationId)
  if (session.turnBusy) throw new Error('上一轮还在回复')
  const pending = session.record.questions
  if (!pending?.length) throw new Error('当前没有待回答的问题')
  session.turnBusy = true
  session.record.questions = undefined
  const last = lastAssistantMessage(session)
  if (last) {
    last.pending = true
    last.error = undefined
  }
  emitSnapshot(session)
  const settled = waitForTurnSettle(session)
  try {
    try {
      if (!session.eveSessionId) throw new EveHttpError('会话已失效', 409, 'session_not_active')
      openStream(session)
      await postSession(`/eve/v1/session/${session.eveSessionId}`, { inputResponses: responses })
    } catch (err) {
      if (isSessionGone(err)) {
        failTurn(session, '提问时会话已断开，请直接发消息继续。')
      } else {
        failTurn(session, err instanceof Error ? err.message : String(err))
      }
    }
    await settled
  } finally {
    session.turnBusy = false
  }
}

export async function deleteChat(conversationId: string): Promise<void> {
  if (!isConversationId(conversationId)) throw new Error('对话 id 不合法')
  const workspaceId = currentWorkspaceId()
  const session = live.get(conversationId)
  if (session) {
    closeStream(session)
    if (session.turnWaiter) {
      session.turnWaiter.reject(new Error('对话已删除'))
      session.turnWaiter = null
    }
    session.turnBusy = false
    if (session.eveSessionId) {
      const eveId = session.eveSessionId
      void postCancel(eveId).catch(() => undefined)
      void postReset(eveId)
    }
    live.delete(conversationId)
  }
  await deleteConversation(workspaceId, conversationId)
  emitChat({ type: 'deleted', conversationId })
  await emitIndex(workspaceId)
}

function dropEveBindings(): void {
  for (const session of live.values()) {
    closeStream(session)
    session.eveSessionId = null
    session.record.eveSessionId = null
    if (session.turnWaiter) {
      const last = lastAssistantMessage(session)
      if (last?.pending) {
        last.pending = false
        last.error = last.error ?? 'AI 服务已停止'
      }
      session.record.questions = undefined
      emitSnapshot(session)
      void persist(session)
      session.turnWaiter.reject(new Error('AI 服务已停止'))
      session.turnWaiter = null
    }
    session.turnBusy = false
  }
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
    const cred = (await readDeepseekCredential()) ?? (await ensureHeliosKey())
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
      dropEveBindings()
      const detail = `eve 退出（code=${code ?? 'null'} signal=${signalName ?? 'none'}）`
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
  dropEveBindings()
  const ws = getStatus().workspace ?? getStatus().namespace
  if (ws) {
    for (const [id, session] of live) {
      if (session.workspaceId !== ws) live.delete(id)
    }
  }
  const proc = child
  child = null
  if (proc) await killChild(proc)
}

export async function restartAgent(): Promise<void> {
  await startAgent()
}
