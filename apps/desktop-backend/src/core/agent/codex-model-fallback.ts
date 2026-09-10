type RecordValue = Record<string, any>
export type CodexRpc = (method: string, params: RecordValue) => Promise<RecordValue>

export function isCodexModelUnavailable(error: unknown): boolean {
  const value = error as RecordValue | null
  const message = typeof error === 'string' ? error : String(value?.message ?? '')
  const info = value?.codexErrorInfo
  if (/kubernetes|resourcequota|exceeded quota:/i.test(message)) return false
  if (info && typeof info === 'object' && Object.values(info).some(
    value => (value as RecordValue | null)?.httpStatusCode === 429
  )) return true
  return info === 'usageLimitExceeded' || info === 'modelNotFound' ||
    /usage limit|insufficient[_ ]quota|quota (?:exceeded|exhausted)|rate[_ ]limit|rate limit|model.+(?:not available|not supported|does not exist|not found)|额度.*(?:耗尽|用完|不足)/i.test(message)
}

export interface CodexModelChoice {
  model: string
  effort?: string
}

// Only failed models are cached; a catalog entry alone does not prove available quota.
export class CodexModelSelector {
  private blocked = new Map<string, number>()
  private now: () => number
  constructor(now: () => number = Date.now) { this.now = now }

  block(model: string): void { this.blocked.set(model, this.now() + 5 * 60_000) }

  async choices(rpc: CodexRpc, cwd: string, override?: string): Promise<CodexModelChoice[]> {
    const config = await rpc('config/read', { cwd, includeLayers: false })
    const models: RecordValue[] = []
    let cursor: string | null = null
    const cursors = new Set<string>()
    do {
      const page = await rpc('model/list', { cursor, limit: 100, includeHidden: false })
      models.push(...(Array.isArray(page.data) ? page.data : []))
      cursor = typeof page.nextCursor === 'string' ? page.nextCursor : null
      if (cursor && cursors.has(cursor)) break
      if (cursor) cursors.add(cursor)
    } while (cursor)
    const visible = models.filter(m => !m.hidden && typeof m.model === 'string')
    const configured = override?.trim() || config.config?.model
    const customProvider = config.config?.model_provider && config.config.model_provider !== 'openai'
    const preferred = visible.some(m => m.model === configured) || customProvider
      ? configured : visible.find(m => m.isDefault)?.model
    // The user's requested downgrade path: GPT-6 -> available GPT-5.6 catalog variants.
    visible.sort((a, b) => Number(!a.model.startsWith('gpt-5.6')) - Number(!b.model.startsWith('gpt-5.6')))
    // A custom provider's catalog is not proof that it serves OpenAI account models.
    const ids = [...new Set<string>([preferred, ...(customProvider ? [] : visible.map(m => m.model))].filter(Boolean))]
    const choices = ids.filter(id => (this.blocked.get(id) ?? 0) <= this.now()).map(model => {
      const item = models.find(m => m.model === model)
      const desired = config.config?.model_reasoning_effort
      const effort = item?.supportedReasoningEfforts?.some((e: RecordValue) => e.reasoningEffort === desired)
        ? desired : item?.defaultReasoningEffort
      return { model, ...(effort ? { effort } : {}) }
    })
    if (!choices.length) throw new Error('当前 Codex 模型均不可用，请等待额度恢复后重试。')
    return choices
  }
}

const CONTINUE = '上一个回合因模型额度或可用性中断。请在当前线程继续完成用户尚未完成的请求，保留已有工具结果；先检查已完成的操作和资源，不要重复部署或重复执行已成功的操作。'

/** One user request across multiple model attempts, always on the same thread. */
export class CodexTurnRunner {
  private index = 0
  private stopped = false
  private terminalTurns = new Set<string>()
  private quotaErrors = new Map<string, unknown>()
  turnId: string | null = null

  private rpc: CodexRpc
  private selector: CodexModelSelector
  private choices: CodexModelChoice[]
  private params: RecordValue
  private hooks: {
    started(id: string, model: string): void
    switched(model: string): void
    failed(error: unknown): void
  }

  constructor(rpc: CodexRpc, selector: CodexModelSelector, choices: CodexModelChoice[],
    params: RecordValue, hooks: CodexTurnRunner['hooks']) {
    if (!choices.length) throw new Error('当前 Codex 没有可用的候选模型')
    this.rpc = rpc
    this.selector = selector
    this.choices = choices
    this.params = params
    this.hooks = hooks
  }

  get model(): string { return this.choices[this.index].model }

  stop(): void { this.stopped = true }

  async start(continuation = false): Promise<void> {
    while (!this.stopped) {
      try {
        const result = await this.rpc('turn/start', {
          ...this.params, ...this.choices[this.index],
          ...(continuation ? { input: [{ type: 'text', text: CONTINUE, text_elements: [] }] } : {})
        })
        const id = result.turn?.id
        if (typeof id !== 'string') throw new Error('Codex app-server 未返回 turn id')
        if (this.stopped) {
          await this.rpc('turn/interrupt', { threadId: this.params.threadId, turnId: id })
          return
        }
        // turn/started can arrive before the RPC response.
        if (!this.terminalTurns.has(id)) {
          this.turnId = id
          this.hooks.started(id, this.model)
        }
        return
      } catch (error) {
        if (this.stopped) return
        if (!this.advance(error)) throw error
      }
    }
  }

  private advance(error: unknown): boolean {
    if (!isCodexModelUnavailable(error)) return false
    this.selector.block(this.model)
    if (this.index + 1 >= this.choices.length) return false
    this.index++
    this.hooks.switched(this.model)
    return true
  }

  handle(method: string | undefined, params: RecordValue): boolean {
    if (this.stopped) return true
    const id = params.turnId ?? params.turn?.id
    if (id && this.terminalTurns.has(id)) return true
    if (method === 'turn/started') this.turnId = id
    if (this.turnId && id && this.turnId !== id) return true
    if (method === 'error' && isCodexModelUnavailable(params.error)) {
      // Wait for the terminal event; never overlap with Codex's own retry/tools.
      if (params.willRetry !== true) this.quotaErrors.set(id ?? this.turnId ?? '', params.error)
      return params.willRetry !== true
    }
    if (method !== 'turn/completed' || params.turn?.status !== 'failed') return false
    if (this.stopped) return true
    const error = isCodexModelUnavailable(params.turn.error)
      ? params.turn.error : (this.quotaErrors.get(id) ?? params.turn.error)
    if (!this.advance(error)) return false
    this.terminalTurns.add(id)
    this.turnId = null
    void this.start(true).catch(error => {
      if (!this.stopped) this.hooks.failed(error)
    })
    return true
  }

  async cancel(): Promise<void> {
    this.stopped = true
    if (this.turnId) await this.rpc('turn/interrupt', { threadId: this.params.threadId, turnId: this.turnId })
  }
}
