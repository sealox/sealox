import assert from 'node:assert/strict'
import { test } from 'node:test'
import { build } from 'esbuild'
import { createRequire } from 'node:module'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const folder = await mkdtemp(join(tmpdir(), 'sealos-query-tests-'))
await build({ entryPoints: [new URL('../src/core/sealos/database-data.ts', import.meta.url).pathname], bundle: true,
  platform: 'node', format: 'cjs', outfile: join(folder, 'data.cjs') })
const { quoteIdentifier, sqlFilter, validateTableRequest, formatCell } = createRequire(import.meta.url)(join(folder, 'data.cjs'))
await rm(folder, { recursive: true, force: true })

test('SQL identifiers and filter values cannot inject executable SQL', () => {
  assert.equal(quoteIdentifier('x"; DROP TABLE users;--', 'postgresql'), '"x""; DROP TABLE users;--"')
  assert.equal(quoteIdentifier('a`b', 'mysql'), '`a``b`')
  for (const engine of ['postgresql', 'mysql']) {
    const value = "%' OR 1=1; DROP TABLE users;--"
    const { sql, values } = sqlFilter({ column: 'name', operator: 'contains', value }, [{ name: 'name' }], engine)
    assert.ok(!sql.includes(value))
    assert.deepEqual(values, [value])
    assert.throws(() => sqlFilter({ column: 'unknown', operator: 'eq' }, [{ name: 'name' }], engine), /不存在/)
    assert.match(sqlFilter({ column: 'name', operator: 'isNull' }, [{ name: 'name' }], engine).sql, /IS NULL/)
  }
})

test('query input rejects unbounded pages and arbitrary filter operators', () => {
  const base = { instance: 'db', database: 'app', table: 'public.users' }
  assert.equal(validateTableRequest(base).pageSize, 50)
  for (const extra of [{ page: 0 }, { page: -1 }, { pageSize: 10000 }, { page: 1.5 }, { filter: { column: 'id', operator: 'rawSQL' } }]) {
    assert.throws(() => validateTableRequest({ ...base, ...extra }))
  }
  assert.equal(formatCell(null), null)
  assert.equal(formatCell(9007199254740993n), '9007199254740993')
  assert.equal(formatCell(Buffer.from('abc')), '[二进制 3 字节]')
  assert.equal(formatCell({ a: 1 }), '{"a":1}')
})
