import * as k8s from '@kubernetes/client-node'
import { createHash } from 'node:crypto'
import { domainToASCII } from 'node:url'
import { loadAuthJson, readKubeconfigText } from './auth'
import { verifyDomain } from './domain-verification'
export { verifyCname } from './domain-verification'
import { APP_LABEL } from './resources'

const targetKey = 'desktop.sealos.io/cname-target'
const domainKey = 'desktop.sealos.io/custom-domain'

const requestOptions: NonNullable<Parameters<k8s.NetworkingV1Api['listNamespacedIngress']>[1]> = {
  middlewareMergeStrategy: 'append',
  middleware: [{
    pre(request) {
      request.setSignal(AbortSignal.timeout(15_000))
      return new k8s.Observable(Promise.resolve(request))
    },
    post(response) { return new k8s.Observable(Promise.resolve(response)) }
  }]
}

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
  const kubeconfig = readKubeconfigText()
  kc.loadFromString(kubeconfig)
  const region = loadAuthJson().region || kc.getCurrentCluster()?.server
  const assertCurrent = () => {
    if (readKubeconfigText() !== kubeconfig) throw new Error('工作空间已切换，请关闭弹窗后重新绑定')
  }
  const namespace = kc.getContextObject(kc.getCurrentContext())?.namespace
  if (!namespace) throw new Error('当前工作空间缺少 namespace')
  const network = kc.makeApiClient(k8s.NetworkingV1Api)
  const list = await network.listNamespacedIngress({ namespace }, requestOptions)
  const selected = list.items.find(ing => ing.metadata?.labels?.[APP_LABEL] && ing.spec?.rules?.some(rule => rule.host === host))
  if (!selected) throw new Error('未找到当前工作空间中该域名对应的应用入口')
  const target = normalizeDomain(selected.metadata?.annotations?.[targetKey] ?? host)
  // Reuse the original route, which may have changed since an alias was created.
  const source = target === host ? selected : list.items.find(ing =>
    ing.metadata?.labels?.[APP_LABEL] === selected.metadata?.labels?.[APP_LABEL] &&
    ing.spec?.rules?.some(rule => rule.host === target))
  if (!source) throw new Error('原公网入口已删除，请从当前应用的公网地址重新绑定')
  return { kc, namespace, network, source, target, list: list.items, region, assertCurrent }
}

export async function getDomainBinding(publicUrl: string) {
  const { kc, namespace, target, source, list, assertCurrent } = await contextFor(publicUrl)
  const bindings = list.filter(ing => ing.metadata?.annotations?.[targetKey] === target &&
    ing.metadata?.labels?.[APP_LABEL] === source.metadata?.labels?.[APP_LABEL])
  const custom = kc.makeApiClient(k8s.CustomObjectsApi)
  const certificates = await Promise.all(bindings.map(async ing => {
    const domain = ing.metadata?.annotations?.[domainKey]!
    try {
      const cert = await custom.getNamespacedCustomObject({ group: 'cert-manager.io', version: 'v1', namespace,
        plural: 'certificates', name: ing.metadata!.name! }, requestOptions) as { status?: { notAfter?: string; conditions?: { type?: string; status?: string; reason?: string; message?: string }[] } }
      const ready = cert.status?.conditions?.find(c => c.type === 'Ready')
      const issuing = cert.status?.conditions?.find(c => c.type === 'Issuing')
      const expired = cert.status?.notAfter && Date.parse(cert.status.notAfter) <= Date.now()
      const failed = issuing?.status === 'False' && issuing.reason === 'Failed'
      const status = expired ? 'expired' : ready?.status === 'True' ? 'ready' : failed ? 'failed' : 'pending'
      const message = status === 'ready' ? undefined : issuing?.message || ready?.message
      return { domain, status, ...(message ? { message } : {}) }
    } catch {
      return { domain, status: 'unknown' }
    }
  }))
  assertCurrent()
  return { target, domains: certificates.map(item => item.domain), certificates }
}

