import type { ListingSelector } from '@tengyu-aipod/shared'
import type { Locator, Page } from 'playwright'
import { locateBySelectorsWithFallback } from './page-locator'

export type ToastState = {
  found: boolean
  message: string | null
  selector: ListingSelector | null
}

export async function readToast(
  page: Page,
  selectors: readonly ListingSelector[],
): Promise<ToastState> {
  const hit = await locateBySelectorsWithFallback(page, selectors)
  if (!hit) {
    return {
      found: false,
      message: null,
      selector: null,
    }
  }

  return {
    found: true,
    message: await readText(hit.locator),
    selector: hit.selector,
  }
}

async function readText(locator: Locator) {
  const text = await locator
    .evaluate((node) => node.textContent?.replace(/\s+/g, ' ').trim() || null)
    .catch(() => null)
  return text && text.length > 0 ? text : null
}
