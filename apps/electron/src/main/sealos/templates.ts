import type { TemplateCatalog, TemplateInfo } from '../../shared/types'
import { getStatus } from './auth'

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
