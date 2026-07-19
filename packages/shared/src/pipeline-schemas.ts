import { z } from 'zod'
import type { PipelineRunConfig } from './types'

const promptConfigSchema = z.object({
  mode: z.enum(['manual', 'ai']),
  prompts: z.array(z.string()).optional(),
  requirement: z.string().optional(),
  count: z.number().optional(),
  modeInstruction: z.string().optional(),
  skillId: z.string().optional(),
  skillVersion: z.string().optional(),
  model: z.string().optional(),
  resolvedPromptsBySourceKey: z.record(z.string()).optional(),
})

const sourceManifestItemSchema = z.object({
  itemKey: z.string().min(1),
  path: z.string().min(1),
})

const comfyuiImg2imgPromptConfigSchema = promptConfigSchema.extend({
  mode: z.enum(['ai', 'workflow']),
})

const grsaiImageSchema = z.object({
  model: z.string(),
  aspectRatio: z.string(),
  imageSize: z.enum(['1K', '2K', '4K']).optional(),
  concurrency: z.number().optional(),
})

const comfyuiWorkflowSchema = z.object({
  workflowId: z.string(),
  workflowName: z.string().optional(),
  workflowVersion: z.string().optional(),
  instanceUuid: z.string().optional(),
  width: z.number().optional(),
  height: z.number().optional(),
  concurrency: z.number().optional(),
})

const comfyuiImg2imgWorkflowSchema = comfyuiWorkflowSchema.extend({
  batchSize: z.number().optional(),
})

const extractSchema = z.object({
  provider: z.enum(['grsai', 'comfyui-chenyu']),
  skillId: z.string().optional(),
  skillVersion: z.string().optional(),
  variables: z.record(z.unknown()).optional(),
  grsai: grsaiImageSchema.optional(),
  comfyui: comfyuiWorkflowSchema.optional(),
})

const referenceImageInputSchema = z.object({
  name: z.string().min(1),
  base64: z.string().min(1),
  mime_type: z.string().min(1),
})

const sourceSchema = z.union([
  z.object({
    mode: z.literal('collection'),
    sourceFolder: z.string(),
    extract: extractSchema,
    sourceManifest: z.array(sourceManifestItemSchema).optional(),
  }),
  z.object({
    mode: z.literal('txt2img'),
    provider: z.literal('grsai'),
    prompt: promptConfigSchema,
    grsai: grsaiImageSchema.optional(),
  }),
  z.object({
    mode: z.literal('txt2img'),
    provider: z.literal('comfyui-chenyu'),
    prompt: promptConfigSchema,
    comfyui: comfyuiWorkflowSchema,
  }),
  z.object({
    mode: z.literal('img2img'),
    provider: z.literal('grsai'),
    sourceFolder: z.string().optional(),
    referenceImages: z.array(referenceImageInputSchema).optional(),
    referenceImagePaths: z.array(z.string()).optional(),
    prompt: promptConfigSchema,
    sendReferenceImages: z.boolean().optional(),
    grsai: grsaiImageSchema.optional(),
  }),
  z.object({
    mode: z.literal('img2img'),
    provider: z.literal('comfyui-chenyu'),
    sourceFolder: z.string(),
    prompt: comfyuiImg2imgPromptConfigSchema.optional(),
    comfyui: comfyuiImg2imgWorkflowSchema,
    sourceManifest: z.array(sourceManifestItemSchema).optional(),
  }),
  z.object({
    mode: z.literal('existing_prints'),
    printFolder: z.string(),
    startStep: z.enum(['matting', 'detection', 'photoshop']).optional(),
    sourceManifest: z.array(sourceManifestItemSchema).optional(),
  }),
])

export const pipelineRunConfigBaseSchema = z.object({
  name: z.string().optional(),
  printSkuCode: z.string().optional(),
  filenameSeparator: z.string().optional(),
  printMode: z.enum(['local', 'full']),
  source: sourceSchema,
  matting: z.object({
    enabled: z.boolean(),
    mode: z.enum(['comfyui', 'mixed']),
    workflowId: z.string().optional(),
    workflowName: z.string().optional(),
    workflowVersion: z.string().optional(),
    instanceUuid: z.string().optional(),
    width: z.number().optional(),
    height: z.number().optional(),
    prompt: z.string().optional(),
    maskSkillId: z.string().optional(),
    maskSkillVersion: z.string().optional(),
    maskModel: z.string().optional(),
  }),
  detection: z.object({
    enabled: z.boolean(),
    allowReview: z.boolean().optional(),
    skillId: z.string().optional(),
    skillVersion: z.string().optional(),
    model: z.string().optional(),
    variables: z.record(z.unknown()).optional(),
    threshold: z
      .object({
        passMax: z.number().optional(),
        reviewMax: z.number().optional(),
      })
      .optional(),
    preprocess: z
      .object({
        compress: z.boolean().optional(),
        maxSize: z.number().optional(),
        format: z.enum(['jpg', 'png']).optional(),
        quality: z.number().optional(),
      })
      .optional(),
    concurrency: z.number().optional(),
    maxRetries: z.number().optional(),
  }),
  photoshop: z.object({
    enabled: z.boolean().optional(),
    templates: z.array(z.string()),
    outputRoot: z.string().optional(),
    replaceRange: z.enum(['auto', 'topmost', 'top', 'all']).optional(),
    smartObjectReplaceMode: z.enum(['replaceContents', 'editSmartObject']).optional(),
    smartObjectInnerFitMode: z.enum(['fit', 'fill']).optional(),
    format: z.enum(['jpg', 'png']).optional(),
    clipMode: z.enum(['none', 'auto', 'guides']).optional(),
    skipCompleted: z.boolean().optional(),
    maxRetries: z.number().optional(),
  }),
  title: z.object({
    enabled: z.boolean().optional(),
    platform: z.string(),
    language: z.string(),
    model: z.string(),
    titleFileName: z.string().optional(),
    imageIndex: z.number().optional(),
    extraRequirement: z.string().optional(),
    keywordGroups: z
      .array(
        z.object({
          prefix: z.string().optional(),
          suffix: z.string().optional(),
        }),
      )
      .optional(),
    keywordGroupSeparator: z.string().optional(),
    existingStrategy: z.enum(['skip', 'regenerate']).optional(),
    maxRetries: z.number().optional(),
    concurrency: z.number().optional(),
    preprocess: z
      .object({
        maxSize: z.number().optional(),
        compression: z.boolean().optional(),
        format: z.enum(['jpg', 'png']).optional(),
        quality: z.number().optional(),
      })
      .optional(),
  }),
})

export function isPipelineRunConfig(value: unknown): value is PipelineRunConfig {
  return pipelineRunConfigBaseSchema.safeParse(value).success
}
