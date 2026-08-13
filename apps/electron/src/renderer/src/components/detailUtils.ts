import type { AppStatus } from '../../../shared/types'

export const STATUS_LABEL: Record<AppStatus, string> = {
  Running: '运行中',
  Progressing: '启动中',
  Stopped: '已暂停',
  Failed: '异常'
}

export function statusDotClass(status: AppStatus | null): string {
  return status ? `dot dot-${status.toLowerCase()}` : 'dot dot-stopped'
}

export function dbPhaseToStatus(phase: string): AppStatus {
  if (phase === 'Running') return 'Running'
  if (phase === 'Failed' || phase === 'Abnormal') return 'Failed'
  if (phase === 'Stopped') return 'Stopped'
  return 'Progressing'
}

/** ISO 时间 → 「x 分钟前」；超过 30 天回退到日期 */
export function timeAgo(iso?: string): string {
  if (!iso) return '—'
  const ms = Date.now() - new Date(iso).getTime()
  if (Number.isNaN(ms)) return '—'
  const minutes = Math.floor(ms / 60_000)
  if (minutes < 1) return '刚刚'
  if (minutes < 60) return `${minutes} 分钟前`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} 小时前`
  const days = Math.floor(hours / 24)
  if (days <= 30) return `${days} 天前`
  return new Date(iso).toLocaleDateString()
}

export function openUrl(url: string): void {
  void window.helios.openExternal(url)
}

/** k8s CPU quantity（500m / 1 / 2）→ 与配额卡同单位的 vCPU 表示 */
export function formatCpu(quantity?: string): string | undefined {
  if (!quantity) return undefined
  const m = quantity.match(/^([0-9]*\.?[0-9]+)m$/)
  const value = m ? Number(m[1]) / 1000 : Number(quantity)
  if (Number.isNaN(value)) return quantity
  return `${Math.round(value * 100) / 100} vCPU`
}

export function iconAttrs(size = 16): React.SVGProps<SVGSVGElement> {
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
