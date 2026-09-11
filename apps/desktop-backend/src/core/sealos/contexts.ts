import { promises as fs } from 'fs'
import { existsSync, readFileSync } from 'fs'
import { isAbsolute, join, relative, resolve } from 'path'
import {
  appTokenFrom,
  KUBECONFIG_PATH,
  loadAuthJson,
  requestJson,
  responseStatus,
  SEALOS_DIR
} from './auth'

/**
 * 同一站点里已初始化可用区的工作空间凭证档案。
 * 落在 `~/.sealos/{区域host}/{空间uid}/`；顶层 kubeconfig / auth.json 仍是正在用的那一套。
 */

export interface ContextWorkspace {
  uid: string
  id: string
  teamName?: string
}

export interface ContextSession {
  region: string
  regional_token: string
  app_token?: string
  workspace: ContextWorkspace
}

interface LiveSnapshot {
  region: string
  regionalToken: string
  appToken?: string
  kubeconfig: string
  workspace: { uid?: string; id?: string; teamName?: string }
}

interface ListedNamespace {
  uid: string
  id: string
  teamName?: string
  nstype?: unknown
}

let contextGeneration = 0

export function bumpContextGeneration(): number {
  contextGeneration += 1
  return contextGeneration
}

function aborted(generation: number): boolean {
  return generation !== contextGeneration
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

function kubeconfigField(kubeconfig: string, field: string): string | undefined {
  const m = kubeconfig.match(new RegExp(`^\\s*${field}:\\s*["']?([^"'\\s]+)`, 'm'))
  return m?.[1]
}

function isPrivateNs(nstype: unknown): boolean {
  return nstype === 1 || String(nstype).toLowerCase() === 'private'
}

function originFromDomain(domain: string): string | undefined {
  const raw = domain.trim()
  if (!raw) return undefined
  try {
    const url = raw.includes('://') ? new URL(raw) : new URL(`https://${raw}`)
    if (!url.hostname) return undefined
    return `https://${url.hostname}`
  } catch {
    return undefined
  }
}

function normalizeOrigin(regionUrl: string): string {
  const url = new URL(regionUrl)
  return `https://${url.hostname}`
}

function assertSafeSegment(value: string, label: string): void {
  if (!value || value.includes('/') || value.includes('..')) {
    throw new Error(`invalid context ${label}`)
  }
}

/** 区域档案目录名：必须像 host（带点），避免误删 kubeconfig 等顶层文件。 */
function isRegionHostDir(name: string): boolean {
  return /^[a-z0-9][a-z0-9.-]*\.[a-z0-9.-]+$/i.test(name)
}

export function contextDir(regionUrl: string, workspaceUid: string): string {
  const host = new URL(regionUrl).hostname
  assertSafeSegment(host, 'host')
  assertSafeSegment(workspaceUid, 'uid')
  if (!isRegionHostDir(host)) {
    throw new Error('invalid context host')
  }
  const root = resolve(SEALOS_DIR)
  const dir = resolve(join(root, host, workspaceUid))
  const rel = relative(root, dir)
  const parts = rel.split(/[/\\]/)
  if (!rel || rel.startsWith('..') || isAbsolute(rel) || parts.length !== 2) {
    throw new Error('invalid context path')
  }
  return dir
}

function sessionPayload(session: ContextSession): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    region: normalizeOrigin(session.region),
    regional_token: session.regional_token,
    workspace: {
      uid: session.workspace.uid,
      id: session.workspace.id,
      teamName: session.workspace.teamName
    }
  }
  if (session.app_token) payload.app_token = session.app_token
  return payload
}

export async function writeContext(
  kubeconfig: string,
  session: ContextSession,
  generation?: number
): Promise<void> {
  if (generation !== undefined && aborted(generation)) return
  const dir = contextDir(session.region, session.workspace.uid)
  if (generation !== undefined && aborted(generation)) return
  await fs.mkdir(dir, { recursive: true })
  if (generation !== undefined && aborted(generation)) return
  const kubeconfigPath = join(dir, 'kubeconfig')
  const sessionPath = join(dir, 'session.json')
  await fs.writeFile(kubeconfigPath, kubeconfig, { mode: 0o600 })
  await fs.chmod(kubeconfigPath, 0o600)
  if (generation !== undefined && aborted(generation)) return
  await fs.writeFile(sessionPath, JSON.stringify(sessionPayload(session), null, 2), { mode: 0o600 })
  await fs.chmod(sessionPath, 0o600)
}

