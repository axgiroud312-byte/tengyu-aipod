import { beforeEach, describe, expect, it, vi } from 'vitest'

const listSkills = vi.fn()
const verifyAndSyncCustomerAccount = vi.fn()

vi.mock('@/lib/skills', () => ({ listSkills }))
vi.mock('@/lib/customer-accounts', () => ({ verifyAndSyncCustomerAccount }))

const { GET } = await import('./route')

describe('public skill list API', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('rejects anonymous requests before querying skills', async () => {
    const response = await GET(new Request('http://server.test/api/skills'))

    expect(response.status).toBe(401)
    await expect(response.json()).resolves.toMatchObject({
      error: { code: 'CUSTOMER_AUTH_REQUIRED' },
      ok: false,
    })
    expect(listSkills).not.toHaveBeenCalled()
  })

  it('uses the verified php uid for targeted skill filtering', async () => {
    verifyAndSyncCustomerAccount.mockResolvedValueOnce({
      customer: { php_uid: 123 },
      ok: true,
      status: 'active',
    })
    listSkills.mockResolvedValueOnce([])
    const credentials = Buffer.from('123:customer-secret', 'utf8').toString('base64')
    const response = await GET(
      new Request('http://server.test/api/skills?module=title&uid=999', {
        headers: {
          authorization: `Basic ${credentials}`,
          'x-tengyu-finger': 'device-fingerprint',
        },
      }),
    )

    expect(response.status).toBe(200)
    expect(verifyAndSyncCustomerAccount).toHaveBeenCalledWith({
      finger: 'device-fingerprint',
      secret: 'customer-secret',
      uid: 123,
    })
    expect(listSkills).toHaveBeenCalledWith({ module: 'title', uid: 123 })
  })
})
