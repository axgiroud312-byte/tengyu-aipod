import { mkdir, readdir, writeFile } from 'node:fs/promises'
import { extname, join, resolve } from 'node:path'
import { type Page, chromium } from 'playwright'
import { describe, expect, it } from 'vitest'
import { type BitBrowserProfile, bitBrowserClient } from '../../../../main/lib/bit-browser-client'
import {
  fillSku,
  fillTitle,
  generateSkuCode,
  replaceShopName,
  uploadDetailImages,
  uploadVariantImages,
  uploadVideo,
} from './action-executor'
import { parseDraftPage } from './page-parser'
import { SHEIN_TEMPLATE_URLS } from './selectors'

const runRealListing = process.env.REAL_LISTING === '1'
const runMutatingRealListing = process.env.REAL_LISTING_MUTATE === '1'
const describeReal = runRealListing ? describe : describe.skip
const evidenceDir = resolve(
  process.cwd(),
  '../..',
  '.trellis/tasks/05-23-listing-shein-executor/evidence',
)

const REAL_TEMPLATE = {
  key: 'shein',
  url: SHEIN_TEMPLATE_URLS.shein,
  materialRoot: '/Users/macmini/Desktop/服装素材摆放举例/GzG0001',
} as const

describeReal('Shein action executor on real Dianxiaomi page', () => {
  it('runs low-risk text actions against the real Shein template', async () => {
    const profile = await findBitBrowserProfile2_1111()
    const endpoint = await bitBrowserClient.openProfile(profile.id)
    const browser = await chromium.connectOverCDP(endpoint.http)
    const context = browser.contexts()[0] ?? (await browser.newContext())
    const page = await context.newPage()
    const report: Record<string, unknown> = { template: REAL_TEMPLATE.key }

    try {
      await mkdir(evidenceDir, { recursive: true })
      await page.goto(REAL_TEMPLATE.url, { waitUntil: 'domcontentloaded', timeout: 60_000 })
      await waitForSheinEditorReady(page)

      const before = await parseDraftPage(page)
      expect(before.title_field.current_value).toBeTruthy()
      expect(before.sku_field.current_value).toBeTruthy()
      expect(before.shop_field.current_value).toBeTruthy()

      const afterShop = await replaceShopName(page, before.shop_field.current_value ?? '')
      const afterTitle = await fillTitle(page, before.title_field.current_value ?? '')
      const afterSku = await fillSku(page, before.sku_field.current_value ?? '')
      const after = await parseDraftPage(page)

      await page.screenshot({
        path: resolve(evidenceDir, 'real-executor-shein.png'),
        fullPage: true,
      })
      Object.assign(report, { before, afterShop, afterTitle, afterSku, after })
      await writeFile(
        resolve(evidenceDir, 'real-executor-state-report.json'),
        JSON.stringify(report, null, 2),
      )

      expect(after.shop_field.current_value).toBe(before.shop_field.current_value)
      expect(after.title_field.current_value).toBe(before.title_field.current_value)
      expect(after.sku_field.current_value).toBe(before.sku_field.current_value)
    } finally {
      await page.close().catch(() => undefined)
      if (browser.isConnected()) {
        await browser.close().catch(() => undefined)
      }
    }
  }, 120_000)

  it('documents mutating SKU/image/video readiness on the real Shein template', async () => {
    const profile = await findBitBrowserProfile2_1111()
    const endpoint = await bitBrowserClient.openProfile(profile.id)
    const browser = await chromium.connectOverCDP(endpoint.http)
    const context = browser.contexts()[0] ?? (await browser.newContext())
    const page = await context.newPage()
    const report: Record<string, unknown> = {
      mutateEnabled: runMutatingRealListing,
      imageUploadStatus: 'not_run',
      videoUploadStatus: 'not_run',
      skuGenerateStatus: 'not_run',
    }

    try {
      await mkdir(evidenceDir, { recursive: true })
      await page.goto(REAL_TEMPLATE.url, { waitUntil: 'domcontentloaded', timeout: 60_000 })
      await waitForSheinEditorReady(page)

      const before = await parseDraftPage(page)
      report.before = before
      expect(before.one_click_sku.found).toBe(true)
      expect(before.variant_images.found).toBe(true)
      expect(before.detail_images.found).toBe(true)

      if (runMutatingRealListing) {
        const image = await findFirstFile(REAL_TEMPLATE.materialRoot, IMAGE_EXTENSIONS)
        if (image) {
          report.imageUploadStatus = {
            variant: await uploadVariantImages(page, [image], { allowMutation: true }),
            detail: await uploadDetailImages(page, [image], { allowMutation: true }),
          }
        } else {
          report.imageUploadStatus = 'skipped:no_real_image_file'
        }

        const video = await findFirstFile(REAL_TEMPLATE.materialRoot, VIDEO_EXTENSIONS)
        if (video) {
          report.videoUploadStatus = await uploadVideo(page, [video], { allowMutation: true })
        } else {
          report.videoUploadStatus = 'skipped:no_real_video_file'
        }

        const prefix = `TENGYU${Date.now()}`
        report.skuGenerateStatus = await generateSkuCode(page, prefix, { allowMutation: true })
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
      if (browser.isConnected()) {
        await browser.close().catch(() => undefined)
      }
    }
  }, 180_000)
})

async function findBitBrowserProfile2_1111(): Promise<BitBrowserProfile> {
  const profiles = await bitBrowserClient.listProfiles()
  const profile = profiles.find((item) => {
    const candidates = [
      item.id,
      item.name,
      item.remark,
      item.seq === undefined ? undefined : String(item.seq),
      item.seq === undefined ? undefined : `${item.seq}-${item.name}`,
    ]
    return candidates.some((candidate) => candidate === '2-1111')
  })
  if (!profile) {
    throw new Error('BitBrowser profile 2-1111 not found')
  }
  return profile
}

async function waitForSheinEditorReady(page: Page): Promise<void> {
  await page.locator('#productBasicInfo').waitFor({ state: 'attached', timeout: 60_000 })
  await page.locator('#productInfo').waitFor({ state: 'attached', timeout: 60_000 })
  await page.locator('#skuDataInfo').waitFor({ state: 'attached', timeout: 60_000 })
  await page.locator('#skuImageInfo').waitFor({ state: 'attached', timeout: 60_000 })
  await page.locator('#skuDescInfo').waitFor({ state: 'attached', timeout: 60_000 })
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
