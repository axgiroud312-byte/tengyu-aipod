import type { PipelineRunConfig } from '@tengyu-aipod/shared'
import { describe, expect, it } from 'vitest'
import {
  defaultPipelineMattingEnabled,
  plannedPipelineSteps,
  shouldPipelineDetectionAllow,
} from './pipeline-policy'

function baseConfig(source: PipelineRunConfig['source']): PipelineRunConfig {
  return {
    printMode: 'local',
    source,
    matting: {
      enabled: true,
      mode: 'comfyui',
      workflowId: 'matting-wf',
    },
    detection: {
      enabled: true,
      skillId: 'detection',
      model: 'qwen3-vl-flash',
    },
    photoshop: {
      templates: ['C:\\mockups\\shirt.psd'],
      replaceRange: 'auto',
      format: 'jpg',
      clipMode: 'auto',
      skipCompleted: true,
      maxRetries: 1,
    },
    title: {
      platform: 'temu',
      language: 'en',
      model: 'qwen3.6-flash',
      titleFileName: '标题',
      existingStrategy: 'skip',
    },
  }
}

describe('pipeline policy', () => {
  it('defaults matting by print mode', () => {
    expect(defaultPipelineMattingEnabled('local')).toBe(true)
    expect(defaultPipelineMattingEnabled('full')).toBe(false)
  })

  it('allows pass and review detection results but blocks high risk', () => {
    expect(shouldPipelineDetectionAllow('pass')).toBe(true)
    expect(shouldPipelineDetectionAllow('review')).toBe(true)
    expect(shouldPipelineDetectionAllow('block')).toBe(false)
  })

  it('can block review detection results when the pipeline uses strict pass rule', () => {
    expect(shouldPipelineDetectionAllow('pass', false)).toBe(true)
    expect(shouldPipelineDetectionAllow('review', false)).toBe(false)
    expect(shouldPipelineDetectionAllow('block', false)).toBe(false)
  })

  it('plans extraction only for collection sources', () => {
    expect(
      plannedPipelineSteps(
        baseConfig({
          mode: 'collection',
          sourceFolder: 'C:\\work\\01-采集工作区\\temu',
          extract: {
            provider: 'grsai',
            skillId: 'extract',
            grsai: {
              model: 'gpt-image-2',
              aspectRatio: '1024x1024',
            },
          },
        }),
      ),
    ).toEqual(['source', 'extract', 'matting', 'detection', 'photoshop', 'title'])

    expect(
      plannedPipelineSteps(
        baseConfig({
          mode: 'existing_prints',
          printFolder: 'C:\\work\\02-印花工作区\\抠图\\ready',
        }),
      ),
    ).toEqual(['source', 'matting', 'detection', 'photoshop', 'title'])
  })
})
