import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import sealosLogo from '../assets/sealos-logo-gold.svg'
import AiProxyTab from './AiProxyTab'
import AppDetailView, { type Crumb } from './AppDetailView'
import ConfirmDialog from './ConfirmDialog'
import DatabaseDetailView from './DatabaseDetailView'
import ProjectDetailView from './ProjectDetailView'
import TemplatesTab from './TemplatesTab'
import WorkspacePanel from './WorkspacePanel'
import HomeChat from './HomeChat'
import type {
  AppStatus,
  AppUpdateStatus,
  AppWorkload,
  BucketInfo,
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
  | { type: 'database'; name: string }

const REFRESH_INTERVAL_MS = 15_000

const STATUS_LABEL: Record<AppStatus, string> = {
  Running: '运行中',
  Progressing: '处理中',
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

function PanelIcon({ size }: IconProps): React.JSX.Element {
  return (
    <svg {...iconAttrs(size)}>
      <rect x="3.5" y="5" width="17" height="14" rx="2" />
      <path d="M9.5 5v14" />
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

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

function pruneDetailStack(stack: DetailEntry[], snap: ResourceSnapshot): DetailEntry[] {
  const kept: DetailEntry[] = []
  for (const entry of stack) {
    if (entry.type === 'project') {
      if (!snap.projects.some((p) => p.name === entry.name)) break
    } else if (entry.type === 'database') {
      if (!snap.databases.some((d) => d.name === entry.name)) break
    } else if (!snap.apps.some((a) => a.name === entry.name && a.kind === entry.kind)) {
      break
    }
    kept.push(entry)
  }
  return kept
}

function projectTitleOf(snap: ResourceSnapshot | null, name: string): string {
  const p = snap?.projects.find((x) => x.name === name)
  return p?.displayName || name
}

type PendingDelete =
  | {
      type: 'project'
      name: string
      displayName?: string
      apps: number
      databases: number
      buckets: number
    }
  | {
      type: 'app'
      name: string
      project?: string
      projectTitle?: string
    }
  | {
      type: 'database'
      name: string
      project?: string
      projectTitle?: string
    }
  | {
      type: 'projects'
      names: string[]
      labels: string[]
      apps: number
      databases: number
      buckets: number
    }
  | {
      type: 'apps'
      names: string[]
      inProject: number
    }

const NAME_LIST_LIMIT = 5

function formatNameList(names: string[], limit = NAME_LIST_LIMIT): string {
  if (names.length <= limit) return names.join('、')
  return `${names.slice(0, limit).join('、')} 等 ${names.length} 个`
}

function buildProjectViews(snapshot: ResourceSnapshot): ProjectView[] {
  return snapshot.projects.map((project) => {
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
  })
}

function CardCheckbox({
  checked,
  disabled,
  label,
  onToggle
}: {
  checked: boolean
  disabled?: boolean
  label: string
  onToggle: () => void
}): React.JSX.Element {
  return (
    <label
      className="card-check"
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => e.stopPropagation()}
    >
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        aria-label={label}
        onChange={(e) => {
          e.stopPropagation()
          onToggle()
        }}
      />
    </label>
  )
}

function BulkActionBar({
  count,
  busy,
  error,
  showPause,
  showStart,
  onSelectAll,
  onClear,
  onPause,
  onStart,
  onRestart,
  onDelete
}: {
  count: number
  busy: boolean
  error: string
  showPause: boolean
  showStart: boolean
  onSelectAll: () => void
  onClear: () => void
  onPause: () => void
  onStart: () => void
  onRestart: () => void
  onDelete: () => void
}): React.JSX.Element {
  return (
    <fieldset className="bulk-bar" disabled={busy}>
      <span className="bulk-count">已选 {count} 个</span>
      <button type="button" className="btn-neutral" onClick={onSelectAll}>
        全选
      </button>
      <button type="button" className="btn-neutral" onClick={onClear}>
        取消选择
      </button>
      <span className="bulk-actions">
        {showPause && (
          <button type="button" className="daction" onClick={onPause}>
            暂停
          </button>
        )}
        {showStart && (
          <button type="button" className="daction" onClick={onStart}>
            启动
          </button>
        )}
        <button type="button" className="daction" onClick={onRestart}>
          重启
        </button>
        <button type="button" className="daction daction-danger" onClick={onDelete}>
          删除
        </button>
      </span>
      {error && <div className="bulk-error error">{error}</div>}
    </fieldset>
  )
}

function ProjectCard({
  view,
  selected,
  selectDisabled,
  onToggleSelect,
  onOpen,
  onDelete
}: {
  view: ProjectView
  selected: boolean
  selectDisabled?: boolean
  onToggleSelect: () => void
  onOpen: () => void
  onDelete: () => void
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
      className={`card card-clickable${selected ? ' card-selected' : ''}`}
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === 'Enter') onOpen()
      }}
    >
      <div className="card-head">
        <CardCheckbox
          checked={selected}
          disabled={selectDisabled}
          label={`选择 ${project.displayName ?? project.name}`}
          onToggle={onToggleSelect}
        />
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
        <span className="card-head-actions">
          <button
            type="button"
            className="card-delete"
            title="删除项目"
            disabled={selectDisabled}
            onClick={(e) => {
              e.stopPropagation()
              onDelete()
            }}
            onKeyDown={(e) => e.stopPropagation()}
          >
            删除
          </button>
          <span className="card-open-hint">›</span>
        </span>
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
  selected,
  selectDisabled,
  onToggleSelect,
  onOpen,
  onOpenProject,
  onDelete
}: {
  app: AppWorkload
  selected?: boolean
  selectDisabled?: boolean
  onToggleSelect?: () => void
  onOpen: () => void
  onOpenProject: (project: string) => void
  onDelete?: () => void
}): React.JSX.Element {
  const failingPods = app.pods.filter((p) => p.reason)
  return (
    <div
      className={`card card-clickable${selected ? ' card-selected' : ''}`}
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === 'Enter') onOpen()
      }}
    >
      <div className="card-head">
        {onToggleSelect && (
          <CardCheckbox
            checked={Boolean(selected)}
            disabled={selectDisabled}
            label={`选择 ${app.name}`}
            onToggle={onToggleSelect}
          />
        )}
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
        <span className="card-head-actions">
          {onDelete && (
            <button
              type="button"
              className="card-delete"
              title="删除应用"
              disabled={selectDisabled}
              onClick={(e) => {
                e.stopPropagation()
                onDelete()
              }}
              onKeyDown={(e) => e.stopPropagation()}
            >
              删除
            </button>
          )}
          <span className="card-open-hint">›</span>
        </span>
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

