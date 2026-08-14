import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import sealosLogo from '../assets/sealos-logo-gold.svg'
import AiProxyTab from './AiProxyTab'
import AppDetailView, { type Crumb } from './AppDetailView'
import ProjectDetailView from './ProjectDetailView'
import TemplatesTab from './TemplatesTab'
import WorkspacePanel from './WorkspacePanel'
import type {
  AgentStatus,
  AppStatus,
  AppWorkload,
  BucketInfo,
  ChatActivity,
  ChatEvent,
  DatabaseInfo,
  ProjectInfo,
  ResourceSnapshot,
  SealosStatus
} from '../../../shared/types'

interface Props {
  status: SealosStatus
  onStatusChange: (status: SealosStatus) => void
  onLogout: () => Promise<void>
}

type Tab =
  'home' | 'templates' | 'projects' | 'apps' | 'databases' | 'storage' | 'aiproxy' | 'account'

/** 详情导航栈：项目 ↔ 应用可互相跳转，栈保留返回路径 */
type DetailEntry =
  | { type: 'project'; name: string }
  | { type: 'app'; name: string; kind: 'Deployment' | 'StatefulSet' }

const REFRESH_INTERVAL_MS = 15_000

const STATUS_LABEL: Record<AppStatus, string> = {
  Running: '运行中',
  Progressing: '启动中',
  Stopped: '已暂停',
  Failed: '异常'
}

const POLICY_LABEL: Record<string, string> = {
  private: '私有',
  publicRead: '公开读',
  publicReadwrite: '公开读写'
}

function statusClass(status: AppStatus | null): string {
  return status ? `dot dot-${status.toLowerCase()}` : 'dot dot-stopped'
}

function dbPhaseToStatus(phase: string): AppStatus {
  if (phase === 'Running') return 'Running'
  if (phase === 'Failed' || phase === 'Abnormal') return 'Failed'
  if (phase === 'Stopped') return 'Stopped'
  return 'Progressing'
}

function aggregateStatus(statuses: AppStatus[]): AppStatus | null {
  if (statuses.length === 0) return null
  if (statuses.includes('Failed')) return 'Failed'
  if (statuses.includes('Progressing')) return 'Progressing'
  if (statuses.includes('Running')) return 'Running'
  return 'Stopped'
}

/* ── icons（24 viewBox / stroke，导航 20px、辅助 16px）── */

interface IconProps {
  size?: number
}

function iconAttrs(size = 20): React.SVGProps<SVGSVGElement> {
  return {
    width: size,
    height: size,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.7,
    strokeLinecap: 'round',
    strokeLinejoin: 'round'
  }
}

function DeployIcon({ size }: IconProps): React.JSX.Element {
  return (
    <svg {...iconAttrs(size)}>
      <path d="M13 3 5 13.5h6L11 21l8-10.5h-6L13 3Z" />
    </svg>
  )
}

function TemplatesIcon({ size }: IconProps): React.JSX.Element {
  return (
    <svg {...iconAttrs(size)}>
      <rect x="4" y="4.5" width="16" height="15" rx="2" />
      <path d="M4 9.5h16M10 9.5V19.5" />
    </svg>
  )
}

function ProjectsIcon({ size }: IconProps): React.JSX.Element {
  return (
    <svg {...iconAttrs(size)}>
      <path d="M12 3.5 20 7.8l-8 4.3-8-4.3 8-4.3Z" />
      <path d="m4 12.2 8 4.3 8-4.3" />
      <path d="m4 16.5 8 4.3 8-4.3" />
    </svg>
  )
}

function AppsIcon({ size }: IconProps): React.JSX.Element {
  return (
    <svg {...iconAttrs(size)}>
      <rect x="4" y="4" width="6.6" height="6.6" rx="1.6" />
      <rect x="13.4" y="4" width="6.6" height="6.6" rx="1.6" />
      <rect x="4" y="13.4" width="6.6" height="6.6" rx="1.6" />
      <rect x="13.4" y="13.4" width="6.6" height="6.6" rx="1.6" />
    </svg>
  )
}

function DatabaseIcon({ size }: IconProps): React.JSX.Element {
  return (
    <svg {...iconAttrs(size)}>
      <ellipse cx="12" cy="5.5" rx="7.5" ry="2.8" />
      <path d="M4.5 5.5v13c0 1.55 3.36 2.8 7.5 2.8s7.5-1.25 7.5-2.8v-13" />
      <path d="M4.5 12c0 1.55 3.36 2.8 7.5 2.8s7.5-1.25 7.5-2.8" />
    </svg>
  )
}

