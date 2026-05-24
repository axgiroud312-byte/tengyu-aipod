import { type AppError, AppErrorClass } from '@tengyu-aipod/shared'

export type GrsaiNode = 'cn' | 'global'
export type GrsaiReplyType = 'json' | 'stream' | 'async'

export const GRSAI_SUPPORTED_MODELS = [
  'nano-banana',
  'nano-banana-fast',
  'nano-banana-2',
  'nano-banana-2-cl',
  'nano-banana-2-4k-cl',
  'nano-banana-pro',
  'nano-banana-pro-cl',
  'nano-banana-pro-vip',
  'nano-banana-pro-4k-vip',
  'gpt-image-2',
  'gpt-image-2-vip',
] as const

export type GrsaiModel = (typeof GRSAI_SUPPORTED_MODELS)[number]
export type GenerationCapability = 'txt2img' | 'img2img' | 'extract' | 'matting'

export type GenerateRequest = {
  capability: GenerationCapability
  prompt: string
  reference_images?: { base64: string; mime_type: string }[]
  output: {
    aspect_ratio?: string
    size_px?: { width: number; height: number }
    image_size_label?: '1K' | '2K' | '4K'
    format?: 'jpg' | 'png'
  }
  model?: string
  workflow_id?: string
  options?: Record<string, unknown> & {
    replyType?: GrsaiReplyType
  }
}

export type GenerateResponse = {
  status: 'succeeded' | 'failed' | 'violation'
  images: { url: string; local_path?: string }[]
  raw_response?: unknown
  error?: AppError
}

export interface ImageGenerationAdapter {
  generate(req: GenerateRequest): Promise<GenerateResponse>
}

export type GrsaiAdapterOptions = {
  timeoutMs?: number
  pollIntervalMs?: number
  pollTimeoutMs?: number
}

type GrsaiApiStatus = 'running' | 'violation' | 'succeeded' | 'failed'

type GrsaiApiResponse = {
  id?: string
  task_id?: string
  status?: GrsaiApiStatus | string
  progress?: number
  results?: { url?: string }[]
  error?: string | { message?: string } | null
}

type GrsaiGeneratePayload = {
  model: string
  prompt: string
  images: string[]
  aspectRatio: string
  imageSize: string
  replyType: GrsaiReplyType
}

const GRSAI_BASE_URLS: Record<GrsaiNode, string> = {
  cn: 'https://grsai.dakka.com.cn',
  global: 'https://grsaiapi.com',
}

const DEFAULT_MODEL: GrsaiModel = 'nano-banana-2'
const DEFAULT_TIMEOUT_MS = 300_000
const DEFAULT_POLL_INTERVAL_MS = 2_000
const DEFAULT_POLL_TIMEOUT_MS = 300_000

export function grsaiBaseUrl(node: GrsaiNode) {
  return GRSAI_BASE_URLS[node]
}

export function stripDataUrlPrefix(value: string) {
  if (!value.startsWith('data:')) {
    return value
  }
  const commaIndex = value.indexOf(',')
  return commaIndex === -1 ? value.slice('data:'.length) : value.slice(commaIndex + 1)
}

export class GrsaiAdapter implements ImageGenerationAdapter {
  private readonly timeoutMs: number
  private readonly pollIntervalMs: number
  private readonly pollTimeoutMs: number

  constructor(
    private readonly apiKey: string,
    private readonly node: GrsaiNode = 'cn',
    options: GrsaiAdapterOptions = {},
  ) {
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
    this.pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS
    this.pollTimeoutMs = options.pollTimeoutMs ?? DEFAULT_POLL_TIMEOUT_MS
  }

  async generate(req: GenerateRequest): Promise<GenerateResponse> {
    try {
      const primary = await this.generateOnNode(this.node, req)
      if (!shouldFallbackResponse(primary)) {
        return primary
      }

      try {
        return await this.generateOnNode(otherNode(this.node), req)
      } catch (error) {
        const fallbackError = toGrsaiAppError(error)
        if (isRetryableNodeFailure(fallbackError)) {
          return primary
        }
        throw fallbackError
      }
    } catch (error) {
      const appError = toGrsaiAppError(error)
      if (!isRetryableNodeFailure(appError)) {
        throw appError
      }

      try {
        return await this.generateOnNode(otherNode(this.node), req)
      } catch (fallbackError) {
        throw toGrsaiAppError(fallbackError)
      }
    }
  }

  private async generateOnNode(node: GrsaiNode, req: GenerateRequest) {
    const replyType = replyTypeFromRequest(req)

    if (replyType === 'async') {
      return this.generateAsync(node, req)
    }

    const payload = buildGeneratePayload(req, replyType)
    const raw =
      replyType === 'stream'
        ? await this.postGenerateStream(node, payload)
        : await this.postGenerateJson(node, payload)

    return responseFromRaw(raw, node)
  }

