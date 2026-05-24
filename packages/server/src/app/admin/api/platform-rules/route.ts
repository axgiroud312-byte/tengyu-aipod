import {
  createPlatformRule,
  listAdminPlatformRules,
  platformRuleCategories,
} from '@/lib/platform-rules'
import { Prisma } from '@prisma/client'
import { NextResponse } from 'next/server'
import { platformRuleInputSchema, validateJsonObject } from './schema'

function errorResponse(code: string, message: string, status: number) {
  return NextResponse.json({ ok: false, error: { code, message } }, { status })
}

export async function GET(request: Request) {
  const url = new URL(request.url)
  const category = url.searchParams.get('category')
  const data = await listAdminPlatformRules(
    platformRuleCategories.includes(category as (typeof platformRuleCategories)[number])
      ? { category: category as (typeof platformRuleCategories)[number] }
      : {},
  )

  return NextResponse.json({ ok: true, data: { items: data } })
}

export async function POST(request: Request) {
  const parsed = platformRuleInputSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success || !validateJsonObject(parsed.data.rules_json)) {
    return errorResponse('INVALID_PLATFORM_RULE_INPUT', '平台规则参数不正确', 400)
  }

  try {
    const data = await createPlatformRule({
      ...parsed.data,
      key: parsed.data.key.trim(),
      name: parsed.data.name.trim(),
      version: parsed.data.version.trim(),
    })
    return NextResponse.json({ ok: true, data })
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      return errorResponse('PLATFORM_RULE_EXISTS', '平台规则 Key 已存在', 409)
    }
    throw error
  }
}
