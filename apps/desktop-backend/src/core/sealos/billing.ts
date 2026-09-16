import { CoreV1Api, KubeConfig, Observable } from '@kubernetes/client-node'
import { sameKubeconfigContext } from './kubeconfig-context'
import type { BillingStatus } from '../../shared/types'
import { getKubeconfigPath, loadAuthJson, requestJson, responseStatus } from './auth'

const SUSPENDED = new Set([
  'Suspend', 'SuspendCompleted', 'TerminateSuspend',
  'TerminateSuspendCompleted', 'FinalDeletion', 'FinalDeletionCompleted'
])

export function parseAccountBalance(body: unknown): number {
  const data = (body as { data?: { balance?: unknown; deductionBalance?: unknown } })?.data
  if (!Number.isSafeInteger(data?.balance) || !Number.isSafeInteger(data?.deductionBalance)) {
    throw new Error('余额响应无效')
  }
  const amount = (data!.balance as number) - (data!.deductionBalance as number)
  if (!Number.isSafeInteger(amount)) throw new Error('余额超出可显示范围')
  return amount
}

export function costCenterUrl(region: string): string {
  const url = new URL(region)
  if (url.protocol !== 'https:' || url.username || url.password) throw new Error('无效的区域地址')
  url.pathname = '/'
  url.search = ''
  url.hash = ''
  url.searchParams.set('openapp', 'system-costcenter?mode=topup')
  return url.toString()
}

export function namespaceDebt(status?: string): boolean {
  return SUSPENDED.has(status ?? '')
}

// Capture the kubeconfig before awaiting network calls, so region/workspace
// changes cannot combine money from one account with another namespace.
export async function fetchBillingStatus(): Promise<BillingStatus> {
  const auth = loadAuthJson()
  const region = typeof auth.region === 'string' ? auth.region : null
  let token = typeof auth.regional_token === 'string' ? auth.regional_token : null
  const result: BillingStatus = {
    cashMicroUnits: null, currency: null, balanceError: null,
    workspaceDebt: null, isOwner: null, topUpUrl: null
  }
  let kc: KubeConfig | null = null
  try {
    kc = new KubeConfig()
    kc.loadFromFile(getKubeconfigPath())
  } catch { kc = null }
  // auth.json and the shared kubeconfig can be replaced independently by other
  // tools. Verify their binding with the regional service before reading money
  // or exposing a recharge link; matching region/namespace labels is not enough.
  if (region && token && kc) {
    try {
      // The console and Kubernetes API may use different hostnames. Compare
      // with the kubeconfig returned by the account service, not the console URL.
      const response = await requestJson(`${region}/api/auth/getKubeconfig`, { token, timeoutMs: 10_000 })
      if (response.status !== 200 || responseStatus(response) !== 200) {
        result.balanceError = responseStatus(response) === 401
          ? '登录已过期，请重新登录后查看余额' : '暂时无法验证账户，请稍后重试'
        token = null
      } else {
        const expected = (response.body as { data?: { kubeconfig?: unknown } })?.data?.kubeconfig
        if (typeof expected !== 'string' || !sameKubeconfigContext(kc, expected)) {
          throw new Error('Account context mismatch')
        }
        result.topUpUrl = costCenterUrl(region)
      }
    } catch {
      result.balanceError = '无法确认当前 Kubeconfig 对应的账户，请重新登录后查看余额'
      token = null
    }
  } else {
    token = null
  }
  await Promise.all([
    (async () => {
      if (!region || !token) {
        result.balanceError ??= '请登录 Sealos 账户后查看余额'
        return
      }
      try {
        const response = await requestJson(`${region}/api/account/getAmount`, { token, timeoutMs: 15_000 })
        if (response.status !== 200 || responseStatus(response) !== 200) {
          throw new Error(responseStatus(response) === 401 ? '登录已过期，请重新登录后查看余额' : '暂时无法获取余额')
        }
        result.cashMicroUnits = parseAccountBalance(response.body)
      } catch (error) {
        result.balanceError = error instanceof Error && error.message.startsWith('登录已过期')
          ? error.message : '暂时无法获取余额，请稍后重试'
      }
    })(),
    (async () => {
      if (!region || !token) return
      try {
        const response = await requestJson(`${region}/api/platform/getLayoutConfig`, { timeoutMs: 15_000 })
        if (response.status !== 200 || responseStatus(response) !== 200) return
        const currency = (response.body as { data?: { currencySymbol?: string } })?.data?.currencySymbol
        if (currency && ['usd', 'cny', 'shellCoin'].includes(currency)) result.currency = currency
      } catch { /* Never invent a currency when platform configuration is unavailable. */ }
    })(),
    (async () => {
      if (!kc) return
      const namespace = kc.getContextObject(kc.getCurrentContext())?.namespace
      if (!namespace) return
      try {
        const ns = await kc.makeApiClient(CoreV1Api).readNamespace({ name: namespace }, {
          middlewareMergeStrategy: 'append',
          middleware: [{
            pre(request) {
              request.setSignal(AbortSignal.timeout(15_000))
              return new Observable(Promise.resolve(request))
            },
            post(response) {
              return new Observable(Promise.resolve(response))
            }
          }]
        })
        result.workspaceDebt = namespaceDebt(ns.metadata?.annotations?.['debt.sealos/status'])
        const owner = ns.metadata?.labels?.['user.sealos.io/owner']
        // Used only to tailor the reminder; the API remains the authority.
        if (owner && token) {
          try {
            const actor = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString()).userCrName
            if (typeof actor === 'string' && actor) result.isOwner = actor === owner
          } catch { /* Unknown owner: show a neutral Cost Center action. */ }
        }
      } catch { /* An unreadable namespace is unknown, never a debt verdict. */ }
    })()
  ])
  // Also discard an in-flight result if another tool changed the local
  // identity while the requests were pending (Flutter cannot observe that).
  if (!kc) return result
  try {
    const current = new KubeConfig()
    current.loadFromFile(getKubeconfigPath())
    const currentAuth = loadAuthJson()
    if (!sameKubeconfigContext(kc, current) ||
        currentAuth.region !== auth.region || currentAuth.regional_token !== auth.regional_token) {
      throw new Error('Context changed')
    }
  } catch {
    return { cashMicroUnits: null, currency: null, balanceError: '登录环境已变化，请重新登录或刷新余额',
      workspaceDebt: null, isOwner: null, topUpUrl: null }
  }
  return result
}
