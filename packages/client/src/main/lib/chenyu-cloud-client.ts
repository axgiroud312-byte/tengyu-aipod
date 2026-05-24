import { AppErrorClass } from '@tengyu-aipod/shared'

export const CHENYU_BASE_URL = 'https://www.chenyu.cn/api/open/v2'

export const ChenyuInstanceStatus = {
  Initializing: 1,
  Running: 2,
  ShuttingDown: 21,
  Stopped: 22,
} as const

export type ChenyuInstanceStatusCode =
  (typeof ChenyuInstanceStatus)[keyof typeof ChenyuInstanceStatus]

export type ChenyuInstanceStatusName =
  | 'initializing'
  | 'running'
  | 'shutting_down'
  | 'stopped'
  | 'unknown'

export type ChenyuCloudClientOptions = {
  baseUrl?: string
  timeoutMs?: number
  maxRetries?: number
  sleep?: (ms: number) => Promise<void>
}

export type ChenyuListParams = {
  page?: number
  page_size?: number
  name?: string
}

export type ChenyuCreateByPodInput = {
  pod_uuid: string
  pod_tag?: string
  gpu_uuid: string
  gpu_nums?: number
}

export type ChenyuStartupInput = {
  instance_uuid: string
  gpu_uuid?: string
  gpu_nums?: number
}

export type ChenyuShutdownTimerInput = {
  instance_uuid: string
  enable: boolean
  shutdown_time: number
}

export type ChenyuPod = {
  title: string
  uuid: string
  remark?: string
  pod_tag?: string[]
  price?: ChenyuPrice
}

export type ChenyuGpu = {
  gpu_name: string
  gpu_uuid: string
  status: number
  price?: ChenyuPrice
}

export type ChenyuImage = Record<string, unknown>

export type ChenyuPrice = {
  hour?: number
  day?: number
  week?: number
  month?: number
  year?: number
}

export type ChenyuServerMapEntry = {
  title?: string
  url?: string
  port_type?: string
  protocol?: string
  ssh_info?: Record<string, unknown>
}

export type ChenyuInstanceInfo = {
  instance_uuid: string
  status: number
  title?: string
  server_url?: string[]
  server_map?: ChenyuServerMapEntry[]
  shutdown_regular?: {
    shutdown_time?: number
    enable?: boolean
  }
  [key: string]: unknown
}

export type ChenyuBalance = {
  balance: number
  card_balance: number
}

type ChenyuEnvelope<T> = {
  code: number
  msg?: string
  data?: T
}

type ChenyuListPodsResponse = {
  pod_list?: ChenyuPod[]
  total?: number
}

type ChenyuListGpusResponse = {
  gpu_list?: ChenyuGpu[]
  total?: number
}

type ChenyuListImagesResponse = {
  image_list?: ChenyuImage[]
  total?: number
}

type ChenyuListInstancesResponse = {
  instance_list?: ChenyuInstanceInfo[]
  total?: number
}

const DEFAULT_TIMEOUT_MS = 30_000
const DEFAULT_MAX_RETRIES = 3
const DEFAULT_RETRY_DELAY_MS = 500

export class ChenyuCloudClient {
  private readonly baseUrl: string
  private readonly timeoutMs: number
  private readonly maxRetries: number
  private readonly sleep: (ms: number) => Promise<void>

  constructor(
    private readonly apiKey: string,
    options: ChenyuCloudClientOptions = {},
  ) {
    this.baseUrl = (options.baseUrl ?? CHENYU_BASE_URL).replace(/\/+$/, '')
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
    this.maxRetries = options.maxRetries ?? DEFAULT_MAX_RETRIES
    this.sleep = options.sleep ?? delay
  }

  async listPods(params: ChenyuListParams = {}) {
    const data = await this.get<ChenyuListPodsResponse>('/pod/list', params)
    return {
      items: data.pod_list ?? [],
      total: data.total ?? 0,
    }
  }

