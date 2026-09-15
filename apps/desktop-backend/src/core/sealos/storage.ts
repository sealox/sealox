import * as k8s from '@kubernetes/client-node'
import * as Minio from 'minio'
import { getKubeconfigPath } from './auth'

function clientContext(): { kc: k8s.KubeConfig; namespace: string } {
  const kc = new k8s.KubeConfig(); kc.loadFromFile(getKubeconfigPath())
  const namespace = kc.getContextObject(kc.getCurrentContext())?.namespace
  if (!namespace) throw new Error('kubeconfig 里没有 namespace')
  return { kc, namespace }
}

export async function createStorageBucket(name: string, policy = 'private'): Promise<void> {
  if (policy !== 'private' && policy !== 'publicRead') throw new Error('不支持的访问策略')
  if (!/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(name)) {
    throw new Error('Bucket 名称须为 3–63 位小写字母、数字或连字符，且以字母或数字开头和结尾')
  }
  const { kc, namespace } = clientContext()
  try {
    await kc.makeApiClient(k8s.CustomObjectsApi).createNamespacedCustomObject({
      group: 'objectstorage.sealos.io', version: 'v1', namespace,
      plural: 'objectstoragebuckets',
      body: {
        apiVersion: 'objectstorage.sealos.io/v1', kind: 'ObjectStorageBucket',
        metadata: { name, namespace }, spec: { policy }
      }
    })
  } catch (error) {
    if ((error as { code?: number }).code === 409) throw new Error('同名 Bucket 已存在，请更换名称')
    throw error
  }
}

export async function getStorageCredentials(bucket: string) {
  const { kc, namespace } = clientContext()
  const custom = kc.makeApiClient(k8s.CustomObjectsApi)
  const list = await custom.listNamespacedCustomObject({group:'objectstorage.sealos.io',version:'v1',namespace,plural:'objectstoragebuckets'}) as any
  const item = (list.items ?? []).find((x: any) => x.metadata?.name === bucket || x.status?.name === bucket)
  if (!item) throw new Error(`未找到文件存储：${bucket}`)
  const actual = item.status?.name ?? bucket
  const secretName = `object-storage-key-${actual}`
  const secret = await kc.makeApiClient(k8s.CoreV1Api).readNamespacedSecret({name: secretName, namespace})
  const data = secret.data ?? {}
  const decode = (key: string) => data[key] ? Buffer.from(data[key], 'base64').toString() : ''
  const endpoint = decode('external') || decode('internal')
  return {bucket: actual, url: endpoint.includes('://') ? endpoint : `https://${endpoint}`, accessKey: decode('accessKey'), secretKey: decode('secretKey')}
}

export async function getWorkspaceStorageCredentials() {
  const { kc, namespace } = clientContext()
  const secret = await kc.makeApiClient(k8s.CoreV1Api).readNamespacedSecret({name: 'object-storage-key', namespace})
  const decode = (key: string) => Buffer.from(secret.data?.[key] ?? '', 'base64').toString()
  const endpoint = decode('external') || decode('internal')
  if (!endpoint || !decode('accessKey') || !decode('secretKey')) throw new Error('当前工作空间的对象存储凭证不完整')
  return {url: endpoint.includes('://') ? endpoint : `https://${endpoint}`, accessKey: decode('accessKey'), secretKey: decode('secretKey')}
}

async function clientFor(bucket: string): Promise<{client: Minio.Client; bucket: string}> {
  const credentials = await getStorageCredentials(bucket)
  const url = new URL(credentials.url)
  return {bucket: credentials.bucket, client: new Minio.Client({endPoint: url.hostname, port: url.port ? Number(url.port) : (url.protocol === 'http:' ? 80 : 443), useSSL: url.protocol !== 'http:', accessKey: credentials.accessKey, secretKey: credentials.secretKey})}
}

