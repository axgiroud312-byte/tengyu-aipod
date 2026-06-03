import { type AppError, AppErrorClass } from '@tengyu-aipod/shared'

export type GenerationFailureReason = 'network' | 'timeout' | 'violation' | 'server' | 'unknown'

export interface WorkUnit {
  id: string
  task_id: string
  prompt: string
  reference_images?: { base64: string; mime_type: string }[]
  attempt: number
  max_retries: number
  failure_reason?: GenerationFailureReason
}

export type AdaptiveRateLimiterOptions = {
  workers?: number
  onLimitChanged?: (currentWorkers: number, message: string) => void
}

export type GenerationConcurrencyControllerOptions = AdaptiveRateLimiterOptions

export type RunWithRetryOptions = {
  baseDelayMs?: number
  sleep?: (ms: number) => Promise<void>
}

type QueueItem<T> = {
  taskId: string
  fn: () => Promise<T>
  resolve: (value: T) => void
  reject: (reason?: unknown) => void
}

const DEFAULT_WORKERS = 3
const MIN_WORKERS = 1
const MAX_WORKERS = 20
const DEFAULT_RETRY_DELAY_MS = 500

export function clampGenerationWorkers(value: number | undefined, fallback = DEFAULT_WORKERS) {
  if (!Number.isFinite(value)) {
    return fallback
  }
  return Math.max(MIN_WORKERS, Math.min(MAX_WORKERS, Math.floor(value as number)))
}

export class AdaptiveRateLimiter {
  private consecutive429 = 0
  private onLimitChanged: ((currentWorkers: number, message: string) => void) | undefined

  currentWorkers: number

  constructor(options: AdaptiveRateLimiterOptions = {}) {
    this.currentWorkers = clampGenerationWorkers(options.workers)
    this.onLimitChanged = options.onLimitChanged
  }

  setWorkers(workers: number) {
    this.currentWorkers = clampGenerationWorkers(workers)
    this.consecutive429 = 0
  }

  onResponse(status: number) {
    if (status === 429) {
      this.consecutive429 += 1
      if (this.consecutive429 >= 3) {
        this.currentWorkers = Math.max(MIN_WORKERS, this.currentWorkers - 1)
        this.consecutive429 = 0
        this.onLimitChanged?.(this.currentWorkers, `检测到限流，并发已降到 ${this.currentWorkers}`)
      }
      return
    }

    if (status < 400) {
      this.consecutive429 = 0
    }
  }
}

export class GenerationConcurrencyController {
  private readonly limiter: AdaptiveRateLimiter
  private readonly queue: QueueItem<unknown>[] = []
  private readonly active = new Set<string>()

  constructor(options: GenerationConcurrencyControllerOptions = {}) {
    this.limiter = new AdaptiveRateLimiter(options)
  }

  get currentWorkers() {
    return this.limiter.currentWorkers
  }

  get activeTaskIds() {
    return [...this.active]
  }

  setWorkers(workers: number) {
    this.limiter.setWorkers(workers)
    this.drain()
  }

  onResponse(status: number) {
    const before = this.currentWorkers
    this.limiter.onResponse(status)
    if (this.currentWorkers !== before) {
      this.drain()
    }
  }

  run<T>(taskId: string, fn: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      this.queue.push({
        taskId,
        fn,
        resolve: resolve as (value: unknown) => void,
        reject,
      })
      this.drain()
    })
  }

  private drain() {
    while (this.active.size < this.currentWorkers && this.queue.length > 0) {
      const item = this.queue.shift()
      if (!item) {
        return
      }

      this.active.add(item.taskId)
      void item
        .fn()
        .then(item.resolve)
        .catch(item.reject)
        .finally(() => {
          this.active.delete(item.taskId)
          this.drain()
        })
    }
  }
}

export const generationConcurrencyController = new GenerationConcurrencyController()

export async function runWithRetry<T>(
  unit: WorkUnit,
  operation: (unit: WorkUnit) => Promise<T>,
  options: RunWithRetryOptions = {},
) {
  const sleep = options.sleep ?? delay
  const baseDelayMs = options.baseDelayMs ?? DEFAULT_RETRY_DELAY_MS
  let lastError: unknown = null

  while (unit.attempt <= unit.max_retries) {
    try {
      return await operation(unit)
    } catch (error) {
      lastError = error
      unit.failure_reason = classifyGenerationFailure(error)
      if (!isGenerationRetryable(error) || unit.attempt >= unit.max_retries) {
        break
      }

      unit.attempt += 1
      await sleep(baseDelayMs * 2 ** Math.max(0, unit.attempt - 1))
    }
  }

  throw lastError
}

export function classifyGenerationFailure(error: unknown): GenerationFailureReason {
  if (error instanceof AppErrorClass) {
    return classifyAppError(error)
  }

  if (isAppError(error)) {
    return classifyAppError(error)
  }

  return 'unknown'
}

function classifyAppError(error: AppError) {
  if (error.code === 'GRSAI_VIOLATION' || error.details?.kind === 'violation') {
    return 'violation'
  }

  if (error.code === 'NETWORK_TIMEOUT') {
    return 'timeout'
  }

  if (error.code === 'HTTP_5XX' || error.code === 'HTTP_429') {
    return 'server'
  }

  if (error.code === 'NETWORK_OFFLINE') {
    return 'network'
  }

  return 'unknown'
}

function isGenerationRetryable(error: unknown) {
  if (error instanceof AppErrorClass) {
    return error.retryable && classifyGenerationFailure(error) !== 'violation'
  }

  if (isAppError(error)) {
    return error.retryable && classifyGenerationFailure(error) !== 'violation'
  }

  return true
}

function isAppError(error: unknown): error is AppError {
  return (
    error !== null &&
    typeof error === 'object' &&
    'code' in error &&
    'retryable' in error &&
    typeof (error as AppError).retryable === 'boolean'
  )
}

function delay(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms))
}
