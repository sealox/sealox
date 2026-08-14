import { randomBytes } from 'crypto'
import type {
  TemplateArgDef,
  TemplateCatalog,
  TemplateDeployResult,
  TemplateDetail,
  TemplateInfo,
  TemplateQuota
} from '../../shared/types'
import { getStatus, loadAuthJson, readKubeconfigText } from './auth'
import { fetchNamespaceQuota, instanceExists } from './resources'

/**
 * 模板目录来自 sealos.io 官网商店（构建期由 Template API 生成的精编数据：
 * 去重、分类、图标、中英文描述）。部署链接则指向用户所在 region 的控制台。
 */
const SITE = 'https://sealos.io'
const CATALOG_URL = `${SITE}/api/apps/en`
const CACHE_TTL_MS = 30 * 60 * 1000
const FETCH_TIMEOUT_MS = 15_000

interface SiteApp {
  name: string
  slug: string
  templateName?: string
  description?: string
  icon?: string
  screenshots?: string[]
  category?: string
  tags?: string[]
  github?: string
  website?: string
  source?: { deployCount?: number }
  i18n?: { zh?: { description?: string } }
}

let cachedBase: Omit<TemplateInfo, 'deployUrl'>[] | null = null
let fetchedAtMs = 0

function toAbsolute(url: string | undefined): string | undefined {
  if (!url) return undefined
  return url.startsWith('http') ? url : `${SITE}${url}`
}

function toBaseInfo(app: SiteApp): Omit<TemplateInfo, 'deployUrl'> {
  const slug = app.slug.toLowerCase()
  return {
    name: app.name,
    slug,
    templateName: app.templateName || app.slug,
    description: app.i18n?.zh?.description ?? app.description ?? '',
    icon: toAbsolute(app.icon),
    screenshot: toAbsolute(app.screenshots?.[0]),
    category: app.category ?? 'Tools',
    tags: app.tags ?? [],
    github: app.github,
    website: app.website,
    deployCount: app.source?.deployCount,
    detailUrl: `${SITE}/products/app-store/${slug}`
  }
}

async function loadBaseList(): Promise<Omit<TemplateInfo, 'deployUrl'>[]> {
  if (cachedBase && Date.now() - fetchedAtMs < CACHE_TTL_MS) return cachedBase

  const response = await fetch(CATALOG_URL, {
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    headers: { accept: 'application/json' }
  })
  if (!response.ok) throw new Error(`模板目录拉取失败：HTTP ${response.status}`)
  const data = (await response.json()) as { apps?: SiteApp[] } | SiteApp[]
  const apps = Array.isArray(data) ? data : (data.apps ?? [])
  if (apps.length === 0) throw new Error('模板目录为空，sealos.io 返回了意外数据')

  cachedBase = apps.map(toBaseInfo)
  fetchedAtMs = Date.now()
  return cachedBase
}

export async function fetchTemplates(): Promise<TemplateCatalog> {
  const base = await loadBaseList()
  // 与官网 getDeployUrl 相同的 openapp 深链，域名换成用户所在 region 的控制台
  const consoleBase = `https://${getStatus().regionDomain ?? 'os.sealos.io'}`
  return {
    fetchedAt: new Date(fetchedAtMs).toISOString(),
    templates: base.map((t) => ({
      ...t,
      deployUrl: `${consoleBase}/?openapp=system-template%3F%2Fdeploy%3FtemplateName%3D${encodeURIComponent(t.templateName)}`
    }))
  }
}

const DETAIL_TIMEOUT_MS = 15_000
const DEPLOY_TIMEOUT_MS = 120_000
const NAME_SUFFIX_LEN = 8
const DNS_NAME_MAX = 63

function regionDomain(): string {
  const auth = loadAuthJson()
  const region = typeof auth.region === 'string' ? auth.region : undefined
  if (region) {
    try {
      const host = new URL(region).hostname
      if (host) return host
    } catch {
      // fall through to kubeconfig
    }
  }
  const fromStatus = getStatus().regionDomain
  if (fromStatus) return fromStatus
  throw new Error('没有区域信息，请重新登录')
}

function templateApi(path: string): string {
  return `https://template.${regionDomain()}${path}`
}

