import { getAdminPlatformRule, updatePlatformRule } from '@/lib/platform-rules'
import { NextResponse } from 'next/server'
import { platformRuleInputSchema, validateJsonObject } from '../schema'

function errorResponse(code: string, message: string, status: number) {
  return NextResponse.json({ ok: false, error: { code, message } }, { status })
}

export async function GET(_request: Request, { params }: { params: Promise<{ key: string }> }) {
  const { key } = await params
  const data = await getAdminPlatformRule(key)
  if (!data) {
    return errorResponse('PLATFORM_RULE_NOT_FOUND', '平台规则不存在', 404)
  }

  return NextResponse.json({ ok: true, data })
}

export async function PATCH(request: Request, { params }: { params: Promise<{ key: string }> }) {
  const { key } = await params
  const parsed = platformRuleInputSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success || !validateJsonObject(parsed.data.rules_json)) {
    return errorResponse('INVALID_PLATFORM_RULE_INPUT', '平台规则参数不正确', 400)
  }

  const existing = await getAdminPlatformRule(key)
  if (!existing) {
    return errorResponse('PLATFORM_RULE_NOT_FOUND', '平台规则不存在', 404)
  }

  const data = await updatePlatformRule(key, {
    ...parsed.data,
    key,
    name: parsed.data.name.trim(),
    version: parsed.data.version.trim(),
  })

  return NextResponse.json({ ok: true, data })
}
