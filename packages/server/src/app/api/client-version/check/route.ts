import { checkClientVersion } from '@/lib/client-versions'
import { parseOptionalPhpUid } from '@/lib/targeting'
import { NextResponse } from 'next/server'
import { z } from 'zod'

const querySchema = z.object({
  channel: z.enum(['stable', 'beta']).default('stable'),
  current: z.string().min(1),
  platform: z.enum(['windows', 'macos']),
})

function errorResponse(code: string, message: string, status: number) {
  return NextResponse.json({ ok: false, error: { code, message } }, { status })
}

export async function GET(request: Request) {
  const url = new URL(request.url)
  const parsed = querySchema.safeParse({
    channel: url.searchParams.get('channel') ?? 'stable',
    current: url.searchParams.get('current') ?? undefined,
    platform: url.searchParams.get('platform') ?? undefined,
  })
  if (!parsed.success) {
    return errorResponse('INVALID_CLIENT_VERSION_QUERY', '客户端版本查询参数不正确', 400)
  }

  const data = await checkClientVersion({
    channel: parsed.data.channel,
    current: parsed.data.current,
    platform: parsed.data.platform,
    uid: parseOptionalPhpUid(url.searchParams.get('uid')),
  })

  return NextResponse.json({ ok: true, data })
}
