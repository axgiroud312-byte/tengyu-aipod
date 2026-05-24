import { getAdminProvider, updateProvider } from '@/lib/providers'
import { NextResponse } from 'next/server'
import {
  nullableText,
  providerInputSchema,
  validateJsonObject,
  validateJsonStringArray,
} from '../schema'

function errorResponse(code: string, message: string, status: number) {
  return NextResponse.json({ ok: false, error: { code, message } }, { status })
}

function isValidJsonPayload(input: {
  endpoints_json: string
  model_options_json: string
  default_params_json: string
}) {
  return (
    validateJsonObject(input.endpoints_json) &&
    validateJsonStringArray(input.model_options_json) &&
    validateJsonObject(input.default_params_json)
  )
}

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const data = await getAdminProvider(id)
  if (!data) {
    return errorResponse('PROVIDER_NOT_FOUND', 'Provider 不存在', 404)
  }

  return NextResponse.json({ ok: true, data })
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const parsed = providerInputSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success || !isValidJsonPayload(parsed.data)) {
    return errorResponse('INVALID_PROVIDER_INPUT', 'Provider 参数不正确', 400)
  }

  const existing = await getAdminProvider(id)
  if (!existing) {
    return errorResponse('PROVIDER_NOT_FOUND', 'Provider 不存在', 404)
  }

  const data = await updateProvider(id, {
    ...parsed.data,
    id,
    name: parsed.data.name.trim(),
    api_style: parsed.data.api_style.trim(),
    fallback_url: nullableText(parsed.data.fallback_url),
    notes: nullableText(parsed.data.notes),
  })

  return NextResponse.json({ ok: true, data })
}