export async function updateContextTeamName(
  region: string,
  workspaceUid: string,
  teamName: string
): Promise<void> {
  let dir: string
  try {
    dir = contextDir(region, workspaceUid)
  } catch {
    return
  }
  const sessionPath = join(dir, 'session.json')
  try {
    const session = record(JSON.parse(await fs.readFile(sessionPath, 'utf8')))
    const workspace = record(session?.workspace)
    if (!session || !workspace) return
    workspace.teamName = teamName
    session.workspace = workspace
    delete session.access_token
    await fs.writeFile(sessionPath, JSON.stringify(session, null, 2), { mode: 0o600 })
    await fs.chmod(sessionPath, 0o600)
  } catch {
    // 没有对应档案时忽略
  }
}

export async function clearContexts(): Promise<void> {
  let entries: { name: string; isDirectory(): boolean }[]
  try {
    entries = await fs.readdir(SEALOS_DIR, { withFileTypes: true })
  } catch {
    return
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    // `contexts` 是上一版包装目录，登出时一并清掉。
    if (entry.name === 'contexts' || isRegionHostDir(entry.name)) {
      await fs.rm(join(SEALOS_DIR, entry.name), { recursive: true, force: true })
    }
  }
}

function snapshotLive(): LiveSnapshot | undefined {
  const auth = loadAuthJson()
  const region = typeof auth.region === 'string' ? auth.region : undefined
  const regionalToken = typeof auth.regional_token === 'string' ? auth.regional_token : undefined
  const accessToken = typeof auth.access_token === 'string' ? auth.access_token : undefined
  if (!region || !regionalToken || !accessToken) return undefined
  if (!existsSync(KUBECONFIG_PATH)) return undefined
  const kubeconfig = readFileSync(KUBECONFIG_PATH, 'utf8')
  const workspace = (auth.current_workspace ?? {}) as {
    uid?: string
    id?: string
    teamName?: string
  }
  return {
    region,
    regionalToken,
    appToken: typeof auth.app_token === 'string' ? auth.app_token : undefined,
    kubeconfig,
    workspace
  }
}

function parseNamespaces(body: unknown): ListedNamespace[] {
  const data = record(body)?.data
  const raw = Array.isArray(data) ? data : record(data)?.namespaces
  if (!Array.isArray(raw)) return []
  const out: ListedNamespace[] = []
  for (const item of raw) {
    const uid = stringField(item, 'uid')
    const id = stringField(item, 'id')
    if (!uid || !id) continue
    const row = item as { teamName?: string; nstype?: unknown }
    out.push({ uid, id, teamName: row.teamName, nstype: row.nstype })
  }
  return out
}

function parseRegionList(body: unknown): string[] {
  const list = record(record(body)?.data)?.regionList
  if (!Array.isArray(list)) return []
  const origins: string[] = []
  const seen = new Set<string>()
  for (const item of list) {
    const domain = stringField(item, 'domain')
    if (!domain) continue
    const origin = originFromDomain(domain)
    if (!origin) continue
    const host = new URL(origin).hostname
    if (seen.has(host)) continue
    seen.add(host)
    origins.push(origin)
  }
  return origins
}

function defaultWorkspaceUid(namespaces: ListedNamespace[], kubeconfig: string): string | undefined {
  const nsName = kubeconfigField(kubeconfig, 'namespace')
  const byId = nsName ? namespaces.find((ns) => ns.id === nsName) : undefined
  if (byId) return byId.uid
  const priv = namespaces.find((ns) => isPrivateNs(ns.nstype))
  return priv?.uid ?? namespaces[0]?.uid
}

async function listNamespaces(origin: string, regionalToken: string): Promise<ListedNamespace[]> {
  const resp = await requestJson(`${origin}/api/auth/namespace/list`, { token: regionalToken })
  if (responseStatus(resp) !== 200) return []
  return parseNamespaces(resp.body)
}

async function fetchWorkspaceArchive(
  origin: string,
  regionalToken: string,
  ns: ListedNamespace
): Promise<{ kubeconfig: string; regionalToken: string; appToken?: string } | undefined> {
  const switchResp = await requestJson(`${origin}/api/auth/namespace/switch`, {
    method: 'POST',
    token: regionalToken,
    json: { ns_uid: ns.uid }
  })
  const switchData = record(record(switchResp.body)?.data)
  const newToken = stringField(switchData, 'token')
  if (responseStatus(switchResp) !== 200 || !newToken) return undefined
  const kcResp = await requestJson(`${origin}/api/auth/getKubeconfig`, { token: newToken })
  const kubeconfig = stringField(record(record(kcResp.body)?.data), 'kubeconfig')
  if (responseStatus(kcResp) !== 200 || !kubeconfig) return undefined
  return {
    kubeconfig,
    regionalToken: newToken,
    appToken: appTokenFrom(switchResp.body)
  }
}

