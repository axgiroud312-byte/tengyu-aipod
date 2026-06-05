import { describe, expect, it } from 'vitest'
import { SkuCodeSchema } from './schemas'

describe('SkuCodeSchema', () => {
  it('accepts sku codes that can be used as folder and print names', () => {
    expect(SkuCodeSchema.safeParse('TY-001').success).toBe(true)
    expect(SkuCodeSchema.safeParse('SKU_2026').success).toBe(true)
  })

  it('rejects spaces, Chinese text, Windows reserved names, and overlong values', () => {
    expect(SkuCodeSchema.safeParse('TY 001').success).toBe(false)
    expect(SkuCodeSchema.safeParse('印花1').success).toBe(false)
    expect(SkuCodeSchema.safeParse('CON').success).toBe(false)
    expect(SkuCodeSchema.safeParse('A'.repeat(61)).success).toBe(false)
  })
})
