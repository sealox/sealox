import { app, BrowserWindow, clipboard, dialog, ipcMain, shell } from 'electron'
import { join } from 'path'
import { electronApp, is, optimizer } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'
import {
  invokeDesktopMethod,
  startDesktopServices,
  stopDesktopServices,
  type DesktopMethod
} from './desktop-api'
import { configureDesktopHost } from './desktop-host'

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

  mainWindow.on('ready-to-show', () => mainWindow.show())
  mainWindow.webContents.setWindowOpenHandler((details) => {
    void shell.openExternal(details.url)
    return { action: 'deny' }
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    void mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    void mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
  return mainWindow
}

const IPC_METHODS: ReadonlyArray<readonly [string, DesktopMethod]> = [
  ['helios:app-version', 'getAppVersion'],
  ['helios:update-status', 'getUpdateStatus'],
  ['helios:update-download', 'downloadUpdate'],
  ['sealos:status', 'getStatus'],
  ['sealos:regions', 'getRegions'],
  ['sealos:login-start', 'startLogin'],
  ['sealos:login-cancel', 'cancelLogin'],
  ['sealos:save-kubeconfig', 'saveKubeconfig'],
  ['sealos:logout', 'logout'],
  ['sealos:resources', 'getResources'],
  ['sealos:app-detail', 'getAppDetail'],
  ['sealos:project-detail', 'getProjectDetail'],
  ['sealos:app-monitor', 'getAppMonitor'],
  ['sealos:pod-logs', 'getPodLogs'],
  ['sealos:aiproxy-overview', 'getAiProxyOverview'],
  ['sealos:aiproxy-create-key', 'createAiKey'],
  ['sealos:aiproxy-key-status', 'setAiKeyEnabled'],
  ['sealos:aiproxy-delete-key', 'deleteAiKey'],
  ['sealos:templates', 'getTemplates'],
  ['sealos:template-detail', 'getTemplateDetail'],
  ['sealos:template-deploy', 'deployTemplate'],
  ['sealos:app-delete', 'deleteApp'],
  ['sealos:app-restart', 'restartApp'],
  ['sealos:app-pause', 'pauseApp'],
  ['sealos:app-start', 'startApp'],
  ['sealos:project-delete', 'deleteProject'],
  ['sealos:project-restart', 'restartProject'],
  ['sealos:project-pause', 'pauseProject'],
  ['sealos:project-start', 'startProject'],
  ['sealos:database-detail', 'getDatabaseDetail'],
  ['sealos:database-monitor', 'getDatabaseMonitor'],
  ['sealos:database-schema', 'getDatabaseSchema'],
  ['sealos:database-pause', 'pauseDatabase'],
  ['sealos:database-start', 'startDatabase'],
  ['sealos:database-restart', 'restartDatabase'],
  ['sealos:database-delete', 'deleteDatabase'],
  ['sealos:database-enable-public', 'enableDatabasePublic'],
  ['sealos:database-disable-public', 'disableDatabasePublic'],
  ['sealos:workspaces', 'listWorkspaces'],
  ['sealos:workspace-switch', 'switchWorkspace'],
  ['sealos:workspace-details', 'getWorkspaceDetails'],
  ['sealos:workspace-rename', 'renameWorkspace'],
  ['sealos:workspace-create', 'createWorkspace'],
  ['sealos:workspace-invite', 'getInviteLink'],
  ['sealos:open-external', 'openExternal'],
  ['helios:copy-text', 'copyText'],
  ['helios:agent-status', 'getAgentStatus'],
  ['helios:model-settings', 'getModelSettings'],
  ['helios:model-save-deepseek', 'saveDeepseekKey'],
  ['helios:model-clear', 'clearDeepseekKey'],
  ['helios:agent-executors', 'getAgentExecutors'],
  ['helios:agent-executor-set', 'setAgentExecutor'],
  ['helios:chat-list', 'listChats'],
  ['helios:chat-get', 'getChat'],
  ['helios:chat-project', 'getOrCreateProjectChat'],
  ['helios:chat-pick-files', 'pickChatFiles'],
  ['helios:chat-send', 'sendChatMessage'],
  ['helios:chat-cancel', 'cancelChat'],
  ['helios:chat-respond', 'respondChat'],
  ['helios:chat-rename', 'renameChat'],
  ['helios:chat-archive', 'archiveChat'],
  ['helios:chat-delete', 'deleteChat']
]

function registerIpc(): void {
  for (const [channel, method] of IPC_METHODS) {
    ipcMain.handle(channel, (_event, ...args: unknown[]) => invokeDesktopMethod(method, args))
  }
}

app.whenReady().then(() => {
  electronApp.setAppUserModelId('com.helios.app')
  configureDesktopHost({
    isPackaged: app.isPackaged,
    appRoot: app.getAppPath(),
    resourcesPath: process.resourcesPath,
    userDataPath: app.getPath('userData'),
    downloadsPath: app.getPath('downloads'),
    appVersion: app.getVersion(),
    platform: process.platform,
    emit(channel, payload) {
      for (const window of BrowserWindow.getAllWindows()) {
        if (!window.isDestroyed()) window.webContents.send(channel, payload)
      }
    },
    async openExternal(url) {
      await shell.openExternal(url)
    },
    openPath(path) {
      return shell.openPath(path)
    },
    async writeClipboard(text) {
      clipboard.writeText(text)
    },
    async selectFiles() {
      const window = BrowserWindow.getFocusedWindow()
      const options = {
        title: '添加文件',
        properties: ['openFile', 'multiSelections'] as Array<'openFile' | 'multiSelections'>
      }
      const result = window
        ? await dialog.showOpenDialog(window, options)
        : await dialog.showOpenDialog(options)
      return result.canceled ? [] : result.filePaths
    }
  })

  if (process.platform === 'darwin') app.dock?.setIcon(icon)
  app.on('browser-window-created', (_, window) => optimizer.watchWindowShortcuts(window))

  registerIpc()
  createWindow()
  startDesktopServices()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('before-quit', () => void stopDesktopServices())
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
