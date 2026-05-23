import { StatusAuthError, getActivationStatus } from '@/lib/status'
import { NextResponse } from 'next/server'

const rateLimitWindowMs = 60 * 1000
const rateLimitMaxAttempts = 60
const rateLimitBuckets = new Map<string, { count: number; resetAt: number }>()

function errorResponse(code: string, status: number) {
  return NextResponse.json({ ok: false, error: { code } }, { status })
}

function isRateLimited(token: string) {
  const now = Date.now()
  const bucket = rateLimitBuckets.get(token)

  if (!bucket || bucket.resetAt <= now) {
    rateLimitBuckets.set(token, { count: 1, resetAt: now + rateLimitWindowMs })
    return false
  }

  bucket.count += 1
  return bucket.count > rateLimitMaxAttempts
}

export async function GET(request: Request) {
  const authorization = request.headers.get('authorization')
  const token = authorization?.startsWith('Bearer ')
    ? authorization.slice('Bearer '.length).trim()
    : ''
  if (token && isRateLimited(token)) {
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
