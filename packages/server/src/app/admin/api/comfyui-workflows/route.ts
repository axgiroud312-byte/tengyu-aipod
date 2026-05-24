import { createComfyuiWorkflowVersion, listAdminComfyuiWorkflows } from '@/lib/comfyui-workflows'
import { Prisma } from '@prisma/client'
import { NextResponse } from 'next/server'
import {
  comfyuiWorkflowInputSchema,
  nullableText,
  validateJsonArray,
  validateJsonObject,
  workflowCategories,
} from './schema'

function errorResponse(code: string, message: string, status: number) {
  return NextResponse.json({ ok: false, error: { code, message } }, { status })
}

function isValidJsonPayload(input: {
  workflow_json: string
  input_slots_json: string
  output_slots_json: string
}) {
  return (
    validateJsonObject(input.workflow_json) &&
    validateJsonArray(input.input_slots_json) &&
    validateJsonArray(input.output_slots_json)
  )
}

export async function GET(request: Request) {
  const url = new URL(request.url)
  const category = url.searchParams.get('category')
  const data = await listAdminComfyuiWorkflows(
    workflowCategories.includes(category as (typeof workflowCategories)[number])
      ? { category: category as (typeof workflowCategories)[number] }
      : {},
  )

  return NextResponse.json({ ok: true, data: { items: data } })
}

export async function POST(request: Request) {
  const parsed = comfyuiWorkflowInputSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success || !isValidJsonPayload(parsed.data)) {
    return errorResponse('INVALID_COMFYUI_WORKFLOW_INPUT', 'ComfyUI 工作流参数不正确', 400)
  }

  try {
    const data = await createComfyuiWorkflowVersion({
      ...parsed.data,
      id: parsed.data.id.trim(),
      notes: nullableText(parsed.data.notes),
    })
    if (!data) {
      return errorResponse('COMFYUI_WORKFLOW_VERSION_EXISTS', 'ComfyUI 工作流版本已存在', 409)
    }

    return NextResponse.json({ ok: true, data })
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      return errorResponse('COMFYUI_WORKFLOW_VERSION_EXISTS', 'ComfyUI 工作流版本已存在', 409)
    }
    throw error
  }
}
