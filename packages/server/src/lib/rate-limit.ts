type RateLimitBucket = {
  count: number
  resetAt: number
}

export type RateLimiterOptions = {
  windowMs: number
  maxAttempts: number
  maxBuckets?: number
}

const DEFAULT_MAX_BUCKETS = 10_000

export function createRateLimiter(options: RateLimiterOptions) {
  const buckets = new Map<string, RateLimitBucket>()
  const maxBuckets = options.maxBuckets ?? DEFAULT_MAX_BUCKETS

  function prune(now: number) {
    for (const [key, bucket] of buckets.entries()) {
      if (bucket.resetAt <= now) {
        buckets.delete(key)
      }
    }
  }

  function trimToCapacity() {
    while (buckets.size >= maxBuckets) {
      const oldestKey = buckets.keys().next().value
      if (!oldestKey) {
        break
      }
      buckets.delete(oldestKey)
    }
  }

  return {
    isRateLimited(key: string, now = Date.now()) {
      const normalizedKey = key.trim() || 'unknown'
      prune(now)

      const bucket = buckets.get(normalizedKey)
      if (!bucket) {
        trimToCapacity()
        buckets.set(normalizedKey, { count: 1, resetAt: now + options.windowMs })
        return false
      }

      bucket.count += 1
      return bucket.count > options.maxAttempts
    },

    size(now = Date.now()) {
      prune(now)
      return buckets.size
    },
  }
}

export function clientIp(request: Request) {
  const forwardedFor = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
  return forwardedFor || request.headers.get('x-real-ip') || 'unknown'
}
