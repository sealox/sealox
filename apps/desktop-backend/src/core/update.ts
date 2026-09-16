import { createHash } from 'node:crypto'
import { createWriteStream } from 'node:fs'
import { rename, unlink, mkdir, mkdtemp } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { pipeline } from 'node:stream/promises'
import { Readable, Transform } from 'node:stream'
import type { AppUpdateStatus } from '../shared/types'
import { desktopHost } from './desktop-host'

const RELEASE_URL = 'https://api.github.com/repos/sealos-apps/sealos/releases/latest'
const URL_PREFIX = 'https://github.com/sealos-apps/sealos/releases/download/'
const CHECK_INTERVAL_MS = 30 * 60 * 1000
const MANIFEST_TIMEOUT_MS = 15_000
const DOWNLOAD_TIMEOUT_MS = 15 * 60 * 1000
const ARTIFACT_NAME: Record<string, RegExp> = {
  'macos-arm64': /^Sealos-\d+\.\d+\.\d+-mac-arm64\.dmg$/,
  'macos-x64': /^Sealos-\d+\.\d+\.\d+-mac-x64\.dmg$/,
  'windows-x64': /^Sealos-\d+\.\d+\.\d+-windows-x64\.exe$/
}
const VERSION = /^v?(\d+)\.(\d+)\.(\d+)$/
const SHA256 = /^[a-f0-9]{64}$/

interface Manifest {
  version: string
  notes: string
  url?: string
  sha256?: string
  artifacts?: Record<string, { url: string; sha256: string }>
}

interface InternalStatus extends AppUpdateStatus {
  url?: string
  sha256?: string
  installerPath?: string
}

let status: InternalStatus = {
  currentVersion: '0.0.0',
  available: false,
  phase: 'idle'
}
let checking = false
let timer: ReturnType<typeof setInterval> | undefined
let lastProgressAt = 0

function toPublic(value: InternalStatus): AppUpdateStatus {
  return {
    currentVersion: value.currentVersion,
    available: value.available,
    latestVersion: value.latestVersion,
    notes: value.notes,
    phase: value.phase,
    progress: value.progress,
    error: value.error,
    checking,
    checkedAt: value.checkedAt
  }
}

function broadcast(): void {
  desktopHost().emit('helios:update-event', toPublic(status))
}

function parseVersion(raw: string): [number, number, number] | null {
  const match = raw.trim().match(VERSION)
  if (!match) return null
  return [Number(match[1]), Number(match[2]), Number(match[3])]
}

export function isNewer(latest: string, current: string): boolean {
  const a = parseVersion(latest)
  const b = parseVersion(current)
  if (!a || !b) return false
  for (let i = 0; i < 3; i++) {
    if (a[i] > b[i]) return true
    if (a[i] < b[i]) return false
  }
  return false
}

function readManifest(value: unknown): Manifest | null {
  if (!value || typeof value !== 'object') return null
  const rec = value as Record<string, unknown>
  if (typeof rec.version !== 'string' || !parseVersion(rec.version)) return null
  const notes = typeof rec.notes === 'string' ? rec.notes.trim().slice(0, 2000) : ''
  const url = typeof rec.url === 'string' ? rec.url.trim() : undefined
  const sha256 = typeof rec.sha256 === 'string' ? rec.sha256.trim().toLowerCase() : undefined
  const artifacts: Record<string, { url: string; sha256: string }> = {}
  if (rec.artifacts && typeof rec.artifacts === 'object') {
    for (const [key, value] of Object.entries(rec.artifacts as Record<string, unknown>)) {
      if (!value || typeof value !== 'object') continue
      const item = value as Record<string, unknown>
      if (typeof item.url !== 'string' || typeof item.sha256 !== 'string') continue
      artifacts[key] = { url: item.url.trim(), sha256: item.sha256.trim().toLowerCase() }
    }
  }
  return {
    version: rec.version.trim().replace(/^v/, ''),
    notes,
    url,
    sha256,
    artifacts: Object.keys(artifacts).length ? artifacts : undefined
  }
}