  async listGpus(params: Omit<ChenyuListParams, 'name'> = {}) {
    const data = await this.get<ChenyuListGpusResponse>('/gpu/list', params)
    return {
      items: data.gpu_list ?? [],
      total: data.total ?? 0,
    }
  }

  async listImages(params: ChenyuListParams = {}) {
    const data = await this.get<ChenyuListImagesResponse>('/image/market/list', params)
    return {
      items: data.image_list ?? [],
      total: data.total ?? 0,
    }
  }

  async createByPod(input: ChenyuCreateByPodInput) {
    return this.post<ChenyuInstanceInfo>('/instance/create_by_pod', {
      gpu_nums: 1,
      ...input,
    })
  }

  async getInstanceInfo(instance_uuid: string) {
    return this.get<ChenyuInstanceInfo>('/instance/info', { instance_uuid })
  }

  async listInstances(params: Omit<ChenyuListParams, 'name'> = {}) {
    const data = await this.get<ChenyuListInstancesResponse>('/instance/list', params)
    return {
      items: data.instance_list ?? [],
      total: data.total ?? 0,
    }
  }

  async startup(input: ChenyuStartupInput) {
    return this.post<ChenyuInstanceInfo>('/instance/startup', input)
  }

  async shutdown(instance_uuid: string) {
    return this.post<ChenyuInstanceInfo>('/instance/shutdown', { instance_uuid })
  }

  async restart(instance_uuid: string) {
    return this.post<ChenyuInstanceInfo>('/instance/restart', { instance_uuid })
  }

  async setShutdownTimer(input: ChenyuShutdownTimerInput) {
    return this.post<ChenyuInstanceInfo>('/instance/shutdown_timer', input)
  }

  async destroy(instance_uuid: string) {
    return this.post<ChenyuInstanceInfo>('/instance/destroy', { instance_uuid })
  }

  async getBalance() {
    return this.get<ChenyuBalance>('/balance/info')
  }

  private async get<T>(path: string, params: Record<string, string | number | undefined> = {}) {
    const query = queryString(params)
    return this.request<T>(`${path}${query}`, { method: 'GET' })
  }

