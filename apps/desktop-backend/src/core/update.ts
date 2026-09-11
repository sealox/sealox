import { createHash } from 'node:crypto'
import { createWriteStream } from 'node:fs'
import { rename, unlink } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { pipeline } from 'node:stream/promises'
import { Readable, Transform } from 'node:stream'
import type { AppUpdateStatus } from '../shared/types'
import { desktopHost } from './desktop-host'

const MANIFEST_URL = 'https://raw.githubusercontent.com/norberia/helios-release/main/latest.json'
const URL_PREFIX = 'https://github.com/norberia/helios-release/releases/download/'
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
    error: value.error
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

function isNewer(latest: string, current: string): boolean {
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

function artifactKey(): string | null {
  if (process.platform === 'darwin') return process.arch === 'arm64' ? 'macos-arm64' : 'macos-x64'
  if (process.platform === 'win32' && process.arch === 'x64') return 'windows-x64'
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

async function checkForUpdate(): Promise<void> {
  if (checking || status.phase === 'downloading') return
  checking = true
  const currentVersion = desktopHost().appVersion
  try {
    const response = await fetch(MANIFEST_URL, {
      signal: AbortSignal.timeout(MANIFEST_TIMEOUT_MS),
      cache: 'no-store',
      headers: {
        accept: 'application/json',
        'user-agent': `Helios/${currentVersion}`
      }
    })
    if (!response.ok) return
    const manifest = readManifest(await response.json())
    const artifact = manifest ? downloadableArtifact(manifest) : null
    if (!manifest || !isNewer(manifest.version, currentVersion) || !artifact) {
      status = { currentVersion, available: false, phase: 'idle' }
      broadcast()
      return
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
      error: keep ? status.error : undefined
    }
    broadcast()
  } catch {
    // 断网或清单不可用：保持上一次状态，不打扰。
  } finally {
    checking = false
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
  if (!status.available || !status.url || !status.sha256) return
  if (status.phase === 'downloading') return

  const url = status.url
  const expected = status.sha256
  const dest = join(desktopHost().downloadsPath, basename(new URL(url).pathname))
  const partial = `${dest}.part`

  status = { ...status, phase: 'downloading', progress: 0, error: undefined }
  lastProgressAt = 0
  broadcast()

  try {
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
    status = { ...status, phase: 'ready', progress: 1, error: undefined }
    broadcast()
  } catch (err) {
    await unlink(partial).catch(() => undefined)
    const message = err instanceof Error ? err.message : '下载失败'
    status = { ...status, phase: 'error', error: message }
    broadcast()
  }
}

export function startUpdateChecker(): void {
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
