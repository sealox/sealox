import { useCallback, useEffect, useMemo, useState } from 'react'
import type { AppDetail, AppMonitor, PodDetail } from '../../../shared/types'
import {
  BackIcon,
  CopyValue,
  EmptyNote,
  EventList,
  OpenIcon,
  RefreshIcon,
  Section,
  SparkCard,
  StatStrip
} from './detailParts'
import { STATUS_LABEL, formatCpu, openUrl, statusDotClass, timeAgo } from './detailUtils'

const DETAIL_REFRESH_MS = 15_000
const MONITOR_REFRESH_MS = 60_000

export interface Crumb {
  label: string
  onClick?: () => void
}

interface Props {
  name: string
  kind: 'Deployment' | 'StatefulSet'
  crumbs: Crumb[]
  onOpenProject?: (project: string) => void
}

interface LogState {
  loading: boolean
  error?: string
  text?: string
  container?: string
  previous: boolean
}

function PodRow({
  pod,
  expanded,
  onToggle,
  log,
  onLoadLogs
}: {
  pod: PodDetail
  expanded: boolean
  onToggle: () => void
  log: LogState | undefined
  onLoadLogs: (container: string | undefined, previous: boolean) => void
}): React.JSX.Element {
  const ready = pod.containers.filter((c) => c.state === 'running').length
  const activeContainer = log?.container ?? pod.containers[0]?.name

  return (
    <div className={`pod-item${expanded ? ' open' : ''}`}>
      <button className="pod-row" onClick={onToggle}>
        <span className={statusDotClass(pod.reason ? 'Failed' : phaseToStatus(pod.phase))} />
        <span className="pod-name mono truncate" title={pod.name}>
          {pod.name}
        </span>
        {pod.reason && <span className="pod-reason">{pod.reason}</span>}
        <span className="pod-cell">
          {ready}/{pod.containers.length} 就绪
        </span>
        <span className="pod-cell">重启 {pod.restarts}</span>
        <span className="pod-cell">{timeAgo(pod.createdAt)}</span>
        <span className={`pod-chevron${expanded ? ' open' : ''}`}>›</span>
      </button>

      {expanded && (
        <div className="pod-detail">
          <div className="pod-facts">
            {pod.ip && (
              <span className="pod-fact">
                IP <span className="mono">{pod.ip}</span>
              </span>
            )}
            {pod.node && (
              <span className="pod-fact">
                节点 <span className="mono">{pod.node}</span>
              </span>
            )}
            <span className="pod-fact">状态 {pod.phase}</span>
            {pod.message && <span className="pod-fact pod-fact-bad">{pod.message}</span>}
          </div>

          <div className="pod-containers">
            {pod.containers.map((container) => (
              <span
                key={container.name}
                className={`container-chip container-${container.state}`}
                title={`${container.image}${container.reason ? ` · ${container.reason}` : ''}`}
              >
                <span className="container-dot" />
                {container.name}
                {container.cpuLimit && (
                  <span className="container-limit">
                    {container.cpuLimit} / {container.memoryLimit}
                  </span>
                )}
                {container.reason && <span className="container-reason">{container.reason}</span>}
              </span>
            ))}
          </div>

          <div className="log-toolbar">
            <span className="log-title">日志</span>
            {pod.containers.length > 1 &&
              pod.containers.map((container) => (
                <button
                  key={container.name}
                  className={`log-container-btn${
                    activeContainer === container.name ? ' active' : ''
                  }`}
                  onClick={() => onLoadLogs(container.name, log?.previous ?? false)}
                >
                  {container.name}
                </button>
              ))}
            <span className="log-spacer" />
            {pod.restarts > 0 && (
              <button
                className={`log-container-btn${log?.previous ? ' active' : ''}`}
                title="查看重启前（上一个容器实例）的日志"
                onClick={() => onLoadLogs(activeContainer, !(log?.previous ?? false))}
              >
                崩溃前日志
              </button>
            )}
            {log?.text !== undefined && (
              <button
                className="log-container-btn"
                onClick={() => void window.helios.copyText(log.text ?? '')}
              >
                复制全部
              </button>
            )}
            <button
              className="log-container-btn"
              disabled={log?.loading}
              onClick={() => onLoadLogs(activeContainer, log?.previous ?? false)}
            >
              {log?.loading ? '读取中…' : '刷新'}
            </button>
          </div>
          {log?.error && <div className="log-error">{log.error}</div>}
          {log?.text !== undefined && !log.error && (
            <pre className="log-box">{log.text || '（日志为空）'}</pre>
          )}
        </div>
      )}
    </div>
  )
}

function phaseToStatus(phase: string): 'Running' | 'Progressing' | 'Failed' | 'Stopped' {
  if (phase === 'Running') return 'Running'
  if (phase === 'Failed') return 'Failed'
  if (phase === 'Succeeded') return 'Stopped'
  return 'Progressing'
}

