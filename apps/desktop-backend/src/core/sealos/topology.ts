import type { V1Container, V1Deployment, V1StatefulSet } from '@kubernetes/client-node'
import type { BucketInfo, DatabaseDetail, ProjectLink } from '../../shared/types'

interface EnvHints {
  secretNames: string[]
  literals: string[]
}

function envHints(workload: V1Deployment | V1StatefulSet): EnvHints {
  const secretNames = new Set<string>()
  const literals = new Set<string>()
  const spec = workload.spec?.template?.spec
  const containers: V1Container[] = [...(spec?.containers ?? []), ...(spec?.initContainers ?? [])]
  for (const container of containers) {
    for (const env of container.env ?? []) {
      const secret = env.valueFrom?.secretKeyRef?.name
      if (secret) secretNames.add(secret)
      if (env.value) literals.add(env.value)
    }
    for (const src of container.envFrom ?? []) {
      if (src.secretRef?.name) secretNames.add(src.secretRef.name)
    }
  }
  return { secretNames: [...secretNames], literals: [...literals] }
}

function secretMatchesDb(secret: string, dbName: string): boolean {
  if (secret === `${dbName}-conn-credential`) return true
  if (!secret.startsWith(`${dbName}-`)) return false
  return secret.includes('conn-credential') || secret.includes('-account-')
}

/** in-namespace Service 名 / FQDN / DSN 里会出现 `{db}-postgresql` 这类片段 */
function literalMatchesDb(value: string, dbName: string): boolean {
  return value === dbName || value.includes(`${dbName}-`) || value.includes(`${dbName}.`)
}

/** Service 名只在 DNS/URL 边界上匹配，避免把 api 错认成 my-api。 */
function literalMatchesService(value: string, serviceName: string): boolean {
  const escaped = serviceName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`(^|[^a-z0-9-])${escaped}($|[^a-z0-9-])`, 'i').test(value)
}

function matchesBucket(hints: EnvHints, bucket: BucketInfo): boolean {
  const ids = [bucket.name, bucket.bucketName].filter((id): id is string => Boolean(id))
  for (const id of ids) {
    if (hints.literals.includes(id)) return true
    if (
      hints.secretNames.some(
        (secret) => secret.startsWith('object-storage-key-') && secret.endsWith(`-${id}`)
      )
    ) {
      return true
    }
  }
  return false
}

/** 单份库：env 是否已证实引用该库。不用「只有一个应用就全连上」的回退 */
export function workloadUsesDatabase(
  workload: V1Deployment | V1StatefulSet,
  dbName: string,
  connSecret?: string
): boolean {
  const hints = envHints(workload)
  return (
    hints.secretNames.some((secret) => secretMatchesDb(secret, dbName)) ||
    (connSecret !== undefined && hints.secretNames.includes(connSecret)) ||
    hints.literals.some((value) => literalMatchesDb(value, dbName))
  )
}

function addLink(links: ProjectLink[], seen: Set<string>, link: ProjectLink): void {
  const key = `${link.app}\0${link.targetKind}\0${link.target}`
  if (seen.has(key)) return
  seen.add(key)
  links.push(link)
}

/**
 * 从 workload env 证实应用→应用/库/桶。明文只在主进程里匹配，不进返回值。
 * 一条边都没有且只有一个应用时，连到名下全部库和桶（商店模板常把 host 写在配置文件里）。
 */
export function inferProjectLinks(
  appNames: string[],
  workloadsByName: Map<string, V1Deployment | V1StatefulSet>,
  databases: DatabaseDetail[],
  buckets: BucketInfo[]
): ProjectLink[] {
  const links: ProjectLink[] = []
  const seen = new Set<string>()

  for (const app of appNames) {
    const raw = workloadsByName.get(app)
    if (!raw) continue
    const hints = envHints(raw)
    for (const target of appNames) {
      if (target !== app && hints.literals.some((value) => literalMatchesService(value, target))) {
        addLink(links, seen, { app, targetKind: 'service', target })
      }
    }
    for (const db of databases) {
      if (workloadUsesDatabase(raw, db.name, db.connSecret)) {
        addLink(links, seen, { app, targetKind: 'database', target: db.name })
      }
    }
    for (const bucket of buckets) {
      if (matchesBucket(hints, bucket)) {
        addLink(links, seen, { app, targetKind: 'bucket', target: bucket.name })
      }
    }
  }

  if (links.length === 0 && appNames.length === 1) {
    const app = appNames[0]
    for (const db of databases) {
      addLink(links, seen, { app, targetKind: 'database', target: db.name })
    }
    for (const bucket of buckets) {
      addLink(links, seen, { app, targetKind: 'bucket', target: bucket.name })
    }
  }

  return links
}
