#!/usr/bin/env node
/**
 * 下载官方 Node darwin-arm64，供 electron-builder extraResources 打进 Helios.app。
 * 朋友机器上没有 Node 也能跑内嵌的 eve。
 */
import { execFileSync } from 'node:child_process'
import { createWriteStream, existsSync, mkdirSync, rmSync } from 'node:fs'
import { chmod, rename } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { pipeline } from 'node:stream/promises'
import { fileURLToPath } from 'node:url'

const electronRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const major = Number(process.versions.node.split('.')[0])
if (major !== 24) {
  throw new Error(`打包 eve 需要 Node 24（当前 ${process.version}）`)
}
const version = process.versions.node
const archiveName = `node-v${version}-darwin-arm64.tar.gz`
const extractedName = `node-v${version}-darwin-arm64`
const vendor = join(electronRoot, 'vendor')
const dest = join(vendor, 'node-darwin-arm64')
const nodeBin = join(dest, 'bin', 'node')

if (existsSync(nodeBin)) {
  console.log(`[prepare-mac-node] already have ${nodeBin}`)
  process.exit(0)
}

mkdirSync(vendor, { recursive: true })
const tarball = join(vendor, archiveName)
const url = `https://nodejs.org/dist/v${version}/${archiveName}`
console.log(`[prepare-mac-node] downloading ${url}`)

const resp = await fetch(url)
if (!resp.ok || !resp.body) {
  throw new Error(`download node failed: HTTP ${resp.status}`)
}
await pipeline(resp.body, createWriteStream(tarball))

rmSync(join(vendor, extractedName), { recursive: true, force: true })
execFileSync('tar', ['-xzf', tarball, '-C', vendor], { stdio: 'inherit' })
rmSync(dest, { recursive: true, force: true })
await rename(join(vendor, extractedName), dest)
await chmod(nodeBin, 0o755)
rmSync(tarball, { force: true })
console.log(`[prepare-mac-node] ready ${nodeBin}`)
