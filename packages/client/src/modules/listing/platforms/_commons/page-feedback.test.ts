import { describe, expect, it, vi } from 'vitest'
import { readToast } from './page-feedback'

describe('listing page feedback commons', () => {
  it('reads a toast message when a feedback selector matches', async () => {
    const locator = {
      first: vi.fn(() => locator),
      count: vi.fn(async () => 1),
      evaluate: vi.fn(async () => '发布成功'),
    }
    const page = {
      locator: vi.fn(() => locator),
    }

    await expect(readToast(page as never, ['css=.ant-message-success'])).resolves.toEqual({
      found: true,
      message: '发布成功',
      selector: 'css=.ant-message-success',
    })
  })

  it('returns an empty state when no feedback selector matches', async () => {
    const locator = {
      first: vi.fn(() => locator),
      count: vi.fn(async () => 0),
    }
    const page = {
      locator: vi.fn(() => locator),
    }

    await expect(readToast(page as never, ['css=.ant-message-success'])).resolves.toEqual({
      found: false,
      message: null,
      selector: null,
    })
  })
})
