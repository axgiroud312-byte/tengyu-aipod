import { db } from '@/lib/db'
import { NextResponse } from 'next/server'
import { z } from 'zod'

const patchSchema = z.object({
  add_days: z.number().int().positive().optional(),
  max_devices: z.number().int().positive().optional(),
  is_active: z.boolean().optional(),
})

export async function PATCH(request: Request, { params }: { params: Promise<{ code: string }> }) {
  const { code } = await params
  const parsed = patchSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: { code: 'INVALID_CODE_UPDATE', message: '激活码更新参数不正确' } },
      { status: 400 },
    )
  }

  const current = await db.activationCode.findUnique({
    where: { code },
    include: { devices: true },
  })
  if (!current) {
    return NextResponse.json(
      { ok: false, error: { code: 'CODE_NOT_FOUND', message: '激活码不存在' } },
      { status: 404 },
    )
  }

  if (parsed.data.max_devices !== undefined && parsed.data.max_devices < current.devices.length) {
    return NextResponse.json(
      {
        ok: false,
        error: {
          code: 'DEVICE_LIMIT_BELOW_ACTIVE_DEVICES',
          message: '设备数不能小于已激活设备数，请先解绑设备',
        },
      },
      { status: 400 },
    )
  }

  const expiresBase = current.expires_at ?? current.activated_at ?? new Date()
  const expires_at =
    parsed.data.add_days === undefined
      ? current.expires_at
      : new Date(expiresBase.getTime() + parsed.data.add_days * 24 * 60 * 60 * 1000)

  const updated = await db.activationCode.update({
    where: { code },
    data: Object.fromEntries(
      Object.entries({
        expires_at,
        max_devices: parsed.data.max_devices,
        is_active: parsed.data.is_active,
      }).filter((entry) => entry[1] !== undefined),
    ),
  })

  return NextResponse.json({ ok: true, data: { code: updated.code } })
}
