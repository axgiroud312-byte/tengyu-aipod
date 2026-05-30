import { describe, expect, it } from 'vitest'
import { createRateLimiter } from './rate-limit'

describe('createRateLimiter', () => {
  it('limits attempts within the active window', () => {
    const limiter = createRateLimiter({ windowMs: 1_000, maxAttempts: 2 })

    expect(limiter.isRateLimited('client-a', 1_000)).toBe(false)
    expect(limiter.isRateLimited('client-a', 1_100)).toBe(false)
    expect(limiter.isRateLimited('client-a', 1_200)).toBe(true)
  })

  it('prunes expired buckets before accepting new attempts', () => {
    const limiter = createRateLimiter({ windowMs: 1_000, maxAttempts: 1 })

    expect(limiter.isRateLimited('client-a', 1_000)).toBe(false)
    expect(limiter.isRateLimited('client-a', 2_001)).toBe(false)
    expect(limiter.size(2_001)).toBe(1)
  })

  it('caps bucket count for changing keys', () => {
    const limiter = createRateLimiter({ windowMs: 10_000, maxAttempts: 1, maxBuckets: 2 })

    expect(limiter.isRateLimited('client-a', 1_000)).toBe(false)
    expect(limiter.isRateLimited('client-b', 1_000)).toBe(false)
    expect(limiter.isRateLimited('client-c', 1_000)).toBe(false)

    expect(limiter.size(1_000)).toBe(2)
  })
})
