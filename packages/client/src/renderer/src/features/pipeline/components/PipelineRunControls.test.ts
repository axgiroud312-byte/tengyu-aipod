// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { createElement } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PipelineRunControls } from './PipelineRunControls'

afterEach(cleanup)

describe('PipelineRunControls', () => {
  it('renders launch state and routes button clicks to callbacks', () => {
    const onStart = vi.fn()
    const onCancel = vi.fn()
    const onRefresh = vi.fn()
    const onOpenLog = vi.fn()

    render(
      createElement(PipelineRunControls, {
        canStart: true,
        cancelLoading: false,
        currentRunId: null,
        logCount: 3,
        message: '完整任务已启动',
        onCancel,
        onOpenLog,
        onRefresh,
        onStart,
        running: false,
      }),
    )

    expect(screen.getByRole('region', { name: '完整任务操作' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '启动完整任务' }))
    fireEvent.click(screen.getByRole('button', { name: '刷新选项' }))
    fireEvent.click(screen.getByRole('button', { name: '日志 3' }))

    expect(onStart).toHaveBeenCalledTimes(1)
    expect(onRefresh).toHaveBeenCalledTimes(1)
    expect(onOpenLog).toHaveBeenCalledTimes(1)
    expect(onCancel).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: '取消当前完整任务' })).toBeTruthy()
    expect(screen.getByText('完整任务已启动')).toBeTruthy()
  })

  it('keeps launch disabled reason on the start button', () => {
    const onResolveLaunchBlock = vi.fn()
    render(
      createElement(PipelineRunControls, {
        canStart: false,
        cancelLoading: false,
        currentRunId: null,
        launchDisabledReason: '请选择 PSD 模板',
        launchDisabledStageLabel: 'PS 套版',
        logCount: 0,
        message: '等待配置',
        onCancel: vi.fn(),
        onOpenLog: vi.fn(),
        onRefresh: vi.fn(),
        onResolveLaunchBlock,
        onStart: vi.fn(),
        running: false,
      }),
    )

    const startButton = screen.getByRole('button', { name: '启动完整任务' })
    expect((startButton as HTMLButtonElement).disabled).toBe(true)
    expect(startButton.getAttribute('title')).toBe('请选择 PSD 模板')
    expect(screen.getByText('请选择 PSD 模板')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '前往 PS 套版配置' }))
    expect(onResolveLaunchBlock).toHaveBeenCalledTimes(1)
  })
})