function AppDetailView({ name, kind, crumbs, onOpenProject }: Props): React.JSX.Element {
  const [detail, setDetail] = useState<AppDetail | null>(null)
  const [error, setError] = useState('')
  const [monitor, setMonitor] = useState<AppMonitor | null>(null)
  const [expandedPod, setExpandedPod] = useState<string | null>(null)
  const [logs, setLogs] = useState<Record<string, LogState>>({})
  const [refreshing, setRefreshing] = useState(false)

  const refresh = useCallback(() => {
    setRefreshing(true)
    window.helios
      .getAppDetail(name, kind)
      .then((data) => {
        setDetail(data)
        setError('')
      })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setRefreshing(false))
  }, [name, kind])

  useEffect(() => {
    const initial = setTimeout(refresh, 0)
    const timer = setInterval(refresh, DETAIL_REFRESH_MS)
    return () => {
      clearTimeout(initial)
      clearInterval(timer)
    }
  }, [refresh])

  useEffect(() => {
    let cancelled = false
    const load = (): void => {
      window.helios
        .getAppMonitor(name)
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

  const publicUrls = useMemo(
    () => [...new Set((detail?.networks ?? []).map((n) => n.publicUrl).filter(Boolean))],
    [detail]
  ) as string[]

  // 监控服务会返回 TSDB 里已销毁 Pod 的历史序列，只保留当前存活的
  const liveMonitor = useMemo(() => {
    if (!monitor?.available || !detail) return monitor
    const livePods = new Set(detail.pods.map((pod) => pod.name))
    const filterSeries = (list: typeof monitor.cpu): typeof monitor.cpu => {
      const alive = list.filter((series) => livePods.has(series.name))
      return alive.length > 0 ? alive : list
    }
    return { ...monitor, cpu: filterSeries(monitor.cpu), memory: filterSeries(monitor.memory) }
  }, [monitor, detail])

  const storeTotal = useMemo(() => {
    const sizes = (detail?.stores ?? []).map((s) => s.size).filter(Boolean)
    return sizes.length > 0 ? sizes.join(' + ') : null
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
        <div className="placeholder">正在读取应用详情…</div>
      </div>
    )
  }

  const warningEvents = detail.events.filter((e) => e.type === 'Warning')

  return (
    <div className="detail">
      <DetailCrumbs crumbs={crumbs} />

      <header className="detail-title-row">
        <span className={statusDotClass(detail.status)} />
        <h1 className="detail-title">{detail.name}</h1>
        <span className="chip">{detail.kind === 'Deployment' ? '无状态' : '有状态'}</span>
        {detail.project && (
          <button
            className="chip chip-project chip-link"
            title={`打开项目 ${detail.project}`}
            onClick={() => onOpenProject?.(detail.project as string)}
          >
            {detail.project}
          </button>
        )}
        {!detail.launchpad && <span className="chip">Launchpad 之外</span>}
        <span className="detail-actions">
          {publicUrls[0] && (
            <button className="daction" onClick={() => openUrl(publicUrls[0])}>
              <OpenIcon size={14} />
              打开站点
            </button>
          )}
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

      {error && <div className="error">{error}</div>}

      <StatStrip
        items={[
          {
            label: '状态',
            value: (
              <span className={`stat-status stat-${detail.status.toLowerCase()}`}>
                {STATUS_LABEL[detail.status]}
              </span>
            ),
            sub: detail.paused ? '已被暂停' : undefined
          },
          {
            label: '副本',
            value: `${detail.readyReplicas}/${detail.replicas}`,
            sub: detail.hpa
              ? `弹性 ${detail.hpa.minReplicas}~${detail.hpa.maxReplicas}（${detail.hpa.target.toUpperCase()} ${detail.hpa.targetValue}%）`
              : '固定副本'
          },
          { label: 'CPU 限额', value: formatCpu(detail.cpuLimit) ?? '—' },
          {
            label: '内存限额',
            value: detail.memoryLimit ?? '—',
            sub: detail.gpu ? `GPU × ${detail.gpu}` : undefined
          },
          { label: '持久存储', value: storeTotal ?? '无' },
          { label: '创建于', value: timeAgo(detail.createdAt) }
        ]}
      />

      {liveMonitor?.available ? (
        <div className="spark-grid">
          <SparkCard title="CPU 使用率" series={liveMonitor.cpu} color="#2563eb" />
          <SparkCard title="内存使用率" series={liveMonitor.memory} color="#059669" />
        </div>
      ) : (
        liveMonitor && <div className="monitor-note">监控数据不可用：{liveMonitor.reason}</div>
      )}

      <Section title="网络" count={detail.networks.length}>
        {detail.networks.length === 0 ? (
          <EmptyNote text="没有对外暴露的端口。" />
        ) : (
          <div className="net-table">
            {detail.networks.map((net, i) => (
              <div key={`${net.clusterAddress}-${net.publicUrl}-${i}`} className="net-row">
                <span className="net-port">
                  {net.port > 0 ? net.port : '—'}
                  <span className="net-proto">{net.appProtocol ?? net.protocol}</span>
                </span>
                <span className="net-cluster">
                  {net.clusterAddress ? (
                    <CopyValue text={net.clusterAddress} />
                  ) : (
                    <span className="hint">—</span>
                  )}
                </span>
                <span className="net-public">
                  {net.publicUrl ? (
                    <>
                      <a
                        href="#open"
                        className="net-link truncate"
                        title={net.publicUrl}
                        onClick={(e) => {
                          e.preventDefault()
                          openUrl(net.publicUrl as string)
                        }}
                      >
                        {(net.publicUrl as string).replace('https://', '')} ↗
                      </a>
                      {net.customDomain && <span className="chip chip-mini">自定义域名</span>}
                    </>
                  ) : net.nodePort ? (
                    <span className="hint">NodePort {net.nodePort}</span>
                  ) : (
                    <span className="hint">未开公网</span>
                  )}
                </span>
              </div>
            ))}
          </div>
        )}
      </Section>

      <Section title="Pods" count={detail.pods.length}>
        {detail.pods.length === 0 ? (
          <EmptyNote text={detail.paused ? '应用已暂停，没有运行中的 Pod。' : '没有 Pod。'} />
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

      <Section title="配置">
        <div className="conf-grid">
          <div className="conf-block">
            <div className="conf-block-title">镜像与启动</div>
            <div className="kv-list">
              <div className="kv-row">
                <span className="kv-key">镜像{detail.privateImage ? '（私有仓库）' : ''}</span>
                <span className="kv-value">
                  <CopyValue text={detail.image} />
                </span>
              </div>
              <div className="kv-row">
                <span className="kv-key">启动命令</span>
                <span className="kv-value">
                  {detail.command ? (
                    <CopyValue text={detail.command} />
                  ) : (
                    <span className="hint">镜像默认</span>
                  )}
                </span>
              </div>
              <div className="kv-row">
                <span className="kv-key">命令参数</span>
                <span className="kv-value">
                  {detail.args ? (
                    <CopyValue text={detail.args} />
                  ) : (
                    <span className="hint">镜像默认</span>
                  )}
                </span>
              </div>
            </div>
          </div>

          <div className="conf-block">
            <div className="conf-block-title">挂载</div>
            {detail.configMaps.length === 0 && detail.stores.length === 0 ? (
              <EmptyNote text="没有配置文件或持久卷。" />
            ) : (
              <div className="kv-list">
                {detail.stores.map((store) => (
                  <div key={`${store.name}-${store.path}`} className="kv-row">
                    <span className="kv-key">持久卷{store.size ? ` ${store.size}` : ''}</span>
                    <span className="kv-value mono truncate" title={store.path || store.name}>
                      {store.path || store.name}
                    </span>
                  </div>
                ))}
                {detail.configMaps.map((cm) => (
                  <div key={cm.mountPath} className="kv-row">
                    <span className="kv-key">配置文件</span>
                    <span className="kv-value">
                      <CopyValue
                        text={cm.value}
                        display={cm.mountPath}
                        title={`点击复制文件内容（${cm.value.length} 字符）`}
                      />
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="conf-block conf-envs">
          <div className="conf-block-title">环境变量（{detail.envs.length}）</div>
          {detail.envs.length === 0 ? (
            <EmptyNote text="没有环境变量。" />
          ) : (
            <div className="env-table">
              {detail.envs.map((env) => (
                <div key={env.key} className="env-row">
                  <span className="env-key mono truncate" title={env.key}>
                    {env.key}
                  </span>
                  <span className="env-value">
                    {env.value !== undefined && env.value !== '' ? (
                      <CopyValue text={env.value} />
                    ) : env.from ? (
                      <span className="env-from mono truncate" title={env.from}>
                        ← {env.from}
                      </span>
                    ) : (
                      <span className="hint">空</span>
                    )}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
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

export function DetailCrumbs({ crumbs }: { crumbs: Crumb[] }): React.JSX.Element {
  const parent = [...crumbs].reverse().find((crumb) => crumb.onClick)
  return (
    <nav className="detail-crumbs">
      {parent && (
        <button className="crumb-back" title={`返回${parent.label}`} onClick={parent.onClick}>
          <BackIcon size={15} />
        </button>
      )}
      {crumbs.map((crumb, i) => (
        <span key={`${crumb.label}-${i}`} className="crumb-group">
          {i > 0 && <span className="crumb-sep">/</span>}
          {crumb.onClick ? (
            <button className="crumb crumb-link" onClick={crumb.onClick}>
              {crumb.label}
            </button>
          ) : (
            <span className="crumb crumb-current">{crumb.label}</span>
          )}
        </span>
      ))}
    </nav>
  )
}

export default AppDetailView
