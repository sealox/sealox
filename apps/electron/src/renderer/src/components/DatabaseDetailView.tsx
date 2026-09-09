import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type {
  DatabaseConnection,
  DatabaseInstanceDetail,
  DatabaseMonitor,
  DatabaseSchemaNode,
  DatabaseSchemaTree,
  PodDetail
} from '../../../shared/types'
import { DetailCrumbs, PodRow, type Crumb, type LogState } from './AppDetailView'
import {
  CopyValue,
  EmptyNote,
  EventList,
  RefreshIcon,
  Section,
  SparkCard,
  StatStrip
} from './detailParts'
import { STATUS_LABEL, dbPhaseToStatus, statusDotClass, timeAgo } from './detailUtils'

const DETAIL_REFRESH_MS = 15_000
const MONITOR_REFRESH_MS = 60_000
const MASK = '••••••••'

interface Props {
  name: string
  crumbs: Crumb[]
  onOpenProject?: (project: string) => void
  onOpenApp: (name: string, kind: 'Deployment' | 'StatefulSet') => void
  onRequestDelete: (project?: string) => void
  onAskHelios: (draft: string) => void
  onOperated: () => void
}

function envVarName(engine?: string): string {
  const e = (engine ?? '').toLowerCase()
  if (e.includes('redis')) return 'REDIS_URL'
  if (e.includes('kafka')) return 'KAFKA_URL'
  return 'DATABASE_URL'
}

function maskSecret(text: string): string {
  return text.replace(/:([^:@/]+)@/, `:${MASK}@`)
}

function formatQuota(value: number | undefined, unit: string): string {
  if (value === undefined) return '—'
  const n = Number.isInteger(value) ? String(value) : String(Math.round(value * 100) / 100)
  return `${n} ${unit}`
}

function askDraft(detail: DatabaseInstanceDetail): string {
  return `请查看当前工作空间的数据库 ${detail.name}（引擎 ${detail.engine ?? '未知'}，版本 ${detail.version ?? '未知'}，状态 ${detail.phase}）。先不要改数据。我的问题是：`
}

const SYSTEM_DATABASES = new Set([
  'postgres',
  'template0',
  'template1',
  'mysql',
  'information_schema',
  'performance_schema',
  'sys',
  'admin',
  'local',
  'config'
])

function isSystemDatabase(name: string): boolean {
  return SYSTEM_DATABASES.has(name)
}

function schemaVisibleTableCount(tree: DatabaseSchemaTree): number {
  const app = tree.databases.filter((db) => !isSystemDatabase(db.name))
  const source = app.length > 0 ? app : tree.databases
  return source.reduce((n, db) => n + (db.tables?.length ?? 0), 0)
}

function SchemaCatalog({ tree }: { tree: DatabaseSchemaTree }): React.JSX.Element {
  const { appDbs, systemDbs } = useMemo(() => {
    const app: DatabaseSchemaNode[] = []
    const system: DatabaseSchemaNode[] = []
    for (const db of tree.databases) {
      if (isSystemDatabase(db.name)) system.push(db)
      else app.push(db)
    }
    const byName = (a: DatabaseSchemaNode, b: DatabaseSchemaNode): number =>
      a.name.localeCompare(b.name)
    return { appDbs: app.sort(byName), systemDbs: system.sort(byName) }
  }, [tree.databases])

  const primary = appDbs.length > 0 ? appDbs : systemDbs
  const tucked = appDbs.length > 0 ? systemDbs : []

  return (
    <div className="schema-tree">
      {primary.map((db) => (
        <SchemaDatabase key={db.name} db={db} />
      ))}
      {tucked.length > 0 && (
        <details className="schema-system">
          <summary>
            系统库
            <span className="dsection-count">{tucked.length}</span>
          </summary>
          {tucked.map((db) => (
            <SchemaDatabase key={db.name} db={db} quiet />
          ))}
        </details>
      )}
    </div>
  )
}

