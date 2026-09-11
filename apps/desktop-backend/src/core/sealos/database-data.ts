import { createServer, type Socket } from 'node:net'
import { Writable } from 'node:stream'
import { CoreV1Api, PortForward } from '@kubernetes/client-node'
import pg from 'pg'
import mysql from 'mysql2/promise'
import { MongoClient, type Document } from 'mongodb'
import { databaseAccess } from './database'
import type { DatabaseSchemaTree, DatabaseTableData, DatabaseTableRequest } from '../../shared/types'

const TIMEOUT = 10_000
type Access = Awaited<ReturnType<typeof databaseAccess>>
type Column = DatabaseTableData['columns'][number]
type SqlClient = { query(sql: string, values?: unknown[]): Promise<Record<string, unknown>[]> }
const sqlEngine = (engine: string) => engine === 'postgresql' ? 'postgresql' : 'mysql'

/** Identifiers are quoted separately; values always use driver parameters. */
export function quoteIdentifier(name: string, engine: string): string {
  if (!name || name.includes('\0')) throw new Error('无效的数据库标识符')
  const quote = engine === 'postgresql' ? '"' : '`'
  return quote + name.split(quote).join(quote + quote) + quote
}

export function validateTableRequest(input: DatabaseTableRequest): Required<Pick<DatabaseTableRequest, 'page' | 'pageSize'>> & DatabaseTableRequest {
  if (!input || typeof input !== 'object') throw new Error('查询参数无效')
  for (const value of [input.instance, input.database, input.table]) {
    if (typeof value !== 'string' || !value || value.length > 512 || value.includes('\0')) throw new Error('库表名称无效')
  }
  const page = input.page ?? 1
  const pageSize = input.pageSize ?? 50
  if (!Number.isInteger(page) || page < 1 || page > 100_000 || !Number.isInteger(pageSize) || pageSize < 1 || pageSize > 100) {
    throw new Error('分页范围无效')
  }
  if (input.filter && (!['contains', 'eq', 'ne', 'isNull', 'notNull'].includes(input.filter.operator) ||
      typeof input.filter.column !== 'string' || typeof (input.filter.value ?? '') !== 'string' || (input.filter.value?.length ?? 0) > 1000)) {
    throw new Error('筛选条件无效')
  }
  return { ...input, page, pageSize }
}

export function sqlFilter(filter: DatabaseTableRequest['filter'], columns: Column[], engine: string) {
  if (!filter) return { sql: '', values: [] as unknown[] }
  if (!columns.some(column => column.name === filter.column)) throw new Error('筛选字段不存在')
  const column = quoteIdentifier(filter.column, engine)
  if (filter.operator === 'isNull') return { sql: ` WHERE ${column} IS NULL`, values: [] }
  if (filter.operator === 'notNull') return { sql: ` WHERE ${column} IS NOT NULL`, values: [] }
  const value = filter.value ?? ''
  const parameter = engine === 'postgresql' ? '$1' : '?'
  const cast = engine === 'postgresql' ? `CAST(${column} AS text)` : `CAST(${column} AS CHAR)`
  // POSITION/LOCATE treat % and _ literally, unlike LIKE.
  const expression = filter.operator === 'contains'
    ? engine === 'postgresql' ? `POSITION(${parameter} IN ${cast}) > 0` : `LOCATE(${parameter}, ${cast}) > 0`
    : `${cast} ${filter.operator === 'ne' ? '<>' : '='} ${parameter}`
  return { sql: ` WHERE ${expression}`, values: [value] }
}

