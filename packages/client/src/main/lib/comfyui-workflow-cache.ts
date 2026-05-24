import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import {
  API_PATHS,
  CACHE_REFRESH_INTERVAL_MINUTES,
  type ComfyuiWorkflow,
  type GenerationCapability,
} from '@tengyu-aipod/shared'
import { app } from 'electron'
import { readAppConfig } from '../onboarding'
import { getSecret } from './keychain'

const SERVER_BASE_URL = process.env.TENGYU_SERVER_URL ?? 'http://localhost:3000'
const REFRESH_INTERVAL_MS = CACHE_REFRESH_INTERVAL_MINUTES * 60 * 1000
const CACHE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000
const INDEX_FILE_NAME = 'index.json'

export type ComfyuiWorkflowSummary = Pick<
  ComfyuiWorkflow,
  'id' | 'version' | 'name' | 'capability' | 'requiredModels'
>

type WorkflowIndexFile = {
  refreshed_at: number
  items: ComfyuiWorkflowSummary[]
}

type ApiResponse<T> = {
  ok: boolean
  data?: T
  error?: { code: string; message?: string }
}

async function workflowCacheDir() {
  const config = await readAppConfig()
  const root = config.workbench_root ?? app.getPath('userData')
  return join(root, '.workbench', 'cache', 'comfyui-workflows')
}

function indexFilePath(root: string) {
  return join(root, INDEX_FILE_NAME)
}

function workflowFilePath(root: string, id: string, version: string) {
  return join(root, id, `${version}.json`)
}

async function readJson<T>(path: string) {
  return JSON.parse(await readFile(path, 'utf8')) as T
}

async function writeJson(path: string, value: unknown) {
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, JSON.stringify(value, null, 2), 'utf8')
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function stringValue(value: unknown, fallback = '') {
  return typeof value === 'string' ? value : fallback
}

function stringArrayValue(value: unknown) {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : []
}

function normalizeCapability(value: unknown): GenerationCapability {
  if (value === 'txt2img' || value === 'img2img' || value === 'extract' || value === 'matting') {
    return value
  }
  return 'img2img'
}

function normalizeSlot(raw: unknown) {
  const record = isRecord(raw) ? raw : {}
  const field = stringValue(record.field)
  return {
    name: stringValue(record.name, stringValue(record.label, field)),
    nodeId: stringValue(record.nodeId, stringValue(record.node_id)),
    field,
  }
}

function normalizeWorkflow(raw: unknown): ComfyuiWorkflow {
  const record = isRecord(raw) ? raw : {}
  return {
    id: stringValue(record.id),
    version: stringValue(record.version),
    name: stringValue(record.name),
    capability: normalizeCapability(record.capability ?? record.category),
    workflowJson: record.workflowJson ?? record.workflow_json,
    inputSlots: Array.isArray(record.inputSlots)
      ? record.inputSlots.map(normalizeSlot)
      : Array.isArray(record.input_slots)
        ? record.input_slots.map(normalizeSlot)
        : [],
    outputSlots: Array.isArray(record.outputSlots)
      ? record.outputSlots.map(normalizeSlot)
      : Array.isArray(record.output_slots)
        ? record.output_slots.map(normalizeSlot)
        : [],
    requiredModels: stringArrayValue(record.requiredModels ?? record.required_models),
  }
}

function normalizeSummary(raw: unknown): ComfyuiWorkflowSummary | null {
  const record = isRecord(raw) ? raw : {}
  if (record.enabled === false) {
    return null
  }

  const id = stringValue(record.id)
  const version = stringValue(record.version)
  const name = stringValue(record.name)
  if (!id || !version || !name) {
    return null
  }

  return {
    id,
    version,
    name,
    capability: normalizeCapability(record.capability ?? record.category),
    requiredModels: stringArrayValue(record.requiredModels ?? record.required_models),
  }
}

function matchesCategory(workflow: ComfyuiWorkflowSummary, category?: GenerationCapability) {
  return !category || workflow.capability === category
}

function ensureCapability(workflow: ComfyuiWorkflow, capability?: GenerationCapability) {
  if (capability && workflow.capability !== capability) {
    throw new Error(
      `workflow capability mismatch: expected ${capability}, got ${workflow.capability}`,
    )
  }
}

function unwrapApiData<T>(raw: unknown): T {
  if (isRecord(raw) && 'ok' in raw) {
    const response = raw as ApiResponse<T>
    if (!response.ok || response.data === undefined) {
      throw new Error(response.error?.code ?? 'COMFYUI_WORKFLOW_REQUEST_FAILED')
    }
    return response.data
  }
  return raw as T
}

export class ComfyuiWorkflowCacheManager {
  private lastRefreshAt = 0

