import assert from 'node:assert/strict'
import { test } from 'node:test'
import { build } from 'esbuild'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'

const folder = await mkdtemp(join(tmpdir(), 'helios-billing-'))
const previousDir = process.env.SEALOS_DIR
const previousKubeconfig = process.env.SEALOS_KUBECONFIG
const originalFetch = globalThis.fetch
process.env.SEALOS_DIR = folder
process.env.SEALOS_KUBECONFIG = join(folder, 'kubeconfig')
const bundle = join(folder, 'billing.cjs')
await build({ stdin: {
  contents: `export * from './billing'; export {saveKubeconfigText, saveCredentials, loadAuthJson} from './auth'; export {CoreV1Api} from '@kubernetes/client-node';`,
  resolveDir: new URL('../src/core/sealos/', import.meta.url).pathname, loader: 'ts'
}, bundle: true, platform: 'node', format: 'cjs', outfile: bundle })
const billing = createRequire(import.meta.url)(bundle)
billing.CoreV1Api.prototype.readNamespace = async () => ({
  metadata: { annotations: { 'debt.sealos/status': 'Normal' }, labels: { 'user.sealos.io/owner': 'user' } }
})
const kubeconfig = ({ server = 'https://region.example', namespace = 'ns-one', token = 'fixture-kube-token' } = {}) => `apiVersion: v1
kind: Config
clusters:
- name: cluster
  cluster:
    server: ${server}
contexts:
- name: context
  context:
    cluster: cluster
    user: user
    namespace: ${namespace}
current-context: context
users:
- name: user
  user:
    token: ${token}
`
const auth = { region: 'https://region.example', regional_token: 'regional-test-token', app_token: 'wrong-token', current_workspace: { id: 'ns-one' } }
async function resetContext() {
  await writeFile(join(folder, 'auth.json'), JSON.stringify(auth))
  await writeFile(join(folder, 'kubeconfig'), kubeconfig())
}
function successfulFetch(url, options) {
  if (url.endsWith('/api/auth/getKubeconfig')) {
    assert.equal(options.headers.Authorization, auth.regional_token)
    return Response.json({ code: 200, data: { kubeconfig: kubeconfig() } })
  }
  if (url.endsWith('/api/account/getAmount')) {
    assert.equal(options.headers.Authorization, auth.regional_token)
    return Response.json({ code: 200, data: { balance: 12000000, deductionBalance: 3500000 } })
  }
  assert.equal(url, 'https://region.example/api/platform/getLayoutConfig')
  return Response.json({ code: 200, data: { currencySymbol: 'cny' } })
}

