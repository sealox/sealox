import * as k8s from '@kubernetes/client-node'
import type { CoreV1Event, V1Deployment, V1StatefulSet } from '@kubernetes/client-node'
import type {
  DatabaseConnection,
  DatabaseInstanceDetail,
  DatabaseMonitor,
  DatabaseSchemaTree,
  DatabaseUsedBy,
  EventInfo,
  MonitorSeries
} from '../../shared/types'
import { getStatus, loadAuthJson, readKubeconfigText, KUBECONFIG_PATH } from './auth'
import { eventTime, podDetail, toEventInfo } from './details'
import {
  databaseFromCluster,
  workloadFromDeployment,
  workloadFromStatefulSet,
  type KubeBlocksCluster
} from './resources'
import { workloadUsesDatabase } from './topology'

const DETAIL_TIMEOUT_MS = 15_000
const MUTATE_TIMEOUT_MS = 120_000
const NAME_RE = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/
const SCHEMA_ENGINES = new Set(['postgresql', 'mysql', 'apecloud-mysql', 'mongodb'])
const INSTANCE_LABEL = 'app.kubernetes.io/instance'

type DbAction = 'read' | 'schema' | 'monitor' | 'public'

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

function failMsg(action: DbAction): string {
  switch (action) {
    case 'read':
      return '读取数据库失败'
    case 'schema':
      return '暂时无法列出表结构'
    case 'monitor':
      return '监控数据不可用'
    case 'public':
      return '该动作失败'
  }
}

function timeoutMsg(action: DbAction): string {
  switch (action) {
    case 'read':
      return '读取数据库超时'
    case 'schema':
      return '列出表结构超时'
    case 'monitor':
      return '读取监控超时'
    case 'public':
      return '该动作超时'
  }
}

function mapDbError(status: number, body: unknown, action: DbAction): Error {
  const { code } = v2Error(body)

  if (status === 401 || code === 'AUTHENTICATION_REQUIRED') {
    return new Error('登录已失效，请重新登录')
  }
  if (code === 'PERMISSION_DENIED' || status === 403) {
    return new Error('没有权限')
  }
  if (code === 'NOT_FOUND' || status === 404) {
    return new Error('数据库不存在')
  }
  if (status === 503 || code === 'SERVICE_UNAVAILABLE') {
    return new Error('服务暂时不可用')
  }
  return new Error(failMsg(action))
}

async function dbFetch(
  url: string,
  init: RequestInit,
  action: DbAction,
  timeoutMs: number
): Promise<{ status: number; body: unknown }> {
  const kubeconfig = readKubeconfigText()
  let resp: Response
  try {
    resp = await fetch(url, {
      ...init,
      headers: {
        Authorization: encodeURIComponent(kubeconfig),
        accept: 'application/json',
        ...(init.headers ?? {})
      },
      signal: AbortSignal.timeout(timeoutMs)
    })
  } catch (err) {
    if (isTimeout(err)) throw new Error(timeoutMsg(action))
    throw new Error(failMsg(action))
  }
  return { status: resp.status, body: await readBody(resp) }
}

function dbBase(): string {
  return `https://dbprovider.${regionDomain()}`
}

function loadNamespace(): { kc: k8s.KubeConfig; namespace: string } {
  const kc = new k8s.KubeConfig()
  kc.loadFromFile(KUBECONFIG_PATH)
  const namespace = kc.getContextObject(kc.getCurrentContext())?.namespace
  if (!namespace) throw new Error('kubeconfig 里没有 namespace，无法确定工作空间')
  return { kc, namespace }
}

function isNotFound(err: unknown): boolean {
  return (err as { code?: number }).code === 404
}

async function readCluster(name: string): Promise<KubeBlocksCluster | null> {
  const { kc, namespace } = loadNamespace()
  const custom = kc.makeApiClient(k8s.CustomObjectsApi)
  for (const version of ['v1alpha1', 'v1']) {
    try {
      return (await custom.getNamespacedCustomObject({
        group: 'apps.kubeblocks.io',
        version,
        namespace,
        plural: 'clusters',
        name
      })) as KubeBlocksCluster
    } catch (err) {
      if (isNotFound(err)) continue
      throw err
    }
  }
  return null
}

function capitalizePhase(status: string): string {
  if (!status) return 'Unknown'
  return status.charAt(0).toUpperCase() + status.slice(1)
}

