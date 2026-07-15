import { describe, expect, it } from 'vitest'
import { resolvePipelineStagePolicy } from './pipeline-stage-policy'

const enabled = {
  matting: true,
  detection: true,
  photoshop: true,
  title: true,
}

describe('resolvePipelineStagePolicy', () => {
  it('restores the previous title preference after Photoshop is re-enabled', () => {
    const disabled = resolvePipelineStagePolicy({
      sourceMode: 'txt2img',
      existingPrintStartStep: 'photoshop',
      enabled: { ...enabled, photoshop: false },
    })

    expect(disabled.stages.title).toEqual({
      enabled: false,
      locked: { on: false, reason: '标题生成依赖 PS 套版。' },
    })
    expect(disabled.preferences.title).toBe(true)

    const restored = resolvePipelineStagePolicy({
      sourceMode: 'txt2img',
      existingPrintStartStep: 'photoshop',
      enabled: { ...disabled.preferences, photoshop: true },
    })

    expect(restored.stages.title).toEqual({ enabled: true })
  })

  it('keeps Title disabled when that was the previous preference', () => {
    const disabled = resolvePipelineStagePolicy({
      sourceMode: 'txt2img',
      existingPrintStartStep: 'photoshop',
      enabled: { ...enabled, photoshop: false, title: false },
    })
    const restored = resolvePipelineStagePolicy({
      sourceMode: 'txt2img',
      existingPrintStartStep: 'photoshop',
      enabled: { ...disabled.preferences, photoshop: true },
    })

    expect(restored.stages.title).toEqual({ enabled: false })
  })

  it.each([
    ['matting', true, false, false],
    ['detection', false, true, false],
    ['photoshop', false, false, true],
  ] as const)(
    'locks existing prints at %s without enabling an earlier stage',
    (existingPrintStartStep, matting, detection, photoshop) => {
      const policy = resolvePipelineStagePolicy({
        sourceMode: 'existing_prints',
        existingPrintStartStep,
        enabled: { ...enabled, matting: false, detection: false, photoshop: false },
      })

      expect(policy.stages.matting.enabled).toBe(matting)
      expect(policy.stages.detection.enabled).toBe(detection)
      expect(policy.stages.photoshop.enabled).toBe(photoshop)
      expect(policy.preferences).toEqual({
        matting: false,
        detection: false,
        photoshop: false,
        title: true,
      })
    },
  )
})