  async listWorkflows(category?: GenerationCapability): Promise<ComfyuiWorkflowSummary[]> {
    if (Date.now() - this.lastRefreshAt > REFRESH_INTERVAL_MS) {
      await this.refresh(category).catch(() => null)
    }

    try {
      const fresh = await this.fetchWorkflowSummaries(category)
      await this.saveIndex(fresh)
      return fresh
    } catch {
      return this.readCachedSummaries(category)
    }
  }

  async get(
    id: string,
    capability?: GenerationCapability,
    version?: string,
  ): Promise<ComfyuiWorkflow> {
    if (version) {
      const cached = await this.readCachedWorkflow(id, version)
      if (cached) {
        ensureCapability(cached, capability)
        return cached
      }
    }

    try {
      const workflow = await this.fetchWorkflow(id, version)
      ensureCapability(workflow, capability)
      await this.saveWorkflow(workflow)
      return workflow
    } catch (error) {
      const cached = version
        ? await this.readCachedWorkflow(id, version)
        : await this.readLatestCachedWorkflow(id)
      if (cached) {
        ensureCapability(cached, capability)
        return cached
      }
      throw error
    }
  }

  async refresh(category?: GenerationCapability) {
    const summaries = await this.fetchWorkflowSummaries(category)
    await this.saveIndex(summaries)
    this.lastRefreshAt = Date.now()
    return summaries
  }

  private async rootDir() {
    return workflowCacheDir()
  }

  private async fetchWorkflowSummaries(category?: GenerationCapability) {
    const searchParams = new URLSearchParams()
    if (category) {
      searchParams.set('category', category)
    }
    const query = searchParams.toString()
    const raw = await this.fetchJson<unknown[]>(
      `${SERVER_BASE_URL}${API_PATHS.comfyuiWorkflows}${query ? `?${query}` : ''}`,
    )
    return raw
      .map(normalizeSummary)
      .filter((workflow): workflow is ComfyuiWorkflowSummary => Boolean(workflow))
      .filter((workflow) => matchesCategory(workflow, category))
  }

  private async fetchWorkflow(id: string, version?: string) {
    const searchParams = new URLSearchParams()
    if (version) {
      searchParams.set('version', version)
    }
    const query = searchParams.toString()
    const raw = await this.fetchJson<unknown>(
      `${SERVER_BASE_URL}${API_PATHS.comfyuiWorkflows}/${encodeURIComponent(id)}/content${
        query ? `?${query}` : ''
      }`,
    )
    return normalizeWorkflow(raw)
  }

  private async fetchJson<T>(url: string) {
    const token = await getSecret('activation_token')
    const response = await fetch(url, {
      headers: token ? { authorization: `Bearer ${token}` } : {},
    })
    if (!response.ok) {
      throw new Error(`comfyui workflow request failed: ${response.status}`)
    }

    return unwrapApiData<T>(await response.json())
  }

  private async saveIndex(items: ComfyuiWorkflowSummary[]) {
    const root = await this.rootDir()
    await writeJson(indexFilePath(root), {
      refreshed_at: Date.now(),
      items,
    } satisfies WorkflowIndexFile)
  }

  private async saveWorkflow(workflow: ComfyuiWorkflow) {
    await writeJson(workflowFilePath(await this.rootDir(), workflow.id, workflow.version), workflow)
  }

  private async readCachedSummaries(category?: GenerationCapability) {
    try {
      const index = await readJson<WorkflowIndexFile>(indexFilePath(await this.rootDir()))
      if (Date.now() - index.refreshed_at > CACHE_MAX_AGE_MS) {
        return []
      }
      return index.items.filter((workflow) => matchesCategory(workflow, category))
    } catch {
      return []
    }
  }

  private async readCachedWorkflow(id: string, version: string) {
    try {
      return normalizeWorkflow(
        await readJson<unknown>(workflowFilePath(await this.rootDir(), id, version)),
      )
    } catch {
      return null
    }
  }

  private async readLatestCachedWorkflow(id: string) {
    try {
      const root = await this.rootDir()
      const files = await readdir(join(root, id))
      const workflows = await Promise.all(
        files
          .filter((file) => file.endsWith('.json'))
          .map((file) => this.readCachedWorkflow(id, file.replace(/\.json$/, ''))),
      )
      return (
        workflows
          .filter((workflow): workflow is ComfyuiWorkflow => Boolean(workflow))
          .sort((left, right) =>
            right.version.localeCompare(left.version, undefined, { numeric: true }),
          )[0] ?? null
      )
    } catch {
      return null
    }
  }
}

export const comfyuiWorkflowCacheManager = new ComfyuiWorkflowCacheManager()
