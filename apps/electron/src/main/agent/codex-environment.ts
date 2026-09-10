import { execFile } from 'child_process'
import { promisify } from 'util'

const execFileAsync = promisify(execFile)

export function withSystemProxy(
  environment: NodeJS.ProcessEnv,
  settings: string
): NodeJS.ProcessEnv {
  const env = { ...environment }
  const proxyKeys = ['HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'WS_PROXY', 'WSS_PROXY']
  if (proxyKeys.some((key) => env[key] || env[key.toLowerCase()])) return env
  const values = new Map<string, string>()
  for (const line of settings.split('\n')) {
    const match = line.match(/^\s*(\w+)\s*:\s*(.*?)\s*$/)
    if (match) values.set(match[1], match[2])
  }
  function proxy(prefix: string): string | undefined {
    if (values.get(`${prefix}Enable`) !== '1') return undefined
    const host = values.get(`${prefix}Proxy`)
    const port = Number(values.get(`${prefix}Port`))
    if (!host || !/^[\w.:[\]-]+$/.test(host) || !Number.isInteger(port) || port < 1 || port > 65535) {
      return undefined
    }
    const address = host.includes(':') && !host.startsWith('[') ? `[${host}]` : host
    return `http://${address}:${port}`
  }
  const http = proxy('HTTP')
  const https = proxy('HTTPS') ?? http
  if (http) {
    env.HTTP_PROXY = http
    env.WS_PROXY = http
  }
  if (https) {
    env.HTTPS_PROXY = https
    env.WSS_PROXY = https
  }
  if ((http || https) && !env.NO_PROXY && !env.no_proxy) {
    env.NO_PROXY = 'localhost,127.0.0.1,::1'
  }
  return env
}

export async function codexEnvironment(): Promise<NodeJS.ProcessEnv> {
  if (process.platform !== 'darwin') return { ...process.env }
  try {
    const { stdout } = await execFileAsync('/usr/sbin/scutil', ['--proxy'], {
      timeout: 2_000,
      maxBuffer: 64 * 1024
    })
    return withSystemProxy(process.env, stdout)
  } catch {
    return { ...process.env }
  }
}