  private async post<T>(path: string, body: unknown) {
    return this.request<T>(path, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify(body),
    })
  }

  private async request<T>(path: string, init: RequestInit) {
    let attempt = 0

    while (true) {
      try {
        return await this.requestOnce<T>(path, init)
      } catch (error) {
        const appError = toChenyuAppError(error)
        if (!shouldRetry(appError, attempt, this.maxRetries)) {
          throw appError
        }

        attempt += 1
        await this.sleep(retryDelayMs(appError, attempt))
      }
    }
  }

  private async requestOnce<T>(path: string, init: RequestInit) {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs)

    try {
      const response = await fetch(`${this.baseUrl}${path}`, {
        ...init,
        headers: {
          authorization: `Bearer ${this.apiKey}`,
          ...init.headers,
        },
        signal: controller.signal,
      })
      if (!response.ok) {
        throw await httpErrorFromResponse(response)
      }
      const envelope = await parseJsonBody<ChenyuEnvelope<T>>(response)
      if (envelope.code !== 0) {
        throw businessErrorFromEnvelope(envelope)
      }
      if (envelope.data === undefined) {
        throw protocolError('晨羽智云返回缺少 data')
      }
      return envelope.data
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

export function chenyuStatusName(status: number): ChenyuInstanceStatusName {
  if (status === ChenyuInstanceStatus.Initializing) {
    return 'initializing'
  }
  if (status === ChenyuInstanceStatus.Running) {
    return 'running'
  }
  if (status === ChenyuInstanceStatus.ShuttingDown) {
    return 'shutting_down'
  }
  if (status === ChenyuInstanceStatus.Stopped) {
    return 'stopped'
  }
  return 'unknown'
}

async function parseJsonBody<T>(response: Response): Promise<T> {
  const text = await response.text()
  if (!text.trim()) {
    throw protocolError('晨羽智云返回空响应')
  }

  try {
    return JSON.parse(text) as T
  } catch (error) {
    throw protocolError('晨羽智云返回格式无法解析', error)
  }
}

async function httpErrorFromResponse(response: Response) {
  const status = response.status
  const message = await readHttpErrorMessage(response)
  const retryAfterMs = retryAfterHeaderMs(response.headers.get('retry-after'))

  if (status === 401 || status === 403) {
    return new AppErrorClass('HTTP_4XX', '晨羽智云 API Key 无效', false, {
      kind: 'failed',
      provider: 'comfyui-chenyu',
      status,
      message,
    })
  }

  if (status === 429) {
    return new AppErrorClass('HTTP_429', '晨羽智云请求过于频繁，请稍后重试', true, {
      kind: 'network',
      provider: 'comfyui-chenyu',
      status,
      message,
      retryAfterMs,
    })
  }

  if (status >= 500) {
    return new AppErrorClass('HTTP_5XX', '晨羽智云服务暂时不可用', true, {
      kind: 'network',
      provider: 'comfyui-chenyu',
      status,
      message,
    })
  }

  return new AppErrorClass('HTTP_4XX', '晨羽智云请求参数不正确', false, {
    kind: 'failed',
    provider: 'comfyui-chenyu',
    status,
    message,
  })
}

function businessErrorFromEnvelope<T>(envelope: ChenyuEnvelope<T>) {
  return new AppErrorClass(
    envelope.code === 429 ? 'HTTP_429' : 'HTTP_4XX',
    envelope.msg ?? '晨羽智云请求失败',
    envelope.code === 429,
    {
      kind: envelope.code === 429 ? 'network' : 'failed',
      provider: 'comfyui-chenyu',
      chenyuCode: envelope.code,
      message: envelope.msg ?? '',
    },
  )
}

async function readHttpErrorMessage(response: Response) {
  const text = await response.text().catch(() => '')
  if (!text.trim()) {
    return ''
  }

  try {
    const parsed = JSON.parse(text) as { msg?: string; error?: string | { message?: string } }
    if (typeof parsed.msg === 'string') {
      return parsed.msg
    }
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
  } catch {}

  return text
}

function networkErrorFromCause(error: unknown) {
  if (isAbortError(error)) {
    return new AppErrorClass('NETWORK_TIMEOUT', '晨羽智云请求超时', true, {
      kind: 'network',
      provider: 'comfyui-chenyu',
    })
  }

  return new AppErrorClass('NETWORK_OFFLINE', '无法连接晨羽智云', true, {
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

function toChenyuAppError(error: unknown) {
  if (error instanceof AppErrorClass) {
    return error
  }
  return new AppErrorClass('NETWORK_OFFLINE', '晨羽智云请求失败', true, {
    kind: 'network',
    provider: 'comfyui-chenyu',
  })
}

function shouldRetry(error: AppErrorClass, attempt: number, maxRetries: number) {
  return error.retryable && error.details?.kind === 'network' && attempt < maxRetries
}

function retryDelayMs(error: AppErrorClass, attempt: number) {
  const retryAfterMs = error.details?.retryAfterMs
  if (typeof retryAfterMs === 'number' && Number.isFinite(retryAfterMs) && retryAfterMs > 0) {
    return retryAfterMs
  }

  return DEFAULT_RETRY_DELAY_MS * 2 ** Math.max(0, attempt - 1)
}

function retryAfterHeaderMs(value: string | null) {
  if (!value) {
    return undefined
  }

  const seconds = Number(value)
  if (Number.isFinite(seconds) && seconds >= 0) {
    return seconds * 1_000
  }

  const timestamp = Date.parse(value)
  if (Number.isFinite(timestamp)) {
    return Math.max(0, timestamp - Date.now())
  }

  return undefined
}

function queryString(params: Record<string, string | number | undefined>) {
  const query = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) {
      query.set(key, String(value))
    }
  }
  const text = query.toString()
  return text ? `?${text}` : ''
}

function isAbortError(error: unknown) {
  return error instanceof DOMException && error.name === 'AbortError'
}

function delay(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms))
}
