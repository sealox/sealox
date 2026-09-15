import * as k8s from '@kubernetes/client-node'
import type {
  CoreV1Event,
  V1ConfigMap,
  V1Container,
  V1Deployment,
  V1Ingress,
  V1Pod,
  V1Service,
  V1StatefulSet,
  V2HorizontalPodAutoscaler
} from '@kubernetes/client-node'
import type {
  AppDetail,
  AppMonitor,
  AppStatus,
  ConfigMapMount,
  ContainerInfo,
  CronJobInfo,
  DatabaseDetail,
  EnvEntry,
  EventInfo,
  MonitorSeries,
  NetworkEntry,
  OtherResource,
  PodDetail,
  ProjectDetail,
  StoreMount
} from '../../shared/types'
import { getKubeconfigPath, readKubeconfigText } from './auth'
import {
  APP_LABEL,
  PROJECT_LABEL,
  STUCK_REASONS,
  databaseFromCluster,
  instanceDisplayName,
  listKubeBlocksClusters,
  matchPodsToWorkload,
  workloadFromDeployment,
  workloadFromStatefulSet,
  type InstanceCR,
  type KubeBlocksCluster
} from './resources'
import { inferProjectLinks } from './topology'

/** applaunchpad 的 HPA/暂停/镜像注解约定 */
const PAUSE_KEY = 'deploy.cloud.sealos.io/pause'
const ORIGIN_IMAGE_KEY = 'originImageName'
const PUBLIC_DOMAIN_KEY = 'cloud.sealos.io/app-deploy-manager-domain'
/** 数据库内部资源标记（Role/SA/ConfigMap 等排除出"其他资源"） */
const DB_PROVIDER_KEY = 'sealos-db-provider-cr'

interface KubeContext {
  kc: k8s.KubeConfig
  namespace: string
  regionDomain: string
}

function loadKube(): KubeContext {
  const kc = new k8s.KubeConfig()
  kc.loadFromFile(getKubeconfigPath())
  const context = kc.getContextObject(kc.getCurrentContext())
  const namespace = context?.namespace
  if (!namespace) throw new Error('kubeconfig 里没有 namespace，无法确定工作空间')
  const server = kc.getCurrentCluster()?.server
  if (!server) throw new Error('kubeconfig 里没有 server 地址')
  return { kc, namespace, regionDomain: new URL(server).hostname }
}

function isNotFound(err: unknown): boolean {
  return (err as { code?: number }).code === 404
}

/* ── 应用详情 ─────────────────────────────────── */

function containerInfos(pod: V1Pod): ContainerInfo[] {
  const specs = pod.spec?.containers ?? []
  const statuses = pod.status?.containerStatuses ?? []
  return specs.map((spec) => {
    const status = statuses.find((s) => s.name === spec.name)
    const state = status?.state
    const stateName = state?.running ? 'running' : state?.terminated ? 'terminated' : 'waiting'
    const reason = state?.waiting?.reason ?? state?.terminated?.reason
    return {
      name: spec.name,
      image: spec.image ?? '',
      state: stateName,
      reason: reason ?? undefined,
      cpuLimit: spec.resources?.limits?.['cpu'],
      memoryLimit: spec.resources?.limits?.['memory']
    }
  })
}

export function podDetail(pod: V1Pod): PodDetail {
  const statuses = pod.status?.containerStatuses ?? []
  const stuck = statuses
    .map((s) => s.state?.waiting ?? s.state?.terminated)
    .find((s) => s?.reason && STUCK_REASONS.has(s.reason))
  return {
    name: pod.metadata?.name ?? '',
    phase: pod.status?.phase ?? 'Unknown',
    reason: stuck?.reason ?? pod.status?.reason ?? undefined,
    message: stuck?.message ?? pod.status?.message ?? undefined,
    restarts: statuses.reduce((sum, s) => sum + (s.restartCount ?? 0), 0),
    createdAt: pod.metadata?.creationTimestamp
      ? new Date(pod.metadata.creationTimestamp).toISOString()
      : undefined,
    node: pod.spec?.nodeName,
    ip: pod.status?.podIP,
    containers: containerInfos(pod)
  }
}

