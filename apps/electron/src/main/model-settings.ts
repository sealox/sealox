import { chmod, mkdir, readFile, rename, unlink, writeFile } from 'fs/promises'
import { homedir } from 'os'
import { dirname, join } from 'path'
import type { ModelSettings } from '../shared/types'

const MODEL_FILE = join(homedir(), '.helios', 'model.json')
const DEEPSEEK_BASE_URL = 'https://api.deepseek.com/v1'
const DEEPSEEK_MODEL = 'deepseek-v4-flash'
const VALIDATE_TIMEOUT_MS = 15_000

export interface ModelAiCredential {
  endpoint: string
  apiKey: string
  model: string
}

interface ModelFile {
  provider: string
  apiKey: string
}

async function atomicWrite(file: string, body: string): Promise<void> {
  const tmp = `${file}.tmp`
  await mkdir(dirname(file), { recursive: true })
  await writeFile(tmp, body, { encoding: 'utf8', mode: 0o600 })
  await rename(tmp, file)
  await chmod(file, 0o600).catch(() => undefined)
}

function maskKey(apiKey: string): string {
  if (apiKey.length < 4) return '••••'
  return `sk-…${apiKey.slice(-4)}`
}

export async function readDeepseekCredential(): Promise<ModelAiCredential | null> {
  try {
    const raw = await readFile(MODEL_FILE, 'utf8')
    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
    const file = parsed as Partial<ModelFile>
    if (file.provider !== 'deepseek') return null
    const apiKey = typeof file.apiKey === 'string' ? file.apiKey.trim() : ''
    if (!apiKey) return null
    return {
      endpoint: DEEPSEEK_BASE_URL,
      apiKey,
      model: DEEPSEEK_MODEL
    }
  } catch {
    return null
  }
}

export async function getModelSettings(): Promise<ModelSettings> {
  const cred = await readDeepseekCredential()
  if (!cred) return { configured: false }
  return { configured: true, hint: maskKey(cred.apiKey) }
}

async function validateDeepseekKey(key: string): Promise<string> {
  const trimmed = key.trim()
  if (!trimmed) throw new Error('请填写 API Key')
  let resp: Response
  try {
    resp = await fetch(`${DEEPSEEK_BASE_URL}/models`, {
      headers: { Authorization: `Bearer ${trimmed}` },
      signal: AbortSignal.timeout(VALIDATE_TIMEOUT_MS)
    })
  } catch {
    throw new Error('无法连接 DeepSeek')
  }
  if (resp.status === 401 || resp.status === 403) throw new Error('密钥无效')
  if (!resp.ok) throw new Error('无法连接 DeepSeek')
  return trimmed
}

export async function saveDeepseekKey(key: string): Promise<void> {
  const apiKey = await validateDeepseekKey(typeof key === 'string' ? key : '')
  const body: ModelFile = { provider: 'deepseek', apiKey }
  await atomicWrite(MODEL_FILE, `${JSON.stringify(body, null, 2)}\n`)
}

export async function clearDeepseekKey(): Promise<void> {
  try {
    await unlink(MODEL_FILE)
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err
  }
}
