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

  it('defaults global concurrency to twenty', () => {
    expect(normalizeGenerationLocalConfig({}).default_concurrency).toBe(20)
  })

  it('uses legacy Grsai concurrency as the global concurrency fallback', () => {
    expect(normalizeGenerationLocalConfig({ grsai_concurrency: 6 })).toMatchObject({
      default_concurrency: 6,
      grsai_concurrency: 6,
    })
  })

  it('caps global concurrency at twenty', () => {
    expect(normalizeGenerationLocalConfig({ default_concurrency: 99 })).toMatchObject({
      default_concurrency: 20,
      grsai_concurrency: 20,
    })
  })
})
