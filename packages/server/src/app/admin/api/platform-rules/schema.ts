import { platformRuleCategories } from '@/lib/platform-rules'
import { z } from 'zod'

export const platformRuleInputSchema = z.object({
  key: z.string().min(1),
  name: z.string().min(1),
  category: z.enum(platformRuleCategories),
  rules_json: z.string().min(2),
  enabled: z.boolean(),
  version: z.string().min(1),
})

export function validateJsonObject(value: string) {
  try {
    const parsed = JSON.parse(value) as unknown
    return Boolean(parsed && typeof parsed === 'object' && !Array.isArray(parsed))
  } catch {
    return false
  }
}
