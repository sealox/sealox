import assert from 'node:assert/strict'
import test from 'node:test'

import { inferProjectLinks } from '../../electron/src/main/sealos/topology.ts'

function workload(name, values = []) {
  return {
    metadata: { name },
    spec: {
      template: {
        spec: {
          containers: [
            {
              name,
              env: values.map((value, index) => ({ name: `URL_${index}`, value }))
            }
          ]
        }
      }
    }
  }
}

test('project topology infers service calls from workload URLs', () => {
  const workloads = new Map([
    ['frontend', workload('frontend', ['http://api:3000/v1'])],
    ['api', workload('api')]
  ])

  assert.deepEqual(inferProjectLinks(['frontend', 'api'], workloads, [], []), [
    { app: 'frontend', targetKind: 'service', target: 'api' }
  ])
})

test('project topology does not partially match service names', () => {
  const workloads = new Map([
    ['frontend', workload('frontend', ['http://my-api.default.svc:3000'])],
    ['api', workload('api')],
    ['my-api', workload('my-api')]
  ])

  assert.deepEqual(inferProjectLinks(['frontend', 'api', 'my-api'], workloads, [], []), [
    { app: 'frontend', targetKind: 'service', target: 'my-api' }
  ])
})