export function toEventInfo(event: CoreV1Event): EventInfo {
  return {
    type: event.type ?? 'Normal',
    reason: event.reason ?? '',
    message: event.message ?? '',
    count: event.count ?? 1,
    lastAt:
      (event.lastTimestamp ?? event.eventTime ?? event.firstTimestamp)
        ? new Date(
            (event.lastTimestamp ?? event.eventTime ?? event.firstTimestamp) as unknown as string
          ).toISOString()
        : undefined,
    object: event.involvedObject
      ? `${event.involvedObject.kind}/${event.involvedObject.name}`
      : undefined
  }
}

export function eventTime(event: CoreV1Event): number {
  const t = event.lastTimestamp ?? event.eventTime ?? event.firstTimestamp
  return t ? new Date(t as unknown as string).getTime() : 0
}

/** workload + 其 pods + 其 replicaset 的事件，按时间倒序 */
function eventsForWorkload(
  events: CoreV1Event[],
  workloadName: string,
  podNames: Set<string>
): EventInfo[] {
  const rsPattern = new RegExp(`^${workloadName}-[a-z0-9]+$`)
  return events
    .filter((event) => {
      const involved = event.involvedObject
      if (!involved?.name) return false
      if (involved.name === workloadName) return true
      if (podNames.has(involved.name)) return true
      return involved.kind === 'ReplicaSet' && rsPattern.test(involved.name)
    })
    .sort((a, b) => eventTime(b) - eventTime(a))
    .slice(0, 30)
    .map(toEventInfo)
}

function envEntries(container: V1Container | undefined): EnvEntry[] {
  return (container?.env ?? []).map((env) => {
    let from: string | undefined
    if (env.valueFrom?.secretKeyRef) {
      from = `secret/${env.valueFrom.secretKeyRef.name}.${env.valueFrom.secretKeyRef.key}`
    } else if (env.valueFrom?.configMapKeyRef) {
      from = `configmap/${env.valueFrom.configMapKeyRef.name}.${env.valueFrom.configMapKeyRef.key}`
    } else if (env.valueFrom?.fieldRef) {
      from = `field/${env.valueFrom.fieldRef.fieldPath}`
    } else if (env.valueFrom?.resourceFieldRef) {
      from = `resource/${env.valueFrom.resourceFieldRef.resource}`
    }
    return { key: env.name, value: env.value, from }
  })
}

/**
 * ConfigMap 挂载解析（与 applaunchpad 的 adaptAppDetail 同规则）：
 * volume(configMap) × 容器 volumeMounts(subPath) → mountPath + 文件内容。
 */
function configMapMounts(
  workload: V1Deployment | V1StatefulSet,
  configMaps: Map<string, V1ConfigMap>
): ConfigMapMount[] {
  const podSpec = workload.spec?.template?.spec
  const volumes = podSpec?.volumes ?? []
  const mounts = (podSpec?.containers ?? []).flatMap((c) => c.volumeMounts ?? [])
  const results: ConfigMapMount[] = []
  for (const volume of volumes) {
    const cmName = volume.configMap?.name
    if (!cmName) continue
    const cm = configMaps.get(cmName)
    if (!cm?.data) continue
    const relatedMounts = mounts.filter((m) => m.name === volume.name)
    const items = volume.configMap?.items
    if (items && items.length > 0) {
      for (const item of items) {
        if (!item.key) continue
        const mount = relatedMounts.find((m) => m.subPath === item.path)
        const value = cm.data[item.key]
        if (mount && value !== undefined) {
          results.push({ mountPath: mount.mountPath, value })
        }
      }
    } else {
      for (const mount of relatedMounts) {
        if (mount.subPath) {
          const value = cm.data[mount.subPath]
          if (value !== undefined) results.push({ mountPath: mount.mountPath, value })
        } else {
          // 整卷挂载：每个 key 一个文件
          for (const [key, value] of Object.entries(cm.data)) {
            results.push({ mountPath: `${mount.mountPath}/${key}`, value })
          }
        }
      }
    }
  }
  return results
}

