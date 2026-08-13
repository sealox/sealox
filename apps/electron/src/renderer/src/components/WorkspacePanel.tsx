import { useCallback, useEffect, useState } from 'react'
import type { SealosStatus, WorkspaceDetails, WorkspaceInfo } from '../../../shared/types'

interface Props {
  status: SealosStatus
  onStatusChange: (status: SealosStatus) => void
  /** 切换成功后由父级刷新资源 */
  onSwitched: () => void
  onClose: () => void
}

type Mode = 'idle' | 'invite' | 'rename' | 'create'

function iconAttrs(size = 14): React.SVGProps<SVGSVGElement> {
  return {
    width: size,
    height: size,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.8,
    strokeLinecap: 'round',
    strokeLinejoin: 'round'
  }
}

function InviteIcon(): React.JSX.Element {
  return (
    <svg {...iconAttrs()}>
      <circle cx="9" cy="8" r="3.4" />
      <path d="M3.5 19.5c.7-3.2 2.9-4.9 5.5-4.9s4.8 1.7 5.5 4.9M18.5 8.5v6M15.5 11.5h6" />
    </svg>
  )
}

function PenIcon(): React.JSX.Element {
  return (
    <svg {...iconAttrs()}>
      <path d="m5 19 1-4L16.5 4.5a2.12 2.12 0 0 1 3 3L9 18l-4 1Z" />
    </svg>
  )
}

function CheckIcon(): React.JSX.Element {
  return (
    <svg {...iconAttrs(16)}>
      <path d="m5 12.5 4.5 4.5L19 7.5" />
    </svg>
  )
}

function PlusIcon(): React.JSX.Element {
  return (
    <svg {...iconAttrs(16)}>
      <path d="M12 5v14M5 12h14" />
    </svg>
  )
}

function BoltIcon(): React.JSX.Element {
  return (
    <svg width={14} height={14} viewBox="0 0 24 24" fill="currentColor">
      <path d="M13 2 3 14h9l-1 8 10-12h-9l1-8Z" />
    </svg>
  )
}

function letterOf(name: string): string {
  return name.replace(/^ns-/, '').charAt(0).toUpperCase()
}

function MemberAvatar({ name, url }: { name: string; url?: string }): React.JSX.Element {
  const [failed, setFailed] = useState(false)
  if (!url || failed) {
    return <span className="ws-avatar">{letterOf(name)}</span>
  }
  return <img className="wsp-member-img" src={url} alt="" onError={() => setFailed(true)} />
}

