import { AppErrorClass } from '@tengyu-aipod/shared'

export type ComfyHttpClientOptions = {
  timeoutMs?: number
  pollIntervalMs?: number
  pollTimeoutMs?: number
}

export type ComfyPromptResponse = {
  prompt_id?: string
  number?: number
  node_errors?: Record<string, unknown>
}

export type ComfyHistoryEntry = {
  status?: {
    completed?: boolean
    status_str?: string
    messages?: unknown[]
  }
  outputs?: Record<string, unknown>
  [key: string]: unknown
}

export type ComfyHistoryResponse = Record<string, ComfyHistoryEntry>

type ComfyUploadResponse = {
  name?: string
  subfolder?: string
  type?: string
}

export type ComfyViewImageInput =
  | string
  | {
      filename: string
      subfolder?: string | undefined
      type?: string | undefined
    }

const DEFAULT_TIMEOUT_MS = 60_000
const DEFAULT_POLL_INTERVAL_MS = 2_000
const DEFAULT_POLL_TIMEOUT_MS = 300_000

export class ComfyHttpClient {
  private readonly baseUrl: string
  private readonly timeoutMs: number
  private readonly pollIntervalMs: number
  private readonly pollTimeoutMs: number

  constructor(baseUrl: string, options: ComfyHttpClientOptions = {}) {
    this.baseUrl = baseUrl.replace(/\/+$/, '')
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
    this.pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS
    this.pollTimeoutMs = options.pollTimeoutMs ?? DEFAULT_POLL_TIMEOUT_MS
  }

  async uploadImage(buffer: Buffer, filename: string) {
    const form = new FormData()
    const bytes = new Uint8Array(buffer.byteLength)
    bytes.set(buffer)
    form.set('image', new Blob([bytes]), filename)

    const response = await this.request('/upload/image', {
      method: 'POST',
      body: form,
    })
    const raw = await parseJsonBody<ComfyUploadResponse>(response)

    if (!raw.name) {
      throw protocolError('ComfyUI 上传图片响应缺少文件名')
    }

    return raw.name
  }

  async queuePrompt(workflow: unknown) {
    const response = await this.request('/prompt', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({ prompt: workflow }),
    })
    const raw = await parseJsonBody<ComfyPromptResponse>(response)

    if (!raw.prompt_id) {
      throw protocolError('ComfyUI 提交工作流响应缺少 prompt_id')
    }

    return raw.prompt_id
  }

  async getHistory(promptId: string) {
    const startedAt = Date.now()

    while (Date.now() - startedAt <= this.pollTimeoutMs) {
      const response = await this.request(`/history/${encodeURIComponent(promptId)}`, {
        method: 'GET',
      })
      const raw = await parseJsonBody<ComfyHistoryResponse>(response)
      const entry = raw[promptId]

      if (entry?.status?.completed === true) {
        return entry
      }

      await sleep(this.pollIntervalMs)
    }

    throw new AppErrorClass('NETWORK_TIMEOUT', 'ComfyUI 工作流等待超时', true, {
      kind: 'network',
      provider: 'comfyui-chenyu',
      promptId,
    })
  }

  async viewImage(input: ComfyViewImageInput) {
    const params = new URLSearchParams()
    const filename = typeof input === 'string' ? input : input.filename
    params.set('filename', filename)
    if (typeof input !== 'string') {
      if (input.subfolder) {
        params.set('subfolder', input.subfolder)
      }
      if (input.type) {
        params.set('type', input.type)
      }
    }
    const response = await this.request(`/view?${params.toString()}`, { method: 'GET' })
    return Buffer.from(await response.arrayBuffer())
  }

  private async request(path: string, init: RequestInit) {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs)

    try {
      const response = await fetch(`${this.baseUrl}${path}`, {
        ...init,
        signal: controller.signal,
      })
      if (!response.ok) {
        throw await httpErrorFromResponse(response)
      }
      return response
    } catch (error) {
      if (error instanceof AppErrorClass) {
        throw error
      }
      throw networkErrorFromCause(error)
    } finally {
      clearTimeout(timeout)
    }
  }
}

async function parseJsonBody<T>(response: Response): Promise<T> {
  const text = await response.text()
  if (!text.trim()) {
    throw protocolError('ComfyUI 返回空响应')
  }

  try {
    return JSON.parse(text) as T
  } catch (error) {
    throw protocolError('ComfyUI 返回格式无法解析', error)
  }
}

async function httpErrorFromResponse(response: Response) {
  const status = response.status
  const message = await readHttpErrorMessage(response)

  if (status === 429 || isQueueFullMessage(message)) {
    return new AppErrorClass('HTTP_429', 'ComfyUI 队列繁忙，请稍后重试', true, {
      kind: 'network',
      provider: 'comfyui-chenyu',
      status,
      message,
    })
  }

  if (status >= 500) {
    return new AppErrorClass('HTTP_5XX', 'ComfyUI 服务暂时不可用', true, {
      kind: 'network',
      provider: 'comfyui-chenyu',
      status,
      message,
    })
  }

  return new AppErrorClass('HTTP_4XX', 'ComfyUI 请求参数不正确', false, {
    kind: 'failed',
    provider: 'comfyui-chenyu',
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

function networkErrorFromCause(error: unknown) {
  if (isAbortError(error)) {
    return new AppErrorClass('NETWORK_TIMEOUT', 'ComfyUI 请求超时', true, {
      kind: 'network',
      provider: 'comfyui-chenyu',
    })
  }

  return new AppErrorClass('NETWORK_OFFLINE', '无法连接 ComfyUI', true, {
    kind: 'network',
    provider: 'comfyui-chenyu',
  })
}

function protocolError(message: string, cause?: unknown) {
  return new AppErrorClass(
    'HTTP_5XX',
    message,
    true,
    { kind: 'network', provider: 'comfyui-chenyu' },
    cause,
  )
}

function isQueueFullMessage(message: string) {
  const normalized = message.toLowerCase()
  return (
    normalized.includes('queue') && (normalized.includes('full') || normalized.includes('busy'))
  )
}

function isAbortError(error: unknown) {
  return error instanceof DOMException && error.name === 'AbortError'
}

function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms))
}