function storeMounts(workload: V1Deployment | V1StatefulSet): StoreMount[] {
  const stores: StoreMount[] = []
  const podSpec = workload.spec?.template?.spec
  const mounts = (podSpec?.containers ?? []).flatMap((c) => c.volumeMounts ?? [])

  // StatefulSet volumeClaimTemplates（launchpad 的持久存储形态）
  const templates = (workload as V1StatefulSet).spec?.volumeClaimTemplates ?? []
  for (const template of templates) {
    const name = template.metadata?.name ?? ''
    const mount = mounts.find((m) => m.name === name)
    stores.push({
      name,
      path: template.metadata?.annotations?.['path'] ?? mount?.mountPath ?? '',
      size: template.spec?.resources?.requests?.['storage']
    })
  }

  // Deployment 引用现成 PVC 的形态（模板部署常见）
  for (const volume of podSpec?.volumes ?? []) {
    const claim = volume.persistentVolumeClaim?.claimName
    if (!claim) continue
    const mount = mounts.find((m) => m.name === volume.name)
    stores.push({ name: claim, path: mount?.mountPath ?? '' })
  }
  return stores
}

/** service 端口 × ingress 主机 → 网络入口表 */
function networkEntries(
  appName: string,
  namespace: string,
  regionDomain: string,
  workload: V1Deployment | V1StatefulSet,
  services: V1Service[],
  ingresses: V1Ingress[]
): NetworkEntry[] {
  const podLabels = workload.spec?.template?.metadata?.labels ?? {}
  const related = services.filter((svc) => {
    if (svc.metadata?.labels?.[APP_LABEL] === appName) return true
    if (svc.metadata?.name === appName) return true
    const selector = svc.spec?.selector ?? {}
    const keys = Object.keys(selector)
    return keys.length > 0 && keys.every((key) => podLabels[key] === selector[key])
  })

  const entries: NetworkEntry[] = []
  for (const svc of related) {
    const svcName = svc.metadata?.name ?? appName
    for (const port of svc.spec?.ports ?? []) {
      const matches = ingresses.filter((ing) =>
        (ing.spec?.rules ?? []).some((rule) =>
          (rule.http?.paths ?? []).some(
            (path) =>
              path.backend?.service?.name === svcName &&
              path.backend?.service?.port?.number === port.port
          )
        )
      )
      for (const [index, ingress] of (matches.length ? matches : [undefined]).entries()) {
      const host = ingress?.spec?.rules?.find((r) => r.host)?.host
      const assignedPrefix = ingress?.metadata?.labels?.[PUBLIC_DOMAIN_KEY]
      const custom = host
        ? assignedPrefix
          ? !host.startsWith(`${assignedPrefix}.`)
          : !host.endsWith(`.${regionDomain}`)
        : undefined
      entries.push({
        port: port.port,
        protocol: port.protocol ?? 'TCP',
        appProtocol:
          ingress?.metadata?.annotations?.['nginx.ingress.kubernetes.io/backend-protocol'],
        clusterAddress: index === 0 ? `${svcName}.${namespace}.svc.cluster.local:${port.port}` : '',
        publicUrl: host ? `https://${host}` : undefined,
        customDomain: custom,
        nodePort: port.nodePort ?? undefined
      })
      }
    }
  }
  // 无 service 的工作负载：仍给出 ingress 直连域名（保证与列表页 urls 一致）
  if (entries.length === 0) {
    for (const ing of ingresses) {
      if (ing.metadata?.labels?.[APP_LABEL] !== appName) continue
      for (const rule of ing.spec?.rules ?? []) {
        if (!rule.host) continue
        entries.push({
          port: 0,
          protocol: 'TCP',
          clusterAddress: '',
          publicUrl: `https://${rule.host}`
        })
      }
    }
  }
  return entries
}

function appDetailStatus(
  replicas: number,
  ready: number,
  paused: boolean,
  pods: PodDetail[]
): AppStatus {
  if (paused || replicas === 0) return 'Stopped'
  if (pods.some((p) => p.reason || p.phase === 'Failed')) return 'Failed'
  if (ready >= replicas) return 'Running'
  return 'Progressing'
}

