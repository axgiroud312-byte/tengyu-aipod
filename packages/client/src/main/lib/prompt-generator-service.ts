import { AppErrorClass, type GenerationCapability, type Skill } from '@tengyu-aipod/shared'
import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions'
import { AliyunBailianAdapter, type ChatResponse } from './aliyun-bailian-adapter'
import { type DiagnosticLogWriter, errorForDiagnosticLog } from './diagnostic-log-service'
import { normalizeGenerationLocalConfig } from './generation-local-config'
import { getSecret } from './keychain'
import { skillCacheManager } from './skill-cache'
import { readAppConfig } from './workbench-config'

export type PromptReferenceImage = {
  base64: string
  mime_type: string
}

export type GeneratePromptsInput = {
  skill?: Skill
  skillId?: string
  skillVersion?: string
  category?: string
  variables?: Record<string, unknown>
  refImages?: PromptReferenceImage[]
  count: number
  model?: string
  userMessage?: string
  responseFormat?: 'json_object' | 'text'
  diagnostics?: DiagnosticLogWriter
  onRawResponse?: (response: {
    text: string
    model: string
    finishReason: string | null
    expected: number
    chunkIndex: number
    chunkTotal: number
  }) => void | Promise<void>
}

const DEFAULT_BAILIAN_TIMEOUT_MS = 600_000
const DEFAULT_PROMPT_CHUNK_SIZE = 100
const PROMPT_CHUNK_CONCURRENCY = 10
const DEFAULT_PROMPT_CHUNK_RETRIES = 2

export type PromptGeneratorDependencies = {
  skillCache?: Pick<typeof skillCacheManager, 'getSkill' | 'listSkills'>
  getSecret?: typeof getSecret
  readConfig?: typeof readAppConfig
  createBailianAdapter?: (
    apiKey: string,
  ) => Pick<AliyunBailianAdapter, 'chatCompletion' | 'visionCompletion'>
}

