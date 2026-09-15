import assert from 'node:assert/strict'
import { test } from 'node:test'
import { build } from 'esbuild'
import { createRequire } from 'node:module'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

test('bucket creation validates input, uses tenant namespace and handles conflicts', async () => {
  const folder = await mkdtemp(join(tmpdir(), 'sealos-storage-test-'))
  try {
    await build({
      entryPoints: [new URL('../src/core/sealos/storage.ts', import.meta.url).pathname],
      bundle: true, platform: 'node', format: 'cjs', outfile: join(folder, 'storage.cjs'),
      plugins: [{ name: 'mock-cluster', setup(b) {
        b.onResolve({ filter: /^(@kubernetes\/client-node|minio|\.\/auth)$/ }, args => ({ path: args.path, namespace: 'mock' }))
        b.onLoad({ filter: /.*/, namespace: 'mock' }, args => ({ contents:
          args.path === './auth' ? 'export const getKubeconfigPath = () => "test"' :
          args.path === 'minio' ? 'export class Client {}' : `
            export class CustomObjectsApi {}
            export class CoreV1Api {}
            export class KubeConfig {
              loadFromFile() {} getCurrentContext() { return 'test' }
              getContextObject() { return { namespace: 'ns-test' } }
              makeApiClient() { return { createNamespacedCustomObject: async request => {
                globalThis.bucketRequests.push(request)
                if (globalThis.bucketFailure) throw globalThis.bucketFailure
              } } }
            }`
        }))
      } }]
    })
    const { createStorageBucket } = createRequire(import.meta.url)(join(folder, 'storage.cjs'))
    globalThis.bucketRequests = []
    for (const name of ['', 'ab', 'Uppercase', 'has_space', '-start', 'end-', 'a'.repeat(64)]) {
      await assert.rejects(createStorageBucket(name), /Bucket 名称/)
    }
    assert.equal(globalThis.bucketRequests.length, 0)
    await createStorageBucket('my-files')
    const request = globalThis.bucketRequests[0]
    assert.equal(request.namespace, 'ns-test')
    assert.equal(request.plural, 'objectstoragebuckets')
    assert.deepEqual(request.body, {
      apiVersion: 'objectstorage.sealos.io/v1', kind: 'ObjectStorageBucket',
      metadata: { name: 'my-files', namespace: 'ns-test' }, spec: { policy: 'private' }
    })
    await createStorageBucket('public-files', 'publicRead')
    assert.equal(globalThis.bucketRequests[1].body.spec.policy, 'publicRead')
    await assert.rejects(createStorageBucket('bad-policy', 'publicReadwrite'), /不支持的访问策略/)
    assert.equal(globalThis.bucketRequests.length, 2)
    globalThis.bucketFailure = { code: 409 }
    await assert.rejects(createStorageBucket('my-files'), /同名 Bucket 已存在/)
    globalThis.bucketFailure = new Error('Forbidden')
    await assert.rejects(createStorageBucket('my-files'), /Forbidden/)
  } finally {
    delete globalThis.bucketRequests
    delete globalThis.bucketFailure
    await rm(folder, { recursive: true, force: true })
  }
})
