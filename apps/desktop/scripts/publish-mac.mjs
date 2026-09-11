#!/usr/bin/env node
/**
 * 把本机已经打好的 macOS dmg 发到 norberia/helios-release，并更新 latest.json。
 * 先跑 npm run build:mac。
 *
 *   npm run publish:mac -- --notes "这一版改了什么。"
 */
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createReadStream, existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const RELEASE_REPO = 'norberia/helios-release'
const VERSION_RE = /^version:\s*([^+\s]+)/m

export function readPubspecVersion(text) {
  const version = VERSION_RE.exec(text)?.[1]
  if (!version) throw new Error('Cannot read version from pubspec.yaml')
  return version
}

export function dmgFileName(version, arch = process.arch) {
  return `Sealos-${version}-mac-${arch}.dmg`
}

export function buildLatestJson({ version, notes, url, sha256, arch }) {
  const artifact = { url, sha256 }
  if (arch === 'arm64') {
    return {
      version,
      notes,
      url,
      sha256,
      artifacts: { 'macos-arm64': artifact }
    }
  }
  if (arch === 'x64') {
    return {
      version,
      notes,
      artifacts: { 'macos-x64': artifact }
    }
  }
  throw new Error(`Unsupported macOS architecture: ${arch}`)
}

function flag(name, argv = process.argv) {
  const index = argv.indexOf(`--${name}`)
  if (index === -1) return undefined
  const value = argv[index + 1]
  if (!value || value.startsWith('--')) return undefined
  return value
}

function sha256File(file) {
  return new Promise((resolveHash, reject) => {
    const hash = createHash('sha256')
    createReadStream(file)
      .on('error', reject)
      .on('data', (chunk) => hash.update(chunk))
      .on('end', () => resolveHash(hash.digest('hex')))
  })
}

function gh(args, input) {
  return execFileSync('gh', args, {
    encoding: 'utf8',
    input,
    stdio: input ? ['pipe', 'pipe', 'inherit'] : ['ignore', 'pipe', 'inherit']
  }).trim()
}

async function main() {
  const desktopRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
  const version = readPubspecVersion(readFileSync(join(desktopRoot, 'pubspec.yaml'), 'utf8'))
  const tag = `v${version}`
  const name = dmgFileName(version, process.arch)
  const dmg = join(desktopRoot, 'dist', name)
  const url = `https://github.com/${RELEASE_REPO}/releases/download/${tag}/${name}`

  const notesFile = flag('notes-file')
  const notes = notesFile ? readFileSync(notesFile, 'utf8').trim() : (flag('notes') ?? '').trim()

  if (!notes) {
    throw new Error('需要 --notes "更新说明" 或 --notes-file path')
  }
  if (!existsSync(dmg)) {
    throw new Error(`找不到 ${dmg}。先跑 npm run build:mac`)
  }

  const sha256 = await sha256File(dmg)
  const manifest = `${JSON.stringify(buildLatestJson({ version, notes, url, sha256, arch: process.arch }), null, 2)}\n`

  console.log(`[publish-mac] ${name}`)
  console.log(`[publish-mac] sha256 ${sha256}`)

  gh([
    'release',
    'create',
    tag,
    dmg,
    '--repo',
    RELEASE_REPO,
    '--title',
    `Sealos ${version}`,
    '--notes',
    notes
  ])

  const metaRaw = gh(['api', `repos/${RELEASE_REPO}/contents/latest.json`, '--jq', '{sha:.sha}'])
  const { sha } = JSON.parse(metaRaw)
  const body = JSON.stringify({
    message: `Sealos ${version}`,
    content: Buffer.from(manifest, 'utf8').toString('base64'),
    sha,
    branch: 'main'
  })
  gh(['api', '--method', 'PUT', `repos/${RELEASE_REPO}/contents/latest.json`, '--input', '-'], body)

  console.log(`[publish-mac] latest.json → ${url}`)
}

const invokedDirectly =
  process.argv[1] !== undefined && fileURLToPath(import.meta.url) === resolve(process.argv[1])
if (invokedDirectly) {
  await main()
}
