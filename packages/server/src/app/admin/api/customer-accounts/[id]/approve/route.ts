import { adminPayloadFromRequest } from '@/lib/admin-auth'
import { approveCustomerAccount, parseExpiresAt } from '@/lib/customer-accounts'
import { NextResponse } from 'next/server'
import { z } from 'zod'

const approveSchema = z.object({
  expires_at: z.string().min(1),
  notes: z.string().optional(),
})

function errorResponse(code: string, message: string, status: number) {
  return NextResponse.json({ ok: false, error: { code, message } }, { status })
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const admin = await adminPayloadFromRequest(request)
  if (!admin) {
    return errorResponse('ADMIN_AUTH_REQUIRED', '管理员登录已失效', 401)
  }

  const { id } = await params
  const parsed = approveSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) {
    return errorResponse('EXPIRES_AT_REQUIRED', '授权必须填写到期日', 400)
  }

  const expiresAt = parseExpiresAt(parsed.data.expires_at)
  if (!expiresAt) {
    return errorResponse('INVALID_EXPIRES_AT', '到期日格式不正确', 400)
  }

  const account = await approveCustomerAccount({
    adminId: admin.sub,
    expiresAt,
    id,
    ...(parsed.data.notes !== undefined ? { notes: parsed.data.notes } : {}),
  })
  if (!account) {
    return errorResponse('CUSTOMER_ACCOUNT_NOT_FOUND', '客户账号不存在', 404)
  }

  return NextResponse.json({ ok: true, data: { customer: account } })
}
