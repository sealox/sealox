import { app, shell, clipboard, BrowserWindow, ipcMain } from 'electron'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'
import type { ChatAttachment, ChatInputResponse, LoginEvent } from '../shared/types'
import {
  getAgentStatus,
  restartAgent,
  startAgent,
  stopAgent,
  listChats,
  getChat,
  pickChatFiles,
  sendChatMessage,
  cancelChat,
  respondChat,
  deleteChat
} from './agent/runtime'
import {
  cancelLogin,
  getStatus,
  KNOWN_REGIONS,
  logout,
  saveKubeconfigText,
  startDeviceLogin
} from './sealos/auth'
import { createAiKey, deleteAiKey, fetchAiProxyOverview, setAiKeyEnabled } from './sealos/aiproxy'
import {
  disableDatabasePublic,
  enableDatabasePublic,
  fetchDatabaseDetail,
  fetchDatabaseMonitor,
  fetchDatabaseSchema
} from './sealos/database'
import { fetchAppDetail, fetchAppMonitor, fetchPodLogs, fetchProjectDetail } from './sealos/details'
import {
  deleteApp,
  deleteDatabase,
  deleteProject,
  pauseApp,
  pauseDatabase,
  pauseProject,
  restartApp,
  restartDatabase,
  restartProject,
  startApp,
  startDatabase,
  startProject
} from './sealos/operate'
import { fetchResources } from './sealos/resources'
import { deployTemplate, fetchTemplateDetail, fetchTemplates } from './sealos/templates'
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
  ipcMain.handle('helios:app-version', () => app.getVersion())
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
      if (loginEvent.type === 'success') void startAgent()
    })
  })

  ipcMain.handle('sealos:login-cancel', () => cancelLogin())
  ipcMain.handle('sealos:save-kubeconfig', async (_event, text: string) => {
    const status = await saveKubeconfigText(text)
    void startAgent()
    return status
  })
  ipcMain.handle('sealos:logout', async () => {
    await stopAgent()
    await logout()
  })
  ipcMain.handle('sealos:resources', () => fetchResources())
  ipcMain.handle('sealos:app-detail', (_event, name: string, kind: 'Deployment' | 'StatefulSet') =>
    fetchAppDetail(name, kind)
  )
  ipcMain.handle('sealos:project-detail', (_event, name: string) => fetchProjectDetail(name))
  ipcMain.handle('sealos:app-monitor', (_event, name: string) => fetchAppMonitor(name))
  ipcMain.handle('sealos:pod-logs', (_event, pod: string, container?: string, previous?: boolean) =>
    fetchPodLogs(pod, container, previous)
  )
  ipcMain.handle('sealos:aiproxy-overview', () => fetchAiProxyOverview())
  ipcMain.handle('sealos:aiproxy-create-key', (_event, name: string) => createAiKey(name))
  ipcMain.handle('sealos:aiproxy-key-status', (_event, id: number, enabled: boolean) =>
    setAiKeyEnabled(id, enabled)
  )
  ipcMain.handle('sealos:aiproxy-delete-key', (_event, id: number) => deleteAiKey(id))
  ipcMain.handle('sealos:templates', () => fetchTemplates())
  ipcMain.handle('sealos:template-detail', (_event, templateName: string) =>
    fetchTemplateDetail(templateName)
  )
  ipcMain.handle(
    'sealos:template-deploy',
    (_event, templateName: string, args?: Record<string, string>) =>
      deployTemplate(templateName, args)
  )
  ipcMain.handle('sealos:app-delete', (_event, name: string) => deleteApp(name))
  ipcMain.handle('sealos:app-restart', (_event, name: string) => restartApp(name))
  ipcMain.handle('sealos:app-pause', (_event, name: string) => pauseApp(name))
  ipcMain.handle('sealos:app-start', (_event, name: string) => startApp(name))
  ipcMain.handle('sealos:project-delete', (_event, name: string) => deleteProject(name))
  ipcMain.handle('sealos:project-restart', (_event, name: string) => restartProject(name))
  ipcMain.handle('sealos:project-pause', (_event, name: string) => pauseProject(name))
  ipcMain.handle('sealos:project-start', (_event, name: string) => startProject(name))
  ipcMain.handle('sealos:database-detail', (_event, name: string) => fetchDatabaseDetail(name))
  ipcMain.handle('sealos:database-monitor', (_event, name: string) => fetchDatabaseMonitor(name))
  ipcMain.handle('sealos:database-schema', (_event, name: string) => fetchDatabaseSchema(name))
  ipcMain.handle('sealos:database-pause', (_event, name: string) => pauseDatabase(name))
  ipcMain.handle('sealos:database-start', (_event, name: string) => startDatabase(name))
  ipcMain.handle('sealos:database-restart', (_event, name: string) => restartDatabase(name))
  ipcMain.handle('sealos:database-delete', (_event, name: string) => deleteDatabase(name))
  ipcMain.handle('sealos:database-enable-public', (_event, name: string) =>
    enableDatabasePublic(name)
  )
  ipcMain.handle('sealos:database-disable-public', (_event, name: string) =>
    disableDatabasePublic(name)
  )
  ipcMain.handle('sealos:workspaces', () => listWorkspaces())
  ipcMain.handle('sealos:workspace-switch', async (_event, uid: string) => {
    const status = await switchWorkspace(uid)
    void restartAgent()
    return status
  })
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
  ipcMain.handle('helios:agent-status', () => getAgentStatus())
  ipcMain.handle('helios:chat-list', () => listChats())
  ipcMain.handle('helios:chat-get', (_event, id: string) => getChat(id))
  ipcMain.handle('helios:chat-pick-files', (event) =>
    pickChatFiles(BrowserWindow.fromWebContents(event.sender))
  )
  ipcMain.handle(
    'helios:chat-send',
    (_event, conversationId: string, text: string, attachments?: ChatAttachment[]) =>
      sendChatMessage(conversationId, text, attachments)
  )
  ipcMain.handle('helios:chat-cancel', (_event, conversationId: string) =>
    cancelChat(conversationId)
  )
  ipcMain.handle(
    'helios:chat-respond',
    (_event, conversationId: string, responses: ChatInputResponse[]) =>
      respondChat(conversationId, responses)
  )
  ipcMain.handle('helios:chat-delete', (_event, conversationId: string) =>
    deleteChat(conversationId)
  )
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
  if (getStatus().authenticated) void startAgent()

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('before-quit', () => {
  void stopAgent()
})

app.on('window-all-closed', () => {
  cancelLogin()
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
