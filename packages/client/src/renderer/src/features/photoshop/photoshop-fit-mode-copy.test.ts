import { describe, expect, it } from 'vitest'
import { photoshopFitModeDescription, photoshopFitModeOptions } from './photoshop-fit-mode-copy'

describe('photoshop fit mode copy', () => {
  it('distinguishes full-bleed artwork from local artwork', () => {
    expect(photoshopFitModeOptions).toEqual([
      { key: 'fill', label: '铺满（适合满版印花）' },
      { key: 'fit', label: '完整显示（适合局部印花）' },
    ])
    expect(photoshopFitModeDescription('fill')).toContain('可能裁切边缘')
    expect(photoshopFitModeDescription('fit')).toContain('完整保留内容')
  })
})
