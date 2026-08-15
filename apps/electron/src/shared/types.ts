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

/** Launchpad 意义上的"应用"：单个 Deployment/StatefulSet 工作负载 */
export interface AppWorkload {
  name: string
  kind: 'Deployment' | 'StatefulSet'
  status: AppStatus
  readyReplicas: number
  replicas: number
  images: string[]
  urls: string[]
  /** 所属项目（模板实例名），来自 cloud.sealos.io/deploy-on-sealos 标签 */
  project?: string
  /** 是否带 cloud.sealos.io/app-deploy-manager 标签（App Launchpad 管理的应用） */
  launchpad: boolean
  pods: PodInfo[]
  /** 项目详情拓扑页脚：PVC / volumeClaimTemplates，列表快照不填 */
  volume?: VolumeHint
}

export interface DatabaseInfo {
  name: string
  engine?: string
  version?: string
  phase: string
  project?: string
}

/** "项目"：模板实例（instances CR），由多个组件（应用/数据库/存储）构成 */
export interface ProjectInfo {
  name: string
  /** 用户备注名 */
  displayName?: string
  /** 模板图标 URL */
  icon?: string
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
  project?: string
}

export interface QuotaItem {
  /** cpu | memory | storage | gpu */
  type: string
  /** 展示单位下的数值（cpu=vCPU、memory/storage=GiB、gpu=个） */
  used: number
  limit: number
  usedText: string
  limitText: string
  unit: string
}

export interface ResourceSnapshot {
  namespace: string
  regionDomain: string
  fetchedAt: string
  apps: AppWorkload[]
  databases: DatabaseInfo[]
  projects: ProjectInfo[]
  buckets: BucketInfo[]
  /** 工作空间 ResourceQuota 的 usage/limit */
  quota: QuotaItem[]
  /** non-fatal problems while assembling the snapshot (e.g. template API down) */
  warnings: string[]
}

/* ── 应用详情（与 App Launchpad 同一数据口径，直读 k8s API 组装）── */

/** Pod 内单个容器的状态 */
export interface ContainerInfo {
  name: string
  image: string
  /** running | waiting | terminated */
  state: string
  /** 卡住原因，如 CrashLoopBackOff / OOMKilled */
  reason?: string
  cpuLimit?: string
  memoryLimit?: string
}

/** 详情页的 Pod 完整信息（快照里的 PodInfo 是轻量版） */
export interface PodDetail {
  name: string
  phase: string
  reason?: string
  message?: string
  restarts: number
  createdAt?: string
  node?: string
  ip?: string
  containers: ContainerInfo[]
}

export interface EventInfo {
  /** Normal | Warning */
  type: string
  reason: string
  message: string
  count: number
  lastAt?: string
  /** 事件所属对象，如 Pod/xxx-abc */
  object?: string
}

/** 网络入口（端口维度）：集群内地址恒有，公网地址取决于 ingress/NodePort */
export interface NetworkEntry {
  port: number
  protocol: string
  /** ingress backend-protocol：HTTP / GRPC / WS */
  appProtocol?: string
  /** 集群内地址 host:port */
  clusterAddress: string
  publicUrl?: string
  /** 公网域名是用户自定义域名（非平台分配） */
  customDomain?: boolean
  nodePort?: number
}

export interface EnvEntry {
  key: string
  value?: string
  /** valueFrom 的来源描述，如 secret/name.key，明文不落详情 */
  from?: string
}

export interface ConfigMapMount {
  mountPath: string
  value: string
}

/** 持久卷挂载（StatefulSet volumeClaimTemplates） */
export interface StoreMount {
  name: string
  path: string
  size?: string
}

/** 拓扑节点页脚的持久卷（PVC / volumeClaimTemplates / 库 storage） */
export interface VolumeHint {
  name: string
  size?: string
}

export interface HpaInfo {
  /** cpu | memory | gpu */
  target: string
  /** 目标使用率 % */
  targetValue: number
  minReplicas: number
  maxReplicas: number
}

