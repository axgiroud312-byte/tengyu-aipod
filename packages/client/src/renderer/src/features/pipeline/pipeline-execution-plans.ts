import { z } from 'zod'
import type { PipelineSourceDraftMap } from './pipeline-source-drafts'

export const EXECUTION_PLAN_STORAGE_KEY = 'tengyu-aipod:pipeline-execution-plans'
export const LAST_USED_EXECUTION_PLAN_STORAGE_KEY =
  'tengyu-aipod:pipeline-execution-plans:last-used'
export const MAX_EXECUTION_PLANS = 5

const providerSchema = z.enum(['grsai', 'comfyui-chenyu'])

const executionPlanConfigSchema = z
  .object({
    sourceMode: z.enum(['collection', 'txt2img', 'img2img', 'existing_prints']),
    existingPrintStartStep: z.enum(['matting', 'detection', 'photoshop']),
    stages: z
      .object({
        matting: z.boolean(),
        detection: z.boolean(),
        photoshop: z.boolean(),
        title: z.boolean(),
      })
      .strict(),
    source: z
      .object({
        extractProvider: providerSchema,
        extractSkillId: z.string(),
        extractWorkflowId: z.string(),
        extractInstanceUuid: z.string(),
        txt2imgProvider: providerSchema,
        txt2imgComfyuiWorkflowId: z.string(),
        txt2imgComfyuiInstanceUuid: z.string(),
        img2imgProvider: providerSchema,
        img2imgComfyuiWorkflowId: z.string(),
        img2imgComfyuiInstanceUuid: z.string(),
        img2imgComfyuiBatchSize: z.string(),
        img2imgComfyuiPromptMode: z.enum(['ai', 'workflow']),
        img2imgReferenceMode: z.enum(['layout', 'style', 'layout-style']),
        sendReferenceToImageModel: z.boolean(),
      })
      .strict(),
    generation: z
      .object({
        promptCount: z.string(),
        promptSkillId: z.string(),
        promptModel: z.string(),
        grsaiModel: z.string(),
        aspectRatio: z.string(),
        grsaiConcurrency: z.string(),
        width: z.string(),
        height: z.string(),
      })
      .strict(),
    matting: z
      .object({
        workflowId: z.string(),
        instanceUuid: z.string(),
      })
      .strict(),
    detection: z
      .object({
        passRule: z.enum(['allow-review', 'pass-only']),
        compression: z.boolean(),
        model: z.string(),
        skillKey: z.string(),
        threshold: z
          .object({
            passMax: z.number(),
            reviewMax: z.number(),
          })
          .strict(),
        variables: z.record(z.unknown()),
      })
      .strict(),
    photoshop: z
      .object({
        templatePaths: z.array(z.string()),
        outputRoot: z.string(),
        skipCompleted: z.boolean(),
        replaceRange: z.enum(['auto', 'topmost', 'top', 'all']),
        smartObjectReplaceMode: z.enum(['replaceContents', 'editSmartObject']),
        smartObjectInnerFitMode: z.enum(['fit', 'fill']),
        clipMode: z.enum(['auto', 'guides', 'none']),
        format: z.enum(['jpg', 'png']),
        maxRetries: z.string(),
      })
      .strict(),
    title: z
      .object({
        platform: z.string(),
        language: z.string(),
        model: z.string(),
        fileName: z.string(),
        imageIndex: z.string(),
        existingStrategy: z.enum(['skip', 'regenerate']),
        maxRetries: z.string(),
        keywordGroupSeparator: z.string(),
        compression: z.boolean(),
        maxSize: z.string(),
      })
      .strict(),
  })
  .strict()

const executionPlanSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().trim().min(1).max(60),
    created_at: z.number().int().nonnegative(),
    config: executionPlanConfigSchema,
  })
  .strict()

const executionPlanDocumentSchema = z
  .object({
    schema_version: z.literal(1),
    plans: z.array(executionPlanSchema).max(MAX_EXECUTION_PLANS),
  })
  .strict()

export type PipelineExecutionPlanConfig = z.infer<typeof executionPlanConfigSchema>
export type PipelineExecutionPlan = z.infer<typeof executionPlanSchema>
export type PipelineExecutionPlanDocument = z.infer<typeof executionPlanDocumentSchema>

export type PipelineExecutionPlanCaptureInput = PipelineExecutionPlanConfig & {
  sourceDrafts: PipelineSourceDraftMap
}

type StorageReader = Pick<Storage, 'getItem'>
type StorageWriter = Pick<Storage, 'getItem' | 'setItem'>

