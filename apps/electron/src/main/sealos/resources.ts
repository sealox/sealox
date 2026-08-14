import * as k8s from '@kubernetes/client-node'
import type { V1Deployment, V1Ingress, V1Pod, V1StatefulSet } from '@kubernetes/client-node'
import type {
  AppStatus,
  AppWorkload,
  BucketInfo,
  DatabaseInfo,
  ProjectInfo,
  PodInfo,
  QuotaItem,
  ResourceSnapshot
} from '../../shared/types'
import { KUBECONFIG_PATH } from './auth'

/** 项目（模板实例）归属标签 */
export const PROJECT_LABEL = 'cloud.sealos.io/deploy-on-sealos'
/** App Launchpad 管理的应用标签 */
export const APP_LABEL = 'cloud.sealos.io/app-deploy-manager'
/** 项目备注名注解 */
export const DISPLAY_NAME_KEY = 'cloud.sealos.io/deploy-on-sealos-displayName'

export const STUCK_REASONS = new Set([
  'CrashLoopBackOff',
  'ImagePullBackOff',
  'ErrImagePull',
  'CreateContainerConfigError',
  'CreateContainerError',
  'InvalidImageName',
  'OOMKilled'
])

export function podInfo(pod: V1Pod): PodInfo {
  const statuses = pod.status?.containerStatuses ?? []
  const reason = statuses
    .map((s) => s.state?.waiting?.reason ?? s.state?.terminated?.reason)
    .find((r) => r && STUCK_REASONS.has(r))
  return {
    name: pod.metadata?.name ?? '',
    phase: pod.status?.phase ?? 'Unknown',
    reason: reason ?? undefined,
    restarts: statuses.reduce((sum, s) => sum + (s.restartCount ?? 0), 0)
  }
}

function appStatus(replicas: number, ready: number, pods: PodInfo[]): AppStatus {
  if (replicas === 0) return 'Stopped'
  if (pods.some((p) => p.reason || p.phase === 'Failed')) return 'Failed'
  if (ready >= replicas) return 'Running'
  return 'Progressing'
}

// Pods are matched to their workload via ownerReferences: Deployment pods are
// owned by a ReplicaSet named `<deploy>-<hash>`, StatefulSet pods directly.
export function matchPodsToWorkload(
  pods: V1Pod[],
  kind: 'Deployment' | 'StatefulSet',
  name: string
): V1Pod[] {
  return pods.filter((pod) =>
    (pod.metadata?.ownerReferences ?? []).some((ref) => {
      if (kind === 'StatefulSet') return ref.kind === 'StatefulSet' && ref.name === name
      return ref.kind === 'ReplicaSet' && new RegExp(`^${name}-[a-z0-9]+$`).test(ref.name)
    })
  )
}

function podsForWorkload(
  pods: V1Pod[],
  kind: 'Deployment' | 'StatefulSet',
  name: string
): PodInfo[] {
  return matchPodsToWorkload(pods, kind, name).map(podInfo)
}

export function urlsForApp(ingresses: V1Ingress[], appName: string): string[] {
  const urls = new Set<string>()
  for (const ing of ingresses) {
    const labels = ing.metadata?.labels ?? {}
    const backendServices = (ing.spec?.rules ?? [])
      .flatMap((r) => r.http?.paths ?? [])
      .map((p) => p.backend?.service?.name)
    const matches = labels[APP_LABEL] === appName || backendServices.includes(appName)
    if (!matches) continue
    for (const rule of ing.spec?.rules ?? []) {
      if (rule.host) urls.add(`https://${rule.host}`)
    }
  }
  return [...urls]
}

export function workloadFromDeployment(
  deploy: V1Deployment,
  allPods: V1Pod[],
  ingresses: V1Ingress[]
): AppWorkload {
  const name = deploy.metadata?.name ?? ''
  const replicas = deploy.spec?.replicas ?? 0
  const ready = deploy.status?.readyReplicas ?? 0
  const workloadPods = podsForWorkload(allPods, 'Deployment', name)
  return {
    name,
    kind: 'Deployment',
    replicas,
    readyReplicas: ready,
    status: appStatus(replicas, ready, workloadPods),
    images: (deploy.spec?.template?.spec?.containers ?? []).map((c) => c.image ?? ''),
    urls: urlsForApp(ingresses, name),
    project: deploy.metadata?.labels?.[PROJECT_LABEL],
    launchpad: deploy.metadata?.labels?.[APP_LABEL] !== undefined,
    pods: workloadPods
  }
}

