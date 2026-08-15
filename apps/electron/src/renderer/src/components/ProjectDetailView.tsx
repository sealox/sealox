import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { AppStatus, OtherResource, ProjectDetail } from '../../../shared/types'
import { DetailCrumbs, type Crumb } from './AppDetailView'
import {
  EmptyNote,
  GithubIcon,
  GlobeIcon,
  OpenIcon,
  RefreshIcon,
  Section,
  StatStrip
} from './detailParts'
import { STATUS_LABEL, dbPhaseToStatus, openUrl, statusDotClass, timeAgo } from './detailUtils'
import ProjectTopology from './ProjectTopology'

const DETAIL_REFRESH_MS = 15_000

interface Props {
  name: string
  crumbs: Crumb[]
  onOpenApp: (name: string, kind: 'Deployment' | 'StatefulSet') => void
  onRequestDelete: (info: {
    displayName?: string
    apps: number
    databases: number
    buckets: number
  }) => void
  onOperated: () => void
}

function aggregateStatus(statuses: AppStatus[]): AppStatus | null {
  if (statuses.length === 0) return null
  if (statuses.includes('Failed')) return 'Failed'
  if (statuses.includes('Progressing')) return 'Progressing'
  if (statuses.includes('Running')) return 'Running'
  return 'Stopped'
}

