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

function addLink(links: ProjectLink[], seen: Set<string>, link: ProjectLink): void {
  const key = `${link.app}\0${link.targetKind}\0${link.target}`
  if (seen.has(key)) return
  seen.add(key)
  links.push(link)
}

/**
 * 从 workload env 证实应用→库/桶。明文只在主进程里匹配，不进返回值。
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
    for (const db of databases) {
      const hit =
        hints.secretNames.some((secret) => secretMatchesDb(secret, db.name)) ||
        (db.connSecret !== undefined && hints.secretNames.includes(db.connSecret)) ||
        hints.literals.some((value) => literalMatchesDb(value, db.name))
      if (hit) addLink(links, seen, { app, targetKind: 'database', target: db.name })
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
