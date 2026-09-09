import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  formatProcessExitDetail,
  formatStartFailure,
  ProcessOutputTail,
  safeEveWorkflowEnvironment
} from '../../electron/src/main/agent/process-output.ts'

test('eve exit detail contains a bounded stderr tail', () => {
  const tail = new ProcessOutputTail(2, 40)
  tail.push('old line\nTypeError: startup failed\n')
  tail.push('at bootstrap (runtime.js:1:1)\n')

  const detail = formatProcessExitDetail('eve', 1, null, tail.summary())

  assert.equal(
    detail,
    'eve 退出（code=1 signal=none）：TypeError: startup failed | at bootstrap (runtime.js:1:1)'
  )
})

test('eve stderr summary redacts credentials', () => {
  const tail = new ProcessOutputTail()
  tail.push(
    'Authorization: Bearer secret-value\napiKey=plain-secret\ngho_abcdefghijklmnopqrstuvwxyz123456\n'
  )

  const summary = tail.summary()

  assert.doesNotMatch(summary, /secret-value|plain-secret|gho_abcdefghijklmnopqrstuvwxyz123456/)
  assert.match(summary, /Authorization: Bearer \[REDACTED\]/)
  assert.match(summary, /apiKey=\[REDACTED\]/)
})

test('an abort error cannot replace an observed process exit', () => {
  const error = new DOMException('This operation was aborted', 'AbortError')

  assert.equal(formatStartFailure(error, true), null)
  assert.equal(formatStartFailure(error, false), 'This operation was aborted')
})

test('eve startup does not automatically replay interrupted workflows', () => {
  assert.deepEqual(safeEveWorkflowEnvironment(), {
    WORKFLOW_LOCAL_RECOVER_ACTIVE_RUNS: '0'
  })
})
