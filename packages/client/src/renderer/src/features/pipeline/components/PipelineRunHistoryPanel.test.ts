// @vitest-environment jsdom

import type { PipelineRunRecord } from '@tengyu-aipod/shared'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { createElement } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PipelineRunHistoryPanel } from './PipelineResultPanels'

afterEach(cleanup)

function run(index: number, status: PipelineRunRecord['status'] = 'completed'): PipelineRunRecord {
  return {
    id: `run-${index}`,
    name: `历史任务 ${index}`,
    source_mode: 'txt2img',
    status,
    config_json: '{}',
    stats_json: '{}',
    result_sections_json: '[]',
    logs_json: '[]',
    error_summary: null,
    created_at: index,
    started_at: index,
    completed_at: index + 1,
  }
}

describe('PipelineRunHistoryPanel', () => {
  it('shows every loaded run and opens completed or cancelled results', () => {
    const onView = vi.fn<(runId: string) => void>()
    const runs = [
      run(1),
      run(2, 'cancelled'),
      ...Array.from({ length: 11 }, (_, index) => run(index + 3)),
    ]

    render(
      createElement(PipelineRunHistoryPanel, {
        currentRunId: null,
        loading: false,
        onRefresh: vi.fn(),
        onResume: vi.fn(),
        onView,
        resumeLoading: false,
        runs,
      }),
    )

    expect(screen.getByText('历史任务 13')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '查看完整任务 历史任务 1 结果' }))
    fireEvent.click(screen.getByRole('button', { name: '查看完整任务 历史任务 2 结果' }))
    expect(onView.mock.calls).toEqual([['run-1'], ['run-2']])
  })

  it('marks a completed run with persisted failures as completed with exceptions', () => {
    const exceptionalRun = run(1, 'completed')
    exceptionalRun.result_sections_json = JSON.stringify([
      {
        key: 'image_processing',
        title: '印花产物',
        total: 2,
        completed: 1,
        failed: 1,
        collapsible: true,
        paginated: false,
        items: [],
      },
    ])
    render(
      createElement(PipelineRunHistoryPanel, {
        currentRunId: null,
        loading: false,
        onRefresh: vi.fn(),
        onResume: vi.fn(),
        onView: vi.fn(),
        resumeLoading: false,
        runs: [exceptionalRun],
      }),
    )

    expect(screen.getByText('已完成，有异常')).toBeTruthy()
  })
})