  private async generateAsync(node: GrsaiNode, req: GenerateRequest) {
    const initial = await this.postGenerateJson(node, buildGeneratePayload(req, 'async'))
    const initialStatus = statusFromRaw(initial)

    if (initialStatus && initialStatus !== 'running') {
      return responseFromRaw(initial, node)
    }

    const taskId = taskIdFromRaw(initial)
    if (!taskId) {
      return failedResponse(initial, node, 'Grsai 异步任务缺少 task id')
    }

    const startedAt = Date.now()
    while (Date.now() - startedAt <= this.pollTimeoutMs) {
      await sleep(this.pollIntervalMs)
      const latest = await this.getResult(node, taskId)
      if (statusFromRaw(latest) !== 'running') {
        return responseFromRaw(latest, node)
      }
    }

    throw new AppErrorClass('NETWORK_TIMEOUT', 'Grsai 异步任务等待超时', true, {
      kind: 'network',
      node,
      provider: 'grsai',
      taskId,
    })
  }

  private async postGenerateJson(node: GrsaiNode, payload: GrsaiGeneratePayload) {
    const response = await this.request(node, '/v1/api/generate', {
      method: 'POST',
      headers: jsonHeaders(this.apiKey),
      body: JSON.stringify(payload),
    })
    return parseJsonBody(response, node)
  }

  private async postGenerateStream(node: GrsaiNode, payload: GrsaiGeneratePayload) {
    const response = await this.request(node, '/v1/api/generate', {
      method: 'POST',
      headers: {
        ...jsonHeaders(this.apiKey),
        accept: 'text/event-stream',
      },
      body: JSON.stringify(payload),
    })
    return parseStreamBody(response, node)
  }

  private async getResult(node: GrsaiNode, taskId: string) {
    const response = await this.request(node, `/v1/api/result?id=${encodeURIComponent(taskId)}`, {
      method: 'GET',
      headers: jsonHeaders(this.apiKey),
    })
    return parseJsonBody(response, node)
  }

  private async request(node: GrsaiNode, path: string, init: RequestInit) {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs)

    try {
      const response = await fetch(`${grsaiBaseUrl(node)}${path}`, {
        ...init,
        signal: controller.signal,
      })
      if (!response.ok) {
        throw await httpErrorFromResponse(response, node)
      }
      return response
    } catch (error) {
      if (error instanceof AppErrorClass) {
        throw error
      }
      throw networkErrorFromCause(error, node)
    } finally {
      clearTimeout(timeout)
    }
  }
}

function buildGeneratePayload(
  req: GenerateRequest,
  replyType: GrsaiReplyType,
): GrsaiGeneratePayload {
  return {
    model: req.model ?? DEFAULT_MODEL,
    prompt: req.prompt,
    images: (req.reference_images ?? []).map((image) => stripDataUrlPrefix(image.base64)),
    aspectRatio: req.output.aspect_ratio ?? '1:1',
    imageSize: req.output.image_size_label ?? '1K',
    replyType,
  }
}

function replyTypeFromRequest(req: GenerateRequest): GrsaiReplyType {
  const value = req.options?.replyType
  if (value === undefined) {
    return 'json'
  }
  if (value === 'json' || value === 'stream' || value === 'async') {
    return value
  }
  throw new AppErrorClass('HTTP_4XX', '不支持的 Grsai replyType', false, {
    kind: 'failed',
    provider: 'grsai',
    replyType: value,
  })
}

function jsonHeaders(apiKey: string) {
  return {
    authorization: `Bearer ${apiKey}`,
    'content-type': 'application/json',
  }
}

async function parseJsonBody(response: Response, node: GrsaiNode): Promise<GrsaiApiResponse> {
  const text = await response.text()
  if (!text.trim()) {
    throw protocolError('Grsai 返回空响应', node)
  }

  try {
    return JSON.parse(text) as GrsaiApiResponse
  } catch (error) {
    throw protocolError('Grsai 返回格式无法解析', node, error)
  }
}

async function parseStreamBody(response: Response, node: GrsaiNode): Promise<GrsaiApiResponse> {
  const text = await response.text()
  const events: GrsaiApiResponse[] = []

  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith(':') || trimmed.startsWith('event:')) {
      continue
    }

    const data = trimmed.startsWith('data:') ? trimmed.slice('data:'.length).trim() : trimmed
    if (!data || data === '[DONE]') {
      continue
    }

    try {
      events.push(JSON.parse(data) as GrsaiApiResponse)
    } catch {}
  }

  const lastEvent = events.at(-1)
  if (lastEvent) {
    return lastEvent
  }

  try {
    return JSON.parse(text) as GrsaiApiResponse
  } catch (error) {
    throw protocolError('Grsai stream 返回格式无法解析', node, error)
  }
}