export class PromptGeneratorService {
  async generatePrompts(
    input: GeneratePromptsInput,
    dependencies: PromptGeneratorDependencies = {},
  ): Promise<string[]> {
    const count = normalizePromptCount(input.count)
    const skill = await this.resolveSkill(input, dependencies.skillCache ?? skillCacheManager)
    const apiKey = await (dependencies.getSecret ?? getSecret)('bailian')
    if (!apiKey) {
      throw new AppErrorClass('HTTP_4XX', '缺少阿里云百炼 API Key', false, {
        provider: 'aliyun-bailian',
      })
    }

    const adapter =
      dependencies.createBailianAdapter?.(apiKey) ?? createDefaultBailianAdapter(apiKey)
    const hasReferenceImages = Boolean(input.refImages?.length)
    const settings = normalizeGenerationLocalConfig(
      (await (dependencies.readConfig ?? readAppConfig)()).generation,
    )
    const model =
      input.model ??
      (hasReferenceImages ? settings.bailian_vision_model : settings.bailian_text_model)
    const wantsJson =
      input.responseFormat === 'json_object' || promptAsksForJson(skill.systemPrompt)
    const response_format = wantsJson ? { type: 'json_object' as const } : undefined
    const chunkCounts = chunkPromptCount(
      count,
      envInt('TENGYU_BAILIAN_PROMPT_CHUNK_SIZE', 1, 100, DEFAULT_PROMPT_CHUNK_SIZE),
    )
    const chunks = chunkCounts.map((chunkCount, index) => ({
      chunkCount,
      chunkIndex: index + 1,
      chunkTotal: chunkCounts.length,
    }))
    const promptChunks = await mapWithConcurrency(chunks, PROMPT_CHUNK_CONCURRENCY, (chunk) =>
      retryPromptChunk(
        async () => {
          const chunkCount = chunk.chunkCount
          const messages = createPromptMessages(
            skill,
            { ...input.variables, count: chunkCount },
            input.refImages,
            input.userMessage,
          )
          const request = {
            model,
            messages,
            ...(response_format ? { response_format } : {}),
          }
          const operation = hasReferenceImages ? 'visionCompletion' : 'chatCompletion'
          await input.diagnostics?.append({
            type: 'request',
            provider: 'aliyun-bailian',
            operation,
            itemKey: `chunk-${chunk.chunkIndex}`,
            data: {
              chunkIndex: chunk.chunkIndex,
              chunkTotal: chunk.chunkTotal,
              expected: chunkCount,
              request,
            },
          })
          let response: ChatResponse
          try {
            response = hasReferenceImages
              ? await adapter.visionCompletion(request)
              : await adapter.chatCompletion(request)
          } catch (error) {
            await input.diagnostics?.append({
              type: 'error',
              provider: 'aliyun-bailian',
              operation,
              itemKey: `chunk-${chunk.chunkIndex}`,
              error: errorForDiagnosticLog(error),
            })
            throw error
          }

          await input.onRawResponse?.({
            text: response.text,
            model: response.model,
            finishReason: response.finishReason ?? null,
            expected: chunkCount,
            chunkIndex: chunk.chunkIndex,
            chunkTotal: chunk.chunkTotal,
          })
          await input.diagnostics?.append({
            type: 'response',
            provider: 'aliyun-bailian',
            operation,
            itemKey: `chunk-${chunk.chunkIndex}`,
            data: {
              chunkIndex: chunk.chunkIndex,
              chunkTotal: chunk.chunkTotal,
              expected: chunkCount,
              text: response.text,
              model: response.model,
              finishReason: response.finishReason ?? null,
              usage: response.usage ?? null,
              raw: response.raw,
            },
          })

          const prompts = parsePromptJsonStrict(response.text, chunkCount)
          if (prompts.length !== chunkCount) {
            throw new AppErrorClass('HTTP_5XX', '模型返回 JSON 缺少 prompts 字符串数组', true, {
              kind: 'llm_parse_failed',
              expected: chunkCount,
              actual: prompts.length,
              rawResponse: response.text,
              rawResponsePreview: rawResponsePreview(response.text),
              responseModel: response.model,
              finishReason: response.finishReason ?? null,
            })
          }
          await input.diagnostics?.append({
            type: 'parse',
            provider: 'aliyun-bailian',
            operation,
            itemKey: `chunk-${chunk.chunkIndex}`,
            data: {
              chunkIndex: chunk.chunkIndex,
              expected: chunkCount,
              parsed: prompts.length,
            },
          })
          return prompts
        },
        envInt('TENGYU_BAILIAN_PROMPT_CHUNK_RETRIES', 0, 5, DEFAULT_PROMPT_CHUNK_RETRIES),
      ),
    )
    const prompts = promptChunks.flat().slice(0, count)
    if (prompts.length !== count) {
      throw new AppErrorClass('HTTP_5XX', '模型返回 JSON 缺少 prompts 字符串数组', true, {
        kind: 'llm_parse_failed',
        expected: count,
        actual: prompts.length,
      })
    }
    return prompts
  }

  private async resolveSkill(
    input: GeneratePromptsInput,
    skillCache: Pick<typeof skillCacheManager, 'getSkill' | 'listSkills'>,
  ) {
    if (input.skill) {
      return input.skill
    }

    if (input.skillId) {
      return skillCache.getSkill(input.skillId, input.skillVersion)
    }

    if (!input.category) {
      throw new AppErrorClass('HTTP_4XX', '缺少提示词 Skill', false, {
        provider: 'aliyun-bailian',
      })
    }

    const summaries = await skillCache.listSkills({
      module: 'generation',
      category: input.category,
    })
    const first = summaries[0]
    if (!first) {
      throw new AppErrorClass('HTTP_4XX', '没有可用的生图提示词 Skill', false, {
        category: input.category,
        provider: 'aliyun-bailian',
      })
    }

    return skillCache.getSkill(first.id, first.version)
  }
}

