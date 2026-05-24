import { ClientAuthError, requireClientAuth } from '@/lib/client-auth'
import { listComfyuiWorkflows } from '@/lib/comfyui-workflows'
import { NextResponse } from 'next/server'
import { z } from 'zod'

const workflowListQuerySchema = z.object({
  category: z.string().min(1).optional(),
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
  const parsed = workflowListQuerySchema.safeParse({
    category: url.searchParams.get('category') ?? undefined,
  })
  if (!parsed.success) {
    return errorResponse('INVALID_COMFYUI_WORKFLOW_QUERY', 'ComfyUI 工作流查询参数不正确', 400)
  }

  const data = await listComfyuiWorkflows({
    ...(parsed.data.category ? { category: parsed.data.category } : {}),
  })
  return NextResponse.json({ ok: true, data })
}
