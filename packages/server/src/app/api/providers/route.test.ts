import { beforeEach, describe, expect, it, vi } from 'vitest'

const requireClientAuth = vi.fn()
const listProviders = vi.fn()

vi.mock('@/lib/client-auth', () => ({
  ClientAuthError: class ClientAuthError extends Error {
    code: string

    constructor(code: string) {
      super(code)
      this.name = 'ClientAuthError'
      this.code = code
    }
  },
  requireClientAuth,
}))

vi.mock('@/lib/providers', () => ({
  listProviders,
  providerTypes: ['paid-generation', 'vision-llm', 'comfyui-cloud'],
}))

const { GET } = await import('./route')

beforeEach(() => {
  requireClientAuth.mockReset().mockResolvedValue(null)
  listProviders.mockReset().mockResolvedValue([{ id: 'grsai' }])
})

describe('GET /api/providers', () => {
  it('requires client auth and passes type filter to provider registry', async () => {
    const response = await GET(
      new Request('https://tengyu.test/api/providers?type=paid-generation', {
        headers: { authorization: 'Bearer token' },
      }),
    )
    const body = (await response.json()) as unknown

    expect(response.status).toBe(200)
    expect(body).toEqual({ ok: true, data: [{ id: 'grsai' }] })
    expect(requireClientAuth).toHaveBeenCalledWith('Bearer token', {
      allowDevelopmentBypass: true,
    })
    expect(listProviders).toHaveBeenCalledWith({ type: 'paid-generation' })
  })

  it('rejects invalid provider type queries', async () => {
    const response = await GET(new Request('https://tengyu.test/api/providers?type=bad'))

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      error: { code: 'INVALID_PROVIDER_QUERY' },
    })
    expect(listProviders).not.toHaveBeenCalled()
  })

  it('returns 401 when client auth fails', async () => {
    const { ClientAuthError } = await import('@/lib/client-auth')
    requireClientAuth.mockRejectedValueOnce(new ClientAuthError('INVALID_TOKEN'))
    const response = await GET(new Request('https://tengyu.test/api/providers'))

    expect(response.status).toBe(401)
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      error: { code: 'INVALID_TOKEN' },
    })
  })
})
