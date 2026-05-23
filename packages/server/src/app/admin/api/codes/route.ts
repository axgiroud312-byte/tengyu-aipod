import { computeRemainingDays, computeStatus, createBatchId, generateUniqueCode } from '@/lib/codes'
import { db } from '@/lib/db'
import type { ActivationCode, Customer, DeviceActivation } from '@prisma/client'
import { NextResponse } from 'next/server'
import { z } from 'zod'

const DEFAULT_PAGE_SIZE = 50

type CodeWithRelations = ActivationCode & {
  customer: Customer | null
  devices: DeviceActivation[]
}

const createSchema = z.discriminatedUnion('mode', [
  z.object({
    mode: z.literal('single'),
    customer: z.object({
      name: z.string().min(1),
      phone: z.string().min(1),
      email: z.string().optional(),
      wechat: z.string().optional(),
      notes: z.string().optional(),
      reuse_existing: z.boolean().default(true),
    }),
    days_total: z.number().int().positive(),
    max_devices: z.number().int().positive(),
    notes: z.string().optional(),
  }),
  z.object({
    mode: z.literal('batch_anonymous'),
    days_total: z.number().int().positive(),
    max_devices: z.number().int().positive(),
    quantity: z.number().int().min(1).max(500),
    batch_note: z.string().optional(),
  }),
  z.object({
    mode: z.literal('batch_customers'),
    days_total: z.number().int().positive(),
    max_devices: z.number().int().positive(),
    customers: z
      .array(
        z.object({
          name: z.string().min(1),
          phone: z.string().min(1),
          email: z.string().optional(),
          wechat: z.string().optional(),
          notes: z.string().optional(),
        }),
      )
      .min(1)
      .max(500),
    batch_note: z.string().optional(),
  }),
])

function nullableText(value: string | undefined) {
  return value?.trim() || null
}

function toCsv(rows: Array<Record<string, string | number | null>>) {
  const headers = Object.keys(rows[0] ?? {})
  const escapeCsvValue = (value: string | number | null | undefined) =>
    `"${String(value ?? '').replaceAll('"', '""')}"`
  return [
    headers.join(','),
    ...rows.map((row) => headers.map((header) => escapeCsvValue(row[header])).join(',')),
  ].join('\n')
}

function serializeCode(code: CodeWithRelations) {
  const remaining_days = computeRemainingDays(code.expires_at)
  const status = computeStatus(code)

  return {
    code: code.code,
    customer: code.customer
      ? {
          id: code.customer.id,
          name: code.customer.name,
          phone: code.customer.phone,
          email: code.customer.email,
          wechat: code.customer.wechat,
        }
      : null,
    contact: code.customer?.phone ?? code.customer?.wechat ?? code.customer?.email ?? null,
    days_total: code.days_total,
    max_devices: code.max_devices,
    used_devices: code.devices.length,
    remaining_days,
    batch_id: code.batch_id,
    is_active: code.is_active,
    expires_at: code.expires_at?.toISOString() ?? null,
    activated_at: code.activated_at?.toISOString() ?? null,
    created_at: code.created_at.toISOString(),
    status,
    devices: code.devices.map((device) => ({
      id: device.id,
      device_fingerprint: device.device_fingerprint,
      device_name: device.device_name,
      activated_at: device.activated_at.toISOString(),
      last_active_at: device.last_active_at.toISOString(),
    })),
  }
}

async function findCodes() {
  return db.activationCode.findMany({
    include: {
      customer: true,
      devices: {
        orderBy: { activated_at: 'desc' },
      },
    },
    orderBy: { created_at: 'desc' },
  })
}

