import { describe, expect, it } from 'vitest'
import { getPlatformRule, listPlatformRules } from './collection-platform-rules'

describe('collection platform rules', () => {
  it('ships the seven built-in collection platforms required by the spec', () => {
    const rules = listPlatformRules()

    expect(rules.map((rule) => rule.key)).toEqual([
      'temu',
      'ozon',
      'shein',
      'tiktok',
      'shopee',
      '1688',
      'mercado',
    ])
    for (const rule of rules) {
      expect(rule.allowed_domains.length).toBeGreaterThan(0)
      expect(rule.goods_url_patterns.length).toBeGreaterThan(0)
      expect(rule.entry_url).toMatch(/^https:\/\//)
      expect(rule.original_image_resolver.type).toMatch(/^(src_replace|data_attr|srcset_largest)$/)
    }
  })

  it('returns defensive copies and rejects unknown platform keys', () => {
    const temu = getPlatformRule('temu')
    temu.allowed_domains.push('mutated.example')

    expect(getPlatformRule('temu').allowed_domains).not.toContain('mutated.example')
    expect(() => getPlatformRule('missing')).toThrow('采集平台规则不存在')
  })
})