export async function fetchAppDetail(
  name: string,
  kind: 'Deployment' | 'StatefulSet'
): Promise<AppDetail> {
  const { kc, namespace, regionDomain } = loadKube()
  const apps = kc.makeApiClient(k8s.AppsV1Api)
  const core = kc.makeApiClient(k8s.CoreV1Api)
  const networking = kc.makeApiClient(k8s.NetworkingV1Api)
  const autoscaling = kc.makeApiClient(k8s.AutoscalingV2Api)

  const [workload, services, ingresses, pods, events, hpa, secret] = await Promise.all([
    kind === 'Deployment'
      ? apps.readNamespacedDeployment({ name, namespace })
      : apps.readNamespacedStatefulSet({ name, namespace }),
    core.listNamespacedService({ namespace }).catch(() => ({ items: [] })),
    networking.listNamespacedIngress({ namespace }).catch(() => ({ items: [] })),
    core.listNamespacedPod({ namespace }).catch(() => ({ items: [] })),
    core.listNamespacedEvent({ namespace }).catch(() => ({ items: [] })),
    // HPA and image-pull Secret are optional. A missing API or a transient
    // failure must not prevent the workload detail page from opening.
    autoscaling
      .readNamespacedHorizontalPodAutoscaler({ name, namespace })
      .catch(() => null),
    core.readNamespacedSecret({ name, namespace }).catch(() => null)
  ])

  // 拉取 pod 模板引用到的全部 ConfigMap（一般 0~2 个）
  const cmNames = [
    ...new Set(
      (workload.spec?.template?.spec?.volumes ?? [])
        .map((volume) => volume.configMap?.name)
        .filter((cmName): cmName is string => Boolean(cmName))
    )
  ]
  const configMaps = new Map<string, V1ConfigMap>()
  await Promise.all(
    cmNames.map(async (cmName) => {
      try {
        configMaps.set(cmName, await core.readNamespacedConfigMap({ name: cmName, namespace }))
      } catch (_) {
        // ConfigMap details are supplementary; keep the workload page usable
        // when a referenced object is gone or the API briefly fails.
      }
    })
  )

  const workloadPods = matchPodsToWorkload(pods.items ?? [], kind, name).map(podDetail)
  const container = workload.spec?.template?.spec?.containers?.[0]
  const annotations = workload.metadata?.annotations ?? {}
  const labels = workload.metadata?.labels ?? {}
  const paused = annotations[PAUSE_KEY] !== undefined
  const replicas = workload.spec?.replicas ?? 0
  const ready = workload.status?.readyReplicas ?? 0

  const hpaSpec = (hpa as V2HorizontalPodAutoscaler | null)?.spec
  const hpaMetric = hpaSpec?.metrics?.[0]
  const gpuHpa = hpaMetric?.pods?.metric?.name === 'DCGM_FI_DEV_GPU_UTIL'

  return {
    name,
    kind,
    status: appDetailStatus(replicas, ready, paused, workloadPods),
    paused,
    createdAt: workload.metadata?.creationTimestamp
      ? new Date(workload.metadata.creationTimestamp).toISOString()
      : undefined,
    image: annotations[ORIGIN_IMAGE_KEY] ?? container?.image ?? '',
    privateImage: secret?.type === 'kubernetes.io/dockerconfigjson',
    command: container?.command?.join(' ') || undefined,
    args: container?.args?.join(' ') || undefined,
    cpuLimit: container?.resources?.limits?.['cpu'],
    memoryLimit: container?.resources?.limits?.['memory'],
    gpu: container?.resources?.limits?.['nvidia.com/gpu'],
    replicas,
    readyReplicas: ready,
    hpa: hpaSpec
      ? {
          target: gpuHpa ? 'gpu' : (hpaMetric?.resource?.name ?? 'cpu'),
          // launchpad 写入的 averageUtilization 是表单值 ×10（request=limit/10），还原为展示值
          targetValue: gpuHpa
            ? Number(hpaMetric?.pods?.target?.averageValue ?? 50)
            : (hpaMetric?.resource?.target?.averageUtilization ?? 500) / 10,
          minReplicas: hpaSpec.minReplicas ?? 1,
          maxReplicas: hpaSpec.maxReplicas ?? 1
        }
      : undefined,
    project: labels[PROJECT_LABEL],
    launchpad: labels[APP_LABEL] !== undefined,
    networks: networkEntries(
      name,
      namespace,
      regionDomain,
      workload,
      services.items ?? [],
      ingresses.items ?? []
    ),
    envs: envEntries(container),
    configMaps: configMapMounts(workload, configMaps),
    stores: storeMounts(workload),
    pods: workloadPods,
    events: eventsForWorkload(
      events.items ?? [],
      name,
      new Set(workloadPods.map((pod) => pod.name))
    ),
    fetchedAt: new Date().toISOString()
  }
}