function SchemaDatabase({
  db,
  quiet = false
}: {
  db: DatabaseSchemaNode
  quiet?: boolean
}): React.JSX.Element {
  const tables = useMemo(
    () => [...(db.tables ?? [])].sort((a, b) => a.localeCompare(b)),
    [db.tables]
  )
  return (
    <div className={`schema-db${quiet ? ' quiet' : ''}`}>
      <div className="schema-db-head">
        <span className="schema-db-name mono">{db.name}</span>
        <span className="schema-db-meta">
          {tables.length === 0 ? '没有表' : `${tables.length} 张表`}
        </span>
      </div>
      {tables.length > 0 && (
        <ul className="schema-table-cols">
          {tables.map((table) => (
            <li key={table} className="mono">
              {table}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function SecretCopy({
  text,
  revealed,
  mask = MASK
}: {
  text: string
  revealed: boolean
  mask?: string
}): React.JSX.Element {
  return <CopyValue text={text} display={revealed ? text : mask} title="点击复制明文" />
}

function ConnFields({
  conn,
  revealed
}: {
  conn: DatabaseConnection
  revealed: boolean
}): React.JSX.Element {
  return (
    <div className="kv-list">
      {conn.host ? (
        <div className="kv-row">
          <span className="kv-key">Host</span>
          <span className="kv-value">
            <CopyValue text={conn.host} />
          </span>
        </div>
      ) : null}
      {conn.port ? (
        <div className="kv-row">
          <span className="kv-key">Port</span>
          <span className="kv-value">
            <CopyValue text={conn.port} />
          </span>
        </div>
      ) : null}
      {conn.username ? (
        <div className="kv-row">
          <span className="kv-key">Username</span>
          <span className="kv-value">
            <CopyValue text={conn.username} />
          </span>
        </div>
      ) : null}
      {conn.password ? (
        <div className="kv-row">
          <span className="kv-key">Password</span>
          <span className="kv-value">
            <SecretCopy text={conn.password} revealed={revealed} />
          </span>
        </div>
      ) : null}
      {conn.connectionString ? (
        <div className="kv-row">
          <span className="kv-key">连接串</span>
          <span className="kv-value">
            <SecretCopy
              text={conn.connectionString}
              revealed={revealed}
              mask={maskSecret(conn.connectionString)}
            />
          </span>
        </div>
      ) : null}
    </div>
  )
}

function DatabaseDetailView({
  name,
  crumbs,
  onOpenProject,
  onOpenApp,
  onRequestDelete,
  onAskHelios,
  onOperated
}: Props): React.JSX.Element {
  const [detail, setDetail] = useState<DatabaseInstanceDetail | null>(null)
  const [error, setError] = useState('')
  const [monitor, setMonitor] = useState<DatabaseMonitor | null>(null)
  const [schema, setSchema] = useState<DatabaseSchemaTree | null>(null)
  const [schemaLoading, setSchemaLoading] = useState(false)
  const [expandedPod, setExpandedPod] = useState<string | null>(null)
  const [logs, setLogs] = useState<Record<string, LogState>>({})
  const [refreshing, setRefreshing] = useState(false)
  const [acting, setActing] = useState<'restart' | 'pause' | 'start' | 'public' | null>(null)
  const [actionError, setActionError] = useState('')
  const [revealed, setRevealed] = useState(false)
  const [publicRevealed, setPublicRevealed] = useState(false)
  const actingRef = useRef(false)

  const refresh = useCallback(
    (reloadSchema = false) => {
      setRefreshing(true)
      window.helios
        .getDatabaseDetail(name)
        .then((data) => {
          setDetail(data)
          setError('')
          if (reloadSchema) {
            setSchemaLoading(true)
            window.helios
              .getDatabaseSchema(name)
              .then(setSchema)
              .catch(() => setSchema({ supported: true, reason: 'fetch-failed', databases: [] }))
              .finally(() => setSchemaLoading(false))
          }
        })
        .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)))
        .finally(() => setRefreshing(false))
    },
    [name]
  )

  const runOperate = (
    op: 'restart' | 'pause' | 'start' | 'public',
    fn: () => Promise<void>
  ): void => {
    if (actingRef.current) return
    actingRef.current = true
    setActing(op)
    setActionError('')
    fn()
      .then(() => {
        onOperated()
        refresh(true)
      })
      .catch((err: unknown) => setActionError(err instanceof Error ? err.message : String(err)))
      .finally(() => {
        actingRef.current = false
        setActing(null)
      })
  }

  useEffect(() => {
    const initial = setTimeout(() => refresh(true), 0)
    const timer = setInterval(() => refresh(false), DETAIL_REFRESH_MS)
    return () => {
      clearTimeout(initial)
      clearInterval(timer)
    }
  }, [refresh])

  useEffect(() => {
    let cancelled = false
    const load = (): void => {
      window.helios
        .getDatabaseMonitor(name)
        .then((data) => {
          if (!cancelled) setMonitor(data)
        })
        .catch(() => undefined)
    }
    load()
    const timer = setInterval(load, MONITOR_REFRESH_MS)
    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [name])

  const loadLogs = useCallback((pod: string, container: string | undefined, previous: boolean) => {
    setLogs((prev) => ({
      ...prev,
      [pod]: { ...prev[pod], loading: true, error: undefined, container, previous }
    }))
    window.helios
      .getPodLogs(pod, container, previous)
      .then((text) =>
        setLogs((prev) => ({
          ...prev,
          [pod]: { loading: false, text, container, previous }
        }))
      )
      .catch((err: unknown) =>
        setLogs((prev) => ({
          ...prev,
          [pod]: {
            loading: false,
            error: err instanceof Error ? err.message : String(err),
            container,
            previous
          }
        }))
      )
  }, [])

  const togglePod = useCallback(
    (pod: PodDetail) => {
      setExpandedPod((current) => {
        const next = current === pod.name ? null : pod.name
        if (next && logs[pod.name]?.text === undefined && !logs[pod.name]?.loading) {
          loadLogs(pod.name, pod.containers[0]?.name, false)
        }
        return next
      })
    },
    [logs, loadLogs]
  )

  const liveMonitor = useMemo(() => {
    if (!monitor?.available || !detail) return monitor
    const livePods = new Set(detail.pods.map((pod) => pod.name))
    const filterSeries = (list: typeof monitor.cpu): typeof monitor.cpu => {
      const alive = list.filter((series) => livePods.has(series.name) || !series.name)
      return alive.length > 0 ? alive : list
    }
    return {
      ...monitor,
      cpu: filterSeries(monitor.cpu),
      memory: filterSeries(monitor.memory),
      disk: filterSeries(monitor.disk)
    }
  }, [monitor, detail])

  const status = detail ? dbPhaseToStatus(detail.phase) : null
  const stopped = detail?.phase === 'Stopped'
  const envName = envVarName(detail?.engine)
  const envLine = detail?.connection?.connectionString
    ? `${envName}=${detail.connection.connectionString}`
    : null

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
        <div className="placeholder">正在读取数据库详情…</div>
      </div>
    )
  }

  const warningEvents = detail.events.filter((e) => e.type === 'Warning')
  const publicConn =
    detail.publicConnection ??
    (detail.publicConnectionRaw
      ? {
          host: '',
          port: '',
          username: '',
          password: '',
          connectionString: detail.publicConnectionRaw
        }
      : null)

  return (
    <div className="detail">
      <DetailCrumbs crumbs={crumbs} />

      <header className="detail-title-row">
        <span className={statusDotClass(status)} />
        <h1 className="detail-title">{detail.name}</h1>
        {detail.engine && <span className="chip">{detail.engine}</span>}
        {detail.project && (
          <button
            className="chip chip-project chip-link"
            title={`打开项目 ${detail.project}`}
            onClick={() => onOpenProject?.(detail.project as string)}
          >
            {detail.project}
          </button>
        )}
        <span className="detail-actions">
          <button
            className="daction"
            disabled={acting !== null}
            onClick={() => onAskHelios(askDraft(detail))}
          >
            问 Helios
          </button>
          <button
            className="daction"
            disabled={acting !== null}
            onClick={() => runOperate('restart', () => window.helios.restartDatabase(name))}
          >
            {acting === 'restart' ? '重启中…' : '重启'}
          </button>
          {stopped ? (
            <button
              className="daction daction-secondary"
              disabled={acting !== null}
              onClick={() => runOperate('start', () => window.helios.startDatabase(name))}
            >
              {acting === 'start' ? '启动中…' : '启动'}
            </button>
          ) : (
            <button
              className="daction daction-secondary"
              disabled={acting !== null}
              onClick={() => runOperate('pause', () => window.helios.pauseDatabase(name))}
            >
              {acting === 'pause' ? '暂停中…' : '暂停'}
            </button>
          )}
          <button
            className="daction daction-danger"
            disabled={acting !== null}
            onClick={() => onRequestDelete(detail.project)}
          >
            删除
          </button>
          <button
            className={`icon-btn${refreshing ? ' loading' : ''}`}
            title="刷新"
            disabled={refreshing}
            onClick={() => refresh(true)}
          >
            <RefreshIcon size={16} />
          </button>
        </span>
      </header>

      {error && <div className="error">{error}</div>}
      {actionError && <div className="error">{actionError}</div>}
      {liveMonitor?.diskOverflow && (
        <div className="problem-banner">
          <div className="problem-title">磁盘空间不足</div>
          <div className="hint">Sealos 判定磁盘占用过高，可能影响写入。</div>
        </div>
      )}

      <StatStrip
        items={[
          {
            label: '状态',
            value: (
              <span className={`stat-status stat-${(status ?? 'stopped').toLowerCase()}`}>
                {status ? STATUS_LABEL[status] : detail.phase}
              </span>
            ),
            sub: stopped ? '已被暂停' : undefined
          },
          {
            label: '引擎',
            value: detail.engine ?? '—',
            sub: detail.version
          },
          { label: 'CPU 限额', value: formatQuota(detail.cpu, 'vCPU') },
          { label: '内存限额', value: formatQuota(detail.memory, 'GiB') },
          { label: '存储', value: formatQuota(detail.storage, 'GiB') },
          { label: '创建于', value: timeAgo(detail.createdAt) }
        ]}
      />

      {liveMonitor?.available ? (
        <div className={`spark-grid${liveMonitor.disk.length > 0 ? ' spark-grid-3' : ''}`}>
          <SparkCard title="CPU 使用率" series={liveMonitor.cpu} color="#2563eb" />
          <SparkCard title="内存使用率" series={liveMonitor.memory} color="#059669" />
          {liveMonitor.disk.length > 0 && (
            <SparkCard title="磁盘使用率" series={liveMonitor.disk} color="#d97706" />
          )}
        </div>
      ) : (
        liveMonitor && <div className="monitor-note">监控数据不可用：{liveMonitor.reason}</div>
      )}

      <Section
        title="连接"
        actions={
          detail.connection ? (
            <button className="log-container-btn" onClick={() => setRevealed((v) => !v)}>
              {revealed ? '隐藏' : '显示'}
            </button>
          ) : undefined
        }
      >
        {detail.connection ? (
          <>
            <ConnFields conn={detail.connection} revealed={revealed} />
            {envLine && (
              <div className="db-env">
                <div className="ai-snippet-bar">
                  <span className="ai-endpoint-label">{envName}</span>
                  <span className="log-spacer" />
                  <button
                    className="log-container-btn"
                    onClick={() => void window.helios.copyText(envLine)}
                  >
                    复制
                  </button>
                </div>
                <pre className="ai-snippet-code">{revealed ? envLine : maskSecret(envLine)}</pre>
              </div>
            )}
          </>
        ) : (
          <EmptyNote text="凭证尚未就绪" />
        )}
      </Section>

      <Section
        title="公网"
        actions={
          <>
            {detail.publicEnabled &&
            publicConn &&
            (publicConn.host || publicConn.connectionString) ? (
              <button className="log-container-btn" onClick={() => setPublicRevealed((v) => !v)}>
                {publicRevealed ? '隐藏' : '显示'}
              </button>
            ) : null}
            <button
              className={`db-switch${detail.publicEnabled ? ' on' : ''}`}
              disabled={acting !== null}
              onClick={() =>
                runOperate('public', () =>
                  detail.publicEnabled
                    ? window.helios.disableDatabasePublic(name)
                    : window.helios.enableDatabasePublic(name)
                )
              }
            >
              <span className="db-switch-track" />
              {acting === 'public'
                ? detail.publicEnabled
                  ? '关闭中…'
                  : '开启中…'
                : detail.publicEnabled
                  ? '已开启'
                  : '未开启'}
            </button>
          </>
        }
      >
        {detail.publicEnabled ? (
          publicConn && (publicConn.host || publicConn.connectionString) ? (
            <ConnFields conn={publicConn} revealed={publicRevealed} />
          ) : (
            <EmptyNote text="公网地址尚未就绪" />
          )
        ) : (
          <EmptyNote text="关着只显示内网。打开后会出现公网地址。" />
        )}
      </Section>

      <Section title="被谁使用" count={detail.usedBy.length}>
        {detail.usedBy.length === 0 ? (
          <EmptyNote text="没有应用通过环境变量引用它" />
        ) : (
          <div className="comp-list">
            {detail.usedBy.map((app) => (
              <button
                key={`${app.kind}-${app.name}`}
                className="comp-row comp-clickable"
                onClick={() => onOpenApp(app.name, app.kind)}
              >
                <span className={statusDotClass(app.status)} />
                <span className="comp-name truncate" title={app.name}>
                  {app.name}
                </span>
                <span className="chip chip-mini">
                  {app.kind === 'Deployment' ? '无状态' : '有状态'}
                </span>
                {app.project && <span className="chip chip-mini chip-project">{app.project}</span>}
                <span className="comp-cell">{STATUS_LABEL[app.status]}</span>
                <span className="card-open-hint">›</span>
              </button>
            ))}
          </div>
        )}
      </Section>

      <Section
        title="结构"
        count={
          schema &&
          schema.supported &&
          schema.reason !== 'not-running' &&
          schema.reason !== 'fetch-failed'
            ? schemaVisibleTableCount(schema)
            : undefined
        }
      >
        {schemaLoading || !schema ? (
          <EmptyNote text="正在读取表结构…" />
        ) : schema.reason === 'not-running' ? (
          <EmptyNote text="库尚未就绪，就绪后再列出表结构。" />
        ) : !schema.supported || schema.reason === 'unsupported' ? (
          <div className="schema-unsupported">
            <EmptyNote text="此引擎不列出表结构" />
            <button
              className="daction daction-secondary"
              onClick={() => onAskHelios(askDraft(detail))}
            >
              问 Helios
            </button>
          </div>
        ) : schema.reason === 'fetch-failed' ? (
          <EmptyNote text="暂时无法列出表结构" />
        ) : schema.databases.length === 0 ? (
          <EmptyNote text="没有逻辑库。" />
        ) : (
          <SchemaCatalog tree={schema} />
        )}
      </Section>

      <Section title="Pods" count={detail.pods.length}>
        {detail.pods.length === 0 ? (
          <EmptyNote text={stopped ? '数据库已暂停，没有运行中的 Pod。' : '没有 Pod。'} />
        ) : (
          <div className="pod-list">
            {detail.pods.map((pod) => (
              <PodRow
                key={pod.name}
                pod={pod}
                expanded={expandedPod === pod.name}
                onToggle={() => togglePod(pod)}
                log={logs[pod.name]}
                onLoadLogs={(container, previous) => loadLogs(pod.name, container, previous)}
              />
            ))}
          </div>
        )}
      </Section>

      <Section title="事件" count={detail.events.length}>
        {warningEvents.length > 0 && (
          <div className="event-summary">最近有 {warningEvents.length} 条异常事件。</div>
        )}
        <EventList events={detail.events} />
      </Section>

      <div className="detail-foot hint">
        数据更新于 {new Date(detail.fetchedAt).toLocaleTimeString()} · 每 15 秒自动刷新
      </div>
    </div>
  )
}

export default DatabaseDetailView
