import {
  AppErrorClass,
  type GenerationCapability,
  type Skill,
} from '@tengyu-aipod/shared'
import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions'
import { AliyunBailianAdapter } from './aliyun-bailian-adapter'
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
}

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
      input.model ?? (hasReferenceImages ? settings.bailian_vision_model : settings.bailian_text_model)
    const wantsJson =
      input.responseFormat === 'json_object' || promptAsksForJson(skill.systemPrompt)
    const response_format = wantsJson ? { type: 'json_object' as const } : undefined
    const chunks = chunkPromptCount(count)
    const promptChunks = await Promise.all(
      chunks.map(async (chunkCount) => {
        const messages = createPromptMessages(
          skill,
          { ...input.variables, count: chunkCount },
          input.refImages,
          input.userMessage,
        )
        const response = hasReferenceImages
          ? await adapter.visionCompletion({
              model,
              messages,
              ...(response_format ? { response_format } : {}),
            })
          : await adapter.chatCompletion({
              model,
              messages,
              ...(response_format ? { response_format } : {}),
            })

        return parsePromptJsonStrict(response.text, chunkCount)
      }),
    )
    const prompts = promptChunks.flat().slice(0, count)
    if (prompts.length === 0) {
      throw new AppErrorClass('HTTP_5XX', '模型返回 JSON 缺少 prompts 字符串数组', true, {
        kind: 'llm_parse_failed',
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
  })
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
    return cleanPrompts(parsed, count)
  }

  if (parsed && typeof parsed === 'object') {
    const record = parsed as Record<string, unknown>
    const value = record.prompts ?? record.items ?? record.data
    if (Array.isArray(value)) {
      return cleanPrompts(value, count)
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
  return cleanPrompts(value, count)
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

function normalizePromptCount(count: number) {
  if (!Number.isFinite(count)) {
    return 1
  }
  return Math.max(1, Math.min(1000, Math.floor(count)))
}

function chunkPromptCount(count: number) {
  const chunks: number[] = []
  let remaining = count
  while (remaining > 0) {
    const chunk = Math.min(100, remaining)
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
