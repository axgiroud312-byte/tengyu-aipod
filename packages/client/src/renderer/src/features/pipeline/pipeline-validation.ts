import type { PipelineValidationInput, PipelineValidationIssue } from './types'

export function validatePipelineConfig(input: PipelineValidationInput): PipelineValidationIssue[] {
  const issues: PipelineValidationIssue[] = []
  const normalizedPrintSkuCode = input.printSkuCode.trim()

  if (input.effectivePhotoshopEnabled && !normalizedPrintSkuCode) {
    issues.push({
      stage: 'photoshop',
      field: 'printSkuCode',
      message: '请先填写印花货号',
    })
  }
  if (input.effectivePhotoshopEnabled && input.isMac) {
    issues.push({
      stage: 'photoshop',
      field: 'isMac',
      message: 'PS 套版仅支持 Windows，关闭 PS 套版后可在当前电脑运行前置步骤',
    })
  }
  if (input.effectivePhotoshopEnabled && input.templateCount === 0) {
    issues.push({
      stage: 'photoshop',
      field: 'templateCount',
      message: '请先选择 PSD 模板',
    })
  }

  if (input.sourceMode === 'collection') {
    if (!input.sourceFolder.trim()) {
      issues.push({
        stage: 'source',
        field: 'sourceFolder',
        message: '请先选择采集文件夹',
      })
    }
    if (input.extractSkillOptionCount === 0) {
      issues.push({
        stage: 'source',
        field: 'extractSkillOptionCount',
        message: '请先在后台配置提取 Skill',
      })
    }
    if (!input.hasSelectedExtractSkill) {
      issues.push({
        stage: 'source',
        field: 'extractSkillId',
        message: '请先选择提取 Skill',
      })
    }
    if (input.extractProvider === 'comfyui-chenyu') {
      if (input.runningInstanceCount === 0) {
        issues.push({
          stage: 'source',
          field: 'runningInstanceCount',
          message: '请先开机晨羽云机',
        })
      }
      if (!input.extractWorkflowId.trim()) {
        issues.push({
          stage: 'source',
          field: 'extractWorkflowId',
          message: '请先选择晨羽提取工作流',
        })
      }
      if (!input.extractInstanceUuid.trim()) {
        issues.push({
          stage: 'source',
          field: 'extractInstanceUuid',
          message: '请先选择晨羽提取实例',
        })
      }
    }
  }

  if (input.sourceMode === 'existing_prints' && !input.existingPrintFolder.trim()) {
    issues.push({
      stage: 'source',
      field: 'existingPrintFolder',
      message: '请先选择已有印花文件夹',
    })
  }

  if (input.sourceMode === 'txt2img') {
    if (input.promptSkillOptionCount === 0) {
      issues.push({
        stage: 'source',
        field: 'promptSkillOptionCount',
        message: '请先在后台配置提示词 Skill',
      })
    }
    if (!input.hasSelectedPromptSkill) {
      issues.push({
        stage: 'source',
        field: 'promptSkillId',
        message: '请先选择提示词 Skill',
      })
    }
    if (!input.promptModel.trim()) {
      issues.push({
        stage: 'source',
        field: 'promptModel',
        message: '请先选择提示词模型',
      })
    }
    if (!input.promptRequirement.trim()) {
      issues.push({
        stage: 'source',
        field: 'promptRequirement',
        message: '请先填写印花要求',
      })
    }
  }

  if (input.sourceMode === 'txt2img' && input.txt2imgProvider === 'comfyui-chenyu') {
    if (input.runningInstanceCount === 0) {
      issues.push({
        stage: 'source',
        field: 'runningInstanceCount',
        message: '请先开机晨羽云机',
      })
    }
    if (!input.txt2imgComfyuiWorkflowId.trim()) {
      issues.push({
        stage: 'source',
        field: 'txt2imgComfyuiWorkflowId',
        message: '请先选择晨羽文生图工作流',
      })
    }
    if (!input.txt2imgComfyuiInstanceUuid.trim()) {
      issues.push({
        stage: 'source',
        field: 'txt2imgComfyuiInstanceUuid',
        message: '请先选择晨羽文生图实例',
      })
    }
  }

  if (input.sourceMode === 'img2img' && input.img2imgProvider === 'grsai') {
    if (input.referenceImageCount === 0) {
      issues.push({
        stage: 'source',
        field: 'referenceImageCount',
        message: '请先添加至少一张图生图参考图',
      })
    }
    if (input.promptSkillOptionCount === 0) {
      issues.push({
        stage: 'source',
        field: 'promptSkillOptionCount',
        message: '请先在后台配置提示词 Skill',
      })
    }
    if (!input.hasSelectedPromptSkill) {
      issues.push({
        stage: 'source',
        field: 'promptSkillId',
        message: '请先选择提示词 Skill',
      })
    }
    if (!input.promptModel.trim()) {
      issues.push({
        stage: 'source',
        field: 'promptModel',
        message: '请先选择提示词模型',
      })
    }
    if (!input.promptRequirement.trim()) {
      issues.push({
        stage: 'source',
        field: 'promptRequirement',
        message: '请先填写印花要求',
      })
    }
  }

  if (input.sourceMode === 'img2img' && input.img2imgProvider === 'comfyui-chenyu') {
    if (!input.img2imgSourceFolder.trim()) {
      issues.push({
        stage: 'source',
        field: 'img2imgSourceFolder',
        message: '请先选择图生图图片文件夹',
      })
    }
    if (input.runningInstanceCount === 0) {
      issues.push({
        stage: 'source',
        field: 'runningInstanceCount',
        message: '请先开机晨羽云机',
      })
    }
    if (!input.img2imgComfyuiWorkflowId.trim()) {
      issues.push({
        stage: 'source',
        field: 'img2imgComfyuiWorkflowId',
        message: '请先选择晨羽图生图工作流',
      })
    }
    if (!input.img2imgComfyuiInstanceUuid.trim()) {
      issues.push({
        stage: 'source',
        field: 'img2imgComfyuiInstanceUuid',
        message: '请先选择晨羽图生图实例',
      })
    }
    if (input.img2imgComfyuiPromptMode === 'ai') {
      if (input.promptSkillOptionCount === 0) {
        issues.push({
          stage: 'source',
          field: 'promptSkillOptionCount',
          message: '请先在后台配置提示词 Skill',
        })
      }
      if (!input.hasSelectedPromptSkill) {
        issues.push({
          stage: 'source',
          field: 'promptSkillId',
          message: '请先选择提示词 Skill',
        })
      }
      if (!input.promptModel.trim()) {
        issues.push({
          stage: 'source',
          field: 'promptModel',
          message: '请先选择提示词模型',
        })
      }
    }
  }

  if (input.effectiveMattingEnabled) {
    if (input.runningInstanceCount === 0) {
      issues.push({
        stage: 'matting',
        field: 'runningInstanceCount',
        message: '请先开机晨羽云机',
      })
    }
    if (!input.mattingWorkflowId.trim()) {
      issues.push({
        stage: 'matting',
        field: 'mattingWorkflowId',
        message: '请先选择抠图工作流',
      })
    }
    if (!input.mattingInstanceUuid.trim()) {
      issues.push({
        stage: 'matting',
        field: 'mattingInstanceUuid',
        message: '请先选择抠图晨羽实例',
      })
    }
  }

  if (input.effectiveDetectionEnabled) {
    if (!input.detectionModel.trim()) {
      issues.push({
        stage: 'detection',
        field: 'detectionModel',
        message: '请先选择侵权检测模型',
      })
    }
    if (!input.hasSelectedDetectionSkill) {
      issues.push({
        stage: 'detection',
        field: 'detectionSkillKey',
        message: '请先选择侵权检测 Skill',
      })
    }
  }

  if (
    input.effectiveTitleEnabled &&
    (!input.titlePlatform.trim() || !input.titleLanguage.trim() || !input.titleModel.trim())
  ) {
    issues.push({
      stage: 'title',
      field: 'titleSettings',
      message: '请先完成标题设置',
    })
  }

  return issues
}
