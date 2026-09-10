import { CodexModelSelector, CodexTurnRunner, type CodexModelChoice } from './codex-model-fallback'
import { spawn, type ChildProcess, execFileSync } from 'child_process'
import { randomBytes, randomUUID } from 'crypto'
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { join, resolve } from 'path'
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
import { getEnabledAgentExecutor } from '../agent-executors'
import { getStatus } from '../sealos/auth'
import { ensureHeliosKey, getHeliosFallbackModels } from '../sealos/aiproxy'
import { fetchResources } from '../sealos/resources'
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
import { desktopHost } from '../desktop-host'
import {
  formatProcessExitDetail,
  formatStartFailure,
  ProcessOutputTail,
  redactProcessOutput,
  safeEveWorkflowEnvironment
} from './process-output'
import {
  rejectCodexRequest,
  requestCodex,
  respondCodexRequest,
  stopCodexAppServer,
  subscribeCodexThread,
  type CodexProtocolMessage,
  type CodexRequestId
} from './codex-app-server'

const EVE_HOST = '127.0.0.1'
const DEFAULT_EVE_PORT = 24721
const MIN_EVE_NODE_MAJOR = 24

const codexModelSelector = new CodexModelSelector()

function configuredEvePort(): number {
  const raw = process.env.HELIOS_EVE_PORT
  if (!raw) return DEFAULT_EVE_PORT
  const port = Number(raw)
  if (!Number.isInteger(port) || port < 1024 || port > 65535) {
    throw new Error(`HELIOS_EVE_PORT 必须是 1024 到 65535 之间的整数，当前值：${raw}`)
  }
  return port
}

const EVE_PORT = configuredEvePort()
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
  localProcess: ChildProcess | null
  localCancelRequested: boolean
  localExecutorId: string | null
  localTurnId: string | null
  codexRunner?: CodexTurnRunner
  codexThreadReady: boolean
  codexUnsubscribe: (() => void) | null
  codexMessages: Map<string, { index: number; phase: string | null; text: string }>
  codexThinking: Map<string, { index: number; text: string }>
  codexRequests: Map<string, PendingCodexRequest>
  record: ChatConversation
}

interface PendingCodexRequest {
  rpcId: CodexRequestId
  method: string
  params: Record<string, unknown>
  questionIds: Map<string, string>
  answers: Map<string, ChatInputResponse>
}

const live = new Map<string, LiveSession>()

function broadcast(channel: string, payload: unknown): void {
  desktopHost().emit(channel, payload)
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
  const file = join(desktopHost().userDataPath, 'eve-local-auth')
  try {
    const existing = readFileSync(file, 'utf8').trim()
    if (existing) return existing
  } catch {
    // 首次启动
  }
  const created = randomBytes(32).toString('base64url')
  mkdirSync(desktopHost().userDataPath, { recursive: true })
  writeFileSync(file, created, { mode: 0o600 })
  return created
}

function eveAuthHeaders(extra: Record<string, string> = {}): Record<string, string> {
  const token = Buffer.from(`${EVE_BASIC_USER}:${evePassword()}`, 'utf8').toString('base64')
  return { ...extra, Authorization: `Basic ${token}` }
}

function eveAppRoot(): string {
  const host = desktopHost()
  if (host.isPackaged) {
    const src = join(host.resourcesPath, 'eve')
    const dest = join(host.userDataPath, 'eve-runtime')
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
  const candidates = [join(host.appRoot, '..', 'eve'), join(__dirname, '../../../eve')]
  for (const dir of candidates) {
    if (existsSync(join(dir, 'package.json'))) return dir
  }
  throw new Error(`找不到 eve 应用目录（试过 ${candidates.join(', ')}）`)
}

function nodeExecutable(): string {
  const host = desktopHost()
  const candidates: string[] = []
  if (host.isPackaged) {
    const bundled =
      host.platform === 'win32'
        ? join(host.resourcesPath, 'node', 'node.exe')
        : join(host.resourcesPath, 'node', 'bin', 'node')
    if (!existsSync(bundled)) throw new Error(`打包资源缺少 Node：${bundled}`)
    candidates.push(bundled)
  } else {
    // npm_node_execpath comes from the npm process that started the preview.
    // It can be an older Node than the one exposed by the user's PATH.
    candidates.push(
      process.env.HELIOS_NODE_PATH ?? '',
      process.env.HELIOS_NODE_EXECUTABLE ?? '',
      process.env.npm_node_execpath ?? ''
    )
    if (host.platform === 'darwin') {
      candidates.push('/usr/local/bin/node', '/opt/homebrew/bin/node')
    }
    candidates.push(host.platform === 'win32' ? 'node.exe' : 'node')
  }

  const seen = new Set<string>()
  const rejected: string[] = []
  for (const executable of candidates) {
    if (!executable || seen.has(executable)) continue
    seen.add(executable)
    try {
      const version = execFileSync(executable, ['--version'], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore']
      }).trim()
      const major = Number(/^v?(\d+)/.exec(version)?.[1])
      if (Number.isInteger(major) && major >= MIN_EVE_NODE_MAJOR) return executable
      rejected.push(`${executable} (${version || '未知版本'})`)
    } catch {
      rejected.push(`${executable}（不可用）`)
    }
  }
  const detail = rejected.length ? `已检查：${rejected.join('，')}` : '未找到 node 可执行文件'
  throw new Error(
    `eve 需要 Node.js >=${MIN_EVE_NODE_MAJOR}。${detail}。请安装 Node 24，或设置 HELIOS_NODE_EXECUTABLE 指向兼容的 Node。`
  )
}

