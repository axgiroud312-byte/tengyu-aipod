import { db } from '@/lib/db'
import type { Skill as PrismaSkill, SkillModule } from '@prisma/client'
import type { Skill, SkillSummary } from '@tengyu-aipod/shared'

export type SkillFilter = {
  module?: SkillModule
  category?: string
  platform?: string
  language?: string
}

function parseVariables(value: string) {
  const parsed = JSON.parse(value) as Skill['variables']
  return Array.isArray(parsed) ? parsed : []
}

export function serializeSkillSummary(skill: PrismaSkill): SkillSummary {
  return {
    id: skill.id,
    module: skill.module,
    category: skill.category,
    platform: skill.platform,
    language: skill.language,
    version: skill.version,
    enabled: skill.enabled,
    recommendedModel: skill.recommended_model,
    notes: skill.notes,
  }
}

export function serializeSkill(skill: PrismaSkill): Skill {
  return {
    ...serializeSkillSummary(skill),
    systemPrompt: skill.system_prompt,
    variables: parseVariables(skill.variables_json),
  }
}

function versionParts(version: string) {
  return version
    .split('.')
    .map((part) => Number(part))
    .map((part) => (Number.isFinite(part) ? part : 0))
}

export function compareVersions(a: string, b: string) {
  const left = versionParts(a)
  const right = versionParts(b)
  const length = Math.max(left.length, right.length)

  for (let index = 0; index < length; index += 1) {
    const diff = (left[index] ?? 0) - (right[index] ?? 0)
    if (diff !== 0) {
      return diff
    }
  }

  return a.localeCompare(b)
}

function latestById(skills: PrismaSkill[]) {
  const latest = new Map<string, PrismaSkill>()

  for (const skill of skills) {
    const current = latest.get(skill.id)
    if (
      !current ||
      compareVersions(skill.version, current.version) > 0 ||
      (compareVersions(skill.version, current.version) === 0 &&
        skill.updated_at.getTime() > current.updated_at.getTime())
    ) {
      latest.set(skill.id, skill)
    }
  }

  return Array.from(latest.values())
}

function fallbackCandidates(filter: SkillFilter) {
  if (filter.module !== 'title' || !filter.platform || !filter.language) {
    return [filter]
  }

  return [
    filter,
    { ...filter, platform: 'generic' },
    { ...filter, platform: 'generic', language: 'generic' },
  ]
}

async function findEnabledSkills(filter: SkillFilter) {
  const skills = await db.skill.findMany({
    where: {
      enabled: true,
      ...(filter.module ? { module: filter.module } : {}),
      ...(filter.category ? { category: filter.category } : {}),
      ...(filter.platform ? { platform: filter.platform } : {}),
      ...(filter.language ? { language: filter.language } : {}),
    },
    orderBy: [{ id: 'asc' }, { updated_at: 'desc' }],
  })

  return latestById(skills)
}

export async function listSkills(filter: SkillFilter) {
  for (const candidate of fallbackCandidates(filter)) {
    const skills = await findEnabledSkills(candidate)
    if (skills.length > 0) {
      return skills.map(serializeSkillSummary)
    }
  }

  return []
}

export async function getSkill(id: string, version?: string) {
  const skill = await db.skill.findFirst({
    where: {
      id,
      enabled: true,
      ...(version ? { version } : {}),
    },
    orderBy: [{ updated_at: 'desc' }],
  })

  if (!skill) {
    return null
  }

  if (version) {
    return serializeSkill(skill)
  }

  const [latest] = latestById(
    await db.skill.findMany({
      where: { id, enabled: true },
      orderBy: [{ updated_at: 'desc' }],
    }),
  )

  return latest ? serializeSkill(latest) : null
}