export const promptGeneratorService = new PromptGeneratorService()

function createDefaultBailianAdapter(apiKey: string) {
  return new AliyunBailianAdapter({
    apiKey,
    region: 'cn',
    maxRetries: 0,
    timeoutMs: envInt('TENGYU_BAILIAN_TIMEOUT_MS', 1_000, 600_000, DEFAULT_BAILIAN_TIMEOUT_MS),
  })
}

async function retryPromptChunk<T>(operation: () => Promise<T>, retries: number) {
  let attempt = 0
  while (true) {
    try {
      return await operation()
    } catch (error) {
      if (attempt >= retries) {
        throw error
      }
      attempt += 1
    }
  }
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  mapper: (item: T) => Promise<R>,
) {
  const results = new Array<R>(items.length)
  let nextIndex = 0
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (nextIndex < items.length) {
      const index = nextIndex
      nextIndex += 1
      results[index] = await mapper(items[index] as T)
    }
  })
  await Promise.all(workers)
  return results
}

function envInt(name: string, min: number, max: number, fallback: number) {
  const parsed = Number(process.env[name])
  if (!Number.isFinite(parsed)) {
    return fallback
  }
  return Math.max(min, Math.min(max, Math.floor(parsed)))
}

function rawResponsePreview(text: string, maxLength = 800) {
  const normalized = text.replace(/\s+/g, ' ').trim()
  if (normalized.length <= maxLength) {
    return normalized
  }
  return `${normalized.slice(0, maxLength)}...`
}

export function parsePromptJsonStrict(text: string, count: number): string[] {
  const limit = normalizePromptCount(count)
  return parseStrictPromptJson(text, limit) ?? parseStrictPromptJsonFromCodeBlock(text, limit) ?? []
}

export function parsePrompts(text: string, count: number): string[] {
  const limit = normalizePromptCount(count)
  return (
    parsePromptJson(text, limit) ??
    parsePromptJsonFromCodeBlock(text, limit) ??
    parsePromptLines(text, limit)
  )
}

export function createPromptMessages(
  skill: Skill,
  variables: Record<string, unknown> = {},
  refImages: PromptReferenceImage[] = [],
  userMessage = '请按要求生成印花提示词。',
): ChatCompletionMessageParam[] {
  const variablePrompt = renderVariables(variables)
  const text = variablePrompt ? `${userMessage}\n\n变量：\n${variablePrompt}` : userMessage

  if (refImages.length === 0) {
    return [
      { role: 'system', content: injectVariables(skill.systemPrompt, variables) },
      { role: 'user', content: text },
    ]
  }

  return [
    { role: 'system', content: injectVariables(skill.systemPrompt, variables) },
    {
      role: 'user',
      content: [
        ...refImages.map((image) => ({
          type: 'image_url' as const,
          image_url: { url: toDataUrl(image) },
        })),
        { type: 'text' as const, text },
      ],
    },
  ]
}

export function injectVariables(template: string, variables: Record<string, unknown>) {
  return template.replace(/\{\{\s*([\w.-]+)\s*\}\}|\{\s*([\w.-]+)\s*\}/g, (match, a, b) => {
    const key = String(a ?? b)
    if (!(key in variables)) {
      return match
    }
    return renderValue(variables[key])
  })
}

function parsePromptJson(text: string, count: number) {
  try {
    return promptsFromParsed(JSON.parse(text), count)
  } catch {
    return null
  }
}

function parsePromptJsonFromCodeBlock(text: string, count: number) {
  const codeBlock = text.match(/```(?:json)?\s*([\s\S]+?)\s*```/i)
  if (!codeBlock?.[1]) {
    return null
  }
  return parsePromptJson(codeBlock[1], count)
}

