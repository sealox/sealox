import type {
  SealosStatus,
  WorkspaceDetails,
  WorkspaceInfo,
  WorkspaceMember
} from '../../shared/types'
import {
  getStatus,
  loadAuthJson,
  requestJson,
  saveCredentials,
  setCurrentWorkspaceName
} from './auth'

/**
 * 工作空间列表与切换，与 Sealos desktop 前端同一套 API：
 *   GET  /api/auth/namespace/list     → { data: { namespaces } }
 *   POST /api/auth/namespace/switch   → { data: { token } }（换发工作空间级 token）
 *   GET  /api/auth/getKubeconfig      → { data: { kubeconfig } }
 * 切换成功后把新 kubeconfig + token 落盘 ~/.sealos/，与 use-sealos skill 互认。
 */

interface RawNamespace {
  uid?: string
  id?: string
  teamName?: string
  role?: unknown
  nstype?: unknown
}

interface AuthSession {
  region: string
  regionalToken: string
  accessToken?: string
  currentUid?: string
}

// 新版 desktop 序列化为数字枚举（Team=0 / Private=1），旧版是字符串，两者都认
function isPrivateNs(nstype: unknown): boolean {
  return nstype === 1 || String(nstype).toLowerCase() === 'private'
}

const ROLE_LABELS: Record<string, string> = {
  '0': '拥有者',
  '1': '管理员',
  '2': '开发者',
  owner: '拥有者',
  manager: '管理员',
  developer: '开发者'
}

function requireSession(): AuthSession {
  const auth = loadAuthJson()
  const region = typeof auth.region === 'string' ? auth.region : undefined
  const regionalToken = typeof auth.regional_token === 'string' ? auth.regional_token : undefined
  if (!region || !regionalToken) {
    throw new Error(
      '当前登录态没有会话 token（可能是直接粘贴的 kubeconfig）。请退出后用账号登录，才能切换工作空间。'
    )
  }
  const current = auth.current_workspace as { uid?: string } | undefined
  return {
    region,
    regionalToken,
    accessToken: typeof auth.access_token === 'string' ? auth.access_token : undefined,
    currentUid: current?.uid
  }
}

async function fetchNamespaces(session: AuthSession): Promise<RawNamespace[]> {
  const resp = await requestJson(`${session.region}/api/auth/namespace/list`, {
    token: session.regionalToken
  })
  if (resp.status === 401) throw new Error('会话已过期，请退出登录后重新登录')
  if (resp.status !== 200) throw new Error(`获取工作空间列表失败（HTTP ${resp.status}）`)
  const raw = (resp.body as { data?: unknown })?.data
  return (
    Array.isArray(raw) ? raw : ((raw as { namespaces?: unknown[] })?.namespaces ?? [])
  ) as RawNamespace[]
}

export async function listWorkspaces(): Promise<WorkspaceInfo[]> {
  const session = requireSession()
  const namespaces = await fetchNamespaces(session)
  // auth.json 缺 current_workspace 时（如外部改动），回退到 kubeconfig 的 namespace 判断
  const currentNamespace = getStatus().namespace
  return namespaces
    .filter((ns): ns is RawNamespace & { uid: string; id: string } => !!ns.uid && !!ns.id)
    .map((ns) => ({
      uid: ns.uid,
      id: ns.id,
      teamName: ns.teamName,
      isPrivate: isPrivateNs(ns.nstype),
      roleLabel: ROLE_LABELS[String(ns.role).toLowerCase()],
      current: session.currentUid ? ns.uid === session.currentUid : ns.id === currentNamespace
    }))
}

export async function switchWorkspace(uid: string): Promise<SealosStatus> {
  const session = requireSession()
  const namespaces = await fetchNamespaces(session)
  const target = namespaces.find((ns) => ns.uid === uid)
  if (!target?.uid || !target.id) {
    throw new Error('目标工作空间不存在（列表可能已过期，请重新打开菜单）')
  }

  const switchResp = await requestJson(`${session.region}/api/auth/namespace/switch`, {
    method: 'POST',
    token: session.regionalToken,
    json: { ns_uid: uid }
  })
  const newToken = (switchResp.body as { data?: { token?: string } })?.data?.token
  if (switchResp.status !== 200 || !newToken) {
    throw new Error(`切换工作空间失败（HTTP ${switchResp.status}）`)
  }

  const kcResp = await requestJson(`${session.region}/api/auth/getKubeconfig`, {
    token: newToken
  })
  const kubeconfig = (kcResp.body as { data?: { kubeconfig?: string } })?.data?.kubeconfig
  if (kcResp.status !== 200 || !kubeconfig) {
    throw new Error(`获取新 kubeconfig 失败（HTTP ${kcResp.status}）`)
  }

  await saveCredentials(session.region, session.accessToken, newToken, kubeconfig, {
    uid: target.uid,
    id: target.id,
    teamName: target.teamName
  })
  return getStatus()
}

