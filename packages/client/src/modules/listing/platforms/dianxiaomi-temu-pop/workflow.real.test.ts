import { mkdir, readdir, writeFile } from 'node:fs/promises'
import { extname, join, resolve } from 'node:path'
import {
  type ListingConfig,
  type ListingItem,
  SLICE_8_LISTING_TEMPLATES,
} from '@tengyu-aipod/shared'
import { type Page, chromium } from 'playwright'
import { describe, expect, it } from 'vitest'
import { bitBrowserClient } from '../../../../main/lib/bit-browser-client'
import { findBitBrowserProfile2_1111 } from '../_commons/test-helpers'
import { parseDraftPage } from './page-parser'
import { runListingItem } from './workflow'

const runRealListing = process.env.REAL_LISTING === '1'
const runMutatingRealListing = process.env.REAL_LISTING_MUTATE === '1'
const describeReal = runRealListing ? describe : describe.skip
const evidenceDir = resolve(
  process.cwd(),
  '../..',
  '.trellis/tasks/05-26-listing-platforms-commons-refactor/evidence/temu-workflow',
)

const REAL_TEMPLATES = [
  {
    template: SLICE_8_LISTING_TEMPLATES[0],
    skuFolder: '/Users/macmini/Desktop/服装素材摆放举例/GzG0005',
  },
  {
    template: SLICE_8_LISTING_TEMPLATES[1],
    skuFolder: '/Users/macmini/Desktop/素材文件夹/GzG0114',
  },
] as const

describeReal('Temu PopTemu workflow on real Dianxiaomi pages', () => {
  it('runs the workflow against the two real Temu templates with real DOM assertions', async () => {
    const profile = await findBitBrowserProfile2_1111()
    const endpoint = await bitBrowserClient.openProfile(profile.id)
    const browser = await chromium.connectOverCDP(endpoint.http)
    const context = browser.contexts()[0] ?? (await browser.newContext())
    const pages: Page[] = []
    const report: unknown[] = []

    try {
      await mkdir(evidenceDir, { recursive: true })

      for (const { template, skuFolder } of REAL_TEMPLATES) {
        const page = await context.newPage()
        pages.push(page)
        await page.goto(template.editUrl, { waitUntil: 'domcontentloaded', timeout: 60_000 })
        await waitForTemuEditorReady(page)

        const before = await parseDraftPage(page)
        expect(before.workflow_step, `${template.key}:workflow_step`).toBe('editing')
        expect(before.shop_context, `${template.key}:shop_context`).toBe('dianxiaomi-temu-pop')
        expect(before.shop_field.current_value, `${template.key}:shop_value`).toBeTruthy()
        expect(before.title_field.current_value, `${template.key}:title_value`).toBeTruthy()
        expect(before.sku_field.current_value, `${template.key}:sku_value`).toBeTruthy()

        const imageFiles = await findFiles(skuFolder, IMAGE_EXTENSIONS, 4)
        const videoFiles = await findFiles(template.materialRootDir, VIDEO_EXTENSIONS, 1)
        const item = createRealItem({
          template,
          before,
          imageFiles,
          videoFiles,
        })
        const config = createRealConfig(template)
        const result = await runListingItem(page, item, config, {
          allowMutation: runMutatingRealListing,
        })
        const after = await parseDraftPage(page)

        await page.screenshot({
          path: resolve(evidenceDir, `real-workflow-${template.key}.png`),
          fullPage: true,
        })
        report.push({
          templateKey: template.key,
          mutateEnabled: runMutatingRealListing,
          imageFiles,
          videoFiles,
          before,
          stages: result.stages,
          after,
        })

        expect(result.status, `${template.key}:status`).toBe('success')
        expect(result.stages, `${template.key}:stage_count`).toHaveLength(12)
        expect(
          result.stages.every((stage) => stage.ok),
          `${template.key}:all_stages_ok`,
        ).toBe(true)
        expect(
          result.stages.every(
            (stage) =>
              typeof stage.details?.observed_state === 'string' &&
              typeof stage.details?.target_state === 'string' &&
              typeof stage.details?.transition === 'string' &&
              typeof stage.details?.success_evidence === 'string',
          ),
          `${template.key}:stage_contract`,
        ).toBe(true)

        if (runMutatingRealListing) {
          expect(imageFiles.length, `${template.key}:real_image_files`).toBeGreaterThan(0)
          expect(videoFiles.length, `${template.key}:real_video_files`).toBeGreaterThan(0)
        } else {
          expect(after.title_field.current_value, `${template.key}:title_after`).toBe(
            before.title_field.current_value,
          )
          expect(after.sku_field.current_value, `${template.key}:sku_after`).toBe(
            before.sku_field.current_value,
          )
        }
      }

      await writeFile(
        resolve(evidenceDir, 'real-workflow-state-report.json'),
        JSON.stringify(report, null, 2),
      )
    } finally {
      await Promise.all(pages.map((page) => page.close().catch(() => undefined)))
    }
  }, 180_000)
})

