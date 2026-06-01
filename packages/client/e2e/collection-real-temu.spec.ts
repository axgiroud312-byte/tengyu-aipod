import { mkdir, stat, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { type Browser, type Page, expect, test } from '@playwright/test'
import { type BitBrowserProfile, bitBrowserClient } from '../src/main/lib/bit-browser-client'
import { CDPClient, type CollectionBindingPayload } from '../src/main/lib/cdp-client'
import { CollectionClickService } from '../src/main/lib/collection-click-service'
import { getPlatformRule } from '../src/main/lib/collection-platform-rules'
import { CollectionSessionManager } from '../src/main/lib/collection-session-manager'

const runRealCollection = process.env.REAL_COLLECTION === '1'
const profileName = process.env.REAL_COLLECTION_PROFILE ?? '1111'
const targetSuccesses = Number.parseInt(process.env.REAL_COLLECTION_TARGET ?? '10', 10)
const runId =
  process.env.REAL_COLLECTION_RUN_ID ??
  new Date()
    .toISOString()
    .replace(/[-:.TZ]/g, '')
    .slice(0, 14)
const workbenchRoot =
  process.env.REAL_COLLECTION_WORKBENCH_ROOT ??
  `/Users/macmini/Desktop/1111/real-collection-10x/${runId}`
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')
const evidenceDir = join(repoRoot, '.trellis/tasks/05-27-fix-collection-remaining-issue/evidence')

type CapturedResult = {
  payload: CollectionBindingPayload
  result: Awaited<ReturnType<CollectionClickService['dispatch']>>
}

type ReportRow = {
  index: number
  pageUrl: string
  imageUrl: string
  status: string
  savedPath: string | null
  fileSize: number | null
  reason: string | null
}

type ImageCandidate = {
  imageUrl: string
  x: number
  y: number
  width: number
  height: number
  pageUrl: string
}

test.describe('real Temu collection through BitBrowser', () => {
  test.skip(!runRealCollection, 'REAL_COLLECTION=1 is required for real Temu collection tests')
  test.setTimeout(240_000)

  test('collects 10 real Temu images from the 1111 BitBrowser profile', async () => {
    await mkdir(evidenceDir, { recursive: true })
    await mkdir(join(workbenchRoot, '.workbench'), { recursive: true })

    const profile = await findBitBrowserProfile(profileName)
    const cdp = new CDPClient()
    let browser = await cdp.connectToProfile(profile.id)
    const results: CapturedResult[] = []
    const events: unknown[] = []
    let service: CollectionClickService | null = null
    const manager = new CollectionSessionManager({
      readConfig: async () => ({ workbench_root: workbenchRoot }) as never,
      cdp,
      getPlatformRule,
      emitEvent: (event) => events.push(event),
      dispatchCollectionEvent: async (payload, context) => {
        if (!service) {
          throw new Error('collection service missing')
        }
        const result = await service.dispatch(payload, context)
        results.push({ payload, result })
        return result
      },
    })
    service = new CollectionClickService({ sessionManager: manager })

    const report: ReportRow[] = []
    const clickedImages = new Set<string>()
    let sessionStarted = false

    try {
      await manager.startSession({
        platform: 'temu',
        profile_id: profile.id,
        mode: 'click',
      })
      sessionStarted = true

      let livePage = await findOrOpenTemuPage(cdp, profile.id, browser)
      browser = livePage.browser
      let page = livePage.page
      await page.bringToFront().catch(() => null)
      await dismissOverlays(page)

      for (
        let attempt = 1;
        report.filter((row) => row.status === 'success').length < targetSuccesses;
        attempt += 1
      ) {
        if (attempt > targetSuccesses * 8) {
          throw new Error(`only collected ${report.length} records after ${attempt - 1} attempts`)
        }

        livePage = await ensureLiveTemuPage(cdp, profile.id, browser, page)
        browser = livePage.browser
        page = livePage.page
        const candidate = await nextImageCandidate(page, clickedImages)
        if (!candidate) {
          continue
        }

        clickedImages.add(canonicalImageUrl(candidate.imageUrl))
        const before = results.length
        await page.mouse.click(candidate.x, candidate.y).catch(() => null)
        const captured = await waitForNewRecord(results, before)
        await dismissOverlays(page)
        livePage = await findOrOpenTemuPage(cdp, profile.id, browser)
        browser = livePage.browser
        page = livePage.page

        if (!captured?.result || !('record' in captured.result)) {
          report.push({
            index: report.length + 1,
            pageUrl: candidate.pageUrl,
            imageUrl: candidate.imageUrl,
            status: captured?.result?.status ?? 'no-record',
            savedPath: null,
            fileSize: null,
            reason: 'no collection record',
          })
          continue
        }

        const savedPath = captured.result.record.savedPath ?? null
        const fileSize = savedPath ? await stat(savedPath).then((info) => info.size) : null
        report.push({
          index: report.length + 1,
          pageUrl: captured.payload.page,
          imageUrl: captured.payload.img ?? candidate.imageUrl,
          status: captured.result.status,
          savedPath,
          fileSize,
          reason: captured.result.record.reason ?? null,
        })

        if (captured.result.status === 'success') {
          expect(savedPath).toBeTruthy()
          expect(fileSize).toBeGreaterThan(0)
        }
      }

      const successRows = report.filter((row) => row.status === 'success')
      expect(successRows).toHaveLength(targetSuccesses)
      expect(events).toEqual(
        expect.arrayContaining(
          successRows.map(() => expect.objectContaining({ type: 'image-saved' })),
        ),
      )
    } finally {
      await writeFile(
        join(evidenceDir, 'real-temu-collection-10x-report.json'),
        `${JSON.stringify(
          {
            profile: {
              id: profile.id,
              name: profile.name,
              seq: profile.seq ?? null,
            },
            workbenchRoot,
            targetSuccesses,
            successes: report.filter((row) => row.status === 'success').length,
            rows: report,
          },
          null,
          2,
        )}\n`,
      )
      if (sessionStarted) {
        await manager.stopSession().catch(() => null)
      } else {
        await cdp.disconnect(profile.id).catch(() => null)
      }
    }
  })
})

async function findBitBrowserProfile(target: string): Promise<BitBrowserProfile> {
  const profiles = await bitBrowserClient.listProfiles()
  const profile = profiles.find((item) => {
    const candidates = [
      item.id,
      item.name,
      item.remark,
      item.seq === undefined ? undefined : String(item.seq),
      item.seq === undefined ? undefined : `${item.seq}-${item.name}`,
    ]
    return candidates.some((candidate) => candidate === target || candidate === `2-${target}`)
  })
  if (!profile) {
    throw new Error(`BitBrowser profile ${target} not found`)
  }
  return profile
}

async function findOrOpenTemuPage(
  cdp: CDPClient,
  profileId: string,
  browser: Browser,
): Promise<{ browser: Browser; page: Page }> {
  let currentBrowser = browser.isConnected() ? browser : await cdp.getOrReconnect(profileId)
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      return { browser: currentBrowser, page: await findOrOpenTemuPageInBrowser(currentBrowser) }
    } catch (error) {
      if (attempt > 0 || !isBrowserClosedError(error)) {
        throw error
      }
      currentBrowser = await cdp.reconnect(profileId)
    }
  }
  throw new Error('failed to open Temu page')
}

