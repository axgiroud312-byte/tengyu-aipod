import { type ListingSelector, type SelectorRecord, lookupSelector } from '@tengyu-aipod/shared'
import type { Locator, Page } from 'playwright'

export function selectorToLocator(selector: ListingSelector) {
  const separatorIndex = selector.indexOf('=')
  const type = selector.slice(0, separatorIndex)
  const value = selector.slice(separatorIndex + 1)
  return { type, value }
}

export function locatorForSelector(page: Page, selector: ListingSelector): Locator {
  const { type, value } = selectorToLocator(selector)
  if (type === 'css') {
    return page.locator(value)
  }
  if (type === 'text') {
    return page.getByText(value)
  }
  if (type === 'label') {
    return page.getByLabel(value)
  }
  if (type === 'placeholder') {
    return page.getByPlaceholder(value)
  }
  if (type === 'role') {
    const match = value.match(/^([a-z]+)(?:\[name="(.+)"\])?$/)
    const role = match?.[1] ?? value
    const name = match?.[2]
    return page.getByRole(role as Parameters<Page['getByRole']>[0], name ? { name } : undefined)
  }
  return page.locator(value)
}

export function selectorsForRecord<TKey extends string>(
  records: readonly SelectorRecord<TKey>[],
  key: TKey,
): ListingSelector[] {
  const record = lookupSelector(records, key)
  return [record.primary, ...record.fallbacks]
}

export function selectorRecordMap<TKey extends string>(
  records: readonly SelectorRecord<TKey>[],
): Record<TKey, ListingSelector[]> {
  return Object.fromEntries(
    records.map((record) => [record.key, [record.primary, ...record.fallbacks]]),
  ) as Record<TKey, ListingSelector[]>
}

export async function locateBySelectorsWithFallback(
  page: Page,
  source: readonly ListingSelector[] | readonly SelectorRecord[],
  timeoutMs = 0,
): Promise<{ selector: ListingSelector; locator: Locator } | null> {
  const selectors = selectorCandidates(source)
  const deadline = Date.now() + timeoutMs

  do {
    for (const selector of selectors) {
      const locator = locatorForSelector(page, selector).first()
      const count = await locator.count().catch(() => 0)
      if (count > 0) {
        return { selector, locator }
      }
    }
    if (timeoutMs <= 0 || Date.now() >= deadline) {
      break
    }
    await page.waitForTimeout(Math.min(200, Math.max(0, deadline - Date.now())))
  } while (Date.now() < deadline)

  return null
}

function selectorCandidates(
  source: readonly ListingSelector[] | readonly SelectorRecord[],
): ListingSelector[] {
  const [first] = source
  if (!first) {
    return []
  }
  if (typeof first === 'string') {
    return [...(source as readonly ListingSelector[])]
  }
  return (source as readonly SelectorRecord[]).flatMap((record) => [
    record.primary,
    ...record.fallbacks,
  ])
}
