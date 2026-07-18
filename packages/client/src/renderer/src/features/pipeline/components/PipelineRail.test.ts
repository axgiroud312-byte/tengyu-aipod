// @vitest-environment jsdom

import { cleanup, render, screen, within } from '@testing-library/react'
import { createElement } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { PipelineRailViewModel, RailStage } from '../pipeline-progress-view-model'
import type { PipelineConfigStage } from '../types'
import { PipelineRail } from './PipelineRail'

afterEach(cleanup)

function stage(input: Partial<RailStage> & Pick<RailStage, 'key'>): RailStage {
  return {
    key: input.key,
    label: input.label ?? input.key,
    enabled: input.enabled ?? true,
    issues: input.issues ?? 0,
    counts: input.counts ?? { done: 0, total: 0, failed: 0, blocked: 0 },
    active: input.active ?? false,
    durationMs: input.durationMs ?? null,
    status: input.status ?? 'config',
    ...(input.locked ? { locked: input.locked } : {}),
  }
}

function view(stages: RailStage[], mode: PipelineRailViewModel['mode']): PipelineRailViewModel {
  return {
    mode,
    stages,
    logTail: [],
    summary: { status: '完整任务', warning: null, hasException: false },
  }
}

function renderRail(input: { stages: RailStage[]; mode?: PipelineRailViewModel['mode'] }) {
  render(
    createElement(PipelineRail, {
      view: view(input.stages, input.mode ?? 'config'),
      selectedStage: null,
      onSelectStage: vi.fn<(stage: PipelineConfigStage) => void>(),
    }),
  )
}

describe('PipelineRail', () => {
  it('exposes the fixed complete-task stages as one ordered rail', () => {
    renderRail({
      stages: [
        stage({ key: 'source', label: '任务起点' }),
        stage({ key: 'matting', label: '抠图' }),
        stage({ key: 'detection', label: '侵权检测' }),
        stage({ key: 'photoshop', label: 'PS 套版' }),
        stage({ key: 'title', label: '标题生成' }),
      ],
    })

    const rail = screen.getByRole('list', { name: '完整任务阶段' })
    const stages = within(rail).getAllByRole('listitem')

    expect(stages).toHaveLength(5)
    expect(stages.map((item) => item.textContent)).toEqual([
      expect.stringContaining('任务起点'),
      expect.stringContaining('抠图'),
      expect.stringContaining('侵权检测'),
      expect.stringContaining('PS 套版'),
      expect.stringContaining('标题生成'),
    ])
  })

  it('shows configuration issues and locked reasons on stage nodes', () => {
    renderRail({
      stages: [
        stage({ key: 'source', label: '任务起点', issues: 2 }),
        stage({
          key: 'title',
          label: '标题',
          enabled: false,
          locked: { on: false, reason: '标题生成依赖 PS 套版' },
          status: 'locked',
        }),
      ],
    })

    expect(screen.getByText('待配置 2')).toBeTruthy()
    expect(screen.getByText('标题生成依赖 PS 套版')).toBeTruthy()
  })

  it('shows failed and blocked counts plus finished stage duration', () => {
    renderRail({
      mode: 'done',
      stages: [
        stage({
          key: 'detection',
          label: '侵权检测',
          counts: { done: 4, total: 7, failed: 1, blocked: 2 },
          status: 'completed',
        }),
        stage({
          key: 'photoshop',
          label: 'PS 套版',
          counts: { done: 3, total: 3, failed: 0, blocked: 0 },
          durationMs: 61_000,
          status: 'completed',
        }),
      ],
    })

    expect(screen.getByText('完成 4/7')).toBeTruthy()
    expect(screen.getByText('失败 1')).toBeTruthy()
    expect(screen.getByText('拦截 2')).toBeTruthy()
    expect(screen.getByText('耗时 1分01秒')).toBeTruthy()
    expect(screen.getByText('运行摘要')).toBeTruthy()
  })
})
