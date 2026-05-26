import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { type Page, chromium } from 'playwright'
import { describe, expect, it } from 'vitest'
import { bitBrowserClient } from '../../../../main/lib/bit-browser-client'
import { locatorForSelector } from '../_commons/page-locator'
import { findBitBrowserProfile2_1111 } from '../_commons/test-helpers'
import {
  type ListingSelector,
  SHEIN_REQUIRED_REAL_SELECTOR_KEYS,
  SHEIN_SELECTORS,
  SHEIN_TEMPLATE_URLS,
} from './selectors'

const runRealListing = process.env.REAL_LISTING === '1'
const describeReal = runRealListing ? describe : describe.skip
const evidenceDir = resolve(
  process.cwd(),
  '../..',
  '.trellis/tasks/05-26-listing-platforms-commons-refactor/evidence/shein-selectors',
)

describeReal('Dianxiaomi Shein selectors on the real edit page', () => {
  it('matches required selectors on the v1 real Shein template', async () => {
    const profile = await findBitBrowserProfile2_1111()
    const endpoint = await bitBrowserClient.openProfile(profile.id)
    const browser = await chromium.connectOverCDP(endpoint.http)
    const context = browser.contexts()[0] ?? (await browser.newContext())
    const page = await context.newPage()
    const hits: Record<string, { selector: ListingSelector; count: number } | null> = {}

    try {
      await page.goto(SHEIN_TEMPLATE_URLS.shein, {
        waitUntil: 'domcontentloaded',
        timeout: 60_000,
      })
      await waitForSheinEditorReady(page)
      await mkdir(evidenceDir, { recursive: true })
      await page.screenshot({
        path: resolve(evidenceDir, 'real-selector-shein.png'),
        fullPage: true,
      })

      for (const key of SHEIN_REQUIRED_REAL_SELECTOR_KEYS) {
        hits[key] = await firstSelectorHit(page, SHEIN_SELECTORS[key])
      }
      await writeFile(
        resolve(evidenceDir, 'real-selector-hit-report.json'),
        JSON.stringify(
          {
            template: 'shein',
            url: page.url(),
            profile: profile.name,
            hits,
          },
          null,
          2,
        ),
      )

      for (const key of SHEIN_REQUIRED_REAL_SELECTOR_KEYS) {
        expect(hits[key], `shein:${key}`).not.toBeNull()
      }
    } finally {
      await page.close().catch(() => undefined)
      if (browser.isConnected()) {
        await browser.close().catch(() => undefined)
      }
    }
  }, 120_000)
})

async function waitForSheinEditorReady(page: Page): Promise<void> {
  await page.locator('#productBasicInfo').waitFor({ state: 'attached', timeout: 60_000 })
  await page.locator('#productInfo').waitFor({ state: 'attached', timeout: 60_000 })
  await page.locator('#skuDataInfo').waitFor({ state: 'attached', timeout: 60_000 })
  await page.locator('#skuImageInfo').waitFor({ state: 'attached', timeout: 60_000 })
  await page.locator('#skuDescInfo').waitFor({ state: 'attached', timeout: 60_000 })
}

async function firstSelectorHit(
  page: Page,
  selectors: readonly ListingSelector[],
): Promise<{ selector: ListingSelector; count: number } | null> {
  for (const selector of selectors) {
    const count = await locatorForSelector(page, selector).count()
    if (count > 0) {
      return { selector, count }
    }
  }
  return null
}
