import { signAdminJwt } from '@/lib/jwt'
import { NextRequest } from 'next/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  findUnique: vi.fn(),
}))

vi.mock('@/lib/db', () => ({
  db: { admin: { findUnique: mocks.findUnique } },
}))

const { middleware } = await import('./middleware')

async function adminRequest(path = '/admin') {
  const token = await signAdminJwt({ sub: 'admin-1', role: 'admin' })
  return new NextRequest(`http://server.test${path}`, {
    headers: { cookie: `admin_token=${token}` },
  })
}

describe('admin middleware', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubEnv('JWT_SECRET_ADMIN', 'test-admin-secret')
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllEnvs()
  })

  it('allows an active admin whose current role matches the token', async () => {
    mocks.findUnique.mockResolvedValue({ is_active: true, role: 'admin' })

    const response = await middleware(await adminRequest())

    expect(response.status).toBe(200)
    expect(mocks.findUnique).toHaveBeenCalledWith({
      select: { is_active: true, role: true },
      where: { id: 'admin-1' },
    })
  })

  it.each([
    { account: null, label: 'deleted' },
    { account: { is_active: false, role: 'admin' }, label: 'disabled' },
    { account: { is_active: true, role: 'super' }, label: 'role-changed' },
  ])('rejects a $label admin session before JWT expiry', async ({ account }) => {
    mocks.findUnique.mockResolvedValue(account)

    const response = await middleware(await adminRequest('/admin/skills'))

    expect(response.status).toBe(307)
    expect(response.headers.get('location')).toBe('http://server.test/admin/login')
  })

  it('fails closed when the current admin state cannot be checked', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    mocks.findUnique.mockRejectedValue(new Error('database unavailable'))

    const response = await middleware(await adminRequest('/admin/skills'))

    expect(response.status).toBe(503)
    expect(await response.json()).toEqual({
      error: {
        code: 'HTTP_5XX',
        message: '管理员会话校验暂不可用，请稍后重试',
        retryable: true,
      },
      ok: false,
    })
  })
})