function WorkspacePanel({ status, onStatusChange, onSwitched, onClose }: Props): React.JSX.Element {
  const [list, setList] = useState<WorkspaceInfo[] | null>(null)
  const [details, setDetails] = useState<WorkspaceDetails | null>(null)
  const [error, setError] = useState('')
  const [mode, setMode] = useState<Mode>('idle')
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState('')
  const [notice, setNotice] = useState('')
  const [inviteLink, setInviteLink] = useState('')

  const fail = (err: unknown): void => {
    const raw = err instanceof Error ? err.message : String(err)
    // 剥掉 Electron IPC 的包装前缀，只留业务信息
    setError(raw.replace(/^Error invoking remote method '[^']+':\s*/, ''))
  }

  const reload = useCallback((): void => {
    window.helios
      .listWorkspaces()
      .then((workspaces) => {
        setList(workspaces)
        const current = workspaces.find((ws) => ws.current)
        if (current) {
          window.helios.getWorkspaceDetails(current.uid).then(setDetails, fail)
        }
      })
      .catch(fail)
  }, [])

  useEffect(() => {
    const timer = setTimeout(reload, 0)
    return () => clearTimeout(timer)
  }, [reload])

  useEffect(() => {
    if (!notice) return undefined
    const timer = setTimeout(() => setNotice(''), 4000)
    return () => clearTimeout(timer)
  }, [notice])

  const current = list?.find((ws) => ws.current)
  const currentName = details?.teamName ?? current?.teamName ?? status.workspaceName ?? '工作空间'

  const switchTo = (ws: WorkspaceInfo): void => {
    if (ws.current || busy) return
    setBusy(`switch:${ws.uid}`)
    setError('')
    window.helios
      .switchWorkspace(ws.uid)
      .then((newStatus) => {
        onStatusChange(newStatus)
        onSwitched()
        onClose()
      })
      .catch(fail)
      .finally(() => setBusy(''))
  }

  const invite = (role: 'manager' | 'developer'): void => {
    if (!current || busy) return
    setBusy(`invite:${role}`)
    setError('')
    window.helios
      .getInviteLink(current.uid, role)
      .then(async (link) => {
        setInviteLink(link)
        await window.helios.copyText(link)
        setNotice(`邀请链接已复制（角色：${role === 'manager' ? '管理员' : '开发者'}）`)
      })
      .catch(fail)
      .finally(() => setBusy(''))
  }

  const submitRename = (e: React.FormEvent): void => {
    e.preventDefault()
    if (!current || busy) return
    setBusy('rename')
    setError('')
    window.helios
      .renameWorkspace(current.uid, input)
      .then((newStatus) => {
        onStatusChange(newStatus)
        setMode('idle')
        setNotice('已重命名')
        reload()
      })
      .catch(fail)
      .finally(() => setBusy(''))
  }

  const submitCreate = (e: React.FormEvent): void => {
    e.preventDefault()
    if (busy) return
    setBusy('create')
    setError('')
    window.helios
      .createWorkspace(input)
      .then((ws) => {
        setMode('idle')
        setNotice(`已创建 ${ws.teamName ?? ws.id}，点击列表可切换`)
        reload()
      })
      .catch(fail)
      .finally(() => setBusy(''))
  }

  const openMode = (next: Mode): void => {
    setMode((prev) => (prev === next ? 'idle' : next))
    setError('')
    setInviteLink('')
    if (next === 'rename') setInput(currentName)
    if (next === 'create') setInput('')
  }

  return (
    <>
      <div className="ws-overlay" onClick={onClose} />
      <div className="ws-menu ws-panel">
        <div className="wsp-head">
          <span className="ws-avatar wsp-avatar-lg">{letterOf(currentName)}</span>
          <div className="wsp-head-main">
            <div className="wsp-name" title={currentName}>
              {currentName}
            </div>
            <div className="wsp-sub">
              {details
                ? [
                    details.isPrivate ? '私人' : '团队',
                    details.myRoleLabel,
                    `${details.members.length} 名成员`
                  ]
                    .filter(Boolean)
                    .join(' · ')
                : '正在加载…'}
            </div>
          </div>
        </div>

        {details && (details.canInvite || details.canRename) && (
          <div className="wsp-actions">
            {details.canInvite && (
              <button className="wsp-action" onClick={() => openMode('invite')}>
                <InviteIcon />
                邀请成员
              </button>
            )}
            {details.canRename && (
              <button className="wsp-action" onClick={() => openMode('rename')}>
                <PenIcon />
                重命名
              </button>
            )}
          </div>
        )}

        {mode === 'invite' && (
          <div className="wsp-inline">
            <span className="wsp-inline-label">生成邀请链接</span>
            <button className="wsp-mini-btn" disabled={!!busy} onClick={() => invite('manager')}>
              {busy === 'invite:manager' ? '生成中…' : '管理员'}
            </button>
            <button className="wsp-mini-btn" disabled={!!busy} onClick={() => invite('developer')}>
              {busy === 'invite:developer' ? '生成中…' : '开发者'}
            </button>
          </div>
        )}
        {mode === 'invite' && inviteLink && <div className="wsp-link mono">{inviteLink}</div>}

        {mode === 'rename' && (
          <form className="wsp-inline" onSubmit={submitRename}>
            <input
              className="wsp-input"
              value={input}
              autoFocus
              maxLength={40}
              onChange={(e) => setInput(e.target.value)}
            />
            <button className="wsp-mini-btn" type="submit" disabled={!!busy || !input.trim()}>
              {busy === 'rename' ? '保存中…' : '保存'}
            </button>
          </form>
        )}

        {notice && <div className="wsp-notice">{notice}</div>}
        {error && <div className="ws-menu-error">{error}</div>}

        <div className="wsp-section-label">成员</div>
        {details ? (
          <div className="wsp-members">
            {details.members.map((member) => (
              <div key={member.crUid} className="wsp-member">
                <MemberAvatar name={member.nickname} url={member.avatarUrl} />
                <span className="wsp-member-name" title={member.nickname}>
                  {member.nickname}
                </span>
                <span className="wsp-member-role">{member.roleLabel}</span>
              </div>
            ))}
          </div>
        ) : (
          !error && <div className="ws-menu-note">正在加载…</div>
        )}

        <div className="wsp-section-label">切换工作空间</div>
        {!list && !error && <div className="ws-menu-note">正在加载…</div>}
        {list?.map((ws) => {
          const name = ws.teamName || ws.id
          return (
            <button
              key={ws.uid}
              className={`ws-item${ws.current ? ' current' : ''}`}
              disabled={!!busy}
              onClick={() => switchTo(ws)}
            >
              <span className="ws-avatar">{letterOf(name)}</span>
              <span className="ws-item-main">
                <span className="ws-item-name">{name}</span>
                <span className="ws-item-sub">
                  {ws.isPrivate ? '私人' : '团队'}
                  {ws.roleLabel ? ` · ${ws.roleLabel}` : ''}
                </span>
              </span>
              {ws.current ? (
                <CheckIcon />
              ) : busy === `switch:${ws.uid}` ? (
                <span className="ws-item-spin" />
              ) : null}
            </button>
          )
        })}

        {mode === 'create' ? (
          <form className="wsp-inline" onSubmit={submitCreate}>
            <input
              className="wsp-input"
              value={input}
              autoFocus
              maxLength={40}
              placeholder="新工作空间名称"
              onChange={(e) => setInput(e.target.value)}
            />
            <button className="wsp-mini-btn" type="submit" disabled={!!busy || !input.trim()}>
              {busy === 'create' ? '创建中…' : '创建'}
            </button>
          </form>
        ) : (
          <button className="ws-item wsp-new" onClick={() => openMode('create')}>
            <span className="wsp-plus">
              <PlusIcon />
            </span>
            新建工作空间
          </button>
        )}

        <div className="wsp-upgrade">
          <BoltIcon />
          <span className="wsp-upgrade-text">Upgrade to Pro</span>
          <button
            className="wsp-upgrade-btn"
            onClick={() =>
              void window.helios.openExternal(
                `https://${status.regionDomain ?? 'os.sealos.io'}/?openapp=system-costcenter`
              )
            }
          >
            Upgrade
          </button>
        </div>
      </div>
    </>
  )
}

export default WorkspacePanel
