import type { FileChooser, Locator, Page } from 'playwright'

export type FileUploadResult = 'filechooser' | 'global-input'

export type FileUploadOptions = {
  menuTexts: readonly string[]
  globalInputSelector: string
  actionTimeoutMs: number
  settleMs?: number
  requireMenuMatch?: boolean
}

export async function handleFileChooserWithRetry(
  page: Page,
  trigger: Locator,
  files: string[],
  options: FileUploadOptions,
): Promise<FileUploadResult> {
  const settleMs = options.settleMs ?? 2_000
  await trigger.scrollIntoViewIfNeeded().catch(() => undefined)
  const chooserPromise = page.waitForEvent('filechooser', { timeout: 5_000 }).catch(() => null)
  await trigger.click({ timeout: options.actionTimeoutMs })
  const directChooser = await waitForFileChooserCandidate(chooserPromise, 300)
  if (directChooser) {
    await directChooser.setFiles(files)
    await page.waitForTimeout(settleMs)
    return 'filechooser'
  }

  let menuMatched = false
  for (const menuText of options.menuTexts) {
    const menuItem = page
      .locator('.ant-dropdown:not(.ant-dropdown-hidden), .ant-popover, .ant-select-dropdown')
      .getByText(menuText, { exact: false })
      .last()
    const visible = await menuItem.isVisible({ timeout: 1_000 }).catch(() => false)
    if (!visible) {
      continue
    }
    menuMatched = true
    await menuItem.click({ timeout: options.actionTimeoutMs })
    const menuChooser = await chooserPromise
    if (menuChooser) {
      await menuChooser.setFiles(files)
      await page.waitForTimeout(settleMs)
      return 'filechooser'
    }
    break
  }

  if (options.requireMenuMatch && !menuMatched) {
    throw new Error('MENU_NOT_FOUND')
  }

  const globalInput = page.locator(options.globalInputSelector).first()
  if ((await globalInput.count().catch(() => 0)) === 0) {
    throw new Error('FILE_CHOOSER_TIMEOUT')
  }
  await globalInput.setInputFiles(files)
  await page.waitForTimeout(settleMs)
  return 'global-input'
}

async function waitForFileChooserCandidate(
  chooserPromise: Promise<FileChooser | null>,
  timeoutMs: number,
): Promise<FileChooser | null> {
  return Promise.race([
    chooserPromise,
    new Promise<null>((resolve) => {
      setTimeout(() => resolve(null), timeoutMs)
    }),
  ])
}
