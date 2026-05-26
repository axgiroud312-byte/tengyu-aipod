import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { type Page, chromium } from 'playwright'
import { describe, expect, it } from 'vitest'
import { bitBrowserClient } from '../../../../main/lib/bit-browser-client'
import { findBitBrowserProfile2_1111 } from '../_commons/test-helpers'
import { parseDraftPage } from './page-parser'
import { TEMU_POP_TEMPLATE_URLS } from './selectors'

const runRealListing = process.env.REAL_LISTING === '1'
const describeReal = runRealListing ? describe : describe.skip
const evidenceDir = resolve(
  process.cwd(),
  '../..',
  '.trellis/tasks/05-26-listing-platforms-commons-refactor/evidence/temu-parser',
)

describeReal('Temu PopTemu page parser on real Dianxiaomi pages', () => {
  it('reads observed state from the two real v1 Temu templates', async () => {
    const profile = await findBitBrowserProfile2_1111()
    const endpoint = await bitBrowserClient.openProfile(profile.id)
    const browser = await chromium.connectOverCDP(endpoint.http)
    const context = browser.contexts()[0] ?? (await browser.newContext())
    const pages: Page[] = []
    const report: unknown[] = []

    try {
      await mkdir(evidenceDir, { recursive: true })

      for (const [template, url] of Object.entries(TEMU_POP_TEMPLATE_URLS)) {
        const page = await context.newPage()
        pages.push(page)
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60_000 })
        await waitForTemuEditorReady(page)

        const state = await parseDraftPage(page)
        report.push({ template, state })
        await page.screenshot({
          path: resolve(evidenceDir, `real-parser-${template}.png`),
          fullPage: true,
        })

        expect(state.template_key, `${template}:template_key`).toBe(template)
        expect(state.shop_context, `${template}:shop_context`).toBe('dianxiaomi-temu-pop')
        expect(state.workflow_step, `${template}:workflow_step`).toBe('editing')
        expect(state.is_login_required, `${template}:login`).toBe(false)
        expect(state.is_loading, `${template}:loading`).toBe(false)
        expect(state.is_blocking_modal, `${template}:blocking`).toBe(false)
        expect(state.title_field.found, `${template}:title`).toBe(true)
        expect(state.title_field.current_value, `${template}:title_value`).toBeTruthy()
        expect(state.english_title_field.found, `${template}:english_title`).toBe(true)
        expect(state.sku_field.found, `${template}:sku`).toBe(true)
        expect(state.sku_field.current_value, `${template}:sku_value`).toBeTruthy()
        expect(state.carousel_images.found, `${template}:carousel_images`).toBe(true)
        expect(state.carousel_images.count, `${template}:carousel_image_count`).toBeGreaterThan(0)
        expect(state.material_images.found, `${template}:material_images`).toBe(true)
        expect(state.description_images.found, `${template}:description_images`).toBe(true)
        expect(state.one_click_sku.found, `${template}:one_click_sku`).toBe(true)
        expect(state.sku_table.found, `${template}:sku_table`).toBe(true)
        expect(state.save_button.found, `${template}:save_button`).toBe(true)
        expect(state.publish_button.found, `${template}:publish_button`).toBe(true)
      }

      await writeFile(
        resolve(evidenceDir, 'real-parser-state-report.json'),
        JSON.stringify(report, null, 2),
      )
    } finally {
      await Promise.all(pages.map((page) => page.close().catch(() => undefined)))
    }
  }, 120_000)
})

async function waitForTemuEditorReady(page: Page): Promise<void> {
  await page.locator('#productProductInfo input.productNumber').waitFor({
    state: 'attached',
    timeout: 60_000,
  })
  await page.locator('#skuDataInfo th:has-text("SKU货号") .link:has-text("一键生成")').waitFor({
    state: 'attached',
    timeout: 60_000,
  })
  await page.locator('#shipmentInfo .ant-form-item:has(label[title="运费模板"])').waitFor({
    state: 'attached',
    timeout: 60_000,
  })
}
