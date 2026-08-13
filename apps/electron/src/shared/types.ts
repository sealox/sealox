export interface SealosStatus {
  authenticated: boolean
  server?: string
  namespace?: string
  regionDomain?: string
  workspace?: string
  authenticatedAt?: string
}

export type LoginEvent =
  | { type: 'device_code'; verificationUrl: string; userCode: string; expiresInSec: number }
  | { type: 'polling' }
  | { type: 'exchanging' }
  | { type: 'success'; status: SealosStatus }
  | { type: 'error'; message: string }

export interface PodInfo {
  name: string
  phase: string
  /** e.g. CrashLoopBackOff / ImagePullBackOff when a container is stuck */
  reason?: string
  restarts: number
}

export type AppStatus = 'Running' | 'Progressing' | 'Stopped' | 'Failed'

export interface AppWorkload {
  name: string
  kind: 'Deployment' | 'StatefulSet'
  status: AppStatus
  readyReplicas: number
  replicas: number
  images: string[]
  urls: string[]
  instance?: string
  pods: PodInfo[]
}

export interface DatabaseInfo {
  name: string
  engine?: string
  version?: string
  phase: string
  instance?: string
}

export interface InstanceInfo {
  name: string
  template?: string
  createdAt?: string
}

export interface ResourceSnapshot {
  namespace: string
  regionDomain: string
  fetchedAt: string
  apps: AppWorkload[]
  databases: DatabaseInfo[]
  instances: InstanceInfo[]
  /** non-fatal problems while assembling the snapshot (e.g. template API down) */
  warnings: string[]
}

export interface RegionOption {
  url: string
  label: string
}

export interface HeliosApi {
  getStatus(): Promise<SealosStatus>
  getRegions(): Promise<RegionOption[]>
  startLogin(region?: string): Promise<void>
  cancelLogin(): Promise<void>
  saveKubeconfig(text: string): Promise<SealosStatus>
  logout(): Promise<void>
  getResources(): Promise<ResourceSnapshot>
  openExternal(url: string): Promise<void>
  onLoginEvent(listener: (event: LoginEvent) => void): () => void
}
