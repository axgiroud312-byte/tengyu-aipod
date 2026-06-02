import { describe, expect, it } from 'vitest'
import { POST } from './route'

describe('admin accounts API', () => {
  it('rejects create requests with weak passwords', async () => {
    const response = await POST(
      new Request('http://server.test/admin/api/admins', {
        body: JSON.stringify({
          email: 'new-admin@example.com',
          name: '新管理员',
          password: 'short',
          role: 'admin',
        }),
        method: 'POST',
      }),
    )

    await expect(response.json()).resolves.toMatchObject({
      error: { code: 'INVALID_ADMIN_CREATE_INPUT' },
      ok: false,
    })
    expect(response.status).toBe(400)
  })
})
