import { adminPayloadFromRequest } from '@/lib/admin-auth'
import { bulkUpdateCustomerAccounts, parseExpiresAt } from '@/lib/customer-accounts'
import { NextResponse } from 'next/server'
import { z } from 'zod'

const actionsRequiringExpiresAt = new Set(['approve', 'set_expires_at', 'enable'])

const bulkSchema = z.object({
  action: z.enum(['approve', 'set_expires_at', 'append_note', 'disable', 'enable']),
  expires_at: z.string().min(1).optional(),
  ids: z.array(z.string().min(1)).min(1),
  note: z.string().optional(),
})

function errorResponse(code: string, message: string, status: number) {
  return NextResponse.json({ ok: false, error: { code, message } }, { status })
}

export async function POST(request: Request) {
  const admin = await adminPayloadFromRequest(request)
  if (!admin) {
    return errorResponse('ADMIN_AUTH_REQUIRED', '管理员登录已失效', 401)
  }

  const parsed = bulkSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) {
    return errorResponse('INVALID_CUSTOMER_ACCOUNT_BULK', '批量客户操作参数不正确', 400)
  }

  let expiresAt: Date | undefined
  if (parsed.data.expires_at) {
    const parsedExpiresAt = parseExpiresAt(parsed.data.expires_at)
    if (!parsedExpiresAt) {
      return errorResponse('INVALID_EXPIRES_AT', '到期日格式不正确', 400)
    }
    expiresAt = parsedExpiresAt
  }

  if (actionsRequiringExpiresAt.has(parsed.data.action) && !expiresAt) {
    return errorResponse('EXPIRES_AT_REQUIRED', '该批量操作必须填写到期日', 400)
  }

  const result = await bulkUpdateCustomerAccounts({
    action: parsed.data.action,
    adminId: admin.sub,
    ...(expiresAt ? { expiresAt } : {}),
    ids: parsed.data.ids,
    ...(parsed.data.note !== undefined ? { note: parsed.data.note } : {}),
  })

  return NextResponse.json({
    ok: true,
    data: result,
  })
}
