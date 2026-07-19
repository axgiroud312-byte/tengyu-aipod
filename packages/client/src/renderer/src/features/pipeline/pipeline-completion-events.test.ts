import type { PipelineProgress, PipelineTaskEvent } from '@tengyu-aipod/shared'
import { describe, expect, it } from 'vitest'
import {
  mergePipelineProgress,
  shouldApplyPipelineCompletedEvent,
  shouldApplyPipelineProgress,
} from './pipeline-completion-events'

function completedEvent(runId: string): PipelineTaskEvent {
  return {
    ok: true,
    result: {
      run: {
        id: runId,
        name: runId,
        source_mode: 'existing_prints',
        status: 'completed',
        config_json: '{}',
        stats_json: '{}',
        result_sections_json: null,
        logs_json: null,
        error_summary: null,
        created_at: 1,
        started_at: 1,
        completed_at: 2,
      },
      steps: [],
      items: [],
      result_sections: [],
      logs: [],
    },
  }
}

describe('pipeline completed event filtering', () => {
  it('ignores completed events from other runs while a current run is selected', () => {
    expect(shouldApplyPipelineCompletedEvent('run-current', completedEvent('run-old'))).toBe(false)
  })

  it('accepts completed events for the current run', () => {
    expect(shouldApplyPipelineCompletedEvent('run-current', completedEvent('run-current'))).toBe(
      true,
    )
  })

  it('ignores completed events when no current run is selected', () => {
    expect(shouldApplyPipelineCompletedEvent(null, completedEvent('run-any'))).toBe(false)
  })

  it('filters failed completed events by run id too', () => {
    expect(
      shouldApplyPipelineCompletedEvent('run-current', {
        ok: false,
        run_id: 'run-old',
        error: 'failed',
      }),
    ).toBe(false)
  })
})

describe('pipeline progress event filtering', () => {
  const progress = { run_id: 'run-current' } as PipelineProgress

  it('only accepts progress for the selected run', () => {
    expect(shouldApplyPipelineProgress(null, progress)).toBe(false)
    expect(shouldApplyPipelineProgress('run-other', progress)).toBe(false)
    expect(shouldApplyPipelineProgress('run-current', progress)).toBe(true)
  })

  it('keeps prior optional payload sections for a lightweight update of the same run', () => {
    const previous = {
      ...progress,
      items: [{ id: 'item-1' }],
      result_sections: [{ key: 'source_images' }],
      logs: [{ id: 'log-1' }],
      preview_images: [{ step_key: 'source' }],
    } as unknown as PipelineProgress
    const next = { ...progress, message: '状态更新' }

    expect(mergePipelineProgress(previous, next)).toMatchObject({
      message: '状态更新',
      items: previous.items,
      result_sections: previous.result_sections,
      logs: previous.logs,
      preview_images: previous.preview_images,
    })
    expect(mergePipelineProgress(previous, { ...next, run_id: 'run-other' })).toEqual({
      ...next,
      run_id: 'run-other',
    })
  })
})