function isTimeout(err: unknown): boolean {
  if (!(err instanceof Error)) return false
  return err.name === 'TimeoutError' || err.name === 'AbortError'
}

async function readBody(resp: Response): Promise<unknown> {
  const text = await resp.text()
  try {
    return JSON.parse(text) as unknown
  } catch {
    return text
  }
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  return value as Record<string, unknown>
}

function v2Error(body: unknown): { code: string; message: string; details: string } {
  const err = asRecord(asRecord(body)?.error)
  const details = err?.details
  return {
    code: typeof err?.code === 'string' ? err.code : '',
    message: typeof err?.message === 'string' ? err.message : '',
    details: typeof details === 'string' ? details : ''
  }
}

function toNumber(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string') {
    const n = Number.parseFloat(value)
    return Number.isFinite(n) ? n : 0
  }
  return 0
}

function parseArgs(raw: unknown): Record<string, TemplateArgDef> {
  const rec = asRecord(raw)
  if (!rec) return {}
  const out: Record<string, TemplateArgDef> = {}
  for (const [key, value] of Object.entries(rec)) {
    const item = asRecord(value)
    if (!item) continue
    out[key] = {
      description: typeof item.description === 'string' ? item.description : '',
      type: typeof item.type === 'string' ? item.type : 'string',
      default: item.default == null ? '' : String(item.default),
      required: item.required === true
    }
  }
  return out
}

function parseQuota(raw: unknown): TemplateQuota {
  const rec = asRecord(raw)
  return {
    cpu: toNumber(rec?.cpu),
    memory: toNumber(rec?.memory),
    storage: toNumber(rec?.storage),
    nodeport: toNumber(rec?.nodeport)
  }
}

function parseDetail(body: unknown): TemplateDetail {
  const rec = asRecord(body)
  if (!rec || typeof rec.name !== 'string' || !rec.name) throw new Error('无法获取模板详情')
  return {
    name: rec.name,
    args: parseArgs(rec.args),
    quota: parseQuota(rec.quota)
  }
}

function missingRequiredArgKeys(
  args: Record<string, TemplateArgDef>,
  provided: Record<string, string>
): string[] {
  const missing: string[] = []
  for (const [key, def] of Object.entries(args)) {
    if (!def.required || def.default.trim()) continue
    if (!provided[key]?.trim()) missing.push(key)
  }
  return missing
}

function cleanArgs(args: Record<string, string> | undefined): Record<string, string> {
  const out: Record<string, string> = {}
  if (!args) return out
  for (const [key, value] of Object.entries(args)) {
    if (typeof value !== 'string') continue
    const trimmed = value.trim()
    if (trimmed) out[key] = trimmed
  }
  return out
}

/** 8 个小写字母，拒绝采样避免 modulo bias */
function randomLower(len: number): string {
  let out = ''
  while (out.length < len) {
    const bytes = randomBytes(len - out.length + 8)
    for (const b of bytes) {
      if (b >= 234) continue
      out += String.fromCharCode(97 + (b % 26))
      if (out.length === len) break
    }
  }
  return out
}

/** `{templateName}-{8}`，k8s DNS 子域 ≤63；超长截短模板段 */
function allocInstanceName(templateName: string): string {
  const suffix = randomLower(NAME_SUFFIX_LEN)
  const budget = DNS_NAME_MAX - 1 - NAME_SUFFIX_LEN
  let base = templateName
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
  if (base.length > budget) base = base.slice(0, budget).replace(/-+$/, '')
  if (!base || !/^[a-z0-9]/.test(base)) base = 'tpl'
  return `${base}-${suffix}`
}