export interface AppDetail {
  name: string
  kind: 'Deployment' | 'StatefulSet'
  status: AppStatus
  paused: boolean
  createdAt?: string
  /** 主镜像（originImageName 注解优先于容器 image） */
  image: string
  /** 私有镜像（存在同名 docker-registry secret） */
  privateImage: boolean
  command?: string
  args?: string
  cpuLimit?: string
  memoryLimit?: string
  gpu?: string
  replicas: number
  readyReplicas: number
  hpa?: HpaInfo
  project?: string
  launchpad: boolean
  networks: NetworkEntry[]
  envs: EnvEntry[]
  configMaps: ConfigMapMount[]
  stores: StoreMount[]
  pods: PodDetail[]
  /** workload + pods 的最近事件（按时间倒序） */
  events: EventInfo[]
  fetchedAt: string
}

/* ── 监控（applaunchpad 公开 API，kubeconfig 鉴权）── */

export interface MonitorSeries {
  /** pod 名 */
  name: string
  /** [unix 秒, 使用率 %] */
  points: Array<[number, number]>
}

export interface AppMonitor {
  available: boolean
  reason?: string
  cpu: MonitorSeries[]
  memory: MonitorSeries[]
}

/* ── 项目详情（Template 实例 + 归属资源全景）── */

export interface CronJobInfo {
  name: string
  schedule: string
  suspended: boolean
  lastScheduleAt?: string
}

/** 归属项目的配套资源（Secret/ConfigMap/Service/Job/PVC/证书等） */
export interface OtherResource {
  kind: string
  name: string
  /** 补充说明，如 Service 的端口映射 */
  note?: string
}

/** 应用 → 数据库 / 对象存储。只表示已证实（或单应用回退）的引用，不含明文 */
export interface ProjectLink {
  app: string
  targetKind: 'database' | 'bucket'
  target: string
}

export interface DatabaseDetail extends DatabaseInfo {
  cpuLimit?: string
  memoryLimit?: string
  storage?: string
  volume?: VolumeHint
  /** 连接凭证所在 secret 名（不含明文） */
  connSecret?: string
  createdAt?: string
}

/** 集群内 / 公网连接。明文只出现在数据库详情 IPC，不进列表快照 */
export interface DatabaseConnection {
  host: string
  port: string
  username: string
  password: string
  endpoint?: string
  connectionString: string
}

export interface DatabaseUsedBy {
  name: string
  kind: 'Deployment' | 'StatefulSet'
  status: AppStatus
  project?: string
}

export interface DatabaseSchemaNode {
  name: string
  tables: string[]
}

export interface DatabaseSchemaTree {
  supported: boolean
  /** not-running | unsupported | fetch-failed */
  reason?: string
  databases: DatabaseSchemaNode[]
}

export interface DatabaseMonitor {
  available: boolean
  reason?: string
  cpu: MonitorSeries[]
  memory: MonitorSeries[]
  disk: MonitorSeries[]
  diskOverflow: boolean
}

/** 数据库详情页。连接明文只走 getDatabaseDetail */
export interface DatabaseInstanceDetail {
  name: string
  engine?: string
  version?: string
  phase: string
  project?: string
  cpu?: number
  memory?: number
  storage?: number
  replicas?: number
  createdAt?: string
  connection: DatabaseConnection | null
  publicConnection: DatabaseConnection | null
  /** Sealos publicConnection 原文（string）；解析失败时仍可供复制 */
  publicConnectionRaw?: string
  publicEnabled: boolean
  usedBy: DatabaseUsedBy[]
  pods: PodDetail[]
  events: EventInfo[]
  fetchedAt: string
}

export interface ProjectDetail {
  name: string
  /** 用户备注名（deploy-on-sealos-displayName 注解） */
  displayName?: string
  /** 模板图标 URL */
  icon?: string
  /** 模板标题（spec.title） */
  template?: string
  author?: string
  description?: string
  gitRepo?: string
  website?: string
  createdAt?: string
  apps: AppWorkload[]
  databases: DatabaseDetail[]
  buckets: BucketInfo[]
  cronjobs: CronJobInfo[]
  others: OtherResource[]
  /** 拓扑边。没有就不画，渲染进程不要自己猜 */
  links: ProjectLink[]
  fetchedAt: string
}

