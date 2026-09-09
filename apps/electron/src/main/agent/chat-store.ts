import { chmod, mkdir, readFile, rename, unlink, writeFile } from 'fs/promises'
import { homedir } from 'os'
import { dirname, join } from 'path'
import type { ChatConversation, ChatListItem } from '../../shared/types'
import { getStatus } from '../sealos/auth'

const CHATS_ROOT = join(homedir(), '.helios', 'chats')
const WORKSPACE_ID = /^[\w.-]+$/
const writeChain = new Map<string, Promise<void>>()

export function currentWorkspaceId(): string {
  const status = getStatus()
  const id = status.workspace ?? status.namespace
  if (!id) throw new Error('当前没有工作空间')
  if (!WORKSPACE_ID.test(id)) throw new Error(`工作空间 id 不合法：${id}`)
  return id
}

function workspaceDir(workspaceId: string): string {
  if (!WORKSPACE_ID.test(workspaceId)) throw new Error(`工作空间 id 不合法：${workspaceId}`)
  return join(CHATS_ROOT, workspaceId)
}

function indexPath(workspaceId: string): string {
  return join(workspaceDir(workspaceId), 'index.json')
}

function conversationPath(workspaceId: string, id: string): string {
  if (!isConversationId(id)) throw new Error('对话 id 不合法')
  return join(workspaceDir(workspaceId), `${id}.json`)
}

export function isConversationId(id: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)
}

export function titleFromMessage(text: string): string {
  const one = text.replace(/\s+/g, ' ').trim()
  if (!one) return '新对话'
  return one.length <= 42 ? one : `${one.slice(0, 41)}…`
}

function enqueue(workspaceId: string, job: () => Promise<void>): Promise<void> {
  const previous = writeChain.get(workspaceId) ?? Promise.resolve()
  const next = previous.then(job, job)
  writeChain.set(
    workspaceId,
    next.catch(() => undefined)
  )
  return next
}

async function atomicWrite(file: string, body: string): Promise<void> {
  const tmp = `${file}.tmp`
  await mkdir(dirname(file), { recursive: true })
  await writeFile(tmp, body, { encoding: 'utf8', mode: 0o600 })
  await rename(tmp, file)
  await chmod(file, 0o600).catch(() => undefined)
}

interface IndexFile {
  conversations: ChatListItem[]
}

async function readIndexFile(workspaceId: string): Promise<IndexFile> {
  try {
    const raw = await readFile(indexPath(workspaceId), 'utf8')
    const parsed = JSON.parse(raw) as IndexFile
    if (!Array.isArray(parsed.conversations)) return { conversations: [] }
    return {
      conversations: parsed.conversations.filter(
        (item) =>
          item &&
          typeof item.id === 'string' &&
          typeof item.title === 'string' &&
          (item.projectName === undefined || typeof item.projectName === 'string')
      )
    }
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return { conversations: [] }
    throw err
  }
}

function sortIndex(items: ChatListItem[]): ChatListItem[] {
  return items.slice().sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
}

export async function listConversations(workspaceId: string): Promise<ChatListItem[]> {
  const index = await readIndexFile(workspaceId)
  return sortIndex(index.conversations)
}

export async function readConversation(
  workspaceId: string,
  id: string
): Promise<ChatConversation | null> {
  try {
    const raw = await readFile(conversationPath(workspaceId, id), 'utf8')
    const parsed = JSON.parse(raw) as ChatConversation
    if (!parsed || parsed.id !== id) return null
    return parsed
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw err
  }
}

export async function writeConversation(record: ChatConversation): Promise<void> {
  const workspaceId = record.workspaceId
  await enqueue(workspaceId, async () => {
    const file = conversationPath(workspaceId, record.id)
    await atomicWrite(file, `${JSON.stringify(record, null, 2)}\n`)
    const index = await readIndexFile(workspaceId)
    const item: ChatListItem = {
      id: record.id,
      title: record.title,
      updatedAt: record.updatedAt,
      ...(record.projectName ? { projectName: record.projectName } : {})
    }
    const next = index.conversations.filter((row) => row.id !== record.id)
    if (!record.archivedAt) next.push(item)
    await atomicWrite(
      indexPath(workspaceId),
      `${JSON.stringify({ conversations: sortIndex(next) }, null, 2)}\n`
    )
  })
}

export async function deleteConversation(workspaceId: string, id: string): Promise<void> {
  await enqueue(workspaceId, async () => {
    await unlink(conversationPath(workspaceId, id)).catch((err: NodeJS.ErrnoException) => {
      if (err.code !== 'ENOENT') throw err
    })
    await unlink(`${conversationPath(workspaceId, id)}.tmp`).catch(() => undefined)
    const index = await readIndexFile(workspaceId)
    const next = index.conversations.filter((row) => row.id !== id)
    await atomicWrite(
      indexPath(workspaceId),
      `${JSON.stringify({ conversations: sortIndex(next) }, null, 2)}\n`
    )
  })
}
