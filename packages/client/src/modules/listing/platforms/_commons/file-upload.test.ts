import { describe, expect, it, vi } from 'vitest'
import { handleFileChooserWithRetry } from './file-upload'

describe('listing file upload commons', () => {
  it('prefers direct file chooser when available', async () => {
    const setFiles = vi.fn(async () => undefined)
    const trigger = {
      scrollIntoViewIfNeeded: vi.fn(async () => undefined),
      click: vi.fn(async () => undefined),
    }
    const page = createPage({
      chooser: { setFiles },
    })

    await expect(
      handleFileChooserWithRetry(page as never, trigger as never, ['a.png'], {
        menuTexts: ['本地图片'],
        globalInputSelector: '#localFileUploadInp',
        actionTimeoutMs: 1_000,
      }),
    ).resolves.toBe('filechooser')

    expect(setFiles).toHaveBeenCalledWith(['a.png'])
  })

  it('falls back to global input when chooser is unavailable', async () => {
    const setInputFiles = vi.fn(async () => undefined)
    const trigger = {
      scrollIntoViewIfNeeded: vi.fn(async () => undefined),
      click: vi.fn(async () => undefined),
    }
    const globalInput = {
      first: vi.fn(() => globalInput),
      count: vi.fn(async () => 1),
      setInputFiles,
    }
    const page = createPage({
      globalInput,
    })

    await expect(
      handleFileChooserWithRetry(page as never, trigger as never, ['a.png'], {
        menuTexts: ['本地图片'],
        globalInputSelector: '#localFileUploadInp',
        actionTimeoutMs: 1_000,
      }),
    ).resolves.toBe('global-input')

    expect(setInputFiles).toHaveBeenCalledWith(['a.png'])
  })
})

function createPage(
  args: {
    chooser?: { setFiles: (files: string[]) => Promise<void> }
    globalInput?: {
      first: () => unknown
      count: () => Promise<number>
      setInputFiles: (files: string[]) => Promise<void>
    }
  } = {},
) {
  return {
    waitForEvent: vi.fn(async () => args.chooser ?? null),
    waitForTimeout: vi.fn(async () => undefined),
    locator: vi.fn((selector: string) => {
      if (selector === '#localFileUploadInp') {
        return args.globalInput ?? defaultLocator()
      }
      const menuLocator = {
        getByText: vi.fn(() => ({
          last: vi.fn(() => ({
            isVisible: vi.fn(async () => false),
          })),
        })),
        first: vi.fn(() => menuLocator),
      }
      return menuLocator
    }),
  }
}

function defaultLocator() {
  const locator = {
    first: vi.fn(() => locator),
    count: vi.fn(async () => 0),
    setInputFiles: vi.fn(async () => undefined),
  }
  return locator
}