function parseStrictPromptJson(text: string, count: number) {
  try {
    return strictPromptsFromParsed(JSON.parse(text), count)
  } catch {
    return null
  }
}

function parseStrictPromptJsonFromCodeBlock(text: string, count: number) {
  const codeBlock = text.match(/```(?:json)?\s*([\s\S]+?)\s*```/i)
  if (!codeBlock?.[1]) {
    return null
  }
  return parseStrictPromptJson(codeBlock[1], count)
}

function promptsFromParsed(parsed: unknown, count: number) {
  if (Array.isArray(parsed)) {
    return promptsFromItems(parsed, count)
  }

  if (parsed && typeof parsed === 'object') {
    const record = parsed as Record<string, unknown>
    const value = record.prompts ?? record.items ?? record.data
    if (Array.isArray(value)) {
      return promptsFromItems(value, count)
    }
  }

  return null
}

function strictPromptsFromParsed(parsed: unknown, count: number) {
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return null
  }

  const value = (parsed as Record<string, unknown>).prompts
  if (!Array.isArray(value)) {
    return null
  }
  return promptsFromItems(value, count)
}

function parsePromptLines(text: string, count: number) {
  return cleanPrompts(
    text.split(/\r?\n/).map((line) => line.replace(/^\s*(?:\d+[.、）)]|[-*•])\s*/, '')),
    count,
  )
}

function cleanPrompts(values: unknown[], count: number) {
  return values
    .map((value) => String(value).trim())
    .filter(Boolean)
    .slice(0, count)
}

function promptsFromItems(values: unknown[], count: number) {
  const items = values.map((value, position) => promptItemFromValue(value, position))
  if (items.some((item) => item === null)) {
    return null
  }

  const promptItems = items.filter((item): item is NonNullable<typeof item> => Boolean(item))
  const sortedItems = hasCompleteIndexSequence(promptItems)
    ? [...promptItems].sort((left, right) => left.index - right.index)
    : promptItems

  return cleanPrompts(
    sortedItems.map((item) => item.prompt),
    count,
  )
}

function promptItemFromValue(value: unknown, position: number) {
  if (typeof value === 'string') {
    return { index: position + 1, prompt: value }
  }

  if (!value || typeof value !== 'object') {
    return null
  }

  const record = value as Record<string, unknown>
  if (typeof record.prompt !== 'string') {
    return null
  }

  return {
    index:
      typeof record.index === 'number' && Number.isInteger(record.index)
        ? record.index
        : position + 1,
    prompt: record.prompt,
  }
}

function hasCompleteIndexSequence(items: Array<{ index: number }>) {
  const indexes = items.map((item) => item.index).sort((left, right) => left - right)
  return indexes.every((index, position) => index === position + 1)
}

function normalizePromptCount(count: number) {
  if (!Number.isFinite(count)) {
    return 1
  }
  return Math.max(1, Math.min(1000, Math.floor(count)))
}

function chunkPromptCount(count: number, chunkSize = DEFAULT_PROMPT_CHUNK_SIZE) {
  const chunks: number[] = []
  let remaining = count
  while (remaining > 0) {
    const chunk = Math.min(chunkSize, remaining)
    chunks.push(chunk)
    remaining -= chunk
  }
  return chunks
}

function renderVariables(variables: Record<string, unknown>) {
  return Object.entries(variables)
    .map(([key, value]) => `${key}: ${renderValue(value)}`)
    .join('\n')
}

function renderValue(value: unknown): string {
  if (Array.isArray(value)) {
    return value.map(renderValue).join(', ')
  }
  if (value && typeof value === 'object') {
    return JSON.stringify(value)
  }
  return String(value ?? '')
}

function toDataUrl(image: PromptReferenceImage) {
  if (image.base64.startsWith('data:')) {
    return image.base64
  }
  return `data:${image.mime_type};base64,${image.base64}`
}

function promptAsksForJson(systemPrompt: string) {
  return /json/i.test(systemPrompt)
}
