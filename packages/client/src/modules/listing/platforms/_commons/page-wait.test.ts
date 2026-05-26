import { describe, expect, it, vi } from 'vitest'
import { waitForEditorReady, waitForState, waitUntilVisible } from './page-wait'

describe('listing page wait commons', () => {
  it('waits until a visibility predicate becomes true', async () => {
    const page = { waitForTimeout: vi.fn(async () => undefined) }
    const isVisible = vi
      .fn<() => Promise<boolean>>()
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true)

    await expect(waitUntilVisible(page as never, isVisible, 1_000)).resolves.toBe(true)
  })

  it('waits for editing workflow step', async () => {
    const page = { waitForTimeout: vi.fn(async () => undefined) }
    const parseState = vi
      .fn<() => Promise<{ workflow_step: string }>>()
      .mockResolvedValueOnce({ workflow_step: 'loading' })
      .mockResolvedValueOnce({ workflow_step: 'editing' })

    await expect(waitForEditorReady(page as never, parseState, 1_000)).resolves.toEqual({
      workflow_step: 'editing',
    })
  })

  it('waits for arbitrary page state predicates', async () => {
    const page = { waitForTimeout: vi.fn(async () => undefined) }
    const readState = vi
      .fn<() => Promise<{ ok: boolean }>>()
      .mockResolvedValueOnce({ ok: false })
      .mockResolvedValueOnce({ ok: true })

    await expect(
      waitForState(page as never, readState, (state) => state.ok, 1_000),
    ).resolves.toEqual({
      ok: true,
    })
  })
})