/** The listener exists only for this query and is never exposed to the LAN. */
async function tunnel(access: Access) {
  const { kc, namespace, connection } = access
  const core = kc.makeApiClient(CoreV1Api)
  const serviceName = connection.host.split('.')[0]
  const service = await core.readNamespacedService({ namespace, name: serviceName })
  if (!service.spec?.selector || !Object.keys(service.spec.selector).length) throw new Error('数据库 Service 没有可连接的 Pod')
  const labelSelector = Object.entries(service.spec.selector).map(([k, v]) => `${k}=${v}`).join(',')
  const pods = await core.listNamespacedPod({ namespace, labelSelector })
  const pod = pods.items.find(p => !p.metadata?.deletionTimestamp && p.status?.conditions?.some(c => c.type === 'Ready' && c.status === 'True'))
  if (!pod?.metadata?.name) throw new Error('数据库没有就绪的 Pod')
  const servicePort = service.spec.ports?.find(p => p.port === Number(connection.port))
  const target = servicePort?.targetPort ?? Number(connection.port)
  const port = typeof target === 'number' ? target : pod.spec?.containers.flatMap(c => c.ports ?? []).find(p => p.name === target)?.containerPort
  if (!port || port < 1 || port > 65535) throw new Error('数据库端口无效')
  const sockets = new Set<Socket>()
  const forwards = new Set<{ terminate(): void }>()
  let closed = false
  let failure: string | undefined
  const forward = new PortForward(kc)
  const server = createServer(socket => {
    sockets.add(socket)
    socket.on('error', () => {})
    socket.on('close', () => sockets.delete(socket))
    socket.setTimeout(TIMEOUT + 2000, () => socket.destroy())
    const errors = new Writable({ write(chunk, _encoding, callback) {
      if (chunk.length) { failure = '数据库内网转发中断'; socket.destroy() }
      callback()
    } })
    void forward.portForward(namespace, pod.metadata!.name!, [port], socket, errors, socket).then(ws => {
      if (closed || socket.destroyed) { ws.terminate(); return }
      forwards.add(ws)
      ws.on('error', () => { failure = '数据库内网连接失败'; socket.destroy() })
      ws.on('close', () => { forwards.delete(ws); socket.destroy() })
      socket.on('close', () => { forwards.delete(ws); ws.terminate() })
    }).catch(error => {
      failure = /403|Forbidden/i.test(String(error)) ? '当前工作空间没有数据库端口转发权限' : '无法建立数据库内网连接'
      socket.destroy()
    })
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => { server.removeListener('error', reject); resolve() })
  })
  return {
    port: (server.address() as { port: number }).port,
    failure: () => failure,
    close() {
      closed = true
      for (const socket of sockets) socket.destroy()
      for (const ws of forwards) ws.terminate()
      server.close()
    }
  }
}

async function withSql<T>(access: Access, database: string, task: (client: SqlClient) => Promise<T>): Promise<T> {
  const pipe = await tunnel(access)
  const { username: user, password } = access.connection
  const postgres = access.engine === 'postgresql'
  let cleanup: () => void = () => {}
  try {
    if (postgres) {
      const client = new pg.Client({ host: '127.0.0.1', port: pipe.port, user, password, database,
        connectionTimeoutMillis: TIMEOUT, query_timeout: TIMEOUT, statement_timeout: TIMEOUT - 1000,
        application_name: 'sealos-data-browser' })
      cleanup = () => { void client.end().catch(() => {}) }
      client.on('error', () => {})
      await client.connect()
      await client.query('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY')
      return await task({ query: async (sql, values) => (await client.query(sql, values)).rows })
    }
    const client = await mysql.createConnection({ host: '127.0.0.1', port: pipe.port, user, password, database,
      connectTimeout: TIMEOUT, supportBigNumbers: true, bigNumberStrings: true, dateStrings: true,
      multipleStatements: false })
    cleanup = () => client.destroy()
    await client.query('SET SESSION MAX_EXECUTION_TIME=9000')
    await client.query('START TRANSACTION READ ONLY')
    return await task({ query: async (sql, values) => {
      const [rows] = await client.query({ sql, timeout: TIMEOUT }, values)
      return rows as Record<string, unknown>[]
    } })
  } catch (error) {
    if (pipe.failure()) throw new Error(pipe.failure())
    throw error
  } finally { cleanup(); pipe.close() }
}

async function withMongo<T>(access: Access, task: (client: MongoClient) => Promise<T>): Promise<T> {
  const pipe = await tunnel(access)
  const client = new MongoClient(`mongodb://127.0.0.1:${pipe.port}`, {
    auth: { username: access.connection.username, password: access.connection.password }, authSource: 'admin',
    directConnection: true, serverSelectionTimeoutMS: TIMEOUT, connectTimeoutMS: TIMEOUT, socketTimeoutMS: TIMEOUT
  })
  try { await client.connect(); return await task(client) }
  finally { await client.close(); pipe.close() }
}

