import type { Skill } from '@prisma/client'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const findFirst = vi.fn()
const findMany = vi.fn()
const deleteMany = vi.fn()

vi.mock('@/lib/db', () => ({
  db: {
    skill: {
      deleteMany,
      findMany,
      findFirst,
    },
  },
}))

const { deleteSkill, getSkill, listSkills } = await import('./skills')

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
    variables_json: '[]',
    recommended_model: 'qwen3-vl-plus',
    notes: null,
    target_php_uids_json: '[]',
    target_scope: 'all',
    created_at: now,
    updated_at: now,
    ...overrides,
  }
}

beforeEach(() => {
  deleteMany.mockReset()
  findFirst.mockReset()
  findMany.mockReset()
})

describe('skills queries', () => {
  it('returns exact title platform and language matches first', async () => {
    findMany.mockResolvedValueOnce([skill()])

    await expect(
      listSkills({ module: 'title', platform: 'temu_pop', language: 'en' }),
    ).resolves.toMatchObject([{ id: 'title-temu-en', platform: 'temu_pop', language: 'en' }])

    expect(findMany).toHaveBeenCalledTimes(1)
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          enabled: true,
          module: 'title',
          platform: 'temu_pop',
          language: 'en',
        }),
      }),
    )
  })

  it('falls back from platform match to generic language then generic generic', async () => {
    findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([skill({ id: 'title-generic-en', platform: 'generic' })])

    await expect(
      listSkills({ module: 'title', platform: 'temu_pop', language: 'en' }),
    ).resolves.toMatchObject([{ id: 'title-generic-en', platform: 'generic', language: 'en' }])

    expect(findMany).toHaveBeenCalledTimes(2)
    expect(findMany).toHaveBeenLastCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          platform: 'generic',
          language: 'en',
        }),
      }),
    )
  })

  it('falls back to generic platform and generic language when needed', async () => {
    findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        skill({
          id: 'title-generic-generic',
          platform: 'generic',
          language: 'generic',
          version: '1.0.0',
        }),
      ])

    await expect(
      listSkills({ module: 'title', platform: 'temu_pop', language: 'en' }),
    ).resolves.toMatchObject([
      { id: 'title-generic-generic', platform: 'generic', language: 'generic' },
    ])

    expect(findMany).toHaveBeenCalledTimes(3)
    expect(findMany).toHaveBeenLastCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          platform: 'generic',
          language: 'generic',
        }),
      }),
    )
  })

  it('returns only the latest enabled version per skill id', async () => {
    findMany.mockResolvedValueOnce([
      skill({ version: '3.0.1' }),
      skill({ row_id: 'row-2', version: '3.0.10' }),
    ])

    await expect(listSkills({ module: 'title' })).resolves.toMatchObject([
      { id: 'title-temu-en', version: '3.0.10' },
    ])
  })

  it('gets a specified historical version', async () => {
    findFirst.mockResolvedValueOnce(skill({ version: '3.0.1' }))

    await expect(getSkill('title-temu-en', '3.0.1')).resolves.toMatchObject({
      id: 'title-temu-en',
      version: '3.0.1',
      systemPrompt: 'Write a title.',
    })
    expect(findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'title-temu-en', enabled: true, version: '3.0.1' },
      }),
    )
  })

  it('does not return disabled skills', async () => {
    findFirst.mockResolvedValueOnce(null)

    await expect(getSkill('disabled-skill', '1.0.0')).resolves.toBeNull()
    expect(findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'disabled-skill', enabled: true, version: '1.0.0' },
      }),
    )
  })

  it('filters public skills by php uid target allowlist', async () => {
    findMany.mockResolvedValueOnce([
      skill({ id: 'global' }),
      skill({
        id: 'hidden',
        target_php_uids_json: '[456]',
        target_scope: 'php_uid_list',
      }),
      skill({
        id: 'matched',
        target_php_uids_json: '[123]',
        target_scope: 'php_uid_list',
      }),
    ])

    await expect(listSkills({ module: 'title', uid: 123 })).resolves.toMatchObject([
      { id: 'global' },
      { id: 'matched' },
    ])
  })

  it('permanently deletes every version of a skill id', async () => {
    deleteMany.mockResolvedValueOnce({ count: 2 })

    await expect(deleteSkill('txt2img-local-print')).resolves.toBe(2)

    expect(deleteMany).toHaveBeenCalledWith({
      where: { id: 'txt2img-local-print' },
    })
  })
})
