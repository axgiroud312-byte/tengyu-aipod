import { mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { sanitizePathSegment, saveStageEvidence } from './evidence'

let tempDir: string | null = null

afterEach(async () => {
  if (tempDir) {
    await rm(tempDir, { recursive: true, force: true })
    tempDir = null
  }
})

describe('listing evidence', () => {
  it('saves screenshot, DOM snapshot, and state JSON under numbered stage directories', async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'listing-evidence-'))
    const page = createPage()

    const paths = await saveStageEvidence(
      page as never,
      tempDir,
      'page_ready',
      {
        stage: 'page_ready',
        ok: true,
        startedAt: 1000,
        endedAt: 1001,
        details: {
          observed_state: 'loading',
          target_state: 'editing',
          transition: 'parse_draft_page',
          success_evidence: 'dianxiaomi-temu-pop',
        },
      },
      { stageIndex: 2 },
    )

    expect(paths.screenshotPath).toBe(join(tempDir, 'stage-02-page_ready', 'screenshot.png'))
    expect(paths.domSnapshotPath).toBe(join(tempDir, 'stage-02-page_ready', 'dom.html'))
    expect(paths.stateSnapshotPath).toBe(join(tempDir, 'stage-02-page_ready', 'state.json'))
    await expect(stat(paths.screenshotPath)).resolves.toMatchObject({ size: 3 })
    await expect(readFile(paths.domSnapshotPath, 'utf8')).resolves.toContain('<body>listing</body>')
    await expect(readFile(paths.stateSnapshotPath, 'utf8').then(JSON.parse)).resolves.toMatchObject(
      {
        stage: 'page_ready',
        stageIndex: 2,
        ok: true,
        status: 'ok',
        pageUrl: 'https://example.test/edit',
        screenshotPath: paths.screenshotPath,
        domSnapshotPath: paths.domSnapshotPath,
        stateSnapshotPath: paths.stateSnapshotPath,
        details: {
          observed_state: 'loading',
          target_state: 'editing',
        },
      },
    )
  })

  it('sanitizes stage path segments defensively', () => {
    expect(sanitizePathSegment('../page ready?')).toBe('.._page_ready')
    expect(sanitizePathSegment('')).toBe('unknown')
  })
})

function createPage() {
  return {
    url: vi.fn(() => 'https://example.test/edit'),
    screenshot: vi.fn(async ({ path }: { path: string }) => {
      await import('node:fs/promises').then((fs) => fs.writeFile(path, 'png'))
    }),
    evaluate: vi.fn(async () => '<!doctype html><html><body>listing</body></html>'),
    content: vi.fn(async () => '<html><body>fallback</body></html>'),
  }
}
