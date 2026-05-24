import type { ComfyuiWorkflow } from '@prisma/client'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const findMany = vi.fn()
const findFirst = vi.fn()
const findUnique = vi.fn()
const create = vi.fn()
const update = vi.fn()

vi.mock('@/lib/db', () => ({
  db: {
    comfyuiWorkflow: {
      create,
      findMany,
      findFirst,
      findUnique,
      update,
    },
  },
}))

const {
  createComfyuiWorkflowVersion,
  createNextComfyuiWorkflowVersion,
  getComfyuiWorkflowContent,
  listComfyuiWorkflows,
  updateExistingComfyuiWorkflowVersion,
} = await import('./comfyui-workflows')

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
  findUnique.mockReset()
  create.mockReset()
  update.mockReset()
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

  it('creates workflow versions with text JSON fields preserved', async () => {
    findUnique.mockResolvedValueOnce(null)
    create.mockResolvedValueOnce(workflow({ version: '2.0.0' }))

    await expect(
      createComfyuiWorkflowVersion({
        id: 'matting-v1',
        category: 'matting',
        version: '2.0.0',
        workflow_json: '{"1":{}}',
        input_slots_json: '[]',
        output_slots_json: '[]',
        required_models: ['BiRefNet'],
        recommended_pod_keywords: ['ComfyUI Default'],
        min_vram_gb: 8,
        enabled: true,
        notes: null,
      }),
    ).resolves.toMatchObject({ id: 'matting-v1', version: '2.0.0' })

    expect(create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        id: 'matting-v1',
        workflow_json: '{"1":{}}',
        required_models: ['BiRefNet'],
      }),
    })
  })

  it('updates an existing workflow version by row id', async () => {
    findUnique.mockResolvedValueOnce(workflow({ row_id: 'row-existing' }))
    update.mockResolvedValueOnce(workflow({ enabled: false }))

    await expect(
      updateExistingComfyuiWorkflowVersion('matting-v1', '1.0.0', {
        id: 'matting-v1',
        category: 'matting',
        version: '1.0.0',
        workflow_json: '{}',
        input_slots_json: '[]',
        output_slots_json: '[]',
        required_models: [],
        recommended_pod_keywords: [],
        min_vram_gb: 8,
        enabled: false,
        notes: null,
      }),
    ).resolves.toMatchObject({ enabled: false })

    expect(update).toHaveBeenCalledWith({
      where: { row_id: 'row-existing' },
      data: expect.objectContaining({ enabled: false }),
    })
  })

  it('creates the next patch version for admin version management', async () => {
    findUnique.mockResolvedValueOnce(null)
    create.mockResolvedValueOnce(workflow({ version: '1.0.1' }))

    await createNextComfyuiWorkflowVersion('matting-v1', '1.0.0', {
      category: 'matting',
      workflow_json: '{}',
      input_slots_json: '[]',
      output_slots_json: '[]',
      required_models: [],
      recommended_pod_keywords: [],
      min_vram_gb: 8,
      enabled: true,
      notes: null,
    })

    expect(create).toHaveBeenCalledWith({
      data: expect.objectContaining({ version: '1.0.1' }),
    })
  })
})