function parsePositiveInt(value: string | null, fallback: number) {
  if (!value) {
    return fallback
  }

  const parsed = Number.parseInt(value, 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

export async function GET(request: Request) {
  const url = new URL(request.url)
  const search = url.searchParams.get('search')?.trim()
  const status = url.searchParams.get('status') ?? 'all'
  const batch = url.searchParams.get('batch') ?? 'all'
  const sort = url.searchParams.get('sort') ?? 'created_at_desc'
  const page = parsePositiveInt(url.searchParams.get('page'), 1)
  const pageSize = Math.min(
    parsePositiveInt(url.searchParams.get('page_size'), DEFAULT_PAGE_SIZE),
    100,
  )

  const codes = await findCodes()
  const now = Date.now()
  const filtered = codes.filter((code) => {
    const remainingDays = computeRemainingDays(code.expires_at)
    const codeStatus = computeStatus(code)
    const matchesSearch =
      !search ||
      code.code.toLowerCase().includes(search.toLowerCase()) ||
      code.customer?.name.toLowerCase().includes(search.toLowerCase()) ||
      code.customer?.phone.toLowerCase().includes(search.toLowerCase())
    const matchesBatch = batch === 'all' || code.batch_id === batch
    const matchesStatus =
      status === 'all' ||
      (status === 'activated' && codeStatus === 'activated') ||
      (status === 'not_activated' && codeStatus === 'not_activated') ||
      (status === 'expiring_soon' &&
        remainingDays !== null &&
        remainingDays >= 0 &&
        remainingDays <= 7) ||
      (status === 'banned' && codeStatus === 'banned')

    return matchesSearch && matchesBatch && matchesStatus
  })

  filtered.sort((a, b) => {
    if (sort === 'expires_at_asc') {
      return (
        (a.expires_at?.getTime() ?? Number.MAX_SAFE_INTEGER) -
        (b.expires_at?.getTime() ?? Number.MAX_SAFE_INTEGER)
      )
    }
    if (sort === 'expires_at_desc') {
      return (b.expires_at?.getTime() ?? 0) - (a.expires_at?.getTime() ?? 0)
    }
    return b.created_at.getTime() - a.created_at.getTime()
  })

  const start = (page - 1) * pageSize
  const pageItems = filtered.slice(start, start + pageSize)
  const batches = Array.from(new Set(codes.map((code) => code.batch_id).filter(Boolean))).sort()
  const items = await Promise.all(pageItems.map(serializeCode))

  return NextResponse.json({
    ok: true,
    data: {
      items,
      pagination: {
        page,
        page_size: pageSize,
        total: filtered.length,
        total_pages: Math.max(Math.ceil(filtered.length / pageSize), 1),
      },
      batches,
      server_time: new Date(now).toISOString(),
    },
  })
}

export async function POST(request: Request) {
  const parsed = createSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: { code: 'INVALID_CODE_INPUT', message: '激活码参数不正确' } },
      { status: 400 },
    )
  }

  const createdCodes: Array<{ code: string; customer_name: string | null; phone: string | null }> =
    []
  const batch_id = parsed.data.mode === 'single' ? null : createBatchId()

  if (parsed.data.mode === 'single') {
    const existingCustomer = await db.customer.findUnique({
      where: { phone: parsed.data.customer.phone },
    })
    const customer =
      existingCustomer && parsed.data.customer.reuse_existing
        ? existingCustomer
        : await db.customer.create({
            data: {
              name: parsed.data.customer.name,
              phone: parsed.data.customer.phone,
              email: nullableText(parsed.data.customer.email),
              wechat: nullableText(parsed.data.customer.wechat),
              notes: nullableText(parsed.data.customer.notes),
            },
          })
    const code = await generateUniqueCode()

    await db.activationCode.create({
      data: {
        code,
        customer_id: customer.id,
        days_total: parsed.data.days_total,
        max_devices: parsed.data.max_devices,
        notes: nullableText(parsed.data.notes),
      },
    })
    createdCodes.push({ code, customer_name: customer.name, phone: customer.phone })
  }

  if (parsed.data.mode === 'batch_anonymous') {
    for (let index = 0; index < parsed.data.quantity; index += 1) {
      const code = await generateUniqueCode()
      await db.activationCode.create({
        data: {
          code,
          batch_id,
          days_total: parsed.data.days_total,
          max_devices: parsed.data.max_devices,
          notes: nullableText(parsed.data.batch_note),
        },
      })
      createdCodes.push({ code, customer_name: null, phone: null })
    }
  }

  if (parsed.data.mode === 'batch_customers') {
    for (const inputCustomer of parsed.data.customers) {
      const customer = await db.customer.upsert({
        where: { phone: inputCustomer.phone },
        update: {
          name: inputCustomer.name,
          email: nullableText(inputCustomer.email),
          wechat: nullableText(inputCustomer.wechat),
          notes: nullableText(inputCustomer.notes),
        },
        create: {
          name: inputCustomer.name,
          phone: inputCustomer.phone,
          email: nullableText(inputCustomer.email),
          wechat: nullableText(inputCustomer.wechat),
          notes: nullableText(inputCustomer.notes),
        },
      })
      const code = await generateUniqueCode()
      await db.activationCode.create({
        data: {
          code,
          customer_id: customer.id,
          batch_id,
          days_total: parsed.data.days_total,
          max_devices: parsed.data.max_devices,
          notes: nullableText(parsed.data.batch_note),
        },
      })
      createdCodes.push({ code, customer_name: customer.name, phone: customer.phone })
    }
  }

  return NextResponse.json({
    ok: true,
    data: {
      batch_id,
      codes: createdCodes,
      csv: toCsv(createdCodes),
    },
  })
}
