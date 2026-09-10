import assert from 'node:assert/strict'
import { test } from 'node:test'
import { withSystemProxy } from '../src/core/agent/codex-environment.ts'

const settings = `
  HTTPEnable : 1
  HTTPProxy : 127.0.0.1
  HTTPPort : 7897
  HTTPSEnable : 1
  HTTPSProxy : 127.0.0.1
  HTTPSPort : 7897
`

test('Codex inherits system proxy for HTTPS and WebSocket requests', () => {
  const original = { PATH: '/bin' }
  const env = withSystemProxy(original, settings)
  assert.equal(env.HTTPS_PROXY, 'http://127.0.0.1:7897')
  assert.equal(env.WSS_PROXY, env.HTTPS_PROXY)
  assert.equal(env.HTTP_PROXY, env.WS_PROXY)
  assert.equal(env.NO_PROXY, 'localhost,127.0.0.1,::1')
  assert.deepEqual(original, { PATH: '/bin' })
})

test('explicit proxy configuration and bypass rules are preserved', () => {
  for (const key of ['HTTPS_PROXY', 'https_proxy', 'ALL_PROXY', 'WSS_PROXY']) {
    const env = { [key]: 'http://custom:1234', no_proxy: '.internal' }
    assert.deepEqual(withSystemProxy(env, settings), env)
  }
})

test('disabled or invalid system proxies are ignored', () => {
  assert.deepEqual(withSystemProxy({}, settings.replaceAll('Enable : 1', 'Enable : 0')), {})
  assert.deepEqual(withSystemProxy({}, settings.replaceAll('7897', '99999')), {})
})
