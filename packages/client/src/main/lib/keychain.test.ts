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

  it('preserves concurrent secret writes to the same store file', async () => {
    await Promise.all([
      keychain.setSecret('customer-auth.php-uid', '123'),
      keychain.setSecret('customer-auth.php-secret', 'secret-value'),
    ])

    await expect(keychain.getSecret('customer-auth.php-uid')).resolves.toBe('123')
    await expect(keychain.getSecret('customer-auth.php-secret')).resolves.toBe('secret-value')
  })

  it('writes related secrets in one store update', async () => {
    await keychain.setSecrets({
      'customer-auth.php-secret': 'secret-value',
      'customer-auth.php-uid': '123',
    })

    await expect(keychain.getSecret('customer-auth.php-uid')).resolves.toBe('123')
    await expect(keychain.getSecret('customer-auth.php-secret')).resolves.toBe('secret-value')
  })

  it('deletes secrets', async () => {
    await keychain.setSecret('chenyu_api_key', 'secret')
    await keychain.deleteSecret('chenyu_api_key')

    await expect(keychain.getSecret('chenyu_api_key')).resolves.toBeNull()
    await expect(keychain.hasSecret('chenyu_api_key')).resolves.toBe(false)
  })

  it('preserves concurrent secret deletes to the same store file', async () => {
    await keychain.setSecret('customer-auth.php-uid', '123')
    await keychain.setSecret('customer-auth.php-secret', 'secret-value')

    await Promise.all([
      keychain.deleteSecret('customer-auth.php-uid'),
      keychain.deleteSecret('customer-auth.php-secret'),
    ])

    await expect(keychain.getSecret('customer-auth.php-uid')).resolves.toBeNull()
    await expect(keychain.getSecret('customer-auth.php-secret')).resolves.toBeNull()
  })

  it('deletes related secrets in one store update', async () => {
    await keychain.setSecrets({
      'customer-auth.php-secret': 'secret-value',
      'customer-auth.php-uid': '123',
    })

    await keychain.deleteSecrets(['customer-auth.php-uid', 'customer-auth.php-secret'])

    await expect(keychain.getSecret('customer-auth.php-uid')).resolves.toBeNull()
    await expect(keychain.getSecret('customer-auth.php-secret')).resolves.toBeNull()
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
