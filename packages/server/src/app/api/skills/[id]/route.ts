import { ClientAuthError, requireClientAuth } from '@/lib/client-auth'
import { getSkill } from '@/lib/skills'
import { NextResponse } from 'next/server'
import { z } from 'zod'

const skillDetailQuerySchema = z.object({
  version: z.string().min(1).optional(),
})

function errorResponse(code: string, message: string, status: number) {
  return NextResponse.json({ ok: false, error: { code, message } }, { status })
}

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireClientAuth(request.headers.get('authorization'), { allowDevelopmentBypass: true })
  } catch (error) {
    if (error instanceof ClientAuthError) {
      return errorResponse(error.code, '客户端授权无效', 401)
    }
    return errorResponse('INTERNAL_ERROR', '服务器内部错误', 500)
  }

  const { id } = await params
  const url = new URL(request.url)
  const parsed = skillDetailQuerySchema.safeParse({
    version: url.searchParams.get('version') ?? undefined,
  })
  if (!parsed.success) {
    return errorResponse('INVALID_SKILL_QUERY', 'Skill 查询参数不正确', 400)
  }

  const data = await getSkill(id, parsed.data.version)
  if (!data) {
    return errorResponse('SKILL_NOT_FOUND', 'Skill 不存在', 404)
  }

  return NextResponse.json({ ok: true, data })
}