/** 与 Sealos dbprovider `resolveDbTypeVersion` 同一口径，供 schema/monitor 的 dbType */
function resolveEngine(cluster: KubeBlocksCluster): string | undefined {
  const labels = cluster.metadata?.labels ?? {}
  const kbDatabase = labels['kb.io/database']
  if (kbDatabase) {
    if (kbDatabase.startsWith('ac-mysql')) return 'apecloud-mysql'
    const type = kbDatabase.split('-')[0]
    return type || undefined
  }
  const fromDef =
    cluster.spec?.clusterDefinitionRef ?? labels['clusterdefinition.kubeblocks.io/name']
  if (fromDef) return fromDef === 'mysql' ? 'apecloud-mysql' : fromDef
  const spec = cluster.spec?.componentSpecs?.[0] as
    | { componentDef?: string; componentDefRef?: string }
    | undefined
  const fromComp = spec?.componentDef ?? spec?.componentDefRef
  if (!fromComp) return undefined
  if (fromComp === 'mysql') return 'apecloud-mysql'
  if (fromComp.startsWith('mongodb')) return 'mongodb'
  if (fromComp.startsWith('redis')) return 'redis'
  if (fromComp.startsWith('postgresql')) return 'postgresql'
  return fromComp
}

function asNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim()) {
    const n = Number(value)
    if (Number.isFinite(n)) return n
  }
  return undefined
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

function parseConnectionObject(raw: unknown): DatabaseConnection | null {
  const rec = asRecord(raw)
  if (!rec) return null
  const host = asString(rec.host) ?? ''
  const port = rec.port == null ? '' : String(rec.port)
  const username = asString(rec.username) ?? ''
  const password = asString(rec.password) ?? ''
  const connectionString = asString(rec.connectionString) ?? ''
  const endpoint = asString(rec.endpoint)
  if (!host && !connectionString) return null
  return {
    host,
    port,
    username,
    password,
    endpoint: endpoint ?? (host && port ? `${host}:${port}` : host || undefined),
    connectionString
  }
}

function parseConnectionString(raw: string): DatabaseConnection | null {
  try {
    const url = new URL(raw)
    if (!url.hostname) return null
    return {
      host: url.hostname,
      port: url.port,
      username: decodeURIComponent(url.username),
      password: decodeURIComponent(url.password),
      endpoint: url.port ? `${url.hostname}:${url.port}` : url.hostname,
      connectionString: raw
    }
  } catch {
    return null
  }
}

function parsePublicConnection(raw: unknown): {
  enabled: boolean
  parsed: DatabaseConnection | null
  raw?: string
} {
  if (raw == null || raw === '') return { enabled: false, parsed: null }
  if (typeof raw === 'string') {
    return {
      enabled: true,
      parsed: parseConnectionString(raw),
      raw
    }
  }
  const parsed = parseConnectionObject(raw)
  if (parsed) return { enabled: true, parsed, raw: parsed.connectionString || undefined }
  return { enabled: false, parsed: null }
}

function eventsForDatabase(
  events: CoreV1Event[],
  dbName: string,
  podNames: Set<string>
): EventInfo[] {
  return events
    .filter((event) => {
      const involved = event.involvedObject
      if (!involved?.name) return false
      if (involved.name === dbName) return true
      if (podNames.has(involved.name)) return true
      return involved.name.startsWith(`${dbName}-`)
    })
    .sort((a, b) => eventTime(b) - eventTime(a))
    .slice(0, 30)
    .map(toEventInfo)
}

async function listUsedBy(dbName: string): Promise<DatabaseUsedBy[]> {
  const { kc, namespace } = loadNamespace()
  const apps = kc.makeApiClient(k8s.AppsV1Api)
  const core = kc.makeApiClient(k8s.CoreV1Api)
  const connSecret = `${dbName}-conn-credential`
  const [deployments, statefulSets, pods] = await Promise.all([
    apps.listNamespacedDeployment({ namespace }),
    apps.listNamespacedStatefulSet({ namespace }),
    core.listNamespacedPod({ namespace })
  ])
  const podItems = pods.items ?? []
  const used: DatabaseUsedBy[] = []

  for (const deploy of deployments.items ?? []) {
    const name = deploy.metadata?.name
    if (!name) continue
    if (!workloadUsesDatabase(deploy as V1Deployment, dbName, connSecret)) continue
    const workload = workloadFromDeployment(deploy, podItems, [])
    used.push({
      name: workload.name,
      kind: 'Deployment',
      status: workload.status,
      project: workload.project
    })
  }
  for (const sts of statefulSets.items ?? []) {
    const name = sts.metadata?.name
    if (!name) continue
    if (!workloadUsesDatabase(sts as V1StatefulSet, dbName, connSecret)) continue
    const workload = workloadFromStatefulSet(sts, podItems, [])
    if (!workload) continue
    used.push({
      name: workload.name,
      kind: 'StatefulSet',
      status: workload.status,
      project: workload.project
    })
  }
  return used.sort((a, b) => a.name.localeCompare(b.name))
}

