import assert from 'node:assert/strict'
import { existsSync, mkdtempSync } from 'node:fs'
import { readFile, rm, stat, lstat } from 'node:fs/promises'
import { register } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, afterEach, beforeEach, test } from 'node:test'

register(
  `data:text/javascript,${encodeURIComponent(`
    export async function resolve(specifier, context, nextResolve) {
      if (specifier.startsWith('.') && !/\\.[cm]?[jt]s$/.test(specifier)) {
        try {
          return await nextResolve(specifier + '.ts', context)
        } catch (err) {
          if (err?.code !== 'ERR_MODULE_NOT_FOUND') throw err
        }
      }
      return nextResolve(specifier, context)
    }
  `)}`,
  import.meta.url
)

const sealosDir = mkdtempSync(join(tmpdir(), 'helios-contexts-'))
process.env.SEALOS_DIR = sealosDir
process.env.SEALOS_KUBECONFIG = join(sealosDir, 'kubeconfig')

const { prefetchSiteContexts, writeContext } = await import('../src/core/sealos/contexts.ts')
const { AUTH_PATH, KUBECONFIG_PATH, getStatus, logout, saveCredentials } = await import(
  '../src/core/sealos/auth.ts'
)

const LIVE_UID = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeee1'
const TEAM_UID = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeee2'
const HZH_UID = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeee3'

const originalFetch = globalThis.fetch

function kubeconfig(namespace, server) {
  return [
    'apiVersion: v1',
    'clusters:',
    '- cluster:',
    `    server: ${server}`,
    'contexts:',
    '- context:',
    `    namespace: ${namespace}`,
    'users:',
    '- user:',
    '    token: cluster-token'
  ].join('\n')
}

const liveKubeconfig = kubeconfig('ns-live', 'https://apiserver.gzg.sealos.run')
const teamKubeconfig = kubeconfig('ns-team', 'https://apiserver.gzg.sealos.run')
const hzhKubeconfig = kubeconfig('ns-hzh', 'https://apiserver.hzh.sealos.run')

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' }
  })
}

function installFetchMock() {
  const calls = []
  globalThis.fetch = async (input, init = {}) => {
    const url = String(input)
    const method = (init.method ?? 'GET').toUpperCase()
    const authorization = init.headers?.Authorization
    let body
    try {
      body = init.body ? JSON.parse(init.body) : undefined
    } catch {
      body = undefined
    }
    calls.push({ url, method, authorization, body })

    if (url === 'https://gzg.sealos.run/api/auth/regionList') {
      return jsonResponse({
        code: 200,
        data: {
          regionList: [
            { domain: 'gzg.sealos.run' },
            { domain: 'https://hzh.sealos.run' },
            { domain: 'bja.sealos.run' }
          ]
        }
      })
    }
    if (url === 'https://gzg.sealos.run/api/auth/globalToken') {
      if (authorization !== 'regional-live') {
        return jsonResponse({ code: 401, message: 'invalid token' }, 200)
      }
      return jsonResponse({ code: 200, data: { token: 'global-token' } })
    }
    if (url === 'https://gzg.sealos.run/api/auth/namespace/list') {
      return jsonResponse({
        code: 200,
        data: {
          namespaces: [
            { uid: LIVE_UID, id: 'ns-live', teamName: '私人空间', nstype: 1 },
            { uid: TEAM_UID, id: 'ns-team', teamName: '团队空间', nstype: 0 }
          ]
        }
      })
    }
    if (url === 'https://gzg.sealos.run/api/auth/namespace/switch' && method === 'POST') {
      if (body?.ns_uid === TEAM_UID) {
        return jsonResponse({
          code: 200,
          data: { token: 'regional-gzg-team', appToken: 'app-gzg-team' }
        })
      }
      return jsonResponse({ code: 400, message: 'unexpected switch' }, 200)
    }
    if (url === 'https://gzg.sealos.run/api/auth/getKubeconfig') {
      if (authorization === 'regional-gzg-team') {
        return jsonResponse({ code: 200, data: { kubeconfig: teamKubeconfig } })
      }
      return jsonResponse({ code: 400, message: 'unexpected kubeconfig token' }, 200)
    }
    if (url === 'https://hzh.sealos.run/api/auth/regionToken' && method === 'POST') {
      if (authorization !== 'global-token') {
        return jsonResponse({ code: 401, message: 'invalid token' }, 200)
      }
      return jsonResponse({
        code: 200,
        data: { token: 'regional-hzh', kubeconfig: hzhKubeconfig, appToken: 'app-hzh' }
      })
    }
    if (url === 'https://hzh.sealos.run/api/auth/namespace/list') {
      return jsonResponse({
        code: 200,
        data: [{ uid: HZH_UID, id: 'ns-hzh', teamName: '杭州私人', nstype: 'private' }]
      })
    }
    if (url === 'https://bja.sealos.run/api/auth/regionToken' && method === 'POST') {
      return jsonResponse({ code: 409, message: 'workspace is not inited' }, 200)
    }
    return jsonResponse({ code: 404, message: `unmocked ${method} ${url}` }, 404)
  }
  return calls
}

async function seedLiveSlot() {
  await saveCredentials(
    'https://gzg.sealos.run',
    'access-live',
    'regional-live',
    liveKubeconfig,
    { uid: LIVE_UID, id: 'ns-live', teamName: '私人空间' },
    'app-live'
  )
}

