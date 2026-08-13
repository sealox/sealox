import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'
import type {
  HeliosApi,
  LoginEvent,
  RegionOption,
  ResourceSnapshot,
  SealosStatus
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
  openExternal: (url: string): Promise<void> => ipcRenderer.invoke('sealos:open-external', url),
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