/* ── AI Proxy（aiproxy-web BFF，appToken 鉴权）────── */

export interface AiKeyInfo {
  id: number
  name: string
  /** 完整 key（使用时加 sk- 前缀），展示端负责打码 */
  key: string
  /** 1=启用 2=禁用 */
  enabled: boolean
  usedAmount: number
  requestCount: number
  /** 毫秒时间戳 */
  createdAt: number
  /** 毫秒时间戳，0=从未使用 */
  accessedAt: number
}

export interface AiModelInfo {
  model: string
  owner: string
  /** relay mode：1=聊天补全 3=嵌入 5=图像生成 7=语音合成 8=语音转录 10=重排序 11=PDF 解析 12=Anthropic */
  type: number
  rpm: number
  /** 每 1K tokens 的金额（与余额同币种） */
  inputPrice?: number
  outputPrice?: number
  cachedPrice?: number
  /** 上下文窗口 */
  contextTokens?: number
  vision?: boolean
  toolChoice?: boolean
}

/** 用量按天序列（unix 秒 + 数值） */
export interface AiUsagePoint {
  timestamp: number
  requests: number
  inputTokens: number
  outputTokens: number
  amount: number
  exceptions: number
}

export interface AiUsageSummary {
  requests: number
  exceptions: number
  inputTokens: number
  outputTokens: number
  amount: number
  points: AiUsagePoint[]
}

export interface AiProxyOverview {
  /** OpenAI 兼容端点，如 https://aiproxy.usw-1.sealos.io/v1 */
  endpoint: string
  /** shellCoin | cny | usd */
  currency: string
  docUrl?: string
  keys: AiKeyInfo[]
  models: AiModelInfo[]
  /** 近 7 天用量 */
  usage: AiUsageSummary
  fetchedAt: string
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

/** GET template.{region}/api/v2alpha/templates/{name} 的 args 项（即 spec.inputs） */
export interface TemplateArgDef {
  description: string
  type: string
  default: string
  required: boolean
}

/** 同上接口的 quota：cpu 核、memory/storage GiB */
export interface TemplateQuota {
  cpu: number
  memory: number
  storage: number
  nodeport: number
}

export interface TemplateDetail {
  name: string
  args: Record<string, TemplateArgDef>
  quota: TemplateQuota
}

export interface TemplateDeployResult {
  instanceName: string
}

export interface RegionOption {
  url: string
  label: string
}

export type AgentRuntimeState = 'stopped' | 'starting' | 'ready' | 'error'

export interface AgentStatus {
  state: AgentRuntimeState
  detail?: string
}

export type ChatActivityStatus = 'running' | 'done' | 'error'

export interface ChatActivity {
  id: string
  label: string
  detail?: string
  status: ChatActivityStatus
}

export type ChatTraceItem =
  | { type: 'thinking'; stepIndex: number; text: string }
  | { type: 'activity'; id: string; label: string; detail?: string; status: ChatActivityStatus }

export interface ChatQuestionOption {
  id: string
  label: string
}

export interface ChatQuestion {
  requestId: string
  kind: string
  prompt: string
  options?: ChatQuestionOption[]
  allowFreeform?: boolean
  toolName?: string
}

export interface ChatInputResponse {
  requestId: string
  optionId?: string
  text?: string
}

export interface ChatAttachment {
  path: string
  filename: string
  mediaType: string
  size: number
}

export const MAX_CHAT_FILES = 8

export interface ChatStoredAttachment {
  filename: string
  mediaType: string
  size: number
}

export interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  text: string
  attachments?: ChatStoredAttachment[]
  trace?: ChatTraceItem[]
  reasoning?: string
  activities?: ChatActivity[]
  pending?: boolean
  error?: string
}

export interface ChatListItem {
  id: string
  title: string
  updatedAt: string
}

export interface ChatConversation {
  id: string
  title: string
  workspaceId: string
  eveSessionId: string | null
  streamIndex: number
  messages: ChatMessage[]
  questions?: ChatQuestion[]
  createdAt: string
  updatedAt: string
}

