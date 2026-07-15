import type {
  PipelineItemRecord,
  PipelineProgress,
  PipelineResultSection,
  PipelineRunDetail,
  PipelineRunStats,
  PipelineStepKey,
  PipelineStepRecord,
} from '@tengyu-aipod/shared'
import { describe, expect, it } from 'vitest'
import { buildPipelineRailViewModel } from './pipeline-progress-view-model'
import type { PipelineConfigStage } from './types'

const enabled: Record<PipelineConfigStage, boolean> = {
  source: true,
  matting: true,
  detection: true,
  photoshop: true,
  title: true,
}

const stats: PipelineRunStats = {
  sourceImages: 0,
  prints: 0,
  detectionPass: 0,
  detectionReview: 0,
  detectionBlock: 0,
  photoshopGroups: 0,
  titleSucceeded: 0,
  titleFailed: 0,
}

function step(input: {
  key: PipelineStepKey
  status: PipelineStepRecord['status']
  inputCount?: number
  outputCount?: number
  startedAt?: number | null
  completedAt?: number | null
}): PipelineStepRecord {
  return {
    id: `${input.key}-${input.status}`,
    run_id: 'run-1',
    step_key: input.key,
    module: input.key,
    label: input.key,
    status: input.status,
    input_count: input.inputCount ?? 0,
    output_count: input.outputCount ?? 0,
    error_json: null,
    output_json: null,
    started_at: input.startedAt ?? null,
    completed_at: input.completedAt ?? null,
    updated_at: 1,
  }
}

function item(input: {
  key: PipelineStepKey
  status: PipelineItemRecord['status']
  id?: string
  riskLevel?: 'pass' | 'review' | 'block'
}): PipelineItemRecord {
  return {
    id: input.id ?? `${input.key}-${input.status}`,
    run_id: 'run-1',
    item_key: input.id ?? `${input.key}-${input.status}`,
    step_key: input.key,
    status: input.status,
    source_path: null,
    output_path: null,
    artifact_id: null,
    print_id: null,
    source_artifact_ids_json: null,
    error_message: null,
    created_at: 1,
    updated_at: 1,
    completed_at: input.status === 'running' || input.status === 'pending' ? null : 2,
    ...(input.riskLevel ? { risk_level: input.riskLevel } : {}),
  }
}

function progress(input: Partial<PipelineProgress>): PipelineProgress {
  return {
    run_id: 'run-1',
    status: 'running',
    current_step: null,
    message: 'running',
    stats,
    steps: [],
    items: [],
    logs: [],
    result_sections: [],
    ...input,
  }
}

function section(
  input: Partial<PipelineResultSection> & Pick<PipelineResultSection, 'key'>,
): PipelineResultSection {
  return {
    title: input.key,
    total: 0,
    completed: 0,
    collapsible: false,
    paginated: false,
    items: [],
    ...input,
  }
}

function runDetail(input: {
  status: PipelineRunDetail['run']['status']
  statsJson?: string
  errorSummary?: string | null
  steps?: PipelineStepRecord[]
  items?: PipelineItemRecord[]
  resultSections?: PipelineResultSection[]
  logs?: PipelineRunDetail['logs']
}): PipelineRunDetail {
  return {
    run: {
      id: 'run-1',
      name: '历史完整任务',
      source_mode: 'txt2img',
      status: input.status,
      config_json: '{}',
      stats_json: input.statsJson ?? JSON.stringify(stats),
      result_sections_json: null,
      logs_json: null,
      error_summary: input.errorSummary ?? null,
      created_at: 1,
      started_at: 10,
      completed_at: 100,
    },
    steps: input.steps ?? [],
    items: input.items ?? [],
    result_sections: input.resultSections ?? [],
    logs: input.logs ?? [],
  }
}

