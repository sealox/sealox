import type {
  AiKeyInfo,
  AiModelInfo,
  AiProxyOverview,
  AiUsagePoint,
  AiUsageSummary
} from '../../shared/types'
import { ensureAppToken, invalidateAppToken, loadAuthJson } from './auth'

/**
 * AI Proxy 用户侧 API（aiproxy-web.{region} 的 Next.js BFF）。
 * 鉴权用 desktop 应用会话 token（见 ensureAppToken），响应统一为
 * { code, message, data }，code!==200 视为业务错误。
 */

function regionDomain(): string {
  const auth = loadAuthJson()
  const region = typeof auth.region === 'string' ? auth.region : undefined
  if (!region) throw new Error('没有区域信息，请重新登录')
  return new URL(region).hostname
}

function baseUrl(): string {
  return `https://aiproxy-web.${regionDomain()}`
}

interface BffResponse<T> {
  code?: number
  message?: string
  error?: string
  data?: T
}

async function bffRequest<T>(
  path: string,
  init: { method?: string; json?: unknown } = {},
  retrying = false
): Promise<T> {
  const appToken = await ensureAppToken()
  const resp = await fetch(`${baseUrl()}${path}`, {
    method: init.method ?? 'GET',
    headers: {
      Authorization: appToken,
      ...(init.json !== undefined ? { 'Content-Type': 'application/json' } : {})
    },
    body: init.json !== undefined ? JSON.stringify(init.json) : undefined,
    signal: AbortSignal.timeout(30_000)
  })

  let body: BffResponse<T> | null = null
  try {
    body = (await resp.json()) as BffResponse<T>
  } catch {
    // 非 JSON 响应按 HTTP 状态处理
  }

  // BFF 把鉴权失败折叠成 500/401：换发一次 app token 后重试
  const authFailed =
    resp.status === 401 || (resp.status === 500 && body?.error === 'Internal server error')
  if (authFailed && !retrying) {
    await invalidateAppToken()
    return bffRequest<T>(path, init, true)
  }

  if (!resp.ok || (body?.code !== undefined && body.code !== 200)) {
    const message = body?.message || body?.error || `HTTP ${resp.status}`
    throw new Error(`AI Proxy 请求失败：${message}`)
  }
  return body?.data as T
}

/* ── 原始响应形态 ─────────────────────────────── */

interface RawToken {
  id?: number
  name?: string
  key?: string
  status?: number
  used_amount?: number
  request_count?: number
  created_at?: number
  accessed_at?: number
}

interface RawModel {
  model?: string
  owner?: string
  type?: number
  rpm?: number
  price?: {
    input_price?: number
    output_price?: number
    cached_price?: number
  }
  config?: {
    max_context_tokens?: number
    vision?: boolean
    tool_choice?: boolean
  }
}

interface RawChartPoint {
  timestamp?: number
  request_count?: number
  exception_count?: number
  input_tokens?: number
  output_tokens?: number
  used_amount?: number
}

interface RawDashboard {
  chart_data?: RawChartPoint[]
  total_count?: number
  exception_count?: number
  input_tokens?: number
  output_tokens?: number
  used_amount?: number
}

function toKeyInfo(raw: RawToken): AiKeyInfo {
  return {
    id: raw.id ?? 0,
    name: raw.name ?? '',
    key: raw.key ?? '',
    enabled: raw.status === 1,
    usedAmount: raw.used_amount ?? 0,
    requestCount: raw.request_count ?? 0,
    createdAt: raw.created_at ?? 0,
    accessedAt: raw.accessed_at && raw.accessed_at > 0 ? raw.accessed_at : 0
  }
}

/* ── 概览聚合 ─────────────────────────────────── */

export async function fetchAiProxyOverview(): Promise<AiProxyOverview> {
  const [config, tokens, models, dashboard] = await Promise.all([
    bffRequest<{ aiproxyBackend?: string; currencySymbol?: string; docUrl?: string }>(
      '/api/init-app-config'
    ),
    bffRequest<{ tokens?: RawToken[]; total?: number }>('/api/user/token?page=1&perPage=100'),
    bffRequest<RawModel[]>('/api/models/enabled'),
    bffRequest<RawDashboard>('/api/user/dashboard?type=week')
  ])

  const points: AiUsagePoint[] = (dashboard.chart_data ?? []).map((p) => ({
    timestamp: p.timestamp ?? 0,
    requests: p.request_count ?? 0,
    inputTokens: p.input_tokens ?? 0,
    outputTokens: p.output_tokens ?? 0,
    amount: p.used_amount ?? 0,
    exceptions: p.exception_count ?? 0
  }))

  const usage: AiUsageSummary = {
    requests: dashboard.total_count ?? points.reduce((s, p) => s + p.requests, 0),
    exceptions: dashboard.exception_count ?? points.reduce((s, p) => s + p.exceptions, 0),
    inputTokens: dashboard.input_tokens ?? points.reduce((s, p) => s + p.inputTokens, 0),
    outputTokens: dashboard.output_tokens ?? points.reduce((s, p) => s + p.outputTokens, 0),
    amount: dashboard.used_amount ?? points.reduce((s, p) => s + p.amount, 0),
    points
  }

  const aiModels: AiModelInfo[] = (models ?? [])
    .map((m) => ({
      model: m.model ?? '',
      owner: m.owner ?? 'unknown',
      type: m.type ?? 0,
      rpm: m.rpm ?? 0,
      inputPrice: m.price?.input_price,
      outputPrice: m.price?.output_price,
      cachedPrice: m.price?.cached_price,
      contextTokens: m.config?.max_context_tokens,
      vision: m.config?.vision,
      toolChoice: m.config?.tool_choice
    }))
    .sort((a, b) => a.owner.localeCompare(b.owner) || a.model.localeCompare(b.model))

  const backend = config.aiproxyBackend || `https://aiproxy.${regionDomain()}`

  return {
    endpoint: `${backend.replace(/\/+$/, '')}/v1`,
    currency: config.currencySymbol ?? 'shellCoin',
    docUrl: config.docUrl,
    keys: (tokens.tokens ?? []).map(toKeyInfo),
    models: aiModels,
    usage,
    fetchedAt: new Date().toISOString()
  }
}