function apiError(fallback: string, status: number, body: unknown): Error {
  const message = (body as { message?: string })?.message
  return new Error(`${fallback}（HTTP ${status}${message ? `：${message}` : ''}）`)
}

function isOwner(role: unknown): boolean {
  return role === 0 || String(role).toLowerCase() === 'owner'
}

function isManagerOrOwner(role: unknown): boolean {
  return isOwner(role) || role === 1 || String(role).toLowerCase() === 'manager'
}

interface RawTeamUser {
  crUid?: string
  nickname?: string
  avatarUrl?: string
  role?: unknown
}

export async function getWorkspaceDetails(uid: string): Promise<WorkspaceDetails> {
  const session = requireSession()
  const resp = await requestJson(`${session.region}/api/auth/namespace/details`, {
    method: 'POST',
    token: session.regionalToken,
    json: { ns_uid: uid }
  })
  if (resp.status !== 200) throw apiError('获取工作空间详情失败', resp.status, resp.body)
  const data = (resp.body as { data?: { users?: RawTeamUser[]; namespace?: RawNamespace } })?.data
  const myRole = (data?.namespace as { role?: unknown } | undefined)?.role
  const members: WorkspaceMember[] = (data?.users ?? [])
    .filter((u): u is RawTeamUser & { crUid: string } => !!u.crUid)
    .map((u) => ({
      crUid: u.crUid,
      nickname: u.nickname || '未命名用户',
      avatarUrl: u.avatarUrl || undefined,
      roleLabel: ROLE_LABELS[String(u.role).toLowerCase()] ?? '成员'
    }))
  return {
    uid,
    teamName: data?.namespace?.teamName,
    isPrivate: isPrivateNs(data?.namespace?.nstype),
    myRoleLabel: ROLE_LABELS[String(myRole).toLowerCase()],
    canRename: isOwner(myRole),
    canInvite: isManagerOrOwner(myRole),
    members
  }
}

export async function renameWorkspace(uid: string, teamName: string): Promise<SealosStatus> {
  const name = teamName.trim()
  if (!name) throw new Error('工作空间名称不能为空')
  const session = requireSession()
  const resp = await requestJson(`${session.region}/api/auth/namespace/rename`, {
    method: 'POST',
    token: session.regionalToken,
    json: { ns_uid: uid, teamName: name }
  })
  if (resp.status !== 200) throw apiError('重命名失败（仅拥有者可重命名）', resp.status, resp.body)
  if (session.currentUid === uid) await setCurrentWorkspaceName(name)
  return getStatus()
}

export async function createWorkspace(teamName: string): Promise<WorkspaceInfo> {
  const name = teamName.trim()
  if (!name) throw new Error('工作空间名称不能为空')
  const session = requireSession()
  // 服务端要创建 k8s 资源，实测可能超过 30s
  const resp = await requestJson(`${session.region}/api/auth/namespace/create`, {
    method: 'POST',
    token: session.regionalToken,
    json: { teamName: name },
    timeoutMs: 90_000
  })
  if (resp.status === 409) throw new Error('同名工作空间已存在')
  if (resp.status !== 200) throw apiError('新建工作空间失败', resp.status, resp.body)
  const ns = (resp.body as { data?: { namespace?: RawNamespace } })?.data?.namespace
  if (!ns?.uid || !ns.id) throw new Error('新建工作空间返回数据异常')
  return {
    uid: ns.uid,
    id: ns.id,
    teamName: ns.teamName,
    isPrivate: isPrivateNs(ns.nstype),
    roleLabel: ROLE_LABELS[String(ns.role).toLowerCase()],
    current: false
  }
}

const INVITE_ROLE: Record<'manager' | 'developer', number> = { manager: 1, developer: 2 }

export async function getInviteLink(uid: string, role: 'manager' | 'developer'): Promise<string> {
  const session = requireSession()
  const resp = await requestJson(`${session.region}/api/auth/namespace/getInviteCode`, {
    method: 'POST',
    token: session.regionalToken,
    json: { ns_uid: uid, role: INVITE_ROLE[role] }
  })
  if (resp.status !== 200) {
    throw apiError('生成邀请链接失败（需要拥有者或管理员权限）', resp.status, resp.body)
  }
  const code = (resp.body as { data?: { code?: string } })?.data?.code
  if (!code) throw new Error('生成邀请链接失败：响应缺少 code')
  // 与 desktop 前端一致的邀请落地页
  return `${session.region}/WorkspaceInvite/?code=${encodeURIComponent(code)}`
}
