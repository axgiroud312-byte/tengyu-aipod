import type {
  PipelineProgress,
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
    started_at: null,
    completed_at: null,
    updated_at: 1,
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

  it('returns the last five log messages', () => {
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

    expect(view.logTail).toEqual(['message-2', 'message-3', 'message-4', 'message-5', 'message-6'])
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
          {
            key: 'detection_blocked',
            title: '未通过',
            total: 2,
            completed: 2,
            collapsible: false,
            paginated: false,
            items: [],
          },
        ],
      }),
      issues: [],
      enabled,
    })

    expect(view.summary.warning).toBe('本次没有可继续的印花')
  })
})
