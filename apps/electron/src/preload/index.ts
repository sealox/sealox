import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'
import type {
  HeliosApi,
  LoginEvent,
  RegionOption,
  ResourceSnapshot,
  SealosStatus,
  TemplateCatalog,
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
  getTemplates: (): Promise<TemplateCatalog> => ipcRenderer.invoke('sealos:templates'),
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
  onLoginEvent: (listener: (event: LoginEvent) => void): (() => void) => {
    const wrapped = (_: Electron.IpcRendererEvent, event: LoginEvent): void => listener(event)
    ipcRenderer.on('sealos:login-event', wrapped)
    return () => ipcRenderer.removeListener('sealos:login-event', wrapped)
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
