import assert from 'node:assert/strict'
import { test } from 'node:test'
import { build } from 'esbuild'
import { createRequire } from 'node:module'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

test('domain binding verifies DNS before writes and preserves the original route', async () => {
  const folder = await mkdtemp(join(tmpdir(), 'sealos-domain-test-'))
  const source = { metadata: { name: 'app', labels: { 'cloud.sealos.io/app-deploy-manager': 'app' }, annotations: { 'kubernetes.io/ingress.class': 'nginx' } },
    spec: { rules: [{ host: 'app.platform.test', http: { paths: [{ path: '/', pathType: 'Prefix', backend: { service: { name: 'app', port: { number: 3000 } } } }] } }], tls: [{ hosts: ['app.platform.test'], secretName: 'wildcard-cert' }] } }
  globalThis.domainFixture = { list: [structuredClone(source)], writes: [], dns: [], objects: {} }
  try {
    await build({ entryPoints: [new URL('../src/core/sealos/domains.ts', import.meta.url).pathname], bundle: true, platform: 'node', format: 'cjs', outfile: join(folder, 'domains.cjs'),
      plugins: [{ name: 'mock', setup(b) {
        b.onResolve({ filter: /^(@kubernetes\/client-node|node:dns\/promises|\.\/auth|\.\/resources)$/ }, a => ({ path: a.path, namespace: 'mock' }))
        b.onLoad({ filter: /.*/, namespace: 'mock' }, a => ({ contents:
          a.path === './auth' ? 'export const getKubeconfigPath = () => "test"' :
          a.path === './resources' ? 'export const APP_LABEL = "cloud.sealos.io/app-deploy-manager"' :
          a.path === 'node:dns/promises' ? 'export class Resolver { async resolveCname() { return globalThis.domainFixture.dns } }' : `
          export class NetworkingV1Api {} export class CustomObjectsApi {}
          export class KubeConfig {
            loadFromFile() {} getCurrentContext() {return 'test'}
            getContextObject() {return {namespace:'ns-test'}}
            makeApiClient() { const f=globalThis.domainFixture; return {
              listNamespacedIngress: async () => ({items:f.list}),
              createNamespacedIngress: async r => {f.writes.push(r); f.list.push(r.body)},
              createNamespacedCustomObject: async r => {
                const key=r.plural+'/'+r.body.metadata.name;
                if(f.objects[key]) throw {code:409};
                f.objects[key]=r.body; f.writes.push(r)
              },
              getNamespacedCustomObject: async r => f.objects[r.plural+'/'+r.name]
            } }
          }`
        }))
      } }] })
    const { normalizeDomain, bindDomain, getDomainBinding, verifyCname } = createRequire(import.meta.url)(join(folder, 'domains.cjs'))
    for (const value of ['https://example.com', 'example.com/path', '*.example.com', '127.0.0.1', '-bad.example.com', 'example.com:80']) assert.throws(() => normalizeDomain(value))
    assert.equal(normalizeDomain('App.Example.com.'), 'app.example.com')
    await verifyCname('app.example.com', 'app.platform.test', async name => name === 'app.example.com' ? ['alias.example.com.'] : ['app.platform.test.'])
    await assert.rejects(bindDomain('https://app.platform.test', 'app.example.com'), /CNAME 尚未生效/)
    assert.equal(globalThis.domainFixture.writes.length, 0)
    globalThis.domainFixture.dns = ['app.platform.test.']
    assert.equal((await bindDomain('https://app.platform.test', 'app.example.com')).url, 'https://app.example.com')
    const f = globalThis.domainFixture
    assert.deepEqual(f.list[0], source)
    assert.equal(f.writes.length, 3)
    assert.ok(f.writes.every(w => w.namespace === 'ns-test'))
    assert.equal(f.list[1].spec.rules[0].host, 'app.example.com')
    assert.deepEqual(f.list[1].spec.rules[0].http, source.spec.rules[0].http)
    assert.notEqual(f.list[1].spec.tls[0].secretName, 'wildcard-cert')
    assert.deepEqual((await getDomainBinding('https://app.example.com')).domains, ['app.example.com'])
    await bindDomain('https://app.platform.test', 'app.example.com')
    assert.equal(f.writes.length, 3, 'retry is idempotent')
    f.list.push({metadata: {}, spec: {rules: [{host:'taken.example.com'}]}})
    await assert.rejects(bindDomain('https://app.platform.test', 'taken.example.com'), /已绑定其他入口/)
    assert.equal(f.writes.length, 3)
  } finally { delete globalThis.domainFixture; await rm(folder, {recursive:true,force:true}) }
})