export async function listStorageObjects(bucket: string, prefix = ''): Promise<unknown[]> {
  const {client, bucket: actual} = await clientFor(bucket)
  const rows: unknown[] = []
  return await new Promise((resolve, reject) => {
    const stream = client.listObjectsV2(actual, prefix, false)
    stream.on('data', (obj) => rows.push({name: obj.prefix || obj.name, size: obj.size, lastModified: obj.lastModified?.toISOString()}))
    stream.on('error', reject); stream.on('end', () => resolve(rows))
  })
}

export async function uploadStorageObject(bucket: string, name: string, contentBase64: string): Promise<void> {
  const {client, bucket: actual} = await clientFor(bucket)
  const body = Buffer.from(contentBase64, 'base64')
  await client.putObject(actual, name.replace(/^\/+/, ''), body)
}
export async function deleteStorageObject(bucket: string, name: string): Promise<void> {
  const {client, bucket: actual} = await clientFor(bucket)
  if (!name) throw new Error('不能删除根目录')
  if (name.endsWith('/')) {
    const keys: string[] = []
    for await (const item of client.listObjectsV2(actual, name, true)) {
      if (item.name) keys.push(item.name)
      if (keys.length === 1000) { await client.removeObjects(actual, keys); keys.length = 0 }
    }
    if (keys.length) await client.removeObjects(actual, keys)
  } else await client.removeObject(actual, name)
}
export async function createStorageFolder(bucket: string, name: string): Promise<void> {
  const {client, bucket: actual} = await clientFor(bucket)
  const key = name.replace(/^\/+|\/+$/g, '') + '/'
  if (key === '/') throw new Error('文件夹名称不能为空')
  await client.putObject(actual, key, Buffer.alloc(0))
}
export async function getStorageDownloadUrl(bucket: string, name: string): Promise<string> {
  const {client, bucket: actual} = await clientFor(bucket)
  return client.presignedGetObject(actual, name, 900)
}

export async function getStorageInfo(bucket: string): Promise<Record<string, unknown>> {
  const { kc, namespace } = clientContext()
  const list = await kc.makeApiClient(k8s.CustomObjectsApi).listNamespacedCustomObject({group:'objectstorage.sealos.io',version:'v1',namespace,plural:'objectstoragebuckets'}) as any
  const item = (list.items ?? []).find((x: any) => x.metadata?.name === bucket || x.status?.name === bucket)
  if (!item) throw new Error(`未找到文件存储：${bucket}`)
  return { name:item.metadata?.name ?? bucket, bucketName:item.status?.name ?? bucket, policy:item.spec?.policy ?? 'private', createdAt:item.metadata?.creationTimestamp, namespace }
}

export async function uploadStorageFile(bucket: string, name: string, path: string): Promise<void> {
  if (!name || name.endsWith('/')) throw new Error('文件名无效')
  const {client, bucket: actual} = await clientFor(bucket)
  await client.fPutObject(actual, name, path)
}
export async function downloadStorageFile(bucket: string, name: string, path: string): Promise<void> {
  const {client, bucket: actual} = await clientFor(bucket)
  await client.fGetObject(actual, name, path)
}

/** Public means anonymous read only; never enable public writes. */
export async function setStoragePolicy(bucket: string, policy: string): Promise<void> {
  if (policy !== 'private' && policy !== 'publicRead') throw new Error('不支持的访问策略')
  const {kc, namespace} = clientContext()
  const api = kc.makeApiClient(k8s.CustomObjectsApi)
  const request = {group: 'objectstorage.sealos.io', version: 'v1', namespace, plural: 'objectstoragebuckets', name: bucket}
  const current = await api.getNamespacedCustomObject(request) as {spec?: Record<string, unknown>}
  // Preserve metadata.resourceVersion so concurrent edits fail rather than being overwritten.
  await api.replaceNamespacedCustomObject({...request, body: {...current, spec: {...current.spec, policy}}})
}