describe('buildPipelineRailViewModel', () => {
  it('allows multiple stages to be active at the same time', () => {
    const view = buildPipelineRailViewModel({
      progress: progress({
        steps: [
          step({ key: 'source', status: 'running', outputCount: 1 }),
          step({ key: 'matting', status: 'running', inputCount: 1 }),
        ],
      }),
      issues: [],
      enabled: { ...enabled, detection: false, photoshop: false, title: false },
    })

    expect(view.stages.filter((stage) => stage.active).map((stage) => stage.key)).toEqual([
      'source',
      'matting',
    ])
  })

  it('maps extract step counts onto the source stage', () => {
    const view = buildPipelineRailViewModel({
      progress: progress({
        steps: [step({ key: 'extract', status: 'completed', inputCount: 3, outputCount: 2 })],
      }),
      issues: [],
      enabled,
    })

    expect(view.stages.find((stage) => stage.key === 'source')?.counts).toMatchObject({
      done: 2,
      total: 3,
    })
  })

  it('marks skipped stages without treating them as active work', () => {
    const view = buildPipelineRailViewModel({
      progress: progress({
        steps: [step({ key: 'detection', status: 'skipped', inputCount: 3, outputCount: 0 })],
      }),
      issues: [],
      enabled: { ...enabled, detection: false },
    })

    const detection = view.stages.find((stage) => stage.key === 'detection')
    expect(detection).toMatchObject({
      active: false,
      enabled: false,
      status: 'skipped',
      counts: { done: 0, total: 3, failed: 0, blocked: 0 },
    })
  })

  it('counts detection filtered items as blocked and failed items separately', () => {
    const view = buildPipelineRailViewModel({
      progress: progress({
        items: [
          item({ key: 'detection', status: 'completed', id: 'passed-1', riskLevel: 'pass' }),
          item({ key: 'detection', status: 'filtered', id: 'blocked-1', riskLevel: 'block' }),
          item({ key: 'detection', status: 'failed', id: 'failed-1' }),
        ],
      }),
      issues: [],
      enabled,
    })

    expect(view.stages.find((stage) => stage.key === 'detection')?.counts).toEqual({
      done: 1,
      total: 3,
      failed: 1,
      blocked: 1,
    })
  })

  it('summarizes cancelled runs as a soft stop when no custom message is provided', () => {
    const view = buildPipelineRailViewModel({
      progress: progress({
        status: 'cancelled',
        message: '',
        steps: [step({ key: 'matting', status: 'cancelled', inputCount: 4, outputCount: 2 })],
      }),
      issues: [],
      enabled,
    })

    expect(view.mode).toBe('done')
    expect(view.summary.status).toBe('完整任务已取消，已完成产物已保留')
    expect(view.stages.find((stage) => stage.key === 'matting')?.status).toBe('cancelled')
  })

  it('maps interrupted history runs and preserves completed output counts', () => {
    const view = buildPipelineRailViewModel({
      progress: runDetail({
        status: 'interrupted',
        statsJson: JSON.stringify({ ...stats, prints: 2, photoshopGroups: 4 }),
        steps: [
          step({
            key: 'photoshop',
            status: 'completed',
            inputCount: 2,
            outputCount: 4,
            startedAt: 100,
            completedAt: 340,
          }),
          step({ key: 'title', status: 'interrupted', inputCount: 4, outputCount: 1 }),
        ],
      }),
      issues: [],
      enabled,
    })

    expect(view.summary.status).toBe('完整任务已中断，已完成产物已保留')
    expect(view.stages.find((stage) => stage.key === 'photoshop')).toMatchObject({
      status: 'completed',
      counts: { done: 4, total: 4, failed: 0, blocked: 0 },
      durationMs: 240,
    })
    expect(view.stages.find((stage) => stage.key === 'title')?.status).toBe('interrupted')
  })

  it('uses completed history details as the finished run report', () => {
    const view = buildPipelineRailViewModel({
      progress: runDetail({
        status: 'completed',
        statsJson: JSON.stringify({ ...stats, photoshopGroups: 3, titleSucceeded: 2 }),
        steps: [
          step({
            key: 'photoshop',
            status: 'completed',
            inputCount: 1,
            outputCount: 3,
            startedAt: 20,
            completedAt: 80,
          }),
          step({
            key: 'title',
            status: 'completed',
            inputCount: 3,
            outputCount: 2,
            startedAt: 90,
            completedAt: 140,
          }),
        ],
        logs: [
          { id: 'log-1', created_at: 1, level: 'info', message: '套版完成 3 个货号' },
          { id: 'log-2', created_at: 2, level: 'info', message: '标题完成 2 个货号' },
        ],
      }),
      issues: [],
      enabled,
    })

    expect(view.mode).toBe('done')
    expect(view.stages.find((stage) => stage.key === 'photoshop')).toMatchObject({
      status: 'completed',
      counts: { done: 3, total: 3, failed: 0, blocked: 0 },
      durationMs: 60,
    })
    expect(view.stages.find((stage) => stage.key === 'title')).toMatchObject({
      status: 'completed',
      counts: { done: 2, total: 3, failed: 0, blocked: 0 },
      durationMs: 50,
    })
    expect(view.logTail).toEqual(['套版完成 3 个货号', '标题完成 2 个货号'])
  })

  it('carries locked stage reasons for the rail to display', () => {
    const view = buildPipelineRailViewModel({
      progress: null,
      issues: [],
      enabled,
      locked: {
        title: { on: false, reason: '标题生成依赖 PS 套版' },
      },
    })

    expect(view.stages.find((stage) => stage.key === 'title')).toMatchObject({
      enabled: false,
      locked: { on: false, reason: '标题生成依赖 PS 套版' },
      status: 'locked',
    })
  })

  it('returns only the last three key log messages for the theater', () => {
    const view = buildPipelineRailViewModel({
      progress: progress({
        logs: Array.from({ length: 7 }, (_, index) => ({
          id: `log-${index}`,
          created_at: index,
          level: 'info',
          message: `message-${index}`,
        })),
      }),
      issues: [],
      enabled,
    })

    expect(view.logTail).toEqual(['message-4', 'message-5', 'message-6'])
  })

  it('warns when every detected print is blocked with no downstream output', () => {
    const view = buildPipelineRailViewModel({
      progress: progress({
        status: 'completed',
        message: '完整任务已完成',
        stats: { ...stats, detectionBlock: 2 },
        steps: [
          step({ key: 'detection', status: 'completed', inputCount: 2, outputCount: 0 }),
          step({ key: 'photoshop', status: 'completed', inputCount: 0, outputCount: 0 }),
          step({ key: 'title', status: 'completed', inputCount: 0, outputCount: 0 }),
        ],
        result_sections: [
          section({
            key: 'detection_blocked',
            title: '未通过',
            total: 2,
            completed: 2,
          }),
        ],
      }),
      issues: [],
      enabled,
    })

    expect(view.summary.warning).toBe('本次没有可继续的印花')
  })
})
