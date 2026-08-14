import { useCallback, useEffect, useMemo, useState } from 'react'
import type { AiKeyInfo, AiProxyOverview } from '../../../shared/types'
import { CopyValue, EmptyNote, Section, SparkCard, StatStrip } from './detailParts'
import { timeAgo } from './detailUtils'

const REFRESH_MS = 30_000

/** relay mode → 展示标签（aiproxy core/relay/mode/define.go） */
const MODE_LABEL: Record<number, string> = {
  1: '聊天',
  2: '补全',
  3: '嵌入',
  4: '审核',
  5: '图像生成',
  6: '图像编辑',
  7: '语音合成',
  8: '语音转录',
  9: '音频翻译',
  10: '重排序',
  11: 'PDF 解析',
  12: 'Anthropic'
}

const CURRENCY_SYMBOL: Record<string, string> = {
  usd: '$',
  cny: '¥',
  shellCoin: ''
}

function formatAmount(value: number, currency: string): string {
  const symbol = CURRENCY_SYMBOL[currency] ?? ''
  if (value === 0) return `${symbol}0`
  if (value < 0.0001) return `${symbol}<0.0001`
  const text = value >= 100 ? value.toFixed(2) : value.toPrecision(4)
  return `${symbol}${Number(text)}`
}

function formatTokens(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(value >= 10_000_000 ? 0 : 1)}M`
  if (value >= 1_000) return `${(value / 1_000).toFixed(value >= 10_000 ? 0 : 1)}K`
  return String(value)
}

/** /1K tokens 原始价 → /1M tokens 展示价 */
function pricePerMillion(price: number | undefined, currency: string): string {
  if (price === undefined || price === 0) return '免费'
  return formatAmount(price * 1000, currency)
}

function maskedKey(key: string): string {
  return `sk-${key.slice(0, 8)}…`
}

/* ── 接入卡 ────────────────────────────────────── */

type SnippetLang = 'curl' | 'python' | 'javascript'

function buildSnippet(lang: SnippetLang, endpoint: string, key: string, model: string): string {
  switch (lang) {
    case 'curl':
      return `curl ${endpoint}/chat/completions \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer ${key}" \\
  -d '{
    "model": "${model}",
    "messages": [{"role": "user", "content": "Hello"}]
  }'`
    case 'python':
      return `from openai import OpenAI

client = OpenAI(
    base_url="${endpoint}",
    api_key="${key}",
)
resp = client.chat.completions.create(
    model="${model}",
    messages=[{"role": "user", "content": "Hello"}],
)
print(resp.choices[0].message.content)`
    case 'javascript':
      return `import OpenAI from 'openai'

const client = new OpenAI({
  baseURL: '${endpoint}',
  apiKey: '${key}',
})
const resp = await client.chat.completions.create({
  model: '${model}',
  messages: [{ role: 'user', content: 'Hello' }],
})
console.log(resp.choices[0].message.content)`
  }
}

const SNIPPET_LABEL: Record<SnippetLang, string> = {
  curl: 'curl',
  python: 'Python',
  javascript: 'JavaScript'
}

function ConnectCard({ overview }: { overview: AiProxyOverview }): React.JSX.Element {
  const [lang, setLang] = useState<SnippetLang>('curl')
  const [copied, setCopied] = useState(false)

  const firstKey = overview.keys.find((k) => k.enabled)
  const keyText = firstKey ? `sk-${firstKey.key}` : 'sk-YOUR_API_KEY'
  const chatModel =
    overview.models.find((m) => m.type === 1 || m.type === 12)?.model ?? 'gpt-5-mini'
  const snippet = buildSnippet(lang, overview.endpoint, keyText, chatModel)

  return (
    <div className="ai-connect">
      <div className="ai-connect-main">
        <div className="ai-endpoint-label">API 端点 · OpenAI 兼容</div>
        <div className="ai-endpoint">
          <CopyValue text={overview.endpoint} />
        </div>
        <div className="ai-connect-note">
          任何 OpenAI SDK 把 base URL 换成这个地址即可，Key 在下方创建后带{' '}
          <span className="mono">sk-</span> 前缀使用。
          {overview.docUrl && (
            <>
              {' '}
              <a
                href="#doc"
                onClick={(e) => {
                  e.preventDefault()
                  void window.helios.openExternal(overview.docUrl as string)
                }}
              >
                查看文档 ↗
              </a>
            </>
          )}
        </div>
      </div>
      <div className="ai-snippet">
        <div className="ai-snippet-bar">
          {(Object.keys(SNIPPET_LABEL) as SnippetLang[]).map((item) => (
            <button
              key={item}
              className={`log-container-btn${lang === item ? ' active' : ''}`}
              onClick={() => setLang(item)}
            >
              {SNIPPET_LABEL[item]}
            </button>
          ))}
          <span className="log-spacer" />
          <button
            className="log-container-btn"
            onClick={() => {
              void window.helios.copyText(snippet)
              setCopied(true)
              setTimeout(() => setCopied(false), 1200)
            }}
          >
            {copied ? '已复制' : '复制'}
          </button>
        </div>
        <pre className="ai-snippet-code">{snippet}</pre>
      </div>
    </div>
  )
}

