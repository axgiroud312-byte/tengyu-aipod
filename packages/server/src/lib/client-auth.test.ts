import { describe, expect, it, vi } from 'vitest'
import { ClientAuthError, requireClientAuth } from './client-auth'

describe('client auth', () => {
  it('does not bypass auth in development unless explicitly allowed', async () => {
    vi.stubEnv('NODE_ENV', 'development')
    vi.stubEnv('TENGYU_REQUIRE_CLIENT_AUTH', '')

    await expect(requireClientAuth(null)).rejects.toBeInstanceOf(ClientAuthError)
  })

  it('allows route-level development bypass when requested', async () => {
    vi.stubEnv('NODE_ENV', 'development')
    vi.stubEnv('TENGYU_REQUIRE_CLIENT_AUTH', '')

    await expect(requireClientAuth(null, { allowDevelopmentBypass: true })).resolves.toBeNull()
  })
})