export function captureExecutionPlanConfig(
  input: PipelineExecutionPlanCaptureInput,
): PipelineExecutionPlanConfig {
  return {
    sourceMode: input.sourceMode,
    existingPrintStartStep: input.existingPrintStartStep,
    stages: {
      matting: input.stages.matting,
      detection: input.stages.detection,
      photoshop: input.stages.photoshop,
      title: input.stages.title,
    },
    source: {
      extractProvider: input.source.extractProvider,
      extractSkillId: input.source.extractSkillId,
      extractWorkflowId: input.source.extractWorkflowId,
      extractInstanceUuid: input.source.extractInstanceUuid,
      txt2imgProvider: input.source.txt2imgProvider,
      txt2imgComfyuiWorkflowId: input.source.txt2imgComfyuiWorkflowId,
      txt2imgComfyuiInstanceUuid: input.source.txt2imgComfyuiInstanceUuid,
      img2imgProvider: input.source.img2imgProvider,
      img2imgComfyuiWorkflowId: input.source.img2imgComfyuiWorkflowId,
      img2imgComfyuiInstanceUuid: input.source.img2imgComfyuiInstanceUuid,
      img2imgComfyuiBatchSize: input.source.img2imgComfyuiBatchSize,
      img2imgComfyuiPromptMode: input.source.img2imgComfyuiPromptMode,
      img2imgReferenceMode: input.source.img2imgReferenceMode,
      sendReferenceToImageModel: input.source.sendReferenceToImageModel,
    },
    generation: {
      promptCount: input.generation.promptCount,
      promptSkillId: input.generation.promptSkillId,
      promptModel: input.generation.promptModel,
      grsaiModel: input.generation.grsaiModel,
      aspectRatio: input.generation.aspectRatio,
      grsaiConcurrency: input.generation.grsaiConcurrency,
      width: input.generation.width,
      height: input.generation.height,
    },
    matting: {
      workflowId: input.matting.workflowId,
      instanceUuid: input.matting.instanceUuid,
    },
    detection: {
      passRule: input.detection.passRule,
      compression: input.detection.compression,
      model: input.detection.model,
      skillKey: input.detection.skillKey,
      threshold: { ...input.detection.threshold },
      variables: { ...input.detection.variables },
    },
    photoshop: {
      templatePaths: [...input.photoshop.templatePaths],
      outputRoot: input.photoshop.outputRoot,
      skipCompleted: input.photoshop.skipCompleted,
      replaceRange: input.photoshop.replaceRange,
      smartObjectReplaceMode: input.photoshop.smartObjectReplaceMode,
      smartObjectInnerFitMode: input.photoshop.smartObjectInnerFitMode,
      clipMode: input.photoshop.clipMode,
      format: input.photoshop.format,
      maxRetries: input.photoshop.maxRetries,
    },
    title: {
      platform: input.title.platform,
      language: input.title.language,
      model: input.title.model,
      fileName: input.title.fileName,
      imageIndex: input.title.imageIndex,
      existingStrategy: input.title.existingStrategy,
      maxRetries: input.title.maxRetries,
      keywordGroupSeparator: input.title.keywordGroupSeparator,
      compression: input.title.compression,
      maxSize: input.title.maxSize,
    },
  }
}

export function createExecutionPlan(
  name: string,
  config: PipelineExecutionPlanConfig,
  options: { id?: string; createdAt?: number } = {},
): PipelineExecutionPlan {
  return executionPlanSchema.parse({
    id: options.id ?? crypto.randomUUID(),
    name: name.trim(),
    created_at: options.createdAt ?? Date.now(),
    config,
  })
}

export function readExecutionPlanDocument(
  storage: StorageReader,
): PipelineExecutionPlanDocument | null {
  const raw = storage.getItem(EXECUTION_PLAN_STORAGE_KEY)
  if (!raw) {
    return { schema_version: 1, plans: [] }
  }
  try {
    const parsed = executionPlanDocumentSchema.safeParse(JSON.parse(raw) as unknown)
    return parsed.success ? parsed.data : null
  } catch {
    return null
  }
}

export function saveExecutionPlan(
  storage: StorageWriter,
  plan: PipelineExecutionPlan,
): { ok: true; document: PipelineExecutionPlanDocument } | { ok: false; reason: 'limit' } {
  const current = readExecutionPlanDocument(storage) ?? { schema_version: 1 as const, plans: [] }
  if (current.plans.length >= MAX_EXECUTION_PLANS) {
    return { ok: false, reason: 'limit' }
  }
  const document = executionPlanDocumentSchema.parse({
    schema_version: 1,
    plans: [...current.plans, plan],
  })
  storage.setItem(EXECUTION_PLAN_STORAGE_KEY, JSON.stringify(document))
  return { ok: true, document }
}

export function writeLastUsedExecutionPlanId(storage: Pick<Storage, 'setItem'>, planId: string) {
  storage.setItem(LAST_USED_EXECUTION_PLAN_STORAGE_KEY, planId)
}

export function readLastUsedExecutionPlanId(
  storage: StorageReader,
  plans: PipelineExecutionPlan[],
) {
  const planId = storage.getItem(LAST_USED_EXECUTION_PLAN_STORAGE_KEY)
  return planId && plans.some((plan) => plan.id === planId) ? planId : null
}
