#!/usr/bin/env node
import { spawnSync } from 'node:child_process'
import { createReadStream, createWriteStream, existsSync, mkdirSync, rmSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { cp, mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { pipeline } from 'node:stream/promises'
import { fileURLToPath } from 'node:url'

const desktopRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const repoRoot = resolve(desktopRoot, '..', '..')
const target = process.argv[2]
const destination = process.argv[3] ? resolve(process.argv[3]) : null

if (!['macos-arm64', 'macos-x64', 'windows-x64'].includes(target) || !destination) {
  throw new Error(
    'Usage: node prepare-runtime.mjs <macos-arm64|macos-x64|windows-x64> <destination>'
  )
}
if (
  target.startsWith('macos-') &&
  `${process.platform}-${process.arch}` !== `darwin-${target.slice(6)}`
) {
  throw new Error(`${target} runtime must be prepared on a matching Mac`)
}
if (target === 'windows-x64' && (process.platform !== 'win32' || process.arch !== 'x64')) {
  throw new Error('windows-x64 runtime must be prepared on 64-bit Windows')
}
if (Number(process.versions.node.split('.')[0]) !== 24) {
  throw new Error(`Helios runtime requires Node 24 (current ${process.version})`)
}

const backend = join(repoRoot, 'apps', 'desktop-backend', 'dist', 'helios-backend.cjs')
const eve = join(repoRoot, 'apps', 'eve', '.output')
if (!existsSync(backend)) throw new Error(`Missing ${backend}; run npm run build:backend`)
if (!existsSync(join(eve, 'nitro.json'))) throw new Error(`Missing Eve build at ${eve}`)

rmSync(destination, { recursive: true, force: true })
mkdirSync(destination, { recursive: true })
await cp(backend, join(destination, 'helios-backend.cjs'))
await cp(eve, join(destination, 'eve', '.output'), { recursive: true })

const nodeVersion = process.version
const nodeTarget = target.startsWith('macos-') ? `darwin-${target.slice(6)}` : 'win-x64'
const extension = target.startsWith('macos-') ? 'tar.gz' : 'zip'
const archiveName = `node-${nodeVersion}-${nodeTarget}.${extension}`
const downloadUrl = `https://nodejs.org/dist/${nodeVersion}/${archiveName}`
const temporary = await mkdtemp(join(tmpdir(), 'helios-runtime-'))
const archive = join(temporary, archiveName)

async function download(url, path) {
  const response = await fetch(url)
  if (!response.ok || !response.body)
    throw new Error(`Download failed: ${url} (HTTP ${response.status})`)
  await pipeline(response.body, createWriteStream(path))
}

async function checksum(path) {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(path)) hash.update(chunk)
  return hash.digest('hex')
}

async function verify(path, expected) {
  if (!/^[a-f\d]{64}$/i.test(expected)) throw new Error(`Invalid SHA-256 for ${basename(path)}`)
  const actual = await checksum(path)
  if (actual.toLowerCase() !== expected.toLowerCase()) {
    throw new Error(`SHA-256 mismatch for ${basename(path)}: expected ${expected}, got ${actual}`)
  }
  console.log(`[runtime] verified ${basename(path)} (${actual})`)
}

async function officialNodeChecksum(version, archiveName) {
  const response = await fetch(`https://nodejs.org/dist/${version}/SHASUMS256.txt`)
  if (!response.ok) {
    throw new Error(`Cannot fetch Node checksum list (HTTP ${response.status})`)
  }
  const entry = (await response.text())
    .split(/\r?\n/)
    .map((line) => line.trim().split(/\s+/))
    .find((parts) => parts.at(-1) === archiveName)
  if (!entry) throw new Error(`Node checksum is missing for ${archiveName}`)
  return entry[0]
}

function run(command, args) {
  const result = spawnSync(command, args, { stdio: 'inherit' })
  if (result.status !== 0) throw new Error(`${command} failed with ${result.status}`)
}

console.log(`[runtime] ${downloadUrl}`)
try {
  await download(downloadUrl, archive)
  await verify(
    archive,
    process.env.HELIOS_NODE_SHA256 ?? (await officialNodeChecksum(nodeVersion, archiveName))
  )
  const extractedName = archiveName.replace(`.${extension}`, '')
  if (target.startsWith('macos-')) {
    run('tar', ['-xzf', archive, '-C', temporary])
    await cp(join(temporary, extractedName), join(destination, 'node'), { recursive: true })
  } else {
    run('powershell.exe', [
      '-NoProfile',
      '-Command',
      'Expand-Archive',
      '-LiteralPath',
      archive,
      '-DestinationPath',
      temporary
    ])
    // GitHub's Windows runner keeps TEMP on C: and the checkout on D:.
    // fs.rename cannot cross those volumes, so copy the extracted runtime.
    await cp(join(temporary, extractedName), join(destination, 'node'), { recursive: true })

    const gitVersion = '2.51.0'
    const portableName = `PortableGit-${gitVersion}-64-bit.7z.exe`
    const defaultPortableUrl =
      `https://github.com/git-for-windows/git/releases/download/` +
      `v${gitVersion}.windows.1/${portableName}`
    const portableUrl = process.env.HELIOS_PORTABLE_GIT_URL ?? defaultPortableUrl
    const portableArchive = join(temporary, basename(new URL(portableUrl).pathname))
    const portableChecksum =
      process.env.HELIOS_PORTABLE_GIT_SHA256 ??
      (portableUrl === defaultPortableUrl
        ? 'a09b275d51ed3e829128e04cf4168fb54896cf6234bb30fecb8dc96a2bd321fa'
        : null)
    if (!portableChecksum) {
      throw new Error('HELIOS_PORTABLE_GIT_SHA256 is required with HELIOS_PORTABLE_GIT_URL')
    }
    console.log(`[runtime] ${portableUrl}`)
    await download(portableUrl, portableArchive)
    await verify(portableArchive, portableChecksum)
    run(portableArchive, ['-y', `-o${join(destination, 'git')}`])
  }
} finally {
  rmSync(temporary, { recursive: true, force: true })
}

console.log(`[runtime] ready: ${destination}`)