async function findOrOpenTemuPageInBrowser(browser: Browser): Promise<Page> {
  const existingPages = browser
    .contexts()
    .flatMap((context) => context.pages())
    .filter((page) => !page.isClosed() && isTemuUrl(page.url()))
  const existing =
    existingPages.find((page) => page.url().includes('search_result')) ??
    existingPages.find(
      (page) => page.url().includes('/goods/') || /-g-\d+\.html/.test(page.url()),
    ) ??
    existingPages[0]
  if (existing) {
    return existing
  }

  const context = browser.contexts()[0] ?? (await browser.newContext())
  const page = await context.newPage()
  await page.goto('https://www.temu.com/search_result.html?search_key=phone%20case', {
    waitUntil: 'domcontentloaded',
    timeout: 45_000,
  })
  return page
}

async function dismissOverlays(page: Page): Promise<void> {
  await page.keyboard.press('Escape').catch(() => null)
  await page.waitForTimeout(350).catch(() => null)
}

async function ensureConnectedBrowser(
  cdp: CDPClient,
  profileId: string,
  browser: Browser,
): Promise<Browser> {
  if (browser.isConnected()) {
    return browser
  }
  return cdp.connectToProfile(profileId)
}

async function ensureLiveTemuPage(
  cdp: CDPClient,
  profileId: string,
  browser: Browser,
  page: Page,
): Promise<{ browser: Browser; page: Page }> {
  if (!page.isClosed()) {
    return { browser, page }
  }
  return findOrOpenTemuPage(cdp, profileId, browser)
}