beforeEach(async () => {
  await rm(join(sealosDir, 'contexts'), { recursive: true, force: true })
  await rm(KUBECONFIG_PATH, { force: true })
  await rm(AUTH_PATH, { force: true })
})

afterEach(() => {
  globalThis.fetch = originalFetch
})

after(async () => {
  await rm(sealosDir, { recursive: true, force: true })
})

test('prefetch archives contexts without changing the live slot', async () => {
  await seedLiveSlot()
  const liveKube = await readFile(KUBECONFIG_PATH)
  const liveAuth = await readFile(AUTH_PATH)
  const calls = installFetchMock()

  await prefetchSiteContexts()

  assert.deepEqual(await readFile(KUBECONFIG_PATH), liveKube)
  assert.deepEqual(await readFile(AUTH_PATH), liveAuth)
  assert.equal((await lstat(KUBECONFIG_PATH)).isSymbolicLink(), false)
  assert.equal((await lstat(AUTH_PATH)).isSymbolicLink(), false)
  assert.equal(getStatus().authenticated, true)
  assert.equal(getStatus().kubeconfigPath, KUBECONFIG_PATH)

  assert.equal(
    calls.some((call) => call.url === 'https://gzg.sealos.run/api/auth/regionToken'),
    false
  )
  assert.equal(
    calls.some((call) => /initRegionToken|autoInitRegionToken/.test(call.url)),
    false
  )

  const liveDir = join(sealosDir, 'contexts', 'gzg.sealos.run', LIVE_UID)
  const teamDir = join(sealosDir, 'contexts', 'gzg.sealos.run', TEAM_UID)
  const hzhDir = join(sealosDir, 'contexts', 'hzh.sealos.run', HZH_UID)

  assert.equal(await readFile(join(liveDir, 'kubeconfig'), 'utf8'), liveKubeconfig)
  assert.equal(await readFile(join(teamDir, 'kubeconfig'), 'utf8'), teamKubeconfig)
  assert.equal(await readFile(join(hzhDir, 'kubeconfig'), 'utf8'), hzhKubeconfig)

  const liveSession = JSON.parse(await readFile(join(liveDir, 'session.json'), 'utf8'))
  assert.equal(liveSession.region, 'https://gzg.sealos.run')
  assert.equal(liveSession.regional_token, 'regional-live')
  assert.equal(liveSession.app_token, 'app-live')
  assert.equal(liveSession.workspace.uid, LIVE_UID)
  assert.equal(liveSession.access_token, undefined)

  const teamSession = JSON.parse(await readFile(join(teamDir, 'session.json'), 'utf8'))
  assert.equal(teamSession.regional_token, 'regional-gzg-team')
  assert.equal(teamSession.app_token, 'app-gzg-team')

  const hzhSession = JSON.parse(await readFile(join(hzhDir, 'session.json'), 'utf8'))
  assert.equal(hzhSession.region, 'https://hzh.sealos.run')
  assert.equal(hzhSession.regional_token, 'regional-hzh')
  assert.equal(hzhSession.app_token, 'app-hzh')

  assert.equal((await stat(join(liveDir, 'kubeconfig'))).mode & 0o777, 0o600)
  assert.equal((await stat(join(liveDir, 'session.json'))).mode & 0o777, 0o600)
  assert.equal((await lstat(join(liveDir, 'kubeconfig'))).isSymbolicLink(), false)
})

test('409 region is skipped and does not create a host folder', async () => {
  await seedLiveSlot()
  const calls = installFetchMock()

  await prefetchSiteContexts()

  assert.equal(existsSync(join(sealosDir, 'contexts', 'bja.sealos.run')), false)
  assert.equal(existsSync(join(sealosDir, 'contexts', 'hzh.sealos.run', HZH_UID)), true)
  assert.ok(
    calls.some(
      (call) => call.url === 'https://bja.sealos.run/api/auth/regionToken' && call.method === 'POST'
    )
  )
  assert.equal(
    calls.some((call) => call.url.startsWith('https://bja.sealos.run/api/auth/namespace/')),
    false
  )
})

test('logout deletes contexts as well as live files', async () => {
  await seedLiveSlot()
  installFetchMock()
  await prefetchSiteContexts()
  assert.equal(existsSync(join(sealosDir, 'contexts', 'gzg.sealos.run', LIVE_UID)), true)

  await logout()

  assert.equal(existsSync(KUBECONFIG_PATH), false)
  assert.equal(existsSync(AUTH_PATH), false)
  assert.equal(existsSync(join(sealosDir, 'contexts')), false)
  assert.equal(getStatus().authenticated, false)
})

test('path traversal uid is rejected and does not write outside contexts', async () => {
  await assert.rejects(
    () =>
      writeContext(liveKubeconfig, {
        region: 'https://gzg.sealos.run',
        regional_token: 'regional-live',
        workspace: { uid: '../outside', id: 'ns-live', teamName: 'evil' }
      }),
    /invalid context/
  )
  await assert.rejects(
    () =>
      writeContext(liveKubeconfig, {
        region: 'https://gzg.sealos.run',
        regional_token: 'regional-live',
        workspace: { uid: 'foo/../../outside', id: 'ns-live', teamName: 'evil' }
      }),
    /invalid context/
  )

  assert.equal(existsSync(join(sealosDir, 'outside')), false)
  assert.equal(existsSync(join(sealosDir, 'contexts', 'outside')), false)
  assert.equal(existsSync(join(sealosDir, 'kubeconfig')), false)
})
