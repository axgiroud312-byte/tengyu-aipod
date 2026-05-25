import { mkdir, readdir, writeFile } from 'node:fs/promises'
import { extname, join, resolve } from 'node:path'
import {
  type ListingConfig,
  type ListingItem,
  SLICE_8_LISTING_TEMPLATES,
} from '@tengyu-aipod/shared'
import { type Page, chromium } from 'playwright'
import { describe, expect, it } from 'vitest'
import { type BitBrowserProfile, bitBrowserClient } from '../../../../main/lib/bit-browser-client'
import { parseDraftPage } from './page-parser'
import { runListingItem } from './workflow'

const runRealListing = process.env.REAL_LISTING === '1'
const runMutatingRealListing = process.env.REAL_LISTING_MUTATE === '1'
const describeReal = runRealListing ? describe : describe.skip
const evidenceDir = resolve(
  process.cwd(),
  '../..',
  '.trellis/tasks/05-23-listing-shein-workflow/evidence',
)

const REAL_TEMPLATE = {
  template: SLICE_8_LISTING_TEMPLATES[2],
  skuFolder: '/Users/macmini/Desktop/服装素材摆放举例/GzG0001',
} as const

describeReal('Shein workflow on real Dianxiaomi page', () => {
  it('runs the workflow against the real Shein template with real DOM assertions', async () => {
    const profile = await findBitBrowserProfile2_1111()
    const endpoint = await bitBrowserClient.openProfile(profile.id)
    const browser = await chromium.connectOverCDP(endpoint.http)
    const context = browser.contexts()[0] ?? (await browser.newContext())
    const page = await context.newPage()
    const { template, skuFolder } = REAL_TEMPLATE
    const report: Record<string, unknown> = {
      templateKey: template.key,
      mutateEnabled: runMutatingRealListing,
    }

    try {
      await mkdir(evidenceDir, { recursive: true })
      await page.goto(template.editUrl, { waitUntil: 'domcontentloaded', timeout: 60_000 })
      await waitForSheinEditorReady(page)

      const before = await parseDraftPage(page)
      expect(before.workflow_step).toBe('editing')
      expect(before.shop_context).toBe('dianxiaomi-shein')
      expect(before.shop_field.current_value).toBeTruthy()
      expect(before.title_field.current_value).toBeTruthy()
      expect(before.sku_field.current_value).toBeTruthy()

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
        path: resolve(evidenceDir, 'real-workflow-shein.png'),
        fullPage: true,
      })
      Object.assign(report, {
        imageFiles,
        videoFiles,
        before,
        stages: result.stages,
        after,
      })
      await writeFile(
        resolve(evidenceDir, 'real-workflow-state-report.json'),
        JSON.stringify(report, null, 2),
      )

      expect(result.status).toBe('success')
      expect(result.stages).toHaveLength(10)
      expect(result.stages.every((stage) => stage.ok)).toBe(true)
      expect(
        result.stages.every(
          (stage) =>
            typeof stage.details?.observed_state === 'string' &&
            typeof stage.details?.target_state === 'string' &&
            typeof stage.details?.transition === 'string' &&
            typeof stage.details?.success_evidence === 'string',
        ),
      ).toBe(true)

      if (runMutatingRealListing) {
        expect(imageFiles.length).toBeGreaterThan(0)
        expect(videoFiles.length).toBeGreaterThan(0)
      } else {
        expect(after.title_field.current_value).toBe(before.title_field.current_value)
        expect(after.sku_field.current_value).toBe(before.sku_field.current_value)
      }
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
  const deadline = Date.now() + 60_000
  let latest = await parseDraftPage(page)
  while (Date.now() < deadline) {
    latest = await parseDraftPage(page)
    if (
      latest.workflow_step === 'editing' &&
      latest.shop_field.found &&
      latest.title_field.found &&
      latest.sku_field.found &&
      latest.variant_images.found &&
      latest.detail_images.found
    ) {
      return
    }
    await page.waitForTimeout(250)
  }

  throw new Error(
    `Shein editor not ready: ${JSON.stringify({
      workflow_step: latest.workflow_step,
      shop_found: latest.shop_field.found,
      title_found: latest.title_field.found,
      sku_found: latest.sku_field.found,
      variant_images_found: latest.variant_images.found,
      detail_images_found: latest.detail_images.found,
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
    sku: args.before.sku_field.current_value ?? 'REAL-SHEIN',
    title: args.before.title_field.current_value ?? 'Real Shein',
    platform: 'shein',
    templateKey: args.template.key,
    editUrl: args.template.editUrl,
    materialRootDir: args.template.materialRootDir,
    targetShopName: args.before.shop_field.current_value ?? '',
    imageGroups: {
      sku: args.imageFiles,
      carousel: [],
      material: [],
      preview: [],
      description: [],
    },
    variantGroups: [],
    videoPaths: args.videoFiles,
  }
}

function createRealConfig(template: (typeof SLICE_8_LISTING_TEMPLATES)[number]): ListingConfig {
  return {
    batchId: 'real-shein-workflow',
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
