import { promises as fs } from 'fs'
import { existsSync, readFileSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'
import type { LoginEvent, RegionOption, SealosStatus } from '../../shared/types'

// Same public client id and credential layout as use-sealos's sealos-api.py,
// so Helios and the skill recognize each other's login state.
const CLIENT_ID = 'af993c98-d19d-4bdc-b338-79b80dc4f8bf'
const DEVICE_GRANT = 'urn:ietf:params:oauth:grant-type:device_code'

export const DEFAULT_REGION = 'https://usw-1.sealos.io'
export const KNOWN_REGIONS: RegionOption[] = [
  { url: 'https://usw-1.sealos.io', label: 'usw-1.sealos.io（国际）' },
  { url: 'https://gzg.sealos.run', label: 'gzg.sealos.run（广州）' },
  { url: 'https://bja.sealos.run', label: 'bja.sealos.run（北京）' },
  { url: 'https://hzh.sealos.run', label: 'hzh.sealos.run（杭州）' }
]

const SEALOS_DIR = join(homedir(), '.sealos')
export const KUBECONFIG_PATH = process.env.SEALOS_KUBECONFIG ?? join(SEALOS_DIR, 'kubeconfig')
const AUTH_PATH = join(SEALOS_DIR, 'auth.json')

function kubeconfigField(kubeconfig: string, field: string): string | undefined {
  const m = kubeconfig.match(new RegExp(`^\\s*${field}:\\s*["']?([^"'\\s]+)`, 'm'))
  return m?.[1]
}

export function readKubeconfigText(): string {
  return readFileSync(KUBECONFIG_PATH, 'utf8')
}

export function loadAuthJson(): Record<string, unknown> {
  try {
    return JSON.parse(readFileSync(AUTH_PATH, 'utf8'))
  } catch {
    return {}
  }
}

export function getStatus(): SealosStatus {
  if (!existsSync(KUBECONFIG_PATH)) return { authenticated: false }
  const kc = readFileSync(KUBECONFIG_PATH, 'utf8')
  const server = kubeconfigField(kc, 'server')
  const hasCredential = kc.includes('token:') || kc.includes('client-certificate')
  if (!server || !hasCredential) return { authenticated: false }
  const auth = loadAuthJson()
  const workspace = auth['current_workspace'] as { id?: string; teamName?: string } | undefined
  return {
    authenticated: true,
    server,
    namespace: kubeconfigField(kc, 'namespace'),
    regionDomain: new URL(server).hostname ?? undefined,
    workspace: workspace?.id,
    workspaceName: workspace?.teamName,
    authenticatedAt: auth['authenticated_at'] as string | undefined,
    kubeconfigPath: KUBECONFIG_PATH
  }
}

export async function saveKubeconfigText(text: string): Promise<SealosStatus> {
  const server = kubeconfigField(text, 'server')
  const hasCredential = text.includes('token:') || text.includes('client-certificate')
  if (!server || !hasCredential) {
    throw new Error('这不是有效的 Sealos kubeconfig（缺少 server 或凭证字段）')
  }
  await fs.mkdir(SEALOS_DIR, { recursive: true })
  await fs.writeFile(KUBECONFIG_PATH, text, { mode: 0o600 })
  await fs.chmod(KUBECONFIG_PATH, 0o600)
  return getStatus()
}

export async function logout(): Promise<void> {
  await fs.rm(KUBECONFIG_PATH, { force: true })
  await fs.rm(AUTH_PATH, { force: true })
}

/** 当前工作空间被重命名后同步 auth.json 里的展示名 */
export async function setCurrentWorkspaceName(teamName: string): Promise<void> {
  const auth = loadAuthJson()
  const workspace = auth.current_workspace as { teamName?: string } | undefined
  if (!workspace) return
  workspace.teamName = teamName
  await fs.writeFile(AUTH_PATH, JSON.stringify(auth, null, 2), { mode: 0o600 })
  await fs.chmod(AUTH_PATH, 0o600)
}

interface HttpResult {
  status: number
  body: unknown
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined
}

function stringField(value: unknown, key: string): string | undefined {
  const result = record(value)?.[key]
  return typeof result === 'string' && result ? result : undefined
}

/**
 * Sealos auth endpoints use HTTP 200 for both success and failures. The
 * actual status is carried in the envelope's numeric `code` field (for
 * example, `{ code: 401, message: 'token verify error' }`).
 */
export function responseStatus(response: { status: number; body: unknown }): number {
  const code = record(response.body)?.code
  if (typeof code === 'number' && code >= 400) return code
  if (typeof code === 'string' && /^\d+$/.test(code) && Number(code) >= 400) {
    return Number(code)
  }
  return response.status
}

export function responseMessage(body: unknown): string | undefined {
  const root = record(body)
  const data = record(root?.data)
  for (const value of [root?.message, root?.error, data?.message, data?.error]) {
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
  return undefined
}

/** 不同区域版本曾使用 camelCase 和 snake_case 两种应用 token 字段名。 */
function appTokenFrom(body: unknown): string | undefined {
  const root = record(body)
  const data = record(root?.data)
  return (
    stringField(data, 'appToken') ??
    stringField(data, 'app_token') ??
    stringField(root, 'appToken') ??
    stringField(root, 'app_token')
  )
}

async function postForm(url: string, form: Record<string, string>): Promise<HttpResult> {
  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(form).toString(),
    signal: AbortSignal.timeout(30_000)
  })
  return { status: resp.status, body: await parseBody(resp) }
}

