import { mkdir, readdir, writeFile } from 'node:fs/promises'
import { extname, join, resolve } from 'node:path'
import { type Page, chromium } from 'playwright'
import { describe, expect, it } from 'vitest'
import { bitBrowserClient } from '../../../../main/lib/bit-browser-client'
import { findBitBrowserProfile2_1111 } from '../_commons/test-helpers'
import {
  fillEnglishTitle,
  fillSku,
  fillTitle,
  generateSkuCode,
  replaceShopName,
  uploadCarouselImages,
  uploadVideo,
} from './action-executor'
import { parseDraftPage } from './page-parser'
import { TEMU_POP_TEMPLATE_URLS } from './selectors'

const runRealListing = process.env.REAL_LISTING === '1'
const runMutatingRealListing = process.env.REAL_LISTING_MUTATE === '1'
const describeReal = runRealListing ? describe : describe.skip
const evidenceDir = resolve(
  process.cwd(),
  '../..',
  '.trellis/tasks/05-26-listing-platforms-commons-refactor/evidence/temu-executor',
)

const REAL_TEMPLATES = {
  clothing: {
    url: TEMU_POP_TEMPLATE_URLS.clothing,
    materialRoot: '/Users/macmini/Desktop/服装素材摆放举例',
  },
  general: {
    url: TEMU_POP_TEMPLATE_URLS.general,
    materialRoot: '/Users/macmini/Desktop/素材文件夹',
  },
} as const

describeReal('Temu PopTemu action executor on real Dianxiaomi pages', () => {
  it('runs low-risk text actions against the two real Temu templates', async () => {
    const profile = await findBitBrowserProfile2_1111()
    const endpoint = await bitBrowserClient.openProfile(profile.id)
    const browser = await chromium.connectOverCDP(endpoint.http)
    const context = browser.contexts()[0] ?? (await browser.newContext())
    const pages: Page[] = []
    const report: unknown[] = []

    try {
      await mkdir(evidenceDir, { recursive: true })

      for (const [template, config] of Object.entries(REAL_TEMPLATES)) {
        const page = await context.newPage()
        pages.push(page)
        await page.goto(config.url, { waitUntil: 'domcontentloaded', timeout: 60_000 })
        await waitForTemuEditorReady(page)

        const before = await parseDraftPage(page)
        expect(before.title_field.current_value, `${template}:title_value`).toBeTruthy()
        expect(
          before.english_title_field.current_value,
          `${template}:english_title_value`,
        ).toBeTruthy()
        expect(before.sku_field.current_value, `${template}:sku_value`).toBeTruthy()
        expect(before.shop_field.current_value, `${template}:shop_value`).toBeTruthy()

        const afterShop = await replaceShopName(page, before.shop_field.current_value ?? '')
        const afterTitle = await fillTitle(page, before.title_field.current_value ?? '')
        const afterEnglish = await fillEnglishTitle(
          page,
          before.english_title_field.current_value ?? '',
        )
        const afterSku = await fillSku(page, before.sku_field.current_value ?? '')
        const after = await parseDraftPage(page)

        await page.screenshot({
          path: resolve(evidenceDir, `real-executor-${template}.png`),
          fullPage: true,
        })
        report.push({
          template,
          before,
          afterShop,
          afterTitle,
          afterEnglish,
          afterSku,
          after,
        })

        expect(after.shop_field.current_value, `${template}:shop_after`).toBe(
          before.shop_field.current_value,
        )
        expect(after.title_field.current_value, `${template}:title_after`).toBe(
          before.title_field.current_value,
        )
        expect(after.english_title_field.current_value, `${template}:english_after`).toBe(
          before.english_title_field.current_value,
        )
        expect(after.sku_field.current_value, `${template}:sku_after`).toBe(
          before.sku_field.current_value,
        )
      }

      await writeFile(
        resolve(evidenceDir, 'real-executor-state-report.json'),
        JSON.stringify(report, null, 2),
      )
    } finally {
      await Promise.all(pages.map((page) => page.close().catch(() => undefined)))
    }
  }, 120_000)

  it('documents mutating SKU/image/video action readiness on real templates', async () => {
    const profile = await findBitBrowserProfile2_1111()
    const endpoint = await bitBrowserClient.openProfile(profile.id)
    const browser = await chromium.connectOverCDP(endpoint.http)
    const context = browser.contexts()[0] ?? (await browser.newContext())
    const page = await context.newPage()
    const report: Record<string, unknown> = {
      mutateEnabled: runMutatingRealListing,
      videoFileStatus: 'not_checked',
      imageUploadStatus: 'not_run',
      videoUploadStatus: 'not_run',
      skuGenerateStatus: 'not_run',
    }

    try {
      await mkdir(evidenceDir, { recursive: true })
      await page.goto(REAL_TEMPLATES.general.url, {
        waitUntil: 'domcontentloaded',
        timeout: 60_000,
      })
      await waitForTemuEditorReady(page)

      const before = await parseDraftPage(page)
      report.before = before
      expect(before.one_click_sku.found).toBe(true)
      expect(before.video_section.upload_button_found).toBe(true)
      expect(before.carousel_images.found).toBe(true)

      if (runMutatingRealListing) {
        const image = await findFirstFile(REAL_TEMPLATES.general.materialRoot, IMAGE_EXTENSIONS)
        if (image) {
          report.imageUploadStatus = await uploadCarouselImages(page, [image], {
            allowMutation: true,
          })
        } else {
          report.imageUploadStatus = 'skipped:no_real_image_file'
        }

        const video = await findFirstFile(REAL_TEMPLATES.general.materialRoot, VIDEO_EXTENSIONS)
        if (video) {
          report.videoFileStatus = video
          report.videoUploadStatus = await uploadVideo(page, [video], {
            allowMutation: true,
          })
        } else {
          report.videoFileStatus = 'skipped:no_real_video_file'
        }

        const prefix = `TENGYU${Date.now()}`
        report.skuGenerateStatus = await generateSkuCode(page, prefix, {
          allowMutation: true,
        })
      } else {
        report.imageUploadStatus = 'skipped:REAL_LISTING_MUTATE_not_set'
        report.videoUploadStatus = 'skipped:REAL_LISTING_MUTATE_not_set'
        report.skuGenerateStatus = 'skipped:REAL_LISTING_MUTATE_not_set'
      }

      await page.screenshot({
        path: resolve(evidenceDir, 'real-executor-mutate-readiness.png'),
        fullPage: true,
      })
      await writeFile(
        resolve(evidenceDir, 'real-executor-mutate-readiness.json'),
        JSON.stringify(report, null, 2),
      )
    } finally {
      await page.close().catch(() => undefined)
    }
  }, 180_000)
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

const IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp'])
const VIDEO_EXTENSIONS = new Set(['.mp4', '.mov', '.webm'])

async function findFirstFile(
  root: string,
  extensions: ReadonlySet<string>,
): Promise<string | null> {
  const entries = await readdir(root, { withFileTypes: true }).catch(() => [])
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    const entryPath = join(root, entry.name)
    if (entry.isFile() && extensions.has(extname(entry.name).toLowerCase())) {
      return entryPath
    }
    if (entry.isDirectory()) {
      const nested = await findFirstFile(entryPath, extensions)
      if (nested) {
        return nested
      }
    }
  }
  return null
}
