import * as k8s from '@kubernetes/client-node'
import { getStatus, loadAuthJson, readKubeconfigText, KUBECONFIG_PATH } from './auth'
import { APP_LABEL, PROJECT_LABEL, listKubeBlocksClusters } from './resources'

const TIMEOUT_MS = 120_000
const NAME_RE = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/

type Action = 'delete' | 'restart' | 'pause' | 'start'
type Target = 'app' | 'project' | 'database'

function regionDomain(): string {
  const auth = loadAuthJson()
  const region = typeof auth.region === 'string' ? auth.region : undefined
  if (region) {
    try {
      const host = new URL(region).hostname
      if (host) return host
    } catch {
      // fall through to kubeconfig
    }
  }
  const fromStatus = getStatus().regionDomain
  if (fromStatus) return fromStatus
  throw new Error('没有区域信息，请重新登录')
}

function requireName(name: unknown): string {
  if (typeof name !== 'string') throw new Error('名称无效')
  const trimmed = name.trim()
  if (!trimmed || trimmed.length > 63 || !NAME_RE.test(trimmed)) throw new Error('名称无效')
  return trimmed
}

function isTimeout(err: unknown): boolean {
  if (!(err instanceof Error)) return false
  return err.name === 'TimeoutError' || err.name === 'AbortError'
}

async function readBody(resp: Response): Promise<unknown> {
  const text = await resp.text()
  if (!text) return ''
  try {
    return JSON.parse(text) as unknown
  } catch {
    return text
  }
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  return value as Record<string, unknown>
}

function v2Error(body: unknown): { code: string; message: string; details: string } {
  const err = asRecord(asRecord(body)?.error)
  const details = err?.details
  return {
    code: typeof err?.code === 'string' ? err.code : '',
    message: typeof err?.message === 'string' ? err.message : '',
    details: typeof details === 'string' ? details : ''
  }
}

function failMsg(action: Action): string {
  switch (action) {
    case 'delete':
      return '删除失败'
    case 'restart':
      return '重启失败'
    case 'pause':
      return '暂停失败'
    case 'start':
      return '启动失败'
  }
}

function timeoutMsg(action: Action): string {
  switch (action) {
    case 'delete':
      return '删除超时'
    case 'restart':
      return '重启超时'
    case 'pause':
      return '暂停超时'
    case 'start':
      return '启动超时'
  }
}

function mapOperateError(status: number, body: unknown, action: Action, target: Target): Error {
  const { code, message, details } = v2Error(body)
  const blob = `${code} ${message} ${details}`.toLowerCase()

  if (status === 401 || code === 'AUTHENTICATION_REQUIRED') {
    return new Error('登录已失效，请重新登录')
  }
  if (code === 'INSUFFICIENT_BALANCE' || blob.includes('balance') || blob.includes('余额')) {
    return new Error('余额不足')
  }
  if (code === 'PERMISSION_DENIED' || status === 403) {
    return new Error('没有权限')
  }
  if (code === 'NOT_FOUND' || status === 404) {
    if (target === 'project') return new Error('项目不存在')
    if (target === 'database') return new Error('数据库不存在')
    return new Error('应用不存在')
  }
  if (blob.includes('quota') || blob.includes('exceeded') || blob.includes('配额')) {
    return new Error('配额不足')
  }
  if (status === 400 || code === 'INVALID_PARAMETER') {
    return new Error('名称无效')
  }
  if (status === 503 || code === 'SERVICE_UNAVAILABLE') {
    return new Error('服务暂时不可用')
  }
  return new Error(failMsg(action))
}

async function request(
  url: string,
  method: 'DELETE' | 'POST',
  action: Action
): Promise<{ status: number; body: unknown }> {
  const kubeconfig = readKubeconfigText()
  let resp: Response
  try {
    resp = await fetch(url, {
      method,
      headers: {
        Authorization: encodeURIComponent(kubeconfig),
        accept: 'application/json'
      },
      signal: AbortSignal.timeout(TIMEOUT_MS)
    })
  } catch (err) {
    if (isTimeout(err)) throw new Error(timeoutMsg(action))
    throw new Error(failMsg(action))
  }
  return { status: resp.status, body: await readBody(resp) }
}

