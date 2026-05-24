import { beforeEach, describe, expect, it, vi } from 'vitest'

const requireClientAuth = vi.fn()
const listPlatformRules = vi.fn()

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

vi.mock('@/lib/platform-rules', () => ({
  listPlatformRules,
  platformRuleCategories: ['collection', 'listing'],
}))

const { GET } = await import('./route')

beforeEach(() => {
  requireClientAuth.mockReset().mockResolvedValue(null)
  listPlatformRules.mockReset().mockResolvedValue({
    version: 'temu:20260520-01',
    rules: [
      {
        key: 'temu',
        name: 'Temu',
        category: 'collection',
        rules_json: { allowed_domains: ['temu.com'] },
        enabled: true,
        version: '20260520-01',
      },
    ],
  })
})

describe('GET /api/platform-rules', () => {
  it('requires client auth and passes category filter to platform rule registry', async () => {
    const response = await GET(
      new Request('https://tengyu.test/api/platform-rules?category=collection', {
        headers: { authorization: 'Bearer token' },
      }),
    )
    const body = (await response.json()) as unknown

    expect(response.status).toBe(200)
    expect(body).toEqual({
      ok: true,
      data: {
        version: 'temu:20260520-01',
        rules: [
          {
            key: 'temu',
            name: 'Temu',
            category: 'collection',
            rules_json: { allowed_domains: ['temu.com'] },
            enabled: true,
            version: '20260520-01',
          },
        ],
      },
    })
    expect(requireClientAuth).toHaveBeenCalledWith('Bearer token', {
      allowDevelopmentBypass: true,
    })
    expect(listPlatformRules).toHaveBeenCalledWith({ category: 'collection' })
  })

  it('rejects invalid category queries', async () => {
    const response = await GET(
      new Request('https://tengyu.test/api/platform-rules?category=generation'),
    )

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      error: { code: 'INVALID_PLATFORM_RULE_QUERY' },
    })
    expect(listPlatformRules).not.toHaveBeenCalled()
  })

  it('returns 401 when client auth fails', async () => {
    const { ClientAuthError } = await import('@/lib/client-auth')
    requireClientAuth.mockRejectedValueOnce(new ClientAuthError('INVALID_TOKEN'))

    const response = await GET(new Request('https://tengyu.test/api/platform-rules'))

    expect(response.status).toBe(401)
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      error: { code: 'INVALID_TOKEN' },
    })
    expect(listPlatformRules).not.toHaveBeenCalled()
  })
})