function eveSpawnArgs(root: string): { args: string[]; extraEnv: NodeJS.ProcessEnv } {
  const password = evePassword()
  const extraEnv: NodeJS.ProcessEnv = {
    HELIOS_EVE_PASSWORD: password,
    ...safeEveWorkflowEnvironment()
  }
  if (desktopHost().isPackaged) {
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
    if (process.platform === 'win32') {
      const out = execFileSync('netstat', ['-ano', '-p', 'tcp'], { encoding: 'utf8' })
      const pids = new Set<number>()
      for (const line of out.split('\n')) {
        if (!line.includes(`:${port}`) || !/LISTENING/i.test(line)) continue
        const pid = Number(line.trim().split(/\s+/).at(-1))
        if (Number.isInteger(pid) && pid > 0 && pid !== process.pid) pids.add(pid)
      }
      for (const pid of pids) process.kill(pid)
      return
    }
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

function killStaleDevelopmentEve(root: string): void {
  if (desktopHost().isPackaged || process.platform === 'win32') return
  try {
    const output = execFileSync('ps', ['-axo', 'pid=,command='], { encoding: 'utf8' })
    const eveCli = join(root, 'node_modules', 'eve', 'bin', 'eve.js')
    for (const line of output.split('\n')) {
      const match = /^\s*(\d+)\s+(.+)$/.exec(line)
      if (!match || !match[2].includes(eveCli) || !/\sdev(?:\s|$)/.test(match[2])) continue
      const pid = Number(match[1])
      if (Number.isInteger(pid) && pid > 0 && pid !== process.pid) process.kill(pid, 'SIGTERM')
    }
  } catch {
    // 进程已退出或当前环境不支持 ps。
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

function persistInBackground(session: LiveSession): void {
  void persist(session).catch((error: unknown) => {
    const detail = error instanceof Error ? error.message : String(error)
    console.error(`[agent] persist failed: ${detail}`)
  })
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
  session.codexRunner?.stop()
  const waiter = session.turnWaiter
  session.turnWaiter = null
  session.turnBusy = false
  session.localProcess = null
  session.localExecutorId = null
  session.localTurnId = null
  session.localCancelRequested = false
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
  session.codexRequests.clear()
  emitChat({ type: 'error', conversationId: session.conversationId, message })
  emitSnapshot(session)
  persistInBackground(session)
  settleTurn(session, new Error(message))
}

const CODEX_DEVELOPER_INSTRUCTIONS =
  '你是 Helios 的本地 Codex 执行器。遵守项目中的 AGENTS.md 和已安装 skills。' +
  '需要部署、修改或执行命令时展示关键过程并请求必要审批。' +
  '对于部署操作，每个用户请求只执行一次部署；重试前必须先查询已有资源，禁止重复创建。'

function localExecutorWorkdir(): string {
  return resolve(desktopHost().appRoot, '../..')
}

function clearCodexQuestions(session: LiveSession): void {
  session.codexRequests.clear()
  session.record.questions = undefined
}

function completeCancelledTurn(session: LiveSession): void {
  const last = lastAssistantMessage(session)
  if (last) last.pending = false
  session.localTurnId = null
  clearCodexQuestions(session)
  emitChat({ type: 'cancelled', conversationId: session.conversationId })
  emitSnapshot(session)
  persistInBackground(session)
  settleTurn(session)
}

function bindCodexThread(session: LiveSession, threadId: string): void {
  session.codexUnsubscribe?.()
  session.codexUnsubscribe = subscribeCodexThread(threadId, {
    onMessage: (message) => handleCodexMessage(session, message),
    onExit: (error) => {
      session.codexThreadReady = false
      session.localTurnId = null
      if (session.turnBusy && session.turnWaiter) failTurn(session, error.message)
    }
  })
}

async function ensureCodexThread(
  session: LiveSession,
  executor: { command: string },
  workdir: string,
  choice: CodexModelChoice
): Promise<string> {
  const stored = session.record.executorThreads?.codex
  if (stored && session.codexThreadReady) return stored

  let threadId: string | null = null
  if (stored) {
    try {
      const resumed = await requestCodex<Record<string, unknown>>(
        executor.command,
        'thread/resume',
        {
          threadId: stored,
          cwd: workdir,
          model: choice.model,
          approvalPolicy: 'on-request',
          approvalsReviewer: 'user',
          sandbox: 'workspace-write',
          developerInstructions: CODEX_DEVELOPER_INSTRUCTIONS
        },
        90_000
      )
      threadId = asString(asRecord(resumed.thread)?.id) ?? null
    } catch {
      threadId = null
    }
  }

  if (!threadId) {
    const started = await requestCodex<Record<string, unknown>>(
      executor.command,
      'thread/start',
      {
        cwd: workdir,
        model: choice.model,
        approvalPolicy: 'on-request',
        approvalsReviewer: 'user',
        sandbox: 'workspace-write',
        ephemeral: false,
        developerInstructions: CODEX_DEVELOPER_INSTRUCTIONS
      },
      90_000
    )
    threadId = asString(asRecord(started.thread)?.id) ?? null
  }
  if (!threadId) throw new Error('Codex app-server 未返回 thread id')

  session.record.executorThreads = { ...session.record.executorThreads, codex: threadId }
  session.codexThreadReady = true
  bindCodexThread(session, threadId)
  return threadId
}

async function runCodexExecutor(
  session: LiveSession,
  executor: { command: string },
  prompt: string
): Promise<void> {
  const waiter = session.turnWaiter
  session.codexRunner = undefined
  const workdir = localExecutorWorkdir()
  resetTurnTrace(session)
  session.codexMessages.clear()
  session.codexThinking.clear()
  session.codexRequests.clear()
  session.localExecutorId = 'codex'
  session.localCancelRequested = false
  const pending = lastAssistantMessage(session)
  if (pending) pending.text = ''
  emitChat({ type: 'delta', conversationId: session.conversationId, text: '' })
  emitActivity(session, {
    id: 'codex-turn',
    label: 'Codex',
    detail: '正在连接本地执行器',
    status: 'running'
  })

  const rpc = (method: string, params: Record<string, unknown>) =>
    requestCodex<Record<string, any>>(executor.command, method, params, 60_000)
  const choices = await codexModelSelector.choices(rpc, workdir, process.env.HELIOS_CODEX_MODEL)
  if (session.localCancelRequested || session.turnWaiter !== waiter) return
  const threadId = await ensureCodexThread(session, executor, workdir, choices[0])
  emitActivity(session, {
    id: 'codex-turn',
    label: 'Codex',
    detail: '已连接，正在提交任务',
    status: 'running'
  })
  await persist(session)
  if (session.localCancelRequested || session.turnWaiter !== waiter) return
  const runner = new CodexTurnRunner(rpc, codexModelSelector, choices, {
    threadId, cwd: workdir,
    input: [{ type: 'text', text: prompt, text_elements: [] }]
  }, {
    started: (id, model) => {
      session.localTurnId = id
      emitActivity(session, { id: 'codex-turn', label: 'Codex', detail: `正在执行任务（${model}）`, status: 'running' })
    },
    switched: model => {
      session.localTurnId = null
      session.codexMessages.clear()
      session.codexThinking.clear()
      emitActivity(session, { id: 'codex-model-switch', label: '自动切换模型', detail: `当前模型额度不足或不可用，改用 ${model} 继续执行`, status: 'running' })
      persistInBackground(session)
    },
    failed: error => failTurn(session, error instanceof Error ? error.message : String(error))
  })
  session.codexRunner = runner
  await runner.start()
}

async function runTextExecutor(
  session: LiveSession,
  executor: { id: string; label: string; command: string },
  prompt: string
): Promise<void> {
  const instructions =
    `你是 Helios 的本地 ${executor.label} 执行器。遵守项目中的 AGENTS.md 和已安装 skills。` +
    `对于部署操作，每个用户请求只执行一次部署；重试前先查询已有资源。\n\n用户请求：\n${prompt}`
  const workdir = localExecutorWorkdir()
  resetTurnTrace(session)
  session.localExecutorId = executor.id
  session.localCancelRequested = false
  emitActivity(session, {
    id: 'local-turn',
    label: executor.label,
    detail: '正在启动本地执行器',
    status: 'running'
  })
  let cancelled = false
  const result = await new Promise<string>((resolveResult, reject) => {
    const proc = spawn(executor.command, ['-p', instructions], {
      cwd: workdir,
      env: process.env,
      windowsHide: true
    })
    session.localProcess = proc
    const stderr = new ProcessOutputTail(12, 12_000)
    let output = ''
    proc.stdout?.on('data', (chunk: Buffer) => {
      output += chunk.toString()
      if (output.length > 200_000) output = output.slice(-200_000)
      const last = lastAssistantMessage(session)
      if (last) last.text = output
      emitChat({ type: 'delta', conversationId: session.conversationId, text: output })
    })
    proc.stderr?.on('data', (chunk: Buffer) => {
      stderr.push(chunk.toString())
      emitActivity(session, {
        id: 'local-turn',
        label: executor.label,
        detail: stderr.summary() || '正在执行',
        status: 'running'
      })
    })
    proc.once('error', reject)
    proc.once('close', (code, signal) => {
      const wasCurrent = session.localProcess === proc
      session.localProcess = null
      if (!wasCurrent) {
        cancelled = true
        resolveResult(output.trim())
        return
      }
      if (session.localCancelRequested) {
        cancelled = true
        completeCancelledTurn(session)
        resolveResult(output.trim())
        return
      }
      if (code === 0) resolveResult(output.trim())
      else
        reject(
          new Error(
            stderr.summary() ||
              `${executor.label} 退出（code=${code ?? 'none'} signal=${signal ?? 'none'}）`
          )
        )
    })
  })
  if (cancelled) return
  const last = lastAssistantMessage(session)
  if (last) {
    last.text = result || `${executor.label} 未返回内容`
    last.pending = false
  }
  emitActivity(session, {
    id: 'local-turn',
    label: executor.label,
    detail: '已完成',
    status: 'done'
  })
  emitChat({ type: 'done', conversationId: session.conversationId })
  emitSnapshot(session)
  await persist(session)
  settleTurn(session)
}

async function runLocalExecutor(
  session: LiveSession,
  executor: { id: string; label: string; command: string },
  prompt: string
): Promise<void> {
  if (executor.id === 'codex') return runCodexExecutor(session, executor, prompt)
  return runTextExecutor(session, executor, prompt)
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
  const detail = item.detail ? clip(item.detail, 1_200) : undefined
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

function codexItemSummary(item: Record<string, unknown>): Pick<ChatActivity, 'label' | 'detail'> {
  const type = asString(item.type) ?? 'activity'
  if (type === 'commandExecution') {
    return { label: '执行命令', detail: asString(item.command) }
  }
  if (type === 'fileChange') {
    const changes = Array.isArray(item.changes) ? item.changes : []
    const paths = changes
      .map((change) => asString(asRecord(change)?.path))
      .filter((path): path is string => Boolean(path))
    return { label: '修改文件', detail: paths.join('\n') || '正在准备文件变更' }
  }
  if (type === 'mcpToolCall') {
    const server = asString(item.server)
    const tool = asString(item.tool) ?? 'tool'
    return {
      label: server ? `${server} / ${tool}` : tool,
      detail: item.arguments === undefined ? undefined : JSON.stringify(item.arguments)
    }
  }
  if (type === 'dynamicToolCall') {
    return {
      label: asString(item.tool) ?? '调用工具',
      detail: item.arguments === undefined ? undefined : JSON.stringify(item.arguments)
    }
  }
  if (type === 'webSearch') return { label: '搜索网页', detail: asString(item.query) }
  if (type === 'imageView') return { label: '查看图片', detail: asString(item.path) }
  if (type === 'collabAgentToolCall') {
    return { label: '协作任务', detail: asString(item.prompt) ?? asString(item.tool) }
  }
  if (type === 'subAgentActivity') {
    return { label: '子任务', detail: asString(item.kind) ?? asString(item.agentPath) }
  }
  if (type === 'contextCompaction') return { label: '整理上下文' }
  return { label: 'Codex', detail: type }
}

function codexActivityStatus(item: Record<string, unknown>): ChatActivity['status'] {
  const status = asString(item.status)
  if (status === 'failed' || status === 'declined') return 'error'
  if (status === 'inProgress') return 'running'
  return 'done'
}

function appendCodexThinking(session: LiveSession, key: string, delta: string): void {
  let entry = session.codexThinking.get(key)
  if (!entry) {
    entry = { index: session.codexThinking.size, text: '' }
    session.codexThinking.set(key, entry)
  }
  entry.text += delta
  if (entry.text.length > 8_000) entry.text = entry.text.slice(-8_000)
  upsertThinking(session, entry.index, entry.text)
}

function updateCodexAnswer(
  session: LiveSession,
  itemId: string,
  delta: string,
  phase?: string | null,
  replace = false
): void {
  let entry = session.codexMessages.get(itemId)
  if (!entry) {
    entry = { index: session.codexMessages.size, phase: phase ?? null, text: '' }
    session.codexMessages.set(itemId, entry)
  }
  if (phase !== undefined) entry.phase = phase
  entry.text = replace ? delta : entry.text + delta
  if (entry.phase === 'commentary') {
    const key = `message:${itemId}`
    const thinking = session.codexThinking.get(key)
    if (thinking) {
      thinking.text = entry.text
      upsertThinking(session, thinking.index, thinking.text)
    } else {
      appendCodexThinking(session, key, entry.text)
    }
    return
  }
  session.lastAssistant = [...session.codexMessages.values()]
    .filter((message) => message.phase !== 'commentary')
    .sort((a, b) => a.index - b.index)
    .map((message) => message.text.trim())
    .filter(Boolean)
    .join('\n\n')
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

function appendCodexCommandOutput(session: LiveSession, itemId: string, delta: string): void {
  const current = session.activities.get(itemId)
  const combined = `${current?.detail ?? ''}\n${delta}`.trim()
  const detail = combined.length > 1_200 ? `…${combined.slice(-1_199)}` : combined
  emitActivity(session, {
    id: itemId,
    label: current?.label ?? '执行命令',
    detail,
    status: 'running'
  })
}

function registerCodexRequest(
  session: LiveSession,
  rpcId: CodexRequestId,
  method: string,
  params: Record<string, unknown>,
  questions: ChatQuestion[],
  sourceIds: string[]
): void {
  const request: PendingCodexRequest = {
    rpcId,
    method,
    params,
    questionIds: new Map(),
    answers: new Map()
  }
  questions.forEach((question, index) => {
    request.questionIds.set(question.requestId, sourceIds[index] ?? question.requestId)
    session.codexRequests.set(question.requestId, request)
  })
  session.record.questions = [...(session.record.questions ?? []), ...questions]
  emitChat({
    type: 'question',
    conversationId: session.conversationId,
    questions: session.record.questions
  })
  persistInBackground(session)
}

function resolveCodexRequestInUi(session: LiveSession, rpcId: CodexRequestId): void {
  const requests = new Set(
    [...session.codexRequests.values()].filter((request) => String(request.rpcId) === String(rpcId))
  )
  if (requests.size === 0) return
  const ids = new Set<string>()
  for (const request of requests) {
    for (const publicId of request.questionIds.keys()) {
      ids.add(publicId)
      session.codexRequests.delete(publicId)
    }
  }
  session.record.questions = (session.record.questions ?? []).filter(
    (question) => !ids.has(question.requestId)
  )
  if (!session.record.questions.length) session.record.questions = undefined
  emitSnapshot(session)
  persistInBackground(session)
}

function handleCodexRequest(session: LiveSession, message: CodexProtocolMessage): void {
  if (message.id === undefined || !message.method) return
  const params = message.params ?? {}
  const baseId = `codex:${String(message.id)}`
  if (message.method === 'item/commandExecution/requestApproval') {
    const command = asString(params.command) ?? '未提供命令'
    const reason = asString(params.reason)
    registerCodexRequest(
      session,
      message.id,
      message.method,
      params,
      [
        {
          requestId: baseId,
          kind: 'tool-approval',
          prompt: `${reason ? `${reason}\n\n` : ''}Codex 请求执行命令：\n${command}`,
          toolName: 'shell',
          options: [
            { id: 'accept', label: '允许一次' },
            { id: 'acceptForSession', label: '本次会话允许' },
            { id: 'decline', label: '拒绝' }
          ]
        }
      ],
      [baseId]
    )
    return
  }
  if (message.method === 'item/fileChange/requestApproval') {
    registerCodexRequest(
      session,
      message.id,
      message.method,
      params,
      [
        {
          requestId: baseId,
          kind: 'tool-approval',
          prompt: asString(params.reason) ?? 'Codex 请求修改工作区文件',
          toolName: 'fileChange',
          options: [
            { id: 'accept', label: '允许一次' },
            { id: 'acceptForSession', label: '本次会话允许' },
            { id: 'decline', label: '拒绝' }
          ]
        }
      ],
      [baseId]
    )
    return
  }
  if (message.method === 'item/tool/requestUserInput') {
    const rawQuestions = Array.isArray(params.questions) ? params.questions : []
    const questions: ChatQuestion[] = []
    const sourceIds: string[] = []
    rawQuestions.forEach((raw, index) => {
      const question = asRecord(raw)
      const sourceId = asString(question?.id) ?? String(index)
      const options = Array.isArray(question?.options)
        ? question.options
            .map((rawOption) => asRecord(rawOption))
            .filter((option): option is Record<string, unknown> => Boolean(option))
            .map((option) => {
              const label = asString(option.label) ?? '选项'
              const description = asString(option.description)
              return { id: label, label: description ? `${label}：${description}` : label }
            })
        : undefined
      questions.push({
        requestId: `${baseId}:${sourceId}`,
        kind: 'question',
        prompt: asString(question?.question) ?? asString(question?.header) ?? '需要你的回复',
        options,
        allowFreeform: question?.isOther === true || !options?.length
      })
      sourceIds.push(sourceId)
    })
    if (questions.length > 0) {
      registerCodexRequest(session, message.id, message.method, params, questions, sourceIds)
    } else {
      rejectCodexRequest(message.id, 'Codex 提问中没有可显示的问题')
    }
    return
  }
  if (message.method === 'item/permissions/requestApproval') {
    registerCodexRequest(
      session,
      message.id,
      message.method,
      params,
      [
        {
          requestId: baseId,
          kind: 'tool-approval',
          prompt: asString(params.reason) ?? 'Codex 请求额外的文件或网络权限',
          toolName: 'permissions',
          options: [
            { id: 'accept-turn', label: '仅本轮允许' },
            { id: 'accept-session', label: '本次会话允许' },
            { id: 'decline', label: '拒绝' }
          ]
        }
      ],
      [baseId]
    )
    return
  }
  if (message.method === 'mcpServer/elicitation/request') {
    registerCodexRequest(
      session,
      message.id,
      message.method,
      params,
      [
        {
          requestId: baseId,
          kind: 'question',
          prompt: asString(params.message) ?? '外部工具需要你的输入',
          options: [
            { id: 'decline', label: '拒绝' },
            { id: 'cancel', label: '取消' }
          ],
          allowFreeform: params.mode !== 'url',
          toolName: asString(params.serverName)
        }
      ],
      [baseId]
    )
    return
  }

  rejectCodexRequest(message.id, `Helios 暂不支持 Codex 请求：${message.method}`)
  emitActivity(session, {
    id: `codex-request-${String(message.id)}`,
    label: 'Codex 交互',
    detail: `不支持的请求：${message.method}`,
    status: 'error'
  })
}

function handleCodexItemStarted(session: LiveSession, params: Record<string, unknown>): void {
  const item = asRecord(params.item)
  if (!item) return
  const itemId = asString(item.id)
  const type = asString(item.type)
  if (!itemId || !type || type === 'userMessage') return
  if (type === 'agentMessage') {
    const phase = asString(item.phase) ?? null
    session.codexMessages.set(itemId, {
      index: session.codexMessages.size,
      phase,
      text: asString(item.text) ?? ''
    })
    return
  }
  if (type === 'reasoning' || type === 'plan') return
  emitActivity(session, {
    id: itemId,
    status: 'running',
    ...codexItemSummary(item)
  })
}

function handleCodexItemCompleted(session: LiveSession, params: Record<string, unknown>): void {
  const item = asRecord(params.item)
  if (!item) return
  const itemId = asString(item.id)
  const type = asString(item.type)
  if (!itemId || !type || type === 'userMessage') return
  if (type === 'agentMessage') {
    updateCodexAnswer(
      session,
      itemId,
      typeof item.text === 'string' ? item.text : '',
      asString(item.phase) ?? null,
      true
    )
    return
  }
  if (type === 'reasoning' || type === 'plan') return
  const summary = codexItemSummary(item)
  const aggregated = asString(item.aggregatedOutput)
  emitActivity(session, {
    id: itemId,
    label: summary.label,
    detail: aggregated ? `${summary.detail ?? ''}\n${aggregated}`.trim() : summary.detail,
    status: codexActivityStatus(item)
  })
}

function finishCodexTurn(session: LiveSession, params: Record<string, unknown>): void {
  if (!session.turnWaiter) return
  const turn = asRecord(params.turn)
  const status = asString(turn?.status) ?? 'completed'
  session.localTurnId = null
  clearCodexQuestions(session)
  if (status === 'interrupted') {
    completeCancelledTurn(session)
    return
  }
  if (status === 'failed') {
    const error = asRecord(turn?.error)
    failTurn(session, asString(error?.message) ?? 'Codex 执行失败')
    return
  }
  const last = lastAssistantMessage(session)
  if (last) {
    last.pending = false
    if (!last.text.trim()) last.text = 'Codex 已完成任务，但没有返回说明。'
  }
  emitActivity(session, {
    id: 'codex-turn',
    label: 'Codex',
    detail: '已完成',
    status: 'done'
  })
  emitChat({ type: 'done', conversationId: session.conversationId })
  emitSnapshot(session)
  persistInBackground(session)
  settleTurn(session)
}

function handleCodexMessage(session: LiveSession, message: CodexProtocolMessage): void {
  if (message.id !== undefined && message.method) {
    handleCodexRequest(session, message)
    return
  }
  const method = message.method
  const params = message.params ?? {}
  if (session.codexRunner?.handle(method, params)) return
  const eventTurnId = asString(params.turnId) ?? asString(asRecord(params.turn)?.id)
  if (session.localTurnId && eventTurnId && eventTurnId !== session.localTurnId) return

  switch (method) {
    case 'turn/started': {
      if (eventTurnId) session.localTurnId = eventTurnId
      const last = lastAssistantMessage(session)
      if (last) last.text = ''
      emitActivity(session, {
        id: 'codex-turn',
        label: 'Codex',
        detail: '开始执行',
        status: 'running'
      })
      break
    }
    case 'turn/plan/updated': {
      const plan = Array.isArray(params.plan) ? params.plan : []
      plan.forEach((raw, index) => {
        const step = asRecord(raw)
        const state = asString(step?.status)
        emitActivity(session, {
          id: `codex-plan-${index}`,
          label: `计划 ${index + 1}/${plan.length}`,
          detail: asString(step?.step) ?? '未命名步骤',
          status: state === 'completed' ? 'done' : 'running'
        })
      })
      break
    }
    case 'item/started':
      handleCodexItemStarted(session, params)
      break
    case 'item/completed':
      handleCodexItemCompleted(session, params)
      break
    case 'item/agentMessage/delta': {
      const itemId = asString(params.itemId)
      if (itemId && typeof params.delta === 'string') {
        updateCodexAnswer(session, itemId, params.delta)
      }
      break
    }
    case 'item/reasoning/summaryTextDelta':
    case 'item/reasoning/textDelta': {
      const itemId = asString(params.itemId)
      const index = typeof params.summaryIndex === 'number' ? params.summaryIndex : 0
      if (itemId && typeof params.delta === 'string') {
        appendCodexThinking(session, `reasoning:${itemId}:${index}`, params.delta)
      }
      break
    }
    case 'item/commandExecution/outputDelta': {
      const itemId = asString(params.itemId)
      if (itemId && typeof params.delta === 'string') {
        appendCodexCommandOutput(session, itemId, params.delta)
      }
      break
    }
    case 'item/fileChange/patchUpdated': {
      const itemId = asString(params.itemId)
      if (itemId) {
        handleCodexItemStarted(session, {
          item: { id: itemId, type: 'fileChange', changes: params.changes }
        })
      }
      break
    }
    case 'serverRequest/resolved': {
      const requestId = params.requestId
      if (typeof requestId === 'string' || typeof requestId === 'number') {
        resolveCodexRequestInUi(session, requestId)
      }
      break
    }
    case 'error': {
      const error = asRecord(params.error)
      const detail = asString(error?.message) ?? 'Codex 执行出错'
      if (params.willRetry === true) {
        emitActivity(session, {
          id: 'codex-retry',
          label: 'Codex 正在重试',
          detail,
          status: 'running'
        })
      } else if (session.turnWaiter) {
        failTurn(session, detail)
      }
      break
    }
    case 'turn/completed':
      finishCodexTurn(session, params)
      break
    default:
      break
  }
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
      persistInBackground(session)
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
      persistInBackground(session)
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
  const pending = record.messages.at(-1)
  if (record.eveSessionId === null && pending?.role === 'assistant' && pending.pending) {
    pending.pending = false
    pending.error = pending.error ?? '上一次本地执行已中断，请重新发送任务。'
    record.questions = undefined
  }
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
    localProcess: null,
    localCancelRequested: false,
    localExecutorId: null,
    localTurnId: null,
    codexThreadReady: false,
    codexUnsubscribe: null,
    codexMessages: new Map(),
    codexThinking: new Map(),
    codexRequests: new Map(),
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
  if (!record) return null
  const session = makeLive(record)
  live.set(id, session)
  persistInBackground(session)
  return cloneRecord(session.record)
}

async function createConversation(
  projectName?: string,
  projectContext?: string
): Promise<ChatConversation> {
  const normalizedProject = projectName?.trim() || undefined
  const context = projectContext?.trim() || undefined
  const workspaceId = currentWorkspaceId()
  const now = new Date().toISOString()
  const record: ChatConversation = {
    id: randomUUID(),
    title: normalizedProject ? `维护 ${normalizedProject}` : '新对话',
    workspaceId,
    eveSessionId: null,
    streamIndex: 0,
    messages: [],
    ...(normalizedProject ? { projectName: normalizedProject } : {}),
    ...(context ? { projectContext: context } : {}),
    createdAt: now,
    updatedAt: now
  }
  const session = makeLive(record)
  live.set(record.id, session)
  await persist(session)
  emitSnapshot(session)
  return cloneRecord(record)
}

/** Create a chat that can be opened immediately, optionally linked to a Project. */
export async function createChat(
  projectName?: string,
  projectContext?: string
): Promise<ChatConversation> {
  return createConversation(projectName, projectContext)
}

export async function getOrCreateProjectChat(
  projectName: string,
  projectContext?: string
): Promise<ChatConversation> {
  const normalized = projectName.trim()
  if (!normalized) throw new Error('项目名称不能为空')
  const context = projectContext?.trim()
  const workspaceId = currentWorkspaceId()
  const existing = (await listConversations(workspaceId)).find(
    (item) => item.projectName === normalized
  )
  if (existing) {
    const record = await getChat(existing.id)
    if (record) {
      if (context && record.projectContext !== context) {
        record.projectContext = context
        const session = await hydrate(record.id)
        session.record.projectContext = context
        await persist(session)
      }
      return record
    }
  }
  return createConversation(normalized, context)
}

function messageWithProjectContext(record: ChatConversation, text: string): string {
  const context = record.projectContext?.trim()
  if (!record.projectName) return text
  return [
    `当前维护的 Sealos Project：${record.projectName}。`,
    ...(context ? [`项目摘要（仅作上下文，不向用户展示）：${context}`] : []),
    '高风险操作（删除、暂停、公开暴露、覆盖数据）必须先说明影响并等待确认。',
    '',
    `用户当前请求：${text}`
  ].join('\n')
}

function mayCreateProject(text: string): boolean {
  return /部署|deploy|创建.{0,8}(项目|project)|从应用商店|模板/.test(text)
}

async function linkCreatedProject(session: LiveSession, before: Set<string> | null): Promise<void> {
  if (!before || session.record.projectName) return
  try {
    const after = await fetchResources()
    const created = after.projects
      .map((project) => project.name)
      .filter((name) => !before.has(name))
    if (created.length !== 1 || !created[0]) return
    session.record.projectName = created[0]
    await persist(session)
    emitSnapshot(session)
  } catch {
    // 项目资源暂未就绪或短暂网络失败时，不影响对话本身。
  }
}

export async function sendChatMessage(
  conversationId: string,
  text: string,
  attachments: ChatAttachment[] = []
): Promise<void> {
  const trimmed = text.trim()
  if (!trimmed && attachments.length === 0) throw new Error('消息不能为空')
  if (!isConversationId(conversationId)) throw new Error('对话 id 不合法')
  const executor = await getEnabledAgentExecutor()
  if (!executor && status.state !== 'ready') {
    throw new Error(status.detail || 'AI 服务还没准备好')
  }
  const workspaceId = currentWorkspaceId()
  const projectsBefore = mayCreateProject(trimmed)
    ? await fetchResources()
        .then((snapshot) => new Set(snapshot.projects.map((project) => project.name)))
        .catch(() => null)
    : null
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
  const textWithContext = messageWithProjectContext(session.record, trimmed)
  const eveMessage: EveMessage =
    files.length === 0
      ? textWithContext
      : [
          ...(textWithContext ? [{ type: 'text' as const, text: textWithContext }] : []),
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
      if (executor) {
        if (files.length > 0) throw new Error('本地执行器暂不支持附件')
        const pending = lastAssistantMessage(session)
        if (pending) pending.text = `正在由 ${executor.label} 执行…`
        emitSnapshot(session)
        await runLocalExecutor(session, executor, textWithContext)
      } else {
        await ensureEveSession(session, eveMessage, files.length > 0 ? 120_000 : 30_000)
      }
    } catch (err) {
      failTurn(session, err instanceof Error ? err.message : String(err))
    }
    await settled
    await linkCreatedProject(session, projectsBefore)
  } finally {
    session.turnBusy = false
  }
}

export async function cancelChat(conversationId: string): Promise<void> {
  const session = live.get(conversationId)
  if (!session) throw new Error('没有进行中的回复')
  const codexThreadId = session.record.executorThreads?.codex
  if (session.localExecutorId === 'codex' && session.turnBusy) {
    session.localCancelRequested = true
    await session.codexRunner?.cancel()
    completeCancelledTurn(session)
    return
  }
  if (session.localExecutorId === 'codex' && codexThreadId && session.localTurnId) {
    session.localCancelRequested = true
    await requestCodex('codex', 'turn/interrupt', {
      threadId: codexThreadId,
      turnId: session.localTurnId
    })
    return
  }
  if (session.localProcess && session.localProcess.exitCode === null) {
    session.localCancelRequested = true
    session.localProcess.kill('SIGTERM')
    return
  }
  if (!session.eveSessionId) throw new Error('没有进行中的回复')
  await postCancel(session.eveSessionId)
}

function codexRequestResult(request: PendingCodexRequest): unknown {
  const first = request.answers.values().next().value as ChatInputResponse | undefined
  if (request.method === 'item/commandExecution/requestApproval') {
    return { decision: first?.optionId ?? 'decline' }
  }
  if (request.method === 'item/fileChange/requestApproval') {
    return { decision: first?.optionId ?? 'decline' }
  }
  if (request.method === 'item/tool/requestUserInput') {
    const answers: Record<string, { answers: string[] }> = {}
    for (const [publicId, sourceId] of request.questionIds) {
      const response = request.answers.get(publicId)
      const answer = response?.text ?? response?.optionId
      answers[sourceId] = { answers: answer ? [answer] : [] }
    }
    return { answers }
  }
  if (request.method === 'item/permissions/requestApproval') {
    const requested = asRecord(request.params.permissions)
    const permissions: Record<string, unknown> = {}
    if (requested?.network) permissions.network = requested.network
    if (requested?.fileSystem) permissions.fileSystem = requested.fileSystem
    const decision = first?.optionId ?? 'decline'
    return {
      permissions: decision === 'decline' ? {} : permissions,
      scope: decision === 'accept-session' ? 'session' : 'turn'
    }
  }
  if (request.method === 'mcpServer/elicitation/request') {
    const action = first?.optionId ?? (first?.text ? 'accept' : 'decline')
    return {
      action,
      content: action === 'accept' ? (first?.text ?? null) : null,
      _meta: null
    }
  }
  throw new Error(`不支持的 Codex 请求：${request.method}`)
}

async function respondToCodex(session: LiveSession, responses: ChatInputResponse[]): Promise<void> {
  const requests = new Set<PendingCodexRequest>()
  for (const response of responses) {
    const request = session.codexRequests.get(response.requestId)
    if (!request) throw new Error('Codex 交互请求已失效')
    request.answers.set(response.requestId, response)
    requests.add(request)
  }

  const answeredIds = new Set(responses.map((response) => response.requestId))
  session.record.questions = (session.record.questions ?? []).filter(
    (question) => !answeredIds.has(question.requestId)
  )
  for (const request of requests) {
    const complete = [...request.questionIds.keys()].every((id) => request.answers.has(id))
    if (!complete) continue
    respondCodexRequest(request.rpcId, codexRequestResult(request))
    for (const publicId of request.questionIds.keys()) {
      session.codexRequests.delete(publicId)
      session.record.questions = (session.record.questions ?? []).filter(
        (question) => question.requestId !== publicId
      )
    }
  }
  if (!session.record.questions?.length) session.record.questions = undefined
  emitSnapshot(session)
  if (session.record.questions?.length) {
    emitChat({
      type: 'question',
      conversationId: session.conversationId,
      questions: session.record.questions
    })
  }
  await persist(session)
}

export async function respondChat(
  conversationId: string,
  responses: ChatInputResponse[]
): Promise<void> {
  if (responses.length === 0) throw new Error('没有作答')
  const session = await hydrate(conversationId)
  if (responses.some((response) => session.codexRequests.has(response.requestId))) {
    await respondToCodex(session, responses)
    return
  }
  if (status.state !== 'ready') {
    throw new Error(status.detail || 'AI 服务还没准备好')
  }
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
    session.codexUnsubscribe?.()
    session.codexUnsubscribe = null
    if (session.localExecutorId === 'codex' && session.localTurnId) {
      const threadId = session.record.executorThreads?.codex
      if (threadId) {
        void requestCodex('codex', 'turn/interrupt', {
          threadId,
          turnId: session.localTurnId
        }).catch(() => undefined)
      }
    }
    if (session.localProcess?.exitCode === null) session.localProcess.kill('SIGTERM')
    session.localProcess = null
    if (session.turnWaiter) {
      session.turnWaiter.reject(new Error('对话已删除'))
      session.turnWaiter = null
    }
    session.turnBusy = false
    if (session.eveSessionId) {
      const eveId = session.eveSessionId
      void postCancel(eveId).catch(() => undefined)
      // 删除对话时 Eve 可能已经退出；不要让后台 reset rejection 终止 Node 24 sidecar。
      void postReset(eveId).catch((error: unknown) => {
        const detail = error instanceof Error ? error.message : String(error)
        console.error(`[agent] reset after delete failed: ${detail}`)
      })
    }
    live.delete(conversationId)
  }
  await deleteConversation(workspaceId, conversationId)
  emitChat({ type: 'deleted', conversationId })
  await emitIndex(workspaceId)
}

export async function renameChat(conversationId: string, title: string): Promise<void> {
  const nextTitle = title.replace(/\s+/g, ' ').trim()
  if (!nextTitle) throw new Error('对话标题不能为空')
  const session = await hydrate(conversationId)
  if (session.turnBusy) throw new Error('正在生成回复，暂时不能重命名')
  session.record.title = titleFromMessage(nextTitle)
  emitSnapshot(session)
  await persist(session)
}

export async function archiveChat(conversationId: string): Promise<void> {
  const session = await hydrate(conversationId)
  if (session.turnBusy) throw new Error('正在生成回复，暂时不能归档')
  closeStream(session)
  session.record.archivedAt = new Date().toISOString()
  session.record.updatedAt = session.record.archivedAt
  await writeConversation(session.record)
  live.delete(conversationId)
  emitChat({ type: 'archived', conversationId })
  await emitIndex(session.workspaceId)
}

function dropEveBindings(): void {
  for (const session of live.values()) {
    closeStream(session)
    session.eveSessionId = null
    session.record.eveSessionId = null
    if (session.localExecutorId) continue
    if (session.turnWaiter) {
      const last = lastAssistantMessage(session)
      if (last?.pending) {
        last.pending = false
        last.error = last.error ?? 'AI 服务已停止'
      }
      session.record.questions = undefined
      emitSnapshot(session)
      persistInBackground(session)
      session.turnWaiter.reject(new Error('AI 服务已停止'))
      session.turnWaiter = null
    }
    session.turnBusy = false
  }
}

function dropLocalBindings(): void {
  for (const session of live.values()) {
    session.codexUnsubscribe?.()
    session.codexUnsubscribe = null
    session.codexThreadReady = false
    session.localTurnId = null
    session.localCancelRequested = true
    if (session.localProcess?.exitCode === null) session.localProcess.kill('SIGTERM')
    session.localProcess = null
    session.codexRequests.clear()
    if (!session.localExecutorId) continue
    if (session.turnWaiter) {
      const last = lastAssistantMessage(session)
      if (last?.pending) {
        last.pending = false
        last.error = last.error ?? '本地执行器已停止'
      }
      session.record.questions = undefined
      emitSnapshot(session)
      persistInBackground(session)
      session.turnWaiter.reject(new Error('本地执行器已停止'))
      session.turnWaiter = null
    }
    session.localExecutorId = null
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
  let startingProc: ChildProcess | null = null
  try {
    const cred = (await readDeepseekCredential()) ?? (await ensureHeliosKey())
    if (epoch !== startEpoch) return
    setStatus({ state: 'starting', detail: `正在启动 AI 服务（${cred.model}）…` })
    let fallbackModels: string[] = []
    try {
      fallbackModels = await getHeliosFallbackModels(cred.model)
    } catch {
      // 模型目录短暂不可用时仍然启动首选模型，后续请求可重试。
    }

    const root = eveAppRoot()
    const { args, extraEnv } = eveSpawnArgs(root)
    killStaleDevelopmentEve(root)
    killPortListeners(EVE_PORT)
    await sleep(200)

    const proc = spawn(nodeExecutable(), args, {
      cwd: root,
      env: {
        ...process.env,
        HELIOS_AI_BASE_URL: cred.endpoint,
        HELIOS_AI_KEY: cred.apiKey,
        HELIOS_AI_MODEL: cred.model,
        HELIOS_AI_FALLBACK_MODELS: JSON.stringify(fallbackModels),
        ...extraEnv
      },
      stdio: ['ignore', 'pipe', 'pipe']
    })
    startingProc = proc
    child = proc
    const stderrTail = new ProcessOutputTail()
    proc.stdout?.on('data', (buf: Buffer) => {
      const line = redactProcessOutput(buf.toString().trim())
      if (line) console.log('[eve]', line)
    })
    proc.stderr?.on('data', (buf: Buffer) => {
      stderrTail.push(buf.toString())
      const line = redactProcessOutput(buf.toString().trim())
      if (line) console.error('[eve]', line)
    })
    proc.on('close', (code, signalName) => {
      if (child !== proc) return
      child = null
      dropEveBindings()
      const detail = formatProcessExitDetail('eve', code, signalName, stderrTail.summary())
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
    if (epoch !== startEpoch || (startingProc && child !== startingProc)) return
    setStatus({ state: 'ready' })
  } catch (err) {
    // The exit handler already published the actual code/signal. Do not
    // replace it with AbortController's generic "This operation was aborted".
    if (epoch !== startEpoch) return
    const detail = formatStartFailure(err, Boolean(startingProc && child !== startingProc))
    if (!detail) return
    setStatus({ state: 'error', detail })
  }
}

async function stopAgentQuiet(): Promise<void> {
  dropEveBindings()
  dropLocalBindings()
  const ws = getStatus().workspace ?? getStatus().namespace
  if (ws) {
    for (const [id, session] of live) {
      if (session.workspaceId !== ws) live.delete(id)
    }
  }
  const proc = child
  child = null
  if (proc) await killChild(proc)
  await stopCodexAppServer()
}

export async function restartAgent(): Promise<void> {
  await startAgent()
}
