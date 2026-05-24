import { db } from '@/lib/db'
import type { PlatformRule as PrismaPlatformRule } from '@prisma/client'

export const platformRuleCategories = ['collection', 'listing'] as const

export type PlatformRuleCategory = (typeof platformRuleCategories)[number]

export type PlatformRuleFilter = {
  category?: PlatformRuleCategory
}

export type PlatformRuleItem = {
  key: string
  name: string
  category: string
  rules_json: Record<string, unknown>
  enabled: boolean
  version: string
  updated_at: string
}

export type PlatformRulesPayload = {
  version: string
  rules: PlatformRuleItem[]
}

export type PlatformRuleUpsertInput = {
  key: string
  name: string
  category: PlatformRuleCategory
  rules_json: string
  enabled: boolean
  version: string
}

function parseJsonObject(value: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value) as unknown
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {}
  } catch {
    return {}
  }
}

function buildRulesVersion(rules: PlatformRuleItem[]) {
  return rules.map((rule) => `${rule.key}:${rule.version}`).join('|')
}

export function serializePlatformRule(rule: PrismaPlatformRule): PlatformRuleItem {
  return {
    key: rule.key,
    name: rule.name,
    category: rule.category,
    rules_json: parseJsonObject(rule.rules_json),
    enabled: rule.enabled,
    version: rule.version,
    updated_at: rule.updated_at.toISOString(),
  }
}

export async function listPlatformRules(
  filter: PlatformRuleFilter = {},
): Promise<PlatformRulesPayload> {
  const rules = (
    await db.platformRule.findMany({
      where: {
        enabled: true,
        ...(filter.category ? { category: filter.category } : {}),
      },
      orderBy: [{ category: 'asc' }, { key: 'asc' }],
    })
  ).map(serializePlatformRule)

  return {
    version: buildRulesVersion(rules),
    rules,
  }
}

export async function listAdminPlatformRules(filter: PlatformRuleFilter = {}) {
  const rules = await db.platformRule.findMany({
    where: {
      ...(filter.category ? { category: filter.category } : {}),
    },
    orderBy: [{ category: 'asc' }, { key: 'asc' }],
  })

  return rules.map(serializePlatformRule)
}

export async function getAdminPlatformRule(key: string) {
  const rule = await db.platformRule.findUnique({ where: { key } })
  return rule ? serializePlatformRule(rule) : null
}

export async function createPlatformRule(input: PlatformRuleUpsertInput) {
  const rule = await db.platformRule.create({
    data: {
      key: input.key,
      name: input.name,
      category: input.category,
      rules_json: input.rules_json,
      enabled: input.enabled,
      version: input.version,
    },
  })

  return serializePlatformRule(rule)
}

export async function updatePlatformRule(key: string, input: PlatformRuleUpsertInput) {
  const rule = await db.platformRule.update({
    where: { key },
    data: {
      name: input.name,
      category: input.category,
      rules_json: input.rules_json,
      enabled: input.enabled,
      version: input.version,
    },
  })

  return serializePlatformRule(rule)
}
