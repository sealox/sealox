import { useCallback, useEffect, useRef, useState } from 'react'
import type { EventInfo, MonitorSeries } from '../../../shared/types'
import { iconAttrs, timeAgo } from './detailUtils'

/* ── 点击复制 ──────────────────────────────────── */

export function CopyValue({
  text,
  display,
  mono = true,
  title
}: {
  text: string
  display?: string
  mono?: boolean
  title?: string
}): React.JSX.Element {
  const [copied, setCopied] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  useEffect(() => () => clearTimeout(timer.current), [])

  const copy = useCallback(() => {
    void window.helios.copyText(text)
    setCopied(true)
    clearTimeout(timer.current)
    timer.current = setTimeout(() => setCopied(false), 1200)
  }, [text])

  return (
    <button
      className={`copyable${mono ? ' mono' : ''}${copied ? ' copied' : ''}`}
      title={title ?? `点击复制：${text}`}
      onClick={copy}
    >
      <span className="copyable-text truncate">{display ?? text}</span>
      <span className="copyable-hint">{copied ? '已复制' : '复制'}</span>
    </button>
  )
}

/* ── 顶部统计条 ────────────────────────────────── */

export interface StatItem {
  label: string
  value: React.ReactNode
  sub?: React.ReactNode
}

export function StatStrip({ items }: { items: StatItem[] }): React.JSX.Element {
  return (
    <div className="stat-strip">
      {items.map((item) => (
        <div key={item.label} className="stat-cell">
          <div className="stat-label">{item.label}</div>
          <div className="stat-value">{item.value}</div>
          {item.sub && <div className="stat-sub">{item.sub}</div>}
        </div>
      ))}
    </div>
  )
}

/* ── 详情分区 ──────────────────────────────────── */

export function Section({
  title,
  count,
  actions,
  children
}: {
  title: string
  count?: number
  actions?: React.ReactNode
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <section className="dsection">
      <div className="dsection-head">
        <h2 className="dsection-title">
          {title}
          {count !== undefined && <span className="dsection-count">{count}</span>}
        </h2>
        {actions && <div className="dsection-actions">{actions}</div>}
      </div>
      {children}
    </section>
  )
}

export function EmptyNote({ text }: { text: string }): React.JSX.Element {
  return <div className="dempty">{text}</div>
}

/* ── 事件列表 ──────────────────────────────────── */

export function EventList({
  events,
  showObject = true
}: {
  events: EventInfo[]
  showObject?: boolean
}): React.JSX.Element {
  if (events.length === 0) return <EmptyNote text="最近没有事件。" />
  return (
    <div className="event-list">
      {events.map((event, i) => (
        <div key={`${event.object}-${event.reason}-${i}`} className="event-row">
          <span
            className={`event-line ${event.type === 'Warning' ? 'event-warning' : 'event-normal'}`}
          />
          <div className="event-main">
            <div className="event-head">
              <span className="event-reason">{event.reason}</span>
              {showObject && event.object && <span className="event-object">{event.object}</span>}
              <span className="event-time">
                {timeAgo(event.lastAt)}
                {event.count > 1 ? ` · ${event.count} 次` : ''}
              </span>
            </div>
            <div className="event-message">{event.message}</div>
          </div>
        </div>
      ))}
    </div>
  )
}

/* ── 监控 sparkline（纯 SVG，无图表库）───────────── */

const SPARK_W = 300
const SPARK_H = 72