export async function requestJson(
  url: string,
  init: { method?: string; token?: string; json?: unknown; timeoutMs?: number } = {}
): Promise<HttpResult> {
  const headers: Record<string, string> = {}
  if (init.token) headers.Authorization = init.token
  if (init.json !== undefined) headers['Content-Type'] = 'application/json'
  const resp = await fetch(url, {
    method: init.method ?? 'GET',
    headers,
    body: init.json !== undefined ? JSON.stringify(init.json) : undefined,
    signal: AbortSignal.timeout(init.timeoutMs ?? 30_000)
  })
  return { status: resp.status, body: await parseBody(resp) }
}

async function parseBody(resp: Response): Promise<unknown> {
  const text = await resp.text()
  try {
    return JSON.parse(text)
  } catch {
    return text
  }
}

interface LoginSession {
  cancelled: boolean
}

let currentLogin: LoginSession | null = null

export function cancelLogin(): void {
  if (currentLogin) currentLogin.cancelled = true
}

function sleep(ms: number, session: LoginSession): Promise<void> {
  return new Promise((resolve) => {
    const start = Date.now()
    const tick = (): void => {
      if (session.cancelled || Date.now() - start >= ms) resolve()
      else setTimeout(tick, 250)
    }
    tick()
  })
}

export async function saveCredentials(
  region: string,
  accessToken: string | undefined,
  regionalToken: string,
  kubeconfig: string,
  workspace: { uid?: string; id?: string; teamName?: string } | null,
  appToken?: string
): Promise<void> {
  await fs.mkdir(SEALOS_DIR, { recursive: true })
  await fs.writeFile(KUBECONFIG_PATH, kubeconfig, { mode: 0o600 })
  await fs.chmod(KUBECONFIG_PATH, 0o600)
  const auth: Record<string, unknown> = {
    region,
    access_token: accessToken,
    regional_token: regionalToken,
    // desktop 发给 iframe 应用的会话 token（internalJwtSecret 签名），
    // aiproxy-web 等应用后端只认它，与 regional_token 不互通。
    app_token: appToken,
    authenticated_at: new Date().toISOString().replace(/\.\d+Z$/, 'Z'),
    auth_method: 'oauth2_device_grant'
  }
  if (workspace) auth.current_workspace = workspace
  await fs.writeFile(AUTH_PATH, JSON.stringify(auth, null, 2), { mode: 0o600 })
  await fs.chmod(AUTH_PATH, 0o600)
}