function StorageIcon({ size }: IconProps): React.JSX.Element {
  return (
    <svg {...iconAttrs(size)}>
      <path d="M4 8 12 3.5 20 8v8l-8 4.5L4 16V8Z" />
      <path d="m4 8 8 4.5L20 8M12 12.5v8" />
    </svg>
  )
}

function ChevronDownIcon({ size }: IconProps): React.JSX.Element {
  return (
    <svg {...iconAttrs(size)}>
      <path d="m6.5 9.5 5.5 5.5 5.5-5.5" />
    </svg>
  )
}

function PlusIcon({ size }: IconProps): React.JSX.Element {
  return (
    <svg {...iconAttrs(size)}>
      <path d="M12 5v14M5 12h14" />
    </svg>
  )
}

function ArrowUpIcon({ size }: IconProps): React.JSX.Element {
  return (
    <svg {...iconAttrs(size)}>
      <path d="M12 19V5m-7 7 7-7 7 7" />
    </svg>
  )
}

function XLogoIcon({ size }: IconProps): React.JSX.Element {
  return (
    <svg width={size ?? 16} height={size ?? 16} viewBox="0 0 24 24" fill="currentColor">
      <path d="M18.901 1.153h3.68l-8.04 9.19L24 22.846h-7.406l-5.8-7.584-6.638 7.584H.474l8.6-9.83L0 1.154h7.594l5.243 6.932ZM17.61 20.644h2.039L6.486 3.24H4.298Z" />
    </svg>
  )
}

function RefreshIcon({ size }: IconProps): React.JSX.Element {
  return (
    <svg {...iconAttrs(size)}>
      <path d="M20 12a8 8 0 1 1-2.34-5.66" />
      <path d="M20 4v4.5h-4.5" />
    </svg>
  )
}

function PanelIcon({ size }: IconProps): React.JSX.Element {
  return (
    <svg {...iconAttrs(size)}>
      <rect x="3.5" y="5" width="17" height="14" rx="2" />
      <path d="M9.5 5v14" />
    </svg>
  )
}

function WorkflowIcon({ size }: IconProps): React.JSX.Element {
  return (
    <svg {...iconAttrs(size)}>
      <circle cx="6" cy="6" r="2.2" />
      <circle cx="18" cy="6" r="2.2" />
      <circle cx="12" cy="18" r="2.2" />
      <path d="M8.2 6h7.6M7 8l4 8M17 8l-4 8" />
    </svg>
  )
}

function GlobeIcon({ size }: IconProps): React.JSX.Element {
  return (
    <svg {...iconAttrs(size)}>
      <circle cx="12" cy="12" r="8" />
      <path d="M4 12h16M12 4c2.8 2.7 2.8 13.3 0 16-2.8-2.7-2.8-13.3 0-16Z" />
    </svg>
  )
}

function PulseIcon({ size }: IconProps): React.JSX.Element {
  return (
    <svg {...iconAttrs(size)}>
      <path d="M3.5 12h4L10 6l4 12 2.5-6h4" />
    </svg>
  )
}

function PenIcon({ size }: IconProps): React.JSX.Element {
  return (
    <svg {...iconAttrs(size)}>
      <path d="m5 19 1-4L16.5 4.5a2.12 2.12 0 0 1 3 3L9 18l-4 1Z" />
    </svg>
  )
}

function BucketIcon({ size }: IconProps): React.JSX.Element {
  return (
    <svg {...iconAttrs(size)}>
      <ellipse cx="12" cy="6" rx="7" ry="2.2" />
      <path d="M5 6l1.6 12.2A2 2 0 0 0 8.6 20h6.8a2 2 0 0 0 2-1.8L19 6" />
    </svg>
  )
}

function AiIcon({ size }: IconProps): React.JSX.Element {
  return (
    <svg {...iconAttrs(size)}>
      <path d="M12 3.5 13.8 9 19.5 11 13.8 13 12 18.5 10.2 13 4.5 11 10.2 9 12 3.5Z" />
      <path d="M18.5 15.5 19.2 17.6 21 18.5 19.2 19.4 18.5 21.5 17.8 19.4 16 18.5 17.8 17.6 18.5 15.5Z" />
    </svg>
  )
}

/* ── cards ─────────────────────────────────────── */

function openUrl(url: string): void {
  void window.helios.openExternal(url)
}

