import { listActiveAnnouncements } from '@/lib/announcements'
import { parseOptionalPhpUid } from '@/lib/targeting'
import { NextResponse } from 'next/server'

export async function GET(request: Request) {
  const url = new URL(request.url)
  const uid = parseOptionalPhpUid(url.searchParams.get('uid'))
  const data = await listActiveAnnouncements({ uid })

  return NextResponse.json({ ok: true, data })
}
