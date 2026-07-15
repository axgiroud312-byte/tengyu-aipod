// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react'
import { createElement } from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import { PipelineRunSummary } from './PipelineRunSummary'

afterEach(cleanup)

describe('PipelineRunSummary', () => {
  it('renders source, stage states, resources, variables, and expected output as text', () => {
    render(
      createElement(PipelineRunSummary, {
        summary: {
          source: { label: '已有印花', detail: 'ready · 从侵权检测开始' },
          stages: [
            { key: 'source', label: '任务起点', state: 'enabled', detail: '已有印花' },
            {
              key: 'matting',
              label: '抠图',
              state: 'locked-skipped',
              detail: '当前起始步骤在该阶段之后，本次锁定跳过',
            },
            {
              key: 'detection',
              label: '侵权检测',
              state: 'locked-enabled',
              detail: '本次起始步骤，锁定执行',
            },
          ],
          resources: [{ label: '检测模型', value: 'qwen-vl-max' }],
          taskVariables: [{ label: '任务名', value: '夏季新品' }],
          expectedOutput: '预计输出侵权检测通过的印花，任务在侵权检测后结束。',
        },
      }),
    )

    expect(screen.getByRole('heading', { name: '本次执行摘要' })).toBeTruthy()
    expect(screen.getByText(/ready · 从侵权检测开始/)).toBeTruthy()
    expect(screen.getByText('锁定跳过')).toBeTruthy()
    expect(screen.getByText('锁定执行')).toBeTruthy()
    expect(screen.getByText('qwen-vl-max')).toBeTruthy()
    expect(screen.getByText('夏季新品')).toBeTruthy()
    expect(screen.getByText('预计输出侵权检测通过的印花，任务在侵权检测后结束。')).toBeTruthy()
  })
})
