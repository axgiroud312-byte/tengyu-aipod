import { describe, expect, it, vi } from 'vitest'
import {
  locateBySelectorsWithFallback,
  locatorForSelector,
  selectorRecordMap,
  selectorToLocator,
  selectorsForRecord,
} from './page-locator'

describe('listing page locator commons', () => {
  it('parses prefixed selector strings', () => {
    expect(selectorToLocator('css=#productInfo')).toEqual({
      type: 'css',
      value: '#productInfo',
    })
    expect(selectorToLocator('role=button[name="保存"]')).toEqual({
      type: 'role',
      value: 'button[name="保存"]',
    })
  })

  it('builds selector fallbacks from selector records', () => {
    const records = [
      {
        key: 'title_input',
        name: 'Title input',
        primary: 'css=input[name="title"]',
        fallbacks: ['label=商品标题'],
        version: '1.0.0',
        createdAt: '2026-05-26T00:00:00.000Z',
      },
    ] as const

    expect(selectorsForRecord(records, 'title_input')).toEqual([
      'css=input[name="title"]',
      'label=商品标题',
    ])
    expect(selectorRecordMap(records)).toEqual({
      title_input: ['css=input[name="title"]', 'label=商品标题'],
    })
  })

  it('locates the first matching selector with fallback order', async () => {
    const first = createLocator(0)
    const second = createLocator(1)
    const page = createPage({
      'css=.first': first,
      'text=second': second,
    })

    const hit = await locateBySelectorsWithFallback(page as never, ['css=.first', 'text=second'])

    expect(hit).toEqual({
      selector: 'text=second',
      locator: second,
    })
  })

  it('locates selector records with primary and fallback order', async () => {
    const primary = createLocator(0)
    const fallback = createLocator(1)
    const page = createPage({
      'css=.primary': primary,
      'text=fallback': fallback,
    })

    const hit = await locateBySelectorsWithFallback(page as never, [
      {
        key: 'upload_button',
        name: 'Upload button',
        primary: 'css=.primary',
        fallbacks: ['text=fallback'],
        version: '1.0.0',
        createdAt: '2026-05-26T00:00:00.000Z',
      },
    ])

    expect(hit).toEqual({
      selector: 'text=fallback',
      locator: fallback,
    })
  })

  it('maps role selectors to Playwright getByRole', () => {
    const page = createPage()

    locatorForSelector(page as never, 'role=button[name="保存"]')

    expect(page.getByRole).toHaveBeenCalledWith('button', { name: '保存' })
  })
})

function createLocator(count: number) {
  const locator = {
    first: vi.fn(() => locator),
    count: vi.fn(async () => count),
  }
  return locator
}

function createPage(locators: Record<string, ReturnType<typeof createLocator>> = {}) {
  return {
    locator: vi.fn((value: string) => locators[`css=${value}`] ?? createLocator(0)),
    getByText: vi.fn((value: string) => locators[`text=${value}`] ?? createLocator(0)),
    getByLabel: vi.fn((value: string) => locators[`label=${value}`] ?? createLocator(0)),
    getByPlaceholder: vi.fn(
      (value: string) => locators[`placeholder=${value}`] ?? createLocator(0),
    ),
    getByRole: vi.fn((_role: string, options?: { name?: string }) => {
      const key = options?.name ? `role=button[name="${options.name}"]` : 'role=button'
      return locators[key] ?? createLocator(0)
    }),
    waitForTimeout: vi.fn(async () => undefined),
  }
}
