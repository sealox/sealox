import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import sealosLogo from '../assets/sealos-logo-gold.svg'
import type {
  AppStatus,
  AppWorkload,
  BucketInfo,
  DatabaseInfo,
  InstanceInfo,
  ResourceSnapshot,
  SealosStatus
} from '../../../shared/types'

interface Props {
  status: SealosStatus
  onLogout: () => Promise<void>
}

type Tab = 'home' | 'apps' | 'databases' | 'storage' | 'account'

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

function HomeIcon({ size }: IconProps): React.JSX.Element {
  return (
    <svg {...iconAttrs(size)}>
      <path d="M4.5 10.3 12 4.5l7.5 5.8v7.2a1.5 1.5 0 0 1-1.5 1.5H6a1.5 1.5 0 0 1-1.5-1.5v-7.2Z" />
      <path d="M9.5 19v-5.2h5V19" />
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

function ArrowRightIcon({ size }: IconProps): React.JSX.Element {
  return (
    <svg {...iconAttrs(size)}>
      <path d="M5 12h14m-7-7 7 7-7 7" />
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

function BoltIcon({ size }: IconProps): React.JSX.Element {
  return (
    <svg width={size ?? 20} height={size ?? 20} viewBox="0 0 24 24" fill="currentColor">
      <path d="M13 2 3 14h9l-1 8 10-12h-9l1-8Z" />
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
            openUrl(url)
          }}
        >
          {url.replace('https://', '')} ↗
        </a>
      ))}
    </div>
  )
}

interface InstanceView {
  instance: InstanceInfo
  status: AppStatus | null
  workloads: AppWorkload[]
  databases: DatabaseInfo[]
  buckets: BucketInfo[]
  urls: string[]
}

