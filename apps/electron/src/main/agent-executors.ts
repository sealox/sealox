import { execFile } from 'child_process'
import { chmod, mkdir, readFile, rename, writeFile } from 'fs/promises'
import { homedir } from 'os'
import { dirname, join } from 'path'
import { promisify } from 'util'
import type { AgentExecutorInfo } from '../shared/types'

const execFileAsync = promisify(execFile)
const EXECUTOR_FILE = join(homedir(), '.helios', 'agent-executor.json')

const executors = [
  { id: 'codex', label: 'Codex', command: 'codex' },
  { id: 'claude', label: 'Claude Code', command: 'claude' },
  { id: 'gemini', label: 'Gemini CLI', command: 'gemini' }
] as const

type ExecutorId = (typeof executors)[number]['id']

interface ExecutorFile {
  enabled?: ExecutorId
}

async function atomicWrite(file: string, body: string): Promise<void> {
  const tmp = `${file}.tmp`
  await mkdir(dirname(file), { recursive: true })
  await writeFile(tmp, body, { encoding: 'utf8', mode: 0o600 })
  await rename(tmp, file)
  await chmod(file, 0o600).catch(() => undefined)
}

async function readEnabled(): Promise<ExecutorId | null> {
  try {
    const value = JSON.parse(await readFile(EXECUTOR_FILE, 'utf8')) as ExecutorFile
    return executors.some((executor) => executor.id === value.enabled) ? value.enabled! : null
  } catch {
    return null
  }
}

async function version(command: string): Promise<string | null> {
  try {
    const { stdout, stderr } = await execFileAsync(command, ['--version'], {
      timeout: 8_000,
      windowsHide: true
    })
    return (stdout || stderr).trim().split('\n').at(0) || null
  } catch {
    return null
  }
}

export async function getAgentExecutors(): Promise<AgentExecutorInfo[]> {
  const enabled = await readEnabled()
  return Promise.all(
    executors.map(async (executor) => {
      const detectedVersion = await version(executor.command)
      return {
        ...executor,
        available: detectedVersion !== null,
        version: detectedVersion ?? undefined,
        enabled: detectedVersion !== null && enabled === executor.id
      }
    })
  )
}

export async function setAgentExecutor(id: string | null): Promise<void> {
  if (id === null || id === '') {
    await atomicWrite(EXECUTOR_FILE, '{}\n')
    return
  }
  const executor = executors.find((item) => item.id === id)
  if (!executor) throw new Error('未知 Agent 执行器')
  if ((await version(executor.command)) === null) throw new Error(`${executor.label} 未安装或不可用`)
  await atomicWrite(EXECUTOR_FILE, `${JSON.stringify({ enabled: executor.id }, null, 2)}\n`)
}

export async function getEnabledAgentExecutor(): Promise<(typeof executors)[number] | null> {
  const id = await readEnabled()
  if (!id) return null
  const executor = executors.find((item) => item.id === id) ?? null
  return executor && (await version(executor.command)) !== null ? executor : null
}
