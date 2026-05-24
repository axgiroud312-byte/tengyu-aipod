import { providerTypes } from '@/lib/providers'
import { z } from 'zod'

export const capabilityOptions = ['txt2img', 'img2img', 'extract', 'matting'] as const

export const providerInputSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  type: z.enum(providerTypes),
  base_url: z.string().url(),
  fallback_url: z.string().url().nullable().optional(),
  api_style: z.string().min(1),
  endpoints_json: z.string().min(2),
  model_options_json: z.string().min(2),
  default_params_json: z.string().min(2),
  capabilities: z.array(z.enum(capabilityOptions)),
  enabled: z.boolean(),
  sort_order: z.number().int(),
  notes: z.string().nullable().optional(),
})

export function nullableText(value: string | null | undefined) {
  return value?.trim() || null
}

export function validateJsonObject(value: string) {
  try {
    const parsed = JSON.parse(value) as unknown
    return Boolean(parsed && typeof parsed === 'object' && !Array.isArray(parsed))
  } catch {
    return false
  }
}

export function validateJsonStringArray(value: string) {
  try {
    const parsed = JSON.parse(value) as unknown
    return Array.isArray(parsed) && parsed.every((item) => typeof item === 'string')
  } catch {
    return false
  }
}
