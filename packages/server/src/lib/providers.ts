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

export type AdminProviderItem = ProviderRegistryItem & {
  endpoints_json: string
  model_options_json: string
  default_params_json: string
  sort_order: number
  notes: string | null
}

export type ProviderUpsertInput = {
  id: string
  name: string
  type: ProviderType
  base_url: string
  fallback_url: string | null
  api_style: string
  endpoints_json: string
  model_options_json: string
  default_params_json: string
  capabilities: string[]
  enabled: boolean
  sort_order: number
  notes: string | null
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

export function serializeAdminProvider(provider: PrismaProvider): AdminProviderItem {
  return {
    ...serializeProvider(provider),
    endpoints_json: provider.endpoints_json,
    model_options_json: provider.model_options_json,
    default_params_json: provider.default_params_json,
    sort_order: provider.sort_order,
    notes: provider.notes,
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

export async function listAdminProviders(filter: ProviderFilter = {}) {
  const providers = await db.provider.findMany({
    where: {
      ...(filter.type ? { type: filter.type } : {}),
    },
    orderBy: [{ sort_order: 'asc' }, { id: 'asc' }],
  })

  return providers.map(serializeAdminProvider)
}

export async function getAdminProvider(id: string) {
  const provider = await db.provider.findUnique({ where: { id } })
  return provider ? serializeAdminProvider(provider) : null
}

export async function createProvider(input: ProviderUpsertInput) {
  const provider = await db.provider.create({
    data: {
      id: input.id,
      name: input.name,
      type: input.type,
      base_url: input.base_url,
      fallback_url: input.fallback_url,
      api_style: input.api_style,
      endpoints_json: input.endpoints_json,
      model_options_json: input.model_options_json,
      default_params_json: input.default_params_json,
      capabilities: input.capabilities,
      enabled: input.enabled,
      sort_order: input.sort_order,
      notes: input.notes,
    },
  })

  return serializeAdminProvider(provider)
}

export async function updateProvider(id: string, input: ProviderUpsertInput) {
  const provider = await db.provider.update({
    where: { id },
    data: {
      name: input.name,
      type: input.type,
      base_url: input.base_url,
      fallback_url: input.fallback_url,
      api_style: input.api_style,
      endpoints_json: input.endpoints_json,
      model_options_json: input.model_options_json,
      default_params_json: input.default_params_json,
      capabilities: input.capabilities,
      enabled: input.enabled,
      sort_order: input.sort_order,
      notes: input.notes,
    },
  })

  return serializeAdminProvider(provider)
}
