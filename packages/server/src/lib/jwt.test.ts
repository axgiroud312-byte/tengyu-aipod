import { describe, expect, it, vi } from 'vitest'
import { signAdminJwt, verifyAdminJwt } from './jwt'

describe('admin jwt', () => {
  it('signs and verifies admin payloads', async () => {
    vi.stubEnv('JWT_SECRET_ADMIN', 'test-admin-secret')
    vi.setSystemTime(new Date('2026-05-23T00:00:00.000Z'))

    const token = await signAdminJwt({ sub: 'admin-1', role: 'owner' })

    await expect(verifyAdminJwt(token)).resolves.toMatchObject({
      sub: 'admin-1',
      role: 'owner',
      iss: 'tengyu-pod-admin',
    })
  })

  it('rejects expired admin tokens', async () => {
    vi.stubEnv('JWT_SECRET_ADMIN', 'test-admin-secret')
    vi.setSystemTime(new Date('2026-05-23T00:00:00.000Z'))

    const token = await signAdminJwt({ sub: 'admin-1', role: 'owner' })

    vi.setSystemTime(new Date('2026-06-01T00:00:00.000Z'))
    await expect(verifyAdminJwt(token)).resolves.toBeNull()
  })
})
