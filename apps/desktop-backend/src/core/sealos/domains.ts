import * as k8s from '@kubernetes/client-node'
import { Resolver } from 'node:dns/promises'
import { createHash } from 'node:crypto'
import { domainToASCII } from 'node:url'
import { getKubeconfigPath } from './auth'
import { APP_LABEL } from './resources'

const targetKey = 'desktop.sealos.io/cname-target'
const domainKey = 'desktop.sealos.io/custom-domain'

export function normalizeDomain(value: string): string {
  if (/[\s/:@?#\\%*]/.test(value.trim())) throw new Error('请输入完整域名，不含协议、端口或路径')
  const domain = domainToASCII(value.trim().toLowerCase().replace(/\.$/, ''))
  if (domain.length > 253 || !domain.includes('.') || !domain.split('.').every(
    label => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label)
  ) || /^\d+(\.\d+){3}$/.test(domain)) throw new Error('请输入完整域名，例如 app.example.com，不含协议、端口或路径')
  return domain
}

async function contextFor(publicUrl: string) {
  const host = normalizeDomain(new URL(publicUrl).hostname)
  const kc = new k8s.KubeConfig()
  kc.loadFromFile(getKubeconfigPath())
  const namespace = kc.getContextObject(kc.getCurrentContext())?.namespace
  if (!namespace) throw new Error('当前工作空间缺少 namespace')
  const network = kc.makeApiClient(k8s.NetworkingV1Api)
  const list = await network.listNamespacedIngress({ namespace })
  const source = list.items.find(ing => ing.metadata?.labels?.[APP_LABEL] && ing.spec?.rules?.some(rule => rule.host === host))
  if (!source) throw new Error('未找到当前工作空间中该域名对应的应用入口')
  const target = source.metadata?.annotations?.[targetKey] ?? host
  return { kc, namespace, network, source, target, host, list: list.items }
}

export async function getDomainBinding(publicUrl: string) {
  const { target, list } = await contextFor(publicUrl)
  return { target, domains: list.filter(ing => ing.metadata?.annotations?.[targetKey] === target)
    .flatMap(ing => (ing.spec?.rules ?? []).map(rule => rule.host).filter(Boolean)) }
}

export async function verifyCname(domain: string, target: string, lookup?: (name: string) => Promise<string[]>): Promise<void> {
  const resolver = new Resolver({ timeout: 3000, tries: 2 })
  const resolve = lookup ?? ((name: string) => resolver.resolveCname(name))
  const visited = new Set<string>()
  let current = domain
  for (let i = 0; i < 8 && !visited.has(current); i++) {
    visited.add(current)
    let names: string[]
    try { names = await resolve(current) } catch { break }
    const next = names.map(name => name.toLowerCase().replace(/\.$/, ''))
    if (next.includes(target)) return
    if (!next[0]) break
    current = next[0]
  }
  throw new Error(`CNAME 尚未生效，请将 ${domain} 的 CNAME 指向 ${target}，等待 DNS 生效后重试（如使用 CDN，请先关闭代理）`)
}

export async function bindDomain(publicUrl: string, value: string) {
  const domain = normalizeDomain(value)
  const { kc, namespace, network, source, target, host, list } = await contextFor(publicUrl)
  if (domain === target) throw new Error('自定义域名不能与原公网域名相同')
  const existing = list.find(ing => ing.spec?.rules?.some(rule => rule.host === domain))
  if (existing && existing.metadata?.annotations?.[targetKey] !== target) throw new Error('该域名已绑定其他入口')
  await verifyCname(domain, target)
  const app = source.metadata!.labels![APP_LABEL]
  const name = `domain-${createHash('sha256').update(`${namespace}/${target}/${domain}`).digest('hex').slice(0, 24)}`
  const metadata = { name, namespace, labels: { ...source.metadata?.labels, [APP_LABEL]: app } as Record<string, string>, annotations: { [targetKey]: target, [domainKey]: domain } }
  // Custom entries must not masquerade as the platform-assigned public domain.
  delete metadata.labels['cloud.sealos.io/app-deploy-manager-domain']
  const custom = kc.makeApiClient(k8s.CustomObjectsApi)
  const ensure = async (plural: string, body: Record<string, unknown>) => {
    try {
      await custom.createNamespacedCustomObject({ group: 'cert-manager.io', version: 'v1', namespace, plural, body })
    } catch (error) {
      if ((error as { code?: number }).code !== 409) throw error
      const current = await custom.getNamespacedCustomObject({ group: 'cert-manager.io', version: 'v1', namespace, plural, name }) as { metadata?: { annotations?: Record<string, string> } }
      if (current.metadata?.annotations?.[targetKey] !== target || current.metadata?.annotations?.[domainKey] !== domain) throw new Error('同名证书资源已存在，无法覆盖')
    }
  }
  await ensure('issuers', { apiVersion: 'cert-manager.io/v1', kind: 'Issuer', metadata,
    spec: { acme: { server: 'https://acme-v02.api.letsencrypt.org/directory', email: 'admin@sealos.io',
      privateKeySecretRef: { name: 'letsencrypt-prod' },
      solvers: [{ http01: { ingress: { class: source.spec?.ingressClassName ?? source.metadata?.annotations?.['kubernetes.io/ingress.class'] ?? 'nginx', serviceType: 'ClusterIP' } } }] } } })
  await ensure('certificates', { apiVersion: 'cert-manager.io/v1', kind: 'Certificate', metadata,
    spec: { secretName: name, dnsNames: [domain], issuerRef: { name, kind: 'Issuer' } } })
  if (!existing) {
    const rule = source.spec!.rules!.find(rule => rule.host === host)!
    const annotations: Record<string, string> = { ...source.metadata?.annotations, ...metadata.annotations }
    delete annotations['kubectl.kubernetes.io/last-applied-configuration']
    delete annotations['cert-manager.io/issuer']
    delete annotations['cert-manager.io/cluster-issuer']
    try {
      await network.createNamespacedIngress({ namespace, body: {
        apiVersion: 'networking.k8s.io/v1', kind: 'Ingress', metadata: { ...metadata, annotations },
        spec: { ingressClassName: source.spec?.ingressClassName,
          rules: [{ ...rule, host: domain }], tls: [{ hosts: [domain], secretName: name }] }
      } })
    } catch (error) {
      if ((error as { code?: number }).code !== 409) throw error
      const current = await network.readNamespacedIngress({ namespace, name })
      if (current.metadata?.annotations?.[targetKey] !== target || current.metadata?.annotations?.[domainKey] !== domain) throw new Error('同名域名入口已存在，无法覆盖')
    }
  }
  return { url: `https://${domain}`, target }
}
