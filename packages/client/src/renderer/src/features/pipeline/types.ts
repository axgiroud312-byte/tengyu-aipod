export type PipelineConfigStage = 'source' | 'matting' | 'detection' | 'photoshop' | 'title'

export type PipelineValidationIssue = {
  stage: PipelineConfigStage
  field: string
  message: string
}

export type PipelineValidationInput = {
  effectivePhotoshopEnabled: boolean
  effectiveMattingEnabled: boolean
  effectiveDetectionEnabled: boolean
  effectiveTitleEnabled: boolean
  isMac: boolean
  printSkuCode: string
  templateCount: number
  sourceMode: 'collection' | 'txt2img' | 'img2img' | 'existing_prints'
  sourceFolder: string
  existingPrintFolder: string
  extractSkillOptionCount: number
  hasSelectedExtractSkill: boolean
  extractProvider: 'grsai' | 'comfyui-chenyu'
  runningInstanceCount: number
  extractWorkflowId: string
  extractInstanceUuid: string
  promptSkillOptionCount: number
  hasSelectedPromptSkill: boolean
  promptModel: string
  promptRequirement: string
  txt2imgProvider: 'grsai' | 'comfyui-chenyu'
  txt2imgComfyuiWorkflowId: string
  txt2imgComfyuiInstanceUuid: string
  img2imgProvider: 'grsai' | 'comfyui-chenyu'
  referenceImageCount: number
  img2imgSourceFolder: string
  img2imgComfyuiWorkflowId: string
  img2imgComfyuiInstanceUuid: string
  img2imgComfyuiPromptMode: 'ai' | 'workflow'
  mattingWorkflowId: string
  mattingInstanceUuid: string
  detectionModel: string
  hasSelectedDetectionSkill: boolean
  titleEnabled: boolean
  titlePlatform: string
  titleLanguage: string
  titleModel: string
}