async function waitForTemuEditorReady(page: Page): Promise<void> {
  await page.locator('#productProductInfo input.productNumber').waitFor({
    state: 'attached',
    timeout: 60_000,
  })
  const deadline = Date.now() + 60_000
  let latest = await parseDraftPage(page)
  while (Date.now() < deadline) {
    latest = await parseDraftPage(page)
    if (
      latest.workflow_step === 'editing' &&
      latest.shop_field.found &&
      latest.title_field.found &&
      latest.sku_field.found &&
      latest.carousel_images.found
    ) {
      return
    }
    await page.waitForTimeout(250)
  }

  throw new Error(
    `Temu editor not ready: ${JSON.stringify({
      workflow_step: latest.workflow_step,
      shop_found: latest.shop_field.found,
      title_found: latest.title_field.found,
      sku_found: latest.sku_field.found,
      carousel_found: latest.carousel_images.found,
    })}`,
  )
}

function createRealItem(args: {
  template: (typeof SLICE_8_LISTING_TEMPLATES)[number]
  before: Awaited<ReturnType<typeof parseDraftPage>>
  imageFiles: string[]
  videoFiles: string[]
}): ListingItem {
  return {
    id: `real-${args.template.key}`,
    sku: args.before.sku_field.current_value ?? `REAL-${args.template.key}`,
    title: args.before.title_field.current_value ?? `Real ${args.template.key}`,
    platform: 'temu-pop',
    templateKey: args.template.key,
    editUrl: args.template.editUrl,
    materialRootDir: args.template.materialRootDir,
    targetShopName: args.before.shop_field.current_value ?? '',
    imageGroups:
      args.template.key === 'temu-clothing'
        ? {
            sku: args.imageFiles.slice(1),
            carousel: [],
            material: args.imageFiles.slice(0, 1),
            preview: [],
            description: [],
          }
        : {
            sku: [],
            carousel: args.imageFiles.slice(1),
            material: [],
            preview: args.imageFiles.slice(0, 1),
            description: [],
          },
    variantGroups: [],
    videoPaths: args.videoFiles,
  }
}

function createRealConfig(template: (typeof SLICE_8_LISTING_TEMPLATES)[number]): ListingConfig {
  return {
    batchId: 'real-temu-workflow',
    profileId: '2-1111',
    template,
    submitMode: 'save-draft',
    maxAttempts: 1,
    timeoutMs: 60_000,
    evidenceDir: resolve(evidenceDir, template.key),
  }
}

const IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp'])
const VIDEO_EXTENSIONS = new Set(['.mp4', '.mov', '.webm'])

async function findFiles(
  root: string,
  extensions: ReadonlySet<string>,
  limit: number,
): Promise<string[]> {
  const files: string[] = []
  await collectFiles(root, extensions, limit, files)
  return files
}

async function collectFiles(
  root: string,
  extensions: ReadonlySet<string>,
  limit: number,
  files: string[],
): Promise<void> {
  if (files.length >= limit) {
    return
  }
  const entries = await readdir(root, { withFileTypes: true }).catch(() => [])
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    if (files.length >= limit) {
      return
    }
    const entryPath = join(root, entry.name)
    if (entry.isFile() && extensions.has(extname(entry.name).toLowerCase())) {
      files.push(entryPath)
      continue
    }
    if (entry.isDirectory()) {
      await collectFiles(entryPath, extensions, limit, files)
    }
  }
}
