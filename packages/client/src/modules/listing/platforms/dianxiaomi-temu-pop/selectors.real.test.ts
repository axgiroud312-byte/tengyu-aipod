import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { type Page, chromium } from 'playwright'
import { describe, expect, it } from 'vitest'
import { type BitBrowserProfile, bitBrowserClient } from '../../../../main/lib/bit-browser-client'
import {
  type ListingSelector,
  TEMU_POP_REQUIRED_REAL_SELECTOR_KEYS,
  TEMU_POP_SELECTORS,
  TEMU_POP_TEMPLATE_URLS,
  selectorToLocator,
} from './selectors'

const runRealListing = process.env.REAL_LISTING === '1'
const describeReal = runRealListing ? describe : describe.skip
const evidenceDir = resolve(
  process.cwd(),
  '../..',
  '.trellis/tasks/05-23-listing-temu-selectors/evidence',
)

describeReal('Temu PopTemu selectors on real Dianxiaomi pages', () => {
  it('matches required selectors on the two real v1 Temu templates', async () => {
    const profile = await findBitBrowserProfile2_1111()
    const endpoint = await bitBrowserClient.openProfile(profile.id)
    const browser = await chromium.connectOverCDP(endpoint.http)
    const context = browser.contexts()[0] ?? (await browser.newContext())
    const pages: Page[] = []
    const report: Array<{
      template: string
      url: string
      hits: Record<string, { selector: ListingSelector; count: number } | null>
    }> = []

    try {
      for (const [template, url] of Object.entries(TEMU_POP_TEMPLATE_URLS)) {
        const page = await context.newPage()
        pages.push(page)
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60_000 })
        await page.waitForTimeout(3_000)

        await mkdir(evidenceDir, { recursive: true })
        await page.screenshot({
          path: resolve(evidenceDir, `real-test-${template}.png`),
          fullPage: true,
        })
        const hits: Record<string, { selector: ListingSelector; count: number } | null> = {}
        for (const key of TEMU_POP_REQUIRED_REAL_SELECTOR_KEYS) {
          hits[key] = await firstSelectorHit(page, TEMU_POP_SELECTORS[key])
        }
        await writeFile(
          resolve(evidenceDir, `real-test-${template}.dom-snapshot.html`),
          await selectorDomSnapshot(page, hits),
        )
        report.push({ template, url: page.url(), hits })
      }

      await writeFile(
        resolve(evidenceDir, 'real-selector-hit-report.json'),
        JSON.stringify(report, null, 2),
      )

      for (const templateReport of report) {
        for (const key of TEMU_POP_REQUIRED_REAL_SELECTOR_KEYS) {
          expect(templateReport.hits[key], `${templateReport.template}:${key}`).not.toBeNull()
        }
      }
    } finally {
      await Promise.all(pages.map((page) => page.close().catch(() => undefined)))
    }
  }, 120_000)
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

async function selectorDomSnapshot(
  page: Page,
  hits: Record<string, { selector: ListingSelector; count: number } | null>,
) {
  const sections: string[] = [
    '<!doctype html>',
    '<html><head><meta charset="utf-8"><title>Temu selector DOM snapshot</title></head><body>',
  ]

  for (const [key, hit] of Object.entries(hits)) {
    sections.push(`<section data-selector-key="${escapeHtml(key)}">`)
    if (!hit) {
      sections.push('<!-- no hit -->')
    } else {
      const html = await locatorForSelector(page, hit.selector)
        .first()
        .evaluate((node) => node.outerHTML)
        .catch(() => '<!-- failed to serialize hit -->')
      sections.push(`<!-- selector: ${escapeHtml(hit.selector)} count: ${hit.count} -->`)
      sections.push(truncateHtml(html))
    }
    sections.push('</section>')
  }

  sections.push('</body></html>')
  return sections.join('\n')
}

function truncateHtml(html: string) {
  return html.length <= 4_000 ? html : `${html.slice(0, 4_000)}\n<!-- truncated -->`
}

function escapeHtml(value: string) {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')
}

function locatorForSelector(page: Page, selector: ListingSelector) {
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
