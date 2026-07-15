import type { PipelineRunConfig, PipelineSourceMode } from '@tengyu-aipod/shared'
import type { PipelineSourceDraftMap } from './pipeline-source-drafts'

type ImageProvider = 'grsai' | 'comfyui-chenyu'

export type PipelineRunConfigDraft = {
  sourceMode: PipelineSourceMode
  sourceDrafts: PipelineSourceDraftMap
  extractProvider: ImageProvider
  extractSkillKey: string
  extractWorkflowId: string
  extractInstanceUuid: string
  txt2imgProvider: ImageProvider
  txt2imgComfyuiWorkflowId: string
  txt2imgComfyuiInstanceUuid: string
  img2imgProvider: ImageProvider
  img2imgComfyuiWorkflowId: string
  img2imgComfyuiInstanceUuid: string
  img2imgComfyuiBatchSize: string
  img2imgComfyuiPromptMode: 'ai' | 'workflow'
  img2imgModeInstruction?: string | undefined
  promptCount: string
  promptSkillKey: string
  promptModel: string
  grsaiModel: string
  aspectRatio: string
  grsaiConcurrency: string
  width: string
  height: string
  sendReferenceToImageModel: boolean
  matting: {
    enabled: boolean
    workflowId: string
    instanceUuid: string
  }
  detection: NonNullable<PipelineRunConfig['detection']>
  photoshop: {
    enabled: boolean
    templates: string[]
    outputRoot: string
    replaceRange: 'auto' | 'topmost' | 'top' | 'all'
    smartObjectReplaceMode: 'replaceContents' | 'editSmartObject'
    smartObjectInnerFitMode: 'fit' | 'fill'
    format: 'jpg' | 'png'
    clipMode: 'none' | 'auto' | 'guides'
    skipCompleted: boolean
    maxRetries: string
  }
  title: {
    enabled: boolean
    platform: string
    language: string
    model: string
    titleFileName: string
    imageIndex: string
    existingStrategy: 'skip' | 'regenerate'
    maxRetries: string
    extraRequirement: string
    keywordGroups: Array<{ prefix?: string | undefined; suffix?: string | undefined }>
    keywordGroupSeparator: string
    compression: boolean
    maxSize: string
  }
}

