const ANSI_ESCAPE = /\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g
const CONTROL_CHARACTERS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g
const GITHUB_TOKEN = /\bgh[pousr]_[A-Za-z0-9_]{20,}\b/g
const GITLAB_TOKEN = /\bglpat-[A-Za-z0-9_-]{20,}\b/g
const NPM_TOKEN = /\bnpm_[A-Za-z0-9]{20,}\b/g
const AUTHORIZATION_HEADER = /(Authorization:\s*(?:Bearer|Basic)\s+)([^"'\s]+)/gi
const CREDENTIAL_URL = /(https?:\/\/[^:\s/@]+:)[^@\s/]+@/gi
const SECRET_VALUE =
  /((?:["']?(?:api[_-]?key|access[_-]?token|auth[_-]?token|secret|password)["']?)\s*[:=]\s*["']?)([^"'\s,}]+)/gi

export function redactProcessOutput(value: string): string {
  return value
    .replace(ANSI_ESCAPE, '')
    .replace(CONTROL_CHARACTERS, '')
    .replace(GITHUB_TOKEN, '[REDACTED]')
    .replace(GITLAB_TOKEN, '[REDACTED]')
    .replace(NPM_TOKEN, '[REDACTED]')
    .replace(AUTHORIZATION_HEADER, '$1[REDACTED]')
    .replace(CREDENTIAL_URL, '$1[REDACTED]@')
    .replace(SECRET_VALUE, '$1[REDACTED]')
}

export class ProcessOutputTail {
  private readonly lines: string[] = []
  private remainder = ''
  private readonly maxLines: number
  private readonly maxLineLength: number

  constructor(maxLines = 8, maxLineLength = 500) {
    this.maxLines = maxLines
    this.maxLineLength = maxLineLength
  }

  push(chunk: string): void {
    const parts = `${this.remainder}${chunk}`.replace(/\r\n?/g, '\n').split('\n')
    this.remainder = parts.pop() ?? ''
    for (const part of parts) this.appendLine(part)
    if (this.remainder.length > this.maxLineLength) {
      this.remainder = this.remainder.slice(-this.maxLineLength)
    }
  }

  summary(): string {
    const lines = [...this.lines]
    if (this.remainder.trim()) lines.push(this.cleanLine(this.remainder))
    return lines.filter(Boolean).slice(-this.maxLines).join(' | ')
  }

  private appendLine(value: string): void {
    const line = this.cleanLine(value)
    if (!line) return
    this.lines.push(line)
    if (this.lines.length > this.maxLines) this.lines.shift()
  }

  private cleanLine(value: string): string {
    return redactProcessOutput(value).trim().slice(0, this.maxLineLength)
  }
}

export function formatProcessExitDetail(
  processName: string,
  code: number | null,
  signalName: NodeJS.Signals | null,
  stderrSummary: string
): string {
  const status = `${processName} 退出（code=${code ?? 'null'} signal=${signalName ?? 'none'}）`
  return stderrSummary ? `${status}：${stderrSummary}` : status
}

export function formatStartFailure(error: unknown, processAlreadyExited: boolean): string | null {
  if (processAlreadyExited) return null
  const detail = error instanceof Error ? error.message : String(error)
  return redactProcessOutput(detail)
}

export function safeEveWorkflowEnvironment(): NodeJS.ProcessEnv {
  return {
    // Interrupted deployment steps must only continue after an explicit user action.
    WORKFLOW_LOCAL_RECOVER_ACTIVE_RUNS: '0'
  }
}
