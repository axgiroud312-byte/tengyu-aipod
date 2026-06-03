import { AppErrorClass } from '@tengyu-aipod/shared'
import { APIConnectionError, APIConnectionTimeoutError, APIError, OpenAI } from 'openai'
import type {
  ChatCompletion,
  ChatCompletionCreateParamsNonStreaming,
  ChatCompletionMessageParam,
} from 'openai/resources/chat/completions'

export type BailianRegion = 'cn' | 'sg' | 'us'

export type ChatRequest = {
  model: string
  messages: ChatCompletionMessageParam[]
  response_format?: { type: 'json_object' }
  temperature?: number
  max_tokens?: number
}

export type VisionRequest = Omit<ChatRequest, 'messages'> & {
  messages: ChatCompletionMessageParam[]
}

export type ChatResponse = {
  text: string
  model: string
  finishReason: ChatCompletion.Choice['finish_reason'] | null
  usage?: ChatCompletion['usage']
  raw: ChatCompletion
}

export type VisionResponse = ChatResponse

export type AliyunBailianAdapterOptions = {
  apiKey: string
  region: BailianRegion
  maxRetries?: number
  timeoutMs?: number
  baseURL?: string
}

type BailianChatCompletionParams = ChatCompletionCreateParamsNonStreaming & {
  enable_thinking?: false
}

const BAILIAN_BASE_URLS: Record<BailianRegion, string> = {
  cn: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
  sg: 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1',
  us: 'https://dashscope-us.aliyuncs.com/compatible-mode/v1',
}

export function bailianBaseUrl(region: BailianRegion) {
  return BAILIAN_BASE_URLS[region]
}

export class AliyunBailianAdapter {
  private readonly client: OpenAI

  constructor(options: AliyunBailianAdapterOptions) {
    this.client = new OpenAI({
      apiKey: options.apiKey,
      baseURL:
        options.baseURL ?? process.env.TENGYU_BAILIAN_BASE_URL ?? bailianBaseUrl(options.region),
      maxRetries: options.maxRetries ?? 2,
      timeout: options.timeoutMs ?? 30_000,
    })
  }

  async chatCompletion(req: ChatRequest): Promise<ChatResponse> {
    return this.createCompletion(req)
  }

  async visionCompletion(req: VisionRequest): Promise<VisionResponse> {
    return this.createCompletion(req)
  }

  private async createCompletion(req: ChatRequest) {
    try {
      const params: BailianChatCompletionParams = {
        model: req.model,
        messages: req.messages,
        enable_thinking: false,
      }
      if (req.response_format) {
        params.response_format = req.response_format
      }
      if (req.temperature !== undefined) {
        params.temperature = req.temperature
      }
      if (req.max_tokens !== undefined) {
        params.max_tokens = req.max_tokens
      }

      const completion = await this.client.chat.completions.create(params)

      return serializeCompletion(completion)
    } catch (error) {
      throw toBailianAppError(error)
    }
  }
}

function serializeCompletion(completion: ChatCompletion): ChatResponse {
  const choice = completion.choices[0]
  return {
    text: choice?.message.content ?? '',
    model: completion.model,
    finishReason: choice?.finish_reason ?? null,
    usage: completion.usage,
    raw: completion,
  }
}

export function toBailianAppError(error: unknown) {
  if (error instanceof APIConnectionTimeoutError) {
    return new AppErrorClass('NETWORK_TIMEOUT', '百炼请求超时', true, undefined, error)
  }

  if (error instanceof APIConnectionError) {
    return new AppErrorClass('NETWORK_OFFLINE', '无法连接阿里云百炼', true, undefined, error)
  }

  if (error instanceof APIError) {
    const status = error.status
    if (status === 401 || status === 403) {
      return new AppErrorClass('HTTP_4XX', '阿里云百炼 API Key 无效', false, { status }, error)
    }
    if (status === 429) {
      return new AppErrorClass(
        'HTTP_429',
        '阿里云百炼请求过于频繁，请稍后重试',
        true,
        { status },
        error,
      )
    }
    if (status === 402) {
      return new AppErrorClass(
        'BAILIAN_QUOTA_EXCEEDED',
        '阿里云百炼额度不足',
        false,
        { status },
        error,
      )
    }
    if (typeof status === 'number' && status >= 500) {
      return new AppErrorClass('HTTP_5XX', '阿里云百炼服务暂时不可用', true, { status }, error)
    }
    if (typeof status === 'number' && status >= 400) {
      return new AppErrorClass('HTTP_4XX', '阿里云百炼请求参数不正确', false, { status }, error)
    }
  }

  return new AppErrorClass('NETWORK_OFFLINE', '阿里云百炼请求失败', true, undefined, error)
}