function nonEmpty(value: string) {
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function numberFromText(value: string, fallback: number) {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

function parseSkillKey(value: string) {
  const [id, version] = value.split('@@')
  if (!id) {
    return null
  }
  return { id, version: version || undefined }
}

function buildPromptConfig(input: PipelineRunConfigDraft, requirement: string) {
  const skill = parseSkillKey(input.promptSkillKey)
  return {
    mode: 'ai' as const,
    requirement,
    count: numberFromText(input.promptCount, 5),
    model: input.promptModel,
    ...(input.sourceMode === 'img2img' && input.img2imgModeInstruction
      ? { modeInstruction: input.img2imgModeInstruction }
      : {}),
    ...(skill
      ? { skillId: skill.id, ...(skill.version ? { skillVersion: skill.version } : {}) }
      : {}),
  }
}

function buildSourceConfig(input: PipelineRunConfigDraft): PipelineRunConfig['source'] {
  const grsai = {
    model: input.grsaiModel,
    aspectRatio: input.aspectRatio,
    concurrency: numberFromText(input.grsaiConcurrency, 20),
  }

  if (input.sourceMode === 'collection') {
    const draft = input.sourceDrafts.collection
    const skill = parseSkillKey(input.extractSkillKey)
    return {
      mode: 'collection',
      sourceFolder: draft.sourceFolder,
      extract:
        input.extractProvider === 'grsai'
          ? {
              provider: 'grsai',
              ...(skill
                ? { skillId: skill.id, ...(skill.version ? { skillVersion: skill.version } : {}) }
                : {}),
              grsai,
            }
          : {
              provider: 'comfyui-chenyu',
              ...(skill
                ? { skillId: skill.id, ...(skill.version ? { skillVersion: skill.version } : {}) }
                : {}),
              comfyui: {
                workflowId: input.extractWorkflowId,
                instanceUuid: input.extractInstanceUuid,
                width: numberFromText(input.width, 1024),
                height: numberFromText(input.height, 1024),
                concurrency: 1,
              },
            },
    }
  }

  if (input.sourceMode === 'existing_prints') {
    const draft = input.sourceDrafts.existing_prints
    return {
      mode: 'existing_prints',
      printFolder: draft.sourceFolder,
      startStep: draft.startStep,
    }
  }

  if (input.sourceMode === 'txt2img') {
    const draft = input.sourceDrafts.txt2img
    if (input.txt2imgProvider === 'comfyui-chenyu') {
      return {
        mode: 'txt2img',
        provider: 'comfyui-chenyu',
        prompt: buildPromptConfig(input, draft.promptRequirement),
        comfyui: {
          workflowId: input.txt2imgComfyuiWorkflowId,
          instanceUuid: input.txt2imgComfyuiInstanceUuid,
          width: numberFromText(input.width, 1024),
          height: numberFromText(input.height, 1024),
          concurrency: 1,
        },
      }
    }
    return {
      mode: 'txt2img',
      provider: 'grsai',
      prompt: buildPromptConfig(input, draft.promptRequirement),
      grsai,
    }
  }

  const draft = input.sourceDrafts.img2img
  if (input.img2imgProvider === 'comfyui-chenyu') {
    return {
      mode: 'img2img',
      provider: 'comfyui-chenyu',
      sourceFolder: draft.sourceFolder,
      prompt:
        input.img2imgComfyuiPromptMode === 'ai'
          ? buildPromptConfig(input, draft.promptRequirement)
          : { mode: 'workflow' },
      comfyui: {
        workflowId: input.img2imgComfyuiWorkflowId,
        instanceUuid: input.img2imgComfyuiInstanceUuid,
        width: numberFromText(input.width, 1024),
        height: numberFromText(input.height, 1024),
        batchSize: numberFromText(input.img2imgComfyuiBatchSize, 1),
      },
    }
  }
  return {
    mode: 'img2img',
    provider: 'grsai',
    referenceImages: draft.referenceImages.map(({ name, base64, mime_type }) => ({
      name,
      base64,
      mime_type,
    })),
    prompt: buildPromptConfig(input, draft.promptRequirement),
    sendReferenceImages: input.sendReferenceToImageModel,
    grsai,
  }
}

export function buildPipelineRunConfig(input: PipelineRunConfigDraft): PipelineRunConfig {
  const draft = input.sourceDrafts[input.sourceMode]
  return {
    ...(nonEmpty(draft.name) ? { name: draft.name.trim() } : {}),
    ...(nonEmpty(draft.printSkuCode) ? { printSkuCode: draft.printSkuCode.trim() } : {}),
    ...(draft.filenameSeparator !== '-' ? { filenameSeparator: draft.filenameSeparator } : {}),
    printMode: draft.printMode,
    source: buildSourceConfig(input),
    matting: {
      enabled: input.matting.enabled,
      mode: 'comfyui',
      ...(nonEmpty(input.matting.workflowId)
        ? { workflowId: input.matting.workflowId.trim() }
        : {}),
      ...(nonEmpty(input.matting.instanceUuid)
        ? { instanceUuid: input.matting.instanceUuid.trim() }
        : {}),
      width: numberFromText(input.width, 1024),
      height: numberFromText(input.height, 1024),
    },
    detection: input.detection,
    photoshop: {
      enabled: input.photoshop.enabled,
      templates: input.photoshop.templates,
      ...(nonEmpty(input.photoshop.outputRoot)
        ? { outputRoot: input.photoshop.outputRoot.trim() }
        : {}),
      replaceRange: input.photoshop.replaceRange,
      smartObjectReplaceMode: input.photoshop.smartObjectReplaceMode,
      smartObjectInnerFitMode: input.photoshop.smartObjectInnerFitMode,
      format: input.photoshop.format,
      clipMode: input.photoshop.clipMode,
      skipCompleted: input.photoshop.skipCompleted,
      maxRetries: numberFromText(input.photoshop.maxRetries, 1),
    },
    title: {
      enabled: input.title.enabled,
      platform: input.title.platform,
      language: input.title.language,
      model: input.title.model,
      titleFileName: input.title.titleFileName,
      imageIndex: numberFromText(input.title.imageIndex, 1),
      existingStrategy: input.title.existingStrategy,
      maxRetries: numberFromText(input.title.maxRetries, 2),
      ...(nonEmpty(input.title.extraRequirement)
        ? { extraRequirement: input.title.extraRequirement.trim() }
        : {}),
      keywordGroups: input.title.keywordGroups,
      keywordGroupSeparator: input.title.keywordGroupSeparator,
      preprocess: {
        compression: input.title.compression,
        maxSize: numberFromText(input.title.maxSize, 1024),
        format: 'jpg',
        quality: 85,
      },
    },
  }
}
