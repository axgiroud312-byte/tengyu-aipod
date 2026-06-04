import type { PipelineRunConfig, PipelineStepKey } from '@tengyu-aipod/shared'

export function defaultPipelineMattingEnabled(printMode: PipelineRunConfig['printMode']) {
  return printMode === 'local'
}

export function shouldPipelineDetectionAllow(riskLevel: 'pass' | 'review' | 'block') {
  return riskLevel !== 'block'
}

export function plannedPipelineSteps(config: PipelineRunConfig): PipelineStepKey[] {
  const steps: PipelineStepKey[] = ['source']
  if (config.source.mode === 'collection') {
    steps.push('extract')
  }
  if (config.matting.enabled) {
    steps.push('matting')
  }
  if (config.detection.enabled) {
    steps.push('detection')
  }
  steps.push('photoshop', 'title')
  return steps
}
