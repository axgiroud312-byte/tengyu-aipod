import { describe, expect, it, vi } from 'vitest'
import { signClientJwt, verifyClientJwt } from './jwt'

describe('client jwt', () => {
  it('signs and verifies activation payloads', async () => {
    vi.stubEnv('JWT_SECRET_CLIENT', 'test-client-secret')
    vi.setSystemTime(new Date('2026-05-23T00:00:00.000Z'))

    const token = await signClientJwt({
      sub: 'device-1',
      code: 'POD-ABCD-EFGH-IJKL',
      device_fp: 'a'.repeat(64),
      exp: Math.floor(Date.now() / 1000) + 60,
    })

    await expect(verifyClientJwt(token)).resolves.toMatchObject({
      sub: 'device-1',
      code: 'POD-ABCD-EFGH-IJKL',
      device_fp: 'a'.repeat(64),
      iss: 'tengyu-pod-server',
    })
  })

  it('rejects expired activation tokens', async () => {
    vi.stubEnv('JWT_SECRET_CLIENT', 'test-client-secret')
    vi.setSystemTime(new Date('2026-05-23T00:00:00.000Z'))

    const token = await signClientJwt({
      sub: 'device-1',
      code: 'POD-ABCD-EFGH-IJKL',
      device_fp: 'a'.repeat(64),
      exp: Math.floor(Date.now() / 1000) - 1,
    })

    await expect(verifyClientJwt(token)).resolves.toBeNull()
  })
})