/* ── 监控（applaunchpad 公开 API）──────────────── */

interface MonitorApiItem {
  name?: string
  xData?: number[]
  yData?: string[]
}

async function fetchMonitorSeries(
  regionDomain: string,
  kubeconfig: string,
  appName: string,
  queryKey: 'cpu' | 'memory'
): Promise<MonitorSeries[]> {
  const params = new URLSearchParams({ queryKey, queryName: appName, step: '1m' })
  const resp = await fetch(
    `https://applaunchpad.${regionDomain}/api/monitor/getMonitorData?${params}`,
    {
      headers: { Authorization: encodeURIComponent(kubeconfig) },
      signal: AbortSignal.timeout(15_000)
    }
  )
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`)
  const body = (await resp.json()) as { code?: number; data?: MonitorApiItem[]; message?: string }
  if (body.code !== 200) throw new Error(body.message ?? `code ${body.code}`)
  return (body.data ?? []).map((item) => ({
    name: item.name ?? '',
    points: (item.xData ?? []).map((t, i) => [t, Number(item.yData?.[i] ?? 0)] as [number, number])
  }))
}

export async function fetchAppMonitor(appName: string): Promise<AppMonitor> {
  try {
    const { regionDomain } = loadKube()
    const kubeconfig = readKubeconfigText()
    const [cpu, memory] = await Promise.all([
      fetchMonitorSeries(regionDomain, kubeconfig, appName, 'cpu'),
      fetchMonitorSeries(regionDomain, kubeconfig, appName, 'memory')
    ])
    return { available: true, cpu, memory }
  } catch (err) {
    return {
      available: false,
      reason: err instanceof Error ? err.message : String(err),
      cpu: [],
      memory: []
    }
  }
}

/* ── Pod 日志 ─────────────────────────────────── */

export async function fetchPodLogs(
  pod: string,
  container?: string,
  previous?: boolean
): Promise<string> {
  const { kc, namespace } = loadKube()
  const core = kc.makeApiClient(k8s.CoreV1Api)
  try {
    return await core.readNamespacedPodLog({
      name: pod,
      namespace,
      container,
      tailLines: 400,
      previous: previous || undefined
    })
  } catch (err) {
    const body = (err as { body?: { message?: string } }).body
    throw new Error(body?.message ?? (err instanceof Error ? err.message : String(err)))
  }
}

/* ── 项目详情 ─────────────────────────────────── */

function databaseDetail(cluster: KubeBlocksCluster): DatabaseDetail {
  const component = cluster.spec?.componentSpecs?.[0]
  const volumeClaim = component?.volumeClaimTemplates?.[0]
  const storage = volumeClaim?.spec?.resources?.requests?.storage
  const volumeName = volumeClaim?.metadata?.name
  return {
    ...databaseFromCluster(cluster),
    cpuLimit: component?.resources?.limits?.cpu,
    memoryLimit: component?.resources?.limits?.memory,
    storage,
    volume: storage || volumeName ? { name: volumeName ?? 'data', size: storage } : undefined,
    connSecret: cluster.metadata?.name ? `${cluster.metadata.name}-conn-credential` : undefined,
    createdAt: cluster.metadata?.creationTimestamp
  }
}

interface NamedResource {
  kind?: string
  metadata?: { name?: string; labels?: Record<string, string> }
}

interface PodMetric {
  metadata?: { name?: string; labels?: Record<string, string> }
  containers?: Array<{
    name?: string
    usage?: { cpu?: string; memory?: string }
  }>
}

function cpuCores(value: string | undefined): number | undefined {
  if (!value) return undefined
  const match = /^([0-9]+(?:\.[0-9]+)?)(n|u|m)?$/.exec(value.trim())
  if (!match) return undefined
  const amount = Number(match[1])
  const multiplier = match[2] === 'n' ? 1e-9 : match[2] === 'u' ? 1e-6 : match[2] === 'm' ? 1e-3 : 1
  return Number.isFinite(amount) ? amount * multiplier : undefined
}

function memoryBytes(value: string | undefined): number | undefined {
  if (!value) return undefined
  const match = /^([0-9]+(?:\.[0-9]+)?)([KMGTPE]i|[kKMGTPE])?$/.exec(value.trim())
  if (!match) return undefined
  const amount = Number(match[1])
  const binary = ['Ki', 'Mi', 'Gi', 'Ti', 'Pi', 'Ei'].indexOf(match[2] ?? '')
  const decimal = ['k', 'K', 'M', 'G', 'T', 'P', 'E'].indexOf(match[2] ?? '')
  const multiplier = binary >= 0 ? 1024 ** (binary + 1) : decimal >= 0 ? 1000 ** (decimal + 1) : 1
  return Number.isFinite(amount) ? amount * multiplier : undefined
}

function resourceUsage(
  podNames: Set<string>,
  metrics: PodMetric[],
  cpuLimit: string | undefined,
  memoryLimit: string | undefined
): { cpuPercent?: number; memoryPercent?: number } | undefined {
  const matching = metrics.filter((metric) => podNames.has(metric.metadata?.name ?? ''))
  if (matching.length === 0) return undefined
  let usedCpu = 0
  let usedMemory = 0
  let hasCpu = false
  let hasMemory = false
  for (const metric of matching) {
    for (const container of metric.containers ?? []) {
      const cpu = cpuCores(container.usage?.cpu)
      const memory = memoryBytes(container.usage?.memory)
      if (cpu !== undefined) {
        usedCpu += cpu
        hasCpu = true
      }
      if (memory !== undefined) {
        usedMemory += memory
        hasMemory = true
      }
    }
  }
  const cpuCapacity = cpuCores(cpuLimit)
  const memoryCapacity = memoryBytes(memoryLimit)
  const result = {
    cpuPercent:
      hasCpu && cpuCapacity && cpuCapacity > 0
        ? Math.round((usedCpu / (cpuCapacity * matching.length)) * 1000) / 10
        : undefined,
    memoryPercent:
      hasMemory && memoryCapacity && memoryCapacity > 0
        ? Math.round((usedMemory / (memoryCapacity * matching.length)) * 1000) / 10
        : undefined
  }
  return result.cpuPercent === undefined && result.memoryPercent === undefined ? undefined : result
}

export async function fetchProjectDetail(name: string): Promise<ProjectDetail> {
  const { kc, namespace } = loadKube()
  const apps = kc.makeApiClient(k8s.AppsV1Api)
  const core = kc.makeApiClient(k8s.CoreV1Api)
  const networking = kc.makeApiClient(k8s.NetworkingV1Api)
  const batch = kc.makeApiClient(k8s.BatchV1Api)
  const rbac = kc.makeApiClient(k8s.RbacAuthorizationV1Api)
  const custom = kc.makeApiClient(k8s.CustomObjectsApi)
  const labelSelector = `${PROJECT_LABEL}=${name}`

  /** label 过滤的自定义资源列表；CRD 不存在（404）时返回 [] */
  const listCustom = async (
    group: string,
    version: string,
    plural: string
  ): Promise<NamedResource[]> => {
    try {
      const resp = (await custom.listNamespacedCustomObject({
        group,
        version,
        namespace,
        plural,
        labelSelector
      })) as { items?: NamedResource[] }
      return resp.items ?? []
    } catch (err) {
      if (isNotFound(err)) return []
      throw err
    }
  }

  const [
    instance,
    deployments,
    statefulSets,
    pods,
    ingresses,
    clusters,
    buckets,
    cronjobs,
    secrets,
    configMaps,
    services,
    jobs,
    pvcs,
    serviceAccounts,
    roles,
    roleBindings,
    issuers,
    certificates,
    appCRs,
    podMetrics
  ] = await Promise.all([
    custom
      .getNamespacedCustomObject({
        group: 'app.sealos.io',
        version: 'v1',
        namespace,
        plural: 'instances',
        name
      })
      .then((body) => body as InstanceCR)
      .catch((err: unknown) => {
        if (isNotFound(err)) return null
        throw err
      }),
    apps.listNamespacedDeployment({ namespace, labelSelector }),
    apps.listNamespacedStatefulSet({ namespace, labelSelector }),
    core.listNamespacedPod({ namespace }),
    networking.listNamespacedIngress({ namespace }),
    listKubeBlocksClusters(kc, namespace, labelSelector).catch(() => []),
    listCustom('objectstorage.sealos.io', 'v1', 'objectstoragebuckets'),
    batch.listNamespacedCronJob({ namespace, labelSelector }),
    core.listNamespacedSecret({ namespace, labelSelector }),
    core.listNamespacedConfigMap({
      namespace,
      labelSelector: `${labelSelector},!${DB_PROVIDER_KEY},!${APP_LABEL}`
    }),
    core.listNamespacedService({ namespace, labelSelector }),
    batch.listNamespacedJob({ namespace, labelSelector }),
    core.listNamespacedPersistentVolumeClaim({ namespace, labelSelector }),
    core.listNamespacedServiceAccount({
      namespace,
      labelSelector: `${labelSelector},!${DB_PROVIDER_KEY}`
    }),
    rbac.listNamespacedRole({ namespace, labelSelector: `${labelSelector},!${DB_PROVIDER_KEY}` }),
    rbac.listNamespacedRoleBinding({
      namespace,
      labelSelector: `${labelSelector},!${DB_PROVIDER_KEY}`
    }),
    listCustom('cert-manager.io', 'v1', 'issuers'),
    listCustom('cert-manager.io', 'v1', 'certificates'),
    listCustom('app.sealos.io', 'v1', 'apps'),
    custom
      .listNamespacedCustomObject({
        group: 'metrics.k8s.io',
        version: 'v1beta1',
        namespace,
        plural: 'pods'
      })
      .then((body) => (body as { items?: PodMetric[] }).items ?? [])
      .catch(() => [] as PodMetric[])
  ])

  const podItems = pods.items ?? []
  const ingressItems = ingresses.items ?? []

  const rawByName = new Map<string, V1Deployment | V1StatefulSet>()
  for (const deploy of deployments.items ?? []) {
    const deployName = deploy.metadata?.name
    if (deployName) rawByName.set(deployName, deploy)
  }
  for (const sts of statefulSets.items ?? []) {
    if (sts.metadata?.labels?.['app.kubernetes.io/managed-by'] === 'kubeblocks') continue
    const stsName = sts.metadata?.name
    if (stsName) rawByName.set(stsName, sts)
  }

  const workloads = [
    ...(deployments.items ?? []).map((d) => workloadFromDeployment(d, podItems, ingressItems)),
    ...(statefulSets.items ?? [])
      .map((s) => workloadFromStatefulSet(s, podItems, ingressItems))
      .filter((w): w is NonNullable<typeof w> => w !== null)
  ]
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((workload) => {
      const raw = rawByName.get(workload.name)
      const first = raw ? storeMounts(raw)[0] : undefined
      const container = raw?.spec?.template?.spec?.containers?.[0]
      const usage = resourceUsage(
        new Set(workload.pods.map((pod) => pod.name)),
        podMetrics,
        container?.resources?.limits?.['cpu'],
        container?.resources?.limits?.['memory']
      )
      return {
        ...workload,
        ...(first ? { volume: { name: first.name, size: first.size } } : {}),
        ...(usage ? { usage } : {})
      }
    })

  const cronjobInfos: CronJobInfo[] = (cronjobs.items ?? []).map((job) => ({
    name: job.metadata?.name ?? '',
    schedule: job.spec?.schedule ?? '',
    suspended: job.spec?.suspend === true,
    lastScheduleAt: job.status?.lastScheduleTime
      ? new Date(job.status.lastScheduleTime).toISOString()
      : undefined
  }))

  const others: OtherResource[] = []
  const pushAll = (
    kind: string,
    items: NamedResource[] | undefined,
    note?: (r: NamedResource) => string | undefined
  ): void => {
    for (const item of items ?? []) {
      others.push({ kind, name: item.metadata?.name ?? '', note: note?.(item) })
    }
  }
  pushAll('Secret', secrets.items as NamedResource[])
  pushAll('ConfigMap', configMaps.items as NamedResource[])
  pushAll('Service', services.items as NamedResource[], (r) => {
    const svc = r as V1Service
    const ports = (svc.spec?.ports ?? [])
      .map((p) =>
        p.nodePort ? `${p.port}:${p.nodePort}/${p.protocol}` : `${p.port}/${p.protocol}`
      )
      .join(', ')
    return ports ? `${svc.spec?.type ?? 'ClusterIP'} · ${ports}` : svc.spec?.type
  })
  pushAll('Job', jobs.items as NamedResource[])
  pushAll('PVC', pvcs.items as NamedResource[])
  pushAll('ServiceAccount', serviceAccounts.items as NamedResource[])
  pushAll('Role', roles.items as NamedResource[])
  pushAll('RoleBinding', roleBindings.items as NamedResource[])
  pushAll('Issuer', issuers)
  pushAll('Certificate', certificates)
  pushAll('App', appCRs, () => '桌面入口')

  const databaseDetails = ((clusters ?? []) as KubeBlocksCluster[]).map((cluster) => {
    const detail = databaseDetail(cluster)
    const component = cluster.spec?.componentSpecs?.[0]
    const databaseName = cluster.metadata?.name ?? detail.name
    const metricPods = new Set(
      podItems
        .filter(
          (pod) =>
            pod.metadata?.labels?.['app.kubernetes.io/instance'] === databaseName ||
            pod.metadata?.name?.startsWith(`${databaseName}-`)
        )
        .map((pod) => pod.metadata?.name ?? '')
        .filter(Boolean)
    )
    const usage = resourceUsage(
      metricPods,
      podMetrics,
      component?.resources?.limits?.cpu,
      component?.resources?.limits?.memory
    )
    return usage ? { ...detail, usage } : detail
  })
  const bucketInfos = (
    buckets as Array<{
      metadata?: { name?: string; labels?: Record<string, string>; creationTimestamp?: string }
      spec?: { policy?: string }
      status?: { name?: string }
    }>
  ).map((bucket) => ({
    name: bucket.metadata?.name ?? '',
    policy: bucket.spec?.policy,
    bucketName: bucket.status?.name,
    createdAt: bucket.metadata?.creationTimestamp,
    project: bucket.metadata?.labels?.[PROJECT_LABEL]
  }))

  return {
    name,
    displayName: instance ? instanceDisplayName(instance) : undefined,
    icon: instance?.spec?.icon,
    template: instance?.spec?.title ?? instance?.spec?.templateType,
    author: instance?.spec?.author,
    description: instance?.spec?.description,
    gitRepo: instance?.spec?.gitRepo,
    website: instance?.spec?.url,
    createdAt: instance?.metadata?.creationTimestamp,
    apps: workloads,
    databases: databaseDetails,
    buckets: bucketInfos,
    cronjobs: cronjobInfos,
    others,
    links: inferProjectLinks(
      workloads.map((app) => app.name),
      rawByName,
      databaseDetails,
      bucketInfos
    ),
    fetchedAt: new Date().toISOString()
  }
}