export type ChatEvent =
  | { type: 'snapshot'; conversation: ChatConversation }
  | { type: 'delta'; conversationId: string; text: string }
  | { type: 'trace'; conversationId: string; items: ChatTraceItem[] }
  | { type: 'question'; conversationId: string; questions: ChatQuestion[] }
  | { type: 'waiting'; conversationId: string }
  | { type: 'done'; conversationId: string }
  | { type: 'cancelled'; conversationId: string }
  | { type: 'error'; conversationId: string; message: string }
  | { type: 'deleted'; conversationId: string }
  | { type: 'index'; workspaceId: string; items: ChatListItem[] }

export interface HeliosApi {
  getStatus(): Promise<SealosStatus>
  getRegions(): Promise<RegionOption[]>
  startLogin(region?: string): Promise<void>
  cancelLogin(): Promise<void>
  saveKubeconfig(text: string): Promise<SealosStatus>
  logout(): Promise<void>
  getResources(): Promise<ResourceSnapshot>
  getAppDetail(name: string, kind: 'Deployment' | 'StatefulSet'): Promise<AppDetail>
  getProjectDetail(name: string): Promise<ProjectDetail>
  getAppMonitor(name: string): Promise<AppMonitor>
  getPodLogs(pod: string, container?: string, previous?: boolean): Promise<string>
  getAiProxyOverview(): Promise<AiProxyOverview>
  createAiKey(name: string): Promise<AiKeyInfo>
  setAiKeyEnabled(id: number, enabled: boolean): Promise<void>
  deleteAiKey(id: number): Promise<void>
  getTemplates(): Promise<TemplateCatalog>
  getTemplateDetail(templateName: string): Promise<TemplateDetail>
  deployTemplate(templateName: string, args?: Record<string, string>): Promise<TemplateDeployResult>
  deleteApp(name: string): Promise<void>
  restartApp(name: string): Promise<void>
  pauseApp(name: string): Promise<void>
  startApp(name: string): Promise<void>
  deleteProject(name: string): Promise<void>
  restartProject(name: string): Promise<void>
  pauseProject(name: string): Promise<void>
  startProject(name: string): Promise<void>
  getDatabaseDetail(name: string): Promise<DatabaseInstanceDetail>
  getDatabaseMonitor(name: string): Promise<DatabaseMonitor>
  getDatabaseSchema(name: string): Promise<DatabaseSchemaTree>
  pauseDatabase(name: string): Promise<void>
  startDatabase(name: string): Promise<void>
  restartDatabase(name: string): Promise<void>
  deleteDatabase(name: string): Promise<void>
  enableDatabasePublic(name: string): Promise<void>
  disableDatabasePublic(name: string): Promise<void>
  listWorkspaces(): Promise<WorkspaceInfo[]>
  switchWorkspace(uid: string): Promise<SealosStatus>
  getWorkspaceDetails(uid: string): Promise<WorkspaceDetails>
  renameWorkspace(uid: string, teamName: string): Promise<SealosStatus>
  createWorkspace(teamName: string): Promise<WorkspaceInfo>
  getInviteLink(uid: string, role: 'manager' | 'developer'): Promise<string>
  openExternal(url: string): Promise<void>
  copyText(text: string): Promise<void>
  getAgentStatus(): Promise<AgentStatus>
  listChats(): Promise<ChatListItem[]>
  getChat(id: string): Promise<ChatConversation | null>
  pickChatFiles(): Promise<ChatAttachment[]>
  sendChatMessage(
    conversationId: string,
    text: string,
    attachments?: ChatAttachment[]
  ): Promise<void>
  cancelChat(conversationId: string): Promise<void>
  respondChat(conversationId: string, responses: ChatInputResponse[]): Promise<void>
  deleteChat(conversationId: string): Promise<void>
  onLoginEvent(listener: (event: LoginEvent) => void): () => void
  onAgentStatus(listener: (status: AgentStatus) => void): () => void
  onChatEvent(listener: (event: ChatEvent) => void): () => void
}