function UrlLinks({ urls }: { urls: string[] }): React.JSX.Element | null {
  if (urls.length === 0) return null
  return (
    <div className="card-links">
      {urls.map((url) => (
        <a
          key={url}
          href="#open"
          onClick={(e) => {
            e.preventDefault()
            // 卡片本身可点击进详情，链接点击不应该同时触发
            e.stopPropagation()
            openUrl(url)
          }}
        >
          {url.replace('https://', '')} ↗
        </a>
      ))}
    </div>
  )
}

interface ProjectView {
  project: ProjectInfo
  status: AppStatus | null
  workloads: AppWorkload[]
  databases: DatabaseInfo[]
  buckets: BucketInfo[]
  urls: string[]
}

function ProjectCard({
  view,
  onOpen
}: {
  view: ProjectView
  onOpen: () => void
}): React.JSX.Element {
  const { project, status, workloads, databases, buckets, urls } = view
  const failingPods = workloads.flatMap((w) => w.pods.filter((p) => p.reason))
  const parts = [
    status ? STATUS_LABEL[status] : '无工作负载',
    workloads.length > 0 ? `${workloads.length} 个应用` : null,
    databases.length > 0 ? `${databases.length} 个数据库` : null,
    buckets.length > 0 ? `${buckets.length} 个存储桶` : null,
    project.createdAt ? `创建于 ${new Date(project.createdAt).toLocaleString()}` : null
  ].filter(Boolean)
  return (
    <div
      className="card card-clickable"
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === 'Enter') onOpen()
      }}
    >
      <div className="card-head">
        <span className={statusClass(status)} />
        {project.icon && (
          <img
            className="card-icon"
            src={project.icon}
            alt=""
            onError={(e) => {
              ;(e.target as HTMLImageElement).style.display = 'none'
            }}
          />
        )}
        <h3>{project.displayName ?? project.name}</h3>
        {project.template && <span className="chip chip-project">{project.template}</span>}
        <span className="card-open-hint">›</span>
      </div>
      <div className="card-meta">
        <span>{parts.join(' · ')}</span>
      </div>
      <UrlLinks urls={urls} />
      {failingPods.length > 0 && (
        <div className="card-problem">
          {failingPods.map((p) => (
            <span key={p.name}>
              {p.name}: {p.reason}（重启 {p.restarts} 次）
            </span>
          ))}
        </div>
      )}
    </div>
  )
}

function WorkloadCard({
  app,
  onOpen,
  onOpenProject
}: {
  app: AppWorkload
  onOpen: () => void
  onOpenProject: (project: string) => void
}): React.JSX.Element {
  const failingPods = app.pods.filter((p) => p.reason)
  return (
    <div
      className="card card-clickable"
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === 'Enter') onOpen()
      }}
    >
      <div className="card-head">
        <span className={statusClass(app.status)} />
        <h3>{app.name}</h3>
        <span className="chip">{app.kind === 'Deployment' ? '无状态' : '有状态'}</span>
        {app.project && (
          <button
            className="chip chip-project chip-link"
            title={`打开项目 ${app.project}`}
            onClick={(e) => {
              e.stopPropagation()
              onOpenProject(app.project as string)
            }}
          >
            {app.project}
          </button>
        )}
        <span className="card-open-hint">›</span>
      </div>
      <div className="card-meta">
        <span>
          {STATUS_LABEL[app.status]} · {app.readyReplicas}/{app.replicas} 副本
        </span>
        {app.images.map((image) => (
          <span key={image} className="mono truncate" title={image}>
            {image}
          </span>
        ))}
      </div>
      <UrlLinks urls={app.urls} />
      {failingPods.length > 0 && (
        <div className="card-problem">
          {failingPods.map((p) => (
            <span key={p.name}>
              {p.name}: {p.reason}（重启 {p.restarts} 次）
            </span>
          ))}
        </div>
      )}
    </div>
  )
}

function DatabaseCard({ db }: { db: DatabaseInfo }): React.JSX.Element {
  return (
    <div className="card">
      <div className="card-head">
        <span className={statusClass(dbPhaseToStatus(db.phase))} />
        <h3>{db.name}</h3>
        {db.engine && <span className="chip">{db.engine}</span>}
        {db.project && <span className="chip chip-project">{db.project}</span>}
      </div>
      <div className="card-meta">
        <span>
          {db.phase}
          {db.version ? ` · ${db.version}` : ''}
        </span>
      </div>
    </div>
  )
}

