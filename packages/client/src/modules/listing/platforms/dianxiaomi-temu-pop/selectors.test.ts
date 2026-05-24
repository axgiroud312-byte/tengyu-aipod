import { describe, expect, it } from 'vitest'
import { TEMU_POP_REQUIRED_REAL_SELECTOR_KEYS, TEMU_POP_SELECTORS } from './selectors'

const VALID_SELECTOR_PREFIXES = ['css=', 'text=', 'label=', 'placeholder=', 'role=']

describe('Temu PopTemu selectors', () => {
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
})
