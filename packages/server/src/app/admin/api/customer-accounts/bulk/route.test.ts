import { signAdminJwt } from '@/lib/jwt'
import { describe, expect, it, vi } from 'vitest'
import { POST } from './route'

describe('customer account bulk API', () => {
  it('rejects approve requests without expires_at', async () => {
    vi.stubEnv('JWT_SECRET_ADMIN', 'test-admin-secret')
    const token = await signAdminJwt({ role: 'super', sub: 'admin-1' })

    const response = await POST(
      new Request('http://server.test/admin/api/customer-accounts/bulk', {
        body: JSON.stringify({ action: 'approve', ids: ['cus_1'] }),
        headers: { cookie: `admin_token=${token}` },
        method: 'POST',
      }),
    )

    await expect(response.json()).resolves.toMatchObject({
      error: { code: 'EXPIRES_AT_REQUIRED' },
      ok: false,
    })
    expect(response.status).toBe(400)
  })
})