export async function fetchDatabaseDetail(name: string): Promise<DatabaseInstanceDetail> {
  const dbName = requireName(name)
  const { status, body } = await dbFetch(
    `${dbBase()}/api/v2alpha/databases/${encodeURIComponent(dbName)}`,
    { method: 'GET' },
    'read',
    DETAIL_TIMEOUT_MS
  )
  if (status !== 200) throw mapDbError(status, body, 'read')
  const rec = asRecord(body)
  if (!rec) throw new Error('读取数据库失败')

  const { kc, namespace } = loadNamespace()
  const core = kc.makeApiClient(k8s.CoreV1Api)
  const [cluster, podList, eventList, usedBy] = await Promise.all([
    readCluster(dbName).catch(() => null),
    core
      .listNamespacedPod({ namespace, labelSelector: `${INSTANCE_LABEL}=${dbName}` })
      .catch(() => ({ items: [] })),
    core.listNamespacedEvent({ namespace }).catch(() => ({ items: [] })),
    listUsedBy(dbName).catch(() => [] as DatabaseUsedBy[])
  ])

  const info = cluster ? databaseFromCluster(cluster) : undefined
  const engine = asString(rec.type) ?? (cluster ? resolveEngine(cluster) : undefined) ?? info?.engine
  const quota = asRecord(rec.quota)
  const connectionWrap = asRecord(rec.connection)
  const privateConn = parseConnectionObject(connectionWrap?.privateConnection)
  const publicInfo = parsePublicConnection(connectionWrap?.publicConnection)
  const pods = (podList.items ?? []).map(podDetail)
  const podNames = new Set(pods.map((pod) => pod.name))

  const createdAt = cluster?.metadata?.creationTimestamp
    ? new Date(cluster.metadata.creationTimestamp).toISOString()
    : asString(rec.createdAt)

  return {
    name: asString(rec.name) ?? dbName,
    engine,
    version: asString(rec.version) ?? info?.version,
    phase: info?.phase || capitalizePhase(asString(rec.status) ?? ''),
    project: info?.project,
    cpu: asNumber(quota?.cpu),
    memory: asNumber(quota?.memory),
    storage: asNumber(quota?.storage),
    replicas: asNumber(quota?.replicas),
    createdAt,
    connection: privateConn,
    publicConnection: publicInfo.parsed,
    publicConnectionRaw: publicInfo.raw,
    publicEnabled: publicInfo.enabled,
    usedBy,
    pods,
    events: eventsForDatabase(eventList.items ?? [], dbName, podNames),
    fetchedAt: new Date().toISOString()
  }
}

function chartToSeries(result: unknown): MonitorSeries[] {
  const rec = asRecord(result)
  if (!rec) return []
  if (Array.isArray(rec.yData) && Array.isArray(rec.xData)) {
    const xData = rec.xData.map((t) => Number(t))
    return rec.yData.map((row) => {
      const item = asRecord(row)
      const data = Array.isArray(item?.data) ? item.data.map((v) => Number(v)) : []
      return {
        name: asString(item?.name) ?? '',
        points: xData.map((t, i) => [t, data[i] ?? 0] as [number, number])
      }
    })
  }
  const data = asRecord(rec.data)
  const rows = Array.isArray(data?.result)
    ? data.result
    : Array.isArray(rec.result)
      ? rec.result
      : []
  return rows.map((row) => {
    const item = asRecord(row)
    const metric = asRecord(item?.metric)
    const values = Array.isArray(item?.values) ? item.values : []
    const name =
      asString(metric?.pod) ??
      asString(metric?.persistentvolumeclaim) ??
      asString(metric?.name) ??
      ''
    return {
      name,
      points: values
        .map((pair) => {
          if (!Array.isArray(pair) || pair.length < 2) return null
          return [Number(pair[0]), Number(pair[1])] as [number, number]
        })
        .filter((p): p is [number, number] => p !== null)
    }
  })
}

