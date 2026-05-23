import { db } from '@/lib/db'
import { signAdminJwt } from '@/lib/jwt'
import bcrypt from 'bcrypt'
import { NextResponse } from 'next/server'
import { z } from 'zod'

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
})

const ADMIN_COOKIE_MAX_AGE_SECONDS = 7 * 24 * 60 * 60

export async function POST(request: Request) {
  const parsed = loginSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: { code: 'INVALID_LOGIN_INPUT', message: '邮箱或密码格式不正确' } },
      { status: 400 },
    )
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