function BucketCard({ bucket }: { bucket: BucketInfo }): React.JSX.Element {
  return (
    <div className="card">
      <div className="card-head">
        <span className="dot dot-running" />
        <h3>{bucket.name}</h3>
        {bucket.policy && (
          <span className="chip">{POLICY_LABEL[bucket.policy] ?? bucket.policy}</span>
        )}
        {bucket.project && <span className="chip chip-project">{bucket.project}</span>}
      </div>
      <div className="card-meta">
        {bucket.bucketName && (
          <span className="mono truncate" title={bucket.bucketName}>
            {bucket.bucketName}
          </span>
        )}
        {bucket.createdAt && <span>创建于 {new Date(bucket.createdAt).toLocaleString()}</span>}
      </div>
    </div>
  )
}

/* ── 首页 hero（Lovable dashboard 布局）───────────── */

const PROMPT_SUGGESTIONS: Array<{ label: string; icon: React.JSX.Element }> = [
  { label: 'n8n', icon: <WorkflowIcon size={16} /> },
  { label: 'WordPress', icon: <GlobeIcon size={16} /> },
  { label: 'Uptime Kuma', icon: <PulseIcon size={16} /> },
  { label: 'Halo', icon: <PenIcon size={16} /> },
  { label: 'MinIO', icon: <BucketIcon size={16} /> }
]

interface ChatMessage {
  role: 'user' | 'assistant'
  text: string
  reasoning?: string
  activities?: ChatActivity[]
  pending?: boolean
  error?: string
}

function upsertActivity(list: ChatActivity[] | undefined, item: ChatActivity): ChatActivity[] {
  const next = [...(list ?? [])]
  const index = next.findIndex((row) => row.id === item.id)
  if (index >= 0) next[index] = item
  else next.push(item)
  return next
}

