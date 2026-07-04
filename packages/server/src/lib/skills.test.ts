import type { Skill } from '@prisma/client'
import { describe, expect, it } from 'vitest'
import { compareVersions, nextPatchVersion, serializeSkill, serializeSkillSummary } from './skills'

function skill(overrides: Partial<Skill> = {}): Skill {
  const now = new Date('2026-05-23T00:00:00.000Z')
  return {
    row_id: 'row-1',
    id: 'title-temu-en',
    module: 'title',
    category: null,
    platform: 'temu_pop',
    language: 'en',
    version: '3.0.1',
    enabled: true,
    system_prompt: 'Write a title.',
    variables_json: JSON.stringify([
      { key: 'extraRequirement', label: '额外要求', type: 'textarea', required: false },
    ]),
    recommended_model: 'qwen3-vl-plus',
    notes: null,
    target_php_uids_json: '[]',
    target_scope: 'all',
    created_at: now,
    updated_at: now,
    ...overrides,
  }
}

describe('skills helpers', () => {
  it('serializes summaries without system prompts', () => {
    const summary = serializeSkillSummary(skill())

    expect(summary).toEqual({
      id: 'title-temu-en',
      module: 'title',
      category: null,
      platform: 'temu_pop',
      language: 'en',
      version: '3.0.1',
      enabled: true,
      recommendedModel: 'qwen3-vl-plus',
      notes: null,
    })
    expect(summary).not.toHaveProperty('systemPrompt')
  })

  it('serializes full skills with parsed variables', () => {
    const detail = serializeSkill(skill())

    expect(detail.systemPrompt).toBe('Write a title.')
    expect(detail.variables).toEqual([
      { key: 'extraRequirement', label: '额外要求', type: 'textarea', required: false },
    ])
  })

  it('compares semantic versions for latest selection', () => {
    expect(compareVersions('3.0.10', '3.0.2')).toBeGreaterThan(0)
    expect(compareVersions('3.1', '3.0.9')).toBeGreaterThan(0)
    expect(compareVersions('2.9.9', '3.0.0')).toBeLessThan(0)
  })

  it('increments patch versions for new skill versions', () => {
    expect(nextPatchVersion('3.0.9')).toBe('3.0.10')
    expect(nextPatchVersion('2.1')).toBe('2.1.1')
    expect(nextPatchVersion('bad')).toBe('0.0.1')
  })
})
