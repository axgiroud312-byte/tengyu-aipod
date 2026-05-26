import type { Page } from 'playwright'

export async function waitUntilVisible(
  page: Page,
  isVisible: () => Promise<boolean>,
  timeoutMs: number,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (await isVisible()) {
      return true
    }
    await page.waitForTimeout(Math.min(250, Math.max(0, deadline - Date.now())))
  }
  return isVisible()
}

export async function waitForEditorReady<TState extends { workflow_step: string }>(
  page: Page,
  parseState: () => Promise<TState>,
  timeoutMs: number,
): Promise<TState> {
  const deadline = Date.now() + timeoutMs
  let state = await parseState()

  while (state.workflow_step !== 'editing' && Date.now() < deadline) {
    await page.waitForTimeout(Math.min(250, Math.max(0, deadline - Date.now())))
    state = await parseState()
  }

  return state
}

export async function waitForState<TState>(
  page: Page,
  readState: () => Promise<TState>,
  predicate: (state: TState) => boolean,
  timeoutMs: number,
): Promise<TState> {
  const deadline = Date.now() + timeoutMs
  let latest = await readState()

  while (Date.now() < deadline) {
    latest = await readState()
    if (predicate(latest)) {
      return latest
    }
    await page.waitForTimeout(Math.min(250, Math.max(0, deadline - Date.now())))
  }

  return latest
}
