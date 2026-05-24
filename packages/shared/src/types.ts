export type Brand<TValue, TBrand extends string> = TValue & { readonly __brand: TBrand }

export type SkuCode = Brand<string, 'SkuCode'>
export type PrintId = Brand<string, 'PrintId'>
export type TaskId = Brand<string, 'TaskId'>

export type TaskStatus = 'running' | 'completed' | 'failed' | 'interrupted'
export type StepStatus = 'pending' | 'running' | 'completed' | 'failed' | 'skipped'
export type TaskType = 'lightweight' | 'full'

export type RiskLevel = 'pass' | 'review' | 'block'
export type GenerationCapability = 'txt2img' | 'img2img' | 'extract' | 'matting'

export type ProviderId = 'comfyui-chenyu' | 'grsai' | 'aliyun-bailian'
export type ProviderApiStyle = 'grsai-native' | 'openai-images' | 'openai-chat' | 'dashscope-native'
export type SkillModule = 'generation' | 'detection' | 'title'
export type SkillVariableType = 'select' | 'number' | 'text' | 'textarea' | 'checkbox'

export interface Provider {
  id: ProviderId
  name: string
  apiStyle: ProviderApiStyle
  baseUrl: string
  capabilities: GenerationCapability[]
  modelOptions: string[]
  enabled: boolean
}

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

export interface ActivationCode {
  id: string
  code: string
  customerId?: string
  batchId?: string
  maxDevices: number
  expiresAt?: number
  banned: boolean
  createdAt: number
}

export interface DeviceActivation {
  id: string
  activationCodeId: string
  deviceFingerprint: string
  deviceName?: string
  lastVerifiedAt: number
  createdAt: number
}