function HomeHero(): React.JSX.Element {
  const [text, setText] = useState('')
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [busy, setBusy] = useState(false)
  const [agent, setAgent] = useState<AgentStatus>({ state: 'stopped' })
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const logRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    void window.helios.getAgentStatus().then(setAgent)
    return window.helios.onAgentStatus(setAgent)
  }, [])

  useEffect(() => {
    return window.helios.onChatEvent((event: ChatEvent) => {
      if (event.type === 'delta') {
        setMessages((prev) => {
          const next = [...prev]
          const last = next[next.length - 1]
          if (last?.role !== 'assistant') return prev
          next[next.length - 1] = { ...last, text: event.text, pending: true, error: undefined }
          return next
        })
        return
      }
      if (event.type === 'reasoning') {
        setMessages((prev) => {
          const next = [...prev]
          const last = next[next.length - 1]
          if (last?.role !== 'assistant') return prev
          next[next.length - 1] = { ...last, reasoning: event.text, pending: true }
          return next
        })
        return
      }
      if (event.type === 'activity') {
        setMessages((prev) => {
          const next = [...prev]
          const last = next[next.length - 1]
          if (last?.role !== 'assistant') return prev
          next[next.length - 1] = {
            ...last,
            activities: upsertActivity(last.activities, event.item),
            pending: true
          }
          return next
        })
        return
      }
      if (event.type === 'done') {
        setMessages((prev) => {
          const next = [...prev]
          const last = next[next.length - 1]
          if (last?.role !== 'assistant') return prev
          next[next.length - 1] = { ...last, pending: false }
          return next
        })
        return
      }
      setMessages((prev) => {
        const next = [...prev]
        const last = next[next.length - 1]
        if (last?.role !== 'assistant') return prev
        next[next.length - 1] = { ...last, pending: false, error: event.message }
        return next
      })
    })
  }, [])

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight })
  }, [messages])

  const autosize = useCallback(() => {
    const el = textareaRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`
  }, [])

  const submit = useCallback(() => {
    const value = text.trim()
    if (!value || busy) return
    setText('')
    setBusy(true)
    setMessages((prev) => [
      ...prev,
      { role: 'user', text: value },
      { role: 'assistant', text: '', pending: true }
    ])
    requestAnimationFrame(() => {
      const el = textareaRef.current
      if (!el) return
      el.style.height = 'auto'
    })
    void window.helios.sendHomeMessage(value).then(
      () => setBusy(false),
      (err: unknown) => {
        setBusy(false)
        const message = err instanceof Error ? err.message : String(err)
        setMessages((prev) => {
          const next = [...prev]
          const last = next[next.length - 1]
          if (last?.role !== 'assistant' || last.error) return prev
          next[next.length - 1] = { ...last, pending: false, error: message }
          return next
        })
      }
    )
  }, [text, busy])

  const chatting = messages.length > 0
  const canSend = Boolean(text.trim()) && !busy && agent.state === 'ready'

  return (
    <div className={`hero${chatting ? ' has-chat' : ''}`}>
      <div className="hero-spacer-top" />
      <div className="hero-main">
        {!chatting && <h1>今天想开发点什么？</h1>}
        {chatting && (
          <div className="chat-log" ref={logRef}>
            {messages.map((msg, index) => (
              <div
                key={`${msg.role}-${index}`}
                className={`chat-msg ${msg.role}${msg.error ? ' error' : ''}`}
              >
                {msg.role === 'assistant' && msg.reasoning ? (
                  <details className="chat-reasoning" open={msg.pending}>
                    <summary>思考过程</summary>
                    <div>{msg.reasoning}</div>
                  </details>
                ) : null}
                {msg.role === 'assistant' && msg.activities && msg.activities.length > 0 ? (
                  <ul className="chat-activity">
                    {msg.activities.map((item) => (
                      <li key={item.id} className={item.status}>
                        <span className="chat-activity-mark" aria-hidden />
                        <span className="chat-activity-label">{item.label}</span>
                        {item.detail ? <span className="chat-activity-detail">{item.detail}</span> : null}
                      </li>
                    ))}
                  </ul>
                ) : null}
                {msg.error
                  ? msg.error
                  : msg.text ||
                    (msg.pending
                      ? msg.activities?.length
                        ? ''
                        : '正在思考…'
                      : '')}
              </div>
            ))}
          </div>
        )}
        <div className="prompt-card">
          <textarea
            ref={textareaRef}
            rows={1}
            value={text}
            placeholder={chatting ? '继续说…' : '把项目文件夹拖进来，或粘贴 Git 仓库地址…'}
            disabled={busy}
            onChange={(e) => {
              setText(e.target.value)
              autosize()
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                submit()
              }
            }}
          />
          <div className="prompt-actions">
            <button className="icon-btn" title="添加项目文件夹">
              <PlusIcon size={16} />
            </button>
            <button
              className={`send-btn${canSend ? ' ready' : ''}`}
              title="发送"
              onClick={submit}
              disabled={!canSend}
            >
              <ArrowUpIcon size={16} />
            </button>
          </div>
        </div>
        {agent.state !== 'ready' && (
          <div className={`prompt-notice${agent.state === 'error' ? ' error' : ''}`}>
            {agent.state === 'starting' || agent.state === 'stopped'
              ? (agent.detail ?? '正在启动 AI 服务…')
              : (agent.detail ?? 'AI 服务不可用')}
          </div>
        )}
        {!chatting && (
          <div className="chips">
            {PROMPT_SUGGESTIONS.map((s) => (
              <button
                key={s.label}
                onClick={() => {
                  setText(`部署一个 ${s.label}`)
                  textareaRef.current?.focus()
                }}
              >
                {s.icon}
                {s.label}
              </button>
            ))}
          </div>
        )}
      </div>
      <div className="hero-spacer-bottom" />
    </div>
  )
}

/* ── tabs ──────────────────────────────────────── */

function ProjectsTab({
  snapshot,
  onOpenProject
}: {
  snapshot: ResourceSnapshot
  onOpenProject: (name: string) => void
}): React.JSX.Element {
  const views = useMemo<ProjectView[]>(
    () =>
      snapshot.projects.map((project) => {
        const workloads = snapshot.apps.filter((a) => a.project === project.name)
        const databases = snapshot.databases.filter((d) => d.project === project.name)
        const buckets = snapshot.buckets.filter((b) => b.project === project.name)
        return {
          project,
          workloads,
          databases,
          buckets,
          status: aggregateStatus([
            ...workloads.map((w) => w.status),
            ...databases.map((d) => dbPhaseToStatus(d.phase))
          ]),
          urls: [...new Set(workloads.flatMap((w) => w.urls))]
        }
      }),
    [snapshot]
  )

  if (views.length === 0) {
    return (
      <div className="placeholder">
        <p>还没有项目。</p>
        <p className="hint">回到部署页，把项目丢给 agent。</p>
      </div>
    )
  }

  return (
    <div className="grid">
      {views.map((view) => (
        <ProjectCard
          key={view.project.name}
          view={view}
          onOpen={() => onOpenProject(view.project.name)}
        />
      ))}
    </div>
  )
}

function AppsTab({
  snapshot,
  onOpenApp,
  onOpenProject
}: {
  snapshot: ResourceSnapshot
  onOpenApp: (name: string, kind: 'Deployment' | 'StatefulSet') => void
  onOpenProject: (name: string) => void
}): React.JSX.Element {
  // 与 App Launchpad 相同的口径：带 app-deploy-manager 标签的工作负载
  const launchpadApps = useMemo(() => snapshot.apps.filter((a) => a.launchpad), [snapshot])
  const others = useMemo(() => snapshot.apps.filter((a) => !a.launchpad), [snapshot])

  if (launchpadApps.length === 0 && others.length === 0) {
    return (
      <div className="placeholder">
        <p>还没有应用。</p>
        <p className="hint">应用是单个工作负载，部署项目或在 App Launchpad 创建后会出现在这里。</p>
      </div>
    )
  }

  return (
    <>
      <div className="grid">
        {launchpadApps.map((app) => (
          <WorkloadCard
            key={`${app.kind}-${app.name}`}
            app={app}
            onOpen={() => onOpenApp(app.name, app.kind)}
            onOpenProject={onOpenProject}
          />
        ))}
      </div>
      {others.length > 0 && (
        <section className="subsection">
          <h2>Launchpad 之外的工作负载（{others.length}）</h2>
          <div className="grid">
            {others.map((app) => (
              <WorkloadCard
                key={`${app.kind}-${app.name}`}
                app={app}
                onOpen={() => onOpenApp(app.name, app.kind)}
                onOpenProject={onOpenProject}
              />
            ))}
          </div>
        </section>
      )}
    </>
  )
}

function DatabasesTab({ snapshot }: { snapshot: ResourceSnapshot }): React.JSX.Element {
  if (snapshot.databases.length === 0) {
    return (
      <div className="placeholder">
        <p>没有数据库。</p>
      </div>
    )
  }
  return (
    <div className="grid">
      {snapshot.databases.map((db) => (
        <DatabaseCard key={db.name} db={db} />
      ))}
    </div>
  )
}

function StorageTab({ snapshot }: { snapshot: ResourceSnapshot }): React.JSX.Element {
  if (snapshot.buckets.length === 0) {
    return (
      <div className="placeholder">
        <p>没有存储桶。</p>
      </div>
    )
  }
  return (
    <div className="grid">
      {snapshot.buckets.map((bucket) => (
        <BucketCard key={bucket.name} bucket={bucket} />
      ))}
    </div>
  )
}

function AccountTab({
  status,
  snapshot,
  onLogout
}: {
  status: SealosStatus
  snapshot: ResourceSnapshot | null
  onLogout: () => Promise<void>
}): React.JSX.Element {
  const rows: Array<[string, string | undefined, boolean?]> = [
    ['工作空间', status.workspaceName ?? status.workspace],
    ['区域', snapshot?.regionDomain ?? status.regionDomain],
    ['API Server', status.server, true],
    ['命名空间', snapshot?.namespace ?? status.namespace, true],
    ['登录时间', status.authenticatedAt && new Date(status.authenticatedAt).toLocaleString()],
    ['kubeconfig', status.kubeconfigPath, true]
  ]
  return (
    <div className="info-card">
      <dl>
        {rows.map(
          ([label, value, mono]) =>
            value && (
              <div key={label} className="info-row">
                <dt>{label}</dt>
                <dd className={mono ? 'mono' : undefined}>{value}</dd>
              </div>
            )
        )}
      </dl>
      <button className="btn-neutral btn-logout" onClick={() => void onLogout()}>
        退出登录
      </button>
    </div>
  )
}

/* ── screen ────────────────────────────────────── */

interface NavItem {
  id: Tab
  label: string
  icon: React.JSX.Element
}

/* 上组=高频动线（入口/素材/项目），下组=资源明细 */
const NAV_DEPLOY: NavItem[] = [
  { id: 'home', label: '开始', icon: <DeployIcon /> },
  { id: 'templates', label: '模板', icon: <TemplatesIcon /> },
  { id: 'projects', label: '项目', icon: <ProjectsIcon /> }
]

const NAV_RESOURCES: NavItem[] = [
  { id: 'apps', label: '应用', icon: <AppsIcon /> },
  { id: 'databases', label: '数据库', icon: <DatabaseIcon /> },
  { id: 'storage', label: '存储', icon: <StorageIcon /> },
  { id: 'aiproxy', label: 'AI Proxy', icon: <AiIcon /> }
]

const QUOTA_LABEL: Record<string, string> = {
  cpu: 'CPU',
  memory: '内存',
  storage: '存储',
  gpu: 'GPU'
}

const TAB_TITLE: Record<Exclude<Tab, 'home'>, string> = {
  templates: '模板',
  projects: '项目',
  apps: '应用',
  databases: '数据库',
  storage: '存储',
  aiproxy: 'AI Proxy',
  account: '用户信息'
}

function ResourcesScreen({ status, onStatusChange, onLogout }: Props): React.JSX.Element {
  const [tab, setTab] = useState<Tab>('home')
  const [detailStack, setDetailStack] = useState<DetailEntry[]>([])
  const [collapsed, setCollapsed] = useState(false)
  const [snapshot, setSnapshot] = useState<ResourceSnapshot | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [wsOpen, setWsOpen] = useState(false)

  /** 切换主导航时离开详情 */
  const navigateTab = useCallback((next: Tab) => {
    setTab(next)
    setDetailStack([])
  }, [])

  /** 打开项目详情（项目属于「项目」tab，从任何入口进入都归位） */
  const openProject = useCallback((name: string) => {
    setTab('projects')
    setDetailStack([{ type: 'project', name }])
  }, [])

  /** 在当前栈上叠加应用详情（保留返回路径） */
  const pushApp = useCallback((name: string, kind: 'Deployment' | 'StatefulSet') => {
    setDetailStack((stack) => [...stack, { type: 'app', name, kind }])
  }, [])

  const refresh = useCallback(() => {
    setLoading(true)
    window.helios
      .getResources()
      .then((snap) => {
        setSnapshot(snap)
        setError('')
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : String(err))
      })
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    const initial = setTimeout(refresh, 0)
    const timer = setInterval(refresh, REFRESH_INTERVAL_MS)
    return () => {
      clearTimeout(initial)
      clearInterval(timer)
    }
  }, [refresh])

  const workspaceLabel = status.workspaceName ?? status.workspace ?? 'Sealos 工作空间'
  const avatarLetter = (status.workspaceName ?? status.namespace ?? 'S')
    .replace(/^ns-/, '')
    .charAt(0)
    .toUpperCase()

  const recents = useMemo(
    () =>
      (snapshot?.projects ?? [])
        .slice()
        .sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? ''))
        .slice(0, 5),
    [snapshot]
  )

  return (
    <div className="shell">
      {collapsed ? (
        <button
          className="icon-btn sidebar-expand"
          title="展开侧边栏"
          onClick={() => setCollapsed(false)}
        >
          <PanelIcon />
        </button>
      ) : (
        <header className="sidebar">
          <div className="sidebar-inner">
            <div className="sidebar-top">
              <button className="sidebar-logo" title="Helios" onClick={() => navigateTab('home')}>
                <img className="logo-img" src={sealosLogo} alt="" />
              </button>
              <button className="icon-btn" title="收起侧边栏" onClick={() => setCollapsed(true)}>
                <PanelIcon />
              </button>
            </div>

            <div className="ws-wrap">
              <button
                className={`ws-pill${wsOpen ? ' open' : ''}`}
                title={workspaceLabel}
                onClick={() => setWsOpen((open) => !open)}
              >
                <span className="ws-avatar">{avatarLetter}</span>
                <span className="ws-name">{workspaceLabel}</span>
                <ChevronDownIcon size={16} />
              </button>
              {wsOpen && (
                <WorkspacePanel
                  status={status}
                  onStatusChange={onStatusChange}
                  onSwitched={() => {
                    // 旧工作空间的资源快照与详情导航立即作废，等新数据
                    setSnapshot(null)
                    setDetailStack([])
                    refresh()
                  }}
                  onClose={() => setWsOpen(false)}
                />
              )}
            </div>

            <nav className="nav">
              {NAV_DEPLOY.map((item) => (
                <button
                  key={item.id}
                  className={`nav-item${tab === item.id ? ' active' : ''}`}
                  onClick={() => navigateTab(item.id)}
                >
                  <span className="nav-icon">{item.icon}</span>
                  {item.label}
                </button>
              ))}
              <div className="section-label nav-group-label">资源</div>
              {NAV_RESOURCES.map((item) => (
                <button
                  key={item.id}
                  className={`nav-item${tab === item.id ? ' active' : ''}`}
                  onClick={() => navigateTab(item.id)}
                >
                  <span className="nav-icon">{item.icon}</span>
                  {item.label}
                </button>
              ))}
            </nav>

            <div className="sidebar-scroll">
              <div className="section-label">最近</div>
              {error ? (
                <div className="recents-empty">资源读取失败</div>
              ) : recents.length === 0 ? (
                <div className="recents-empty">暂无最近项目</div>
              ) : (
                recents.map((project) => (
                  <button
                    key={project.name}
                    className="recent-row"
                    title={project.displayName ?? project.name}
                    onClick={() => openProject(project.name)}
                  >
                    <ProjectsIcon size={16} />
                    <span className="recent-name">{project.displayName ?? project.name}</span>
                  </button>
                ))
              )}
            </div>

            <div className="sidebar-bottom">
              {snapshot && snapshot.quota.length > 0 && (
                <div className="quota-card">
                  <div className="quota-title">工作空间配额</div>
                  {snapshot.quota.map((q) => {
                    const pct = q.limit > 0 ? Math.min(100, (q.used / q.limit) * 100) : 0
                    return (
                      <div key={q.type} className="quota-row">
                        <div className="quota-row-head">
                          <span className="quota-label">{QUOTA_LABEL[q.type] ?? q.type}</span>
                          <span className="quota-value">
                            {q.usedText} / {q.limitText} {q.unit}
                          </span>
                        </div>
                        <div className="quota-bar">
                          <div
                            className={`quota-bar-fill${pct >= 90 ? ' hot' : ''}`}
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
              <div className="sidebar-foot">
                <button
                  className="avatar-btn"
                  title="用户信息"
                  onClick={() => navigateTab('account')}
                >
                  <span className="avatar-dot">{avatarLetter}</span>
                </button>
                <button
                  className={`icon-btn${loading ? ' loading' : ''}`}
                  title="刷新资源"
                  disabled={loading}
                  onClick={refresh}
                >
                  <RefreshIcon />
                </button>
              </div>
            </div>
          </div>
        </header>
      )}

      <main className="content">
        <div className="drag-strip" />
        {tab === 'home' ? (
          <>
            <div className="hero-bg" aria-hidden="true" />
            <HomeHero />
            <button
              className="announce announce-corner"
              title="在 X 上关注我"
              onClick={() => openUrl('https://x.com/norberia_cz')}
            >
              <span className="announce-badge">Hi</span>
              <span>Follow me on X</span>
              <XLogoIcon size={15} />
            </button>
          </>
        ) : detailStack.length > 0 ? (
          <div className="page">
            <div className="page-body page-body-detail">
              {(() => {
                const top = detailStack[detailStack.length - 1]
                const crumbs: Crumb[] = [
                  {
                    label: TAB_TITLE[tab as Exclude<Tab, 'home'>],
                    onClick: () => setDetailStack([])
                  },
                  ...detailStack.map((entry, i) => ({
                    label: entry.name,
                    onClick:
                      i < detailStack.length - 1
                        ? () => setDetailStack(detailStack.slice(0, i + 1))
                        : undefined
                  }))
                ]
                return top.type === 'project' ? (
                  <ProjectDetailView
                    key={top.name}
                    name={top.name}
                    crumbs={crumbs}
                    onOpenApp={pushApp}
                  />
                ) : (
                  <AppDetailView
                    key={`${top.kind}-${top.name}`}
                    name={top.name}
                    kind={top.kind}
                    crumbs={crumbs}
                    onOpenProject={openProject}
                  />
                )
              })()}
            </div>
          </div>
        ) : (
          <div className="page">
            <header className="page-head">
              <h1>{TAB_TITLE[tab]}</h1>
              {tab !== 'templates' && tab !== 'aiproxy' && snapshot && (
                <span className="hint">
                  更新于 {new Date(snapshot.fetchedAt).toLocaleTimeString()}
                </span>
              )}
            </header>
            <div className="page-body">
              {tab === 'templates' ? (
                <TemplatesTab />
              ) : tab === 'aiproxy' ? (
                <AiProxyTab />
              ) : (
                <>
                  {error && <div className="error">{error}</div>}
                  {snapshot?.warnings.map((w) => (
                    <div key={w} className="warning">
                      {w}
                    </div>
                  ))}

                  {!snapshot && !error && <div className="placeholder">正在读取工作空间…</div>}

                  {snapshot && tab === 'projects' && (
                    <ProjectsTab snapshot={snapshot} onOpenProject={openProject} />
                  )}
                  {snapshot && tab === 'apps' && (
                    <AppsTab snapshot={snapshot} onOpenApp={pushApp} onOpenProject={openProject} />
                  )}
                  {snapshot && tab === 'databases' && <DatabasesTab snapshot={snapshot} />}
                  {snapshot && tab === 'storage' && <StorageTab snapshot={snapshot} />}
                  {tab === 'account' && (
                    <AccountTab status={status} snapshot={snapshot} onLogout={onLogout} />
                  )}
                </>
              )}
            </div>
          </div>
        )}
      </main>
    </div>
  )
}

export default ResourcesScreen
