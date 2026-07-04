import { listSkills } from '@/lib/skills'
import { parseOptionalPhpUid } from '@/lib/targeting'
import { NextResponse } from 'next/server'
import { z } from 'zod'

const skillListQuerySchema = z.object({
  module: z.enum(['generation', 'detection', 'title']).optional(),
  category: z.string().min(1).optional(),
  platform: z.string().min(1).optional(),
  language: z.string().min(1).optional(),
})

function errorResponse(code: string, message: string, status: number) {
  return NextResponse.json({ ok: false, error: { code, message } }, { status })
}

export async function GET(request: Request) {
  const url = new URL(request.url)
  const parsed = skillListQuerySchema.safeParse({
    module: url.searchParams.get('module') ?? undefined,
    category: url.searchParams.get('category') ?? undefined,
    platform: url.searchParams.get('platform') ?? undefined,
    language: url.searchParams.get('language') ?? undefined,
  })
  if (!parsed.success) {
    return errorResponse('INVALID_SKILL_QUERY', 'Skill 查询参数不正确', 400)
  }

  const data = await listSkills({
    ...(parsed.data.module ? { module: parsed.data.module } : {}),
    ...(parsed.data.category ? { category: parsed.data.category } : {}),
    ...(parsed.data.platform ? { platform: parsed.data.platform } : {}),
    ...(parsed.data.language ? { language: parsed.data.language } : {}),
    uid: parseOptionalPhpUid(url.searchParams.get('uid')),
  })
  return NextResponse.json({ ok: true, data })
}
