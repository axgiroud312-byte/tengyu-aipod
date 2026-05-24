import { z } from 'zod'

export const workflowCategories = [
  'txt2img',
  'img2img',
  'extract',
  'matting',
  'matting-mixed',
] as const

export const comfyuiWorkflowInputSchema = z.object({
  id: z.string().min(1),
  category: z.enum(workflowCategories),
  version: z.string().min(1),
  workflow_json: z.string().min(2),
  input_slots_json: z.string().min(2),
  output_slots_json: z.string().min(2),
  required_models: z.array(z.string().min(1)),
  recommended_pod_keywords: z.array(z.string().min(1)),
  min_vram_gb: z.number().int().min(1),
  enabled: z.boolean(),
  notes: z.string().nullable().optional(),
})

export const comfyuiWorkflowPatchSchema = comfyuiWorkflowInputSchema.extend({
  save_mode: z.enum(['overwrite', 'new_version']),
})

export function nullableText(value: string | null | undefined) {
  return value?.trim() || null
}

export function validateJsonObject(value: string) {
  try {
    const parsed = JSON.parse(value) as unknown
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
  } catch {
    return false
  }
}

export function validateJsonArray(value: string) {
  try {
    const parsed = JSON.parse(value) as unknown
    return Array.isArray(parsed)
  } catch {
    return false
  }
}
