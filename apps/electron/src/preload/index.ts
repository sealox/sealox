import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'
import type {
  AgentExecutorInfo,
  AgentStatus,
  AppUpdateStatus,
  AiKeyInfo,
  AiProxyOverview,
  AppDetail,
  AppMonitor,
  ChatAttachment,
  ChatConversation,
  ChatEvent,
  ChatInputResponse,
  ChatListItem,
  DatabaseInstanceDetail,
  DatabaseMonitor,
  DatabaseSchemaTree,
  HeliosApi,
  LoginEvent,
  ModelSettings,
  ProjectDetail,
  RegionOption,
  ResourceSnapshot,
  SealosStatus,
  TemplateCatalog,
  TemplateDetail,
  TemplateDeployResult,
  WorkspaceDetails,
  WorkspaceInfo
} from '../shared/types'

const helios: HeliosApi = {
  getAppVersion: (): Promise<string> => ipcRenderer.invoke('helios:app-version'),
  getUpdateStatus: (): Promise<AppUpdateStatus> => ipcRenderer.invoke('helios:update-status'),
  downloadUpdate: (): Promise<void> => ipcRenderer.invoke('helios:update-download'),
  getStatus: (): Promise<SealosStatus> => ipcRenderer.invoke('sealos:status'),
  getRegions: (): Promise<RegionOption[]> => ipcRenderer.invoke('sealos:regions'),
  startLogin: (region?: string): Promise<void> => ipcRenderer.invoke('sealos:login-start', region),
  cancelLogin: (): Promise<void> => ipcRenderer.invoke('sealos:login-cancel'),
  saveKubeconfig: (text: string): Promise<SealosStatus> =>
    ipcRenderer.invoke('sealos:save-kubeconfig', text),
  logout: (): Promise<void> => ipcRenderer.invoke('sealos:logout'),
  getResources: (): Promise<ResourceSnapshot> => ipcRenderer.invoke('sealos:resources'),
  getAppDetail: (name: string, kind: 'Deployment' | 'StatefulSet'): Promise<AppDetail> =>
    ipcRenderer.invoke('sealos:app-detail', name, kind),
  getProjectDetail: (name: string): Promise<ProjectDetail> =>
    ipcRenderer.invoke('sealos:project-detail', name),
  getAppMonitor: (name: string): Promise<AppMonitor> =>
    ipcRenderer.invoke('sealos:app-monitor', name),
  getPodLogs: (pod: string, container?: string, previous?: boolean): Promise<string> =>
    ipcRenderer.invoke('sealos:pod-logs', pod, container, previous),
  getAiProxyOverview: (): Promise<AiProxyOverview> => ipcRenderer.invoke('sealos:aiproxy-overview'),
  createAiKey: (name: string): Promise<AiKeyInfo> =>
    ipcRenderer.invoke('sealos:aiproxy-create-key', name),
  setAiKeyEnabled: (id: number, enabled: boolean): Promise<void> =>
    ipcRenderer.invoke('sealos:aiproxy-key-status', id, enabled),
  deleteAiKey: (id: number): Promise<void> => ipcRenderer.invoke('sealos:aiproxy-delete-key', id),
  getTemplates: (): Promise<TemplateCatalog> => ipcRenderer.invoke('sealos:templates'),
  getTemplateDetail: (templateName: string): Promise<TemplateDetail> =>
    ipcRenderer.invoke('sealos:template-detail', templateName),
  deployTemplate: (
    templateName: string,
    args?: Record<string, string>
  ): Promise<TemplateDeployResult> =>
    ipcRenderer.invoke('sealos:template-deploy', templateName, args),
  deleteApp: (name: string): Promise<void> => ipcRenderer.invoke('sealos:app-delete', name),
  restartApp: (name: string): Promise<void> => ipcRenderer.invoke('sealos:app-restart', name),
  pauseApp: (name: string): Promise<void> => ipcRenderer.invoke('sealos:app-pause', name),
  startApp: (name: string): Promise<void> => ipcRenderer.invoke('sealos:app-start', name),
  deleteProject: (name: string): Promise<void> => ipcRenderer.invoke('sealos:project-delete', name),
  restartProject: (name: string): Promise<void> =>
    ipcRenderer.invoke('sealos:project-restart', name),
  pauseProject: (name: string): Promise<void> => ipcRenderer.invoke('sealos:project-pause', name),
  startProject: (name: string): Promise<void> => ipcRenderer.invoke('sealos:project-start', name),
  getDatabaseDetail: (name: string): Promise<DatabaseInstanceDetail> =>
    ipcRenderer.invoke('sealos:database-detail', name),
  getDatabaseMonitor: (name: string): Promise<DatabaseMonitor> =>
    ipcRenderer.invoke('sealos:database-monitor', name),
  getDatabaseSchema: (name: string): Promise<DatabaseSchemaTree> =>
    ipcRenderer.invoke('sealos:database-schema', name),
  pauseDatabase: (name: string): Promise<void> => ipcRenderer.invoke('sealos:database-pause', name),
  startDatabase: (name: string): Promise<void> => ipcRenderer.invoke('sealos:database-start', name),
  restartDatabase: (name: string): Promise<void> =>
    ipcRenderer.invoke('sealos:database-restart', name),
  deleteDatabase: (name: string): Promise<void> =>
    ipcRenderer.invoke('sealos:database-delete', name),
  enableDatabasePublic: (name: string): Promise<void> =>
    ipcRenderer.invoke('sealos:database-enable-public', name),
  disableDatabasePublic: (name: string): Promise<void> =>
    ipcRenderer.invoke('sealos:database-disable-public', name),
  listWorkspaces: (): Promise<WorkspaceInfo[]> => ipcRenderer.invoke('sealos:workspaces'),
  switchWorkspace: (uid: string): Promise<SealosStatus> =>
    ipcRenderer.invoke('sealos:workspace-switch', uid),
  getWorkspaceDetails: (uid: string): Promise<WorkspaceDetails> =>
    ipcRenderer.invoke('sealos:workspace-details', uid),
  renameWorkspace: (uid: string, teamName: string): Promise<SealosStatus> =>
    ipcRenderer.invoke('sealos:workspace-rename', uid, teamName),
  createWorkspace: (teamName: string): Promise<WorkspaceInfo> =>
    ipcRenderer.invoke('sealos:workspace-create', teamName),
  getInviteLink: (uid: string, role: 'manager' | 'developer'): Promise<string> =>
    ipcRenderer.invoke('sealos:workspace-invite', uid, role),
  openExternal: (url: string): Promise<void> => ipcRenderer.invoke('sealos:open-external', url),
  copyText: (text: string): Promise<void> => ipcRenderer.invoke('helios:copy-text', text),
  getAgentStatus: (): Promise<AgentStatus> => ipcRenderer.invoke('helios:agent-status'),
  getModelSettings: (): Promise<ModelSettings> => ipcRenderer.invoke('helios:model-settings'),
  saveDeepseekKey: (key: string): Promise<void> =>
    ipcRenderer.invoke('helios:model-save-deepseek', key),
  clearDeepseekKey: (): Promise<void> => ipcRenderer.invoke('helios:model-clear'),
  getAgentExecutors: (): Promise<AgentExecutorInfo[]> =>
    ipcRenderer.invoke('helios:agent-executors'),
  setAgentExecutor: (id: string | null): Promise<void> =>
    ipcRenderer.invoke('helios:agent-executor-set', id),
  listChats: (): Promise<ChatListItem[]> => ipcRenderer.invoke('helios:chat-list'),
  getChat: (id: string): Promise<ChatConversation | null> =>
    ipcRenderer.invoke('helios:chat-get', id),
  getOrCreateProjectChat: (
    projectName: string,
    projectContext?: string
  ): Promise<ChatConversation> =>
    ipcRenderer.invoke('helios:chat-project', projectName, projectContext),
  pickChatFiles: (): Promise<ChatAttachment[]> => ipcRenderer.invoke('helios:chat-pick-files'),
  sendChatMessage: (
    conversationId: string,
    text: string,
    attachments?: ChatAttachment[]
  ): Promise<void> => ipcRenderer.invoke('helios:chat-send', conversationId, text, attachments),
  cancelChat: (conversationId: string): Promise<void> =>
    ipcRenderer.invoke('helios:chat-cancel', conversationId),
  respondChat: (conversationId: string, responses: ChatInputResponse[]): Promise<void> =>
    ipcRenderer.invoke('helios:chat-respond', conversationId, responses),
  renameChat: (conversationId: string, title: string): Promise<void> =>
    ipcRenderer.invoke('helios:chat-rename', conversationId, title),
  archiveChat: (conversationId: string): Promise<void> =>
    ipcRenderer.invoke('helios:chat-archive', conversationId),
  deleteChat: (conversationId: string): Promise<void> =>
    ipcRenderer.invoke('helios:chat-delete', conversationId),
  onLoginEvent: (listener: (event: LoginEvent) => void): (() => void) => {
    const wrapped = (_: Electron.IpcRendererEvent, event: LoginEvent): void => listener(event)
    ipcRenderer.on('sealos:login-event', wrapped)
    return () => ipcRenderer.removeListener('sealos:login-event', wrapped)
  },
  onAgentStatus: (listener: (status: AgentStatus) => void): (() => void) => {
    const wrapped = (_: Electron.IpcRendererEvent, event: AgentStatus): void => listener(event)
    ipcRenderer.on('helios:agent-status', wrapped)
    return () => ipcRenderer.removeListener('helios:agent-status', wrapped)
  },
  onChatEvent: (listener: (event: ChatEvent) => void): (() => void) => {
    const wrapped = (_: Electron.IpcRendererEvent, event: ChatEvent): void => listener(event)
    ipcRenderer.on('helios:chat-event', wrapped)
    return () => ipcRenderer.removeListener('helios:chat-event', wrapped)
  },
  onUpdateEvent: (listener: (status: AppUpdateStatus) => void): (() => void) => {
    const wrapped = (_: Electron.IpcRendererEvent, event: AppUpdateStatus): void => listener(event)
    ipcRenderer.on('helios:update-event', wrapped)
    return () => ipcRenderer.removeListener('helios:update-event', wrapped)
  }
}

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI)
    contextBridge.exposeInMainWorld('helios', helios)
  } catch (error) {
    console.error(error)
  }
} else {
  // @ts-ignore (define in dts)
  window.electron = electronAPI
  // @ts-ignore (define in dts)
  window.helios = helios
}
