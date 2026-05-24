import type { ComfyuiWorkflow } from '@prisma/client'
import { describe, expect, it } from 'vitest'
import {
  serializeComfyuiWorkflowContent,
  serializeComfyuiWorkflowSummary,
} from './comfyui-workflows'

function workflow(overrides: Partial<ComfyuiWorkflow> = {}): ComfyuiWorkflow {
  const now = new Date('2026-05-23T00:00:00.000Z')
  return {
    row_id: 'row-1',
    id: 'extract-v3',
    category: 'extract',
    version: '3.0.1',
    workflow_json: JSON.stringify({ '1': { class_type: 'LoadImage' } }),
    input_slots_json: JSON.stringify([
      { name: 'sourceImage', node_id: '1', field: 'image', image_index: 0 },
    ]),
    output_slots_json: JSON.stringify([{ name: 'result', node_id: '9', field: 'images' }]),
    required_models: ['BiRefNet'],
    recommended_pod_keywords: ['ComfyUI Default'],
    min_vram_gb: 12,
    enabled: true,
    notes: null,
    updated_at: now,
    ...overrides,
  }
}

describe('comfyui workflow helpers', () => {
  it('serializes list summaries without workflow JSON or slots', () => {
    const summary = serializeComfyuiWorkflowSummary(workflow())

    expect(summary).toEqual({
      id: 'extract-v3',
      name: 'extract-v3',
      category: 'extract',
      version: '3.0.1',
      required_models: ['BiRefNet'],
      recommended_pod_keywords: ['ComfyUI Default'],
      min_vram_gb: 12,
      enabled: true,
      notes: null,
      updated_at: '2026-05-23T00:00:00.000Z',
    })
    expect(summary).not.toHaveProperty('workflow_json')
    expect(summary).not.toHaveProperty('input_slots')
    expect(summary).not.toHaveProperty('output_slots')
  })

  it('serializes content with parsed workflow JSON and slots', () => {
    const content = serializeComfyuiWorkflowContent(workflow())

    expect(content.workflow_json).toEqual({ '1': { class_type: 'LoadImage' } })
    expect(content.input_slots).toEqual([
      { name: 'sourceImage', node_id: '1', field: 'image', image_index: 0 },
    ])
    expect(content.output_slots).toEqual([{ name: 'result', node_id: '9', field: 'images' }])
  })

  it('falls back to safe empty structures for malformed JSON', () => {
    const content = serializeComfyuiWorkflowContent(
      workflow({
        workflow_json: 'not-json',
        input_slots_json: '{"bad":true}',
        output_slots_json: 'not-json',
      }),
    )

    expect(content.workflow_json).toEqual({})
    expect(content.input_slots).toEqual([])
    expect(content.output_slots).toEqual([])
  })
})
