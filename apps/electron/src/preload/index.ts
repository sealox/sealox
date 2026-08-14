import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'
import type {
  AgentStatus,
  AiKeyInfo,
  AiProxyOverview,
  AppDetail,
  AppMonitor,
  ChatAttachment,
  ChatConversation,
  ChatEvent,
  ChatInputResponse,
  ChatListItem,
  HeliosApi,
  LoginEvent,
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
  listChats: (): Promise<ChatListItem[]> => ipcRenderer.invoke('helios:chat-list'),
  getChat: (id: string): Promise<ChatConversation | null> =>
    ipcRenderer.invoke('helios:chat-get', id),
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
