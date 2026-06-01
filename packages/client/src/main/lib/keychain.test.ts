import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

let userDataDir = ''
let encryptionAvailable = true

vi.mock('electron', () => ({
  app: {
    getPath: (name: string) => {
      if (name !== 'userData') {
        throw new Error(`unexpected path: ${name}`)
      }
      return userDataDir
    },
  },
  safeStorage: {
    isEncryptionAvailable: () => encryptionAvailable,
    encryptString: (value: string) => Buffer.from(`encrypted:${value}`, 'utf8'),
    decryptString: (value: Buffer) => value.toString('utf8').replace(/^encrypted:/, ''),
  },
}))

const keychain = await import('./keychain')

beforeEach(async () => {
  userDataDir = await mkdtemp(join(tmpdir(), 'tengyu-keychain-'))
  encryptionAvailable = true
})

afterEach(async () => {
  await rm(userDataDir, { recursive: true, force: true })
})

describe('keychain', () => {
  it('sets and gets encrypted secrets', async () => {
    await keychain.setSecret('bailian_api_key', 'token-value')

    await expect(keychain.getSecret('bailian_api_key')).resolves.toBe('token-value')
    await expect(keychain.hasSecret('bailian_api_key')).resolves.toBe(true)
  })

  it('deletes secrets', async () => {
    await keychain.setSecret('chenyu_api_key', 'secret')
    await keychain.deleteSecret('chenyu_api_key')

    await expect(keychain.getSecret('chenyu_api_key')).resolves.toBeNull()
    await expect(keychain.hasSecret('chenyu_api_key')).resolves.toBe(false)
  })

  it('falls back to plain storage only outside production', async () => {
    vi.stubEnv('NODE_ENV', 'development')
    encryptionAvailable = false

    await keychain.setSecret('grsai_api_key', 'plain-secret')

    await expect(keychain.getSecret('grsai_api_key')).resolves.toBe('plain-secret')
  })

  it('refuses plain fallback in production', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    encryptionAvailable = false

    await expect(keychain.setSecret('bailian_api_key', 'secret')).rejects.toThrow(
      'safeStorage encryption is not available',
    )
  })
})