export async function bindDomain(publicUrl: string, value: string) {
  const domain = normalizeDomain(value)
  const { kc, namespace, network, source, target, list, region, assertCurrent } = await contextFor(publicUrl)
  if (domain === target) throw new Error('自定义域名不能与原公网域名相同')
  const matches = list.filter(ing => ing.spec?.rules?.some(rule => rule.host === domain))
  const owns = (metadata?: k8s.V1ObjectMeta) => metadata?.annotations?.[targetKey] === target &&
    metadata?.annotations?.[domainKey] === domain &&
    metadata?.labels?.[APP_LABEL] === source.metadata?.labels?.[APP_LABEL]
  if (matches.some(ing => !owns(ing.metadata))) throw new Error('该域名已绑定其他入口')
  const existing = matches[0]
  if (typeof region !== 'string') throw new Error('缺少区域信息，请重新登录')
  await verifyDomain(domain, target, region)
  assertCurrent()
  const app = source.metadata!.labels![APP_LABEL]
  const name = `domain-${createHash('sha256').update(`${namespace}/${target}/${domain}`).digest('hex').slice(0, 24)}`
  const metadata = { name, namespace, labels: { ...source.metadata?.labels, [APP_LABEL]: app } as Record<string, string>, annotations: { [targetKey]: target, [domainKey]: domain } }
  // Custom entries must not masquerade as the platform-assigned public domain.
  delete metadata.labels['cloud.sealos.io/app-deploy-manager-domain']
  const custom = kc.makeApiClient(k8s.CustomObjectsApi)
  const ensure = async (plural: string, body: Record<string, unknown>) => {
    assertCurrent()
    try {
      await custom.createNamespacedCustomObject({ group: 'cert-manager.io', version: 'v1', namespace, plural, body }, requestOptions)
    } catch (error) {
      if ((error as { code?: number }).code !== 409) throw error
      const current = await custom.getNamespacedCustomObject({ group: 'cert-manager.io', version: 'v1', namespace, plural, name }, requestOptions) as { metadata?: { annotations?: Record<string, string> } }
      if (!owns(current.metadata)) throw new Error('同名证书资源已存在，无法覆盖')
    }
  }
  await ensure('issuers', { apiVersion: 'cert-manager.io/v1', kind: 'Issuer', metadata,
    spec: { acme: { server: 'https://acme-v02.api.letsencrypt.org/directory', email: 'admin@sealos.io',
      privateKeySecretRef: { name: 'letsencrypt-prod' },
      solvers: [{ http01: { ingress: { class: source.spec?.ingressClassName ?? source.metadata?.annotations?.['kubernetes.io/ingress.class'] ?? 'nginx', serviceType: 'ClusterIP' } } }] } } })
  await ensure('certificates', { apiVersion: 'cert-manager.io/v1', kind: 'Certificate', metadata,
    spec: { secretName: name, dnsNames: [domain], issuerRef: { name, kind: 'Issuer' } } })
  if (!existing) {
    const rule = source.spec!.rules!.find(rule => rule.host === target)!
    const annotations: Record<string, string> = { ...source.metadata?.annotations, ...metadata.annotations }
    delete annotations['kubectl.kubernetes.io/last-applied-configuration']
    delete annotations['cert-manager.io/issuer']
    delete annotations['cert-manager.io/cluster-issuer']
    assertCurrent()
    try {
      await network.createNamespacedIngress({ namespace, body: {
        apiVersion: 'networking.k8s.io/v1', kind: 'Ingress', metadata: { ...metadata, annotations },
        spec: { ingressClassName: source.spec?.ingressClassName,
          rules: [{ ...rule, host: domain }], tls: [{ hosts: [domain], secretName: name }] }
      } }, requestOptions)
    } catch (error) {
      if ((error as { code?: number }).code !== 409) throw error
      const current = await network.readNamespacedIngress({ namespace, name }, requestOptions)
      if (!owns(current.metadata)) throw new Error('同名域名入口已存在，无法覆盖')
    }
  }
  return { url: `https://${domain}`, target }
}