function appUrl(name: string, suffix = ''): string {
  return `https://applaunchpad.${regionDomain()}/api/v2alpha/apps/${encodeURIComponent(name)}${suffix}`
}

function dbUrl(name: string, suffix: string): string {
  return `https://dbprovider.${regionDomain()}/api/v2alpha/databases/${encodeURIComponent(name)}${suffix}`
}

function isSuccess(status: number): boolean {
  return status === 204 || status === 200
}

export async function deleteApp(name: string): Promise<void> {
  const appName = requireName(name)
  const { status, body } = await request(appUrl(appName), 'DELETE', 'delete')
  if (isSuccess(status) || status === 404) return
  throw mapOperateError(status, body, 'delete', 'app')
}

export async function restartApp(name: string): Promise<void> {
  const appName = requireName(name)
  const { status, body } = await request(appUrl(appName, '/restart'), 'POST', 'restart')
  if (isSuccess(status)) return
  throw mapOperateError(status, body, 'restart', 'app')
}

export async function pauseApp(name: string): Promise<void> {
  const appName = requireName(name)
  const { status, body } = await request(appUrl(appName, '/pause'), 'POST', 'pause')
  if (isSuccess(status)) return
  throw mapOperateError(status, body, 'pause', 'app')
}

export async function startApp(name: string): Promise<void> {
  const appName = requireName(name)
  const { status, body } = await request(appUrl(appName, '/start'), 'POST', 'start')
  if (isSuccess(status)) return
  throw mapOperateError(status, body, 'start', 'app')
}

export async function deleteProject(name: string): Promise<void> {
  const instanceName = requireName(name)
  const url = `https://template.${regionDomain()}/api/v2alpha/templates/instances/${encodeURIComponent(instanceName)}`
  const { status, body } = await request(url, 'DELETE', 'delete')
  if (isSuccess(status) || status === 404) return
  throw mapOperateError(status, body, 'delete', 'project')
}

function loadNamespace(): { kc: k8s.KubeConfig; namespace: string } {
  const kc = new k8s.KubeConfig()
  kc.loadFromFile(KUBECONFIG_PATH)
  const namespace = kc.getContextObject(kc.getCurrentContext())?.namespace
  if (!namespace) throw new Error('kubeconfig 里没有 namespace，无法确定工作空间')
  return { kc, namespace }
}

function mapK8sListError(err: unknown): Error {
  const code = (err as { code?: number }).code
  if (code === 401) return new Error('登录已失效，请重新登录')
  if (code === 403) return new Error('没有权限')
  return new Error('无法列出项目组件')
}

async function pauseDatabase(name: string): Promise<void> {
  const dbName = requireName(name)
  const { status, body } = await request(dbUrl(dbName, '/pause'), 'POST', 'pause')
  if (isSuccess(status)) return
  throw mapOperateError(status, body, 'pause', 'database')
}

async function startDatabase(name: string): Promise<void> {
  const dbName = requireName(name)
  const { status, body } = await request(dbUrl(dbName, '/start'), 'POST', 'start')
  if (isSuccess(status)) return
  throw mapOperateError(status, body, 'start', 'database')
}

async function restartDatabase(name: string): Promise<void> {
  const dbName = requireName(name)
  const { status, body } = await request(dbUrl(dbName, '/restart'), 'POST', 'restart')
  if (isSuccess(status)) return
  throw mapOperateError(status, body, 'restart', 'database')
}

