import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { type Page, chromium } from 'playwright'
import { describe, expect, it } from 'vitest'
import { bitBrowserClient } from '../../../../main/lib/bit-browser-client'
import { findBitBrowserProfile2_1111 } from '../_commons/test-helpers'
import { parseDraftPage } from './page-parser'
import { SHEIN_TEMPLATE_URLS } from './selectors'

const runRealListing = process.env.REAL_LISTING === '1'
const describeReal = runRealListing ? describe : describe.skip
const evidenceDir = resolve(
  process.cwd(),
  '../..',
  '.trellis/tasks/05-26-listing-platforms-commons-refactor/evidence/shein-parser',
)

describeReal('Dianxiaomi Shein page parser on the real edit page', () => {
  it('reads observed state from the v1 real Shein template', async () => {
    const profile = await findBitBrowserProfile2_1111()
    const endpoint = await bitBrowserClient.openProfile(profile.id)
    const browser = await chromium.connectOverCDP(endpoint.http)
    const context = browser.contexts()[0] ?? (await browser.newContext())
    const page = await context.newPage()

    try {
      await mkdir(evidenceDir, { recursive: true })
      await page.goto(SHEIN_TEMPLATE_URLS.shein, {
        waitUntil: 'domcontentloaded',
        timeout: 60_000,
      })
      await waitForSheinEditorReady(page)

      const state = await parseDraftPage(page)
      await page.screenshot({
        path: resolve(evidenceDir, 'real-parser-shein.png'),
        fullPage: true,
      })
      await writeFile(
        resolve(evidenceDir, 'real-parser-state-report.json'),
        JSON.stringify({ profile: profile.name, state }, null, 2),
      )

      expect(state.template_key).toBe('shein')
      expect(state.shop_context).toBe('dianxiaomi-shein')
      expect(state.workflow_step).toBe('editing')
      expect(state.is_login_required).toBe(false)
      expect(state.is_loading).toBe(false)
      expect(state.shop_field.found).toBe(true)
      expect(state.shop_field.current_value).toBeTruthy()
      expect(state.category_field.found).toBe(true)
      expect(state.title_field.found).toBe(true)
      expect(state.sku_field.found).toBe(true)
      expect(state.description_field.found).toBe(true)
      expect(state.variant_attribute_section.found).toBe(true)
      expect(state.sku_table.found).toBe(true)
      expect(state.sku_table.row_count).toBeGreaterThan(0)
      expect(state.one_click_sku.found).toBe(true)
      expect(state.variant_images.found).toBe(true)
      expect(state.detail_images.found).toBe(true)
      expect(state.sales_info_section.found).toBe(true)
      expect(state.save_button.found).toBe(true)
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
