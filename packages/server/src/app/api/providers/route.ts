import { ClientAuthError, requireClientAuth } from '@/lib/client-auth'
import { listProviders, providerTypes } from '@/lib/providers'
import { NextResponse } from 'next/server'
import { z } from 'zod'

const providerListQuerySchema = z.object({
  type: z.enum(providerTypes).optional(),
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
  const parsed = providerListQuerySchema.safeParse({
    type: url.searchParams.get('type') ?? undefined,
  })
  if (!parsed.success) {
    return errorResponse('INVALID_PROVIDER_QUERY', 'Provider 查询参数不正确', 400)
  }

  const data = await listProviders({
    ...(parsed.data.type ? { type: parsed.data.type } : {}),
  })
  return NextResponse.json({ ok: true, data })
}
