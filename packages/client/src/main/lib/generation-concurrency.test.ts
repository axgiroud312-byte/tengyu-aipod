import { AppErrorClass } from '@tengyu-aipod/shared'
import { describe, expect, it, vi } from 'vitest'
import {
  AdaptiveRateLimiter,
  GenerationConcurrencyController,
  type WorkUnit,
  classifyGenerationFailure,
  runWithRetry,
} from './generation-concurrency'

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((innerResolve) => {
    resolve = innerResolve
  })
  return { promise, resolve }
}

describe('AdaptiveRateLimiter', () => {
  it('clamps workers to the supported range', () => {
    expect(new AdaptiveRateLimiter({ workers: 0 }).currentWorkers).toBe(1)
    expect(new AdaptiveRateLimiter({ workers: 99 }).currentWorkers).toBe(20)
    expect(new AdaptiveRateLimiter({ workers: 4.8 }).currentWorkers).toBe(4)
  })

  it('lowers concurrency after three consecutive 429 responses and does not recover on success', () => {
    const onLimitChanged = vi.fn()
    const limiter = new AdaptiveRateLimiter({ workers: 3, onLimitChanged })

    limiter.onResponse(429)
    limiter.onResponse(429)
    expect(limiter.currentWorkers).toBe(3)
    limiter.onResponse(429)
    expect(limiter.currentWorkers).toBe(2)
    expect(onLimitChanged).toHaveBeenCalledWith(2, '检测到限流，并发已降到 2')

    limiter.onResponse(200)
    expect(limiter.currentWorkers).toBe(2)
  })

  it('resets consecutive 429 count after a successful response', () => {
    const limiter = new AdaptiveRateLimiter({ workers: 3 })

    limiter.onResponse(429)
    limiter.onResponse(429)
    limiter.onResponse(200)
    limiter.onResponse(429)

    expect(limiter.currentWorkers).toBe(3)
  })
})

describe('GenerationConcurrencyController', () => {
  it('runs no more than the configured number of tasks at once', async () => {
    const controller = new GenerationConcurrencyController({ workers: 2 })
    const first = deferred<string>()
    const second = deferred<string>()
    const started: string[] = []

    const results = Promise.all([
      controller.run('task-1', async () => {
        started.push('task-1')
        return first.promise
      }),
      controller.run('task-2', async () => {
        started.push('task-2')
        return second.promise
      }),
      controller.run('task-3', async () => {
        started.push('task-3')
        return 'done-3'
      }),
    ])

    await Promise.resolve()
    expect(started).toEqual(['task-1', 'task-2'])
    expect(controller.activeTaskIds).toEqual(['task-1', 'task-2'])

    first.resolve('done-1')
    await vi.waitFor(() => {
      expect(started).toEqual(['task-1', 'task-2', 'task-3'])
    })

    second.resolve('done-2')
    await expect(results).resolves.toEqual(['done-1', 'done-2', 'done-3'])
    expect(controller.activeTaskIds).toEqual([])
  })

  it('allows twenty configured workers to start concurrently', async () => {
    const controller = new GenerationConcurrencyController({ workers: 20 })
    const gates = Array.from({ length: 21 }, () => deferred<string>())
    const started: string[] = []

    const results = Promise.all(
      gates.map((gate, index) =>
        controller.run(`task-${index + 1}`, async () => {
          started.push(`task-${index + 1}`)
          return gate.promise
        }),
      ),
    )

    await Promise.resolve()
    expect(controller.currentWorkers).toBe(20)
    expect(started).toHaveLength(20)
    expect(started).not.toContain('task-21')

    gates.forEach((gate, index) => gate.resolve(`done-${index + 1}`))
    await expect(results).resolves.toHaveLength(21)
  })

  it('uses the lowered worker count after 429 adaptive throttling', async () => {
    const controller = new GenerationConcurrencyController({ workers: 2 })
    controller.onResponse(429)
    controller.onResponse(429)
    controller.onResponse(429)

    const first = deferred<string>()
    const started: string[] = []
    const results = Promise.all([
      controller.run('task-1', async () => {
        started.push('task-1')
        return first.promise
      }),
      controller.run('task-2', async () => {
        started.push('task-2')
        return 'done-2'
      }),
    ])

    await Promise.resolve()
    expect(controller.currentWorkers).toBe(1)
    expect(started).toEqual(['task-1'])

    first.resolve('done-1')
    await expect(results).resolves.toEqual(['done-1', 'done-2'])
  })
})

describe('runWithRetry', () => {
  function unit(overrides: Partial<WorkUnit> = {}): WorkUnit {
    return {
      id: 'unit-1',
      task_id: 'task-generation',
      prompt: '生成复古花朵印花',
      attempt: 0,
      max_retries: 2,
      ...overrides,
    }
  }

  it('retries retryable network errors with backoff', async () => {
    const sleep = vi.fn(async () => {})
    const workUnit = unit()
    const operation = vi
      .fn()
      .mockRejectedValueOnce(new AppErrorClass('NETWORK_TIMEOUT', 'timeout', true))
      .mockResolvedValueOnce('ok')

    await expect(runWithRetry(workUnit, operation, { sleep, baseDelayMs: 10 })).resolves.toBe('ok')
    expect(operation).toHaveBeenCalledTimes(2)
    expect(sleep).toHaveBeenCalledWith(10)
    expect(workUnit.attempt).toBe(1)
    expect(workUnit.failure_reason).toBe('timeout')
  })

  it('does not retry violation errors', async () => {
    const sleep = vi.fn(async () => {})
    const workUnit = unit()
    const operation = vi
      .fn()
      .mockRejectedValue(new AppErrorClass('GRSAI_VIOLATION', 'violation', false))

    await expect(runWithRetry(workUnit, operation, { sleep })).rejects.toMatchObject({
      code: 'GRSAI_VIOLATION',
    })
    expect(operation).toHaveBeenCalledTimes(1)
    expect(sleep).not.toHaveBeenCalled()
    expect(workUnit.failure_reason).toBe('violation')
  })

  it('classifies server and network failure reasons', () => {
    expect(classifyGenerationFailure(new AppErrorClass('HTTP_429', 'limited', true))).toBe('server')
    expect(classifyGenerationFailure(new AppErrorClass('NETWORK_OFFLINE', 'offline', true))).toBe(
      'network',
    )
  })
})
