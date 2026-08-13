import { app, shell, clipboard, BrowserWindow, ipcMain } from 'electron'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'
import type { LoginEvent } from '../shared/types'
import {
  cancelLogin,
  getStatus,
  KNOWN_REGIONS,
  logout,
  saveKubeconfigText,
  startDeviceLogin
} from './sealos/auth'
import { fetchAppDetail, fetchAppMonitor, fetchPodLogs, fetchProjectDetail } from './sealos/details'
import { fetchResources } from './sealos/resources'
import { fetchTemplates } from './sealos/templates'
import {
  createWorkspace,
  getInviteLink,
  getWorkspaceDetails,
  listWorkspaces,
  renameWorkspace,
  switchWorkspace
} from './sealos/workspaces'

function createWindow(): BrowserWindow {
  const mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 940,
    minHeight: 620,
    show: false,
    autoHideMenuBar: true,
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    backgroundColor: '#f6f7f9',
    ...(process.platform === 'linux' ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow.show()
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
  return mainWindow
}

function registerIpc(): void {
  ipcMain.handle('sealos:status', () => getStatus())
  ipcMain.handle('sealos:regions', () => KNOWN_REGIONS)

  ipcMain.handle('sealos:login-start', (event, region?: string) => {
    const sender = event.sender
    void startDeviceLogin(region, (loginEvent: LoginEvent) => {
      if (sender.isDestroyed()) return
      sender.send('sealos:login-event', loginEvent)
      // Mirror the skill's behavior: open the verification page immediately
      // so the user only has to approve in the browser.
      if (loginEvent.type === 'device_code' && loginEvent.verificationUrl) {
        void shell.openExternal(loginEvent.verificationUrl)
      }
    })
  })

  ipcMain.handle('sealos:login-cancel', () => cancelLogin())
  ipcMain.handle('sealos:save-kubeconfig', (_event, text: string) => saveKubeconfigText(text))
  ipcMain.handle('sealos:logout', () => logout())
  ipcMain.handle('sealos:resources', () => fetchResources())
  ipcMain.handle('sealos:app-detail', (_event, name: string, kind: 'Deployment' | 'StatefulSet') =>
    fetchAppDetail(name, kind)
  )
  ipcMain.handle('sealos:project-detail', (_event, name: string) => fetchProjectDetail(name))
  ipcMain.handle('sealos:app-monitor', (_event, name: string) => fetchAppMonitor(name))
  ipcMain.handle('sealos:pod-logs', (_event, pod: string, container?: string, previous?: boolean) =>
    fetchPodLogs(pod, container, previous)
  )
  ipcMain.handle('sealos:templates', () => fetchTemplates())
  ipcMain.handle('sealos:workspaces', () => listWorkspaces())
  ipcMain.handle('sealos:workspace-switch', (_event, uid: string) => switchWorkspace(uid))
  ipcMain.handle('sealos:workspace-details', (_event, uid: string) => getWorkspaceDetails(uid))
  ipcMain.handle('sealos:workspace-rename', (_event, uid: string, teamName: string) =>
    renameWorkspace(uid, teamName)
  )
  ipcMain.handle('sealos:workspace-create', (_event, teamName: string) => createWorkspace(teamName))
  ipcMain.handle('sealos:workspace-invite', (_event, uid: string, role: 'manager' | 'developer') =>
    getInviteLink(uid, role)
  )

  ipcMain.handle('sealos:open-external', (_event, url: string) => {
    if (/^https?:\/\//.test(url)) return shell.openExternal(url)
    return undefined
  })

  // 渲染进程的 navigator.clipboard 依赖窗口聚焦，桌面场景统一走主进程剪贴板
  ipcMain.handle('helios:copy-text', (_event, text: string) => {
    clipboard.writeText(text)
  })
}

app.whenReady().then(() => {
  electronApp.setAppUserModelId('com.helios.app')

  // Packaged builds get the icon from electron-builder; dev needs it set here.
  if (process.platform === 'darwin') {
    app.dock?.setIcon(icon)
  }

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  registerIpc()
  createWindow()

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  cancelLogin()
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
