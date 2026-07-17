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
})
