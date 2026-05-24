import type { Provider } from '@prisma/client'
import { describe, expect, it } from 'vitest'
import { serializeProvider } from './providers'

function provider(overrides: Partial<Provider> = {}): Provider {
  const now = new Date('2026-05-23T00:00:00.000Z')
  return {
    id: 'grsai',
    name: 'Grsai 付费生图',
    type: 'paid-generation',
    base_url: 'https://grsai.dakka.com.cn',
    fallback_url: 'https://grsaiapi.com',
    api_style: 'grsai-native',
    endpoints_json: JSON.stringify({
      generate: '/v1/api/generate',
      result: '/v1/api/result',
    }),
    model_options_json: JSON.stringify(['nano-banana-2', 'gpt-image-2']),
    default_params_json: JSON.stringify({ replyType: 'json' }),
    capabilities: ['txt2img', 'img2img', 'extract'],
    enabled: true,
    sort_order: 10,
    notes: null,
    updated_at: now,
    ...overrides,
  }
}

describe('providers helpers', () => {
  it('serializes provider registry rows without secrets', () => {
    const item = serializeProvider(provider())

    expect(item).toEqual({
      id: 'grsai',
      name: 'Grsai 付费生图',
      type: 'paid-generation',
      base_url: 'https://grsai.dakka.com.cn',
      fallback_url: 'https://grsaiapi.com',
      api_style: 'grsai-native',
      endpoints: {
        generate: '/v1/api/generate',
        result: '/v1/api/result',
      },
      model_options: ['nano-banana-2', 'gpt-image-2'],
      default_params: { replyType: 'json' },
      capabilities: ['txt2img', 'img2img', 'extract'],
      enabled: true,
    })
    expect(item).not.toHaveProperty('api_key')
    expect(item).not.toHaveProperty('secret')
  })

  it('falls back to empty objects and arrays for malformed JSON fields', () => {
    const item = serializeProvider(
      provider({
        endpoints_json: 'not-json',
        model_options_json: '{"bad": true}',
        default_params_json: '[]',
      }),
    )

    expect(item.endpoints).toEqual({})
    expect(item.model_options).toEqual([])
    expect(item.default_params).toEqual({})
  })
})
