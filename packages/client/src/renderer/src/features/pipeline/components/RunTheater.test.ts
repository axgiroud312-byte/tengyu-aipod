// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react'
import { createElement } from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import { PipelineRunLogTail, PipelineSelectedStageIssues } from './RunTheater'

afterEach(cleanup)

describe('PipelineRunLogTail', () => {
  it('renders recent runtime log messages without needing the full log dialog', () => {
    render(createElement(PipelineRunLogTail, { logs: ['开始检测', '套版完成 3 个货号'] }))

    expect(screen.getByText('最近运行')).toBeTruthy()
    expect(screen.getByText('开始检测')).toBeTruthy()
    expect(screen.getByText('套版完成 3 个货号')).toBeTruthy()
  })
})

describe('PipelineSelectedStageIssues', () => {
  it('shows only the selected stage configuration issues', () => {
    render(
      createElement(PipelineSelectedStageIssues, {
        issues: [
          { stage: 'source', field: 'sourceFolder', message: '请选择采集任务文件夹' },
          { stage: 'photoshop', field: 'templates', message: '请选择 PSD 模板' },
        ],
        selectedStage: 'photoshop',
      }),
    )

    expect(screen.getByText('PS 套版缺少 1 项配置')).toBeTruthy()
    expect(screen.getByText('请选择 PSD 模板')).toBeTruthy()
    expect(screen.queryByText('请选择采集任务文件夹')).toBeNull()
  })
})