function buildPath(points: Array<[number, number]>, t0: number, t1: number, yMax: number): string {
  if (points.length === 0) return ''
  const span = Math.max(t1 - t0, 1)
  return points
    .map(([t, v], i) => {
      const x = ((t - t0) / span) * SPARK_W
      const y = SPARK_H - (Math.min(v, yMax) / yMax) * (SPARK_H - 4) - 2
      return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`
    })
    .join(' ')
}

export function SparkCard({
  title,
  series,
  color,
  unit = '%',
  headValue,
  footNote,
  yScale
}: {
  title: string
  series: MonitorSeries[]
  color: string
  unit?: string
  /** 右上角数值；缺省为各序列最新值的均值 */
  headValue?: string
  /** 右下角说明；缺省为多 Pod 提示 */
  footNote?: string
  /** y 轴刻度取整步长；缺省 20（百分比场景） */
  yScale?: number
}): React.JSX.Element {
  const allPoints = series.flatMap((s) => s.points)
  const hasData = allPoints.length > 0
  const t0 = hasData ? Math.min(...allPoints.map((p) => p[0])) : 0
  const t1 = hasData ? Math.max(...allPoints.map((p) => p[0])) : 1
  const dataMax = hasData ? Math.max(...allPoints.map((p) => p[1])) : 0
  const step = yScale ?? 20
  const yMax = Math.max(Math.ceil(dataMax / step) * step, step)

  const latest = series
    .map((s) => s.points[s.points.length - 1]?.[1])
    .filter((v): v is number => v !== undefined)
  const current = latest.length > 0 ? latest.reduce((a, b) => a + b, 0) / latest.length : null

  const gradientId = `spark-${title.replace(/[^a-zA-Z]/g, '')}`

  return (
    <div className="spark-card">
      <div className="spark-head">
        <span className="spark-title">{title}</span>
        <span className="spark-value" style={{ color }}>
          {headValue ?? (current !== null ? `${current.toFixed(1)}${unit}` : '—')}
        </span>
      </div>
      <div className="spark-body">
        {hasData ? (
          <svg
            viewBox={`0 0 ${SPARK_W} ${SPARK_H}`}
            preserveAspectRatio="none"
            className="spark-svg"
          >
            <defs>
              <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={color} stopOpacity="0.22" />
                <stop offset="100%" stopColor={color} stopOpacity="0.02" />
              </linearGradient>
            </defs>
            {[0.25, 0.5, 0.75].map((frac) => (
              <line
                key={frac}
                x1="0"
                x2={SPARK_W}
                y1={SPARK_H * frac}
                y2={SPARK_H * frac}
                className="spark-gridline"
              />
            ))}
            {series.length === 1 && (
              <path
                d={`${buildPath(series[0].points, t0, t1, yMax)} L${SPARK_W},${SPARK_H} L0,${SPARK_H} Z`}
                fill={`url(#${gradientId})`}
                stroke="none"
              />
            )}
            {series.map((s, i) => (
              <path
                key={s.name || i}
                d={buildPath(s.points, t0, t1, yMax)}
                fill="none"
                stroke={color}
                strokeWidth="1.6"
                strokeLinejoin="round"
                strokeLinecap="round"
                opacity={series.length > 1 ? 0.45 + 0.55 / (i + 1) : 1}
              />
            ))}
          </svg>
        ) : (
          <div className="spark-empty">暂无数据</div>
        )}
        <div className="spark-scale">
          <span>
            {yMax}
            {unit}
          </span>
          <span>0</span>
        </div>
      </div>
      <div className="spark-foot">
        <span>{footNote ?? '近 1 小时'}</span>
        {footNote === undefined && series.length > 1 && (
          <span>{series.length} 个 Pod · 右上为均值</span>
        )}
      </div>
    </div>
  )
}

/* ── 小图标 ────────────────────────────────────── */

export function BackIcon({ size }: { size?: number }): React.JSX.Element {
  return (
    <svg {...iconAttrs(size)}>
      <path d="M15 5l-7 7 7 7" />
    </svg>
  )
}

export function OpenIcon({ size }: { size?: number }): React.JSX.Element {
  return (
    <svg {...iconAttrs(size)}>
      <path d="M14 4h6v6M20 4l-9 9M11 5H6a2 2 0 0 0-2 2v11a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2v-5" />
    </svg>
  )
}

export function RefreshIcon({ size }: { size?: number }): React.JSX.Element {
  return (
    <svg {...iconAttrs(size)}>
      <path d="M20 12a8 8 0 1 1-2.34-5.66" />
      <path d="M20 4v4.5h-4.5" />
    </svg>
  )
}

export function ChevronRightIcon({ size }: { size?: number }): React.JSX.Element {
  return (
    <svg {...iconAttrs(size)}>
      <path d="m9.5 6.5 5.5 5.5-5.5 5.5" />
    </svg>
  )
}

export function GithubIcon({ size }: { size?: number }): React.JSX.Element {
  return (
    <svg width={size ?? 16} height={size ?? 16} viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 1.27a11 11 0 0 0-3.48 21.46c.55.09.73-.28.73-.55v-1.84c-3.03.64-3.67-1.46-3.67-1.46-.55-1.29-1.28-1.65-1.28-1.65-.92-.65.1-.65.1-.65 1.1 0 1.73 1.1 1.73 1.1.92 1.65 2.57 1.2 3.21.92a2 2 0 0 1 .64-1.47c-2.47-.27-5.04-1.19-5.04-5.5 0-1.1.46-2.1 1.2-2.84a3.76 3.76 0 0 1 0-2.93s.91-.28 3.11 1.1c1.8-.49 3.7-.49 5.5 0 2.1-1.38 3.02-1.1 3.02-1.1a3.76 3.76 0 0 1 .1 2.84 4.1 4.1 0 0 1 1.19 2.93c0 4.21-2.57 5.13-5.04 5.4.45.37.82.92.82 2.02v3.03c0 .27.1.64.73.55A11 11 0 0 0 12 1.27" />
    </svg>
  )
}

export function GlobeIcon({ size }: { size?: number }): React.JSX.Element {
  return (
    <svg {...iconAttrs(size)}>
      <circle cx="12" cy="12" r="8" />
      <path d="M4 12h16M12 4c2.8 2.7 2.8 13.3 0 16-2.8-2.7-2.8-13.3 0-16Z" />
    </svg>
  )
}
