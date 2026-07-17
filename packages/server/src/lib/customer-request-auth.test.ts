import { beforeEach, describe, expect, it, vi } from 'vitest'

const verifyAndSyncCustomerAccount = vi.fn()

vi.mock('@/lib/customer-accounts', () => ({ verifyAndSyncCustomerAccount }))

const { authorizeCustomerRequest } = await import('./customer-request-auth')

function authorizedRequest() {
  const credentials = Buffer.from('123:customer-secret', 'utf8').toString('base64')
  return new Request('http://server.test/api/skills', {
    headers: {
      authorization: `Basic ${credentials}`,
      'x-tengyu-finger': 'device-fingerprint',
    },
  })
}

describe('authorizeCustomerRequest', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it.each(['pending', 'disabled', 'expired'] as const)(
    'rejects a %s customer account',
    async (status) => {
      verifyAndSyncCustomerAccount.mockResolvedValueOnce({
        customer: { php_uid: 123 },
        ok: true,
        status,
      })

      await expect(authorizeCustomerRequest(authorizedRequest())).resolves.toMatchObject({
        code: 'CUSTOMER_NOT_ACTIVE',
        ok: false,
        status: 403,
      })
    },
  )

  it('rejects an expired PHP login', async () => {
    verifyAndSyncCustomerAccount.mockResolvedValueOnce({
      message: '登录状态失效',
      ok: false,
      reason: 'nologin',
    })

    await expect(authorizeCustomerRequest(authorizedRequest())).resolves.toMatchObject({
      code: 'CUSTOMER_LOGIN_EXPIRED',
      ok: false,
      status: 401,
    })
  })

  it('logs upstream failures without exposing credentials in the response', async () => {
    const error = new Error('database unavailable')
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    verifyAndSyncCustomerAccount.mockRejectedValueOnce(error)

    await expect(authorizeCustomerRequest(authorizedRequest())).resolves.toEqual({
      code: 'CUSTOMER_AUTH_UNAVAILABLE',
      message: '客户授权服务暂不可用，请稍后重试',
      ok: false,
      status: 502,
    })
    expect(consoleError).toHaveBeenCalledWith('Customer request authorization failed', error)
    expect(JSON.stringify(consoleError.mock.calls)).not.toContain('customer-secret')
    consoleError.mockRestore()
  })
})
