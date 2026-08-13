export interface SealosStatus {
  authenticated: boolean
  server?: string
  namespace?: string
  regionDomain?: string
  workspace?: string
  /** 工作空间的展示名（auth.json 里的 teamName），比 workspace id 友好 */
  workspaceName?: string
  authenticatedAt?: string
  kubeconfigPath?: string
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

export interface BucketInfo {
  name: string
  /** private | publicRead | publicReadwrite */
  policy?: string
  /** actual S3 bucket name from status, if reported */
  bucketName?: string
  createdAt?: string
  instance?: string
}

export interface ResourceSnapshot {
  namespace: string
  regionDomain: string
  fetchedAt: string
  apps: AppWorkload[]
  databases: DatabaseInfo[]
  instances: InstanceInfo[]
  buckets: BucketInfo[]
  /** non-fatal problems while assembling the snapshot (e.g. template API down) */
  warnings: string[]
}

export interface WorkspaceInfo {
  uid: string
  /** 命名空间名（ns-xxx） */
  id: string
  /** 展示名 */
  teamName?: string
  isPrivate: boolean
  /** 拥有者/管理员/开发者（尽力解析，未知时缺省） */
  roleLabel?: string
  current: boolean
}

export interface WorkspaceMember {
  crUid: string
  nickname: string
  avatarUrl?: string
  roleLabel: string
}

export interface WorkspaceDetails {
  uid: string
  teamName?: string
  isPrivate: boolean
  myRoleLabel?: string
  /** 仅 Owner */
  canRename: boolean
  /** Owner 或 Manager */
  canInvite: boolean
  members: WorkspaceMember[]
}

export interface TemplateInfo {
  name: string
  slug: string
  /** Template API 的部署标识（templateName || slug） */
  templateName: string
  /** 中文优先，缺失时回退英文 */
  description: string
  /** 绝对 URL */
  icon?: string
  /** 首张截图，绝对 URL */
  screenshot?: string
  category: string
  tags: string[]
  github?: string
  website?: string
  deployCount?: number
  /** sealos.io 商店详情页 */
  detailUrl: string
  /** Sealos 控制台的模板部署页（用户所在 region） */
  deployUrl: string
}

export interface TemplateCatalog {
  fetchedAt: string
  templates: TemplateInfo[]
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
  getTemplates(): Promise<TemplateCatalog>
  listWorkspaces(): Promise<WorkspaceInfo[]>
  switchWorkspace(uid: string): Promise<SealosStatus>
  getWorkspaceDetails(uid: string): Promise<WorkspaceDetails>
  renameWorkspace(uid: string, teamName: string): Promise<SealosStatus>
  createWorkspace(teamName: string): Promise<WorkspaceInfo>
  getInviteLink(uid: string, role: 'manager' | 'developer'): Promise<string>
  openExternal(url: string): Promise<void>
  copyText(text: string): Promise<void>
  onLoginEvent(listener: (event: LoginEvent) => void): () => void
}
