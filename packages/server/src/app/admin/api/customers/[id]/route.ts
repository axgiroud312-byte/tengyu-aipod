import { serializeCustomer } from '@/lib/customers'
import { db } from '@/lib/db'
import { NextResponse } from 'next/server'
import { z } from 'zod'

const updateSchema = z
  .object({
    name: z.string().min(1).optional(),
    phone: z.string().min(1).optional(),
    email: z.string().optional(),
    wechat: z.string().optional(),
    notes: z.string().optional(),
  })
  .refine(
    (data) =>
      data.name !== undefined ||
      data.phone !== undefined ||
      data.email !== undefined ||
      data.wechat !== undefined ||
      data.notes !== undefined,
    { message: '至少填写一个字段' },
  )

function nullableText(value: string | undefined) {
  return value?.trim() || null
}

async function loadCustomer(id: string) {
  return db.customer.findUnique({
    where: { id },
  })
}

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  void request
  const customer = await loadCustomer(id)
  if (!customer) {
    return NextResponse.json(
      { ok: false, error: { code: 'CUSTOMER_NOT_FOUND', message: '客户不存在' } },
      { status: 404 },
    )
  }

  return NextResponse.json({
    ok: true,
    data: {
      customer: serializeCustomer(customer),
      server_time: new Date().toISOString(),
    },
  })
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const parsed = updateSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: { code: 'INVALID_CUSTOMER_UPDATE', message: '客户更新参数不正确' } },
      { status: 400 },
    )
  }

  const current = await db.customer.findUnique({
    where: { id },
    select: { id: true, phone: true },
  })
  if (!current) {
    return NextResponse.json(
      { ok: false, error: { code: 'CUSTOMER_NOT_FOUND', message: '客户不存在' } },
      { status: 404 },
    )
  }

  if (parsed.data.phone && parsed.data.phone !== current.phone) {
    const duplicate = await db.customer.findUnique({
      where: { phone: parsed.data.phone },
      select: { id: true },
    })
    if (duplicate) {
      return NextResponse.json(
        { ok: false, error: { code: 'CUSTOMER_PHONE_TAKEN', message: '手机号已存在' } },
        { status: 409 },
      )
    }
  }

  await db.customer.update({
    where: { id },
    data: {
      ...(parsed.data.name !== undefined ? { name: parsed.data.name.trim() } : {}),
      ...(parsed.data.phone !== undefined ? { phone: parsed.data.phone.trim() } : {}),
      ...(parsed.data.email !== undefined ? { email: nullableText(parsed.data.email) } : {}),
      ...(parsed.data.wechat !== undefined ? { wechat: nullableText(parsed.data.wechat) } : {}),
      ...(parsed.data.notes !== undefined ? { notes: nullableText(parsed.data.notes) } : {}),
    },
  })

  return NextResponse.json({ ok: true, data: { customer_id: id } })
}
