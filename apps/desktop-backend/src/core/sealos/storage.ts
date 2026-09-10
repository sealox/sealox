import * as k8s from '@kubernetes/client-node'
import * as Minio from 'minio'
import { KUBECONFIG_PATH } from './auth'

function clientContext(): { kc: k8s.KubeConfig; namespace: string } {
  const kc = new k8s.KubeConfig(); kc.loadFromFile(KUBECONFIG_PATH)
  const namespace = kc.getContextObject(kc.getCurrentContext())?.namespace
  if (!namespace) throw new Error('kubeconfig 里没有 namespace')
  return { kc, namespace }
}

async function clientFor(bucket: string): Promise<{ client: Minio.Client; bucket: string }> {
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
  const url = new URL(endpoint.includes('://') ? endpoint : `https://${endpoint}`)
  return { bucket: actual, client: new Minio.Client({endPoint:url.hostname, port:url.port ? Number(url.port) : (url.protocol === 'http:' ? 80 : 443), useSSL:url.protocol !== 'http:', accessKey:decode('accessKey'), secretKey:decode('secretKey')}) }
}

export async function listStorageObjects(bucket: string, prefix = ''): Promise<unknown[]> {
  const {client, bucket: actual} = await clientFor(bucket)
  const rows: unknown[] = []
  return await new Promise((resolve, reject) => {
    const stream = client.listObjectsV2(actual, prefix, false)
    stream.on('data', (obj) => rows.push({name: obj.name, size: obj.size, lastModified: obj.lastModified?.toISOString()}))
    stream.on('error', reject); stream.on('end', () => resolve(rows))
  })
}
