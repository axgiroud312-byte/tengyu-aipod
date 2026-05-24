import type { Provider } from '@prisma/client'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const findMany = vi.fn()

vi.mock('@/lib/db', () => ({
  db: {
    provider: {
      findMany,
    },
  },
}))

const { listProviders } = await import('./providers')

function provider(overrides: Partial<Provider> = {}): Provider {
  const now = new Date('2026-05-23T00:00:00.000Z')
  return {
    id: 'grsai',
    name: 'Grsai 付费生图',
    type: 'paid-generation',
    base_url: 'https://grsai.dakka.com.cn',
    fallback_url: null,
    api_style: 'grsai-native',
    endpoints_json: '{}',
    model_options_json: '[]',
    default_params_json: '{}',
    capabilities: ['txt2img', 'img2img', 'extract'],
    enabled: true,
    sort_order: 10,
    notes: null,
    updated_at: now,
    ...overrides,
  }
}

beforeEach(() => {
  findMany.mockReset()
})

describe('providers queries', () => {
  it('filters enabled providers by type and orders by sort_order', async () => {
    findMany.mockResolvedValueOnce([provider()])

    await expect(listProviders({ type: 'paid-generation' })).resolves.toMatchObject([
      { id: 'grsai', type: 'paid-generation' },
    ])

    expect(findMany).toHaveBeenCalledWith({
      where: {
        enabled: true,
        type: 'paid-generation',
      },
      orderBy: [{ sort_order: 'asc' }, { id: 'asc' }],
    })
  })
})
