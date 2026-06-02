import { disableCustomerAccount } from '@/lib/customer-accounts'
import { NextResponse } from 'next/server'

function errorResponse(code: string, message: string, status: number) {
  return NextResponse.json({ ok: false, error: { code, message } }, { status })
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  void request
  const account = await disableCustomerAccount(id)
  if (!account) {
    return errorResponse('CUSTOMER_ACCOUNT_NOT_FOUND', '客户账号不存在', 404)
  }

  return NextResponse.json({ ok: true, data: { customer: account } })
}
