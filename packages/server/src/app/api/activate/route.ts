import { ActivateError, activateDevice } from '@/lib/activate'
import { NextResponse } from 'next/server'
import { z } from 'zod'

const activateSchema = z.object({
  code: z.string().regex(/^POD-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/),
  device_fingerprint: z.string().length(64),
  device_name: z.string().max(40).optional(),
})

const rateLimitWindowMs = 60 * 1000
const rateLimitMaxAttempts = 10
const rateLimitBuckets = new Map<string, { count: number; resetAt: number }>()

function clientIp(request: Request) {
  const forwardedFor = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
  return forwardedFor || request.headers.get('x-real-ip') || 'unknown'
}

function isRateLimited(request: Request) {
  const key = clientIp(request)
  const now = Date.now()
  const bucket = rateLimitBuckets.get(key)

  if (!bucket || bucket.resetAt <= now) {
    rateLimitBuckets.set(key, { count: 1, resetAt: now + rateLimitWindowMs })
    return false
  }

  bucket.count += 1
  return bucket.count > rateLimitMaxAttempts
}

function errorResponse(code: string, message: string, status: number) {
  return NextResponse.json({ ok: false, error: { code, message } }, { status })
}

export async function POST(request: Request) {
  if (isRateLimited(request)) {
    return errorResponse('RATE_LIMITED', '请求过于频繁，请稍后再试', 429)
  }

  const parsed = activateSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) {
    return errorResponse('INVALID_INPUT', '激活参数不正确', 400)
  }

  try {
    const data = await activateDevice({
      code: parsed.data.code,
      device_fingerprint: parsed.data.device_fingerprint,
      device_name: parsed.data.device_name?.trim() || null,
    })

    return NextResponse.json({ ok: true, data })
  } catch (error) {
    if (error instanceof ActivateError) {
      return errorResponse(error.code, error.message, error.status)
    }

    return errorResponse('INTERNAL_ERROR', '服务器内部错误', 500)
  }
}
