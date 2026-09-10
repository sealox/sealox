import { wrapLanguageModel, type LanguageModelMiddleware } from 'ai'
import type { LanguageModelV4 } from '@ai-sdk/provider'

const QUOTA_ERROR = /(429|quota|rate[ -]?limit|resource[ -]?exhausted|insufficient[ -]?quota|usage[ -]?limit|credit|额度|用量|限额|耗尽)/i

function errorText(error: unknown): string {
  if (error instanceof Error) return `${error.message} ${error.cause ? errorText(error.cause) : ''}`
  if (typeof error === 'string') return error
  try { return JSON.stringify(error) }
  catch { return String(error) }
}

export function isModelQuotaError(error: unknown): boolean {
  return QUOTA_ERROR.test(errorText(error))
}

export function readFallbackModels(raw: string | undefined, primary: string): string[] {
  if (!raw) return []
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed
      .filter((item): item is string => typeof item === 'string' && item.trim() !== '' && item !== primary)
      .filter((item, index, all) => all.indexOf(item) === index)
  } catch { return [] }
}

export function withModelFallback(primary: LanguageModelV4, fallbacks: LanguageModelV4[]): LanguageModelV4 {
  const models = [primary, ...fallbacks]
  const middleware: LanguageModelMiddleware = {
    specificationVersion: 'v4',
    wrapGenerate: async ({ params }) => {
      let lastError: unknown
      for (const model of models) {
        try { return await model.doGenerate(params) }
        catch (error) {
          lastError = error
          if (!isModelQuotaError(error)) throw error
          console.warn(`[eve] model quota exhausted; trying ${model.modelId === primary.modelId ? 'fallback' : 'next fallback'} model`)
        }
      }
      throw lastError
    },
    wrapStream: async ({ params }) => {
      let lastError: unknown
      for (const model of models) {
        try { return await model.doStream(params) }
        catch (error) {
          lastError = error
          if (!isModelQuotaError(error)) throw error
          console.warn(`[eve] model quota exhausted; trying ${model.modelId === primary.modelId ? 'fallback' : 'next fallback'} model`)
        }
      }
      throw lastError
    }
  }
  return wrapLanguageModel({ model: primary, middleware })
}
