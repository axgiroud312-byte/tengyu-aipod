import { z } from 'zod'

export const skillInputSchema = z.object({
  id: z.string().min(1),
  module: z.enum(['generation', 'detection', 'title']),
  category: z.string().nullable().optional(),
  platform: z.string().nullable().optional(),
  language: z.string().nullable().optional(),
  version: z.string().min(1),
  enabled: z.boolean(),
  system_prompt: z.string().min(1),
  variables_json: z.string().min(2),
  recommended_model: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
})

export const skillPatchSchema = skillInputSchema.extend({
  save_mode: z.enum(['overwrite', 'new_version']),
})

export function nullableText(value: string | null | undefined) {
  return value?.trim() || null
}

export function validateVariablesJson(value: string) {
  try {
    const parsed = JSON.parse(value) as unknown
    return Array.isArray(parsed)
  } catch {
    return false
  }
}
