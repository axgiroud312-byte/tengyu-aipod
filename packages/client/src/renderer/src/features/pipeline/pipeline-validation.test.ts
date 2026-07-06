import { describe, expect, it } from 'vitest'
import { validatePipelineConfig } from './pipeline-validation'
import type { PipelineValidationInput } from './types'

const baseInput: PipelineValidationInput = {
  effectivePhotoshopEnabled: false,
  effectiveMattingEnabled: false,
  effectiveDetectionEnabled: false,
  effectiveTitleEnabled: false,
  isMac: false,
  printSkuCode: '',
  templateCount: 0,
  sourceMode: 'existing_prints',
  sourceFolder: '',
  existingPrintFolder: 'C:/prints',
  extractSkillOptionCount: 1,
  hasSelectedExtractSkill: true,
  extractProvider: 'grsai',
  runningInstanceCount: 1,
  extractWorkflowId: 'extract',
  extractInstanceUuid: 'instance',
  promptSkillOptionCount: 1,
  hasSelectedPromptSkill: true,
  promptModel: 'qwen',
  promptRequirement: 'make a print',
  txt2imgProvider: 'grsai',
  txt2imgComfyuiWorkflowId: '',
  txt2imgComfyuiInstanceUuid: '',
  img2imgProvider: 'grsai',
  referenceImageCount: 1,
  img2imgSourceFolder: '',
  img2imgComfyuiWorkflowId: '',
  img2imgComfyuiInstanceUuid: '',
  img2imgComfyuiPromptMode: 'ai',
  mattingWorkflowId: 'matting',
  mattingInstanceUuid: 'instance',
  detectionModel: 'qwen',
  hasSelectedDetectionSkill: true,
  titleEnabled: false,
  titlePlatform: 'temu',
  titleLanguage: 'en',
  titleModel: 'qwen',
}

describe('validatePipelineConfig', () => {
  it('marks missing print sku as a photoshop issue', () => {
    expect(
      validatePipelineConfig({
        ...baseInput,
        effectivePhotoshopEnabled: true,
        templateCount: 1,
      }),
    ).toContainEqual({
      stage: 'photoshop',
      field: 'printSkuCode',
      message: '请先填写印花货号',
    })
  })

  it('marks title without photoshop as a title issue', () => {
    expect(validatePipelineConfig({ ...baseInput, titleEnabled: true })).toContainEqual({
      stage: 'title',
      field: 'titleEnabled',
      message: '标题生成需要先启用 PS 套版',
    })
  })

  it('marks collection source fields as source issues', () => {
    expect(
      validatePipelineConfig({
        ...baseInput,
        sourceMode: 'collection',
        sourceFolder: '',
        extractSkillOptionCount: 0,
        hasSelectedExtractSkill: false,
      }),
    ).toEqual(
      expect.arrayContaining([
        { stage: 'source', field: 'sourceFolder', message: '请先选择采集文件夹' },
        {
          stage: 'source',
          field: 'extractSkillOptionCount',
          message: '请先在后台配置提取 Skill',
        },
        { stage: 'source', field: 'extractSkillId', message: '请先选择提取 Skill' },
      ]),
    )
  })

  it('marks matting and detection settings on their stages', () => {
    expect(
      validatePipelineConfig({
        ...baseInput,
        effectiveMattingEnabled: true,
        effectiveDetectionEnabled: true,
        mattingWorkflowId: '',
        detectionModel: '',
        hasSelectedDetectionSkill: false,
      }),
    ).toEqual(
      expect.arrayContaining([
        { stage: 'matting', field: 'mattingWorkflowId', message: '请先选择抠图工作流' },
        { stage: 'detection', field: 'detectionModel', message: '请先选择侵权检测模型' },
        {
          stage: 'detection',
          field: 'detectionSkillKey',
          message: '请先选择侵权检测 Skill',
        },
      ]),
    )
  })
})
