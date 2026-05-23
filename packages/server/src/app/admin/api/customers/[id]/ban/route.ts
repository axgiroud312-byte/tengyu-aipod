import { db } from '@/lib/db'
import { NextResponse } from 'next/server'

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  void request

  const current = await db.customer.findUnique({
    where: { id },
    select: { id: true },
  })
  if (!current) {
    return NextResponse.json(
      { ok: false, error: { code: 'CUSTOMER_NOT_FOUND', message: '客户不存在' } },
      { status: 404 },
    )
  }

  const result = await db.$transaction(async (tx) => {
    await tx.customer.update({
      where: { id },
      data: { is_active: false },
    })
    const codes = await tx.activationCode.updateMany({
      where: { customer_id: id },
      data: { is_active: false },
    })
    return codes
  })

  return NextResponse.json({
    ok: true,
    data: { customer_id: id, affected_codes: result.count },
  })
}
