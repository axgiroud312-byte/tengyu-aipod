import { createSkillVersion, listAdminSkills } from '@/lib/skills'
import { NextResponse } from 'next/server'
import { nullableText, skillInputSchema, targetPhpUidsJson, validateVariablesJson } from './schema'

function errorResponse(code: string, message: string, status: number) {
  return NextResponse.json({ ok: false, error: { code, message } }, { status })
}

export async function GET(request: Request) {
  const url = new URL(request.url)
  const module = url.searchParams.get('module')
  const data = await listAdminSkills(
    module === 'generation' || module === 'detection' || module === 'title' ? { module } : {},
  )

  return NextResponse.json({ ok: true, data: { items: data } })
}

export async function POST(request: Request) {
  const parsed = skillInputSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success || !validateVariablesJson(parsed.data.variables_json)) {
    return errorResponse('INVALID_SKILL_INPUT', 'Skill 参数不正确', 400)
  }
  const target = targetPhpUidsJson(parsed.data.target_scope, parsed.data.target_php_uids)
  if (!target.ok) {
    return errorResponse('INVALID_TARGET_UIDS', 'PHP uid 白名单格式不正确', 400)
  }

  const data = await createSkillVersion({
    id: parsed.data.id.trim(),
    module: parsed.data.module,
    category: nullableText(parsed.data.category),
    platform: nullableText(parsed.data.platform),
    language: nullableText(parsed.data.language),
    version: parsed.data.version.trim(),
    enabled: parsed.data.enabled,
    system_prompt: parsed.data.system_prompt,
    variables_json: parsed.data.variables_json,
    recommended_model: nullableText(parsed.data.recommended_model),
    notes: nullableText(parsed.data.notes),
    target_php_uids_json: target.value,
    target_scope: parsed.data.target_scope,
  })
  if (!data) {
    return errorResponse('SKILL_VERSION_EXISTS', 'Skill 版本已存在', 409)
  }

  return NextResponse.json({ ok: true, data })
}
