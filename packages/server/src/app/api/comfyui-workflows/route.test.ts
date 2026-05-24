import { beforeEach, describe, expect, it, vi } from 'vitest'

const requireClientAuth = vi.fn()
const listComfyuiWorkflows = vi.fn()

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

vi.mock('@/lib/comfyui-workflows', () => ({
  listComfyuiWorkflows,
}))

const { GET } = await import('./route')

beforeEach(() => {
  requireClientAuth.mockReset().mockResolvedValue(null)
  listComfyuiWorkflows.mockReset().mockResolvedValue([
    {
      id: 'extract-v3',
      name: 'extract-v3',
      category: 'extract',
      version: '3.0.1',
      required_models: [],
    },
  ])
})

describe('GET /api/comfyui-workflows', () => {
  it('requires client auth and passes category filter to workflow registry', async () => {
    const response = await GET(
      new Request('https://tengyu.test/api/comfyui-workflows?category=extract', {
        headers: { authorization: 'Bearer token' },
      }),
    )
    const body = (await response.json()) as unknown

    expect(response.status).toBe(200)
    expect(body).toEqual({
      ok: true,
      data: [
        {
          id: 'extract-v3',
          name: 'extract-v3',
          category: 'extract',
          version: '3.0.1',
          required_models: [],
        },
      ],
    })
    expect(requireClientAuth).toHaveBeenCalledWith('Bearer token', {
      allowDevelopmentBypass: true,
    })
    expect(listComfyuiWorkflows).toHaveBeenCalledWith({ category: 'extract' })
  })

  it('returns 401 when client auth fails', async () => {
    const { ClientAuthError } = await import('@/lib/client-auth')
    requireClientAuth.mockRejectedValueOnce(new ClientAuthError('INVALID_TOKEN'))

    const response = await GET(new Request('https://tengyu.test/api/comfyui-workflows'))

    expect(response.status).toBe(401)
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      error: { code: 'INVALID_TOKEN' },
    })
    expect(listComfyuiWorkflows).not.toHaveBeenCalled()
  })
})
