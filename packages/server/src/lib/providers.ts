import { db } from '@/lib/db'
import type { Provider as PrismaProvider } from '@prisma/client'

export const providerTypes = ['paid-generation', 'vision-llm', 'comfyui-cloud'] as const

export type ProviderType = (typeof providerTypes)[number]

export type ProviderFilter = {
  type?: ProviderType
}

export type ProviderRegistryItem = {
  id: string
  name: string
  type: string
  base_url: string
  fallback_url: string | null
  api_style: string
  endpoints: Record<string, unknown>
  model_options: string[]
  default_params: Record<string, unknown>
  capabilities: string[]
  enabled: boolean
}

function parseJsonObject(value: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value) as unknown
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {}
  } catch {
    return {}
  }
}

function parseStringArray(value: string): string[] {
  try {
    const parsed = JSON.parse(value) as unknown
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
      : []
  } catch {
    return []
  }
}

export function serializeProvider(provider: PrismaProvider): ProviderRegistryItem {
  return {
    id: provider.id,
    name: provider.name,
    type: provider.type,
    base_url: provider.base_url,
    fallback_url: provider.fallback_url,
    api_style: provider.api_style,
    endpoints: parseJsonObject(provider.endpoints_json),
    model_options: parseStringArray(provider.model_options_json),
    default_params: parseJsonObject(provider.default_params_json),
    capabilities: provider.capabilities,
    enabled: provider.enabled,
  }
}

export async function listProviders(filter: ProviderFilter = {}) {
  const providers = await db.provider.findMany({
    where: {
      enabled: true,
      ...(filter.type ? { type: filter.type } : {}),
    },
    orderBy: [{ sort_order: 'asc' }, { id: 'asc' }],
  })

  return providers.map(serializeProvider)
}