/* ── Key 行 ────────────────────────────────────── */

function KeyRow({
  info,
  currency,
  highlight,
  busy,
  onToggle,
  onDelete
}: {
  info: AiKeyInfo
  currency: string
  highlight: boolean
  busy: boolean
  onToggle: () => void
  onDelete: () => void
}): React.JSX.Element {
  const [confirming, setConfirming] = useState(false)

  return (
    <div
      className={`ai-key-row${highlight ? ' ai-key-new' : ''}${info.enabled ? '' : ' ai-key-off'}`}
    >
      <span className={`dot ${info.enabled ? 'dot-running' : 'dot-stopped'}`} />
      <span className="ai-key-name truncate" title={info.name}>
        {info.name}
      </span>
      <span className="ai-key-secret">
        <CopyValue text={`sk-${info.key}`} display={maskedKey(info.key)} title="点击复制完整 Key" />
        {highlight && <span className="ai-key-created-tag">已创建，点击复制</span>}
      </span>
      <span className="ai-key-cell">{info.requestCount} 次请求</span>
      <span className="ai-key-cell">{formatAmount(info.usedAmount, currency)}</span>
      <span className="ai-key-cell ai-key-time">
        {info.accessedAt > 0
          ? `最近使用 ${timeAgo(new Date(info.accessedAt).toISOString())}`
          : '未使用过'}
      </span>
      <span className="ai-key-actions">
        {confirming ? (
          <>
            <button
              className="ai-key-btn ai-key-danger"
              disabled={busy}
              onClick={() => {
                setConfirming(false)
                onDelete()
              }}
            >
              确认删除
            </button>
            <button className="ai-key-btn" disabled={busy} onClick={() => setConfirming(false)}>
              取消
            </button>
          </>
        ) : (
          <>
            <button className="ai-key-btn" disabled={busy} onClick={onToggle}>
              {info.enabled ? '禁用' : '启用'}
            </button>
            <button className="ai-key-btn" disabled={busy} onClick={() => setConfirming(true)}>
              删除
            </button>
          </>
        )}
      </span>
    </div>
  )
}

/* ── 主页面 ────────────────────────────────────── */

