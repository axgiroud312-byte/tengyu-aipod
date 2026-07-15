import type { PipelineSourceMode, PipelineStartStep } from '@tengyu-aipod/shared'

export type PipelineStagePreferences = {
  matting: boolean
  detection: boolean
  photoshop: boolean
  title: boolean
}

export type PipelineStagePolicy = {
  enabled: boolean
  locked?: { on: boolean; reason: string }
}

type PipelineStagePolicyInput = {
  sourceMode: PipelineSourceMode
  existingPrintStartStep: PipelineStartStep
  enabled: PipelineStagePreferences
}

export function resolvePipelineStagePolicy(input: PipelineStagePolicyInput): {
  preferences: PipelineStagePreferences
  stages: Record<keyof PipelineStagePreferences, PipelineStagePolicy>
} {
  const preferences = { ...input.enabled }
  const stages: Record<keyof PipelineStagePreferences, PipelineStagePolicy> = {
    matting: { enabled: preferences.matting },
    detection: { enabled: preferences.detection },
    photoshop: { enabled: preferences.photoshop },
    title: { enabled: preferences.title && preferences.photoshop },
  }

  if (input.sourceMode === 'existing_prints') {
    if (input.existingPrintStartStep === 'matting') {
      stages.matting = {
        enabled: true,
        locked: { on: true, reason: '已有印花来源从抠图开始，抠图必须启用。' },
      }
    } else {
      stages.matting = {
        enabled: false,
        locked: { on: false, reason: '当前起始步骤在抠图之后，抠图会跳过。' },
      }
    }

    if (input.existingPrintStartStep === 'detection') {
      stages.detection = {
        enabled: true,
        locked: { on: true, reason: '已有印花来源从侵权检测开始，检测必须启用。' },
      }
    } else if (input.existingPrintStartStep === 'photoshop') {
      stages.detection = {
        enabled: false,
        locked: { on: false, reason: '当前起始步骤在侵权检测之后，检测会跳过。' },
      }
    }

    if (input.existingPrintStartStep === 'photoshop') {
      stages.photoshop = {
        enabled: true,
        locked: { on: true, reason: '已有印花来源从 PS 套版开始，PS 套版必须启用。' },
      }
    }
  }

  stages.title = stages.photoshop.enabled
    ? { enabled: preferences.title }
    : {
        enabled: false,
        locked: { on: false, reason: '标题生成依赖 PS 套版。' },
      }

  return { preferences, stages }
}
