import { Resolver } from 'node:dns/promises'

export async function verifyCname(domain: string, target: string, lookup?: (name: string) => Promise<string[]>): Promise<void> {
  const resolver = new Resolver({ timeout: 3000, tries: 2 })
  const resolve = lookup ?? (async (name: string) => {
    try {
      const names = await resolver.resolveCname(name)
      if (names.length) return names
    } catch {
      // Desktop VPN/Fake-IP resolvers may not expose CNAME records.
    }
    const url = new URL('https://dns.google/resolve')
    url.searchParams.set('name', name)
    url.searchParams.set('type', 'CNAME')
    const response = await fetch(url, { signal: AbortSignal.timeout(5000) })
    if (!response.ok) throw new Error('DNS 查询暂时不可用')
    const result = await response.json() as {
      Status?: number
      Answer?: { name?: string; type?: number; data?: string }[]
    }
    if (result.Status !== 0 && result.Status !== 3) throw new Error('DNS 查询暂时不可用')
    return (result.Answer ?? []).filter(record => record.type === 5 &&
      record.name?.toLowerCase().replace(/\.$/, '') === name && typeof record.data === 'string')
      .map(record => record.data!)
  })
  const visited = new Set<string>()
  let current = domain
  for (let i = 0; i < 8 && !visited.has(current); i++) {
    visited.add(current)
    let names: string[]
    try { names = await resolve(current) } catch {
      throw new Error('DNS 验证服务暂时不可用，请检查网络后重试；暂时无法判断 CNAME 是否生效')
    }
    const next = names.map(name => name.toLowerCase().replace(/\.$/, ''))
    if (next.includes(target)) return
    if (!next[0]) break
    current = next[0]
  }
  throw new Error(`CNAME 尚未生效，请将 ${domain} 的 CNAME 指向 ${target}，等待 DNS 生效后重试（如使用 CDN，请先关闭代理）`)
}


/** AppLaunchpad performs authoritative DNS verification in the region, away from desktop VPN DNS. */
export async function verifyDomain(domain: string, target: string, region: string): Promise<void> {
  const base = new URL(region)
  if (base.protocol !== 'https:' || base.username || base.password) throw new Error('区域地址无效')
  const url = new URL(`https://applaunchpad.${base.hostname}/api/platform/authCname`)
  let response: Response
  try {
    response = await fetch(url, {
      method: 'POST', redirect: 'error',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ publicDomain: target, customDomain: domain }),
      signal: AbortSignal.timeout(15_000)
    })
  } catch {
    return verifyCname(domain, target)
  }
  // Older/private deployments may lack the endpoint; keep CNAME-only fallback.
  if (response.status === 404 || response.status >= 500) return verifyCname(domain, target)
  if (!response.ok) throw new Error(`区域域名验证服务不可用（HTTP ${response.status}），请稍后重试`)
  let body: { code?: number; message?: string; data?: { type?: string; data?: string } }
  try { body = await response.json() } catch { throw new Error('区域域名验证响应无效，请稍后重试') }
  if (body.code === 200 && body.data?.type === 'CNAME' &&
    typeof body.data.data === 'string' && body.data.data.toLowerCase().replace(/\.$/, '') === target) return
  if (body.code === 400) {
    throw new Error(`区域验证未通过：${body.message || 'CNAME 记录未匹配'}。请确认 ${domain} 的 CNAME 指向 ${target}；如启用 CDN，请暂时切换为仅 DNS 后重试`)
  }
  throw new Error('区域域名验证未返回有效的 CNAME 结果，请稍后重试')
}
