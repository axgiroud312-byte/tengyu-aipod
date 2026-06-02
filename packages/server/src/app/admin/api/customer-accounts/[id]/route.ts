import { getCustomerAccount, parseExpiresAt, updateCustomerAccount } from '@/lib/customer-accounts'
import { NextResponse } from 'next/server'
import { z } from 'zod'

const updateSchema = z
  .object({
    expires_at: z.string().min(1).optional(),
    notes: z.string().optional(),
  })
  .refine((data) => data.expires_at !== undefined || data.notes !== undefined, {
    message: '至少填写一个字段',
  })

function errorResponse(code: string, message: string, status: number) {
  return NextResponse.json({ ok: false, error: { code, message } }, { status })
}

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  void request
  const account = await getCustomerAccount(id)
  if (!account) {
    return errorResponse('CUSTOMER_ACCOUNT_NOT_FOUND', '客户账号不存在', 404)
  }

  return NextResponse.json({
    ok: true,
    data: {
      customer: account,
      server_time: new Date().toISOString(),
    },
  })
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const parsed = updateSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) {
    return errorResponse('INVALID_CUSTOMER_ACCOUNT_UPDATE', '客户账号更新参数不正确', 400)
  }

  let expiresAt: Date | undefined
  if (parsed.data.expires_at) {
    const parsedExpiresAt = parseExpiresAt(parsed.data.expires_at)
    if (!parsedExpiresAt) {
      return errorResponse('INVALID_EXPIRES_AT', '到期日格式不正确', 400)
    }
    expiresAt = parsedExpiresAt
  }

  const account = await updateCustomerAccount({
    id,
    ...(expiresAt ? { expiresAt } : {}),
    ...(parsed.data.notes !== undefined ? { notes: parsed.data.notes } : {}),
  })
  if (!account) {
    return errorResponse('CUSTOMER_ACCOUNT_NOT_FOUND', '客户账号不存在', 404)
  }

  return NextResponse.json({ ok: true, data: { customer: account } })
}
