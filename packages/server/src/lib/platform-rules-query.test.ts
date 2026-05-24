import type { PlatformRule } from '@prisma/client'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const findMany = vi.fn()
const findUnique = vi.fn()
const create = vi.fn()
const update = vi.fn()

vi.mock('@/lib/db', () => ({
  db: {
    platformRule: {
      create,
      findMany,
      findUnique,
      update,
    },
  },
}))

const {
  createPlatformRule,
  getAdminPlatformRule,
  listAdminPlatformRules,
  listPlatformRules,
  updatePlatformRule,
} = await import('./platform-rules')

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
  findUnique.mockReset()
  create.mockReset()
  update.mockReset()
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

  it('lists admin platform rules including disabled rows', async () => {
    findMany.mockResolvedValueOnce([platformRule({ enabled: false })])

    await expect(listAdminPlatformRules({ category: 'listing' })).resolves.toMatchObject([
      { key: 'temu', enabled: false },
    ])

    expect(findMany).toHaveBeenCalledWith({
      where: {
        category: 'listing',
      },
      orderBy: [{ category: 'asc' }, { key: 'asc' }],
    })
  })

  it('gets, creates, and updates admin platform rules with JSON text preserved', async () => {
    findUnique.mockResolvedValueOnce(platformRule())
    create.mockResolvedValueOnce(platformRule({ key: 'ozon' }))
    update.mockResolvedValueOnce(platformRule({ enabled: false }))
    const input = {
      key: 'ozon',
      name: 'Ozon',
      category: 'collection' as const,
      rules_json: '{"allowed_domains":["ozon.ru"]}',
      enabled: true,
      version: '20260524-01',
    }

    await expect(getAdminPlatformRule('temu')).resolves.toMatchObject({ key: 'temu' })
    await createPlatformRule(input)
    await updatePlatformRule('temu', { ...input, enabled: false })

    expect(create).toHaveBeenCalledWith({ data: input })
    expect(update).toHaveBeenCalledWith({
      where: { key: 'temu' },
      data: {
        name: 'Ozon',
        category: 'collection',
        rules_json: '{"allowed_domains":["ozon.ru"]}',
        enabled: false,
        version: '20260524-01',
      },
    })
  })
})