export function artifactKey(
  platform: string = process.platform,
  arch: string = process.arch
): string | null {
  if (platform === 'darwin' && (arch === 'arm64' || arch === 'x64'))
    return arch === 'arm64' ? 'macos-arm64' : 'macos-x64'
  if (platform === 'win32' && arch === 'x64') return 'windows-x64'
  return null
}

function downloadableArtifact(manifest: Manifest): { url: string; sha256: string } | null {
  const key = artifactKey()
  if (!key) return null
  const artifact =
    manifest.artifacts?.[key] ??
    (key === 'macos-arm64' && manifest.url && manifest.sha256
      ? { url: manifest.url, sha256: manifest.sha256 }
      : null)
  if (!artifact?.url.startsWith(URL_PREFIX) || !SHA256.test(artifact.sha256)) return null
  try {
    return ARTIFACT_NAME[key].test(basename(new URL(artifact.url).pathname)) ? artifact : null
  } catch {
    return null
  }
}

export async function checkForUpdate(): Promise<void> {
  if (checking || status.phase === 'downloading') return
  checking = true
  broadcast()
  const currentVersion = desktopHost().appVersion
  try {
    const response = await fetch(RELEASE_URL, {
      signal: AbortSignal.timeout(MANIFEST_TIMEOUT_MS),
      cache: 'no-store',
      headers: {
        accept: 'application/json',
        'user-agent': `Sealos/${currentVersion}`
      }
    })
    if (response.status === 404)
      throw new Error('无法访问 GitHub Release：仓库可能为私有，或尚未发布正式版本')
    if (!response.ok) throw new Error(`检查更新失败：GitHub HTTP ${response.status}`)
    const release = (await response.json()) as {
      tag_name?: string
      body?: string
      draft?: boolean
      prerelease?: boolean
      assets?: { name: string; browser_download_url: string }[]
    }
    if (release.draft || release.prerelease || !release.tag_name || !parseVersion(release.tag_name))
      throw new Error('GitHub 最新版本不是有效的正式版本')
    if (!isNewer(release.tag_name, currentVersion)) {
      status = {
        currentVersion,
        available: false,
        phase: 'idle',
        checkedAt: new Date().toISOString()
      }
      return
    }
    const key = artifactKey()
    const version = release.tag_name.replace(/^v/, '')
    const suffix =
      key === 'macos-arm64'
        ? 'mac-arm64.dmg'
        : key === 'macos-x64'
          ? 'mac-x64.dmg'
          : key === 'windows-x64'
            ? 'windows-x64.exe'
            : null
    if (!suffix) throw new Error('当前平台暂不支持更新')
    const asset = release.assets?.find((a) => a.name === `Sealos-${version}-${suffix}`)
    const sums = release.assets?.find((a) => a.name === 'SHA256SUMS.txt')
    const prefix = `${URL_PREFIX}${release.tag_name}/`
    if (
      !asset ||
      !sums ||
      asset.browser_download_url !== prefix + asset.name ||
      sums.browser_download_url !== prefix + sums.name
    )
      throw new Error('此 Release 缺少当前平台安装包或校验文件')
    const checksumResponse = await fetch(sums.browser_download_url, {
      signal: AbortSignal.timeout(MANIFEST_TIMEOUT_MS)
    })
    if (!checksumResponse.ok) throw new Error(`读取安装包校验失败：HTTP ${checksumResponse.status}`)
    const checksum = (await checksumResponse.text())
      .split(/\r?\n/)
      .map((line) => line.trim().split(/\s+\*?/))
      .find((parts) => parts[1] === asset.name)?.[0]
    const manifest = readManifest({
      version,
      notes: release.body,
      artifacts: { [key!]: { url: asset.browser_download_url, sha256: checksum } }
    })
    const artifact = manifest ? downloadableArtifact(manifest) : null
    if (!manifest || !isNewer(manifest.version, currentVersion) || !artifact) {
      throw new Error('安装包校验信息无效')
    }
    const keep =
      (status.phase === 'ready' || status.phase === 'error') &&
      status.latestVersion === manifest.version
    status = {
      currentVersion,
      available: true,
      latestVersion: manifest.version,
      notes: manifest.notes,
      url: artifact.url,
      sha256: artifact.sha256,
      phase: keep ? status.phase : 'available',
      progress: keep ? status.progress : undefined,
      error: keep ? status.error : undefined,
      checkedAt: new Date().toISOString(),
      installerPath: keep ? status.installerPath : undefined
    }
    broadcast()
  } catch (error) {
    status = {
      ...status,
      currentVersion,
      error: error instanceof Error ? error.message : '检查更新失败'
    }
  } finally {
    checking = false
    broadcast()
  }
}

