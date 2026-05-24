import { db } from '@/lib/db'
import type { Prisma, ComfyuiWorkflow as PrismaComfyuiWorkflow } from '@prisma/client'
import { compareVersions, nextPatchVersion } from './skills'

export type ComfyuiWorkflowFilter = {
  category?: string
}

export type ComfyuiWorkflowUpsertInput = {
  id: string
  category: string
  version: string
  workflow_json: string
  input_slots_json: string
  output_slots_json: string
  required_models: string[]
  recommended_pod_keywords: string[]
  min_vram_gb: number
  enabled: boolean
  notes: string | null
}

export type ComfyuiWorkflowSummaryItem = {
  id: string
  name: string
  category: string
  version: string
  required_models: string[]
  recommended_pod_keywords: string[]
  min_vram_gb: number
  enabled: boolean
  notes: string | null
  updated_at: string
}

export type ComfyuiWorkflowContentItem = ComfyuiWorkflowSummaryItem & {
  workflow_json: unknown
  input_slots: unknown[]
  output_slots: unknown[]
}

function parseJson(value: string, fallback: unknown) {
  try {
    return JSON.parse(value) as unknown
  } catch {
    return fallback
  }
}

function parseJsonArray(value: string) {
  const parsed = parseJson(value, [])
  return Array.isArray(parsed) ? parsed : []
}

export function latestWorkflowById(workflows: PrismaComfyuiWorkflow[]) {
  const latest = new Map<string, PrismaComfyuiWorkflow>()

  for (const workflow of workflows) {
    const current = latest.get(workflow.id)
    if (
      !current ||
      compareVersions(workflow.version, current.version) > 0 ||
      (compareVersions(workflow.version, current.version) === 0 &&
        workflow.updated_at.getTime() > current.updated_at.getTime())
    ) {
      latest.set(workflow.id, workflow)
    }
  }

  return Array.from(latest.values())
}

export function serializeComfyuiWorkflowSummary(
  workflow: PrismaComfyuiWorkflow,
): ComfyuiWorkflowSummaryItem {
  return {
    id: workflow.id,
    name: workflow.id,
    category: workflow.category,
    version: workflow.version,
    required_models: workflow.required_models,
    recommended_pod_keywords: workflow.recommended_pod_keywords,
    min_vram_gb: workflow.min_vram_gb,
    enabled: workflow.enabled,
    notes: workflow.notes,
    updated_at: workflow.updated_at.toISOString(),
  }
}

export function serializeComfyuiWorkflowContent(
  workflow: PrismaComfyuiWorkflow,
): ComfyuiWorkflowContentItem {
  return {
    ...serializeComfyuiWorkflowSummary(workflow),
    workflow_json: parseJson(workflow.workflow_json, {}),
    input_slots: parseJsonArray(workflow.input_slots_json),
    output_slots: parseJsonArray(workflow.output_slots_json),
  }
}

export async function listComfyuiWorkflows(filter: ComfyuiWorkflowFilter = {}) {
  const workflows = await db.comfyuiWorkflow.findMany({
    where: {
      enabled: true,
      ...(filter.category ? { category: filter.category } : {}),
    },
    orderBy: [{ id: 'asc' }, { updated_at: 'desc' }],
  })

  return latestWorkflowById(workflows).map(serializeComfyuiWorkflowSummary)
}

export async function getComfyuiWorkflowContent(id: string, version?: string) {
  if (version) {
    const workflow = await db.comfyuiWorkflow.findFirst({
      where: {
        id,
        version,
        enabled: true,
      },
    })
    return workflow ? serializeComfyuiWorkflowContent(workflow) : null
  }

  const [latest] = latestWorkflowById(
    await db.comfyuiWorkflow.findMany({
      where: {
        id,
        enabled: true,
      },
      orderBy: [{ updated_at: 'desc' }],
    }),
  )

  return latest ? serializeComfyuiWorkflowContent(latest) : null
}

export async function listAdminComfyuiWorkflows(filter: ComfyuiWorkflowFilter = {}) {
  const workflows = await db.comfyuiWorkflow.findMany({
    where: {
      ...(filter.category ? { category: filter.category } : {}),
    },
    orderBy: [{ id: 'asc' }, { updated_at: 'desc' }],
  })

  return latestWorkflowById(workflows).map(serializeComfyuiWorkflowSummary)
}

export async function listComfyuiWorkflowVersions(id: string) {
  const workflows = await db.comfyuiWorkflow.findMany({
    where: { id },
    orderBy: [{ updated_at: 'desc' }],
  })

  return workflows
    .sort((left, right) => compareVersions(right.version, left.version))
    .map(serializeComfyuiWorkflowSummary)
}

export async function getAdminComfyuiWorkflow(id: string, version?: string) {
  const workflow = version
    ? await db.comfyuiWorkflow.findFirst({ where: { id, version } })
    : latestWorkflowById(
        await db.comfyuiWorkflow.findMany({
          where: { id },
          orderBy: [{ updated_at: 'desc' }],
        }),
      )[0]

  return workflow ? serializeComfyuiWorkflowContent(workflow) : null
}

function createInputData(
  input: ComfyuiWorkflowUpsertInput,
): Prisma.ComfyuiWorkflowUncheckedCreateInput {
  return {
    id: input.id,
    category: input.category,
    version: input.version,
    workflow_json: input.workflow_json,
    input_slots_json: input.input_slots_json,
    output_slots_json: input.output_slots_json,
    required_models: input.required_models,
    recommended_pod_keywords: input.recommended_pod_keywords,
    min_vram_gb: input.min_vram_gb,
    enabled: input.enabled,
    notes: input.notes,
  }
}

export async function createComfyuiWorkflowVersion(input: ComfyuiWorkflowUpsertInput) {
  const existing = await db.comfyuiWorkflow.findUnique({
    where: {
      id_version: {
        id: input.id,
        version: input.version,
      },
    },
  })
  if (existing) {
    return null
  }

  const workflow = await db.comfyuiWorkflow.create({ data: createInputData(input) })
  return serializeComfyuiWorkflowContent(workflow)
}

export async function updateExistingComfyuiWorkflowVersion(
  id: string,
  version: string,
  input: ComfyuiWorkflowUpsertInput,
) {
  const existing = await db.comfyuiWorkflow.findUnique({
    where: {
      id_version: {
        id,
        version,
      },
    },
  })
  if (!existing) {
    return null
  }

  const workflow = await db.comfyuiWorkflow.update({
    where: { row_id: existing.row_id },
    data: {
      category: input.category,
      workflow_json: input.workflow_json,
      input_slots_json: input.input_slots_json,
      output_slots_json: input.output_slots_json,
      required_models: input.required_models,
      recommended_pod_keywords: input.recommended_pod_keywords,
      min_vram_gb: input.min_vram_gb,
      enabled: input.enabled,
      notes: input.notes,
    },
  })

  return serializeComfyuiWorkflowContent(workflow)
}

export async function createNextComfyuiWorkflowVersion(
  id: string,
  baseVersion: string,
  input: Omit<ComfyuiWorkflowUpsertInput, 'id' | 'version'>,
) {
  return createComfyuiWorkflowVersion({
    ...input,
    id,
    version: nextPatchVersion(baseVersion),
  })
}
