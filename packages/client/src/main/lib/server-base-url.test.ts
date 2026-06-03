import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  app: {
    isPackaged: false,
  },
}))

import { resolveServerBaseUrl } from './server-base-url'

describe('resolveServerBaseUrl', () => {
  it('uses configured server URL without trailing slashes', () => {
    expect(resolveServerBaseUrl({ configuredUrl: 'https://api.example.com///' })).toBe(
      'https://api.example.com',
    )
  })

  it('uses the default remote server fallback for unpackaged development', () => {
    expect(resolveServerBaseUrl({ isPackaged: false })).toBe('https://wechat.tengyuai.com')
  })

  it('fails clearly when packaged app has no server URL', () => {
    expect(() => resolveServerBaseUrl({ isPackaged: true })).toThrow(
      'TENGYU_SERVER_URL is required for packaged app',
    )
  })
})
