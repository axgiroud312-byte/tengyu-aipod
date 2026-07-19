import type { AppError, GenerationCapability } from '@tengyu-aipod/shared'
import type { PromptReferenceImage } from '../prompt-generator-service'

export type Txt2imgPromptDraft = {
  id: string
  text: string
  selected: boolean
}

export type GenerationPromptInput = {
  capability?: Extract<GenerationCapability, 'txt2img' | 'img2img' | 'extract'> | undefined
  skillId?: string | undefined
  skillVersion?: string | undefined
  printMode?: 'local' | 'full' | undefined
  requirement: string
  count: number
  model?: string | undefined
  modeInstruction?: string | undefined
  referenceImages?: Array<{ base64: string; mime_type: string }> | undefined
}

export type Txt2imgRunInput = {
  capability?: 'txt2img' | 'img2img' | undefined
  prompts: string[]
  model: string
  aspectRatio: string
  imageSize?: '1K' | '2K' | '4K' | undefined
  referenceImages?: Array<{ base64: string; mime_type: string }> | undefined
  concurrency: number
  taskId?: string | undefined
  outputTaskName?: string | undefined
  filenamePrefix?: string | undefined
  filenameSeparator?: string | undefined
  filenameStartIndex?: number | undefined
  inputIndexes?: number[] | undefined
}

export type ComfyuiInstanceRunInput = {
  instanceUuid?: string | undefined
}

export type ComfyuiTxt2imgRunInput = ComfyuiInstanceRunInput & {
  prompts: string[]
  workflowId: string
  workflowName?: string | undefined
  workflowVersion?: string | undefined
  width?: number | undefined
  height?: number | undefined
  concurrency?: number | undefined
  taskId?: string | undefined
  outputTaskName?: string | undefined
  filenamePrefix?: string | undefined
  filenameSeparator?: string | undefined
  filenameStartIndex?: number | undefined
  inputIndexes?: number[] | undefined
}

export type GenerationProgress = {
  task_id: string
  capability: GenerationCapability
  processed: number
  total: number
  succeeded: number
  failed: number
  current_prompt?: string | undefined
  images?: GenerationRunImage[] | undefined
  status?: 'running' | 'cancelled' | undefined
}

export type GenerationRunImage = {
  prompt: string
  url: string
  localPath?: string | undefined
  sourcePath?: string | undefined
  artifactId?: string | undefined
  printId?: string | undefined
}

export type GenerationRunFailure = {
  prompt: string
  error: string
  sourcePath?: string | undefined
  fatal?: boolean | undefined
  appErrorCode?: AppError['code'] | undefined
  retryable?: boolean | undefined
  errorDetails?: Record<string, unknown> | undefined
}

export type GenerationRunResult = {
  taskId: string
  total: number
  succeeded: number
  failed: number
  images: GenerationRunImage[]
  failures: GenerationRunFailure[]
  cancelled?: boolean | undefined
  diagnosticsLogPath?: string | undefined
}

export type GenerationImageCompletePayload = {
  taskId: string
  capability: GenerationCapability
  path: string
  printId: string
  artifactId?: string | undefined
  prompt?: string | undefined
  sourcePath?: string | undefined
  sourceArtifactIds: string[]
  inputIndex?: number | undefined
  outputIndex?: number | undefined
}

export type GenerationTaskEvent =
  | { ok: true; result: GenerationRunResult }
  | { ok: false; taskId: string; error: string }

export type GenerationDebugLogLevel = 'debug' | 'info' | 'warn' | 'error'

export type GenerationDebugLogDetails = Record<string, string | number | boolean | null | undefined>

export type GenerationDebugLogEntry = {
  id: string
  timestamp: number
  level: GenerationDebugLogLevel
  message: string
  taskId?: string
  capability?: GenerationCapability
  details?: GenerationDebugLogDetails
}

export type GenerationImageSource = {
  id: string
  path: string
  name: string
  relativePath: string
  sizeBytes: number
  modifiedAt: number
  thumbnailUrl: string
}

export type ExtractSourcesResult = {
  folder: string
  images: GenerationImageSource[]
}

export type Img2imgPrintSource = GenerationImageSource & {
  artifactId: string
  printId: string | null
  step: string
}

export type Img2imgSourcesResult = {
  folders: string[]
  images: Img2imgPrintSource[]
}

