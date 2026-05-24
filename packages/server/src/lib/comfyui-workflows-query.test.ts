import type { ComfyuiWorkflow } from '@prisma/client'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const findMany = vi.fn()
const findFirst = vi.fn()

vi.mock('@/lib/db', () => ({
  db: {
    comfyuiWorkflow: {
      findMany,
      findFirst,
    },
  },
}))

const { getComfyuiWorkflowContent, listComfyuiWorkflows } = await import('./comfyui-workflows')

function workflow(overrides: Partial<ComfyuiWorkflow> = {}): ComfyuiWorkflow {
  const now = new Date('2026-05-23T00:00:00.000Z')
  return {
    row_id: 'row-1',
    id: 'matting-v1',
    category: 'matting',
    version: '1.0.0',
    workflow_json: '{}',
    input_slots_json: '[]',
    output_slots_json: '[]',
    required_models: [],
    recommended_pod_keywords: [],
    min_vram_gb: 8,
    enabled: true,
    notes: null,
    updated_at: now,
    ...overrides,
  }
}

beforeEach(() => {
  findMany.mockReset()
  findFirst.mockReset()
})

describe('comfyui workflow queries', () => {
  it('filters enabled workflows by category and returns latest versions', async () => {
    findMany.mockResolvedValueOnce([workflow({ version: '1.0.0' }), workflow({ version: '1.0.2' })])

    await expect(listComfyuiWorkflows({ category: 'matting' })).resolves.toMatchObject([
      { id: 'matting-v1', version: '1.0.2', category: 'matting' },
    ])

    expect(findMany).toHaveBeenCalledWith({
      where: {
        enabled: true,
        category: 'matting',
      },
      orderBy: [{ id: 'asc' }, { updated_at: 'desc' }],
    })
  })

  it('gets a specified enabled workflow version', async () => {
    findFirst.mockResolvedValueOnce(workflow({ version: '1.0.0' }))

    await expect(getComfyuiWorkflowContent('matting-v1', '1.0.0')).resolves.toMatchObject({
      id: 'matting-v1',
      version: '1.0.0',
      workflow_json: {},
    })

    expect(findFirst).toHaveBeenCalledWith({
      where: {
        id: 'matting-v1',
        version: '1.0.0',
        enabled: true,
      },
    })
  })

  it('returns null when a specified workflow version is disabled or missing', async () => {
    findFirst.mockResolvedValueOnce(null)

    await expect(getComfyuiWorkflowContent('missing', '1.0.0')).resolves.toBeNull()
  })
})