function responseFromRaw(raw: GrsaiApiResponse, node: GrsaiNode): GenerateResponse {
  const status = statusFromRaw(raw)

  if (status === 'succeeded') {
    return {
      status: 'succeeded',
      images: imagesFromRaw(raw),
      raw_response: raw,
    }
  }

  if (status === 'violation') {
    return {
      status: 'violation',
      images: [],
      raw_response: raw,
      error: new AppErrorClass(
        'GRSAI_VIOLATION',
        responseErrorMessage(raw) ?? 'Grsai 内容违规，请调整提示词',
        false,
        { kind: 'violation', node, provider: 'grsai' },
      ),
    }
  }

  return failedResponse(raw, node, responseErrorMessage(raw) ?? 'Grsai 生成失败')
}

function failedResponse(raw: GrsaiApiResponse, node: GrsaiNode, message: string): GenerateResponse {
  return {
    status: 'failed',
    images: [],
    raw_response: raw,
    error: new AppErrorClass('GRSAI_FAILED', message, true, {
      kind: 'failed',
      node,
      provider: 'grsai',
      status: raw.status ?? 'unknown',
    }),
  }
}

function statusFromRaw(raw: GrsaiApiResponse): GrsaiApiStatus | undefined {
  if (
    raw.status === 'running' ||
    raw.status === 'violation' ||
    raw.status === 'succeeded' ||
    raw.status === 'failed'
  ) {
    return raw.status
  }
  return undefined
}

function imagesFromRaw(raw: GrsaiApiResponse) {
  return (raw.results ?? [])
    .map((result) => result.url)
    .filter((url): url is string => typeof url === 'string' && url.length > 0)
    .map((url) => ({ url }))
}

function responseErrorMessage(raw: GrsaiApiResponse) {
  if (typeof raw.error === 'string' && raw.error.trim()) {
    return raw.error
  }
  if (raw.error && typeof raw.error === 'object' && typeof raw.error.message === 'string') {
    return raw.error.message
  }
  return null
}

function taskIdFromRaw(raw: GrsaiApiResponse) {
  if (typeof raw.id === 'string' && raw.id) {
    return raw.id
  }
  if (typeof raw.task_id === 'string' && raw.task_id) {
    return raw.task_id
  }
  return null
}

async function httpErrorFromResponse(response: Response, node: GrsaiNode) {
  const status = response.status
  const message = await readHttpErrorMessage(response)

  if (status === 401 || status === 403) {
    return new AppErrorClass('HTTP_4XX', 'Grsai API Key 无效', false, {
      kind: 'failed',
      node,
      provider: 'grsai',
      status,
      message,
    })
  }

  if (status === 429) {
    return new AppErrorClass('HTTP_429', 'Grsai 请求过于频繁，请稍后重试', true, {
      kind: 'network',
      node,
      provider: 'grsai',
      status,
      message,
    })
  }

  if (status >= 500) {
    return new AppErrorClass('HTTP_5XX', 'Grsai 服务暂时不可用', true, {
      kind: 'network',
      node,
      provider: 'grsai',
      status,
      message,
    })
  }

  return new AppErrorClass('HTTP_4XX', 'Grsai 请求参数不正确', false, {
    kind: 'failed',
    node,
    provider: 'grsai',
    status,
    message,
  })
}

async function readHttpErrorMessage(response: Response) {
  const text = await response.text().catch(() => '')
  if (!text.trim()) {
    return ''
  }

  try {
    const parsed = JSON.parse(text) as { error?: string | { message?: string }; message?: string }
    if (typeof parsed.error === 'string') {
      return parsed.error
    }
    if (
      parsed.error &&
      typeof parsed.error === 'object' &&
      typeof parsed.error.message === 'string'
    ) {
      return parsed.error.message
    }
    if (typeof parsed.message === 'string') {
      return parsed.message
    }
  } catch {}

  return text
}

function networkErrorFromCause(error: unknown, node: GrsaiNode) {
  if (isAbortError(error)) {
    return new AppErrorClass('NETWORK_TIMEOUT', 'Grsai 请求超时', true, {
      kind: 'network',
      node,
      provider: 'grsai',
    })
  }

  return new AppErrorClass('NETWORK_OFFLINE', '无法连接 Grsai', true, {
    kind: 'network',
    node,
    provider: 'grsai',
  })
}

function protocolError(message: string, node: GrsaiNode, cause?: unknown) {
  return new AppErrorClass(
    'HTTP_5XX',
    message,
    true,
    { kind: 'network', node, provider: 'grsai' },
    cause,
  )
}

function toGrsaiAppError(error: unknown) {
  if (error instanceof AppErrorClass) {
    return error
  }
  return new AppErrorClass('NETWORK_OFFLINE', 'Grsai 请求失败', true, {
    kind: 'network',
    provider: 'grsai',
  })
}

function isRetryableNodeFailure(error: AppErrorClass) {
  return error.retryable && error.details?.kind === 'network'
}

function shouldFallbackResponse(response: GenerateResponse) {
  return response.status === 'failed' && response.error?.retryable === true
}

function isAbortError(error: unknown) {
  return error instanceof DOMException && error.name === 'AbortError'
}

function otherNode(node: GrsaiNode): GrsaiNode {
  return node === 'cn' ? 'global' : 'cn'
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
