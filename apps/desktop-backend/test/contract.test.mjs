import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'

const execFileAsync = promisify(execFile)
const sharedUrl = new URL('../src/shared/types.ts', import.meta.url)
const apiUrl = new URL('../src/core/desktop-api.ts', import.meta.url)
const backendUrl = new URL('../dist/helios-backend.cjs', import.meta.url)

async function contractMethods() {
  const shared = await readFile(sharedUrl, 'utf8')
  const contract = shared.slice(shared.indexOf('export interface HeliosApi'))
  return [...contract.matchAll(/^\s{2}([a-zA-Z]\w*)\(/gm)]
    .map((match) => match[1])
    .filter((name) => !name.startsWith('on'))
}

test('sidecar exposes every HeliosApi method exactly once', async () => {
  const [expected, api] = await Promise.all([contractMethods(), readFile(apiUrl, 'utf8')])
  const list = api.slice(api.indexOf('export const DESKTOP_METHODS'), api.indexOf('] as const'))
  const actual = [...list.matchAll(/^\s{2}'([a-zA-Z]\w*)'/gm)].map((match) => match[1])

  assert.deepEqual(actual, [...new Set(actual)], 'duplicate sidecar method')
  assert.deepEqual(actual.sort(), expected.sort())
})

test('stream subscriptions are represented by sidecar event channels', async () => {
  const sources = await Promise.all([
    readFile(apiUrl, 'utf8'),
    readFile(new URL('../src/core/agent/runtime.ts', import.meta.url), 'utf8'),
    readFile(new URL('../src/core/update.ts', import.meta.url), 'utf8'),
    readFile(new URL('../src/index.ts', import.meta.url), 'utf8')
  ])
  const api = sources.join('\n')
  for (const channel of [
    'sealos:login-event',
    'helios:agent-status',
    'helios:chat-event',
    'helios:update-event',
    'helios:backend-error'
  ]) {
    assert.match(api, new RegExp(channel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
  }
})

test('sidecar stays alive after an unhandled background rejection', async () => {
  const home = await mkdtemp(join(tmpdir(), 'helios-sidecar-rejection-test-'))
  try {
    const script = [
      `require(${JSON.stringify(fileURLToPath(backendUrl))})`,
      "setTimeout(() => Promise.reject(new Error('probe')), 20)",
      'setTimeout(() => process.exit(0), 150)'
    ].join(';')
    const { stdout } = await execFileAsync(process.execPath, ['-e', script], {
      env: {
        ...process.env,
        HOME: home,
        USERPROFILE: home,
        HELIOS_USER_DATA: join(home, 'user-data'),
        HELIOS_DOWNLOADS: join(home, 'downloads')
      }
    })
    const events = stdout
      .trim()
      .split(/\r?\n/)
      .map((line) => JSON.parse(line))
    assert.ok(
      events.some(
        (event) =>
          event.event === 'helios:backend-error' &&
          event.data?.kind === 'unhandled rejection' &&
          event.data?.message === 'probe'
      )
    )
  } finally {
    await rm(home, { recursive: true, force: true })
  }
})

test('built sidecar starts in an isolated smoke environment', async () => {
  const home = await mkdtemp(join(tmpdir(), 'helios-sidecar-test-'))
  try {
    const { stdout } = await execFileAsync(
      process.execPath,
      [fileURLToPath(backendUrl), '--smoke'],
      {
        env: {
          ...process.env,
          HOME: home,
          USERPROFILE: home,
          HELIOS_USER_DATA: join(home, 'user-data'),
          HELIOS_DOWNLOADS: join(home, 'downloads')
        }
      }
    )
    const result = JSON.parse(stdout.trim())
    assert.equal(result.smoke, true)
    assert.equal(result.version, 1)
    assert.deepEqual(result.methods.sort(), (await contractMethods()).sort())
  } finally {
    await rm(home, { recursive: true, force: true })
  }
})