/**
 * 取应用会话 token；auth.json 里没有（旧登录态）时优先用 OAuth token
 * 重放 regionToken，必要时再用 regional_token 重放 namespace/switch。
 */
export async function ensureAppToken(): Promise<string> {
  const auth = loadAuthJson()
  const existing = auth.app_token
  if (typeof existing === 'string' && existing) return existing

  const region = typeof auth.region === 'string' ? auth.region : undefined
  const regionalToken = typeof auth.regional_token === 'string' ? auth.regional_token : undefined
  const workspace = auth.current_workspace as { uid?: string } | undefined
  if (!region || !regionalToken || !workspace?.uid) {
    throw new Error('当前登录态没有会话 token（可能是直接粘贴的 kubeconfig）。请退出后用账号登录。')
  }

  // AI Proxy 新版 token 通常会随 regionToken 返回。旧登录态仍保留
  // access_token 时，先无交互地重放一次，避免强制用户重新登录。
  const accessToken = typeof auth.access_token === 'string' ? auth.access_token : undefined
  if (accessToken) {
    try {
      const regionResp = await requestJson(`${region}/api/auth/regionToken`, {
        method: 'POST',
        token: accessToken
      })
      const regionData = record(record(regionResp.body)?.data)
      const refreshedAppToken = appTokenFrom(regionResp.body)
      const refreshedRegionalToken = stringField(regionData, 'token')
      const refreshedKubeconfig = stringField(regionData, 'kubeconfig')
      if (responseStatus(regionResp) === 200 && refreshedAppToken) {
        auth.app_token = refreshedAppToken
        if (refreshedRegionalToken) auth.regional_token = refreshedRegionalToken
        if (refreshedKubeconfig) {
          await fs.writeFile(KUBECONFIG_PATH, refreshedKubeconfig, { mode: 0o600 })
          await fs.chmod(KUBECONFIG_PATH, 0o600)
        }
        await fs.writeFile(AUTH_PATH, JSON.stringify(auth, null, 2), { mode: 0o600 })
        await fs.chmod(AUTH_PATH, 0o600)
        return refreshedAppToken
      }
    } catch {
      // access_token 可能已经过期；继续尝试使用仍有效的 regional_token。
    }
  }

  // 某些旧区域只在 namespace/switch 响应里返回 appToken。
  const resp = await requestJson(`${region}/api/auth/namespace/switch`, {
    method: 'POST',
    token: regionalToken,
    json: { ns_uid: workspace.uid }
  })
  const data = record(resp.body)?.data
  const switchedAppToken = appTokenFrom(resp.body)
  const status = responseStatus(resp)
  if (status === 401) throw new Error('会话已过期，请退出登录后重新登录')
  if (status !== 200 || !switchedAppToken) {
    const detail = responseMessage(resp.body)
    throw new Error(
      `应用会话 token 换发失败（HTTP ${status}${detail ? `：${detail}` : ''}，响应缺少 appToken）。请退出后重新使用 Sealos 账号登录。`
    )
  }

  auth.app_token = switchedAppToken
  // switch 同时会轮换 regional token，一并更新避免旧 token 提前失效
  const switchedRegionalToken = stringField(data, 'token')
  if (switchedRegionalToken) auth.regional_token = switchedRegionalToken
  await fs.writeFile(AUTH_PATH, JSON.stringify(auth, null, 2), { mode: 0o600 })
  await fs.chmod(AUTH_PATH, 0o600)
  return switchedAppToken
}

/** app token 失效（401/500）时清掉缓存，下次重新换发 */
export async function invalidateAppToken(): Promise<void> {
  const auth = loadAuthJson()
  if (auth.app_token === undefined) return
  delete auth.app_token
  await fs.writeFile(AUTH_PATH, JSON.stringify(auth, null, 2), { mode: 0o600 })
  await fs.chmod(AUTH_PATH, 0o600)
}

