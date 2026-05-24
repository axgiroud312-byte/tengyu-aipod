import { ClientAuthError, requireClientAuth } from '@/lib/client-auth'
import { listPlatformRules, platformRuleCategories } from '@/lib/platform-rules'
import { NextResponse } from 'next/server'
import { z } from 'zod'

const platformRuleListQuerySchema = z.object({
  category: z.enum(platformRuleCategories).optional(),
})

function errorResponse(code: string, message: string, status: number) {
  return NextResponse.json({ ok: false, error: { code, message } }, { status })
}

export async function GET(request: Request) {
  try {
    await requireClientAuth(request.headers.get('authorization'), { allowDevelopmentBypass: true })
  } catch (error) {
    if (error instanceof ClientAuthError) {
      return errorResponse(error.code, '客户端授权无效', 401)
    }
    return errorResponse('INTERNAL_ERROR', '服务器内部错误', 500)
  }

  const url = new URL(request.url)
  const parsed = platformRuleListQuerySchema.safeParse({
    category: url.searchParams.get('category') ?? undefined,
  })
  if (!parsed.success) {
    return errorResponse('INVALID_PLATFORM_RULE_QUERY', '平台规则查询参数不正确', 400)
  }

  const data = await listPlatformRules({
    ...(parsed.data.category ? { category: parsed.data.category } : {}),
  })
  return NextResponse.json({ ok: true, data })
}