/** KubeBlocks 托管的 StatefulSet 属于数据库，不算应用，返回 null */
export function workloadFromStatefulSet(
  sts: V1StatefulSet,
  allPods: V1Pod[],
  ingresses: V1Ingress[]
): AppWorkload | null {
  const managedBy = sts.metadata?.labels?.['app.kubernetes.io/managed-by']
  if (managedBy === 'kubeblocks') return null
  const name = sts.metadata?.name ?? ''
  const replicas = sts.spec?.replicas ?? 0
  const ready = sts.status?.readyReplicas ?? 0
  const workloadPods = podsForWorkload(allPods, 'StatefulSet', name)
  return {
    name,
    kind: 'StatefulSet',
    replicas,
    readyReplicas: ready,
    status: appStatus(replicas, ready, workloadPods),
    images: (sts.spec?.template?.spec?.containers ?? []).map((c) => c.image ?? ''),
    urls: urlsForApp(ingresses, name),
    project: sts.metadata?.labels?.[PROJECT_LABEL],
    launchpad: sts.metadata?.labels?.[APP_LABEL] !== undefined,
    pods: workloadPods
  }
}

export interface KubeBlocksCluster {
  metadata?: {
    name?: string
    labels?: Record<string, string>
    creationTimestamp?: string
  }
  spec?: {
    clusterDefinitionRef?: string
    clusterVersionRef?: string
    componentSpecs?: Array<{
      resources?: { limits?: { cpu?: string; memory?: string } }
      volumeClaimTemplates?: Array<{
        spec?: { resources?: { requests?: { storage?: string } } }
      }>
    }>
  }
  status?: { phase?: string }
}

export function databaseFromCluster(cluster: KubeBlocksCluster): DatabaseInfo {
  return {
    name: cluster.metadata?.name ?? '',
    engine:
      cluster.spec?.clusterDefinitionRef ??
      cluster.metadata?.labels?.['clusterdefinition.kubeblocks.io/name'],
    version:
      cluster.spec?.clusterVersionRef ??
      cluster.metadata?.labels?.['clusterversion.kubeblocks.io/name'],
    phase: cluster.status?.phase ?? 'Unknown',
    project: cluster.metadata?.labels?.[PROJECT_LABEL]
  }
}

/** 依次尝试 KubeBlocks 的 v1alpha1/v1 列表，两个版本都缺时返回 null */
export async function listKubeBlocksClusters(
  kc: k8s.KubeConfig,
  namespace: string,
  labelSelector?: string
): Promise<KubeBlocksCluster[] | null> {
  const custom = kc.makeApiClient(k8s.CustomObjectsApi)
  for (const version of ['v1alpha1', 'v1']) {
    try {
      const resp = (await custom.listNamespacedCustomObject({
        group: 'apps.kubeblocks.io',
        version,
        namespace,
        plural: 'clusters',
        labelSelector
      })) as { items?: KubeBlocksCluster[] }
      return resp.items ?? []
    } catch (err) {
      const status = (err as { code?: number }).code
      if (status === 404) continue
      throw err
    }
  }
  return null
}

async function listDatabases(
  kc: k8s.KubeConfig,
  namespace: string,
  warnings: string[]
): Promise<DatabaseInfo[]> {
  try {
    const clusters = await listKubeBlocksClusters(kc, namespace)
    return (clusters ?? []).map(databaseFromCluster)
  } catch (err) {
    warnings.push(`数据库列表读取失败：${err instanceof Error ? err.message : String(err)}`)
    return []
  }
}

interface ObjectStorageBucket {
  metadata?: {
    name?: string
    labels?: Record<string, string>
    creationTimestamp?: string
  }
  spec?: { policy?: string }
  status?: { name?: string }
}

