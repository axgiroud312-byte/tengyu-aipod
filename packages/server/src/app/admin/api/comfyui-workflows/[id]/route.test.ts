import { beforeEach, describe, expect, it, vi } from 'vitest'

const createNextComfyuiWorkflowVersion = vi.fn()
const getAdminComfyuiWorkflow = vi.fn()
const updateExistingComfyuiWorkflowVersion = vi.fn()

vi.mock('@/lib/comfyui-workflows', () => ({
  createNextComfyuiWorkflowVersion,
  getAdminComfyuiWorkflow,
  updateExistingComfyuiWorkflowVersion,
}))

const { GET, PATCH } = await import('./route')

const payload = {
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
  notes: null,
}

beforeEach(() => {
  createNextComfyuiWorkflowVersion.mockReset().mockResolvedValue({ id: 'extract-v3' })
  getAdminComfyuiWorkflow.mockReset().mockResolvedValue({ id: 'extract-v3', version: '3.0.1' })
  updateExistingComfyuiWorkflowVersion.mockReset().mockResolvedValue({ id: 'extract-v3' })
})

describe('admin comfyui workflow detail API', () => {
  it('loads a workflow with version filter', async () => {
    const response = await GET(
      new Request('https://tengyu.test/admin/api/comfyui-workflows/extract-v3?version=3.0.1'),
      { params: Promise.resolve({ id: 'extract-v3' }) },
    )

    expect(response.status).toBe(200)
    expect(getAdminComfyuiWorkflow).toHaveBeenCalledWith('extract-v3', '3.0.1')
  })

  it('overwrites the selected workflow version', async () => {
    const response = await PATCH(
      new Request('https://tengyu.test/admin/api/comfyui-workflows/extract-v3', {
        method: 'PATCH',
        body: JSON.stringify({ ...payload, save_mode: 'overwrite' }),
      }),
      { params: Promise.resolve({ id: 'extract-v3' }) },
    )

    expect(response.status).toBe(200)
    expect(updateExistingComfyuiWorkflowVersion).toHaveBeenCalledWith(
      'extract-v3',
      '3.0.1',
      expect.objectContaining({ id: 'extract-v3', version: '3.0.1' }),
    )
    expect(createNextComfyuiWorkflowVersion).not.toHaveBeenCalled()
  })

  it('saves a new patch version from the selected workflow version', async () => {
    const response = await PATCH(
      new Request('https://tengyu.test/admin/api/comfyui-workflows/extract-v3', {
        method: 'PATCH',
        body: JSON.stringify({ ...payload, save_mode: 'new_version' }),
      }),
      { params: Promise.resolve({ id: 'extract-v3' }) },
    )

    expect(response.status).toBe(200)
    expect(createNextComfyuiWorkflowVersion).toHaveBeenCalledWith(
      'extract-v3',
      '3.0.1',
      expect.objectContaining({ category: 'extract' }),
    )
  })
})
