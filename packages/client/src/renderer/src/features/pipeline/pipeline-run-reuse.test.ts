import type { PipelineRunConfig } from '@tengyu-aipod/shared'
import { describe, expect, it } from 'vitest'
import { createPipelineRunApplication } from './pipeline-run-reuse'
import { createPipelineSourceDrafts } from './pipeline-source-drafts'

describe('createPipelineRunApplication', () => {
  it('keeps stable run settings while clearing current-task variables', () => {
    const drafts = createPipelineSourceDrafts()
    drafts.txt2img = {
      ...drafts.txt2img,
      name: '已完成任务',
      printSkuCode: 'SKU',
      promptRequirement: '本次印花要求',
    }
    const config: PipelineRunConfig = {
      name: '已完成任务',
      printMode: 'local',
      source: {
        mode: 'txt2img',
        provider: 'grsai',
        prompt: { mode: 'ai', count: 4, skillId: 'skill-prompt', skillVersion: '1', model: 'qwen' },
        grsai: { model: 'gpt-image-2', aspectRatio: '1:1', concurrency: 7 },
      },
      matting: { enabled: true, mode: 'comfyui', workflowId: 'wf-mat', instanceUuid: 'machine-1' },
      detection: { enabled: false },
      photoshop: { enabled: false, templates: [] },
      title: {
        enabled: false,
        platform: 'temu',
        language: 'en',
        model: 'qwen-title',
        keywordGroupSeparator: '|',
      },
    }

    const application = createPipelineRunApplication(config, drafts)

    expect(application.sourceMode).toBe('txt2img')
    expect(application.sourceDrafts.txt2img).toMatchObject({
      name: '',
      printSkuCode: '',
      promptRequirement: '',
    })
    expect(application.sessionValues).toMatchObject({
      txt2imgProvider: 'grsai',
      promptCount: '4',
      promptSkillId: 'skill-prompt@@1',
      promptModel: 'qwen',
      grsaiConcurrency: '7',
      mattingEnabled: true,
      mattingWorkflowId: 'wf-mat',
      mattingInstanceUuid: 'machine-1',
      titleKeywordGroupSeparator: '|',
    })
    expect(JSON.parse(JSON.stringify(application))).toEqual(application)
  })
})