function DatabaseCard({
  db,
  onOpen,
  onOpenProject
}: {
  db: DatabaseInfo
  onOpen: () => void
  onOpenProject: (project: string) => void
}): React.JSX.Element {
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
        <span className={statusClass(dbPhaseToStatus(db.phase))} />
        <h3>{db.name}</h3>
        {db.engine && <span className="chip">{db.engine}</span>}
        {db.project && (
          <button
            className="chip chip-project chip-link"
            title={`打开项目 ${db.project}`}
            onClick={(e) => {
              e.stopPropagation()
              onOpenProject(db.project as string)
            }}
          >
            {db.project}
          </button>
        )}
        <span className="card-head-actions">
          <span className="card-open-hint">›</span>
        </span>
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

/* ── tabs ──────────────────────────────────────── */

function ProjectsTab({
  snapshot,
  selected,
  selectDisabled,
  onToggleSelect,
  onOpenProject,
  onDeleteProject
}: {
  snapshot: ResourceSnapshot
  selected: Set<string>
  selectDisabled?: boolean
  onToggleSelect: (name: string) => void
  onOpenProject: (name: string) => void
  onDeleteProject: (view: ProjectView) => void
}): React.JSX.Element {
  const views = useMemo(() => buildProjectViews(snapshot), [snapshot])

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
          selected={selected.has(view.project.name)}
          selectDisabled={selectDisabled}
          onToggleSelect={() => onToggleSelect(view.project.name)}
          onOpen={() => onOpenProject(view.project.name)}
          onDelete={() => onDeleteProject(view)}
        />
      ))}
    </div>
  )
}

