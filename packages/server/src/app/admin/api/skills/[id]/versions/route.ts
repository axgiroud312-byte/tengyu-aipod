import { listSkillVersions } from '@/lib/skills'
import { NextResponse } from 'next/server'

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const data = await listSkillVersions(id)

  return NextResponse.json({ ok: true, data: { items: data } })
}
