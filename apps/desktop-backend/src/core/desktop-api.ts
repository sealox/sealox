import type { ChatAttachment, ChatInputResponse, LoginEvent } from '../shared/types'
import {
  archiveChat,
  cancelChat,
  createChat,
  deleteChat,
  getAgentStatus,
  getChat,
  getOrCreateProjectChat,
  listChats,
  renameChat,
  respondChat,
  restartAgent,
  sendChatMessage,
  startAgent,
  stopAgent
} from './agent/runtime'
import { pickChatFiles } from './agent/chat-files'
import { createAiKey, deleteAiKey, fetchAiProxyOverview, setAiKeyEnabled } from './sealos/aiproxy'
import {
  cancelLogin,
  getStatus,
  KNOWN_REGIONS,
  switchRegion,
  logout,
  saveKubeconfigText,
  startDeviceLogin
} from './sealos/auth'
import {
  disableDatabasePublic,
  enableDatabasePublic,
  fetchDatabaseDetail,
  fetchDatabaseMonitor
} from './sealos/database'
import { fetchAppDetail, fetchAppMonitor, fetchPodLogs, fetchProjectDetail } from './sealos/details'
import { fetchDatabaseCatalog, fetchDatabaseTableData } from './sealos/database-data'
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
import { clearDeepseekKey, getModelSettings, saveDeepseekKey } from './model-settings'
import { getAgentExecutors, setAgentExecutor } from './agent-executors'
import { checkForUpdate, downloadUpdate, getUpdateStatus, startUpdateChecker, stopUpdateChecker } from './update'
import { desktopHost } from './desktop-host'
import { createStorageBucket, setStoragePolicy, getWorkspaceStorageCredentials, getStorageCredentials, uploadStorageFile, downloadStorageFile, listStorageObjects, uploadStorageObject, deleteStorageObject, createStorageFolder, getStorageDownloadUrl, getStorageInfo } from './sealos/storage'
import { getDomainBinding, bindDomain } from './sealos/domains'

export const DESKTOP_METHODS = [
  'getAppVersion',
  'getUpdateStatus',
  'checkForUpdate',
  'downloadUpdate',
  'getStatus',
  'getRegions',
  'startLogin',
  'cancelLogin',
  'saveKubeconfig',
  'logout',
  'getResources',
  'getAppDetail',
  'getProjectDetail',
  'getAppMonitor',
  'getPodLogs',
  'getAiProxyOverview',
  'createAiKey',
  'setAiKeyEnabled',
  'deleteAiKey',
  'getTemplates',
  'getTemplateDetail',
  'deployTemplate',
  'deleteApp',
  'restartApp',
  'pauseApp',
  'startApp',
  'deleteProject',
  'restartProject',
  'pauseProject',
  'startProject',
  'getDatabaseDetail',
  'getDatabaseMonitor',
  'getDatabaseSchema',
  'getDatabaseTableData',
  'pauseDatabase',
  'startDatabase',
  'restartDatabase',
  'deleteDatabase',
  'enableDatabasePublic',
  'disableDatabasePublic',
  'listWorkspaces',
  'switchWorkspace',
  'switchRegion',
  'getWorkspaceDetails',
  'renameWorkspace',
  'createWorkspace',
  'getInviteLink',
  'openExternal',
  'copyText',
  'getAgentStatus',
  'getModelSettings',
  'saveDeepseekKey',
  'clearDeepseekKey',
  'getAgentExecutors',
  'setAgentExecutor',
  'listChats',
  'getChat',
  'createChat',
  'getOrCreateProjectChat',
  'pickChatFiles',
  'sendChatMessage',
  'cancelChat',
  'respondChat',
  'renameChat',
  'archiveChat',
  'deleteChat',
  'setStoragePolicy',
  'getWorkspaceStorageCredentials',
  'createStorageBucket',
  'getDomainBinding',
  'bindDomain',
  'getStorageCredentials',
  'uploadStorageFile',
  'downloadStorageFile',
  'listStorageObjects',
  'uploadStorageObject',
  'deleteStorageObject',
  'createStorageFolder',
  'getStorageDownloadUrl',
  'getStorageInfo'
] as const

