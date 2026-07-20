import { describe, expect, it } from 'vitest'
import { skillInputSchema } from './schema'

function validSkillInput() {
  return {
    enabled: true,
    id: 'title-temu-en',
    module: 'title' as const,
    system_prompt: 'Write a title.',
    target_scope: 'all' as const,
    variables_json: '[]',
    version: '1.0.0',
  }
}

describe('admin skill input schema', () => {
  it('rejects identifiers and versions that can escape the client cache directory', () => {
    expect(
      skillInputSchema.safeParse({ ...validSkillInput(), id: '../escaped-skill' }).success,
    ).toBe(false)
    expect(skillInputSchema.safeParse({ ...validSkillInput(), version: '../1.0.0' }).success).toBe(
      false,
    )
  })

  it('requires detection skills to request a numeric risk_score', () => {
    const detectionSkill = {
      ...validSkillInput(),
      id: 'infringement-detection',
      module: 'detection' as const,
    }

    expect(
      skillInputSchema.safeParse({
        ...detectionSkill,
        system_prompt: 'Return JSON with risk and reason.',
      }).success,
    ).toBe(false)
    expect(
      skillInputSchema.safeParse({
        ...detectionSkill,
        system_prompt: 'Return JSON with numeric risk_score from 0 to 100 and reason.',
      }).success,
    ).toBe(true)
  })
})
