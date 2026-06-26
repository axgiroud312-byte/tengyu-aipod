import type { PipelineRunConfig, PipelineStepKey } from '@tengyu-aipod/shared'

export function defaultPipelineMattingEnabled(printMode: PipelineRunConfig['printMode']) {
  return printMode === 'local'
}

export function shouldPipelineDetectionAllow(
  riskLevel: 'pass' | 'review' | 'block',
  allowReview = true,
) {
  if (riskLevel === 'pass') {
    return true
  }
  if (riskLevel === 'review') {
    return allowReview
  }
  return false
}

export function plannedPipelineSteps(config: PipelineRunConfig): PipelineStepKey[] {
  const steps: PipelineStepKey[] = ['source']
  if (config.source.mode === 'collection') {
    steps.push('extract')
  }
  const startStep =
    config.source.mode === 'existing_prints' ? (config.source.startStep ?? 'photoshop') : null
  if (config.matting.enabled && (!startStep || startStep === 'matting')) {
    steps.push('matting')
  }
  if (config.detection.enabled && startStep !== 'photoshop') {
    steps.push('detection')
  }
  if (config.photoshop.enabled !== false) {
    steps.push('photoshop')
  }
  if (config.title.enabled !== false && config.photoshop.enabled !== false) {
    steps.push('title')
  }
  return steps
}