export async function startDeviceLogin(
  regionInput: string | undefined,
  onEvent: (event: LoginEvent) => void
): Promise<void> {
  cancelLogin()
  const session: LoginSession = { cancelled: false }
  currentLogin = session
  const region = (regionInput || DEFAULT_REGION).replace(/\/+$/, '')

  const emit = (event: LoginEvent): void => {
    if (!session.cancelled) onEvent(event)
  }

  try {
    const { status, body } = await postForm(`${region}/api/auth/oauth2/device`, {
      client_id: CLIENT_ID,
      grant_type: DEVICE_GRANT
    })
    const device = body as {
      device_code?: string
      user_code?: string
      verification_uri?: string
      verification_uri_complete?: string
      expires_in?: number
      interval?: number
    }
    if (status !== 200 || !device?.device_code) {
      throw new Error(`设备授权请求失败（HTTP ${status}）`)
    }

    const verificationUrl = device.verification_uri_complete || device.verification_uri || ''
    const expiresInSec = Number(device.expires_in ?? 600)
    let intervalSec = Number(device.interval ?? 5)
    emit({
      type: 'device_code',
      verificationUrl,
      userCode: device.user_code ?? '',
      expiresInSec
    })

    const deadline = Date.now() + Math.min(expiresInSec, 600) * 1000
    let accessToken: string | null = null
    while (Date.now() < deadline && !session.cancelled) {
      await sleep(intervalSec * 1000, session)
      if (session.cancelled) return
      emit({ type: 'polling' })
      const poll = await postForm(`${region}/api/auth/oauth2/token`, {
        client_id: CLIENT_ID,
        grant_type: DEVICE_GRANT,
        device_code: device.device_code
      })
      const resp = poll.body as { access_token?: string; error?: string }
      if (poll.status === 200 && resp?.access_token) {
        accessToken = resp.access_token
        break
      }
      switch (resp?.error) {
        case 'authorization_pending':
          continue
        case 'slow_down':
          intervalSec += 5
          continue
        case 'access_denied':
          throw new Error('你在浏览器里拒绝了授权')
        case 'expired_token':
          throw new Error('授权码已过期，请重新登录')
        default:
          throw new Error(`获取 token 失败（HTTP ${poll.status}）`)
      }
    }
    if (session.cancelled) return
    if (!accessToken) throw new Error('授权超时，请重新登录')

    emit({ type: 'exchanging' })
    const regionResp = await requestJson(`${region}/api/auth/regionToken`, {
      method: 'POST',
      token: accessToken
    })
    const regionData = record(record(regionResp.body)?.data)
    const appToken = appTokenFrom(regionResp.body)
    const regionToken = stringField(regionData, 'token')
    const kubeconfig = stringField(regionData, 'kubeconfig')
    const regionStatus = responseStatus(regionResp)
    if (regionStatus !== 200 || !regionToken || !kubeconfig) {
      const detail = responseMessage(regionResp.body)
      throw new Error(`区域 token 交换失败（HTTP ${regionStatus}${detail ? `：${detail}` : ''}）`)
    }

    let workspace: { uid?: string; id?: string; teamName?: string } | null = null
    const nsResp = await requestJson(`${region}/api/auth/namespace/list`, {
      token: regionToken
    })
    if (responseStatus(nsResp) === 200) {
      const raw = (nsResp.body as { data?: unknown })?.data
      const namespaces = (
        Array.isArray(raw) ? raw : ((raw as { namespaces?: unknown[] })?.namespaces ?? [])
      ) as Array<{ uid?: string; id?: string; teamName?: string; nstype?: string | number }>
      const chosen =
        namespaces.find((ns) => ns.nstype === 'private' || ns.nstype === 1) ?? namespaces[0]
      if (chosen) {
        workspace = { uid: chosen.uid, id: chosen.id, teamName: chosen.teamName }
      }
    }

    await saveCredentials(region, accessToken, regionToken, kubeconfig, workspace, appToken)
    emit({ type: 'success', status: getStatus() })
  } catch (err) {
    emit({ type: 'error', message: err instanceof Error ? err.message : String(err) })
  } finally {
    if (currentLogin === session) currentLogin = null
  }
}