export type DesktopMethod = (typeof DESKTOP_METHODS)[number]

export async function invokeDesktopMethod(
  method: DesktopMethod,
  args: unknown[] = []
): Promise<unknown> {
  switch (method) {
    case 'getAppVersion':
      return desktopHost().appVersion
    case 'getUpdateStatus':
      return getUpdateStatus()
    case 'checkForUpdate':
      return checkForUpdate()
    case 'downloadUpdate':
      return downloadUpdate()
    case 'getStatus':
      return getStatus()
    case 'getRegions':
      return KNOWN_REGIONS
    case 'startLogin':
      void startDeviceLogin(args[0] as string | undefined, (event: LoginEvent) => {
        desktopHost().emit('sealos:login-event', event)
        if (event.type === 'device_code' && event.verificationUrl) {
          void desktopHost().openExternal(event.verificationUrl)
        }
        if (event.type === 'success') void startAgent()
      })
      return undefined
    case 'cancelLogin':
      return cancelLogin()
    case 'saveKubeconfig': {
      const status = await saveKubeconfigText(String(args[0] ?? ''))
      void startAgent()
      return status
    }
    case 'logout':
      await stopAgent()
      return logout()
    case 'getResources':
      return fetchResources()
    case 'getAppDetail':
      return fetchAppDetail(String(args[0]), args[1] as 'Deployment' | 'StatefulSet')
    case 'getProjectDetail':
      return fetchProjectDetail(String(args[0]))
    case 'getAppMonitor':
      return fetchAppMonitor(String(args[0]))
    case 'getPodLogs':
      return fetchPodLogs(
        String(args[0]),
        args[1] as string | undefined,
        args[2] as boolean | undefined
      )
    case 'getAiProxyOverview':
      return fetchAiProxyOverview()
    case 'createAiKey':
      return createAiKey(String(args[0]))
    case 'setAiKeyEnabled':
      return setAiKeyEnabled(Number(args[0]), Boolean(args[1]))
    case 'deleteAiKey':
      return deleteAiKey(Number(args[0]))
    case 'getTemplates':
      return fetchTemplates()
    case 'getTemplateDetail':
      return fetchTemplateDetail(String(args[0]))
    case 'deployTemplate':
      return deployTemplate(String(args[0]), args[1] as Record<string, string> | undefined)
    case 'deleteApp':
      return deleteApp(String(args[0]))
    case 'restartApp':
      return restartApp(String(args[0]))
    case 'pauseApp':
      return pauseApp(String(args[0]))
    case 'startApp':
      return startApp(String(args[0]))
    case 'deleteProject':
      return deleteProject(String(args[0]))
    case 'restartProject':
      return restartProject(String(args[0]))
    case 'pauseProject':
      return pauseProject(String(args[0]))
    case 'startProject':
      return startProject(String(args[0]))
    case 'getDatabaseDetail':
      return fetchDatabaseDetail(String(args[0]))
    case 'getDatabaseMonitor':
      return fetchDatabaseMonitor(String(args[0]))
    case 'getDatabaseSchema':
      return fetchDatabaseCatalog(String(args[0]))
    case 'getDatabaseTableData':
      return fetchDatabaseTableData(args[0] as import('../shared/types').DatabaseTableRequest)
    case 'pauseDatabase':
      return pauseDatabase(String(args[0]))
    case 'startDatabase':
      return startDatabase(String(args[0]))
    case 'restartDatabase':
      return restartDatabase(String(args[0]))
    case 'deleteDatabase':
      return deleteDatabase(String(args[0]))
    case 'enableDatabasePublic':
      return enableDatabasePublic(String(args[0]))
    case 'disableDatabasePublic':
      return disableDatabasePublic(String(args[0]))
    case 'listWorkspaces':
      return listWorkspaces()
    case 'switchRegion': {
      const status = await switchRegion(String(args[0]))
      if (status) void restartAgent()
      return status
    }
    case 'switchWorkspace': {
      const status = await switchWorkspace(String(args[0]))
      void restartAgent()
      return status
    }
    case 'getWorkspaceDetails':
      return getWorkspaceDetails(String(args[0]))
    case 'renameWorkspace':
      return renameWorkspace(String(args[0]), String(args[1]))
    case 'createWorkspace':
      return createWorkspace(String(args[0]))
    case 'getInviteLink':
      return getInviteLink(String(args[0]), args[1] as 'manager' | 'developer')
    case 'openExternal': {
      const url = String(args[0] ?? '')
      if (/^https?:\/\//.test(url)) await desktopHost().openExternal(url)
      return undefined
    }
    case 'copyText':
      return desktopHost().writeClipboard(String(args[0] ?? ''))
    case 'getAgentStatus':
      return {
        ...getAgentStatus(),
        localExecutor: (await getAgentExecutors()).some((executor) => executor.enabled)
      }
    case 'getModelSettings':
      return getModelSettings()
    case 'saveDeepseekKey':
      await saveDeepseekKey(String(args[0] ?? ''))
      if (getStatus().authenticated) void startAgent()
      return undefined
    case 'clearDeepseekKey':
      await clearDeepseekKey()
      if (getStatus().authenticated) void startAgent()
      return undefined
    case 'getAgentExecutors':
      return getAgentExecutors()
    case 'setAgentExecutor':
      await setAgentExecutor(args[0] === null ? null : String(args[0] ?? ''))
      return undefined
    case 'listChats':
      return listChats()
    case 'getChat':
      return getChat(String(args[0]))
    case 'createChat':
      return createChat(
        typeof args[0] === 'string' && args[0].trim() ? String(args[0]) : undefined,
        typeof args[1] === 'string' ? args[1] : undefined
      )
    case 'getOrCreateProjectChat':
      return getOrCreateProjectChat(
        String(args[0]),
        typeof args[1] === 'string' ? args[1] : undefined
      )
    case 'pickChatFiles':
      return pickChatFiles()
    case 'sendChatMessage':
      return sendChatMessage(
        String(args[0]),
        String(args[1] ?? ''),
        args[2] as ChatAttachment[] | undefined
      )
    case 'cancelChat':
      return cancelChat(String(args[0]))
    case 'respondChat':
      return respondChat(String(args[0]), args[1] as ChatInputResponse[])
    case 'renameChat':
      return renameChat(String(args[0]), String(args[1] ?? ''))
    case 'archiveChat':
      return archiveChat(String(args[0]))
    case 'deleteChat':
      return deleteChat(String(args[0]))
    case 'setStoragePolicy':
      return setStoragePolicy(String(args[0]), String(args[1]))
    case 'getWorkspaceStorageCredentials':
      return getWorkspaceStorageCredentials()
    case 'createStorageBucket':
      return createStorageBucket(String(args[0] ?? ''), String(args[1] ?? 'private'))
    case 'getDomainBinding':
      return getDomainBinding(String(args[0] ?? ''))
    case 'bindDomain':
      return bindDomain(String(args[0] ?? ''), String(args[1] ?? ''))
    case 'getStorageCredentials':
      return getStorageCredentials(String(args[0]))
    case 'uploadStorageFile':
      return uploadStorageFile(String(args[0]), String(args[1]), String(args[2]))
    case 'downloadStorageFile':
      return downloadStorageFile(String(args[0]), String(args[1]), String(args[2]))
    case 'listStorageObjects':
      return listStorageObjects(String(args[0]), String(args[1] ?? ''))
    case 'uploadStorageObject':
      return uploadStorageObject(String(args[0]), String(args[1]), String(args[2] ?? ''))
    case 'deleteStorageObject':
      return deleteStorageObject(String(args[0]), String(args[1]))
    case 'createStorageFolder':
      return createStorageFolder(String(args[0]), String(args[1]))
    case 'getStorageDownloadUrl':
      return getStorageDownloadUrl(String(args[0]), String(args[1]))
    case 'getStorageInfo':
      return getStorageInfo(String(args[0]))
  }
}

export function startDesktopServices(): void {
  startUpdateChecker()
  if (getStatus().authenticated) void startAgent()
}

export async function stopDesktopServices(): Promise<void> {
  cancelLogin()
  stopUpdateChecker()
  await stopAgent()
}