async function sqlTables(client: SqlClient, engine: string, database: string) {
  if (engine === 'postgresql') {
    const rows = await client.query("SELECT table_schema, table_name FROM information_schema.tables WHERE table_schema NOT IN ('pg_catalog', 'information_schema') AND table_type='BASE TABLE' ORDER BY table_schema, table_name")
    return rows.map(row => ({ name: `${row.table_schema}.${row.table_name}`, schema: String(row.table_schema), table: String(row.table_name) }))
  }
  const rows = await client.query("SELECT TABLE_NAME AS name FROM information_schema.tables WHERE TABLE_SCHEMA=? AND TABLE_TYPE='BASE TABLE' ORDER BY TABLE_NAME", [database])
  return rows.map(row => ({ name: String(row.name), schema: database, table: String(row.name) }))
}

export async function fetchDatabaseCatalog(instance: string): Promise<DatabaseSchemaTree> {
  const access = await databaseAccess(instance)
  if (!['postgresql', 'mysql', 'apecloud-mysql', 'mongodb'].includes(access.engine)) return { supported: false, reason: 'unsupported', databases: [] }
  if (access.engine === 'mongodb') return withMongo(access, async client => {
    const { databases } = await client.db('admin').admin().listDatabases({ nameOnly: true, authorizedDatabases: true })
    const result = []
    for (const db of databases.filter(d => !['admin', 'local', 'config'].includes(d.name))) {
      const collections = await client.db(db.name).listCollections({}, { nameOnly: true }).toArray()
      result.push({ name: db.name, tables: collections.map(c => c.name).sort() })
    }
    return { supported: true, databases: result }
  })
  const engine = sqlEngine(access.engine)
  const names = await withSql(access, engine === 'postgresql' ? 'postgres' : 'information_schema', async client => {
    const rows = engine === 'postgresql'
      ? await client.query("SELECT datname AS name FROM pg_database WHERE NOT datistemplate AND datallowconn AND has_database_privilege(datname, 'CONNECT') ORDER BY datname")
      : await client.query("SELECT SCHEMA_NAME AS name FROM information_schema.schemata WHERE SCHEMA_NAME NOT IN ('information_schema','mysql','performance_schema','sys') ORDER BY SCHEMA_NAME")
    return rows.map(row => String(row.name))
  })
  const databases = []
  for (const name of names) {
    try {
      const tables = await withSql(access, name, client => sqlTables(client, engine, name))
      databases.push({ name, tables: tables.map(t => t.name) })
    } catch { databases.push({ name, tables: [], error: '无法读取该数据库的表，请检查访问权限或连接状态' }) }
  }
  return { supported: true, databases }
}

export function formatCell(value: unknown): string | null {
  if (value == null) return null
  if (Buffer.isBuffer(value)) return `[二进制 ${value.length} 字节]`
  if (value instanceof Date) return value.toISOString()
  return typeof value === 'string' ? value : typeof value === 'object' ? JSON.stringify(value) : String(value)
}

function resultData(columns: Column[], rows: Record<string, unknown>[], request: ReturnType<typeof validateTableRequest>, total: number): DatabaseTableData {
  let truncated = false
  const result = rows.map(row => columns.map(column => {
    const value = formatCell(row[column.name])
    if (value && value.length > 8192) { truncated = true; return `${value.slice(0, 8192)}…` }
    return value
  }))
  return { columns, rows: result, total, page: request.page, pageSize: request.pageSize, truncated }
}