function InstanceCard({ view }: { view: InstanceView }): React.JSX.Element {
  const { instance, status, workloads, databases, buckets, urls } = view
  const failingPods = workloads.flatMap((w) => w.pods.filter((p) => p.reason))
  const parts = [
    status ? STATUS_LABEL[status] : '无工作负载',
    workloads.length > 0 ? `${workloads.length} 个工作负载` : null,
    databases.length > 0 ? `${databases.length} 个数据库` : null,
    buckets.length > 0 ? `${buckets.length} 个存储桶` : null,
    instance.createdAt ? `创建于 ${new Date(instance.createdAt).toLocaleString()}` : null
  ].filter(Boolean)
  return (
    <div className="card">
      <div className="card-head">
        <span className={statusClass(status)} />
        <h3>{instance.name}</h3>
        {instance.template && <span className="chip chip-instance">{instance.template}</span>}
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

function WorkloadCard({ app }: { app: AppWorkload }): React.JSX.Element {
  const failingPods = app.pods.filter((p) => p.reason)
  return (
    <div className="card">
      <div className="card-head">
        <span className={statusClass(app.status)} />
        <h3>{app.name}</h3>
        <span className="chip">{app.kind === 'Deployment' ? '无状态' : '有状态'}</span>
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
        {db.instance && <span className="chip chip-instance">{db.instance}</span>}
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
        {bucket.instance && <span className="chip chip-instance">{bucket.instance}</span>}
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

function HomeHero(): React.JSX.Element {
  const [text, setText] = useState('')
  const [notice, setNotice] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const autosize = useCallback(() => {
    const el = textareaRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`
  }, [])

  const submit = useCallback(() => {
    if (!text.trim()) return
    setNotice(true)
  }, [text])

  return (
    <div className="hero">
      <div className="hero-spacer-top" />
      <div className="hero-main">
        <div className="announce">
          <span className="announce-badge">New</span>
          <span>agent 部署链路将在 M2 接入</span>
          <ArrowRightIcon size={16} />
        </div>
        <h1>今天部署点什么？</h1>
        <div className="prompt-card">
          <textarea
            ref={textareaRef}
            rows={1}
            value={text}
            placeholder="把项目文件夹拖进来，或粘贴 Git 仓库地址…"
            onChange={(e) => {
              setText(e.target.value)
              setNotice(false)
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
              className={`send-btn${text.trim() ? ' ready' : ''}`}
              title="开始部署"
              onClick={submit}
            >
              <ArrowUpIcon size={16} />
            </button>
          </div>
        </div>
        {notice && <div className="prompt-notice">部署链路在 M2 接入，当前版本先看清资源。</div>}
        <div className="chips">
          {PROMPT_SUGGESTIONS.map((s) => (
            <button
              key={s.label}
              onClick={() => {
                setText(`部署一个 ${s.label}`)
                setNotice(false)
                textareaRef.current?.focus()
              }}
            >
              {s.icon}
              {s.label}
            </button>
          ))}
        </div>
      </div>
      <div className="hero-spacer-bottom" />
    </div>
  )
}

/* ── tabs ──────────────────────────────────────── */

function AppsTab({ snapshot }: { snapshot: ResourceSnapshot }): React.JSX.Element {
  const views = useMemo<InstanceView[]>(
    () =>
      snapshot.instances.map((instance) => {
        const workloads = snapshot.apps.filter((a) => a.instance === instance.name)
        const databases = snapshot.databases.filter((d) => d.instance === instance.name)
        const buckets = snapshot.buckets.filter((b) => b.instance === instance.name)
        return {
          instance,
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
  const standalone = useMemo(() => snapshot.apps.filter((a) => !a.instance), [snapshot])

  if (views.length === 0 && standalone.length === 0) {
    return (
      <div className="placeholder">
        <p>还没有安装任何应用。</p>
        <p className="hint">回到首页，把项目丢给 agent。</p>
      </div>
    )
  }

  return (
    <>
      <div className="grid">
        {views.map((view) => (
          <InstanceCard key={view.instance.name} view={view} />
        ))}
      </div>
      {standalone.length > 0 && (
        <section className="subsection">
          <h2>模板之外的工作负载（{standalone.length}）</h2>
          <div className="grid">
            {standalone.map((app) => (
              <WorkloadCard key={`${app.kind}-${app.name}`} app={app} />
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

const NAV: Array<{ id: Tab; label: string; icon: React.JSX.Element }> = [
  { id: 'home', label: '首页', icon: <HomeIcon /> },
  { id: 'apps', label: '应用', icon: <AppsIcon /> },
  { id: 'databases', label: '数据库', icon: <DatabaseIcon /> },
  { id: 'storage', label: '存储', icon: <StorageIcon /> }
]

const TAB_TITLE: Record<Exclude<Tab, 'home'>, string> = {
  apps: '应用',
  databases: '数据库',
  storage: '存储',
  account: '用户信息'
}

function ResourcesScreen({ status, onLogout }: Props): React.JSX.Element {
  const [tab, setTab] = useState<Tab>('home')
  const [collapsed, setCollapsed] = useState(false)
  const [snapshot, setSnapshot] = useState<ResourceSnapshot | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

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
      (snapshot?.instances ?? [])
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
              <button className="sidebar-logo" title="Helios" onClick={() => setTab('home')}>
                <img className="logo-img" src={sealosLogo} alt="" />
              </button>
              <button className="icon-btn" title="收起侧边栏" onClick={() => setCollapsed(true)}>
                <PanelIcon />
              </button>
            </div>

            <button className="ws-pill" title={workspaceLabel}>
              <span className="ws-avatar">{avatarLetter}</span>
              <span className="ws-name">{workspaceLabel}</span>
              <ChevronDownIcon size={16} />
            </button>

            <nav className="nav">
              {NAV.map((item) => (
                <button
                  key={item.id}
                  className={`nav-item${tab === item.id ? ' active' : ''}`}
                  onClick={() => setTab(item.id)}
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
                <div className="recents-empty">暂无最近应用</div>
              ) : (
                recents.map((inst) => (
                  <button key={inst.name} className="recent-row" onClick={() => setTab('apps')}>
                    <AppsIcon size={16} />
                    <span className="recent-name">{inst.name}</span>
                  </button>
                ))
              )}
            </div>

            <div className="sidebar-bottom">
              <div className="ws-card">
                <div className="ws-card-text">
                  <p>Upgrade to Pro</p>
                  <p>Enjoy higher quota</p>
                </div>
                <span className="ws-card-icon upgrade">
                  <BoltIcon size={16} />
                </span>
              </div>
              <div className="sidebar-foot">
                <button className="avatar-btn" title="用户信息" onClick={() => setTab('account')}>
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
          </>
        ) : (
          <div className="page">
            <header className="page-head">
              <h1>{TAB_TITLE[tab]}</h1>
              {snapshot && (
                <span className="hint">
                  更新于 {new Date(snapshot.fetchedAt).toLocaleTimeString()}
                </span>
              )}
            </header>
            <div className="page-body">
              {error && <div className="error">{error}</div>}
              {snapshot?.warnings.map((w) => (
                <div key={w} className="warning">
                  {w}
                </div>
              ))}

              {!snapshot && !error && <div className="placeholder">正在读取工作空间…</div>}

              {snapshot && tab === 'apps' && <AppsTab snapshot={snapshot} />}
              {snapshot && tab === 'databases' && <DatabasesTab snapshot={snapshot} />}
              {snapshot && tab === 'storage' && <StorageTab snapshot={snapshot} />}
              {tab === 'account' && (
                <AccountTab status={status} snapshot={snapshot} onLogout={onLogout} />
              )}
            </div>
          </div>
        )}
      </main>
    </div>
  )
}

export default ResourcesScreen
