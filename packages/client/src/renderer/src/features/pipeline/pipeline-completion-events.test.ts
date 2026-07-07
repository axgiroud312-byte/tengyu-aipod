import type { PipelineTaskEvent } from '@tengyu-aipod/shared'
import { describe, expect, it } from 'vitest'
import { shouldApplyPipelineCompletedEvent } from './pipeline-completion-events'

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

  it('accepts completed events when no current run is selected', () => {
    expect(shouldApplyPipelineCompletedEvent(null, completedEvent('run-any'))).toBe(true)
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