/* ── Key 生命周期 ─────────────────────────────── */

export async function createAiKey(name: string): Promise<AiKeyInfo> {
  const trimmed = name.trim()
  if (!trimmed) throw new Error('Key 名称不能为空')
  const raw = await bffRequest<RawToken>('/api/user/token', {
    method: 'POST',
    json: { name: trimmed }
  })
  return toKeyInfo(raw)
}

export async function setAiKeyEnabled(id: number, enabled: boolean): Promise<void> {
  await bffRequest(`/api/user/token/${id}`, {
    method: 'POST',
    json: { status: enabled ? 1 : 2 }
  })
}

export async function deleteAiKey(id: number): Promise<void> {
  await bffRequest(`/api/user/token/${id}`, { method: 'DELETE' })
}

/** Helios 注入给本地 eve 的专用 Key 名。 */
export const HELIOS_KEY_NAME = 'helios'
export const HELIOS_FALLBACK_MODEL = 'gemini-3.5-flash'

export interface HeliosAiCredential {
  endpoint: string
  /** 已带 sk- 前缀，可直接当 Bearer */
  apiKey: string
  /** 目录里优先 DeepSeek Flash，没有则回退 Gemini 3.5 Flash */
  model: string
}

function isChatModel(model: AiModelInfo): boolean {
  return model.type === 1 && Boolean(model.model)
}

function pickHeliosModel(models: AiModelInfo[]): string {
  const chat = models.filter(isChatModel)
  const deepseekFlash = chat
    .filter((item) => {
      const id = item.model.toLowerCase()
      const owner = item.owner.toLowerCase()
      return (id.includes('deepseek') || owner.includes('deepseek')) && id.includes('flash')
    })
    .sort((a, b) => {
      const rank = (id: string): number => {
        const n = id.toLowerCase()
        if (n === 'deepseek-v4-flash' || n === 'deepseek-flash') return 0
        return 1
      }
      return rank(a.model) - rank(b.model) || a.model.localeCompare(b.model)
    })[0]
  if (deepseekFlash) return deepseekFlash.model

  const gemini =
    chat.find((item) => item.model === HELIOS_FALLBACK_MODEL) ??
    chat.find((item) => {
      const id = item.model.toLowerCase()
      return id.includes('gemini') && id.includes('flash') && (id.includes('3.5') || id.includes('3-5'))
    })
  return gemini?.model ?? HELIOS_FALLBACK_MODEL
}

/** 返回当前目录中可用于自动切换的聊天模型，保持目录顺序并排除首选模型。 */
export async function getHeliosFallbackModels(primary: string): Promise<string[]> {
  const overview = await fetchAiProxyOverview()
  return overview.models
    .filter(isChatModel)
    .map((item) => item.model)
    .filter((model, index, all) => model !== primary && all.indexOf(model) === index)
}

/**
 * 当前工作空间里必须有一把名为 helios 的启用 Key。
 * 没有就创建，停用就重新打开。密钥只给主进程，不进渲染进程。
 * 模型按当前区域目录选择：DeepSeek Flash 优先，否则 Gemini 3.5 Flash。
 */
export async function ensureHeliosKey(): Promise<HeliosAiCredential> {
  const overview = await fetchAiProxyOverview()
  let key = overview.keys.find((item) => item.name === HELIOS_KEY_NAME)
  if (!key) {
    key = await createAiKey(HELIOS_KEY_NAME)
  } else if (!key.enabled) {
    await setAiKeyEnabled(key.id, true)
  }
  const raw = key.key.trim()
  if (!raw) throw new Error('helios Key 没有返回密钥，请在 AI Proxy 页重新创建')
  return {
    endpoint: overview.endpoint,
    apiKey: raw.startsWith('sk-') ? raw : `sk-${raw}`,
    model: pickHeliosModel(overview.models)
  }
}
