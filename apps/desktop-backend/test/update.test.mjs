import assert from 'node:assert/strict'
import { test } from 'node:test'
import { build } from 'esbuild'
import { createRequire } from 'node:module'
import { mkdtemp, rm, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'

test('release checking, verified installation handoff, retries and failures', async () => {
  const folder = await mkdtemp(join(tmpdir(), 'sealos-update-test-'))
  const originalFetch = globalThis.fetch
  const opened = []
  globalThis.updateHost = {
    appVersion: '0.8.3',
    downloadsPath: join(folder, 'downloads'),
    emit() {},
    openPath: async (path) => {
      opened.push(path)
      return ''
    }
  }
  try {
    await build({
      entryPoints: [new URL('../src/core/update.ts', import.meta.url).pathname],
      bundle: true,
      platform: 'node',
      format: 'cjs',
      outfile: join(folder, 'update.cjs'),
      plugins: [
        {
          name: 'host',
          setup(b) {
            b.onResolve({ filter: /^\.\/desktop-host$/ }, () => ({
              path: 'host',
              namespace: 'mock'
            }))
            b.onLoad({ filter: /.*/, namespace: 'mock' }, () => ({
              contents: 'export const desktopHost = () => globalThis.updateHost'
            }))
          }
        }
      ]
    })
    const api = createRequire(import.meta.url)(join(folder, 'update.cjs'))
    assert.equal(api.isNewer('v0.10.0', '0.9.9'), true)
    for (const version of ['0.8.3', '0.8.2', 'v0.9.0-beta.1', 'garbage'])
      assert.equal(api.isNewer(version, '0.8.3'), false)
    assert.equal(api.artifactKey('darwin', 'arm64'), 'macos-arm64')
    assert.equal(api.artifactKey('darwin', 'x64'), 'macos-x64')
    assert.equal(api.artifactKey('win32', 'x64'), 'windows-x64')
    assert.equal(api.artifactKey('linux', 'arm64'), null)
    const payload = Buffer.from('test installer bytes')
    const checksum = createHash('sha256').update(payload).digest('hex')
    const suffix = process.platform === 'win32' ? 'windows-x64.exe' : `mac-${process.arch}.dmg`
    const filename = `Sealos-0.8.4-${suffix}`
    const base = 'https://github.com/sealos-apps/sealos/releases/download/v0.8.4/'
    let release = {
      tag_name: 'v0.8.4',
      body: 'Release notes',
      assets: [
        { name: filename, browser_download_url: base + filename },
        { name: 'SHA256SUMS.txt', browser_download_url: base + 'SHA256SUMS.txt' }
      ]
    }
    let badDownload = false
    globalThis.fetch = async (url) =>
      new Response(
        url.includes('api.github.com')
          ? JSON.stringify(release)
          : url.endsWith('SHA256SUMS.txt')
            ? `${checksum}  ${filename}\n`
            : badDownload
              ? 'corrupted'
              : payload
      )
    await api.checkForUpdate()
    assert.equal(api.getUpdateStatus().available, true)
    assert.ok(api.getUpdateStatus().checkedAt)
    assert.equal(api.getUpdateStatus().checking, false)
    assert.equal(api.getUpdateStatus().url, undefined)
    badDownload = true
    await api.downloadUpdate()
    assert.equal(api.getUpdateStatus().phase, 'error')
    assert.equal(opened.length, 0)
    badDownload = false
    await api.downloadUpdate()
    assert.equal(api.getUpdateStatus().phase, 'ready')
    assert.deepEqual(await readFile(opened[0]), payload)
    await api.downloadUpdate()
    assert.equal(opened[0], opened[1])
    release = { ...release, tag_name: 'v0.8.3' }
    await api.checkForUpdate()
    assert.equal(api.getUpdateStatus().available, false)
    release = { ...release, tag_name: 'v0.8.4', assets: [] }
    await api.checkForUpdate()
    assert.match(api.getUpdateStatus().error, /缺少/)
    globalThis.fetch = async () => new Response('', { status: 403 })
    await api.checkForUpdate()
    assert.match(api.getUpdateStatus().error, /403/)
    globalThis.fetch = async () => {
      throw new Error('offline')
    }
    await api.checkForUpdate()
    assert.equal(api.getUpdateStatus().error, 'offline')
    assert.equal(api.getUpdateStatus().checking, false)
  } finally {
    globalThis.fetch = originalFetch
    delete globalThis.updateHost
    await rm(folder, { recursive: true, force: true })
  }
})
