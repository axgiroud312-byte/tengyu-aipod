import type { PlatformRule } from '@prisma/client'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const findMany = vi.fn()

vi.mock('@/lib/db', () => ({
  db: {
    platformRule: {
      findMany,
    },
  },
}))

const { listPlatformRules } = await import('./platform-rules')

function platformRule(overrides: Partial<PlatformRule> = {}): PlatformRule {
  const now = new Date('2026-05-24T00:00:00.000Z')
  return {
    key: 'temu',
    name: 'Temu',
    category: 'collection',
    rules_json: '{"allowed_domains":["temu.com"]}',
    enabled: true,
    version: '20260520-01',
    updated_at: now,
    ...overrides,
  }
}

beforeEach(() => {
  findMany.mockReset()
})

describe('platform rules queries', () => {
  it('filters enabled platform rules by category and returns a cache version', async () => {
    findMany.mockResolvedValueOnce([
      platformRule(),
      platformRule({
        key: 'shein',
        name: 'SHEIN',
        version: '20260521-01',
      }),
    ])

    await expect(listPlatformRules({ category: 'collection' })).resolves.toMatchObject({
      version: 'temu:20260520-01|shein:20260521-01',
      rules: [
        { key: 'temu', category: 'collection', rules_json: { allowed_domains: ['temu.com'] } },
        { key: 'shein', category: 'collection', version: '20260521-01' },
      ],
    })

    expect(findMany).toHaveBeenCalledWith({
      where: {
        enabled: true,
        category: 'collection',
      },
      orderBy: [{ category: 'asc' }, { key: 'asc' }],
    })
  })
})