export type ChooseGenerationImageFolderResult =
  | { ok: true; data: { path: string } }
  | { ok: false; error: { code: string; message: string } }

export type ExtractRunInput = {
  sourceImagePaths: string[]
  skillId: string
  skillVersion?: string | undefined
  variables?: Record<string, unknown> | undefined
  model: string
  aspectRatio: string
  imageSize?: '1K' | '2K' | '4K' | undefined
  concurrency: number
  taskId?: string | undefined
  outputTaskName?: string | undefined
  filenamePrefix?: string | undefined
  filenameSeparator?: string | undefined
  filenameStartIndex?: number | undefined
}

export type ComfyuiImg2imgRunInput = ComfyuiInstanceRunInput & {
  sourceArtifactIds?: string[] | undefined
  sourceImagePaths?: string[] | undefined
  workflowId: string
  workflowName?: string | undefined
  workflowVersion?: string | undefined
  promptMode?: 'ai' | 'workflow' | 'manual' | undefined
  prompt?: string | undefined
  promptSkillId?: string | undefined
  promptSkillVersion?: string | undefined
  promptModel?: string | undefined
  printMode?: 'local' | 'full' | undefined
  modeInstruction?: string | undefined
  requirement?: string | undefined
  width?: number | undefined
  height?: number | undefined
  batchSize?: number | undefined
  taskId?: string | undefined
  outputTaskName?: string | undefined
  filenamePrefix?: string | undefined
  filenameSeparator?: string | undefined
  filenameStartIndex?: number | undefined
  inputIndexes?: number[] | undefined
  outputIndexes?: number[] | undefined
}

export type ComfyuiExtractRunInput = ComfyuiInstanceRunInput & {
  sourceImagePaths: string[]
  workflowId: string
  workflowName?: string | undefined
  workflowVersion?: string | undefined
  skillId?: string | undefined
  skillVersion?: string | undefined
  prompt?: string | undefined
  width?: number | undefined
  height?: number | undefined
  taskId?: string | undefined
  outputTaskName?: string | undefined
  filenamePrefix?: string | undefined
  filenameSeparator?: string | undefined
  filenameStartIndex?: number | undefined
}

export type ComfyuiMattingRunInput = ComfyuiInstanceRunInput & {
  sourceArtifactIds?: string[] | undefined
  sourceImagePaths?: string[] | undefined
  workflowId: string
  workflowName?: string | undefined
  workflowVersion?: string | undefined
  prompt?: string | undefined
  width?: number | undefined
  height?: number | undefined
  taskId?: string | undefined
  outputTaskName?: string | undefined
  filenamePrefix?: string | undefined
  filenameSeparator?: string | undefined
  filenameStartIndex?: number | undefined
}

export type MixedMattingRunInput = Omit<ComfyuiMattingRunInput, 'workflowId'> & {
  workflowId: string
  maskSkillId?: string | undefined
  maskSkillVersion?: string | undefined
  maskModel?: string | undefined
}

export type ComfyuiExtractMattingRunInput = ComfyuiInstanceRunInput & {
  sourceImagePaths: string[]
  extractWorkflowId: string
  extractWorkflowName?: string | undefined
  extractWorkflowVersion?: string | undefined
  mattingWorkflowId: string
  mattingWorkflowName?: string | undefined
  mattingWorkflowVersion?: string | undefined
  skillId?: string | undefined
  skillVersion?: string | undefined
  prompt?: string | undefined
  width?: number | undefined
  height?: number | undefined
  taskId?: string | undefined
  outputTaskName?: string | undefined
  filenamePrefix?: string | undefined
  filenameSeparator?: string | undefined
  filenameStartIndex?: number | undefined
}

export type ChenyuWorkflowMarketListInput = {
  keyword?: string | undefined
  tag?: string | undefined
  sort?: string | undefined
  page?: number | undefined
  page_size?: number | undefined
}

export type ChenyuWorkflowRunInput = {
  capability: GenerationCapability
  workflowId: string
  revisionId?: string | undefined
  inputs?: Record<string, unknown> | undefined
  prompt?: string | undefined
  acceptExternalCostRisk?: boolean | undefined
  taskId?: string | undefined
}

export type Img2imgReferencePayload = {
  artifactId: string
  printId: string
  imagePath: string
  reference: PromptReferenceImage
}
