import assert from 'node:assert/strict'
import test from 'node:test'
import { isModelQuotaError, readFallbackModels, withModelFallback } from './model-fallback.ts'

test('recognizes provider quota and rate limit errors', () => {
  assert.equal(isModelQuotaError({ status: 429, message: 'rate limit exceeded' }), true)
  assert.equal(isModelQuotaError(new Error('resource exhausted')), true)
  assert.equal(isModelQuotaError(new Error('invalid api key')), false)
})

test('parses and de-duplicates configured fallback models', () => {
  assert.deepEqual(readFallbackModels('["gemini", "gemini", "deepseek"]', 'gemini'), ['deepseek'])
  assert.deepEqual(readFallbackModels('invalid', 'gemini'), [])
})

test('retries the next model only after a quota error', async () => {
  const calls: string[] = []
  const model = (id: string, failure?: unknown) => ({
    specificationVersion: 'v4' as const,
    provider: 'test', modelId: id, supportedUrls: {},
    doGenerate: async () => { calls.push(id); if (failure) throw failure; return { text: [], finishReason: 'stop' as const, usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 }, warnings: [] } },
    doStream: async () => { calls.push(id); if (failure) throw failure; return { stream: new ReadableStream(), warnings: [] } }
  })
  const wrapped = withModelFallback(model('primary', new Error('quota exceeded')) as never, [model('backup') as never])
  await wrapped.doGenerate({ prompt: [], tools: [], temperature: undefined, topP: undefined, topK: undefined, presencePenalty: undefined, frequencyPenalty: undefined, stopSequences: undefined, responseFormat: undefined, seed: undefined, maxOutputTokens: undefined, providerOptions: {} })
  assert.deepEqual(calls, ['primary', 'backup'])
})
