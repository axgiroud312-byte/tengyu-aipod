import type { PipelineProgress, PipelineRunDetail, PipelineRunRecord } from '@tengyu-aipod/shared'
import { describe, expect, it } from 'vitest'
import {
  completedPipelineRunHasException,
  pipelineProgressHasException,
} from './pipeline-run-outcome'

function run(input: Partial<PipelineRunRecord> = {}): PipelineRunRecord {
  return {
    id: 'run-1',
    name: '完整任务',
    source_mode: 'txt2img',
    status: 'completed',
    config_json: '{}',
    stats_json: '{}',
    result_sections_json: '[]',
    logs_json: '[]',
    error_summary: null,
    created_at: 1,
    started_at: 1,
    completed_at: 2,
    ...input,
  }
}

describe('completedPipelineRunHasException', () => {
  it('derives a completed exception only from persisted failure evidence', () => {
    expect(
      completedPipelineRunHasException(
        run({
          result_sections_json: JSON.stringify([
            {
              key: 'image_processing',
              title: '印花产物',
              total: 3,
              completed: 2,
              failed: 1,
              collapsible: true,
              paginated: false,
              items: [],
            },
          ]),
        }),
      ),
    ).toBe(true)
    expect(completedPipelineRunHasException(run({ stats_json: '{"titleFailed":2}' }))).toBe(true)
    expect(completedPipelineRunHasException(run({ logs_json: '[{"level":"error"}]' }))).toBe(true)
    expect(completedPipelineRunHasException(run({ result_sections_json: '{broken' }))).toBe(false)
    expect(completedPipelineRunHasException(run({ status: 'failed' }))).toBe(false)
  })
})

describe('pipelineProgressHasException', () => {
  it('uses item and step details when a completed run is opened', () => {
    const detail: PipelineRunDetail = {
      run: run(),
      steps: [],
      items: [
        {
          id: 'item-1',
          run_id: 'run-1',
          item_key: 'print-1',
          step_key: 'detection',
          status: 'failed',
          source_path: null,
          output_path: null,
          artifact_id: null,
          print_id: null,
          source_artifact_ids_json: null,
          error_message: '检测失败',
          created_at: 1,
          updated_at: 2,
          completed_at: 2,
        },
      ],
    }

    expect(pipelineProgressHasException(detail)).toBe(true)

    const progress: PipelineProgress = {
      run_id: 'run-1',
      status: 'completed',
      current_step: null,
      message: '完整任务已完成',
      stats: {
        sourceImages: 1,
        prints: 1,
        detectionPass: 1,
        detectionReview: 0,
        detectionBlock: 0,
        photoshopGroups: 0,
        titleSucceeded: 0,
        titleFailed: 0,
      },
      steps: [],
      items: [],
      result_sections: [],
      logs: [],
    }
    expect(pipelineProgressHasException(progress)).toBe(false)
  })
})