export async function fetchDatabaseTableData(input: DatabaseTableRequest): Promise<DatabaseTableData> {
  const request = validateTableRequest(input)
  const access = await databaseAccess(request.instance)
  if (!['postgresql', 'mysql', 'apecloud-mysql', 'mongodb'].includes(access.engine)) throw new Error('当前引擎不支持表数据浏览')
  if (access.engine === 'mongodb') return withMongo(access, async client => {
    const db = client.db(request.database)
    const exists = await db.listCollections({ name: request.table }, { nameOnly: true }).hasNext()
    if (!exists) throw new Error('集合不存在')
    const filter: Document = {}
    if (request.filter) {
      const { column, operator, value = '' } = request.filter
      if (!column || column.startsWith('$') || column.includes('\0') || column.includes('.')) throw new Error('筛选字段无效')
      const ref = { $getField: { field: { $literal: column }, input: '$$ROOT' } }
      const text = { $convert: { input: ref, to: 'string', onError: '', onNull: '' } }
      filter.$expr = operator === 'isNull' ? { $in: [{ $type: ref }, ['null', 'missing']] }
        : operator === 'notNull' ? { $not: [{ $in: [{ $type: ref }, ['null', 'missing']] }] }
        : operator === 'contains' ? { $gte: [{ $indexOfCP: [text, { $literal: value }] }, 0] }
        : { [operator === 'eq' ? '$eq' : '$ne']: [text, { $literal: value }] }
    }
    const collection = db.collection(request.table)
    const total = await collection.countDocuments(filter, { maxTimeMS: TIMEOUT })
    const rows = await collection.find(filter).sort({ _id: 1 }).skip((request.page - 1) * request.pageSize).limit(request.pageSize).maxTimeMS(TIMEOUT).toArray()
    // Sample field names even for an empty filtered page.
    const sample = rows.length ? rows : await collection.find({}).limit(1).maxTimeMS(TIMEOUT).toArray()
    const names = [...new Set(sample.flatMap(row => Object.keys(row)))]
    return resultData(names.map(name => ({ name, type: 'JSON' })), rows, request, total)
  })
  const engine = sqlEngine(access.engine)
  return withSql(access, request.database, async client => {
    const tables = await sqlTables(client, engine, request.database)
    const table = tables.find(t => t.name === request.table) ?? tables.find(t => t.schema === 'public' && t.table === request.table)
    if (!table) throw new Error('数据表不存在或没有访问权限')
    const quote = (name: string) => quoteIdentifier(name, engine)
    const params = engine === 'postgresql' ? ['$1', '$2'] : ['?', '?']
    const metadata = await client.query(`SELECT column_name AS name, data_type AS type FROM information_schema.columns WHERE table_schema=${params[0]} AND table_name=${params[1]} ORDER BY ordinal_position`, [table.schema, table.table])
    const columns = metadata.map(row => ({ name: String(row.name), type: String(row.type) }))
    if (!columns.length) throw new Error('无法读取表字段')
    const filter = sqlFilter(request.filter, columns, engine)
    const relation = `${quote(table.schema)}.${quote(table.table)}`
    const primary = engine === 'postgresql'
      ? await client.query(`SELECT a.attname AS name FROM pg_index i JOIN pg_attribute a ON a.attrelid=i.indrelid AND a.attnum=ANY(i.indkey) WHERE i.indrelid=$1::regclass AND i.indisprimary ORDER BY a.attnum`, [relation])
      : await client.query("SELECT COLUMN_NAME AS name FROM information_schema.key_column_usage WHERE TABLE_SCHEMA=? AND TABLE_NAME=? AND CONSTRAINT_NAME='PRIMARY' ORDER BY ORDINAL_POSITION", [table.schema, table.table])
    const order = primary.length ? primary.map(row => quote(String(row.name))).join(', ') : engine === 'postgresql' ? 'ctid' : columns.map(c => quote(c.name)).join(', ')
    const count = await client.query(`SELECT COUNT(*) AS total FROM ${relation}${filter.sql}`, filter.values)
    const limitIndex = filter.values.length + 1
    const pagination = engine === 'postgresql' ? `$${limitIndex} OFFSET $${limitIndex + 1}` : '? OFFSET ?'
    const rows = await client.query(`SELECT * FROM ${relation}${filter.sql} ORDER BY ${order} LIMIT ${pagination}`, [...filter.values, request.pageSize, (request.page - 1) * request.pageSize])
    return resultData(columns, rows, request, Number(count[0].total))
  })
}
