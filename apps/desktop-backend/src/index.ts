import { createInterface } from 'node:readline'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { mkdirSync } from 'node:fs'
import { spawn } from 'node:child_process'
import {
  DESKTOP_METHODS,
  invokeDesktopMethod,
  startDesktopServices,
  stopDesktopServices,
  type DesktopMethod
} from '../../electron/src/main/desktop-api'
import { configureDesktopHost } from '../../electron/src/main/desktop-host'

interface RpcRequest {
  id: number
  method: string
  args?: unknown[]
}

interface RpcError {
  code: string
  message: string
  stack?: string
}

const originalStdoutWrite = process.stdout.write.bind(process.stdout)

function send(value: unknown): void {
  originalStdoutWrite(`${JSON.stringify(value)}\n`)
}

function logToStderr(...values: unknown[]): void {
  process.stderr.write(`${values.map(String).join(' ')}\n`)
}

// Node 24 treats an unhandled rejection as an uncaught exception. The RPC
// host must stay alive so one background Agent/Eve failure is reported as an
// event instead of taking down the whole Flutter application.
function reportBackgroundFailure(kind: string, reason: unknown): void {
  const message = reason instanceof Error ? reason.message : String(reason)
  const stack = reason instanceof Error ? reason.stack : undefined
  logToStderr(`[desktop] ${kind}: ${stack ?? message}`)
  send({ event: 'helios:backend-error', data: { kind, message } })
}

process.on('unhandledRejection', (reason) => {
  reportBackgroundFailure('unhandled rejection', reason)
})
process.stdout.on('error', (error) => {
  // Flutter can close the pipe while a late Agent event is being emitted.
  // EPIPE is expected during shutdown; other errors remain visible on stderr.
  if ((error as NodeJS.ErrnoException).code !== 'EPIPE') {
    logToStderr(`[desktop] stdout error: ${error.message}`)
  }
})

console.log = logToStderr
console.info = logToStderr

if (process.argv.includes('--print-contract')) {
  send({ version: 1, methods: DESKTOP_METHODS })
  process.exit(0)
}

function platformDataPath(): string {
  if (process.env['HELIOS_USER_DATA']) return resolve(process.env['HELIOS_USER_DATA'])
  if (process.platform === 'win32') {
    return join(process.env['APPDATA'] || homedir(), 'Helios')
  }
  return join(homedir(), 'Library', 'Application Support', 'Helios')
}

function platformDownloadsPath(): string {
  return resolve(process.env['HELIOS_DOWNLOADS'] || join(homedir(), 'Downloads'))
}

function runDetached(command: string, args: string[]): Promise<string> {
  return new Promise((resolveResult) => {
    const child = spawn(command, args, { detached: true, stdio: 'ignore', windowsHide: true })
    child.once('error', (error) => resolveResult(error.message))
    child.once('spawn', () => {
      child.unref()
      resolveResult('')
    })
  })
}

async function openExternal(url: string): Promise<void> {
  if (!/^https?:\/\//.test(url)) throw new Error('只允许打开 HTTP(S) 链接')
  const error =
    process.platform === 'win32'
      ? await runDetached('explorer.exe', [url])
      : await runDetached('open', [url])
  if (error) throw new Error(error)
}

async function writeClipboard(text: string): Promise<void> {
  const executable = process.platform === 'win32' ? 'clip.exe' : 'pbcopy'
  await new Promise<void>((resolveResult, reject) => {
    const child = spawn(executable, [], { stdio: ['pipe', 'ignore', 'ignore'], windowsHide: true })
    child.once('error', reject)
    child.once('close', (code) =>
      code === 0 ? resolveResult() : reject(new Error(`clipboard exited ${code}`))
    )
    child.stdin.end(text)
  })
}

function serializeError(error: unknown): RpcError {
  if (error instanceof Error) {
    return { code: 'INVOKE_ERROR', message: error.message, stack: error.stack }
  }
  return { code: 'INVOKE_ERROR', message: String(error) }
}

const userDataPath = platformDataPath()
mkdirSync(userDataPath, { recursive: true })
const entrypoint = process.argv[1] || __filename
const resourcesPath = resolve(process.env['HELIOS_RESOURCES'] || join(dirname(entrypoint), '..'))
const appRoot = resolve(process.env['HELIOS_APP_ROOT'] || join(__dirname, '..'))

configureDesktopHost({
  isPackaged: process.env['HELIOS_PACKAGED'] === '1',
  appRoot,
  resourcesPath,
  userDataPath,
  downloadsPath: platformDownloadsPath(),
  appVersion: process.env['HELIOS_VERSION'] || '0.8.0',
  platform: process.platform,
  emit(channel, payload) {
    send({ event: channel, data: payload })
  },
  openExternal,
  openPath(path) {
    return process.platform === 'win32'
      ? runDetached('explorer.exe', [path])
      : runDetached('open', [path])
  },
  writeClipboard,
  async selectFiles() {
    throw new Error('文件选择由 Flutter 桌面宿主提供')
  }
})

if (process.argv.includes('--smoke')) {
  send({ smoke: true, version: 1, methods: DESKTOP_METHODS })
  process.exit(0)
}

const methods = new Set<string>(DESKTOP_METHODS)
const lines = createInterface({ input: process.stdin, crlfDelay: Infinity })
let stopping = false

async function stop(): Promise<void> {
  if (stopping) return
  stopping = true
  lines.close()
  await stopDesktopServices().catch((error) => console.error(error))
}

lines.on('line', (line) => {
  void (async () => {
    let requestId: number | null = null
    try {
      const request = JSON.parse(line) as RpcRequest
      requestId = request.id
      if (!Number.isSafeInteger(request.id)) throw new Error('无效的 RPC id')
      if (!methods.has(request.method)) throw new Error(`未知方法：${request.method}`)
      if (request.args !== undefined && !Array.isArray(request.args))
        throw new Error('args 必须是数组')
      const result = await invokeDesktopMethod(request.method as DesktopMethod, request.args)
      send({ id: request.id, result: result ?? null })
    } catch (error) {
      send({ id: requestId, error: serializeError(error) })
    }
  })()
})

process.once('SIGINT', () => void stop().finally(() => process.exit(0)))
process.once('SIGTERM', () => void stop().finally(() => process.exit(0)))
process.once('disconnect', () => void stop().finally(() => process.exit(0)))

try {
  startDesktopServices()
} catch (error) {
  // A stale kubeconfig or unavailable update service must not prevent the
  // RPC endpoint from coming up; individual calls can still report errors.
  reportBackgroundFailure('service startup', error)
}
send({ event: 'helios:ready', data: { protocol: 1, methods: DESKTOP_METHODS } })
