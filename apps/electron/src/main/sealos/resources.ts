import * as k8s from '@kubernetes/client-node'
import type { V1Ingress, V1Pod } from '@kubernetes/client-node'
import type {
  AppStatus,
  AppWorkload,
  BucketInfo,
  DatabaseInfo,
  InstanceInfo,
  PodInfo,
  ResourceSnapshot
} from '../../shared/types'
import { KUBECONFIG_PATH, readKubeconfigText } from './auth'

const INSTANCE_LABEL = 'cloud.sealos.io/deploy-on-sealos'
const APP_LABEL = 'cloud.sealos.io/app-deploy-manager'

const STUCK_REASONS = new Set([
  'CrashLoopBackOff',
  'ImagePullBackOff',
  'ErrImagePull',
  'CreateContainerConfigError',
  'CreateContainerError',
  'InvalidImageName',
  'OOMKilled'
])

function podInfo(pod: V1Pod): PodInfo {
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
function podsForWorkload(
  pods: V1Pod[],
  kind: 'Deployment' | 'StatefulSet',
  name: string
): PodInfo[] {
  return pods
    .filter((pod) =>
      (pod.metadata?.ownerReferences ?? []).some((ref) => {
        if (kind === 'StatefulSet') return ref.kind === 'StatefulSet' && ref.name === name
        return ref.kind === 'ReplicaSet' && new RegExp(`^${name}-[a-z0-9]+$`).test(ref.name)
      })
    )
    .map(podInfo)
}

function urlsForApp(ingresses: V1Ingress[], appName: string): string[] {
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

interface KubeBlocksCluster {
  metadata?: { name?: string; labels?: Record<string, string> }
  spec?: { clusterDefinitionRef?: string; clusterVersionRef?: string }
  status?: { phase?: string }
}

async function listDatabases(
  kc: k8s.KubeConfig,
  namespace: string,
  warnings: string[]
): Promise<DatabaseInfo[]> {
  const custom = kc.makeApiClient(k8s.CustomObjectsApi)
  for (const version of ['v1alpha1', 'v1']) {
    try {
      const resp = (await custom.listNamespacedCustomObject({
        group: 'apps.kubeblocks.io',
        version,
        namespace,
        plural: 'clusters'
      })) as { items?: KubeBlocksCluster[] }
      return (resp.items ?? []).map((cluster) => ({
        name: cluster.metadata?.name ?? '',
        engine:
          cluster.spec?.clusterDefinitionRef ??
          cluster.metadata?.labels?.['clusterdefinition.kubeblocks.io/name'],
        version:
          cluster.spec?.clusterVersionRef ??
          cluster.metadata?.labels?.['clusterversion.kubeblocks.io/name'],
        phase: cluster.status?.phase ?? 'Unknown',
        instance: cluster.metadata?.labels?.[INSTANCE_LABEL]
      }))
    } catch (err) {
      const status = (err as { code?: number }).code
      if (status === 404) continue
      warnings.push(`数据库列表读取失败：${err instanceof Error ? err.message : String(err)}`)
      return []
    }
  }
  return []
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
      instance: bucket.metadata?.labels?.[INSTANCE_LABEL]
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

async function listTemplateInstances(
  regionDomain: string,
  warnings: string[]
): Promise<InstanceInfo[]> {
  try {
    const resp = await fetch(`https://template.${regionDomain}/api/instance/list`, {
      headers: { Authorization: encodeURIComponent(readKubeconfigText()) },
      signal: AbortSignal.timeout(30_000)
    })
    if (!resp.ok) {
      warnings.push(`模板实例列表读取失败（HTTP ${resp.status}）`)
      return []
    }
    const body = (await resp.json()) as { data?: unknown }
    let items = body?.data ?? []
    if (!Array.isArray(items)) {
      items = (items as { items?: unknown[] })?.items ?? []
    }
    return (
      items as Array<{
        metadata?: { name?: string; creationTimestamp?: string }
        spec?: { title?: string; templateType?: string }
      }>
    ).map((item) => ({
      name: item.metadata?.name ?? '',
      template: item.spec?.title ?? item.spec?.templateType,
      createdAt: item.metadata?.creationTimestamp
    }))
  } catch (err) {
    warnings.push(`模板实例列表读取失败：${err instanceof Error ? err.message : String(err)}`)
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
  const [deployments, statefulSets, pods, ingresses, databases, instances, buckets] =
    await Promise.all([
      apps.listNamespacedDeployment({ namespace }),
      apps.listNamespacedStatefulSet({ namespace }),
      core.listNamespacedPod({ namespace }),
      networking.listNamespacedIngress({ namespace }),
      listDatabases(kc, namespace, warnings),
      listTemplateInstances(regionDomain, warnings),
      listBuckets(kc, namespace, warnings)
    ])

  const podItems = pods.items ?? []
  const ingressItems = ingresses.items ?? []
  const workloads: AppWorkload[] = []

  for (const deploy of deployments.items ?? []) {
    const name = deploy.metadata?.name ?? ''
    const replicas = deploy.spec?.replicas ?? 0
    const ready = deploy.status?.readyReplicas ?? 0
    const workloadPods = podsForWorkload(podItems, 'Deployment', name)
    workloads.push({
      name,
      kind: 'Deployment',
      replicas,
      readyReplicas: ready,
      status: appStatus(replicas, ready, workloadPods),
      images: (deploy.spec?.template?.spec?.containers ?? []).map((c) => c.image ?? ''),
      urls: urlsForApp(ingressItems, name),
      instance: deploy.metadata?.labels?.[INSTANCE_LABEL],
      pods: workloadPods
    })
  }

  for (const sts of statefulSets.items ?? []) {
    const name = sts.metadata?.name ?? ''
    // KubeBlocks manages database StatefulSets; those surface in the
    // databases section instead of the apps section.
    const managedBy = sts.metadata?.labels?.['app.kubernetes.io/managed-by']
    if (managedBy === 'kubeblocks') continue
    const replicas = sts.spec?.replicas ?? 0
    const ready = sts.status?.readyReplicas ?? 0
    const workloadPods = podsForWorkload(podItems, 'StatefulSet', name)
    workloads.push({
      name,
      kind: 'StatefulSet',
      replicas,
      readyReplicas: ready,
      status: appStatus(replicas, ready, workloadPods),
      images: (sts.spec?.template?.spec?.containers ?? []).map((c) => c.image ?? ''),
      urls: urlsForApp(ingressItems, name),
      instance: sts.metadata?.labels?.[INSTANCE_LABEL],
      pods: workloadPods
    })
  }

  return {
    namespace,
    regionDomain,
    fetchedAt: new Date().toISOString(),
    apps: workloads.sort((a, b) => a.name.localeCompare(b.name)),
    databases,
    instances,
    buckets,
    warnings
  }
}
