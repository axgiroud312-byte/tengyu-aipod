import { clientIp, createRateLimiter } from '@/lib/rate-limit'
import { StatusAuthError, getActivationStatus } from '@/lib/status'
import { NextResponse } from 'next/server'

const rateLimitWindowMs = 60 * 1000
const rateLimitMaxAttempts = 60
const rateLimiter = createRateLimiter({
  windowMs: rateLimitWindowMs,
  maxAttempts: rateLimitMaxAttempts,
})

function errorResponse(code: string, status: number) {
  return NextResponse.json({ ok: false, error: { code } }, { status })
}

export async function GET(request: Request) {
  const authorization = request.headers.get('authorization')
  const token = authorization?.startsWith('Bearer ')
    ? authorization.slice('Bearer '.length).trim()
    : ''
  if (rateLimiter.isRateLimited(token || clientIp(request))) {
    return errorResponse('RATE_LIMITED', 429)
  }

  try {
    const data = await getActivationStatus(authorization)
    return NextResponse.json({ ok: true, data })
  } catch (error) {
    if (error instanceof StatusAuthError) {
      return errorResponse(error.code, 401)
    }

    return errorResponse('INTERNAL_ERROR', 500)
  }
}
