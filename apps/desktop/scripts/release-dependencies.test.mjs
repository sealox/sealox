import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

const lock = JSON.parse(readFileSync(new URL('../../../package-lock.json', import.meta.url), 'utf8'))

test('native build tools load and execute on the current runner', async () => {
  const { rolldown } = await import('rolldown')
  const bundle = await rolldown({
    input: 'virtual-entry',
    plugins: [{
      name: 'native-smoke-test',
      resolveId: () => 'virtual-entry',
      load: () => 'export const value = 1'
    }]
  })
  try {
    assert.ok((await bundle.generate({ format: 'es' })).output[0].code)
  } finally {
    await bundle.close()
  }
  const { transformSync } = await import('esbuild')
  assert.ok(transformSync('const value: number = 1', { loader: 'ts' }).code)
})

test('release lockfile includes compatible native bundlers for every desktop target', () => {
  const targets = {
    esbuild: ['@esbuild/darwin-arm64', '@esbuild/darwin-x64', '@esbuild/win32-x64'],
    rolldown: [
      '@rolldown/binding-darwin-arm64',
      '@rolldown/binding-darwin-x64',
      '@rolldown/binding-win32-x64-msvc'
    ]
  }
  for (const [bundler, bindings] of Object.entries(targets)) {
    const expectedVersion = lock.packages[`node_modules/${bundler}`].version
    for (const binding of bindings) {
      const entry = lock.packages[`node_modules/${binding}`]
      assert.ok(entry, `${binding} is missing from the lockfile`)
      assert.equal(entry.version, expectedVersion, `${binding} must match ${bundler}`)
      assert.equal(entry.optional, true, `${binding} must be skippable on other platforms`)
    }
  }
})
