import { useEffect, useMemo, useState } from 'react'
import type { TemplateCatalog, TemplateInfo } from '../../../shared/types'

const PAGE_SIZE = 12
const ALL_CATEGORY = '全部'
/** 与官网一致的分类展示顺序，未列出的排后面 */
const PREFERRED_ORDER = [
  'AI',
  'Low-Code',
  'Tools',
  'Database',
  'Monitoring',
  'Blog',
  'DevOps',
  'Storage'
]

type SortKey = 'deploys' | 'name'

function openUrl(url: string): void {
  void window.helios.openExternal(url)
}

function pageItems(current: number, total: number): number[] {
  if (total <= 5) return Array.from({ length: total }, (_, i) => i + 1)
  const pages = new Set([1, total, current])
  if (current > 1) pages.add(current - 1)
  if (current < total) pages.add(current + 1)
  return [...pages].sort((a, b) => a - b)
}

function TemplateIcon({ tpl, size }: { tpl: TemplateInfo; size: number }): React.JSX.Element {
  const [failed, setFailed] = useState(false)
  if (!tpl.icon || failed) {
    return (
      <span
        className="tpl-icon-fallback"
        style={{ width: size, height: size, fontSize: Math.round(size * 0.45) }}
      >
        {tpl.name.charAt(0).toUpperCase()}
      </span>
    )
  }
  return (
    <img
      src={tpl.icon}
      alt=""
      width={size}
      height={size}
      loading="lazy"
      onError={() => setFailed(true)}
    />
  )
}

function TemplateCard({ tpl }: { tpl: TemplateInfo }): React.JSX.Element {
  const [shotFailed, setShotFailed] = useState(false)

  return (
    <article className="tpl-card">
      <div className="tpl-shot">
        {tpl.screenshot && !shotFailed ? (
          <img src={tpl.screenshot} alt="" loading="lazy" onError={() => setShotFailed(true)} />
        ) : (
          <div className="tpl-shot-fallback">
            <TemplateIcon tpl={tpl} size={44} />
          </div>
        )}
      </div>
      <div className="tpl-body">
        <div className="tpl-head">
          <span className="tpl-icon">
            <TemplateIcon tpl={tpl} size={28} />
          </span>
          <a
            className="tpl-name"
            href="#detail"
            title="在 sealos.io 查看详情"
            onClick={(e) => {
              e.preventDefault()
              openUrl(tpl.detailUrl)
            }}
          >
            {tpl.name}
          </a>
          <span className="chip">{tpl.category}</span>
        </div>
        <p className="tpl-desc">{tpl.description}</p>
        <button
          className="tpl-deploy"
          title="在 Sealos 控制台部署此模板"
          onClick={() => openUrl(tpl.deployUrl)}
        >
          部署
        </button>
      </div>
    </article>
  )
}

function TemplatesTab(): React.JSX.Element {
  const [catalog, setCatalog] = useState<TemplateCatalog | null>(null)
  const [error, setError] = useState('')
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState(ALL_CATEGORY)
  const [sort, setSort] = useState<SortKey>('deploys')
  const [page, setPage] = useState(1)

  const load = (): void => {
    setError('')
    window.helios.getTemplates().then(setCatalog, (err: unknown) => {
      setError(err instanceof Error ? err.message : String(err))
    })
  }

  useEffect(() => {
    const timer = setTimeout(load, 0)
    return () => clearTimeout(timer)
  }, [])

  const templates = useMemo(() => catalog?.templates ?? [], [catalog])

  const categoryCounts = useMemo(() => {
    const counts = new Map<string, number>()
    for (const tpl of templates) {
      counts.set(tpl.category, (counts.get(tpl.category) ?? 0) + 1)
    }
    return counts
  }, [templates])

  const categories = useMemo(() => {
    const known = PREFERRED_ORDER.filter((c) => categoryCounts.has(c))
    const rest = [...categoryCounts.keys()]
      .filter((c) => !PREFERRED_ORDER.includes(c))
      .sort((a, b) => a.localeCompare(b))
    return [ALL_CATEGORY, ...known, ...rest]
  }, [categoryCounts])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    let list = templates
    if (category !== ALL_CATEGORY) list = list.filter((t) => t.category === category)
    if (q) {
      list = list.filter(
        (t) =>
          t.name.toLowerCase().includes(q) ||
          t.description.toLowerCase().includes(q) ||
          t.tags.some((tag) => tag.toLowerCase().includes(q))
      )
    }
    return [...list].sort((a, b) =>
      sort === 'deploys'
        ? (b.deployCount ?? 0) - (a.deployCount ?? 0) || a.name.localeCompare(b.name)
        : a.name.localeCompare(b.name)
    )
  }, [templates, category, query, sort])

  // 过滤条件变化时把页码重置到第 1 页（渲染期守卫，替代 effect）
  const filterKey = `${query}\u0000${category}\u0000${sort}`
  const [prevFilterKey, setPrevFilterKey] = useState(filterKey)
  if (prevFilterKey !== filterKey) {
    setPrevFilterKey(filterKey)
    setPage(1)
  }

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const currentPage = Math.min(page, totalPages)
  const visible = filtered.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE)

  if (error) {
    return (
      <>
        <div className="error">{error}</div>
        <button className="btn-neutral" onClick={load}>
          重试
        </button>
      </>
    )
  }

  if (!catalog) {
    return <div className="placeholder">正在拉取模板目录…</div>
  }

  return (
    <>
      <div className="tpl-toolbar">
        <input
          className="tpl-search"
          type="search"
          placeholder="搜索模板…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <select
          className="tpl-sort"
          value={sort}
          title="排序"
          onChange={(e) => setSort(e.target.value as SortKey)}
        >
          <option value="deploys">最多部署</option>
          <option value="name">名称 A–Z</option>
        </select>
      </div>

      <div className="tpl-cats">
        {categories.map((c) => (
          <button
            key={c}
            className={`tpl-cat${c === category ? ' active' : ''}`}
            onClick={() => setCategory(c)}
          >
            {c}
            <span className="tpl-cat-count">
              {c === ALL_CATEGORY ? templates.length : (categoryCounts.get(c) ?? 0)}
            </span>
          </button>
        ))}
      </div>

      <div className="tpl-meta hint">
        {filtered.length} 个模板 · 数据来自 sealos.io 应用商店
        {query && (
          <button className="tpl-clear" onClick={() => setQuery('')}>
            清除搜索
          </button>
        )}
      </div>

      {visible.length === 0 ? (
        <div className="placeholder">
          <p>没有匹配的模板。</p>
        </div>
      ) : (
        <div className="tpl-grid">
          {visible.map((tpl) => (
            <TemplateCard key={tpl.slug} tpl={tpl} />
          ))}
        </div>
      )}

      {totalPages > 1 && (
        <nav className="tpl-pager">
          <button
            className="tpl-page-btn"
            disabled={currentPage === 1}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
          >
            上一页
          </button>
          {pageItems(currentPage, totalPages).map((n, i, arr) => (
            <span key={n} className="tpl-page-group">
              {i > 0 && n - arr[i - 1] > 1 && <span className="tpl-page-gap">…</span>}
              <button
                className={`tpl-page-num${n === currentPage ? ' active' : ''}`}
                onClick={() => setPage(n)}
              >
                {n}
              </button>
            </span>
          ))}
          <button
            className="tpl-page-btn"
            disabled={currentPage === totalPages}
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
          >
            下一页
          </button>
        </nav>
      )}
    </>
  )
}

export default TemplatesTab
