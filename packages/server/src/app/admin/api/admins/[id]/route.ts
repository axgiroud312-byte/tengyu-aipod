import { adminPayloadFromRequest } from '@/lib/admin-auth'
import { updateAdminAccount } from '@/lib/admins'
import { NextResponse } from 'next/server'
import { z } from 'zod'

const updateAdminSchema = z
  .object({
    is_active: z.boolean().optional(),
    name: z.string().min(1).optional(),
    role: z.enum(['admin', 'super']).optional(),
  })
  .refine(
    (data) => data.is_active !== undefined || data.name !== undefined || data.role !== undefined,
    { message: '至少填写一个字段' },
  )

function errorResponse(code: string, message: string, status: number) {
  return NextResponse.json({ ok: false, error: { code, message } }, { status })
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const adminPayload = await adminPayloadFromRequest(request)
  if (!adminPayload) {
    return errorResponse('ADMIN_AUTH_REQUIRED', '管理员登录已失效', 401)
  }

  const { id } = await params
  const parsed = updateAdminSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) {
    return errorResponse('INVALID_ADMIN_UPDATE_INPUT', '管理员更新参数不正确', 400)
  }

  if (id === adminPayload.sub && parsed.data.is_active === false) {
    return errorResponse('CANNOT_DISABLE_SELF', '不能禁用当前登录的管理员', 400)
  }

  const admin = await updateAdminAccount({
    id,
    ...(parsed.data.is_active !== undefined ? { isActive: parsed.data.is_active } : {}),
    ...(parsed.data.name !== undefined ? { name: parsed.data.name } : {}),
    ...(parsed.data.role !== undefined ? { role: parsed.data.role } : {}),
  })
  if (!admin) {
    return errorResponse('ADMIN_NOT_FOUND', '管理员不存在', 404)
  }

  return NextResponse.json({ ok: true, data: { admin } })
}
