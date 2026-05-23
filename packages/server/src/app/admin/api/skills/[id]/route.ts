import {
  createSkillVersion,
  getAdminSkill,
  nextPatchVersion,
  updateExistingSkillVersion,
} from '@/lib/skills'
import { NextResponse } from 'next/server'
import { nullableText, skillPatchSchema, validateVariablesJson } from '../schema'

function errorResponse(code: string, message: string, status: number) {
  return NextResponse.json({ ok: false, error: { code, message } }, { status })
}

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const version = new URL(request.url).searchParams.get('version') ?? undefined
  const data = await getAdminSkill(id, version)
  if (!data) {
    return errorResponse('SKILL_NOT_FOUND', 'Skill 不存在', 404)
  }

  return NextResponse.json({ ok: true, data })
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const parsed = skillPatchSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success || !validateVariablesJson(parsed.data.variables_json)) {
    return errorResponse('INVALID_SKILL_INPUT', 'Skill 参数不正确', 400)
  }

  const base = {
    id,
    module: parsed.data.module,
    category: nullableText(parsed.data.category),
    platform: nullableText(parsed.data.platform),
    language: nullableText(parsed.data.language),
    enabled: parsed.data.enabled,
    system_prompt: parsed.data.system_prompt,
    variables_json: parsed.data.variables_json,
    recommended_model: nullableText(parsed.data.recommended_model),
    notes: nullableText(parsed.data.notes),
  }

  const data =
    parsed.data.save_mode === 'new_version'
      ? await createSkillVersion({
          ...base,
          version: nextPatchVersion(parsed.data.version),
        })
      : await updateExistingSkillVersion(id, parsed.data.version, {
          ...base,
          version: parsed.data.version,
        })

  if (!data && parsed.data.save_mode === 'new_version') {
    return errorResponse('SKILL_VERSION_EXISTS', 'Skill 版本已存在', 409)
  }

  if (!data) {
    return errorResponse('SKILL_NOT_FOUND', 'Skill 不存在', 404)
  }

  return NextResponse.json({ ok: true, data })
}
