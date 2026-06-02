import { createAdmin, listAdmins } from '@/lib/admins'
import { NextResponse } from 'next/server'
import { z } from 'zod'

const createAdminSchema = z.object({
  email: z.string().email(),
  name: z.string().min(1),
  password: z.string().min(8),
  role: z.enum(['admin', 'super']).default('admin'),
})

function errorResponse(code: string, message: string, status: number) {
  return NextResponse.json({ ok: false, error: { code, message } }, { status })
}

export async function GET() {
  const admins = await listAdmins()

  return NextResponse.json({
    ok: true,
    data: {
      admins,
      server_time: new Date().toISOString(),
    },
  })
}

export async function POST(request: Request) {
  const parsed = createAdminSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) {
    return errorResponse('INVALID_ADMIN_CREATE_INPUT', '管理员创建参数不正确', 400)
  }

  const admin = await createAdmin(parsed.data)
  if (!admin) {
    return errorResponse('ADMIN_EMAIL_TAKEN', '管理员邮箱已存在', 409)
  }

  return NextResponse.json({ ok: true, data: { admin } }, { status: 201 })
}
