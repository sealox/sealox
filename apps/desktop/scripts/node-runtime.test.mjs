import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  developmentNodeCandidates,
  parseNodeMajor,
  resolveDevelopmentEvePort,
  selectCompatibleNode
} from './node-runtime.mjs'

test('parses Node versions without accepting unrelated output', () => {
  assert.equal(parseNodeMajor('v24.10.0'), 24)
  assert.equal(parseNodeMajor('22.19.1'), 22)
  assert.equal(parseNodeMajor('not node'), null)
})

test('skips incompatible Node versions and selects Node 24', () => {
  const versions = new Map([
    ['/node-22', 'v22.8.0'],
    ['/node-24', 'v24.10.0']
  ])
  const result = selectCompatibleNode(['/node-22', '/node-24'], (executable) => {
    const version = versions.get(executable)
    return version
      ? { executable, version, major: parseNodeMajor(version) }
      : null
  })

  assert.equal(result.selected?.executable, '/node-24')
  assert.deepEqual(
    result.inspected.map(({ major }) => major),
    [22, 24]
  )
})

test('includes the packaged release runtime as a development fallback', () => {
  const candidates = developmentNodeCandidates({
    repoRoot: '/repo',
    env: { PATH: '' },
    platform: 'darwin',
    currentExecutable: '/node-22'
  })

  assert.ok(
    candidates.includes(
      '/repo/apps/desktop/build/macos/Build/Products/Release/Sealos.app/Contents/Resources/helios/node/bin/node'
    )
  )
})

test('assigns an isolated Agent port to each development process', () => {
  assert.equal(resolveDevelopmentEvePort({ env: {}, processId: 1 }), 24723)
  assert.equal(resolveDevelopmentEvePort({ env: {}, processId: 2 }), 24724)
  assert.equal(
    resolveDevelopmentEvePort({ env: { HELIOS_EVE_PORT: '31000' }, processId: 2 }),
    31000
  )
  assert.throws(
    () => resolveDevelopmentEvePort({ env: { HELIOS_EVE_PORT: 'invalid' }, processId: 2 }),
    /1024.*65535/
  )
})
