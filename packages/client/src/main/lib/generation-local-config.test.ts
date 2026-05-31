import { describe, expect, it, vi } from 'vitest'
import { normalizeGenerationLocalConfig } from './generation-local-config'

vi.mock('electron', () => ({
  ipcMain: {
    handle: vi.fn(),
  },
}))

vi.mock('./keychain', () => ({
  getSecret: vi.fn(),
  setSecret: vi.fn(),
}))

describe('normalizeGenerationLocalConfig', () => {
  it('caps Grsai retry count at ten', () => {
    expect(normalizeGenerationLocalConfig({ grsai_retries: 99 }).grsai_retries).toBe(10)
  })
})
