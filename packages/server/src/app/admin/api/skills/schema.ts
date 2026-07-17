import { parsePhpUidAllowlistInput } from '@/lib/targeting'
import { z } from 'zod'

const skillCacheSegmentSchema = z
  .string()
  .trim()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._+-]*$/, '只能包含字母、数字、点、下划线、加号和连字符')

export const skillInputSchema = z.object({
  id: skillCacheSegmentSchema,
  module: z.enum(['generation', 'detection', 'title']),
  category: z.string().nullable().optional(),
  platform: z.string().nullable().optional(),
  language: z.string().nullable().optional(),
  version: skillCacheSegmentSchema,
  enabled: z.boolean(),
  system_prompt: z.string().min(1),
  variables_json: z.string().min(2),
  recommended_model: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
  target_php_uids: z.string().optional(),
  target_scope: z.enum(['all', 'php_uid_list']).default('all'),
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

export function targetPhpUidsJson(scope: 'all' | 'php_uid_list', value: string | undefined) {
  if (scope === 'all') {
    return { ok: true as const, value: '[]' }
  }

  const parsed = parsePhpUidAllowlistInput(value ?? '')
  if (!parsed.ok || parsed.uids.length === 0) {
    return { ok: false as const, value: '[]' }
  }

  return { ok: true as const, value: JSON.stringify(parsed.uids) }
}
