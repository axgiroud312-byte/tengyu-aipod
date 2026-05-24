import type { Provider } from '@prisma/client'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const findMany = vi.fn()
const create = vi.fn()
const update = vi.fn()

vi.mock('@/lib/db', () => ({
  db: {
    provider: {
      create,
      findMany,
      update,
    },
  },
}))

const { createProvider, listProviders, updateProvider } = await import('./providers')

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
  create.mockReset()
  update.mockReset()
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

  it('creates and updates admin provider rows with JSON text fields preserved', async () => {
    create.mockResolvedValueOnce(provider({ id: 'aliyun-bailian' }))
    update.mockResolvedValueOnce(provider({ id: 'aliyun-bailian', enabled: false }))
    const input = {
      id: 'aliyun-bailian',
      name: '阿里云百炼',
      type: 'vision-llm' as const,
      base_url: 'https://dashscope.aliyuncs.com',
      fallback_url: null,
      api_style: 'openai-chat',
      endpoints_json: '{"chat":"/compatible-mode/v1/chat/completions"}',
      model_options_json: '["qwen3-vl-plus"]',
      default_params_json: '{"temperature":0.2}',
      capabilities: ['txt2img'],
      enabled: true,
      sort_order: 20,
      notes: null,
    }

    await createProvider(input)
    await updateProvider('aliyun-bailian', { ...input, enabled: false })

    expect(create).toHaveBeenCalledWith({ data: input })
    expect(update).toHaveBeenCalledWith({
      where: { id: 'aliyun-bailian' },
      data: {
        name: '阿里云百炼',
        type: 'vision-llm',
        base_url: 'https://dashscope.aliyuncs.com',
        fallback_url: null,
        api_style: 'openai-chat',
        endpoints_json: '{"chat":"/compatible-mode/v1/chat/completions"}',
        model_options_json: '["qwen3-vl-plus"]',
        default_params_json: '{"temperature":0.2}',
        capabilities: ['txt2img'],
        enabled: false,
        sort_order: 20,
        notes: null,
      },
    })
  })
})
