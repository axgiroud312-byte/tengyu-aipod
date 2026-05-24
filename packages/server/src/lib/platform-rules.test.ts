import type { PlatformRule } from '@prisma/client'
import { describe, expect, it } from 'vitest'
import { serializePlatformRule } from './platform-rules'

function platformRule(overrides: Partial<PlatformRule> = {}): PlatformRule {
  const now = new Date('2026-05-24T00:00:00.000Z')
  return {
    key: 'temu',
    name: 'Temu',
    category: 'collection',
    rules_json: JSON.stringify({
      allowed_domains: ['temu.com', '*.temu.com'],
      entry_url: 'https://www.temu.com',
    }),
    enabled: true,
    version: '20260520-01',
    updated_at: now,
    ...overrides,
  }
}

describe('platform rules helpers', () => {
  it('serializes platform rule rows with parsed rules_json', () => {
    const item = serializePlatformRule(platformRule())

    expect(item).toEqual({
      key: 'temu',
      name: 'Temu',
      category: 'collection',
      rules_json: {
        allowed_domains: ['temu.com', '*.temu.com'],
        entry_url: 'https://www.temu.com',
      },
      enabled: true,
      version: '20260520-01',
      updated_at: '2026-05-24T00:00:00.000Z',
    })
  })

  it('falls back to an empty object for malformed rules_json', () => {
    const item = serializePlatformRule(platformRule({ rules_json: 'not-json' }))

    expect(item.rules_json).toEqual({})
  })
})
