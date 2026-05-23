import { z } from 'zod'

export const SkuCodeSchema = z.string().min(1).brand<'SkuCode'>()
export const PrintIdSchema = z
  .string()
  .regex(/^pri_[A-Za-z0-9_-]+$/)
  .brand<'PrintId'>()
export const TaskIdSchema = z.string().min(1).brand<'TaskId'>()

export const TaskStatusSchema = z.enum(['running', 'completed', 'failed', 'interrupted'])
export const StepStatusSchema = z.enum(['pending', 'running', 'completed', 'failed', 'skipped'])
export const TaskTypeSchema = z.enum(['lightweight', 'full'])
export const RiskLevelSchema = z.enum(['pass', 'review', 'block'])
export const GenerationCapabilitySchema = z.enum(['txt2img', 'img2img', 'extract', 'matting'])

export const ProviderIdSchema = z.enum(['comfyui-chenyu', 'grsai', 'aliyun-bailian'])
export const ProviderApiStyleSchema = z.enum([
  'grsai-native',
  'openai-images',
  'openai-chat',
  'dashscope-native',
])

export const ProviderSchema = z.object({
  id: ProviderIdSchema,
  name: z.string().min(1),
  apiStyle: ProviderApiStyleSchema,
  baseUrl: z.string().url(),
  capabilities: z.array(GenerationCapabilitySchema),
  modelOptions: z.array(z.string().min(1)),
  enabled: z.boolean(),
})

export const SkillVariableSchema = z.object({
  name: z.string().min(1),
  label: z.string().min(1),
  required: z.boolean(),
  defaultValue: z.string().optional(),
})

export const SkillSchema = z.object({
  id: z.string().min(1),
  version: z.string().min(1),
  name: z.string().min(1),
  module: z.enum(['generation', 'detection', 'title']),
  systemPrompt: z.string().min(1),
  variables: z.array(SkillVariableSchema),
  recommendedModel: z.string().min(1),
})

export const ComfyuiWorkflowSlotSchema = z.object({
  name: z.string().min(1),
  nodeId: z.string().min(1),
  field: z.string().min(1),
})

export const ComfyuiWorkflowSchema = z.object({
  id: z.string().min(1),
  version: z.string().min(1),
  name: z.string().min(1),
  capability: GenerationCapabilitySchema,
  workflowJson: z.unknown(),
  inputSlots: z.array(ComfyuiWorkflowSlotSchema),
  outputSlots: z.array(ComfyuiWorkflowSlotSchema),
  requiredModels: z.array(z.string().min(1)),
})

export const CustomerSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  phone: z.string().optional(),
  notes: z.string().optional(),
  banned: z.boolean(),
  createdAt: z.number().int(),
})

export const ActivationCodeSchema = z.object({
  id: z.string().min(1),
  code: z.string().min(1),
  customerId: z.string().optional(),
  batchId: z.string().optional(),
  maxDevices: z.number().int().positive(),
  expiresAt: z.number().int().optional(),
  banned: z.boolean(),
  createdAt: z.number().int(),
})

export const DeviceActivationSchema = z.object({
  id: z.string().min(1),
  activationCodeId: z.string().min(1),
  deviceFingerprint: z.string().min(1),
  deviceName: z.string().optional(),
  lastVerifiedAt: z.number().int(),
  createdAt: z.number().int(),
})