function ProjectDetailView({
  name,
  crumbs,
  onOpenApp,
  onRequestDelete,
  onOperated
}: Props): React.JSX.Element {
  const [detail, setDetail] = useState<ProjectDetail | null>(null)
  const [error, setError] = useState('')
  const [refreshing, setRefreshing] = useState(false)
  const [acting, setActing] = useState<'restart' | 'pause' | 'start' | null>(null)
  const [actionError, setActionError] = useState('')
  const actingRef = useRef(false)

  const refresh = useCallback(() => {
    setRefreshing(true)
    window.helios
      .getProjectDetail(name)
      .then((data) => {
        setDetail(data)
        setError('')
      })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setRefreshing(false))
  }, [name])

  useEffect(() => {
    const initial = setTimeout(refresh, 0)
    const timer = setInterval(refresh, DETAIL_REFRESH_MS)
    return () => {
      clearTimeout(initial)
      clearInterval(timer)
    }
  }, [refresh])

  const runOperate = (kind: 'restart' | 'pause' | 'start', fn: () => Promise<void>): void => {
    if (actingRef.current) return
    actingRef.current = true
    setActing(kind)
    setActionError('')
    fn()
      .then(() => {
        onOperated()
        refresh()
      })
      .catch((err: unknown) => setActionError(err instanceof Error ? err.message : String(err)))
      .finally(() => {
        actingRef.current = false
        setActing(null)
      })
  }

  const status = useMemo(
    () =>
      detail
        ? aggregateStatus([
            ...detail.apps.map((a) => a.status),
            ...detail.databases.map((d) => dbPhaseToStatus(d.phase))
          ])
        : null,
    [detail]
  )

  const publicUrls = useMemo(
    () => [...new Set((detail?.apps ?? []).flatMap((a) => a.urls))],
    [detail]
  )

  const failingPods = useMemo(
    () =>
      (detail?.apps ?? []).flatMap((app) =>
        app.pods.filter((pod) => pod.reason).map((pod) => ({ app: app.name, kind: app.kind, pod }))
      ),
    [detail]
  )

  const othersByKind = useMemo(() => {
    const groups = new Map<string, OtherResource[]>()
    for (const item of detail?.others ?? []) {
      const list = groups.get(item.kind) ?? []
      list.push(item)
      groups.set(item.kind, list)
    }
    return [...groups.entries()]
  }, [detail])

  if (error && !detail) {
    return (
      <div className="detail">
        <DetailCrumbs crumbs={crumbs} />
        <div className="error">{error}</div>
      </div>
    )
  }

  if (!detail) {
    return (
      <div className="detail">
        <DetailCrumbs crumbs={crumbs} />
        <div className="placeholder">正在读取项目详情…</div>
      </div>
    )
  }

  const title = detail.displayName ?? detail.name
  const launchpadApps = detail.apps.filter((a) => a.launchpad)
  const dbStatuses = detail.databases.map((d) => dbPhaseToStatus(d.phase))
  const showOperate = launchpadApps.length > 0 || detail.databases.length > 0
  const showPause =
    launchpadApps.some((a) => a.status !== 'Stopped') || dbStatuses.some((s) => s !== 'Stopped')
  const showStart =
    launchpadApps.some((a) => a.status === 'Stopped') || dbStatuses.some((s) => s === 'Stopped')

  return (
    <div className="detail">
      <DetailCrumbs crumbs={crumbs} />

      <header className="detail-title-row">
        {detail.icon && (
          <img
            className="detail-icon"
            src={detail.icon}
            alt=""
            onError={(e) => {
              ;(e.target as HTMLImageElement).style.display = 'none'
            }}
          />
        )}
        <span className={statusDotClass(status)} />
        <h1 className="detail-title">{title}</h1>
        {detail.template && <span className="chip chip-project">{detail.template}</span>}
        <span className="detail-actions">
          {detail.gitRepo && (
            <button
              className="icon-btn"
              title={detail.gitRepo}
              onClick={() => openUrl(detail.gitRepo as string)}
            >
              <GithubIcon size={15} />
            </button>
          )}
          {detail.website && (
            <button
              className="icon-btn"
              title={detail.website}
              onClick={() => openUrl(detail.website as string)}
            >
              <GlobeIcon size={16} />
            </button>
          )}
          {publicUrls[0] && (
            <button className="daction" onClick={() => openUrl(publicUrls[0])}>
              <OpenIcon size={14} />
              打开站点
            </button>
          )}
          {showOperate && (
            <>
              <button
                className="daction"
                disabled={acting !== null}
                onClick={() => runOperate('restart', () => window.helios.restartProject(name))}
              >
                {acting === 'restart' ? '重启中…' : '重启'}
              </button>
              {showPause && (
                <button
                  className="daction daction-secondary"
                  disabled={acting !== null}
                  onClick={() => runOperate('pause', () => window.helios.pauseProject(name))}
                >
                  {acting === 'pause' ? '暂停中…' : '暂停'}
                </button>
              )}
              {showStart && (
                <button
                  className="daction daction-secondary"
                  disabled={acting !== null}
                  onClick={() => runOperate('start', () => window.helios.startProject(name))}
                >
                  {acting === 'start' ? '启动中…' : '启动'}
                </button>
              )}
            </>
          )}
          <button
            className="daction daction-danger"
            disabled={acting !== null}
            onClick={() =>
              onRequestDelete({
                displayName: detail.displayName,
                apps: detail.apps.length,
                databases: detail.databases.length,
                buckets: detail.buckets.length
              })
            }
          >
            删除
          </button>
          <button
            className={`icon-btn${refreshing ? ' loading' : ''}`}
            title="刷新"
            disabled={refreshing}
            onClick={refresh}
          >
            <RefreshIcon size={16} />
          </button>
        </span>
      </header>

      {(detail.displayName || detail.description) && (
        <div className="detail-subline">
          {detail.displayName && <span className="mono">{detail.name}</span>}
          {detail.displayName && detail.description && <span className="crumb-sep">·</span>}
          {detail.description && <span>{detail.description}</span>}
        </div>
      )}

      {error && <div className="error">{error}</div>}
      {actionError && <div className="error">{actionError}</div>}

      <StatStrip
        items={[
          {
            label: '状态',
            value: status ? (
              <span className={`stat-status stat-${status.toLowerCase()}`}>
                {STATUS_LABEL[status]}
              </span>
            ) : (
              '无工作负载'
            )
          },
          { label: '应用', value: detail.apps.length },
          { label: '数据库', value: detail.databases.length },
          { label: '存储桶', value: detail.buckets.length },
          { label: '定时任务', value: detail.cronjobs.length },
          { label: '创建于', value: timeAgo(detail.createdAt) }
        ]}
      />

      {failingPods.length > 0 && (
        <div className="problem-banner">
          <div className="problem-title">发现 {failingPods.length} 个异常 Pod</div>
          {failingPods.map(({ app, kind, pod }) => (
            <button
              key={pod.name}
              className="problem-row"
              title={`打开 ${app} 查看日志与事件`}
              onClick={() => onOpenApp(app, kind)}
            >
              <span className="mono truncate">{pod.name}</span>
              <span className="problem-reason">
                {pod.reason}（重启 {pod.restarts} 次）
              </span>
            </button>
          ))}
        </div>
      )}

      {detail.apps.length + detail.databases.length + detail.buckets.length > 0 ? (
        <ProjectTopology
          key={name}
          apps={detail.apps}
          databases={detail.databases}
          buckets={detail.buckets}
          links={detail.links ?? []}
          onOpenApp={onOpenApp}
        />
      ) : (
        <section className="dsection">
          <EmptyNote text="项目里还没有应用、数据库或存储。" />
        </section>
      )}

      {detail.cronjobs.length > 0 && (
        <Section title="定时任务" count={detail.cronjobs.length}>
          <div className="comp-list">
            {detail.cronjobs.map((job) => (
              <div key={job.name} className="comp-row">
                <span className={`dot ${job.suspended ? 'dot-stopped' : 'dot-running'}`} />
                <span className="comp-name truncate" title={job.name}>
                  {job.name}
                </span>
                <span className="chip chip-mini mono">{job.schedule}</span>
                <span className="comp-cell">
                  {job.suspended
                    ? '已暂停'
                    : job.lastScheduleAt
                      ? `上次运行 ${timeAgo(job.lastScheduleAt)}`
                      : '尚未运行'}
                </span>
              </div>
            ))}
          </div>
        </Section>
      )}

      <Section title="配套资源" count={detail.others.length}>
        {detail.others.length === 0 ? (
          <EmptyNote text="没有其他关联资源。" />
        ) : (
          <div className="res-groups">
            {othersByKind.map(([kind, items]) => (
              <div key={kind} className="res-group">
                <span className="res-kind">
                  {kind}
                  <span className="res-count">{items.length}</span>
                </span>
                <span className="res-names">
                  {items.map((item) => (
                    <span key={item.name} className="res-chip mono" title={item.note ?? item.name}>
                      {item.name}
                      {item.note && <span className="res-note">{item.note}</span>}
                    </span>
                  ))}
                </span>
              </div>
            ))}
          </div>
        )}
      </Section>

      <div className="detail-foot hint">
        数据更新于 {new Date(detail.fetchedAt).toLocaleTimeString()} · 每 15 秒自动刷新
      </div>
    </div>
  )
}

export default ProjectDetailView
