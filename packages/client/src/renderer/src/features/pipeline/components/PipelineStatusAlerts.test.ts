// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react'
import { createElement } from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import { PipelineStatusAlerts } from './PipelineStatusAlerts'

afterEach(cleanup)

describe('PipelineStatusAlerts', () => {
  it('shows platform and error notices when present', () => {
    render(
      createElement(PipelineStatusAlerts, {
        error: '完整任务启动失败',
        showMacPhotoshopNotice: true,
      }),
    )

    expect(screen.getByText('PS 套版 v1 仅支持 Windows，当前电脑不能启动完整任务。')).toBeTruthy()
    expect(screen.getByText('完整任务启动失败')).toBeTruthy()
  })

  it('renders nothing when there are no notices', () => {
    const { container } = render(
      createElement(PipelineStatusAlerts, {
        error: null,
        showMacPhotoshopNotice: false,
      }),
    )

    expect(container.textContent).toBe('')
  })
})
