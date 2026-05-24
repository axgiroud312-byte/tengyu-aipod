import { beforeEach, describe, expect, it, vi } from 'vitest'

const requireClientAuth = vi.fn()
const getComfyuiWorkflowContent = vi.fn()

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
  getComfyuiWorkflowContent,
}))

const { GET } = await import('./route')

beforeEach(() => {
  requireClientAuth.mockReset().mockResolvedValue(null)
  getComfyuiWorkflowContent.mockReset().mockResolvedValue({
    id: 'extract-v3',
    name: 'extract-v3',
    category: 'extract',
    version: '3.0.1',
    workflow_json: { '1': { class_type: 'LoadImage' } },
    input_slots: [{ name: 'sourceImage', node_id: '1', field: 'image' }],
    output_slots: [{ name: 'result', node_id: '9', field: 'images' }],
  })
})

describe('GET /api/comfyui-workflows/:id/content', () => {
  it('requires client auth and passes version filter to workflow registry', async () => {
    const response = await GET(
      new Request('https://tengyu.test/api/comfyui-workflows/extract-v3/content?version=3.0.1', {
        headers: { authorization: 'Bearer token' },
      }),
      { params: Promise.resolve({ id: 'extract-v3' }) },
    )
    const body = (await response.json()) as unknown

    expect(response.status).toBe(200)
    expect(body).toMatchObject({
      ok: true,
      data: {
        id: 'extract-v3',
        version: '3.0.1',
        workflow_json: { '1': { class_type: 'LoadImage' } },
      },
    })
    expect(requireClientAuth).toHaveBeenCalledWith('Bearer token', {
      allowDevelopmentBypass: true,
    })
    expect(getComfyuiWorkflowContent).toHaveBeenCalledWith('extract-v3', '3.0.1')
  })

  it('returns 404 when workflow content is missing', async () => {
    getComfyuiWorkflowContent.mockResolvedValueOnce(null)

    const response = await GET(
      new Request('https://tengyu.test/api/comfyui-workflows/missing/content'),
      { params: Promise.resolve({ id: 'missing' }) },
    )

    expect(response.status).toBe(404)
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      error: { code: 'COMFYUI_WORKFLOW_NOT_FOUND' },
    })
  })

  it('returns 401 when client auth fails', async () => {
    const { ClientAuthError } = await import('@/lib/client-auth')
    requireClientAuth.mockRejectedValueOnce(new ClientAuthError('INVALID_TOKEN'))

    const response = await GET(
      new Request('https://tengyu.test/api/comfyui-workflows/extract-v3/content'),
      { params: Promise.resolve({ id: 'extract-v3' }) },
    )

    expect(response.status).toBe(401)
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      error: { code: 'INVALID_TOKEN' },
    })
    expect(getComfyuiWorkflowContent).not.toHaveBeenCalled()
  })
})
