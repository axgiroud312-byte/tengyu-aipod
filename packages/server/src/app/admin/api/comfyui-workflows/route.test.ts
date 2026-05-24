import { beforeEach, describe, expect, it, vi } from 'vitest'

const createComfyuiWorkflowVersion = vi.fn()
const listAdminComfyuiWorkflows = vi.fn()

vi.mock('@/lib/comfyui-workflows', () => ({
  createComfyuiWorkflowVersion,
  listAdminComfyuiWorkflows,
}))

const { GET, POST } = await import('./route')

beforeEach(() => {
  createComfyuiWorkflowVersion.mockReset().mockResolvedValue({ id: 'extract-v3' })
  listAdminComfyuiWorkflows.mockReset().mockResolvedValue([{ id: 'extract-v3' }])
})

describe('admin comfyui workflows API', () => {
  it('passes category filter to admin workflow list', async () => {
    const response = await GET(
      new Request('https://tengyu.test/admin/api/comfyui-workflows?category=extract'),
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      ok: true,
      data: { items: [{ id: 'extract-v3' }] },
    })
    expect(listAdminComfyuiWorkflows).toHaveBeenCalledWith({ category: 'extract' })
  })

  it('creates a workflow version with JSON fields preserved as text', async () => {
    const response = await POST(
      new Request('https://tengyu.test/admin/api/comfyui-workflows', {
        method: 'POST',
        body: JSON.stringify({
          id: 'extract-v3',
          category: 'extract',
          version: '3.0.1',
          workflow_json: '{"1":{"class_type":"LoadImage"}}',
          input_slots_json: '[{"node_id":"1","field":"image"}]',
          output_slots_json: '[{"node_id":"9","field":"images"}]',
          required_models: ['BiRefNet'],
          recommended_pod_keywords: ['ComfyUI Default'],
          min_vram_gb: 12,
          enabled: true,
          notes: '',
        }),
      }),
    )

    expect(response.status).toBe(200)
    expect(createComfyuiWorkflowVersion).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'extract-v3',
        workflow_json: '{"1":{"class_type":"LoadImage"}}',
        input_slots_json: '[{"node_id":"1","field":"image"}]',
        notes: null,
      }),
    )
  })

  it('rejects malformed workflow JSON', async () => {
    const response = await POST(
      new Request('https://tengyu.test/admin/api/comfyui-workflows', {
        method: 'POST',
        body: JSON.stringify({
          id: 'bad',
          category: 'extract',
          version: '1.0.0',
          workflow_json: 'not-json',
          input_slots_json: '[]',
          output_slots_json: '[]',
          required_models: [],
          recommended_pod_keywords: [],
          min_vram_gb: 8,
          enabled: true,
          notes: null,
        }),
      }),
    )

    expect(response.status).toBe(400)
    expect(createComfyuiWorkflowVersion).not.toHaveBeenCalled()
  })
})
