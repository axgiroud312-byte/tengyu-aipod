import { describe, expect, it } from 'vitest'
import {
  SHEIN_REQUIRED_REAL_SELECTOR_KEYS,
  SHEIN_SELECTORS,
  SHEIN_TEMPLATE_URLS,
  type SheinSelectorKey,
  selectorToLocator,
} from './selectors'

describe('Dianxiaomi Shein selectors contract', () => {
  it('defines the v1 real Shein template URL', () => {
    expect(SHEIN_TEMPLATE_URLS.shein).toBe(
      'https://www.dianxiaomi.com/web/sheinProduct/edit?id=128935201966452551',
    )
  })

  it('keeps required real selector keys backed by selector candidates', () => {
    for (const key of SHEIN_REQUIRED_REAL_SELECTOR_KEYS) {
      expect(SHEIN_SELECTORS[key], key).toBeDefined()
      expect(SHEIN_SELECTORS[key].length, key).toBeGreaterThan(0)
    }
  })

  it('covers selector keys needed by the five core actions', () => {
    const coreActionKeys = [
      'shop_name_control',
      'title_input',
      'variant_image_upload_button',
      'detail_image_upload_button',
      'one_click_sku_button',
      'video_upload_button',
    ] satisfies SheinSelectorKey[]

    for (const key of coreActionKeys) {
      expect(SHEIN_SELECTORS[key].length, key).toBeGreaterThan(0)
    }
  })

  it('parses selector prefixes consistently with other listing platform layers', () => {
    expect(selectorToLocator('css=#productInfo')).toEqual({
      type: 'css',
      value: '#productInfo',
    })
    expect(selectorToLocator('role=button[name="保存"]')).toEqual({
      type: 'role',
      value: 'button[name="保存"]',
    })
  })
})
