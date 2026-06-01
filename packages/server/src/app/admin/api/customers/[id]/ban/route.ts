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

  await db.customer.update({
    where: { id },
    data: { is_active: false },
  })

  return NextResponse.json({
    ok: true,
    data: { customer_id: id },
  })
}
