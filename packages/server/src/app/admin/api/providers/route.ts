import { createProvider, listAdminProviders, providerTypes } from '@/lib/providers'
import { Prisma } from '@prisma/client'
import { NextResponse } from 'next/server'
import {
  nullableText,
  providerInputSchema,
  validateJsonObject,
  validateJsonStringArray,
} from './schema'

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

export async function GET(request: Request) {
  const url = new URL(request.url)
  const type = url.searchParams.get('type')
  const data = await listAdminProviders(
    providerTypes.includes(type as (typeof providerTypes)[number])
      ? { type: type as (typeof providerTypes)[number] }
      : {},
  )

  return NextResponse.json({ ok: true, data: { items: data } })
}

export async function POST(request: Request) {
  const parsed = providerInputSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success || !isValidJsonPayload(parsed.data)) {
    return errorResponse('INVALID_PROVIDER_INPUT', 'Provider 参数不正确', 400)
  }

  try {
    const data = await createProvider({
      ...parsed.data,
      id: parsed.data.id.trim(),
      name: parsed.data.name.trim(),
      api_style: parsed.data.api_style.trim(),
      fallback_url: nullableText(parsed.data.fallback_url),
      notes: nullableText(parsed.data.notes),
    })
    return NextResponse.json({ ok: true, data })
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      return errorResponse('PROVIDER_EXISTS', 'Provider ID 已存在', 409)
    }
    throw error
  }
}
