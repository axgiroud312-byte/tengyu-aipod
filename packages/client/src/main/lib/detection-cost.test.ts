import { estimateDetectionCost } from '@tengyu-aipod/shared'
import { describe, expect, it } from 'vitest'

describe('estimateDetectionCost', () => {
  it('estimates compressed and uncompressed detection costs', () => {
    const compressed = estimateDetectionCost(100, 'qwen3-vl-flash', true)
    expect(compressed.tokensPerImage).toBe(356)
    expect(compressed.yuan).toBeCloseTo(0.01884, 6)

    const uncompressed = estimateDetectionCost(100, 'qwen-vl-max', false)
    expect(uncompressed.tokensPerImage).toBe(1124)
    expect(uncompressed.yuan).toBeCloseTo(0.20384, 6)
  })

  it('falls back to the flash price table for unknown models', () => {
    const fallback = estimateDetectionCost(10, 'unknown-model', true)
    const flash = estimateDetectionCost(10, 'qwen3-vl-flash', true)

    expect(fallback).toEqual(flash)
  })
})
