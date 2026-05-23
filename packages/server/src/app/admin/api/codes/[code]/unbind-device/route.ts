import { db } from '@/lib/db'
import { NextResponse } from 'next/server'
import { z } from 'zod'

const unbindSchema = z.object({
  device_id: z.string().min(1),
})

export async function POST(request: Request, { params }: { params: Promise<{ code: string }> }) {
  const { code } = await params
  const parsed = unbindSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: { code: 'INVALID_DEVICE_UNBIND', message: '解绑设备参数不正确' } },
      { status: 400 },
    )
  }

  const device = await db.deviceActivation.findFirst({
    where: {
      id: parsed.data.device_id,
      code_id: code,
    },
  })
  if (!device) {
    return NextResponse.json(
      { ok: false, error: { code: 'DEVICE_NOT_FOUND', message: '设备不存在' } },
      { status: 404 },
    )
  }

  await db.deviceActivation.delete({
    where: { id: device.id },
  })

  return NextResponse.json({ ok: true })
}