function AppsTab({
  snapshot,
  selected,
  selectDisabled,
  onToggleSelect,
  onOpenApp,
  onOpenProject,
  onDeleteApp
}: {
  snapshot: ResourceSnapshot
  selected: Set<string>
  selectDisabled?: boolean
  onToggleSelect: (name: string) => void
  onOpenApp: (name: string, kind: 'Deployment' | 'StatefulSet') => void
  onOpenProject: (name: string) => void
  onDeleteApp: (app: AppWorkload) => void
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
            selected={selected.has(app.name)}
            selectDisabled={selectDisabled}
            onToggleSelect={() => onToggleSelect(app.name)}
            onOpen={() => onOpenApp(app.name, app.kind)}
            onOpenProject={onOpenProject}
            onDelete={() => onDeleteApp(app)}
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

function DatabasesTab({
  snapshot,
  onOpenDatabase,
  onOpenProject
}: {
  snapshot: ResourceSnapshot
  onOpenDatabase: (name: string) => void
  onOpenProject: (name: string) => void
}): React.JSX.Element {
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
        <DatabaseCard
          key={db.name}
          db={db}
          onOpen={() => onOpenDatabase(db.name)}
          onOpenProject={onOpenProject}
        />
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

function updateAction(status: AppUpdateStatus): string {
  if (status.phase === 'downloading') {
    const pct = Math.round((status.progress ?? 0) * 100)
    return `正在下载 ${pct}%`
  }
  if (status.phase === 'ready') return '已打开安装包，拖进「应用程序」后重新打开'
  if (status.phase === 'error') return status.error || '下载失败，点击重试'
  return '点击下载安装包'
}

function UpdateDot({ status }: { status: AppUpdateStatus }): React.JSX.Element {
  return (
    <div className="update-badge">
      <button
        type="button"
        className={`update-dot${status.phase === 'downloading' ? ' busy' : ''}`}
        aria-label={`Helios ${status.latestVersion} 可更新`}
        onClick={() => void window.helios.downloadUpdate()}
      />
      <div className="update-tip" role="tooltip">
        <div className="update-tip-ver">Helios {status.latestVersion}</div>
        {status.notes ? <div className="update-tip-notes">{status.notes}</div> : null}
        <button
          type="button"
          className="update-tip-action"
          onClick={() => void window.helios.downloadUpdate()}
        >
          {updateAction(status)}
        </button>
      </div>
    </div>
  )
}

function ResourcesScreen({ status, onStatusChange, onLogout }: Props): React.JSX.Element {
  const [tab, setTab] = useState<Tab>('home')
  const [detailStack, setDetailStack] = useState<DetailEntry[]>([])
  const [collapsed, setCollapsed] = useState(false)
  const [snapshot, setSnapshot] = useState<ResourceSnapshot | null>(null)
  const [error, setError] = useState('')
  const [appVersion, setAppVersion] = useState('')
  const [update, setUpdate] = useState<AppUpdateStatus | null>(null)
  const [wsOpen, setWsOpen] = useState(false)
  const [pendingDelete, setPendingDelete] = useState<PendingDelete | null>(null)
  const [deleteBusy, setDeleteBusy] = useState(false)
  const [deleteError, setDeleteError] = useState('')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [bulkBusy, setBulkBusy] = useState(false)
  const [bulkError, setBulkError] = useState('')
  const [chatDraft, setChatDraft] = useState<{
    key: string
    text: string
    workspace: string
  } | null>(null)
  const bulkLockRef = useRef(false)

  const clearSelection = useCallback(() => {
    setSelected(new Set())
    setBulkError('')
  }, [])

  /** 切换主导航时离开详情 */
  const navigateTab = useCallback((next: Tab) => {
    setTab(next)
    setDetailStack([])
    setSelected(new Set())
    setBulkError('')
    setPendingDelete(null)
    setDeleteError('')
  }, [])

  /** 打开项目详情（项目属于「项目」tab，从任何入口进入都归位） */
  const openProject = useCallback((name: string) => {
    setTab('projects')
    setDetailStack([{ type: 'project', name }])
  }, [])

  const openDatabase = useCallback((name: string) => {
    setTab('databases')
    setDetailStack([{ type: 'database', name }])
  }, [])

  /** 在当前栈上叠加应用详情（保留返回路径） */
  const pushApp = useCallback((name: string, kind: 'Deployment' | 'StatefulSet') => {
    setDetailStack((stack) => [...stack, { type: 'app', name, kind }])
  }, [])

  const pushDatabase = useCallback((name: string) => {
    setDetailStack((stack) => [...stack, { type: 'database', name }])
  }, [])

  const askHelios = useCallback(
    (draft: string) => {
      setChatDraft({
        key: crypto.randomUUID(),
        text: draft,
        workspace: status.workspace ?? status.namespace ?? ''
      })
      setTab('home')
      setDetailStack([])
    },
    [status.workspace, status.namespace]
  )

  const refresh = useCallback(() => {
    window.helios
      .getResources()
      .then((snap) => {
        setSnapshot(snap)
        setError('')
      })
      .catch((err: unknown) => {
        setError(errMsg(err))
      })
  }, [])

  const selectionScope = `${tab}:${status.workspace ?? ''}:${status.namespace ?? ''}`
  const [appliedSelectionScope, setAppliedSelectionScope] = useState(selectionScope)
  if (appliedSelectionScope !== selectionScope) {
    setAppliedSelectionScope(selectionScope)
    setSelected(new Set())
    setBulkError('')
    setPendingDelete(null)
    setDeleteError('')
  }

  const projectViews = useMemo(() => (snapshot ? buildProjectViews(snapshot) : []), [snapshot])
  const launchpadApps = useMemo(() => snapshot?.apps.filter((a) => a.launchpad) ?? [], [snapshot])
  const selectedProjectViews = useMemo(
    () => projectViews.filter((v) => selected.has(v.project.name)),
    [projectViews, selected]
  )
  const selectedLaunchpadApps = useMemo(
    () => launchpadApps.filter((a) => selected.has(a.name)),
    [launchpadApps, selected]
  )
  const bulkCount =
    tab === 'projects'
      ? selectedProjectViews.length
      : tab === 'apps'
        ? selectedLaunchpadApps.length
        : 0
  const showBulkBar = bulkCount >= 1 && (tab === 'projects' || tab === 'apps')
  const showBulkPause =
    tab === 'projects'
      ? selectedProjectViews.some((v) => v.status !== 'Stopped')
      : selectedLaunchpadApps.some((a) => a.status !== 'Stopped')
  const showBulkStart =
    tab === 'projects'
      ? selectedProjectViews.some((v) => v.status === 'Stopped')
      : selectedLaunchpadApps.some((a) => a.status === 'Stopped')
  const barLocked = bulkBusy || deleteBusy || pendingDelete !== null

  const toggleSelected = useCallback(
    (name: string) => {
      if (barLocked) return
      setSelected((prev) => {
        const next = new Set(prev)
        if (next.has(name)) next.delete(name)
        else next.add(name)
        return next
      })
      setBulkError('')
    },
    [barLocked]
  )

  const selectAllOperable = useCallback(() => {
    if (barLocked) return
    if (tab === 'projects') {
      setSelected(new Set(projectViews.map((v) => v.project.name)))
    } else if (tab === 'apps') {
      setSelected(new Set(launchpadApps.map((a) => a.name)))
    }
    setBulkError('')
  }, [barLocked, tab, projectViews, launchpadApps])

  const runBulkOperate = useCallback(
    async (actionLabel: string, names: string[], fn: (name: string) => Promise<void>) => {
      if (bulkLockRef.current || barLocked || names.length === 0) return
      bulkLockRef.current = true
      setBulkBusy(true)
      setBulkError('')
      const failures: string[] = []
      try {
        for (const name of names) {
          try {
            await fn(name)
          } catch (err) {
            failures.push(`${name}（${errMsg(err)}）`)
          }
        }
        if (failures.length === 0) {
          setSelected(new Set())
          setBulkError('')
        } else {
          setBulkError(`${actionLabel}失败：${failures.join('；')}`)
        }
      } finally {
        setBulkBusy(false)
        bulkLockRef.current = false
        refresh()
      }
    },
    [barLocked, refresh]
  )

  const onBulkPause = useCallback(() => {
    if (tab === 'projects') {
      const names = selectedProjectViews
        .filter((v) => v.status !== 'Stopped')
        .map((v) => v.project.name)
      void runBulkOperate('暂停', names, (name) => window.helios.pauseProject(name))
    } else {
      const names = selectedLaunchpadApps.filter((a) => a.status !== 'Stopped').map((a) => a.name)
      void runBulkOperate('暂停', names, (name) => window.helios.pauseApp(name))
    }
  }, [tab, selectedProjectViews, selectedLaunchpadApps, runBulkOperate])

  const onBulkStart = useCallback(() => {
    if (tab === 'projects') {
      const names = selectedProjectViews
        .filter((v) => v.status === 'Stopped')
        .map((v) => v.project.name)
      void runBulkOperate('启动', names, (name) => window.helios.startProject(name))
    } else {
      const names = selectedLaunchpadApps.filter((a) => a.status === 'Stopped').map((a) => a.name)
      void runBulkOperate('启动', names, (name) => window.helios.startApp(name))
    }
  }, [tab, selectedProjectViews, selectedLaunchpadApps, runBulkOperate])

  const onBulkRestart = useCallback(() => {
    if (tab === 'projects') {
      void runBulkOperate(
        '重启',
        selectedProjectViews.map((v) => v.project.name),
        (name) => window.helios.restartProject(name)
      )
    } else {
      void runBulkOperate(
        '重启',
        selectedLaunchpadApps.map((a) => a.name),
        (name) => window.helios.restartApp(name)
      )
    }
  }, [tab, selectedProjectViews, selectedLaunchpadApps, runBulkOperate])

  const requestDeleteProject = useCallback((view: ProjectView) => {
    setDeleteError('')
    setPendingDelete({
      type: 'project',
      name: view.project.name,
      displayName: view.project.displayName,
      apps: view.workloads.length,
      databases: view.databases.length,
      buckets: view.buckets.length
    })
  }, [])

  const requestDeleteApp = useCallback(
    (app: AppWorkload) => {
      setDeleteError('')
      setPendingDelete({
        type: 'app',
        name: app.name,
        project: app.project,
        projectTitle: app.project ? projectTitleOf(snapshot, app.project) : undefined
      })
    },
    [snapshot]
  )

  const requestBulkDelete = useCallback(() => {
    if (barLocked || bulkCount === 0) return
    setDeleteError('')
    setBulkError('')
    if (tab === 'projects') {
      setPendingDelete({
        type: 'projects',
        names: selectedProjectViews.map((v) => v.project.name),
        labels: selectedProjectViews.map((v) => v.project.displayName || v.project.name),
        apps: selectedProjectViews.reduce((n, v) => n + v.workloads.length, 0),
        databases: selectedProjectViews.reduce((n, v) => n + v.databases.length, 0),
        buckets: selectedProjectViews.reduce((n, v) => n + v.buckets.length, 0)
      })
    } else if (tab === 'apps') {
      setPendingDelete({
        type: 'apps',
        names: selectedLaunchpadApps.map((a) => a.name),
        inProject: selectedLaunchpadApps.filter((a) => a.project).length
      })
    }
  }, [barLocked, bulkCount, tab, selectedProjectViews, selectedLaunchpadApps])

  const closeDeleteDialog = useCallback(() => {
    if (deleteBusy) return
    setPendingDelete(null)
    setDeleteError('')
  }, [deleteBusy])

  const confirmDelete = useCallback(() => {
    if (!pendingDelete || deleteBusy) return
    const pending = pendingDelete

    if (pending.type === 'projects' || pending.type === 'apps') {
      if (bulkLockRef.current || bulkBusy) return
      bulkLockRef.current = true
      setDeleteBusy(true)
      setDeleteError('')
      setBulkBusy(true)
      setBulkError('')
      void (async () => {
        const failures: string[] = []
        const fn =
          pending.type === 'projects'
            ? (name: string) => window.helios.deleteProject(name)
            : (name: string) => window.helios.deleteApp(name)
        try {
          for (const name of pending.names) {
            try {
              await fn(name)
            } catch (err) {
              failures.push(`${name}（${errMsg(err)}）`)
            }
          }
          setPendingDelete(null)
          if (failures.length === 0) {
            setSelected(new Set())
            setBulkError('')
          } else {
            setBulkError(`删除失败：${failures.join('；')}`)
          }
        } finally {
          setDeleteBusy(false)
          setBulkBusy(false)
          bulkLockRef.current = false
          refresh()
        }
      })()
      return
    }

    setDeleteBusy(true)
    setDeleteError('')
    const run =
      pending.type === 'project'
        ? window.helios.deleteProject(pending.name)
        : pending.type === 'database'
          ? window.helios.deleteDatabase(pending.name)
          : window.helios.deleteApp(pending.name)
    void run
      .then(async () => {
        setPendingDelete(null)
        let snap: ResourceSnapshot | null = null
        try {
          snap = await window.helios.getResources()
          setSnapshot(snap)
          setError('')
        } catch (err) {
          setError(errMsg(err))
        }
        setDetailStack((stack) => {
          let next = stack
          if (pending.type === 'project') {
            next = []
          } else {
            const top = stack[stack.length - 1]
            if (
              (pending.type === 'app' && top?.type === 'app' && top.name === pending.name) ||
              (pending.type === 'database' && top?.type === 'database' && top.name === pending.name)
            ) {
              next = stack.slice(0, -1)
            }
          }
          return snap ? pruneDetailStack(next, snap) : next
        })
      })
      .catch((err: unknown) => {
        setDeleteError(errMsg(err))
      })
      .finally(() => setDeleteBusy(false))
  }, [pendingDelete, deleteBusy, bulkBusy, refresh])

  useEffect(() => {
    const initial = setTimeout(refresh, 0)
    const timer = setInterval(refresh, REFRESH_INTERVAL_MS)
    return () => {
      clearTimeout(initial)
      clearInterval(timer)
    }
  }, [refresh])

  useEffect(() => {
    void window.helios.getAppVersion().then(setAppVersion)
  }, [])

  useEffect(() => {
    void window.helios.getUpdateStatus().then(setUpdate)
    return window.helios.onUpdateEvent(setUpdate)
  }, [])

  const workspaceId = status.workspace ?? status.namespace ?? ''
  const activeDraft = chatDraft?.workspace === workspaceId ? chatDraft : null
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
              <div className="sidebar-logo-wrap">
                <button className="sidebar-logo" title="Helios" onClick={() => navigateTab('home')}>
                  <img className="logo-img" src={sealosLogo} alt="" />
                </button>
                {update?.available ? <UpdateDot status={update} /> : null}
              </div>
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
                    clearSelection()
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
                {appVersion ? (
                  <span className="sidebar-version" title={`Helios ${appVersion}`}>
                    {appVersion}
                  </span>
                ) : null}
              </div>
            </div>
          </div>
        </header>
      )}

      <main className="content">
        <div className="drag-strip" />
        <div className={tab === 'home' ? 'home-shell' : 'home-shell is-hidden'}>
          <div className="hero-bg" aria-hidden="true" />
          <HomeChat
            key={status.workspace ?? status.namespace ?? ''}
            workspaceId={status.workspace ?? status.namespace ?? ''}
            insetLeft={collapsed ? 52 : 12}
            composerDraft={activeDraft?.text}
            draftKey={activeDraft?.key}
          />
        </div>
        {tab !== 'home' &&
          (detailStack.length > 0 ? (
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
                  if (top.type === 'project') {
                    return (
                      <ProjectDetailView
                        key={top.name}
                        name={top.name}
                        crumbs={crumbs}
                        onOpenApp={pushApp}
                        onOpenDatabase={pushDatabase}
                        onOperated={refresh}
                        onRequestDelete={(info) => {
                          setDeleteError('')
                          setPendingDelete({ type: 'project', name: top.name, ...info })
                        }}
                      />
                    )
                  }
                  if (top.type === 'database') {
                    return (
                      <DatabaseDetailView
                        key={top.name}
                        name={top.name}
                        crumbs={crumbs}
                        onOpenProject={openProject}
                        onOpenApp={pushApp}
                        onOperated={refresh}
                        onAskHelios={askHelios}
                        onRequestDelete={(project) => {
                          setDeleteError('')
                          setPendingDelete({
                            type: 'database',
                            name: top.name,
                            project,
                            projectTitle: project ? projectTitleOf(snapshot, project) : undefined
                          })
                        }}
                      />
                    )
                  }
                  return (
                    <AppDetailView
                      key={`${top.kind}-${top.name}`}
                      name={top.name}
                      kind={top.kind}
                      crumbs={crumbs}
                      onOpenProject={openProject}
                      onOperated={refresh}
                      onRequestDelete={(project) => {
                        setDeleteError('')
                        setPendingDelete({
                          type: 'app',
                          name: top.name,
                          project,
                          projectTitle: project ? projectTitleOf(snapshot, project) : undefined
                        })
                      }}
                    />
                  )
                })()}
              </div>
            </div>
          ) : (
            <div className="page">
              <header className="page-head">
                <div className="page-head-row">
                  <h1>{TAB_TITLE[tab]}</h1>
                  {tab !== 'templates' && tab !== 'aiproxy' && snapshot && (
                    <span className="hint">
                      更新于 {new Date(snapshot.fetchedAt).toLocaleTimeString()}
                    </span>
                  )}
                </div>
                {showBulkBar && (
                  <BulkActionBar
                    count={bulkCount}
                    busy={barLocked}
                    error={bulkError}
                    showPause={showBulkPause}
                    showStart={showBulkStart}
                    onSelectAll={selectAllOperable}
                    onClear={clearSelection}
                    onPause={onBulkPause}
                    onStart={onBulkStart}
                    onRestart={onBulkRestart}
                    onDelete={requestBulkDelete}
                  />
                )}
              </header>
              <div className="page-body">
                {tab === 'templates' ? (
                  <TemplatesTab
                    workspaceName={workspaceLabel}
                    onDeployed={(instanceName) => {
                      openProject(instanceName)
                      refresh()
                    }}
                  />
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
                      <ProjectsTab
                        snapshot={snapshot}
                        selected={selected}
                        selectDisabled={barLocked}
                        onToggleSelect={toggleSelected}
                        onOpenProject={openProject}
                        onDeleteProject={requestDeleteProject}
                      />
                    )}
                    {snapshot && tab === 'apps' && (
                      <AppsTab
                        snapshot={snapshot}
                        selected={selected}
                        selectDisabled={barLocked}
                        onToggleSelect={toggleSelected}
                        onOpenApp={pushApp}
                        onOpenProject={openProject}
                        onDeleteApp={requestDeleteApp}
                      />
                    )}
                    {snapshot && tab === 'databases' && (
                      <DatabasesTab
                        snapshot={snapshot}
                        onOpenDatabase={openDatabase}
                        onOpenProject={openProject}
                      />
                    )}
                    {snapshot && tab === 'storage' && <StorageTab snapshot={snapshot} />}
                    {tab === 'account' && (
                      <AccountTab status={status} snapshot={snapshot} onLogout={onLogout} />
                    )}
                  </>
                )}
              </div>
            </div>
          ))}
      </main>
      {pendingDelete?.type === 'project' && (
        <ConfirmDialog
          title="删除项目？"
          confirmLabel="删除项目"
          busy={deleteBusy}
          error={deleteError}
          onCancel={closeDeleteDialog}
          onConfirm={confirmDelete}
        >
          <p>确定删除「{pendingDelete.displayName || pendingDelete.name}」？</p>
          <p>
            实例名 <span className="mono">{pendingDelete.name}</span>
          </p>
          <p>
            将带走 {pendingDelete.apps} 个应用、{pendingDelete.databases} 个数据库、
            {pendingDelete.buckets} 个存储桶。不可恢复。
          </p>
        </ConfirmDialog>
      )}
      {pendingDelete?.type === 'app' && !pendingDelete.project && (
        <ConfirmDialog
          title="删除应用？"
          confirmLabel="删除应用"
          busy={deleteBusy}
          error={deleteError}
          onCancel={closeDeleteDialog}
          onConfirm={confirmDelete}
        >
          <p>确定删除「{pendingDelete.name}」？不可恢复。</p>
        </ConfirmDialog>
      )}
      {pendingDelete?.type === 'app' && pendingDelete.project && (
        <ConfirmDialog
          title="删除应用？"
          confirmLabel="只删除这个应用"
          extraLabel="去项目"
          busy={deleteBusy}
          error={deleteError}
          onCancel={closeDeleteDialog}
          onExtra={() => {
            if (deleteBusy || !pendingDelete.project) return
            const project = pendingDelete.project
            setPendingDelete(null)
            setDeleteError('')
            openProject(project)
          }}
          onConfirm={confirmDelete}
        >
          <p>
            「{pendingDelete.name}」是项目「{pendingDelete.projectTitle || pendingDelete.project}
            」的一部分。只删这个应用，项目里的数据库和其它应用还在。要拆整个栈，走项目删除。
          </p>
        </ConfirmDialog>
      )}
      {pendingDelete?.type === 'database' && !pendingDelete.project && (
        <ConfirmDialog
          title="删除数据库？"
          confirmLabel="删除数据库"
          busy={deleteBusy}
          error={deleteError}
          onCancel={closeDeleteDialog}
          onConfirm={confirmDelete}
        >
          <p>确定删除「{pendingDelete.name}」？不可恢复。</p>
        </ConfirmDialog>
      )}
      {pendingDelete?.type === 'database' && pendingDelete.project && (
        <ConfirmDialog
          title="删除数据库？"
          confirmLabel="只删除这个数据库"
          extraLabel="去项目"
          busy={deleteBusy}
          error={deleteError}
          onCancel={closeDeleteDialog}
          onExtra={() => {
            if (deleteBusy || !pendingDelete.project) return
            const project = pendingDelete.project
            setPendingDelete(null)
            setDeleteError('')
            openProject(project)
          }}
          onConfirm={confirmDelete}
        >
          <p>
            「{pendingDelete.name}」是项目「{pendingDelete.projectTitle || pendingDelete.project}
            」的一部分。删库可能让应用连不上。要拆整个栈，走项目删除。
          </p>
        </ConfirmDialog>
      )}
      {pendingDelete?.type === 'projects' && (
        <ConfirmDialog
          title="删除项目？"
          confirmLabel={`删除 ${pendingDelete.names.length} 个项目`}
          busy={deleteBusy}
          error={deleteError}
          onCancel={closeDeleteDialog}
          onConfirm={confirmDelete}
        >
          <p>将删除 {pendingDelete.names.length} 个项目。</p>
          <p>
            合计带走 {pendingDelete.apps} 个应用、{pendingDelete.databases} 个数据库、
            {pendingDelete.buckets} 个存储桶。不可恢复。
          </p>
          <p>项目：{formatNameList(pendingDelete.labels)}</p>
        </ConfirmDialog>
      )}
      {pendingDelete?.type === 'apps' && (
        <ConfirmDialog
          title="删除应用？"
          confirmLabel={`删除 ${pendingDelete.names.length} 个应用`}
          busy={deleteBusy}
          error={deleteError}
          onCancel={closeDeleteDialog}
          onConfirm={confirmDelete}
        >
          <p>将删除 {pendingDelete.names.length} 个应用。不可恢复。</p>
          {pendingDelete.inProject > 0 && (
            <p>其中 {pendingDelete.inProject} 个是项目的一部分，只删应用、不拆项目。</p>
          )}
        </ConfirmDialog>
      )}
    </div>
  )
}

export default ResourcesScreen
