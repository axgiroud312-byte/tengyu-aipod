import { describe, expect, it } from 'vitest'
import type { PsdTemplate } from './photoshop'
import {
  groupTasks,
  representativeSoCount,
  sanitizeTemplateName,
  sortAlphaNum,
} from './photoshop-grouping'

function createTemplate(overrides: Partial<PsdTemplate> = {}): PsdTemplate {
  return {
    id: 'psd-1',
    file_path: 'C:\\Users\\niilo\\Desktop\\钥匙扣x.psd',
    file_hash: 'hash',
    doc_size: { w: 1000, h: 1000 },
    smart_objects: [
      {
        name: 'SO 1',
        path: 'root/SO 1',
        sort_order: 0,
        is_top_level: true,
        bounds: [0, 0, 100, 100],
        shared_indicator: 'a',
      },
      {
        name: 'SO 2',
        path: 'root/SO 2',
        sort_order: 1,
        is_top_level: true,
        bounds: [100, 0, 200, 100],
        shared_indicator: 'b',
      },
    ],
    guides: { horizontal: [], vertical: [] },
    clip_areas: [{ x: 0, y: 0, w: 1000, h: 1000, is_full: true }],
    mode: 'independent',
    representative_so_count: 2,
    scanned_at: 123,
    layers: [],
    text_layers: [],
    ...overrides,
  }
}

describe('sortAlphaNum', () => {
  it('sorts numeric suffixes naturally', () => {
    expect(['img10', 'img2', 'img1'].sort(sortAlphaNum)).toEqual(['img1', 'img2', 'img10'])
  })
})

describe('representativeSoCount', () => {
  it('prefers top level smart objects for auto range', () => {
    expect(representativeSoCount(createTemplate())).toBe(2)
  })

  it('falls back to representative count when no top level objects exist', () => {
    const template = createTemplate({
      smart_objects: [],
      representative_so_count: 3,
    })

    expect(representativeSoCount(template)).toBe(3)
  })
})

describe('sanitizeTemplateName', () => {
  it('uses the PSD basename and removes Windows-invalid characters', () => {
    expect(sanitizeTemplateName('C:\\templates\\mockup:cup?.psd')).toBe('mockup_cup_')
  })
})

describe('groupTasks', () => {
  it('keeps the final partial group instead of discarding it', () => {
    const groups = groupTasks(
      [
        { id: 'img10', file_path: 'C:\\素材\\img10.png' },
        { id: 'img2', file_path: 'C:\\素材\\img2.png' },
        { id: 'img1', file_path: 'C:\\素材\\img1.png' },
      ],
      createTemplate(),
      {
        taskId: 'task-1',
        outputRoot: 'C:\\Users\\niilo\\Desktop\\新建文件夹',
      },
    )

    expect(groups).toHaveLength(2)
    expect(groups[0]?.print_assets.map((asset) => asset.id)).toEqual(['img1', 'img2'])
    expect(groups[1]?.print_assets.map((asset) => asset.id)).toEqual(['img10'])
    expect(groups[0]?.job.so_replacements).toHaveLength(2)
    expect(groups[0]?.job.task_id).toBe('task-1')
    expect(groups[0]?.job.output_paths[0]).toBe(
      'C:\\Users\\niilo\\Desktop\\新建文件夹/钥匙扣x/img1/01.jpg',
    )
  })

  it('uses a single asset per group when only one representative SO exists', () => {
    const groups = groupTasks(
      [
        { id: 'img2', file_path: 'C:\\素材\\img2.png' },
        { id: 'img10', file_path: 'C:\\素材\\img10.png' },
      ],
      createTemplate({
        representative_so_count: 1,
        smart_objects: [
          {
            name: 'SO 1',
            path: 'root/SO 1',
            sort_order: 0,
            is_top_level: true,
            bounds: [0, 0, 100, 100],
            shared_indicator: 'a',
          },
        ],
        clip_areas: [{ x: 0, y: 0, w: 1000, h: 1000, is_full: true }],
      }),
      {
        taskId: 'task-1',
        outputRoot: 'C:\\Users\\niilo\\Desktop\\新建文件夹',
        format: 'png',
      },
    )

    expect(groups).toHaveLength(2)
    expect(groups[0]?.print_assets.map((asset) => asset.id)).toEqual(['img2'])
    expect(groups[1]?.print_assets.map((asset) => asset.id)).toEqual(['img10'])
    expect(groups[0]?.job.output_paths[0]).toBe(
      'C:\\Users\\niilo\\Desktop\\新建文件夹/钥匙扣x/img2/01.png',
    )
  })
})
