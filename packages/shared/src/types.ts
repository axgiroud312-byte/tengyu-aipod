export type Brand<TValue, TBrand extends string> = TValue & { readonly __brand: TBrand }

export type SkuCode = Brand<string, 'SkuCode'>
export type PrintId = Brand<string, 'PrintId'>
export type TaskId = Brand<string, 'TaskId'>

export type TaskStatus = 'running' | 'completed' | 'failed' | 'interrupted'
export type StepStatus = 'pending' | 'running' | 'completed' | 'failed' | 'skipped'
export type TaskType = 'lightweight' | 'full'

export type RiskLevel = 'pass' | 'review' | 'block'
export type GenerationCapability = 'txt2img' | 'img2img' | 'extract' | 'matting'

export type SkillModule = 'generation' | 'detection' | 'title'
export type SkillVariableType = 'select' | 'number' | 'text' | 'textarea' | 'checkbox'

export type PipelineSourceMode = 'collection' | 'txt2img' | 'img2img' | 'existing_prints'
export type PipelineProvider = 'grsai' | 'comfyui-chenyu'
export type PipelinePrintMode = 'local' | 'full'
export type PipelinePromptMode = 'manual' | 'ai'
export type PipelineMattingMode = 'comfyui' | 'mixed'
export type PipelineRunStatus = 'running' | 'completed' | 'failed' | 'cancelled'
export type PipelineStepStatus = 'pending' | 'running' | 'completed' | 'failed' | 'skipped'
export type PipelineStepKey = 'source' | 'extract' | 'matting' | 'detection' | 'photoshop' | 'title'

export interface PipelinePromptConfig {
  mode: PipelinePromptMode
  prompts?: string[]
  requirement?: string
  count?: number
  modeInstruction?: string
  skillId?: string
  skillVersion?: string
  model?: string
}

export interface PipelineComfyuiWorkflowConfig {
  workflowId: string
  workflowName?: string
  workflowVersion?: string
  instanceUuid?: string
  width?: number
  height?: number
  concurrency?: number
}

export interface PipelineGrsaiImageConfig {
  model: string
  aspectRatio: string
  imageSize?: '1K' | '2K' | '4K'
  concurrency?: number
}

export interface PipelineExtractConfig {
  provider: PipelineProvider
  skillId?: string
  skillVersion?: string
  variables?: Record<string, unknown>
  grsai?: PipelineGrsaiImageConfig
  comfyui?: PipelineComfyuiWorkflowConfig
}

export interface PipelineReferenceImageInput {
  name: string
  base64: string
  mime_type: string
}

export type PipelineSourceConfig =
  | {
      mode: 'collection'
      sourceFolder: string
      extract: PipelineExtractConfig
    }
  | {
      mode: 'txt2img'
      provider: 'grsai'
      prompt: PipelinePromptConfig
      grsai?: PipelineGrsaiImageConfig
    }
  | {
      mode: 'img2img'
      provider: 'grsai'
      sourceFolder?: string
      referenceImages?: PipelineReferenceImageInput[]
      referenceImagePaths?: string[]
      prompt: PipelinePromptConfig
      sendReferenceImages?: boolean
      grsai?: PipelineGrsaiImageConfig
    }
  | {
      mode: 'existing_prints'
      printFolder: string
    }

export interface PipelineMattingConfig {
  enabled: boolean
  mode: PipelineMattingMode
  workflowId?: string
  workflowName?: string
  workflowVersion?: string
  instanceUuid?: string
  width?: number
  height?: number
  prompt?: string
  maskSkillId?: string
  maskSkillVersion?: string
  maskModel?: string
}

export interface PipelineDetectionConfig {
  enabled: boolean
  allowReview?: boolean
  skillId?: string
  skillVersion?: string
  model?: string
  variables?: Record<string, unknown>
  threshold?: { passMax?: number; reviewMax?: number }
  preprocess?: {
    compress?: boolean
    maxSize?: number
    format?: 'jpg' | 'png'
    quality?: number
  }
  concurrency?: number
  maxRetries?: number
}