async function archiveWorkspaces(
  origin: string,
  regionalToken: string,
  appToken: string | undefined,
  kubeconfig: string,
  namespaces: ListedNamespace[],
  liveUid: string | undefined,
  generation: number
): Promise<void> {
  const defaultUid = liveUid ?? defaultWorkspaceUid(namespaces, kubeconfig)
  for (const ns of namespaces) {
    if (aborted(generation)) return
    try {
      if (ns.uid === defaultUid) {
        await writeContext(
          kubeconfig,
          {
            region: origin,
            regional_token: regionalToken,
            app_token: appToken,
            workspace: { uid: ns.uid, id: ns.id, teamName: ns.teamName }
          },
          generation
        )
        continue
      }
      const switched = await fetchWorkspaceArchive(origin, regionalToken, ns)
      if (!switched || aborted(generation)) continue
      await writeContext(
        switched.kubeconfig,
        {
          region: origin,
          regional_token: switched.regionalToken,
          app_token: switched.appToken,
          workspace: { uid: ns.uid, id: ns.id, teamName: ns.teamName }
        },
        generation
      )
    } catch {
      // 单个工作空间失败不影响其余
    }
  }
}

async function prefetchCurrentRegion(snapshot: LiveSnapshot, generation: number): Promise<void> {
  const origin = normalizeOrigin(snapshot.region)
  const liveId = snapshot.workspace.id ?? kubeconfigField(snapshot.kubeconfig, 'namespace')
  if (snapshot.workspace.uid && liveId) {
    await writeContext(
      snapshot.kubeconfig,
      {
        region: origin,
        regional_token: snapshot.regionalToken,
        app_token: snapshot.appToken,
        workspace: {
          uid: snapshot.workspace.uid,
          id: liveId,
          teamName: snapshot.workspace.teamName
        }
      },
      generation
    )
  }
  if (aborted(generation)) return
  const namespaces = await listNamespaces(origin, snapshot.regionalToken)
  await archiveWorkspaces(
    origin,
    snapshot.regionalToken,
    snapshot.appToken,
    snapshot.kubeconfig,
    namespaces,
    snapshot.workspace.uid,
    generation
  )
}

async function prefetchOtherRegion(
  origin: string,
  globalToken: string,
  generation: number
): Promise<void> {
  const regionResp = await requestJson(`${origin}/api/auth/regionToken`, {
    method: 'POST',
    token: globalToken
  })
  const status = responseStatus(regionResp)
  if (status === 409) return
  const regionData = record(record(regionResp.body)?.data)
  const regionalToken = stringField(regionData, 'token')
  const kubeconfig = stringField(regionData, 'kubeconfig')
  if (status !== 200 || !regionalToken || !kubeconfig) return
  if (aborted(generation)) return
  const namespaces = await listNamespaces(origin, regionalToken)
  await archiveWorkspaces(
    origin,
    regionalToken,
    appTokenFrom(regionResp.body),
    kubeconfig,
    namespaces,
    undefined,
    generation
  )
}

async function runPrefetch(generation: number): Promise<void> {
  const snapshot = snapshotLive()
  if (!snapshot) return
  await prefetchCurrentRegion(snapshot, generation)
  if (aborted(generation)) return

  const listResp = await requestJson(`${snapshot.region}/api/auth/regionList`, {
    token: snapshot.regionalToken
  })
  if (responseStatus(listResp) !== 200) return
  const origins = parseRegionList(listResp.body)
  const currentHost = new URL(snapshot.region).hostname

  // GET /api/auth/globalToken 校验区域 JWT（verifyAccessToken），不是 OAuth access_token。
  let globalToken: string | undefined
  try {
    const tokenResp = await requestJson(`${snapshot.region}/api/auth/globalToken`, {
      token: snapshot.regionalToken
    })
    if (responseStatus(tokenResp) === 200) {
      globalToken = stringField(record(record(tokenResp.body)?.data), 'token')
    }
  } catch {
    globalToken = undefined
  }
  if (aborted(generation)) return

  for (const origin of origins) {
    if (aborted(generation)) return
    const host = new URL(origin).hostname
    if (host === currentHost) continue
    if (!globalToken) break
    try {
      await prefetchOtherRegion(origin, globalToken, generation)
    } catch {
      // 单个可用区失败不影响其余
    }
  }
}

/** 登录成功后后台预拉。失败不抛错、不改 live slot。 */
export async function prefetchSiteContexts(): Promise<void> {
  const generation = bumpContextGeneration()
  try {
    await runPrefetch(generation)
  } catch {
    // 预拉失败不影响登录
  }
}
