import { describe, expect, it } from 'vitest'
import {
  TEMU_POP_REQUIRED_REAL_SELECTOR_KEYS,
  TEMU_POP_SELECTORS,
  TEMU_POP_SELECTOR_RECORDS,
  TEMU_POP_TEMPLATE_URLS,
} from './selectors'

const VALID_SELECTOR_PREFIXES = ['css=', 'text=', 'label=', 'placeholder=', 'role=']

describe('Temu PopTemu selectors', () => {
  it('does not embed draft template ids in selector-layer template URLs', () => {
    for (const url of Object.values(TEMU_POP_TEMPLATE_URLS)) {
      expect(new URL(url).searchParams.get('id')).toBeNull()
    }
  })

  it('keeps every selector group static and backed by fallbacks', () => {
    for (const [key, selectors] of Object.entries(TEMU_POP_SELECTORS)) {
      expect(selectors.length, key).toBeGreaterThanOrEqual(2)
      for (const selector of selectors) {
        expect(
          VALID_SELECTOR_PREFIXES.some((prefix) => selector.startsWith(prefix)),
          `${key}:${selector}`,
        ).toBe(true)
      }
    }
  })

  it('covers the required selector groups for real Temu v1 templates', () => {
    for (const key of TEMU_POP_REQUIRED_REAL_SELECTOR_KEYS) {
      expect(TEMU_POP_SELECTORS[key], key).toBeDefined()
      expect(TEMU_POP_SELECTORS[key].length, key).toBeGreaterThanOrEqual(2)
    }
  })

  it('stores selectors as selector records with dispatch-ready metadata', () => {
    expect(TEMU_POP_SELECTOR_RECORDS).toHaveLength(Object.keys(TEMU_POP_SELECTORS).length)
    for (const record of TEMU_POP_SELECTOR_RECORDS) {
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
