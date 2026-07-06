import { AppErrorClass } from '@tengyu-aipod/shared'
import { z } from 'zod'

export const generationCapabilitySchema = z.enum(['txt2img', 'img2img', 'extract', 'matting'])
const promptCapabilitySchema = z.enum(['txt2img', 'img2img', 'extract'])
const txt2imgCapabilitySchema = z.enum(['txt2img', 'img2img'])
const imageSizeSchema = z.enum(['1K', '2K', '4K'])
const referenceImageSchema = z.object({
  base64: z.string().min(1),
  mime_type: z.string().min(1),
})
const stringArraySchema = z.array(z.string())
const optionalStringSchema = z.string().optional()
const positiveNumberSchema = z.number().positive().optional()
const comfyuiImg2imgBatchSizeSchema = z.number().int().min(1).max(8).optional()

export const generationPromptInputSchema = z.object({
  capability: promptCapabilitySchema.optional(),
  skillId: optionalStringSchema,
  skillVersion: optionalStringSchema,
  printMode: z.enum(['local', 'full']).optional(),
  requirement: z.string(),
  count: z.number(),
  model: optionalStringSchema,
  modeInstruction: optionalStringSchema,
  referenceImages: z.array(referenceImageSchema).optional(),
})

export const txt2imgRunInputSchema = z.object({
  capability: txt2imgCapabilitySchema.optional(),
  prompts: stringArraySchema,
  model: z.string(),
  aspectRatio: z.string(),
  imageSize: imageSizeSchema.optional(),
  referenceImages: z.array(referenceImageSchema).optional(),
  concurrency: z.number(),
  taskId: optionalStringSchema,
  filenamePrefix: optionalStringSchema,
  filenameSeparator: optionalStringSchema,
})

export const comfyuiInstanceRunInputSchema = z.object({
  instanceUuid: optionalStringSchema,
})

export const comfyuiTxt2imgRunInputSchema = comfyuiInstanceRunInputSchema.extend({
  prompts: stringArraySchema,
  workflowId: z.string(),
  workflowName: optionalStringSchema,
  workflowVersion: optionalStringSchema,
  width: positiveNumberSchema,
  height: positiveNumberSchema,
  concurrency: positiveNumberSchema,
  taskId: optionalStringSchema,
  filenamePrefix: optionalStringSchema,
  filenameSeparator: optionalStringSchema,
})

export const extractRunInputSchema = z.object({
  sourceImagePaths: stringArraySchema,
  skillId: z.string(),
  skillVersion: optionalStringSchema,
  variables: z.record(z.unknown()).optional(),
  model: z.string(),
  aspectRatio: z.string(),
  imageSize: imageSizeSchema.optional(),
  concurrency: z.number(),
  taskId: optionalStringSchema,
  filenamePrefix: optionalStringSchema,
  filenameSeparator: optionalStringSchema,
})

const comfyuiSourceInputSchema = comfyuiInstanceRunInputSchema.extend({
  sourceArtifactIds: stringArraySchema.optional(),
  sourceImagePaths: stringArraySchema.optional(),
  workflowId: z.string(),
  workflowName: optionalStringSchema,
  workflowVersion: optionalStringSchema,
  promptMode: z.enum(['ai', 'workflow', 'manual']).optional(),
  prompt: optionalStringSchema,
  promptSkillId: optionalStringSchema,
  promptSkillVersion: optionalStringSchema,
  promptModel: optionalStringSchema,
  printMode: z.enum(['local', 'full']).optional(),
  modeInstruction: optionalStringSchema,
  requirement: optionalStringSchema,
  width: positiveNumberSchema,
  height: positiveNumberSchema,
  batchSize: comfyuiImg2imgBatchSizeSchema,
  taskId: optionalStringSchema,
  filenamePrefix: optionalStringSchema,
  filenameSeparator: optionalStringSchema,
})

export const comfyuiImg2imgRunInputSchema = comfyuiSourceInputSchema

export const comfyuiExtractRunInputSchema = comfyuiInstanceRunInputSchema.extend({
  sourceImagePaths: stringArraySchema,
  workflowId: z.string(),
  workflowName: optionalStringSchema,
  workflowVersion: optionalStringSchema,
  skillId: optionalStringSchema,
  skillVersion: optionalStringSchema,
  prompt: optionalStringSchema,
  width: positiveNumberSchema,
  height: positiveNumberSchema,
  taskId: optionalStringSchema,
  filenamePrefix: optionalStringSchema,
  filenameSeparator: optionalStringSchema,
})

export const comfyuiExtractMattingRunInputSchema = comfyuiInstanceRunInputSchema.extend({
  sourceImagePaths: stringArraySchema,
  extractWorkflowId: z.string(),
  extractWorkflowName: optionalStringSchema,
  extractWorkflowVersion: optionalStringSchema,
  mattingWorkflowId: z.string(),
  mattingWorkflowName: optionalStringSchema,
  mattingWorkflowVersion: optionalStringSchema,
  skillId: optionalStringSchema,
  skillVersion: optionalStringSchema,
  prompt: optionalStringSchema,
  width: positiveNumberSchema,
  height: positiveNumberSchema,
  taskId: optionalStringSchema,
  filenamePrefix: optionalStringSchema,
  filenameSeparator: optionalStringSchema,
})

export const mixedMattingRunInputSchema = comfyuiSourceInputSchema.extend({
  maskSkillId: optionalStringSchema,
  maskSkillVersion: optionalStringSchema,
  maskModel: optionalStringSchema,
})

export const comfyuiMattingRunInputSchema = comfyuiSourceInputSchema

export const chenyuWorkflowMarketListInputSchema = z
  .object({
    keyword: optionalStringSchema,
    tag: optionalStringSchema,
    sort: optionalStringSchema,
    page: z.number().optional(),
    page_size: z.number().optional(),
  })
  .optional()

export const chenyuWorkflowRunInputSchema = z.object({
  capability: generationCapabilitySchema,
  workflowId: z.string(),
  revisionId: optionalStringSchema,
  inputs: z.record(z.unknown()).optional(),
  prompt: optionalStringSchema,
  acceptExternalCostRisk: z.boolean().optional(),
  taskId: optionalStringSchema,
})

export const scanGenerationImageFolderInputSchema = z.object({ folder: z.string() })
export const resolveImg2imgReferencesInputSchema = z.object({ artifactIds: stringArraySchema })
export const chenyuWorkflowInfoInputSchema = z.object({ workflowId: z.string() })
export const generationCancelInputSchema = z.object({ task_id: z.string() })
export const manualPromptsTextInputSchema = z.string()

export function parseGenerationIpcInput<T>(
  schema: z.ZodType<T>,
  input: unknown,
  message: string,
): T {
  const parsed = schema.safeParse(input)
  if (!parsed.success) {
    throw new AppErrorClass('INVALID_INPUT', message, false, {
      issues: parsed.error.issues,
    })
  }
  return parsed.data
}