async function listBuckets(
  kc: k8s.KubeConfig,
  namespace: string,
  warnings: string[]
): Promise<BucketInfo[]> {
  const custom = kc.makeApiClient(k8s.CustomObjectsApi)
  try {
    const resp = (await custom.listNamespacedCustomObject({
      group: 'objectstorage.sealos.io',
      version: 'v1',
      namespace,
      plural: 'objectstoragebuckets'
    })) as { items?: ObjectStorageBucket[] }
    return (resp.items ?? []).map((bucket) => ({
      name: bucket.metadata?.name ?? '',
      policy: bucket.spec?.policy,
      bucketName: bucket.status?.name,
      createdAt: bucket.metadata?.creationTimestamp,
      project: bucket.metadata?.labels?.[PROJECT_LABEL]
    }))
  } catch (err) {
    const status = (err as { code?: number }).code
    // 404 means the CRD is absent in this region — not an error worth surfacing.
    if (status !== 404) {
      warnings.push(`存储桶列表读取失败：${err instanceof Error ? err.message : String(err)}`)
    }
    return []
  }
}

/** 模板实例 CR（app.sealos.io/v1 instances，命名空间级） */
export interface InstanceCR {
  metadata?: {
    name?: string
    creationTimestamp?: string
    labels?: Record<string, string>
    annotations?: Record<string, string>
  }
  spec?: {
    title?: string
    templateType?: string
    author?: string
    description?: string
    gitRepo?: string
    url?: string
    icon?: string
  }
}

export function instanceDisplayName(instance: InstanceCR): string | undefined {
  return (
    instance.metadata?.annotations?.[DISPLAY_NAME_KEY] ??
    instance.metadata?.labels?.[DISPLAY_NAME_KEY]
  )
}

// 与 Template 前端同源：实例即命名空间内的 instances CR，直读省掉对
// template.{region} 服务的依赖（该 API 内部也只是转发这份列表）。
async function listProjects(
  kc: k8s.KubeConfig,
  namespace: string,
  warnings: string[]
): Promise<ProjectInfo[]> {
  const custom = kc.makeApiClient(k8s.CustomObjectsApi)
  try {
    const resp = (await custom.listNamespacedCustomObject({
      group: 'app.sealos.io',
      version: 'v1',
      namespace,
      plural: 'instances'
    })) as { items?: InstanceCR[] }
    return (resp.items ?? []).map((item) => ({
      name: item.metadata?.name ?? '',
      displayName: instanceDisplayName(item),
      icon: item.spec?.icon,
      template: item.spec?.title ?? item.spec?.templateType,
      createdAt: item.metadata?.creationTimestamp
    }))
  } catch (err) {
    const status = (err as { code?: number }).code
    // 404 = 该集群没有 Template 模块，视为没有项目而非错误。
    if (status !== 404) {
      warnings.push(
        `项目（模板实例）列表读取失败：${err instanceof Error ? err.message : String(err)}`
      )
    }
    return []
  }
}

/* ── 配额（与 costcenter 同源：namespace 的 ResourceQuota status.hard/used）── */

const BINARY_SUFFIX: Record<string, number> = {
  Ki: 2 ** 10,
  Mi: 2 ** 20,
  Gi: 2 ** 30,
  Ti: 2 ** 40,
  Pi: 2 ** 50,
  Ei: 2 ** 60
}
const DECIMAL_SUFFIX: Record<string, number> = { k: 1e3, M: 1e6, G: 1e9, T: 1e12, P: 1e15, E: 1e18 }
const GIB = 2 ** 30

function parseQuantity(value: string | undefined): number {
  if (!value) return 0
  const m = value.match(/^([0-9]*\.?[0-9]+)(m|Ki|Mi|Gi|Ti|Pi|Ei|k|M|G|T|P|E)?$/)
  if (!m) return Number(value) || 0
  const n = Number(m[1])
  const suffix = m[2]
  if (!suffix) return n
  if (suffix === 'm') return n / 1000
  return n * (BINARY_SUFFIX[suffix] ?? DECIMAL_SUFFIX[suffix] ?? 1)
}

function formatAmount(n: number): string {
  const rounded = Math.round(n * 10) / 10
  return String(rounded % 1 === 0 ? Math.round(rounded) : rounded)
}

