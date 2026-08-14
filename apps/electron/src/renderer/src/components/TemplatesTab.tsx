import { useEffect, useMemo, useState } from 'react'
import type {
  TemplateArgDef,
  TemplateCatalog,
  TemplateDetail,
  TemplateInfo
} from '../../../shared/types'

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

interface Props {
  workspaceName: string
  onDeployed: (instanceName: string) => void
}

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

function requiredArgEntries(args: Record<string, TemplateArgDef>): Array<[string, TemplateArgDef]> {
  return Object.entries(args).filter(([, def]) => def.required && !def.default.trim())
}

function isSecretArg(name: string, type: string): boolean {
  if (type.toLowerCase() === 'password') return true
  return /key|secret|token|password/i.test(name)
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

function isMissingArgsMessage(msg: string): boolean {
  return msg.includes('缺少必填参数')
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

function TemplateCard({
  tpl,
  workspaceName,
  onDeployed
}: {
  tpl: TemplateInfo
  workspaceName: string
  onDeployed: (instanceName: string) => void
}): React.JSX.Element {
  const [shotFailed, setShotFailed] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [detail, setDetail] = useState<TemplateDetail | null>(null)
  const [showArgs, setShowArgs] = useState(false)
  const [values, setValues] = useState<Record<string, string>>({})

  const argFields = detail ? requiredArgEntries(detail.args) : []
  const argsFilled =
    argFields.length > 0 && argFields.every(([key]) => Boolean(values[key]?.trim()))

  const handleDeploy = async (): Promise<void> => {
    if (submitting) return
    setError('')
    setSubmitting(true)
    try {
      let current = detail
      if (!current) {
        current = await window.helios.getTemplateDetail(tpl.templateName)
        setDetail(current)
      }
      const fields = requiredArgEntries(current.args)
      if (fields.length > 0) {
        const missing = fields.filter(([key]) => !values[key]?.trim())
        if (missing.length > 0) {
          setShowArgs(true)
          return
        }
      }
      const args: Record<string, string> = {}
      for (const [key] of fields) {
        const value = values[key]?.trim()
        if (value) args[key] = value
      }
      const { instanceName } = await window.helios.deployTemplate(tpl.templateName, args)
      onDeployed(instanceName)
    } catch (err) {
      const msg = errorMessage(err)
      setError(msg)
      if (isMissingArgsMessage(msg)) {
        setShowArgs(true)
        if (!detail) {
          try {
            const next = await window.helios.getTemplateDetail(tpl.templateName)
            setDetail(next)
          } catch {
            // 卡片上已有缺参文案
          }
        }
      }
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <article className={`tpl-card${showArgs || submitting ? ' is-open' : ''}`}>
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
        <form
          className="tpl-deploy-form"
          onSubmit={(e) => {
            e.preventDefault()
            void handleDeploy()
          }}
        >
          {showArgs && argFields.length > 0 && (
            <div className="tpl-args">
              {argFields.map(([key, def]) => (
                <label key={key} className="tpl-arg">
                  <span>{def.description || key}</span>
                  <input
                    className="tpl-arg-input"
                    type={isSecretArg(key, def.type) ? 'password' : 'text'}
                    name={key}
                    value={values[key] ?? ''}
                    required
                    autoComplete="off"
                    disabled={submitting}
                    onChange={(e) => setValues((prev) => ({ ...prev, [key]: e.target.value }))}
                  />
                </label>
              ))}
            </div>
          )}
          {error && <div className="tpl-card-error">{error}</div>}
          <button className="tpl-deploy" type="submit" disabled={submitting}>
            {submitting ? '提交中' : argsFilled ? `部署到 ${workspaceName}` : '部署'}
          </button>
        </form>
      </div>
    </article>
  )
}

function TemplatesTab({ workspaceName, onDeployed }: Props): React.JSX.Element {
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
            <TemplateCard
              key={tpl.slug}
              tpl={tpl}
              workspaceName={workspaceName}
              onDeployed={onDeployed}
            />
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