test('billing uses regional credentials and preserves unknown/error states', async (t) => {
  t.after(async () => {
    globalThis.fetch = originalFetch
    if (previousDir === undefined) delete process.env.SEALOS_DIR
    else process.env.SEALOS_DIR = previousDir
    if (previousKubeconfig === undefined) delete process.env.SEALOS_KUBECONFIG
    else process.env.SEALOS_KUBECONFIG = previousKubeconfig
    await rm(folder, { recursive: true, force: true })
  })
  await t.test('cash subtraction, zero, negative and invalid responses', () => {
    assert.equal(billing.parseAccountBalance({ data: { balance: 12000000, deductionBalance: 3500000 } }), 8500000)
    assert.equal(billing.parseAccountBalance({ data: { balance: 0, deductionBalance: 0 } }), 0)
    assert.equal(billing.parseAccountBalance({ data: { balance: 0, deductionBalance: 1 } }), -1)
    for (const data of [null, {}, { balance: '1', deductionBalance: 0 }, { balance: NaN, deductionBalance: 0 }]) {
      assert.throws(() => billing.parseAccountBalance({ data }))
    }
  })
  await t.test('only platform suspension statuses mean debt', () => {
    for (const state of ['Suspend', 'SuspendCompleted', 'TerminateSuspend', 'TerminateSuspendCompleted', 'FinalDeletion', 'FinalDeletionCompleted']) assert.equal(billing.namespaceDebt(state), true)
    for (const state of [undefined, 'Normal', 'Resume', 'ResumeCompleted', 'unknown']) assert.equal(billing.namespaceDebt(state), false)
  })
  await t.test('top-up goes through the active region without leaking URL credentials', () => {
    const url = new URL(billing.costCenterUrl('https://region.example/?old=value#section'))
    assert.equal(url.origin, 'https://region.example')
    assert.equal(url.searchParams.get('openapp'), 'system-costcenter?mode=topup')
    assert.equal(url.searchParams.has('old'), false)
    assert.equal(url.hash, '')
    assert.throws(() => billing.costCenterUrl('http://region.example'))
    assert.throws(() => billing.costCenterUrl('https://user:password@region.example'))
  })
  await t.test('kubeconfig-only login does not fabricate a zero balance', async () => {
    const result = await billing.fetchBillingStatus()
    assert.equal(result.cashMicroUnits, null)
    assert.equal(result.workspaceDebt, null)
    assert.match(result.balanceError, /登录/)
  })
  await resetContext()
  await t.test('requests use regional token, platform currency and cash units', async () => {
    globalThis.fetch = successfulFetch
    const result = await billing.fetchBillingStatus()
    assert.equal(result.cashMicroUnits, 8500000)
    assert.equal(result.currency, 'cny')
    assert.equal(result.workspaceDebt, false)
    assert.equal(result.balanceError, null)
  })
  await t.test('business-level auth failure does not become zero or debt', async () => {
    globalThis.fetch = async () => Response.json({ code: 401 })
    const result = await billing.fetchBillingStatus()
    assert.equal(result.cashMicroUnits, null)
    assert.equal(result.currency, null)
    assert.equal(result.workspaceDebt, false)
    assert.equal(result.topUpUrl, null)
    assert.match(result.balanceError, /登录已过期/)
  })
  await t.test('external replacement in another region never queries the previous account', async () => {
    await resetContext()
    await writeFile(join(folder, 'kubeconfig'), kubeconfig({ server: 'https://new-region.example' }))
    const calls = []
    globalThis.fetch = async (...args) => { calls.push(args[0]); return successfulFetch(...args) }
    const result = await billing.fetchBillingStatus()
    assert.deepEqual(calls, ['https://region.example/api/auth/getKubeconfig'])
    assert.equal(result.cashMicroUnits, null)
    assert.equal(result.currency, null)
    assert.equal(result.topUpUrl, null)
  })
  await t.test('console and Kubernetes API aliases work when server-issued credentials match', async () => {
    await resetContext()
    const aliased = kubeconfig({ server: 'https://kubernetes.region.example' })
    await writeFile(join(folder, 'kubeconfig'), aliased)
    globalThis.fetch = async (url, options) => url.endsWith('/api/auth/getKubeconfig')
      ? Response.json({ code: 200, data: { kubeconfig: aliased } })
      : successfulFetch(url, options)
    const result = await billing.fetchBillingStatus()
    assert.equal(result.cashMicroUnits, 8500000)
    assert.equal(new URL(result.topUpUrl).origin, 'https://region.example')
  })
  await t.test('same region and namespace with different credentials cannot query old balance', async () => {
    await resetContext()
    await writeFile(join(folder, 'kubeconfig'), kubeconfig({ token: 'different-user-token' }))
    const calls = []
    globalThis.fetch = async (...args) => { calls.push(args[0]); return successfulFetch(...args) }
    const result = await billing.fetchBillingStatus()
    assert.deepEqual(calls, ['https://region.example/api/auth/getKubeconfig'])
    assert.equal(result.cashMicroUnits, null)
    assert.equal(result.topUpUrl, null)
    assert.equal(result.isOwner, null)
  })
  await t.test('importing another context removes old account session and workspace metadata', async () => {
    await resetContext()
    const status = await billing.saveKubeconfigText(kubeconfig({ namespace: 'ns-new' }))
    assert.equal(status.namespace, 'ns-new')
    assert.equal(status.workspace, undefined)
    assert.deepEqual(billing.loadAuthJson(), {})
    globalThis.fetch = () => { assert.fail('No account request allowed after import') }
    const result = await billing.fetchBillingStatus()
    assert.equal(result.cashMicroUnits, null)
    assert.equal(result.topUpUrl, null)
  })
  await t.test('reimporting identical credentials with different YAML formatting retains login', async () => {
    await resetContext()
    await billing.saveKubeconfigText('# imported again\n' + kubeconfig())
    assert.deepEqual(billing.loadAuthJson(), auth)
    globalThis.fetch = successfulFetch
    assert.equal((await billing.fetchBillingStatus()).cashMicroUnits, 8500000)
  })
  await t.test('invalid import leaves the existing account session intact', async () => {
    await resetContext()
    await assert.rejects(billing.saveKubeconfigText('server: https://other.example\ntoken: fixture\n'))
    await assert.rejects(billing.saveKubeconfigText('server: https://other.example\nnamespace: ns-new\ntoken: fixture\n'))
    assert.deepEqual(billing.loadAuthJson(), auth)
    globalThis.fetch = successfulFetch
    assert.equal((await billing.fetchBillingStatus()).cashMicroUnits, 8500000)
  })
  await t.test('an external context change during the balance request discards its response', async () => {
    await resetContext()
    globalThis.fetch = async (url, options) => {
      if (url.endsWith('/api/account/getAmount')) {
        await writeFile(join(folder, 'kubeconfig'), kubeconfig({ namespace: 'ns-new' }))
      }
      return successfulFetch(url, options)
    }
    const result = await billing.fetchBillingStatus()
    assert.equal(result.cashMicroUnits, null)
    assert.equal(result.workspaceDebt, null)
    assert.equal(result.topUpUrl, null)
    assert.match(result.balanceError, /登录环境已变化/)
  })

})
