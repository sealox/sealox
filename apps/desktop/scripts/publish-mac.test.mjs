import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'

import { buildLatestJson, dmgFileName, readPubspecVersion } from './publish-mac.mjs'

const scriptsDir = dirname(fileURLToPath(import.meta.url))

test('reads the pubspec version before +build with the same regex as build-desktop', () => {
  const buildSource = readFileSync(join(scriptsDir, 'build-desktop.mjs'), 'utf8')
  assert.ok(buildSource.includes('/^version:\\s*([^+\\s]+)/m'))
  assert.equal(readPubspecVersion('version: 0.8.2+9\n'), '0.8.2')
  assert.equal(readPubspecVersion('name: helios\nversion: 1.2.3\n'), '1.2.3')
  assert.throws(() => readPubspecVersion('name: helios\n'), /Cannot read version/)
  assert.match(
    readPubspecVersion(readFileSync(join(scriptsDir, '..', 'pubspec.yaml'), 'utf8')),
    /^\d+\.\d+\.\d+$/
  )
})

test('names the dmg Sealos-{version}-mac-{arch}.dmg', () => {
  assert.equal(dmgFileName('0.8.2', 'arm64'), 'Sealos-0.8.2-mac-arm64.dmg')
  assert.equal(dmgFileName('0.8.2', 'x64'), 'Sealos-0.8.2-mac-x64.dmg')
})

test('arm64 latest.json keeps top-level url for old macos-arm64 clients', () => {
  const url =
    'https://github.com/norberia/helios-release/releases/download/v0.8.2/Sealos-0.8.2-mac-arm64.dmg'
  const manifest = buildLatestJson({
    version: '0.8.2',
    notes: 'notes',
    url,
    sha256: 'abc',
    arch: 'arm64'
  })
  assert.equal(manifest.version, '0.8.2')
  assert.equal(manifest.notes, 'notes')
  assert.equal(manifest.url, url)
  assert.equal(manifest.sha256, 'abc')
  assert.deepEqual(manifest.artifacts, { 'macos-arm64': { url, sha256: 'abc' } })
})

test('x64 latest.json only sets artifacts.macos-x64 and omits top-level url', () => {
  const url =
    'https://github.com/norberia/helios-release/releases/download/v0.8.2/Sealos-0.8.2-mac-x64.dmg'
  const manifest = buildLatestJson({
    version: '0.8.2',
    notes: 'notes',
    url,
    sha256: 'abc',
    arch: 'x64'
  })
  assert.equal(manifest.url, undefined)
  assert.equal(manifest.sha256, undefined)
  assert.deepEqual(manifest.artifacts, { 'macos-x64': { url, sha256: 'abc' } })
})
