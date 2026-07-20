import { AppErrorClass } from '@tengyu-aipod/shared'

export const CHENYU_BASE_URL = 'https://www.chenyu.cn/api/open/v2'

export const ChenyuInstanceStatus = {
  Created: 0,
  Initializing: 1,
  Running: 2,
  Stopping: 3,
  StoppedLegacy: 4,
  ShuttingDown: 21,
  Stopped: 22,
  AbnormalStopped: 23,
  Starting: 24,
  Restarting: 27,
} as const

export type ChenyuInstanceStatusCode =
  (typeof ChenyuInstanceStatus)[keyof typeof ChenyuInstanceStatus]

export type ChenyuInstanceStatusName =
  | 'created'
  | 'initializing'
  | 'running'
  | 'shutting_down'
  | 'stopped'
  | 'abnormal_stopped'
  | 'starting'
  | 'restarting'
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

export type ChenyuMarketImageListParams = {
  page?: number
  page_size?: number
  cuda_version?: string
  python_version?: string
}

export type ChenyuCreateByPodInput = {
  pod_uuid: string
  pod_tag?: string
  gpu_uuid: string
  gpu_nums?: number
}

export type ChenyuCreateByImageInput = {
  image_uuid: string
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

export type ChenyuIdleCloseInput = {
  instance_uuid: string
  idle_period_minutes: number
}

export type ChenyuUpdateTitleInput = {
  instance_uuid: string
  title: string
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

export type ChenyuPrivateImage = {
  title: string
  uuid: string
  remark?: string
  layer_count?: number
  size?: number
  pod_uuid?: string
  pod_tag?: string
  save_image_status?: number
  create_time?: number
  [key: string]: unknown
}

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

export type ChenyuActionResult = {
  ok: true
}

export type ChenyuWorkflowMarketParams = {
  keyword?: string
  tag?: string
  sort?: 'latest' | 'popular' | string
  page?: number
  page_size?: number
}

export type ChenyuWorkflowMarketItem = {
  workflow_id: string
  revision_id?: string
  title: string
  description?: string
  cover_url?: string
  tags?: string[]
  owner?: Record<string, unknown>
  quote_currency?: string
  quote_amount?: string
  may_incur_external_model_cost?: boolean
  updated_at?: string
  [key: string]: unknown
}

export type ChenyuWorkflowMarketList = {
  items: ChenyuWorkflowMarketItem[]
  total: number
  page?: number
  page_size?: number
}

export type ChenyuWorkflowParameter = {
  key: string
  display_name?: string
  type?: string
  required?: boolean
  default_value?: unknown
  [key: string]: unknown
}

export type ChenyuWorkflowOutputParameter = {
  key: string
  type?: string
  [key: string]: unknown
}

export type ChenyuWorkflowMarketInfo = {
  workflow_id: string
  revision_id?: string
  title: string
  description?: string
  tags?: string[]
  covers?: string[]
  owner?: Record<string, unknown>
  quote_currency?: string
  quote_amount?: string
  may_incur_external_model_cost?: boolean
  external_cost_notice?: string
  editable_parameter_manifest?: ChenyuWorkflowParameter[]
  candidate_output_manifest?: ChenyuWorkflowOutputParameter[]
  [key: string]: unknown
}

export type ChenyuSubmitWorkflowRunInput = {
  workflow_id: string
  revision_id?: string
  inputs?: Record<string, unknown>
  idempotency_key: string
  accept_external_cost_risk?: boolean
}

export type ChenyuWorkflowRunSubmitResult = {
  run_order_id: string
  workflow_id: string
  revision_id?: string
  quote_currency?: string
  quote_amount?: string
  freeze_status?: string
  run_status?: string
  task_id?: string
  prompt_id?: string
  billing_run_id?: string
  idempotent_replay?: boolean
  [key: string]: unknown
}

export type ChenyuWorkflowRunsParams = {
  page?: number
  page_size?: number
}

export type ChenyuWorkflowRunInfo = {
  run_order_id: string
  workflow_id?: string
  revision_id?: string
  run_status?: string
  outputs?: Record<string, unknown>
  error_code?: string
  error_message?: string
  [key: string]: unknown
}

export type ChenyuWorkflowRunList = {
  items?: ChenyuWorkflowRunInfo[]
  run_list?: ChenyuWorkflowRunInfo[]
  total?: number
  page?: number
  page_size?: number
}

export type ChenyuWorkflowExecutionLog = {
  at?: string
  event_type?: string
  level?: string
  message?: string
  node_id?: string
  progress_percent?: number | null
  value?: number | null
  max?: number | null
  fraction?: number
}

export type ChenyuWorkflowExecution = {
  task_id?: string
  workflow_id?: string
  status: string
  queue_info?: { position?: number; estimated_wait_sec?: number | null } | null
  progress_percent?: number | null
  progress_snapshot?: Record<string, unknown>
  logs?: ChenyuWorkflowExecutionLog[]
  actual_execution_duration_sec?: number | null
  compute_cost?: number
  external_model_cost?: number
  total_cost?: number
  outputs?: Record<string, unknown>
  error?: {
    code?: string
    message?: string
    reason?: string
    detail?: string
    engine_code?: string
    status_code?: number
  } | null
  cancel_requested?: boolean
  created_at?: string
  started_at?: string | null
  terminal_at?: string | null
  [key: string]: unknown
}

type ChenyuEnvelope<T> = {
  code: number | string
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

type ChenyuListPrivateImagesResponse = {
  image_list?: ChenyuPrivateImage[]
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

  async listImages(params: ChenyuMarketImageListParams = {}) {
    const data = await this.get<ChenyuListImagesResponse>('/image/market/list', params)
    return {
      items: data.image_list ?? [],
      total: data.total ?? 0,
    }
  }

  async listPrivateImages() {
    const data = await this.get<ChenyuListPrivateImagesResponse>('/image/private/list')
    return {
      items: data.image_list ?? [],
      total: data.total ?? 0,
    }
  }

  deletePrivateImage(image_uuid: string) {
    return this.postAction('/image/private/delete', { image_uuid })
  }

  async createByPod(input: ChenyuCreateByPodInput) {
    return this.post<ChenyuInstanceInfo>('/instance/create_by_pod', {
      gpu_nums: 1,
      ...input,
    })
  }

  async createByImage(input: ChenyuCreateByImageInput) {
    return this.post<ChenyuInstanceInfo>('/instance/create_by_image', {
      gpu_nums: 1,
      ...input,
    })
  }

  async getInstanceInfo(instance_uuid: string) {
    return this.get<ChenyuInstanceInfo>('/instance/info', { instance_uuid })
  }

  async listInstances() {
    const data = await this.get<ChenyuListInstancesResponse>('/instance/list')
    return {
      items: data.instance_list ?? [],
      total: data.total ?? 0,
    }
  }

  startup(input: ChenyuStartupInput) {
    return this.postAction('/instance/startup', input)
  }

  shutdown(instance_uuid: string) {
    return this.postAction('/instance/shutdown', { instance_uuid })
  }

  restart(instance_uuid: string) {
    return this.postAction('/instance/restart', { instance_uuid })
  }

  setShutdownTimer(input: ChenyuShutdownTimerInput) {
    return this.postAction('/instance/shutdown_timer', input)
  }

  setIdleClose(input: ChenyuIdleCloseInput) {
    return this.postAction('/instance/set_idle_close', input)
  }

  updateTitle(input: ChenyuUpdateTitleInput) {
    return this.postAction('/instance/update_title', input)
  }

  saveImage(instance_uuid: string) {
    return this.postAction('/instance/save_image', { instance_uuid })
  }

  destroy(instance_uuid: string) {
    return this.postAction('/instance/destroy', { instance_uuid })
  }

  async getBalance() {
    return this.get<ChenyuBalance>('/balance/info')
  }

  async listWorkflowMarket(params: ChenyuWorkflowMarketParams = {}) {
    const data = await this.get<ChenyuWorkflowMarketList>('/workflow/market/list', params)
    return {
      ...data,
      items: data.items ?? [],
      total: data.total ?? 0,
    }
  }

  getWorkflowMarketInfo(workflow_id: string) {
    return this.get<ChenyuWorkflowMarketInfo>('/workflow/market/info', { workflow_id })
  }

  submitWorkflowRun(input: ChenyuSubmitWorkflowRunInput) {
    return this.post<ChenyuWorkflowRunSubmitResult>('/workflow/run/submit', input)
  }

  listWorkflowRuns(params: ChenyuWorkflowRunsParams = {}) {
    return this.get<ChenyuWorkflowRunList>('/workflow/run/list', params)
  }

  getWorkflowRunInfo(run_order_id: string) {
    return this.get<ChenyuWorkflowRunInfo>('/workflow/run/info', { run_order_id })
  }

  getWorkflowRunExecution(run_order_id: string) {
    return this.get<ChenyuWorkflowExecution>('/workflow/run/execution', { run_order_id })
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

  private async postAction(path: string, body: unknown): Promise<ChenyuActionResult> {
    await this.request<undefined>(
      path,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
        },
        body: JSON.stringify(body),
      },
      { allowMissingData: true },
    )
    return { ok: true }
  }

  private async request<T>(
    path: string,
    init: RequestInit,
    options: { allowMissingData?: boolean } = {},
  ) {
    let attempt = 0

    while (true) {
      try {
        return await this.requestOnce<T>(path, init, options)
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

  private async requestOnce<T>(
    path: string,
    init: RequestInit,
    options: { allowMissingData?: boolean },
  ) {
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
      if (!isChenyuSuccessCode(envelope.code)) {
        throw businessErrorFromEnvelope(envelope)
      }
      if (envelope.data === undefined && !options.allowMissingData) {
        throw protocolError('晨羽智云返回缺少 data')
      }
      return envelope.data as T
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
  if (status === ChenyuInstanceStatus.Created) {
    return 'created'
  }
  if (status === ChenyuInstanceStatus.Initializing) {
    return 'initializing'
  }
  if (status === ChenyuInstanceStatus.Running) {
    return 'running'
  }
  if (status === ChenyuInstanceStatus.Stopping || status === ChenyuInstanceStatus.ShuttingDown) {
    return 'shutting_down'
  }
  if (status === ChenyuInstanceStatus.StoppedLegacy || status === ChenyuInstanceStatus.Stopped) {
    return 'stopped'
  }
  if (status === ChenyuInstanceStatus.AbnormalStopped) {
    return 'abnormal_stopped'
  }
  if (status === ChenyuInstanceStatus.Starting) {
    return 'starting'
  }
  if (status === ChenyuInstanceStatus.Restarting) {
    return 'restarting'
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

function businessErrorFromEnvelope<T>(envelope: Pick<ChenyuEnvelope<T>, 'code' | 'msg'>) {
  const rateLimited = isRateLimitedCode(envelope.code)
  return new AppErrorClass(
    rateLimited ? 'HTTP_429' : 'HTTP_4XX',
    envelope.msg ?? '晨羽智云请求失败',
    rateLimited,
    {
      kind: rateLimited ? 'network' : 'failed',
      provider: 'comfyui-chenyu',
      chenyuCode: envelope.code,
      message: envelope.msg ?? '',
    },
  )
}

function isChenyuSuccessCode(code: number | string) {
  return String(code) === '0'
}

function isRateLimitedCode(code: number | string) {
  return String(code) === '429'
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