async function listQuota(
  core: k8s.CoreV1Api,
  namespace: string,
  warnings: string[]
): Promise<QuotaItem[]> {
  try {
    const list = await core.listNamespacedResourceQuota({ namespace })
    const quota =
      list.items.find((q) => q.metadata?.name === `quota-${namespace}`) ??
      list.items.find((q) => q.status?.hard)
    const hard = quota?.status?.hard ?? {}
    const used = quota?.status?.used ?? {}

    const items: QuotaItem[] = []
    const push = (
      type: string,
      key: string,
      toDisplay: (n: number) => number,
      unit: string
    ): void => {
      if (hard[key] === undefined) return
      const limit = toDisplay(parseQuantity(hard[key]))
      if (limit <= 0) return
      const usedValue = toDisplay(parseQuantity(used[key] ?? '0'))
      items.push({
        type,
        used: usedValue,
        limit,
        usedText: formatAmount(usedValue),
        limitText: formatAmount(limit),
        unit
      })
    }
    push('cpu', 'limits.cpu', (n) => n, 'vCPU')
    push('memory', 'limits.memory', (n) => n / GIB, 'GiB')
    push('storage', 'requests.storage', (n) => n / GIB, 'GiB')
    push('gpu', 'limits.nvidia.com/gpu', (n) => n, 'GPU')
    return items
  } catch (err) {
    warnings.push(`配额读取失败：${err instanceof Error ? err.message : String(err)}`)
    return []
  }
}

export async function fetchResources(): Promise<ResourceSnapshot> {
  const kc = new k8s.KubeConfig()
  kc.loadFromFile(KUBECONFIG_PATH)

  const context = kc.getContextObject(kc.getCurrentContext())
  const namespace = context?.namespace
  if (!namespace) throw new Error('kubeconfig 里没有 namespace，无法确定工作空间')
  const server = kc.getCurrentCluster()?.server
  if (!server) throw new Error('kubeconfig 里没有 server 地址')
  const regionDomain = new URL(server).hostname

  const apps = kc.makeApiClient(k8s.AppsV1Api)
  const core = kc.makeApiClient(k8s.CoreV1Api)
  const networking = kc.makeApiClient(k8s.NetworkingV1Api)

  const warnings: string[] = []
  const [deployments, statefulSets, pods, ingresses, databases, projects, buckets, quota] =
    await Promise.all([
      apps.listNamespacedDeployment({ namespace }),
      apps.listNamespacedStatefulSet({ namespace }),
      core.listNamespacedPod({ namespace }),
      networking.listNamespacedIngress({ namespace }),
      listDatabases(kc, namespace, warnings),
      listProjects(kc, namespace, warnings),
      listBuckets(kc, namespace, warnings),
      listQuota(core, namespace, warnings)
    ])

  const podItems = pods.items ?? []
  const ingressItems = ingresses.items ?? []
  const workloads: AppWorkload[] = []

  for (const deploy of deployments.items ?? []) {
    workloads.push(workloadFromDeployment(deploy, podItems, ingressItems))
  }

  for (const sts of statefulSets.items ?? []) {
    const workload = workloadFromStatefulSet(sts, podItems, ingressItems)
    if (workload) workloads.push(workload)
  }

  return {
    namespace,
    regionDomain,
    fetchedAt: new Date().toISOString(),
    apps: workloads.sort((a, b) => a.name.localeCompare(b.name)),
    databases,
    projects,
    buckets,
    quota,
    warnings
  }
}

/** 与 fetchResources 同一份 ResourceQuota；读失败或没有数字时返回空数组（调用方不得因此拦截） */
export async function fetchNamespaceQuota(): Promise<QuotaItem[]> {
  const kc = new k8s.KubeConfig()
  kc.loadFromFile(KUBECONFIG_PATH)
  const context = kc.getContextObject(kc.getCurrentContext())
  const namespace = context?.namespace
  if (!namespace) throw new Error('kubeconfig 里没有 namespace，无法确定工作空间')
  const core = kc.makeApiClient(k8s.CoreV1Api)
  return listQuota(core, namespace, [])
}

/** 当前 ns 是否已有该 instances.app.sealos.io（409 落地确认，与 listProjects 同源） */
export async function instanceExists(name: string): Promise<boolean> {
  const kc = new k8s.KubeConfig()
  kc.loadFromFile(KUBECONFIG_PATH)
  const context = kc.getContextObject(kc.getCurrentContext())
  const namespace = context?.namespace
  if (!namespace) throw new Error('kubeconfig 里没有 namespace，无法确定工作空间')
  const custom = kc.makeApiClient(k8s.CustomObjectsApi)
  try {
    await custom.getNamespacedCustomObject({
      group: 'app.sealos.io',
      version: 'v1',
      namespace,
      plural: 'instances',
      name
    })
    return true
  } catch (err) {
    if ((err as { code?: number }).code === 404) return false
    throw err
  }
}
