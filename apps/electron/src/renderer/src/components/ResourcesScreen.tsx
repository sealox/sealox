import { useCallback, useEffect, useState } from 'react'
import type {
  AppStatus,
  AppWorkload,
  DatabaseInfo,
  ResourceSnapshot,
  SealosStatus
} from '../../../shared/types'

interface Props {
  status: SealosStatus
  onLogout: () => Promise<void>
}

const REFRESH_INTERVAL_MS = 15_000

const STATUS_LABEL: Record<AppStatus, string> = {
  Running: '运行中',
  Progressing: '启动中',
  Stopped: '已暂停',
  Failed: '异常'
}

function statusClass(status: AppStatus): string {
  return `dot dot-${status.toLowerCase()}`
}

function dbPhaseClass(phase: string): string {
  if (phase === 'Running') return 'dot dot-running'
  if (['Failed', 'Abnormal'].includes(phase)) return 'dot dot-failed'
  return 'dot dot-progressing'
}

function AppCard({ app }: { app: AppWorkload }): React.JSX.Element {
  const failingPods = app.pods.filter((p) => p.reason)
  return (
    <div className="card">
      <div className="card-head">
        <span className={statusClass(app.status)} />
        <h3>{app.name}</h3>
        <span className="chip">{app.kind === 'Deployment' ? '无状态' : '有状态'}</span>
        {app.instance && <span className="chip chip-instance">{app.instance}</span>}
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
      {app.urls.length > 0 && (
        <div className="card-links">
          {app.urls.map((url) => (
            <a
              key={url}
              href="#open"
              onClick={(e) => {
                e.preventDefault()
                void window.helios.openExternal(url)
              }}
            >
              {url.replace('https://', '')} ↗
            </a>
          ))}
        </div>
      )}
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
        <span className={dbPhaseClass(db.phase)} />
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

function ResourcesScreen({ status, onLogout }: Props): React.JSX.Element {
  const [snapshot, setSnapshot] = useState<ResourceSnapshot | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      setSnapshot(await window.helios.getResources())
      setError('')
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    const initial = setTimeout(() => void refresh(), 0)
    const timer = setInterval(() => void refresh(), REFRESH_INTERVAL_MS)
    return () => {
      clearTimeout(initial)
      clearInterval(timer)
    }
  }, [refresh])

  const empty = snapshot && snapshot.apps.length === 0 && snapshot.databases.length === 0

  return (
    <div className="workspace">
      <header className="topbar">
        <div className="topbar-brand">
          <span className="topbar-sun" aria-hidden="true" />
          Helios
        </div>
        <div className="topbar-info">
          <span className="chip">{snapshot?.regionDomain ?? status.regionDomain}</span>
          <span className="chip">{snapshot?.namespace ?? status.namespace}</span>
        </div>
        <div className="topbar-actions">
          {snapshot && (
            <span className="hint">更新于 {new Date(snapshot.fetchedAt).toLocaleTimeString()}</span>
          )}
          <button className="btn btn-small" disabled={loading} onClick={() => void refresh()}>
            {loading ? '刷新中…' : '刷新'}
          </button>
          <button className="btn btn-small btn-ghost" onClick={() => void onLogout()}>
            退出登录
          </button>
        </div>
      </header>

      <main className="content">
        {error && <div className="error">{error}</div>}
        {snapshot?.warnings.map((w) => (
          <div key={w} className="warning">
            {w}
          </div>
        ))}

        {!snapshot && !error && <div className="placeholder">正在读取工作空间…</div>}

        {empty && (
          <div className="placeholder">
            <p>这个工作空间还是空的。</p>
            <p className="hint">下一版这里会有一个输入框：把项目丢进来，剩下的交给 agent。</p>
          </div>
        )}

        {snapshot && snapshot.apps.length > 0 && (
          <section>
            <h2>应用（{snapshot.apps.length}）</h2>
            <div className="grid">
              {snapshot.apps.map((app) => (
                <AppCard key={`${app.kind}-${app.name}`} app={app} />
              ))}
            </div>
          </section>
        )}

        {snapshot && snapshot.databases.length > 0 && (
          <section>
            <h2>数据库（{snapshot.databases.length}）</h2>
            <div className="grid">
              {snapshot.databases.map((db) => (
                <DatabaseCard key={db.name} db={db} />
              ))}
            </div>
          </section>
        )}

        {snapshot && snapshot.instances.length > 0 && (
          <section>
            <h2>模板实例（{snapshot.instances.length}）</h2>
            <div className="instance-list">
              {snapshot.instances.map((inst) => (
                <div key={inst.name} className="instance-row">
                  <span className="mono">{inst.name}</span>
                  {inst.template && <span className="chip">{inst.template}</span>}
                  {inst.createdAt && (
                    <span className="hint">{new Date(inst.createdAt).toLocaleString()}</span>
                  )}
                </div>
              ))}
            </div>
          </section>
        )}
      </main>
    </div>
  )
}

export default ResourcesScreen
