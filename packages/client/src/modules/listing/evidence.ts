import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { ListingStage, StageResult } from '@tengyu-aipod/shared'
import type { Page } from 'playwright'

const DOM_SNAPSHOT_MAX_CHARS = 200_000

export type StageEvidencePaths = {
  screenshotPath: string
  domSnapshotPath: string
  stateSnapshotPath: string
}

export async function saveStageEvidence(
  page: Page,
  evidenceDir: string,
  stage: ListingStage,
  result: StageResult,
  options: { stageIndex?: number } = {},
): Promise<StageEvidencePaths> {
  const dir = join(evidenceDir, stageDirName(options.stageIndex, stage))
  await mkdir(dir, { recursive: true })

  const screenshotPath = join(dir, 'screenshot.png')
  const domSnapshotPath = join(dir, 'dom.html')
  const stateSnapshotPath = join(dir, 'state.json')

  await page.screenshot({ path: screenshotPath, fullPage: true }).catch(() => undefined)
  await writeFile(domSnapshotPath, await readCompactDomSnapshot(page))
  await writeFile(
    stateSnapshotPath,
    `${JSON.stringify(
      createStatePayload(page, result, {
        screenshotPath,
        domSnapshotPath,
        stateSnapshotPath,
        stageIndex: options.stageIndex,
      }),
      null,
      2,
    )}\n`,
  )

  return { screenshotPath, domSnapshotPath, stateSnapshotPath }
}

function stageDirName(stageIndex: number | undefined, stage: ListingStage) {
  const index = typeof stageIndex === 'number' ? Math.max(1, stageIndex) : 1
  return `stage-${String(index).padStart(2, '0')}-${sanitizePathSegment(stage)}`
}

async function readCompactDomSnapshot(page: Page): Promise<string> {
  const html = await page
    .evaluate(() => {
      const clone = document.documentElement.cloneNode(true) as HTMLElement
      for (const node of clone.querySelectorAll('script, style, link, svg, canvas')) {
        node.remove()
      }
      for (const node of clone.querySelectorAll('img')) {
        node.removeAttribute('src')
        node.removeAttribute('srcset')
      }
      return `<!doctype html>\n${clone.outerHTML}`
    })
    .catch(() => page.content().catch(() => ''))

  if (html.length <= DOM_SNAPSHOT_MAX_CHARS) {
    return html
  }

  return `${html.slice(0, DOM_SNAPSHOT_MAX_CHARS)}\n<!-- DOM snapshot truncated at ${DOM_SNAPSHOT_MAX_CHARS} chars -->`
}

function createStatePayload(
  page: Page,
  result: StageResult,
  paths: StageEvidencePaths & { stageIndex: number | undefined },
) {
  return {
    stage: result.stage,
    stageIndex: paths.stageIndex ?? null,
    ok: result.ok,
    status: result.ok ? 'ok' : 'failed',
    startedAt: result.startedAt,
    endedAt: result.endedAt,
    pageUrl: safePageUrl(page),
    screenshotPath: paths.screenshotPath,
    domSnapshotPath: paths.domSnapshotPath,
    stateSnapshotPath: paths.stateSnapshotPath,
    details: result.details ?? null,
    error: result.error ?? null,
  }
}

function safePageUrl(page: Page) {
  try {
    return page.url()
  } catch {
    return ''
  }
}

export function sanitizePathSegment(segment: string) {
  const sanitized = segment
    .trim()
    .replace(/[^a-zA-Z0-9._=-]+/g, '_')
    .replace(/^_+|_+$/g, '')
  return sanitized || 'unknown'
}
