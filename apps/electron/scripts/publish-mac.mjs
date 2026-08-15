#!/usr/bin/env node
/* eslint-disable @typescript-eslint/explicit-function-return-type */
/**
 * 把本机已经打好的 arm64 dmg 发到 norberia/helios-release，并更新 latest.json。
 * 先跑 npm run build:mac。
 *
 *   npm run publish:mac -- --notes "这一版改了什么。"
 */
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createReadStream, existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const RELEASE_REPO = 'norberia/helios-release'
const electronRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const pkg = JSON.parse(readFileSync(join(electronRoot, 'package.json'), 'utf8'))
const version = pkg.version
const tag = `v${version}`
const dmgName = `Helios-${version}-mac-arm64.dmg`
const dmg = join(electronRoot, 'dist', dmgName)
const url = `https://github.com/${RELEASE_REPO}/releases/download/${tag}/${dmgName}`

function flag(name) {
  const index = process.argv.indexOf(`--${name}`)
  if (index === -1) return undefined
  const value = process.argv[index + 1]
  if (!value || value.startsWith('--')) return undefined
  return value
}

function sha256File(file) {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256')
    createReadStream(file)
      .on('error', reject)
      .on('data', (chunk) => hash.update(chunk))
      .on('end', () => resolve(hash.digest('hex')))
  })
}

function gh(args, input) {
  return execFileSync('gh', args, {
    encoding: 'utf8',
    input,
    stdio: input ? ['pipe', 'pipe', 'inherit'] : ['ignore', 'pipe', 'inherit']
  }).trim()
}

const notesFile = flag('notes-file')
const notes = notesFile ? readFileSync(notesFile, 'utf8').trim() : (flag('notes') ?? '').trim()

if (!notes) {
  throw new Error('需要 --notes "更新说明" 或 --notes-file path')
}
if (!existsSync(dmg)) {
  throw new Error(`找不到 ${dmg}。先跑 npm run build:mac`)
}

const sha256 = await sha256File(dmg)
const manifest = `${JSON.stringify({ version, notes, url, sha256 }, null, 2)}\n`

console.log(`[publish-mac] ${dmgName}`)
console.log(`[publish-mac] sha256 ${sha256}`)

gh([
  'release',
  'create',
  tag,
  dmg,
  '--repo',
  RELEASE_REPO,
  '--title',
  `Helios ${version}`,
  '--notes',
  notes
])

const metaRaw = gh(['api', `repos/${RELEASE_REPO}/contents/latest.json`, '--jq', '{sha:.sha}'])
const { sha } = JSON.parse(metaRaw)
const body = JSON.stringify({
  message: `Helios ${version}`,
  content: Buffer.from(manifest, 'utf8').toString('base64'),
  sha,
  branch: 'main'
})
gh(['api', '--method', 'PUT', `repos/${RELEASE_REPO}/contents/latest.json`, '--input', '-'], body)

console.log(`[publish-mac] latest.json → ${url}`)
