import { getSkill } from '@/lib/skills'
import { parseOptionalPhpUid } from '@/lib/targeting'
import { NextResponse } from 'next/server'
import { z } from 'zod'

const skillDetailQuerySchema = z.object({
  version: z.string().min(1).optional(),
})

function errorResponse(code: string, message: string, status: number) {
  return NextResponse.json({ ok: false, error: { code, message } }, { status })
}

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const url = new URL(request.url)
  const parsed = skillDetailQuerySchema.safeParse({
    version: url.searchParams.get('version') ?? undefined,
  })
  if (!parsed.success) {
    return errorResponse('INVALID_SKILL_QUERY', 'Skill 查询参数不正确', 400)
  }

  const data = await getSkill(
    id,
    parsed.data.version,
    parseOptionalPhpUid(url.searchParams.get('uid')),
  )
  if (!data) {
    return errorResponse('SKILL_NOT_FOUND', 'Skill 不存在', 404)
  }

  return NextResponse.json({ ok: true, data })
}