export interface PipelinePhotoshopConfig {
  enabled?: boolean
  templates: string[]
  outputRoot?: string
  replaceRange?: 'auto' | 'top' | 'all'
  format?: 'jpg' | 'png'
  clipMode?: 'none' | 'auto' | 'guides'
  skipCompleted?: boolean
  maxRetries?: number
}

export interface PipelineTitleConfig {
  enabled?: boolean
  platform: string
  language: string
  model: string
  titleFileName?: string
  imageIndex?: number
  extraRequirement?: string
  titlePrefix?: string
  titleSuffix?: string
  titleSeparator?: string
  existingStrategy?: 'skip' | 'regenerate'
  maxRetries?: number
  concurrency?: number
  preprocess?: {
    maxSize?: number
    compression?: boolean
    format?: 'jpg' | 'png'
    quality?: number
  }
}

export interface PipelineRunConfig {
  name?: string
  printSkuCode?: string
  printMode: PipelinePrintMode
  source: PipelineSourceConfig
  matting: PipelineMattingConfig
  detection: PipelineDetectionConfig
  photoshop: PipelinePhotoshopConfig
  title: PipelineTitleConfig
}

export interface PipelineRunStats {
  sourceImages: number
  prints: number
  detectionPass: number
  detectionReview: number
  detectionBlock: number
  photoshopGroups: number
  titleSucceeded: number
  titleFailed: number
}

export interface PipelineStepRecord {
  id: string
  run_id: string
  step_key: PipelineStepKey
  module: string
  label: string
  status: PipelineStepStatus
  input_count: number
  output_count: number
  error_json: string | null
  output_json: string | null
  started_at: number | null
  completed_at: number | null
  updated_at: number
}

export interface PipelineRunRecord {
  id: string
  name: string
  source_mode: PipelineSourceMode
  status: PipelineRunStatus
  config_json: string
  stats_json: string
  error_summary: string | null
  created_at: number
  started_at: number | null
  completed_at: number | null
}

export interface PipelineProgress {
  run_id: string
  status: PipelineRunStatus
  current_step: PipelineStepKey | null
  message: string
  stats: PipelineRunStats
  steps: PipelineStepRecord[]
  preview_images?: PipelinePreviewImage[]
}

export interface PipelinePreviewImage {
  step_key: PipelineStepKey
  prompt: string
  url: string
  local_path?: string
  source_path?: string
  artifact_id?: string
  print_id?: string
}

export interface PipelineRunDetail {
  run: PipelineRunRecord
  steps: PipelineStepRecord[]
}

export type PipelineTaskEvent =
  | { ok: true; result: PipelineRunDetail }
  | { ok: false; run_id: string; error: string }

export interface SkillVariable {
  key: string
  label: string
  type: SkillVariableType
  options?: Array<{ value: string; label: string }>
  default?: unknown
  min?: number
  max?: number
  required?: boolean
  placeholder?: string
  help?: string
}

export interface SkillSummary {
  id: string
  module: SkillModule
  category: string | null
  platform: string | null
  language: string | null
  version: string
  enabled: boolean
  recommendedModel: string | null
  notes?: string | null
}

export interface Skill extends SkillSummary {
  systemPrompt: string
  variables: SkillVariable[]
}

export interface ComfyuiWorkflowSlot {
  name: string
  nodeId: string
  field: string
  imageIndex?: number
}

export interface ComfyuiWorkflow {
  id: string
  version: string
  name: string
  capability: GenerationCapability
  workflowJson: unknown
  inputSlots: ComfyuiWorkflowSlot[]
  outputSlots: ComfyuiWorkflowSlot[]
  requiredModels: string[]
}

export interface Customer {
  id: string
  name: string
  phone?: string
  notes?: string
  banned: boolean
  createdAt: number
}