function reportProgress(progress: number): void {
  const now = Date.now()
  if (now - lastProgressAt < 250 && progress < 1) return
  lastProgressAt = now
  status = { ...status, phase: 'downloading', progress }
  broadcast()
}

export function getUpdateStatus(): AppUpdateStatus {
  return toPublic(status)
}

export async function downloadUpdate(): Promise<void> {
  if (checking) throw new Error('正在检查更新，请稍后重试')
  if (!status.available || !status.url || !status.sha256) return
  if (status.phase === 'downloading') return
  if (status.phase === 'ready' && status.installerPath) {
    const error = await desktopHost().openPath(status.installerPath)
    if (error) {
      status = { ...status, phase: 'error', error }
      broadcast()
    }
    return
  }

  const url = status.url
  const expected = status.sha256
  let partial: string | undefined

  status = { ...status, phase: 'downloading', progress: 0, error: undefined }
  lastProgressAt = 0
  broadcast()

  try {
    await mkdir(desktopHost().downloadsPath, { recursive: true })
    const folder = await mkdtemp(join(desktopHost().downloadsPath, 'Sealos-update-'))
    const dest = join(folder, basename(new URL(url).pathname))
    partial = `${dest}.part`
    const response = await fetch(url, {
      signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS),
      redirect: 'follow',
      headers: { 'user-agent': `Helios/${desktopHost().appVersion}` }
    })
    if (!response.ok || !response.body) {
      throw new Error(`下载失败：HTTP ${response.status}`)
    }

    const total = Number(response.headers.get('content-length')) || 0
    let received = 0
    const hash = createHash('sha256')
    const input = Readable.fromWeb(
      response.body as import('node:stream/web').ReadableStream<Uint8Array>
    )
    const hasher = new Transform({
      transform(chunk, _enc, cb) {
        hash.update(chunk)
        received += chunk.byteLength
        if (total > 0) reportProgress(received / total)
        cb(null, chunk)
      }
    })
    await pipeline(input, hasher, createWriteStream(partial))
    if (hash.digest('hex') !== expected) {
      await unlink(partial).catch(() => undefined)
      throw new Error('安装包校验失败，请再试一次')
    }
    await rename(partial, dest)

    const openError = await desktopHost().openPath(dest)
    if (openError) throw new Error(openError)
    status = { ...status, phase: 'ready', progress: 1, error: undefined, installerPath: dest }
    broadcast()
  } catch (err) {
    if (partial) await unlink(partial).catch(() => undefined)
    const message = err instanceof Error ? err.message : '下载失败'
    status = { ...status, phase: 'error', error: message }
    broadcast()
  }
}

export function startUpdateChecker(): void {
  if (timer) return
  status = { currentVersion: desktopHost().appVersion, available: false, phase: 'idle' }
  void checkForUpdate().catch((error: unknown) => {
    console.error('[update] initial check failed', error)
  })
  timer = setInterval(() => {
    void checkForUpdate().catch((error: unknown) => {
      console.error('[update] scheduled check failed', error)
    })
  }, CHECK_INTERVAL_MS)
}

export function stopUpdateChecker(): void {
  if (timer) clearInterval(timer)
  timer = undefined
}
