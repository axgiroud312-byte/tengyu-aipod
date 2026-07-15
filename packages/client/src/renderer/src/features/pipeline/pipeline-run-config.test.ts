import { describe, expect, it } from 'vitest'
import { type PipelineRunConfigDraft, buildPipelineRunConfig } from './pipeline-run-config'
import { createPipelineSourceDrafts } from './pipeline-source-drafts'

function configDraft(): PipelineRunConfigDraft {
  const sourceDrafts = createPipelineSourceDrafts()
  return {
    sourceMode: 'collection',
    sourceDrafts,
    extractProvider: 'grsai',
    extractSkillKey: 'extract-skill@@1',
    extractWorkflowId: 'extract-workflow',
    extractInstanceUuid: 'extract-instance',
    txt2imgProvider: 'grsai',
    txt2imgComfyuiWorkflowId: 'txt-workflow',
    txt2imgComfyuiInstanceUuid: 'txt-instance',
    img2imgProvider: 'grsai',
    img2imgComfyuiWorkflowId: 'img-workflow',
    img2imgComfyuiInstanceUuid: 'img-instance',
    img2imgComfyuiBatchSize: '2',
    img2imgComfyuiPromptMode: 'ai',
    img2imgModeInstruction: 'Use layout only.',
    promptCount: '3',
    promptSkillKey: 'prompt-skill@@2',
    promptModel: 'qwen-vision',
    grsaiModel: 'gpt-image-2',
    aspectRatio: '1024x1024',
    grsaiConcurrency: '4',
    width: '1024',
    height: '1024',
    sendReferenceToImageModel: true,
    matting: {
      enabled: false,
      workflowId: '',
      instanceUuid: '',
    },
    detection: {
      enabled: false,
      allowReview: true,
      skillId: 'detection-skill',
      skillVersion: '1',
      model: 'qwen',
      variables: {},
      threshold: { passMax: 39, reviewMax: 69 },
      preprocess: { compress: true, maxSize: 1024, format: 'jpg', quality: 85 },
      concurrency: 20,
      maxRetries: 1,
    },
    photoshop: {
      enabled: false,
      templates: [],
      outputRoot: '',
      replaceRange: 'topmost',
      smartObjectReplaceMode: 'replaceContents',
      smartObjectInnerFitMode: 'fill',
      format: 'jpg',
      clipMode: 'auto',
      skipCompleted: true,
      maxRetries: '1',
    },
    title: {
      enabled: false,
      platform: 'temu',
      language: 'en',
      model: 'qwen',
      titleFileName: '标题',
      imageIndex: '1',
      existingStrategy: 'skip',
      maxRetries: '2',
      extraRequirement: '',
      keywordGroups: [{ prefix: '', suffix: '' }],
      keywordGroupSeparator: ' ',
      compression: true,
      maxSize: '1024',
    },
  }
}

describe('buildPipelineRunConfig', () => {
  it('constructs all four existing source contracts from serializable drafts', () => {
    const base = configDraft()
    const collectionDrafts = {
      ...base.sourceDrafts,
      collection: {
        ...base.sourceDrafts.collection,
        name: 'collection run',
        sourceFolder: 'C:/collection',
      },
    }
    const collectionConfig = buildPipelineRunConfig({ ...base, sourceDrafts: collectionDrafts })
    expect(collectionConfig).toMatchObject({
      name: 'collection run',
      printMode: 'local',
      source: {
        mode: 'collection',
        sourceFolder: 'C:/collection',
        extract: {
          provider: 'grsai',
          skillId: 'extract-skill',
          skillVersion: '1',
          grsai: { model: 'gpt-image-2', aspectRatio: '1024x1024', concurrency: 4 },
        },
      },
    })
    expect(JSON.parse(JSON.stringify(collectionConfig))).toEqual(collectionConfig)

    const txt2imgDrafts = {
      ...base.sourceDrafts,
      txt2img: {
        ...base.sourceDrafts.txt2img,
        promptRequirement: 'draw a flower',
      },
    }
    expect(
      buildPipelineRunConfig({ ...base, sourceMode: 'txt2img', sourceDrafts: txt2imgDrafts })
        .source,
    ).toEqual({
      mode: 'txt2img',
      provider: 'grsai',
      prompt: {
        mode: 'ai',
        requirement: 'draw a flower',
        count: 3,
        model: 'qwen-vision',
        skillId: 'prompt-skill',
        skillVersion: '2',
      },
      grsai: { model: 'gpt-image-2', aspectRatio: '1024x1024', concurrency: 4 },
    })

    const img2imgDrafts = {
      ...base.sourceDrafts,
      img2img: {
        ...base.sourceDrafts.img2img,
        sourceFolder: 'C:/img2img',
        promptRequirement: 'keep the subject',
      },
    }
    expect(
      buildPipelineRunConfig({
        ...base,
        sourceMode: 'img2img',
        sourceDrafts: img2imgDrafts,
        img2imgProvider: 'comfyui-chenyu',
      }).source,
    ).toEqual({
      mode: 'img2img',
      provider: 'comfyui-chenyu',
      sourceFolder: 'C:/img2img',
      prompt: {
        mode: 'ai',
        requirement: 'keep the subject',
        count: 3,
        model: 'qwen-vision',
        modeInstruction: 'Use layout only.',
        skillId: 'prompt-skill',
        skillVersion: '2',
      },
      comfyui: {
        workflowId: 'img-workflow',
        instanceUuid: 'img-instance',
        width: 1024,
        height: 1024,
        batchSize: 2,
      },
    })

    const existingDrafts = {
      ...base.sourceDrafts,
      existing_prints: {
        ...base.sourceDrafts.existing_prints,
        sourceFolder: 'C:/prints',
        startStep: 'detection' as const,
      },
    }
    expect(
      buildPipelineRunConfig({
        ...base,
        sourceMode: 'existing_prints',
        sourceDrafts: existingDrafts,
      }).source,
    ).toEqual({
      mode: 'existing_prints',
      printFolder: 'C:/prints',
      startStep: 'detection',
    })
  })
})