/** 当前 ns 里同时带项目归属标签和 Launchpad 标签的 Deployment / StatefulSet 名 */
async function listLaunchpadAppNames(instanceName: string): Promise<string[]> {
  const { kc, namespace } = loadNamespace()
  const apps = kc.makeApiClient(k8s.AppsV1Api)
  const labelSelector = `${PROJECT_LABEL}=${instanceName},${APP_LABEL}`
  try {
    const [deployments, statefulSets] = await Promise.all([
      apps.listNamespacedDeployment({ namespace, labelSelector }),
      apps.listNamespacedStatefulSet({ namespace, labelSelector })
    ])
    const names = new Set<string>()
    for (const deploy of deployments.items ?? []) {
      const n = deploy.metadata?.name
      if (n) names.add(n)
    }
    for (const sts of statefulSets.items ?? []) {
      if (sts.metadata?.labels?.['app.kubernetes.io/managed-by'] === 'kubeblocks') continue
      const n = sts.metadata?.name
      if (n) names.add(n)
    }
    return [...names].sort((a, b) => a.localeCompare(b))
  } catch (err) {
    throw mapK8sListError(err)
  }
}

async function listProjectDatabases(
  instanceName: string
): Promise<Array<{ name: string; phase: string }>> {
  const { kc, namespace } = loadNamespace()
  try {
    const clusters = await listKubeBlocksClusters(
      kc,
      namespace,
      `${PROJECT_LABEL}=${instanceName}`
    )
    const out: Array<{ name: string; phase: string }> = []
    for (const cluster of clusters ?? []) {
      const n = cluster.metadata?.name
      if (n) out.push({ name: n, phase: cluster.status?.phase ?? '' })
    }
    return out.sort((a, b) => a.name.localeCompare(b.name))
  } catch (err) {
    throw mapK8sListError(err)
  }
}

async function runEach(
  names: string[],
  action: (name: string) => Promise<void>
): Promise<string[]> {
  const failures: string[] = []
  for (const name of names) {
    try {
      await action(name)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      failures.push(`${name}（${msg}）`)
    }
  }
  return failures
}

function throwIfFailed(verb: string, failures: string[]): void {
  if (failures.length > 0) throw new Error(`以下组件${verb}失败：${failures.join('；')}`)
}

function dbPhaseStopped(phase: string): boolean {
  return phase === 'Stopped' || phase === 'Stopping'
}

function dbPhaseRunning(phase: string): boolean {
  return phase === 'Running' || phase === 'Starting'
}

export async function restartProject(name: string): Promise<void> {
  const instanceName = requireName(name)
  const [apps, databases] = await Promise.all([
    listLaunchpadAppNames(instanceName),
    listProjectDatabases(instanceName)
  ])
  const dbNames = databases.filter((db) => !dbPhaseStopped(db.phase)).map((db) => db.name)
  const failures = [
    ...(await runEach(apps, restartApp)),
    ...(await runEach(dbNames, restartDatabase))
  ]
  throwIfFailed('重启', failures)
}

export async function pauseProject(name: string): Promise<void> {
  const instanceName = requireName(name)
  const [apps, databases] = await Promise.all([
    listLaunchpadAppNames(instanceName),
    listProjectDatabases(instanceName)
  ])
  const dbNames = databases.filter((db) => !dbPhaseStopped(db.phase)).map((db) => db.name)
  const failures = [
    ...(await runEach(apps, pauseApp)),
    ...(await runEach(dbNames, pauseDatabase))
  ]
  throwIfFailed('暂停', failures)
}

export async function startProject(name: string): Promise<void> {
  const instanceName = requireName(name)
  const [apps, databases] = await Promise.all([
    listLaunchpadAppNames(instanceName),
    listProjectDatabases(instanceName)
  ])
  const dbNames = databases.filter((db) => !dbPhaseRunning(db.phase)).map((db) => db.name)
  const failures = [
    ...(await runEach(dbNames, startDatabase)),
    ...(await runEach(apps, startApp))
  ]
  throwIfFailed('启动', failures)
}