function AiProxyTab(): React.JSX.Element {
  const [overview, setOverview] = useState<AiProxyOverview | null>(null)
  const [error, setError] = useState('')
  const [actionError, setActionError] = useState('')
  const [creating, setCreating] = useState(false)
  const [newName, setNewName] = useState('')
  const [busyKey, setBusyKey] = useState<number | null>(null)
  const [freshKeyId, setFreshKeyId] = useState<number | null>(null)
  const [search, setSearch] = useState('')
  const [ownerFilter, setOwnerFilter] = useState<string | null>(null)

  const refresh = useCallback(() => {
    window.helios
      .getAiProxyOverview()
      .then((data) => {
        setOverview(data)
        setError('')
      })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)))
  }, [])

  useEffect(() => {
    const initial = setTimeout(refresh, 0)
    const timer = setInterval(refresh, REFRESH_MS)
    return () => {
      clearTimeout(initial)
      clearInterval(timer)
    }
  }, [refresh])

  const submitCreate = useCallback(() => {
    const name = newName.trim()
    if (!name || creating) return
    setCreating(true)
    setActionError('')
    window.helios
      .createAiKey(name)
      .then((created) => {
        setNewName('')
        setFreshKeyId(created.id)
        refresh()
      })
      .catch((err: unknown) => setActionError(err instanceof Error ? err.message : String(err)))
      .finally(() => setCreating(false))
  }, [newName, creating, refresh])

  const toggleKey = useCallback(
    (info: AiKeyInfo) => {
      setBusyKey(info.id)
      setActionError('')
      window.helios
        .setAiKeyEnabled(info.id, !info.enabled)
        .then(refresh)
        .catch((err: unknown) => setActionError(err instanceof Error ? err.message : String(err)))
        .finally(() => setBusyKey(null))
    },
    [refresh]
  )

  const removeKey = useCallback(
    (info: AiKeyInfo) => {
      setBusyKey(info.id)
      setActionError('')
      window.helios
        .deleteAiKey(info.id)
        .then(refresh)
        .catch((err: unknown) => setActionError(err instanceof Error ? err.message : String(err)))
        .finally(() => setBusyKey(null))
    },
    [refresh]
  )

  const owners = useMemo(() => {
    const counts = new Map<string, number>()
    for (const m of overview?.models ?? []) {
      counts.set(m.owner, (counts.get(m.owner) ?? 0) + 1)
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1])
  }, [overview])

  const filteredModels = useMemo(() => {
    const kw = search.trim().toLowerCase()
    return (overview?.models ?? []).filter((m) => {
      if (ownerFilter && m.owner !== ownerFilter) return false
      if (kw && !m.model.toLowerCase().includes(kw) && !m.owner.toLowerCase().includes(kw))
        return false
      return true
    })
  }, [overview, search, ownerFilter])

  if (error && !overview) {
    return <div className="error">{error}</div>
  }

  if (!overview) {
    return <div className="placeholder">正在读取 AI Proxy…</div>
  }

  const usage = overview.usage
  const requestSeries = [
    {
      name: 'requests',
      points: usage.points.map((p) => [p.timestamp, p.requests] as [number, number])
    }
  ]
  const amountSeries = [
    {
      name: 'amount',
      points: usage.points.map((p) => [p.timestamp, p.amount] as [number, number])
    }
  ]

  return (
    <div className="ai-proxy">
      {error && <div className="error">{error}</div>}

      <ConnectCard overview={overview} />

      <StatStrip
        items={[
          { label: '近 7 天请求', value: usage.requests.toLocaleString() },
          {
            label: 'Tokens',
            value: formatTokens(usage.inputTokens + usage.outputTokens),
            sub: `入 ${formatTokens(usage.inputTokens)} · 出 ${formatTokens(usage.outputTokens)}`
          },
          {
            label: '近 7 天花费',
            value: formatAmount(usage.amount, overview.currency),
            sub: overview.currency === 'shellCoin' ? '与账户余额同单位' : undefined
          },
          {
            label: '异常请求',
            value: usage.exceptions > 0 ? usage.exceptions : '0'
          },
          { label: 'API Keys', value: overview.keys.length },
          { label: '可用模型', value: overview.models.length }
        ]}
      />

      {usage.points.length > 0 && (
        <div className="spark-grid">
          <SparkCard
            title="请求数"
            series={requestSeries}
            color="#2563eb"
            unit=""
            yScale={10}
            headValue={usage.requests.toLocaleString()}
            footNote="近 7 天 · 按天"
          />
          <SparkCard
            title="花费"
            series={amountSeries}
            color="#b45309"
            unit=""
            yScale={0.5}
            headValue={formatAmount(usage.amount, overview.currency)}
            footNote="近 7 天 · 按天"
          />
        </div>
      )}

      <Section
        title="API Keys"
        count={overview.keys.length}
        actions={
          <div className="ai-create">
            <input
              className="ai-create-input"
              placeholder="Key 名称，如 my-app"
              value={newName}
              maxLength={32}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') submitCreate()
              }}
            />
            <button
              className="daction"
              disabled={creating || !newName.trim()}
              onClick={submitCreate}
            >
              {creating ? '创建中…' : '新建 Key'}
            </button>
          </div>
        }
      >
        {actionError && <div className="error">{actionError}</div>}
        {overview.keys.length === 0 ? (
          <EmptyNote text="还没有 API Key。起个名字创建第一个，创建后即可用任何 OpenAI SDK 调用上面的端点。" />
        ) : (
          <div className="ai-key-list">
            {overview.keys.map((info) => (
              <KeyRow
                key={info.id}
                info={info}
                currency={overview.currency}
                highlight={freshKeyId === info.id}
                busy={busyKey === info.id}
                onToggle={() => toggleKey(info)}
                onDelete={() => removeKey(info)}
              />
            ))}
          </div>
        )}
      </Section>

      <Section
        title="模型目录"
        count={filteredModels.length}
        actions={
          <input
            className="ai-create-input ai-model-search"
            placeholder="搜索模型…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        }
      >
        <div className="ai-owner-chips">
          <button
            className={`tpl-cat${ownerFilter === null ? ' active' : ''}`}
            onClick={() => setOwnerFilter(null)}
          >
            全部
            <span className="tpl-cat-count">{overview.models.length}</span>
          </button>
          {owners.map(([owner, count]) => (
            <button
              key={owner}
              className={`tpl-cat${ownerFilter === owner ? ' active' : ''}`}
              onClick={() => setOwnerFilter(ownerFilter === owner ? null : owner)}
            >
              {owner}
              <span className="tpl-cat-count">{count}</span>
            </button>
          ))}
        </div>

        {filteredModels.length === 0 ? (
          <EmptyNote text="没有匹配的模型。" />
        ) : (
          <div className="ai-model-list">
            <div className="ai-model-row ai-model-head">
              <span>模型</span>
              <span>类型</span>
              <span>RPM</span>
              <span className="ai-model-price">输入 /1M</span>
              <span className="ai-model-price">输出 /1M</span>
            </div>
            {filteredModels.map((m) => (
              <div key={m.model} className="ai-model-row">
                <span className="ai-model-name">
                  <CopyValue text={m.model} />
                  {m.vision && <span className="chip chip-mini">视觉</span>}
                </span>
                <span className="ai-model-cell">{MODE_LABEL[m.type] ?? `type ${m.type}`}</span>
                <span className="ai-model-cell">{m.rpm > 0 ? m.rpm : '—'}</span>
                <span className="ai-model-cell ai-model-price">
                  {pricePerMillion(m.inputPrice, overview.currency)}
                </span>
                <span className="ai-model-cell ai-model-price">
                  {pricePerMillion(m.outputPrice, overview.currency)}
                </span>
              </div>
            ))}
          </div>
        )}
      </Section>

      <div className="detail-foot hint">
        数据更新于 {new Date(overview.fetchedAt).toLocaleTimeString()} · 每 30 秒自动刷新
      </div>
    </div>
  )
}

export default AiProxyTab