function mapDeployError(status: number, body: unknown): Error {
  const { code, message, details } = v2Error(body)
  const blob = `${code} ${message} ${details}`.toLowerCase()

  if (status === 400) {
    const names = /missing required parameters:\s*(.+?)\.?$/i.exec(message)
    if (names?.[1] || blob.includes('missing required')) {
      return new Error(names?.[1] ? `缺少必填参数：${names[1]}` : '缺少必填参数')
    }
    return new Error('参数无效')
  }
  if (status === 401) return new Error('登录已失效，请重新登录')
  if (code === 'INSUFFICIENT_BALANCE' || blob.includes('balance') || blob.includes('余额')) {
    return new Error('余额不足')
  }
  if (blob.includes('quota') || blob.includes('exceeded') || blob.includes('配额')) {
    return new Error('配额不足')
  }
  if (status === 403) return new Error('配额或余额不足')
  if (status === 404) return new Error('模板不存在')
  if (status === 409) return new Error('部署冲突，请重试')
  if (status === 422) return new Error('资源规格无效')
  if (status === 503) return new Error('服务暂时不可用')
  return new Error('部署失败')
}

export async function fetchTemplateDetail(templateName: string): Promise<TemplateDetail> {
  if (!templateName.trim()) throw new Error('模板名称无效')
  const url = templateApi(`/api/v2alpha/templates/${encodeURIComponent(templateName.trim())}`)
  let resp: Response
  try {
    resp = await fetch(url, {
      signal: AbortSignal.timeout(DETAIL_TIMEOUT_MS),
      headers: { accept: 'application/json' }
    })
  } catch (err) {
    if (isTimeout(err)) throw new Error('获取模板详情超时')
    throw new Error('无法获取模板详情')
  }
  const body = await readBody(resp)
  if (resp.status === 404) throw new Error('模板不存在')
  if (!resp.ok) throw new Error('无法获取模板详情')
  return parseDetail(body)
}

async function assertQuota(needed: TemplateQuota): Promise<void> {
  const checks: Array<['cpu' | 'memory' | 'storage', number]> = [
    ['cpu', needed.cpu],
    ['memory', needed.memory],
    ['storage', needed.storage]
  ]
  if (checks.every(([, n]) => n <= 0)) return

  let items
  try {
    items = await fetchNamespaceQuota()
  } catch {
    return
  }
  if (items.length === 0) return

  for (const [type, need] of checks) {
    if (need <= 0) continue
    const item = items.find((q) => q.type === type)
    if (!item || item.limit <= 0) continue
    if (item.limit - item.used < need) throw new Error('配额不足')
  }
}

async function postInstance(
  templateName: string,
  name: string,
  args: Record<string, string>
): Promise<{ status: number; body: unknown }> {
  const kubeconfig = readKubeconfigText()
  const payload: { name: string; template: string; args?: Record<string, string> } = {
    name,
    template: templateName
  }
  if (Object.keys(args).length > 0) payload.args = args

  let resp: Response
  try {
    resp = await fetch(templateApi('/api/v2alpha/templates/instances'), {
      method: 'POST',
      headers: {
        Authorization: encodeURIComponent(kubeconfig),
        'Content-Type': 'application/json',
        accept: 'application/json'
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(DEPLOY_TIMEOUT_MS)
    })
  } catch (err) {
    if (isTimeout(err)) throw new Error('部署超时')
    throw new Error('部署失败')
  }
  return { status: resp.status, body: await readBody(resp) }
}

export async function deployTemplate(
  templateName: string,
  args?: Record<string, string>
): Promise<TemplateDeployResult> {
  const catalogName = templateName.trim()
  if (!catalogName) throw new Error('模板名称无效')

  const provided = cleanArgs(args)
  const detail = await fetchTemplateDetail(catalogName)
  const missing = missingRequiredArgKeys(detail.args, provided)
  if (missing.length > 0) throw new Error(`缺少必填参数：${missing.join(', ')}`)
  await assertQuota(detail.quota)

  const attempt = async (retried: boolean): Promise<TemplateDeployResult> => {
    const name = allocInstanceName(catalogName)
    const { status, body } = await postInstance(catalogName, name, provided)
    if (status === 201 || status === 200) {
      const rec = asRecord(body)
      const instanceName = typeof rec?.name === 'string' && rec.name ? rec.name : name
      return { instanceName }
    }
    if (status === 409) {
      try {
        if (await instanceExists(name)) return { instanceName: name }
      } catch {
        throw new Error('无法确认是否已部署，请到项目列表查看')
      }
      if (!retried) return attempt(true)
      throw new Error('部署冲突，请重试')
    }
    throw mapDeployError(status, body)
  }

  return attempt(false)
}
