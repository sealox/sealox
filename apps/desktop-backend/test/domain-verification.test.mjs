import assert from 'node:assert/strict'
import { test } from 'node:test'
import { build } from 'esbuild'
import { createRequire } from 'node:module'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

test('domain verification follows the AppLaunchpad contract and fails closed', async t => {
  const folder = await mkdtemp(join(tmpdir(), 'sealos-domain-verification-'))
  const originalFetch = globalThis.fetch
  try {
    await build({ entryPoints: [new URL('../src/core/sealos/domain-verification.ts', import.meta.url).pathname],
      bundle: true, platform: 'node', format: 'cjs', outfile: join(folder, 'verify.cjs'),
      plugins: [{name:'dns',setup(b) {
        b.onResolve({filter:/^node:dns\/promises$/}, () => ({path:'dns',namespace:'mock'}))
        b.onLoad({filter:/.*/,namespace:'mock'}, () => ({contents:'export class Resolver { async resolveCname() { throw new Error("local DNS unavailable") } }'}))
      }}] })
    const { verifyDomain, verifyCname } = createRequire(import.meta.url)(join(folder, 'verify.cjs'))
    const verify = () => verifyDomain('app.example.com', 'app.platform.test', 'https://region.test')
    const response = body => ({ok:true,status:200,json:async () => body})
    await t.test('uses server verification without sending kubeconfig or tokens', async () => {
      globalThis.fetch = async (url, options) => {
        assert.equal(url.href, 'https://applaunchpad.region.test/api/platform/authCname')
        assert.deepEqual(options.headers, {'Content-Type':'application/json'})
        assert.equal(options.redirect, 'error')
        assert.deepEqual(JSON.parse(options.body), {publicDomain:'app.platform.test',customDomain:'app.example.com'})
        return response({code:200,data:{type:'CNAME',data:'app.platform.test.'}})
      }
      await verify()
    })
    await t.test('does not bypass an authoritative rejection with local DNS', async () => {
      let calls = 0
      globalThis.fetch = async () => { calls++; return response({code:400,message:'CNAME target mismatch'}) }
      await assert.rejects(verify(), /区域验证未通过/)
      assert.equal(calls, 1)
    })
    await t.test('rejects malformed successes and incorrect record types or targets', async () => {
      for (const data of [undefined, {type:'A',data:'app.platform.test'}, {type:'CNAME',data:'wrong.test'}]) {
        globalThis.fetch = async () => response({code:200,data})
        await assert.rejects(verify(), /未返回有效/)
      }
    })
    await t.test('falls back to HTTPS DNS when old deployments lack the endpoint', async () => {
      globalThis.fetch = async url => url.hostname === 'dns.google'
        ? response({Status:0,Answer:[{name:'app.example.com.',type:5,data:'app.platform.test.'}]})
        : {status:404}
      await verify()
    })
    await t.test('distinguishes network failures from DNS record mismatches', async () => {
      globalThis.fetch = async () => { throw new Error('offline') }
      await assert.rejects(verify(), /暂时无法判断 CNAME 是否生效/)
    })
    await t.test('rejects loops and follows normalized CNAME chains', async () => {
      await verifyCname('app.example.com','app.platform.test',async name => name === 'app.example.com' ? ['alias.test.'] : ['APP.PLATFORM.TEST.'])
      await assert.rejects(verifyCname('app.example.com','app.platform.test',async () => ['app.example.com.']), /CNAME 尚未生效/)
    })
    await t.test('refuses insecure region URLs before requests', async () => {
      globalThis.fetch = async () => { assert.fail('must not fetch') }
      await assert.rejects(verifyDomain('app.example.com','app.platform.test','http://region.test'), /区域地址无效/)
    })
  } finally {
    globalThis.fetch = originalFetch
    await rm(folder, {recursive:true,force:true})
  }
})
