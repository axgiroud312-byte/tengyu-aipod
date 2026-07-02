import type {
  PipelineProgress,
  PipelineResultSection,
  PipelineRunConfig,
} from '@tengyu-aipod/shared'
import { describe, expect, it } from 'vitest'
import {
  finalPipelineResult,
  pipelineResultStats,
  sectionItemsForLightbox,
  sourceMetricLabel,
} from './pipeline-result-preview'

function section(
  input: Partial<PipelineResultSection> & Pick<PipelineResultSection, 'key'>,
): PipelineResultSection {
  return {
    title: input.title ?? input.key,
    total: input.total ?? input.items?.length ?? input.groups?.length ?? 0,
    completed: input.completed ?? input.items?.length ?? input.groups?.length ?? 0,
    collapsible: true,
    paginated: false,
    items: input.items ?? [],
    ...input,
  }
}

function config(input: Partial<PipelineRunConfig>): PipelineRunConfig {
  return {
    printMode: 'local',
    source: { mode: 'txt2img', provider: 'grsai', prompt: { mode: 'manual', count: 2 } },
    matting: { enabled: false, mode: 'comfyui' },
    detection: { enabled: false },
    photoshop: { enabled: false, templates: [] },
    title: { enabled: false, platform: 'temu', language: 'en', model: 'qwen3.6-flash' },
    ...input,
  } as PipelineRunConfig
}

function progress(sections: PipelineResultSection[]): PipelineProgress {
  return {
    run_id: 'run-1',
    status: 'running',
    current_step: null,
    message: '',
    stats: {
      sourceImages: 0,
      prints: 2,
      detectionPass: 1,
      detectionReview: 1,
      detectionBlock: 1,
      photoshopGroups: 2,
      titleSucceeded: 1,
      titleFailed: 1,
    },
    steps: [],
    result_sections: sections,
  }
}

describe('pipeline result preview helpers', () => {
  it('prefers photoshop groups when photoshop is enabled', () => {
    const result = finalPipelineResult(
      config({ photoshop: { enabled: true, templates: ['front.psd'] } }),
      progress([
        section({
          key: 'image_processing',
          items: [{ id: 'print-1', status: 'success', step_key: 'source', label: 'print' }],
        }),
        section({
          key: 'print_products',
          groups: [
            {
              id: 'front-sku',
              label: 'front / GZKJ-0001',
              kind: 'folder',
              cover_path: 'C:\\out\\front\\GZKJ-0001\\01.jpg',
              folder_path: 'C:\\out\\front\\GZKJ-0001',
              items: [
                {
                  id: 'img-1',
                  status: 'success',
                  step_key: 'photoshop',
                  label: 'front / GZKJ-0001',
                  local_path: 'C:\\out\\front\\GZKJ-0001\\01.jpg',
                },
              ],
            },
          ],
        }),
      ]),
    )

    expect(result?.mode).toBe('groups')
    expect(result?.section.key).toBe('print_products')
  })

  it('falls back to detection passed results when photoshop is disabled and detection is enabled', () => {
    const result = finalPipelineResult(
      config({ detection: { enabled: true } }),
      progress([
        section({
          key: 'image_processing',
          items: [{ id: 'print-1', status: 'success', step_key: 'source', label: 'print' }],
        }),
        section({
          key: 'detection_passed',
          items: [{ id: 'pass-1', status: 'success', step_key: 'detection', label: 'pass' }],
        }),
      ]),
    )

    expect(result?.mode).toBe('images')
    expect(result?.section.key).toBe('detection_passed')
  })

  it('does not emit stats for disabled stages', () => {
    const stats = pipelineResultStats(
      config({
        source: { mode: 'img2img', provider: 'grsai', prompt: { mode: 'manual', count: 2 } },
        matting: { enabled: false, mode: 'comfyui' },
        detection: { enabled: false },
        photoshop: { enabled: true, templates: ['front.psd'] },
        title: { enabled: false, platform: 'temu', language: 'en', model: 'qwen3.6-flash' },
      }),
      progress([]),
    )

    expect(stats.map((item) => item.key)).toEqual(['source', 'photoshop'])
    expect(stats[0]).toMatchObject({ label: '图生图产出', value: '2' })
  })

  it('labels source metric by source mode', () => {
    expect(
      sourceMetricLabel(
        config({
          source: { mode: 'txt2img', provider: 'grsai', prompt: { mode: 'manual', count: 1 } },
        }),
      ),
    ).toBe('文生图产出')
    expect(
      sourceMetricLabel(
        config({
          source: { mode: 'img2img', provider: 'grsai', prompt: { mode: 'manual', count: 1 } },
        }),
      ),
    ).toBe('图生图产出')
    expect(
      sourceMetricLabel(
        config({
          source: {
            mode: 'collection',
            sourceFolder: 'C:\\source',
            extract: { provider: 'grsai' },
          },
        }),
      ),
    ).toBe('提取印花')
    expect(
      sourceMetricLabel(
        config({
          source: { mode: 'existing_prints', printFolder: 'C:\\prints', startStep: 'photoshop' },
        }),
      ),
    ).toBe('已有印花')
  })

  it('flattens group items for lightbox', () => {
    const items = sectionItemsForLightbox(
      section({
        key: 'print_products',
        groups: [
          {
            id: 'group-1',
            label: 'front / SKU',
            kind: 'folder',
            items: [
              {
                id: 'img-1',
                status: 'success',
                step_key: 'photoshop',
                label: '01',
                local_path: 'C:\\a.jpg',
              },
            ],
          },
        ],
      }),
    )

    expect(items).toEqual([
      {
        id: 'img-1',
        status: 'success',
        step_key: 'photoshop',
        label: '01',
        local_path: 'C:\\a.jpg',
      },
    ])
  })
})
