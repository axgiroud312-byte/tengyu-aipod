import { describe, expect, it } from 'vitest'
import { isPipelineRunConfig, pipelineRunConfigBaseSchema } from './pipeline-schemas'

const validConfig = {
  printMode: 'local',
  source: {
    mode: 'txt2img',
    provider: 'grsai',
    prompt: { mode: 'ai', requirement: 'fixture prompt', count: 1 },
    grsai: { model: 'gpt-image-2', aspectRatio: '1:1' },
  },
  matting: { enabled: false, mode: 'comfyui' },
  detection: { enabled: false },
  photoshop: { enabled: false, templates: [] },
  title: { enabled: false, platform: 'temu', language: 'en', model: 'qwen3.6-flash' },
}

describe('pipelineRunConfigBaseSchema', () => {
  it('accepts a complete-task config snapshot', () => {
    expect(pipelineRunConfigBaseSchema.safeParse(validConfig).success).toBe(true)
  })

  it('rejects an unknown source discriminator', () => {
    const invalidConfig = {
      ...validConfig,
      source: { ...validConfig.source, mode: 'unknown-source' },
    }

    expect(pipelineRunConfigBaseSchema.safeParse(invalidConfig).success).toBe(false)
    expect(isPipelineRunConfig(invalidConfig)).toBe(false)
  })
})
