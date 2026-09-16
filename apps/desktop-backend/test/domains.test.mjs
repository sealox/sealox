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
  const originalFetch = globalThis.fetch
  globalThis.fetch = async url => {
    if (url.pathname === '/api/platform/authCname') {
      if(globalThis.domainFixture.switchContext) globalThis.domainFixture.context = 'changed';
      return {status:404}
    }
    assert.equal(url.origin, 'https://dns.google')
    assert.equal(url.searchParams.get('type'), 'CNAME')
    return {ok:true, json:async () => ({Status:0, Answer: globalThis.domainFixture.doh ?? []})}
  }
  try {
    await build({ entryPoints: [new URL('../src/core/sealos/domains.ts', import.meta.url).pathname], bundle: true, platform: 'node', format: 'cjs', outfile: join(folder, 'domains.cjs'),
      plugins: [{ name: 'mock', setup(b) {
        b.onResolve({ filter: /^(@kubernetes\/client-node|node:dns\/promises|\.\/auth|\.\/resources)$/ }, a => ({ path: a.path, namespace: 'mock' }))
        b.onLoad({ filter: /.*/, namespace: 'mock' }, a => ({ contents:
          a.path === './auth' ? 'export const getKubeconfigPath = () => "test"; export const loadAuthJson = () => ({region:"https://region.test"}); export const readKubeconfigText = () => globalThis.domainFixture.context ?? "test"' :
          a.path === './resources' ? 'export const APP_LABEL = "cloud.sealos.io/app-deploy-manager"' :
          a.path === 'node:dns/promises' ? 'export class Resolver { async resolveCname() { return globalThis.domainFixture.dns } }' : `
          export class Observable { constructor(value) {this.value=value} }
          export class NetworkingV1Api {} export class CustomObjectsApi {}
          export class KubeConfig {
            loadFromString() {} getCurrentContext() {return 'test'}
            getContextObject() {return {namespace:'ns-test'}}
            makeApiClient() { const f=globalThis.domainFixture; return {
              listNamespacedIngress: async () => ({items:f.list}),
              createNamespacedIngress: async r => {f.writes.push(r); f.list.push(structuredClone(r.body))},
              createNamespacedCustomObject: async r => {
                if(f.failPlural === r.plural) throw {code:503};
                const key=r.plural+'/'+r.body.metadata.name;
                if(f.objects[key]) throw {code:409};
                f.objects[key]=r.body; f.writes.push(r)
              },
              getNamespacedCustomObject: async r => { if(f.certificateError) throw {code:403}; return f.objects[r.plural+'/'+r.name] }
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
    // A Fake-IP resolver returns no CNAME; authoritative HTTPS DNS still works.
    globalThis.domainFixture.doh = [{name:'app.example.com.',type:1,data:'198.18.0.1'}]
    await assert.rejects(bindDomain('https://app.platform.test', 'app.example.com'), /CNAME 尚未生效/)
    assert.equal(globalThis.domainFixture.writes.length, 0)
    globalThis.domainFixture.doh = [{name:'app.example.com.',type:5,data:'app.platform.test.'}]
    assert.equal((await bindDomain('https://app.platform.test', 'app.example.com')).url, 'https://app.example.com')
    const f = globalThis.domainFixture
    f.dns = ['app.platform.test.']
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
    assert.deepEqual((await getDomainBinding('https://app.platform.test')).certificates,
      [{domain:'app.example.com',status:'pending'}])
    const certificate = Object.values(f.objects).find(o => o.kind === 'Certificate')
    certificate.status = {conditions:[{type:'Ready',status:'True'}]}
    assert.equal((await getDomainBinding('https://app.platform.test')).certificates[0].status, 'ready')
    certificate.status.notAfter = '2000-01-01T00:00:00Z'
    assert.equal((await getDomainBinding('https://app.platform.test')).certificates[0].status, 'expired')
    certificate.status = {conditions:[{type:'Issuing',status:'False',reason:'Failed',message:'ACME validation failed'}]}
    assert.equal((await getDomainBinding('https://app.platform.test')).certificates[0].status, 'failed')
    f.certificateError = true
    assert.equal((await getDomainBinding('https://app.platform.test')).certificates[0].status, 'unknown')
    f.certificateError = false
    // Binding from an alias must use the current original route, not its stale copy.
    f.list[0].spec.rules[0].http.paths[0].backend.service.port.number = 8080
    assert.equal(f.list[1].spec.rules[0].http.paths[0].backend.service.port.number, 3000)
    await bindDomain('https://app.example.com', 'second.example.com')
    const second = f.list.find(i => i.spec.rules?.some(r => r.host === 'second.example.com'))
    assert.equal(second.spec.rules[0].http.paths[0].backend.service.port.number, 8080)
    assert.equal((await getDomainBinding('https://second.example.com')).target, 'app.platform.test')
    f.failPlural = 'certificates'
    await assert.rejects(bindDomain('https://app.platform.test', 'retry.example.com'))
    assert.ok(!f.list.some(i => i.spec.rules?.some(r => r.host === 'retry.example.com')))
    f.failPlural = null
    await bindDomain('https://app.platform.test', 'retry.example.com')
    assert.equal(f.list.filter(i => i.spec.rules?.some(r => r.host === 'retry.example.com')).length, 1)
    const writesBeforeSwitch = f.writes.length
    f.switchContext = true
    await assert.rejects(bindDomain('https://app.platform.test', 'switch.example.com'), /工作空间已切换/)
    assert.equal(f.writes.length, writesBeforeSwitch)
    f.switchContext = false
    f.context = 'test'
    f.list.shift()
    const writesBefore = f.writes.length
    await assert.rejects(bindDomain('https://app.example.com', 'third.example.com'), /原公网入口已删除/)
    assert.equal(f.writes.length, writesBefore)
    await assert.rejects(verifyCname('a.example.com', 'app.platform.test', async () => ['a.example.com']), /CNAME 尚未生效/)
  } finally { globalThis.fetch = originalFetch; delete globalThis.domainFixture; await rm(folder, {recursive:true,force:true}) }
})
