import {
  createNextComfyuiWorkflowVersion,
  getAdminComfyuiWorkflow,
  updateExistingComfyuiWorkflowVersion,
} from '@/lib/comfyui-workflows'
import { NextResponse } from 'next/server'
import {
  comfyuiWorkflowPatchSchema,
  nullableText,
  validateJsonArray,
  validateJsonObject,
} from '../schema'

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

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const version = new URL(request.url).searchParams.get('version') ?? undefined
  const data = await getAdminComfyuiWorkflow(id, version)
  if (!data) {
    return errorResponse('COMFYUI_WORKFLOW_NOT_FOUND', 'ComfyUI 工作流不存在', 404)
  }

  return NextResponse.json({ ok: true, data })
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const parsed = comfyuiWorkflowPatchSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success || !isValidJsonPayload(parsed.data)) {
    return errorResponse('INVALID_COMFYUI_WORKFLOW_INPUT', 'ComfyUI 工作流参数不正确', 400)
  }

  const base = {
    category: parsed.data.category,
    workflow_json: parsed.data.workflow_json,
    input_slots_json: parsed.data.input_slots_json,
    output_slots_json: parsed.data.output_slots_json,
    required_models: parsed.data.required_models,
    recommended_pod_keywords: parsed.data.recommended_pod_keywords,
    min_vram_gb: parsed.data.min_vram_gb,
    enabled: parsed.data.enabled,
    notes: nullableText(parsed.data.notes),
  }

  const data =
    parsed.data.save_mode === 'new_version'
      ? await createNextComfyuiWorkflowVersion(id, parsed.data.version, base)
      : await updateExistingComfyuiWorkflowVersion(id, parsed.data.version, {
          ...base,
          id,
          version: parsed.data.version,
        })

  if (!data && parsed.data.save_mode === 'new_version') {
    return errorResponse('COMFYUI_WORKFLOW_VERSION_EXISTS', 'ComfyUI 工作流版本已存在', 409)
  }

  if (!data) {
    return errorResponse('COMFYUI_WORKFLOW_NOT_FOUND', 'ComfyUI 工作流不存在', 404)
  }

  return NextResponse.json({ ok: true, data })
}
