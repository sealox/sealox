import { BrowserWindow, dialog } from 'electron'
import { stat, readFile } from 'fs/promises'
import { basename, extname } from 'path'
import { MAX_CHAT_FILES, type ChatAttachment } from '../../shared/types'

export const MAX_CHAT_FILE_BYTES = 20 * 1024 * 1024

const MIME: Record<string, string> = {
  '.txt': 'text/plain',
  '.md': 'text/markdown',
  '.markdown': 'text/markdown',
  '.json': 'application/json',
  '.csv': 'text/csv',
  '.yml': 'text/yaml',
  '.yaml': 'text/yaml',
  '.xml': 'application/xml',
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'text/javascript',
  '.ts': 'text/plain',
  '.tsx': 'text/plain',
  '.jsx': 'text/plain',
  '.py': 'text/x-python',
  '.go': 'text/plain',
  '.rs': 'text/plain',
  '.sh': 'text/x-sh',
  '.toml': 'text/plain',
  '.log': 'text/plain',
  '.pdf': 'application/pdf',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.zip': 'application/zip'
}

export function mediaTypeFor(filename: string): string {
  return MIME[extname(filename).toLowerCase()] ?? 'application/octet-stream'
}

export async function pickChatFiles(win: BrowserWindow | null): Promise<ChatAttachment[]> {
  const options = {
    title: '添加文件',
    properties: ['openFile', 'multiSelections'] as Array<'openFile' | 'multiSelections'>
  }
  const result = win
    ? await dialog.showOpenDialog(win, options)
    : await dialog.showOpenDialog(options)
  if (result.canceled) return []
  const picked: ChatAttachment[] = []
  for (const filePath of result.filePaths) {
    if (picked.length >= MAX_CHAT_FILES) break
    const info = await stat(filePath).catch(() => null)
    if (!info?.isFile()) continue
    if (info.size > MAX_CHAT_FILE_BYTES) {
      throw new Error(
        `${basename(filePath)} 超过 ${Math.round(MAX_CHAT_FILE_BYTES / (1024 * 1024))} MB，换一个更小的文件`
      )
    }
    const filename = basename(filePath)
    picked.push({
      path: filePath,
      filename,
      mediaType: mediaTypeFor(filename),
      size: info.size
    })
  }
  return picked
}

export async function readChatFiles(
  attachments: ChatAttachment[]
): Promise<Array<{ filename: string; mediaType: string; size: number; dataUrl: string }>> {
  if (attachments.length > MAX_CHAT_FILES) {
    throw new Error(`一次最多添加 ${MAX_CHAT_FILES} 个文件`)
  }
  const loaded: Array<{ filename: string; mediaType: string; size: number; dataUrl: string }> = []
  for (const item of attachments) {
    if (!item.path || typeof item.path !== 'string') throw new Error('文件路径无效')
    const info = await stat(item.path)
    if (!info.isFile()) throw new Error(`${item.filename || item.path} 不是文件`)
    if (info.size > MAX_CHAT_FILE_BYTES) {
      throw new Error(
        `${basename(item.path)} 超过 ${Math.round(MAX_CHAT_FILE_BYTES / (1024 * 1024))} MB`
      )
    }
    const filename = basename(item.path)
    const mediaType = mediaTypeFor(filename)
    const bytes = await readFile(item.path)
    loaded.push({
      filename,
      mediaType,
      size: info.size,
      dataUrl: `data:${mediaType};base64,${bytes.toString('base64')}`
    })
  }
  return loaded
}
