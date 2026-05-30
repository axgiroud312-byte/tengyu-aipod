import { db } from '@/lib/db'
import { signAdminJwt } from '@/lib/jwt'
import { clientIp, createRateLimiter } from '@/lib/rate-limit'
import bcrypt from 'bcrypt'
import { NextResponse } from 'next/server'
import { z } from 'zod'

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
})

const ADMIN_COOKIE_MAX_AGE_SECONDS = 7 * 24 * 60 * 60
const loginIpRateLimiter = createRateLimiter({ windowMs: 60 * 1000, maxAttempts: 30 })
const loginAccountRateLimiter = createRateLimiter({ windowMs: 60 * 1000, maxAttempts: 10 })

function rateLimitedResponse() {
  return NextResponse.json(
    { ok: false, error: { code: 'RATE_LIMITED', message: '请求过于频繁，请稍后再试' } },
    { status: 429 },
  )
}

export async function POST(request: Request) {
  const ip = clientIp(request)
  if (loginIpRateLimiter.isRateLimited(ip)) {
    return rateLimitedResponse()
  }

  const parsed = loginSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: { code: 'INVALID_LOGIN_INPUT', message: '邮箱或密码格式不正确' } },
      { status: 400 },
    )
  }
  if (loginAccountRateLimiter.isRateLimited(parsed.data.email.toLowerCase())) {
    return rateLimitedResponse()
  }

  const admin = await db.admin.findUnique({
    where: { email: parsed.data.email },
  })
  if (!admin?.is_active) {
    return NextResponse.json(
      { ok: false, error: { code: 'INVALID_CREDENTIALS', message: '邮箱或密码不正确' } },
      { status: 401 },
    )
  }

  const passwordOk = await bcrypt.compare(parsed.data.password, admin.password_hash)
  if (!passwordOk) {
    return NextResponse.json(
      { ok: false, error: { code: 'INVALID_CREDENTIALS', message: '邮箱或密码不正确' } },
      { status: 401 },
    )
  }

  const token = await signAdminJwt({ sub: admin.id, role: admin.role })

  await db.admin.update({
    where: { id: admin.id },
    data: { last_login_at: new Date() },
  })

  const response = NextResponse.json({
    ok: true,
    admin: { name: admin.name, role: admin.role },
  })

  response.cookies.set('admin_token', token, {
    httpOnly: true,
    maxAge: ADMIN_COOKIE_MAX_AGE_SECONDS,
    path: '/',
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
  })

  return response
}