function isBrowserClosedError(error: unknown): boolean {
  return (
    error instanceof Error &&
    error.message.includes('Target page, context or browser has been closed')
  )
}

async function nextImageCandidate(
  page: Page,
  clickedImages: Set<string>,
): Promise<ImageCandidate | null> {
  for (let scrolls = 0; scrolls < 4; scrolls += 1) {
    if (page.isClosed()) {
      return null
    }
    const candidates = await page.evaluate((clicked) => {
      const clickedSet = new Set(clicked)
      const viewportWidth = window.innerWidth
      const viewportHeight = window.innerHeight
      return Array.from(document.images)
        .map((img) => {
          const source = img.currentSrc || img.src || ''
          let imageUrl = ''
          try {
            imageUrl = new URL(source, window.location.href).toString()
          } catch {
            imageUrl = source
          }
          const canonical = canonicalImageUrlInPage(imageUrl)
          const rect = img.getBoundingClientRect()
          const x = rect.left + rect.width / 2
          const y = rect.top + rect.height / 2
          const visible =
            rect.width >= 120 &&
            rect.height >= 120 &&
            x >= 0 &&
            x <= viewportWidth &&
            y >= 0 &&
            y <= viewportHeight
          return {
            imageUrl,
            canonical,
            x,
            y,
            width: rect.width,
            height: rect.height,
            pageUrl: window.location.href,
            visible,
          }
        })
        .filter((item) => {
          if (!item.visible || !item.imageUrl || clickedSet.has(item.canonical)) {
            return false
          }
          const normalized = item.imageUrl.toLowerCase()
          return (
            !normalized.startsWith('data:') &&
            !normalized.startsWith('blob:') &&
            !normalized.includes('/icon') &&
            !normalized.includes('logo')
          )
        })
        .sort((left, right) => right.width * right.height - left.width * left.height)

      function canonicalImageUrlInPage(value: string) {
        try {
          const parsed = new URL(value, window.location.href)
          return `${parsed.origin}${parsed.pathname}`
        } catch {
          return value
        }
      }
    }, Array.from(clickedImages))

    const candidate = candidates[0]
    if (candidate) {
      return candidate
    }
    await page.mouse.wheel(0, 900).catch(() => null)
    await page.waitForTimeout(1_000).catch(() => null)
  }
  return null
}

async function waitForNewRecord(results: CapturedResult[], before: number) {
  const deadline = Date.now() + 20_000
  while (Date.now() < deadline) {
    const next = results.slice(before).find((item) => item.result && 'record' in item.result)
    if (next) {
      return next
    }
    const any = results[before]
    if (any?.result?.status === 'pending_sku') {
      return any
    }
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  return null
}

function isTemuUrl(value: string) {
  try {
    const hostname = new URL(value).hostname.toLowerCase()
    return hostname === 'temu.com' || hostname.endsWith('.temu.com')
  } catch {
    return false
  }
}

function canonicalImageUrl(value: string) {
  try {
    const parsed = new URL(value)
    return `${parsed.origin}${parsed.pathname}`
  } catch {
    return value
  }
}
