import { KubeConfig } from '@kubernetes/client-node'
import { isDeepStrictEqual } from 'node:util'

/** Compare the active context and credentials, ignoring YAML formatting and aliases. */
export function sameKubeconfigContext(left: string | KubeConfig, right: string | KubeConfig): boolean {
  function identity(value: string | KubeConfig) {
    const kc = typeof value === 'string' ? new KubeConfig() : value
    if (typeof value === 'string') kc.loadFromString(value)
    const context = kc.getContextObject(kc.getCurrentContext())
    const cluster = kc.getCurrentCluster()
    const user = kc.getCurrentUser()
    if (!context?.namespace || !cluster || !user) throw new Error('Missing active context')
    // Local file references and credential plugins cannot establish that the
    // actual credential matches the server's inline credential material.
    if (user.exec || user.authProvider || user.certFile || user.keyFile || cluster.caFile) {
      throw new Error('Credential identity cannot be compared')
    }
    if (!user.token && !(user.certData && user.keyData)) throw new Error('Missing credentials')
    return {
      namespace: context.namespace,
      cluster: { ...cluster, name: '' },
      user: { ...user, name: '' }
    }
  }
  try {
    return isDeepStrictEqual(identity(left), identity(right))
  } catch {
    return false
  }
}
