import { describe, expect, it } from 'vitest'
import { selectorToLocator } from '../_commons/page-locator'
import {
  SHEIN_REQUIRED_REAL_SELECTOR_KEYS,
  SHEIN_SELECTORS,
  SHEIN_SELECTOR_RECORDS,
  SHEIN_TEMPLATE_URLS,
  type SheinSelectorKey,
} from './selectors'

describe('Dianxiaomi Shein selectors contract', () => {
  it('does not embed a draft template id in selector-layer template URLs', () => {
    expect(new URL(SHEIN_TEMPLATE_URLS.shein).searchParams.get('id')).toBeNull()
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

  it('stores selectors as selector records with dispatch-ready metadata', () => {
    expect(SHEIN_SELECTOR_RECORDS).toHaveLength(Object.keys(SHEIN_SELECTORS).length)
    for (const record of SHEIN_SELECTOR_RECORDS) {
      expect(record).toMatchObject({
        key: expect.any(String),
        name: expect.any(String),
        primary: expect.any(String),
        version: '1.0.0',
        createdAt: '2026-05-26T00:00:00.000Z',
      })
      expect(record.fallbacks.length, record.key).toBeGreaterThanOrEqual(1)
    }
  })
})
