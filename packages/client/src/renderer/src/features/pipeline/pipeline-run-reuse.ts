import type { PipelineRunConfig } from '@tengyu-aipod/shared'
import {
  type PipelineExecutionPlanConfig,
  applyExecutionPlanConfig,
} from './pipeline-execution-plans'
import {
  type PipelineSourceDraftMap,
  resetPipelineSourceDraftsForAnotherRun,
} from './pipeline-source-drafts'

const REFERENCE_MODE_BY_INSTRUCTION: Record<string, 'layout' | 'style' | 'layout-style'> = {
  'Use only the layout structure from the reference image. Do not copy subject matter.': 'layout',
  'Use only the art style from the reference image. Create new content.': 'style',
  'Use both layout and art style from the reference image while creating a new motif.':
    'layout-style',
}

function versionedSkillKey(id?: string, version?: string) {
  return id ? `${id}@@${version ?? ''}` : ''
}

function executionPlanConfigFromRun(config: PipelineRunConfig): PipelineExecutionPlanConfig {
  const source = config.source
  const prompt = 'prompt' in source ? source.prompt : undefined
  const grsai =
    source.mode === 'collection'
      ? source.extract.grsai
      : 'provider' in source && source.provider === 'grsai'
        ? source.grsai
        : undefined
  const comfyui =
    source.mode === 'collection'
      ? source.extract.comfyui
      : 'provider' in source && source.provider === 'comfyui-chenyu'
        ? source.comfyui
        : undefined
  const detectionThreshold = config.detection.threshold
  const referenceMode = prompt?.modeInstruction
    ? REFERENCE_MODE_BY_INSTRUCTION[prompt.modeInstruction]
    : undefined

  return {
    sourceMode: source.mode,
    existingPrintStartStep:
      source.mode === 'existing_prints' ? (source.startStep ?? 'photoshop') : 'photoshop',
    stages: {
      matting: config.matting.enabled,
      detection: config.detection.enabled,
      photoshop: Boolean(config.photoshop.enabled),
      title: Boolean(config.title.enabled),
    },
    source: {
      extractProvider: source.mode === 'collection' ? source.extract.provider : 'grsai',
      extractSkillId:
        source.mode === 'collection'
          ? versionedSkillKey(source.extract.skillId, source.extract.skillVersion)
          : '',
      extractWorkflowId:
        source.mode === 'collection' ? (source.extract.comfyui?.workflowId ?? '') : '',
      extractInstanceUuid:
        source.mode === 'collection' ? (source.extract.comfyui?.instanceUuid ?? '') : '',
      txt2imgProvider: source.mode === 'txt2img' ? source.provider : 'grsai',
      txt2imgComfyuiWorkflowId:
        source.mode === 'txt2img' && source.provider === 'comfyui-chenyu'
          ? source.comfyui.workflowId
          : '',
      txt2imgComfyuiInstanceUuid:
        source.mode === 'txt2img' && source.provider === 'comfyui-chenyu'
          ? (source.comfyui.instanceUuid ?? '')
          : '',
      img2imgProvider: source.mode === 'img2img' ? source.provider : 'grsai',
      img2imgComfyuiWorkflowId:
        source.mode === 'img2img' && source.provider === 'comfyui-chenyu'
          ? source.comfyui.workflowId
          : '',
      img2imgComfyuiInstanceUuid:
        source.mode === 'img2img' && source.provider === 'comfyui-chenyu'
          ? (source.comfyui.instanceUuid ?? '')
          : '',
      img2imgComfyuiBatchSize:
        source.mode === 'img2img' && source.provider === 'comfyui-chenyu'
          ? String(source.comfyui.batchSize ?? 1)
          : '1',
      img2imgComfyuiPromptMode:
        source.mode === 'img2img' && source.prompt?.mode === 'workflow' ? 'workflow' : 'ai',
      img2imgReferenceMode: referenceMode ?? 'layout-style',
      sendReferenceToImageModel:
        source.mode === 'img2img' && source.provider === 'grsai'
          ? Boolean(source.sendReferenceImages)
          : false,
    },
    generation: {
      promptCount: String(prompt?.count ?? 1),
      promptSkillId: versionedSkillKey(prompt?.skillId, prompt?.skillVersion),
      promptModel: prompt?.model ?? '',
      grsaiModel: grsai?.model ?? 'gpt-image-2',
      aspectRatio: grsai?.aspectRatio ?? '1024x1024',
      grsaiConcurrency: String(grsai?.concurrency ?? 20),
      width: String(config.matting.width ?? comfyui?.width ?? 1024),
      height: String(config.matting.height ?? comfyui?.height ?? 1024),
    },
    matting: {
      workflowId: config.matting.workflowId ?? '',
      instanceUuid: config.matting.instanceUuid ?? '',
    },
    detection: {
      passRule: config.detection.allowReview === false ? 'pass-only' : 'allow-review',
      compression: config.detection.preprocess?.compress ?? true,
      model: config.detection.model ?? '',
      skillKey: versionedSkillKey(config.detection.skillId, config.detection.skillVersion),
      threshold: {
        passMax: detectionThreshold?.passMax ?? 39,
        reviewMax: detectionThreshold?.reviewMax ?? 69,
      },
      variables: config.detection.variables ?? {},
    },
    photoshop: {
      templatePaths: [...config.photoshop.templates],
      outputRoot: config.photoshop.outputRoot ?? '',
      skipCompleted: config.photoshop.skipCompleted ?? true,
      replaceRange: config.photoshop.replaceRange ?? 'topmost',
      smartObjectReplaceMode: config.photoshop.smartObjectReplaceMode ?? 'replaceContents',
      smartObjectInnerFitMode: config.photoshop.smartObjectInnerFitMode ?? 'fill',
      clipMode: config.photoshop.clipMode ?? 'auto',
      format: config.photoshop.format ?? 'jpg',
      maxRetries: String(config.photoshop.maxRetries ?? 1),
    },
    title: {
      platform: config.title.platform,
      language: config.title.language,
      model: config.title.model,
      fileName: config.title.titleFileName ?? '标题',
      imageIndex: String(config.title.imageIndex ?? 1),
      existingStrategy: config.title.existingStrategy ?? 'skip',
      maxRetries: String(config.title.maxRetries ?? 2),
      keywordGroupSeparator: config.title.keywordGroupSeparator ?? ' ',
      compression: config.title.preprocess?.compression ?? true,
      maxSize: String(config.title.preprocess?.maxSize ?? 1024),
    },
  }
}

export function createPipelineRunApplication(
  config: PipelineRunConfig,
  currentSourceDrafts: PipelineSourceDraftMap,
) {
  const clearedDrafts = resetPipelineSourceDraftsForAnotherRun(currentSourceDrafts)
  return applyExecutionPlanConfig(executionPlanConfigFromRun(config), clearedDrafts)
}
