import { db } from '@/lib/db'
import { NextResponse } from 'next/server'
import { z } from 'zod'

const linkSchema = z.union([
  z.object({
    customer_id: z.string().min(1),
  }),
  z.object({
    customer: z.object({
      name: z.string().min(1),
      phone: z.string().min(1),
      email: z.string().optional(),
      wechat: z.string().optional(),
      notes: z.string().optional(),
    }),
  }),
])

function nullableText(value: string | undefined) {
  return value?.trim() || null
}

export async function POST(request: Request, { params }: { params: Promise<{ code: string }> }) {
  const { code } = await params
  const parsed = linkSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: { code: 'INVALID_CUSTOMER_LINK', message: '关联客户参数不正确' } },
      { status: 400 },
    )
  }

  const activationCode = await db.activationCode.findUnique({
    where: { code },
  })
  if (!activationCode) {
    return NextResponse.json(
      { ok: false, error: { code: 'CODE_NOT_FOUND', message: '激活码不存在' } },
      { status: 404 },
    )
  }

  const customer =
    'customer_id' in parsed.data
      ? await db.customer.findUnique({ where: { id: parsed.data.customer_id } })
      : await db.customer.upsert({
          where: { phone: parsed.data.customer.phone },
          update: {
            name: parsed.data.customer.name,
            email: nullableText(parsed.data.customer.email),
            wechat: nullableText(parsed.data.customer.wechat),
            notes: nullableText(parsed.data.customer.notes),
          },
          create: {
            name: parsed.data.customer.name,
            phone: parsed.data.customer.phone,
            email: nullableText(parsed.data.customer.email),
            wechat: nullableText(parsed.data.customer.wechat),
            notes: nullableText(parsed.data.customer.notes),
          },
        })

  if (!customer) {
    return NextResponse.json(
      { ok: false, error: { code: 'CUSTOMER_NOT_FOUND', message: '客户不存在' } },
      { status: 404 },
    )
  }

  await db.activationCode.update({
    where: { code },
    data: { customer_id: customer.id },
  })

  return NextResponse.json({ ok: true, data: { customer_id: customer.id } })
}
