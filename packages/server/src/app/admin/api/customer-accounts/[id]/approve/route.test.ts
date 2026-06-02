import { signAdminJwt } from '@/lib/jwt'
import { describe, expect, it, vi } from 'vitest'
import { POST } from './route'

describe('customer account approve API', () => {
  it('rejects approve requests without expires_at', async () => {
    vi.stubEnv('JWT_SECRET_ADMIN', 'test-admin-secret')
    vi.setSystemTime(new Date('2026-06-02T00:00:00.000Z'))
    const token = await signAdminJwt({ role: 'super', sub: 'admin-1' })

    const response = await POST(
      new Request('http://server.test/admin/api/customer-accounts/cus_1/approve', {
        body: JSON.stringify({}),
        headers: { cookie: `admin_token=${token}` },
        method: 'POST',
      }),
      { params: Promise.resolve({ id: 'cus_1' }) },
    )

    await expect(response.json()).resolves.toMatchObject({
      error: { code: 'EXPIRES_AT_REQUIRED' },
      ok: false,
    })
    expect(response.status).toBe(400)
  })
})