async function fetchMonitorChart(
  dbName: string,
  dbType: string,
  queryKey: 'cpu' | 'memory' | 'disk'
): Promise<MonitorSeries[]> {
  const params = new URLSearchParams({ dbName, dbType, queryKey })
  const { status, body } = await dbFetch(
    `${dbBase()}/api/v2alpha/monitor/data?${params}`,
    { method: 'GET' },
    'monitor',
    DETAIL_TIMEOUT_MS
  )
  if (status !== 200) throw mapDbError(status, body, 'monitor')
  const rec = asRecord(body)
  if (rec && rec.code !== undefined && rec.code !== 200) {
    throw mapDbError(status, body, 'monitor')
  }
  const data = asRecord(rec?.data)
  return chartToSeries(data?.result ?? data)
}

export async function fetchDatabaseMonitor(name: string): Promise<DatabaseMonitor> {
  const dbName = requireName(name)
  const cluster = await readCluster(dbName)
  const dbType = cluster ? resolveEngine(cluster) : undefined
  const phase = cluster?.status?.phase ?? ''
  if (!dbType) {
    return {
      available: false,
      reason: '无法确定数据库引擎',
      cpu: [],
      memory: [],
      disk: [],
      diskOverflow: false
    }
  }
  try {
    const [cpu, memory, disk] = await Promise.all([
      fetchMonitorChart(dbName, dbType, 'cpu'),
      fetchMonitorChart(dbName, dbType, 'memory'),
      fetchMonitorChart(dbName, dbType, 'disk').catch(() => [] as MonitorSeries[])
    ])
    // Sealos isDiskSpaceOverflow：仅 Updating 时看 disk 样本 >= 10（单位是 %）
    const diskOverflow =
      phase === 'Updating' && disk.some((series) => series.points.some(([, value]) => value >= 10))
    return { available: true, cpu, memory, disk, diskOverflow }
  } catch (err) {
    return {
      available: false,
      reason: err instanceof Error ? err.message : String(err),
      cpu: [],
      memory: [],
      disk: [],
      diskOverflow: false
    }
  }
}

function asStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value
    .map((item) => (typeof item === 'string' ? item.trim() : ''))
    .filter((item) => item.length > 0 && !/^[-+|]+$/.test(item))
}

async function postLegacy(
  path: string,
  body: Record<string, string>
): Promise<{ status: number; body: unknown }> {
  return dbFetch(
    `${dbBase()}${path}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    },
    'schema',
    DETAIL_TIMEOUT_MS
  )
}

function legacyOk(status: number, body: unknown): string[] | undefined {
  const rec = asRecord(body)
  const code = asNumber(rec?.code)
  if (status === 200 && (code === undefined || code === 200)) {
    return asStringList(rec?.data)
  }
  return undefined
}

export async function fetchDatabaseSchema(name: string): Promise<DatabaseSchemaTree> {
  const dbName = requireName(name)
  const cluster = await readCluster(dbName)
  if (!cluster) throw new Error('数据库不存在')
  const info = databaseFromCluster(cluster)
  const engine = resolveEngine(cluster) ?? info.engine ?? ''
  if (!SCHEMA_ENGINES.has(engine)) {
    return { supported: false, reason: 'unsupported', databases: [] }
  }
  if (info.phase !== 'Running') {
    return { supported: true, reason: 'not-running', databases: [] }
  }

  const listed = await postLegacy('/api/db/getDatabases', { dbName, dbType: engine })
  const names = legacyOk(listed.status, listed.body)
  if (!names) {
    return { supported: true, reason: 'fetch-failed', databases: [] }
  }

  const databases = await Promise.all(
    names.map(async (databaseName) => {
      try {
        const tablesResp = await postLegacy('/api/db/getTables', {
          dbName,
          dbType: engine,
          databaseName
        })
        const tables = legacyOk(tablesResp.status, tablesResp.body) ?? []
        return { name: databaseName, tables }
      } catch {
        return { name: databaseName, tables: [] }
      }
    })
  )
  return { supported: true, databases }
}

export async function enableDatabasePublic(name: string): Promise<void> {
  const dbName = requireName(name)
  const { status, body } = await dbFetch(
    `${dbBase()}/api/v2alpha/databases/${encodeURIComponent(dbName)}/enable-public`,
    { method: 'POST' },
    'public',
    MUTATE_TIMEOUT_MS
  )
  if (status === 204 || status === 200) return
  throw mapDbError(status, body, 'public')
}

export async function disableDatabasePublic(name: string): Promise<void> {
  const dbName = requireName(name)
  const { status, body } = await dbFetch(
    `${dbBase()}/api/v2alpha/databases/${encodeURIComponent(dbName)}/disable-public`,
    { method: 'POST' },
    'public',
    MUTATE_TIMEOUT_MS
  )
  if (status === 204 || status === 200 || status === 404) return
  throw mapDbError(status, body, 'public')
}
