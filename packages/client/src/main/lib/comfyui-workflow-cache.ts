import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { basename, dirname, extname, join, relative } from 'node:path'
import type { ComfyuiWorkflow, GenerationCapability } from '@tengyu-aipod/shared'
import { app, dialog, ipcMain } from 'electron'
import { readAppConfig } from '../onboarding'

const INDEX_FILE_NAME = 'index.json'

export type ComfyuiWorkflowCategory = GenerationCapability | 'matting-mixed'
export type CachedComfyuiWorkflow = Omit<ComfyuiWorkflow, 'capability'> & {
  capability: ComfyuiWorkflowCategory
}
export type ComfyuiWorkflowSummary = Pick<
  CachedComfyuiWorkflow,
  'id' | 'version' | 'name' | 'capability' | 'requiredModels'
>

export type ImportLocalComfyuiWorkflowInput = {
  name: string
  capability: ComfyuiWorkflowCategory
  workflowJsonText: string
  requiredModels?: string[]
}

export type ImportLocalComfyuiWorkflowDirectoryInput = {
  directoryPath: string
}

export type ImportLocalComfyuiWorkflowDirectoryResult = {
  directoryPath: string
  importedCount: number
  skippedCount: number
  workflows: ComfyuiWorkflowSummary[]
  skipped: Array<{ path: string; reason: string }>
}

export type ChooseLocalComfyuiWorkflowDirectoryResult =
  | { ok: true; data: { path: string } }
  | { ok: false; error: { code: string; message: string } }

type WorkflowIndexFile = {
  updated_at: number
  items: ComfyuiWorkflowSummary[]
}

async function workflowCacheDir() {
  const config = await readAppConfig()
  const root = config.workbench_root ?? app.getPath('userData')
  return join(root, '.workbench', 'local-workflows')
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
    ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    : []
}

function normalizeCapability(value: unknown): ComfyuiWorkflowCategory {
  if (value === 'txt2img' || value === 'img2img' || value === 'extract' || value === 'matting') {
    return value
  }
  if (value === 'matting-mixed') {
    return value
  }
  return 'img2img'
}

const WORKFLOW_CATEGORY_ALIASES: Record<ComfyuiWorkflowCategory, string[]> = {
  txt2img: ['txt2img', 'text2image', 'text-to-image', '文生图', '文字生图', '文本生图', '01文生图'],
  img2img: ['img2img', 'image2image', 'image-to-image', '图生图', '以图生图', '02图生图'],
  extract: ['extract', 'extraction', '提取', '印花提取', '03提取'],
  matting: ['matting', 'cutout', 'removebg', 'rembg', '抠图', '去背景', '透明底', '04抠图'],
  'matting-mixed': ['mattingmixed', 'mixedmatting', '混合抠图', '付费黑白图混合', '付费黑白图'],
}

const NORMALIZED_WORKFLOW_CATEGORY_ALIASES = Object.fromEntries(
  Object.entries(WORKFLOW_CATEGORY_ALIASES).map(([category, aliases]) => [
    category,
    new Set(aliases.map(normalizeCategoryToken)),
  ]),
) as Record<ComfyuiWorkflowCategory, Set<string>>

function normalizeCategoryToken(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[\s._\-()[\]{}【】（）]+/g, '')
}

function capabilityFromPath(root: string, filePath: string): ComfyuiWorkflowCategory | null {
  const relativePath = relative(root, filePath)
  const parts = [basename(root), ...relativePath.split(/[\\/]+/)]
    .map(normalizeCategoryToken)
    .filter(Boolean)
    .reverse()

  for (const part of parts) {
    for (const [category, aliases] of Object.entries(NORMALIZED_WORKFLOW_CATEGORY_ALIASES)) {
      if ([...aliases].some((alias) => part.includes(alias))) {
        return category as ComfyuiWorkflowCategory
      }
    }
  }

  return null
}

function normalizeSlot(raw: unknown) {
  const record = isRecord(raw) ? raw : {}
  const field = stringValue(record.field)
  return {
    name: stringValue(record.name, stringValue(record.label, field)),
    nodeId: stringValue(record.nodeId, stringValue(record.node_id)),
    field,
    ...(typeof record.imageIndex === 'number'
      ? { imageIndex: record.imageIndex }
      : typeof record.image_index === 'number'
        ? { imageIndex: record.image_index }
        : {}),
  }
}

function normalizeWorkflow(raw: unknown): CachedComfyuiWorkflow {
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

function matchesCategory(workflow: ComfyuiWorkflowSummary, category?: ComfyuiWorkflowCategory) {
  return !category || workflow.capability === category
}

function ensureCapability(workflow: CachedComfyuiWorkflow, capability?: ComfyuiWorkflowCategory) {
  if (capability && workflow.capability !== capability) {
    throw new Error(
      `workflow capability mismatch: expected ${capability}, got ${workflow.capability}`,
    )
  }
}

function nodeEntries(workflow: unknown) {
  if (!isRecord(workflow)) {
    return []
  }
  return Object.entries(workflow)
}

function classTypeOf(node: unknown) {
  return isRecord(node) && typeof node.class_type === 'string' ? node.class_type : ''
}

function nodeInputs(node: unknown) {
  return isRecord(node) && isRecord(node.inputs) ? node.inputs : {}
}

function nodeMetaTitle(node: unknown) {
  return isRecord(node) && isRecord(node._meta) ? stringValue(node._meta.title) : ''
}

function looksNegativePrompt(node: unknown) {
  const text = `${nodeMetaTitle(node)} ${stringValue(nodeInputs(node).text)}`.toLowerCase()
  return text.includes('negative') || text.includes('反向') || text.includes('负面')
}

function detectSlots(workflowJson: unknown) {
  const inputSlots = []
  const outputSlots = []
  let foundPromptSlot = false
  let imageSlotCount = 0

  for (const [nodeId, node] of nodeEntries(workflowJson)) {
    const classType = classTypeOf(node)
    const inputs = nodeInputs(node)
    if (/loadimage/i.test(classType)) {
      const imageIndex = imageSlotCount
      inputSlots.push({
        name: `image_${imageIndex + 1}`,
        nodeId,
        field: 'image',
        imageIndex,
      })
      imageSlotCount += 1
    }
    if (
      !foundPromptSlot &&
      /cliptextencode/i.test(classType) &&
      'text' in inputs &&
      !looksNegativePrompt(node)
    ) {
      inputSlots.push({
        name: 'prompt',
        nodeId,
        field: 'text',
      })
      foundPromptSlot = true
    }
    if (hasSizeInputs(classType, inputs)) {
      for (const field of ['width', 'height']) {
        if (field in inputs) {
          inputSlots.push({
            name: field,
            nodeId,
            field,
          })
        }
      }
    }
    if (/save\s*image|saveimage|preview\s*image|previewimage|image\s*save/i.test(classType)) {
      outputSlots.push({
        name: `output_${outputSlots.length + 1}`,
        nodeId,
        field: 'images',
      })
    }
  }

  return { inputSlots, outputSlots }
}

function hasSizeInputs(classType: string, inputs: Record<string, unknown>) {
  if (!('width' in inputs) && !('height' in inputs)) {
    return false
  }
  return /latentimage|scheduler/i.test(classType)
}

function workflowSummary(workflow: CachedComfyuiWorkflow): ComfyuiWorkflowSummary {
  return {
    id: workflow.id,
    version: workflow.version,
    name: workflow.name,
    capability: workflow.capability,
    requiredModels: workflow.requiredModels,
  }
}

function slugFromName(name: string) {
  return (
    name
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 48) || 'workflow'
  )
}

function stableWorkflowId(capability: ComfyuiWorkflowCategory, relativeFilePath: string) {
  const withoutExtension = relativeFilePath.replace(/\.[^.]+$/, '')
  const hash = createHash('sha1')
    .update(`${capability}:${relativeFilePath}`)
    .digest('hex')
    .slice(0, 8)
  return `${slugFromName(`${capability}-${withoutExtension}`)}-${hash}`
}

function workflowNameFromPath(filePath: string) {
  return basename(filePath, extname(filePath)).trim() || '未命名 Workflow'
}

function parseWorkflowJson(text: string) {
  try {
    const parsed = JSON.parse(text) as unknown
    if (!isRecord(parsed)) {
      throw new Error('Workflow JSON 必须是对象')
    }
    return parsed
  } catch (error) {
    if (error instanceof Error) {
      throw new Error(`Workflow JSON 无法解析：${error.message}`)
    }
    throw new Error('Workflow JSON 无法解析')
  }
}

async function workflowJsonFiles(root: string) {
  const result: string[] = []

  async function visit(directoryPath: string) {
    const entries = await readdir(directoryPath, { withFileTypes: true })
    for (const entry of entries) {
      if (entry.name.startsWith('.')) {
        continue
      }
      const entryPath = join(directoryPath, entry.name)
      if (entry.isDirectory()) {
        await visit(entryPath)
        continue
      }
      if (entry.isFile() && extname(entry.name).toLowerCase() === '.json') {
        result.push(entryPath)
      }
    }
  }

  await visit(root)
  return result.sort((left, right) => left.localeCompare(right, 'zh-CN'))
}

async function workflowFromFile(root: string, filePath: string) {
  const capability = capabilityFromPath(root, filePath)
  if (!capability) {
    return {
      workflow: null,
      skipped: { path: filePath, reason: '未识别分类文件夹' },
    }
  }

  try {
    const workflowJson = parseWorkflowJson(await readFile(filePath, 'utf8'))
    const relativeFilePath = relative(root, filePath)
    const slots = detectSlots(workflowJson)
    const workflow: CachedComfyuiWorkflow = {
      id: stableWorkflowId(capability, relativeFilePath),
      name: workflowNameFromPath(filePath),
      version: '1.0.0',
      capability,
      workflowJson,
      inputSlots: slots.inputSlots,
      outputSlots: slots.outputSlots,
      requiredModels: [],
    }
    return { workflow, skipped: null }
  } catch (error) {
    return {
      workflow: null,
      skipped: {
        path: filePath,
        reason: error instanceof Error ? error.message : 'Workflow JSON 无法解析',
      },
    }
  }
}

export class ComfyuiWorkflowCacheManager {
  async listWorkflows(category?: ComfyuiWorkflowCategory): Promise<ComfyuiWorkflowSummary[]> {
    const index = await this.readIndex()
    return index.items.filter((workflow) => matchesCategory(workflow, category))
  }

  async get(
    id: string,
    capability?: ComfyuiWorkflowCategory,
    version?: string,
  ): Promise<CachedComfyuiWorkflow> {
    const workflow = version
      ? await this.readWorkflow(id, version)
      : await this.readLatestWorkflow(id)
    if (!workflow) {
      throw new Error('本地 ComfyUI Workflow 不存在，请先在设置页导入')
    }
    ensureCapability(workflow, capability)
    return workflow
  }

  async refresh(category?: ComfyuiWorkflowCategory) {
    return this.listWorkflows(category)
  }

  async importWorkflow(input: ImportLocalComfyuiWorkflowInput) {
    const workflowJson = parseWorkflowJson(input.workflowJsonText)
    const name = input.name.trim() || '未命名 Workflow'
    const capability = normalizeCapability(input.capability)
    const id = `${slugFromName(name)}-${randomUUID().slice(0, 8)}`
    const version = '1.0.0'
    const slots = detectSlots(workflowJson)
    const workflow: CachedComfyuiWorkflow = {
      id,
      name,
      version,
      capability,
      workflowJson,
      inputSlots: slots.inputSlots,
      outputSlots: slots.outputSlots,
      requiredModels: input.requiredModels ?? [],
    }

    await this.saveWorkflow(workflow)
    const index = await this.readIndex()
    await this.saveIndex([
      ...index.items.filter((item) => item.id !== id),
      workflowSummary(workflow),
    ])
    return workflowSummary(workflow)
  }

  async importWorkflowDirectory(
    input: ImportLocalComfyuiWorkflowDirectoryInput,
  ): Promise<ImportLocalComfyuiWorkflowDirectoryResult> {
    const directoryPath = input.directoryPath.trim()
    if (!directoryPath) {
      throw new Error('请选择 Workflow 文件夹')
    }

    const files = await workflowJsonFiles(directoryPath)
    const imported: CachedComfyuiWorkflow[] = []
    const skipped: Array<{ path: string; reason: string }> = []
    for (const filePath of files) {
      const result = await workflowFromFile(directoryPath, filePath)
      if (result.workflow) {
        imported.push(result.workflow)
      }
      if (result.skipped) {
        skipped.push(result.skipped)
      }
    }
    if (imported.length === 0) {
      throw new Error('未导入任何 Workflow，请确认文件夹里有按分类存放的 .json 工作流')
    }

    const root = await this.rootDir()
    await rm(root, { recursive: true, force: true })
    for (const workflow of imported) {
      await this.saveWorkflow(workflow)
    }
    const summaries = imported.map(workflowSummary)
    await this.saveIndex(summaries)

    return {
      directoryPath,
      importedCount: imported.length,
      skippedCount: skipped.length,
      workflows: summaries.sort((left, right) => left.name.localeCompare(right.name, 'zh-CN')),
      skipped,
    }
  }

  async removeWorkflow(id: string) {
    const root = await this.rootDir()
    await rm(join(root, id), { recursive: true, force: true })
    const index = await this.readIndex()
    await this.saveIndex(index.items.filter((item) => item.id !== id))
    return { ok: true as const }
  }

  private async rootDir() {
    return workflowCacheDir()
  }

  private async readIndex(): Promise<WorkflowIndexFile> {
    try {
      return await readJson<WorkflowIndexFile>(indexFilePath(await this.rootDir()))
    } catch {
      return { updated_at: 0, items: [] }
    }
  }

  private async saveIndex(items: ComfyuiWorkflowSummary[]) {
    await writeJson(indexFilePath(await this.rootDir()), {
      updated_at: Date.now(),
      items: items.sort((left, right) => left.name.localeCompare(right.name, 'zh-CN')),
    } satisfies WorkflowIndexFile)
  }

  private async saveWorkflow(workflow: CachedComfyuiWorkflow) {
    await writeJson(workflowFilePath(await this.rootDir(), workflow.id, workflow.version), workflow)
  }

  private async readWorkflow(id: string, version: string) {
    try {
      return normalizeWorkflow(
        await readJson<unknown>(workflowFilePath(await this.rootDir(), id, version)),
      )
    } catch {
      return null
    }
  }

  private async readLatestWorkflow(id: string) {
    try {
      const files = await readdir(join(await this.rootDir(), id))
      const workflows = await Promise.all(
        files
          .filter((file) => file.endsWith('.json'))
          .map((file) => this.readWorkflow(id, file.replace(/\.json$/, ''))),
      )
      return (
        workflows
          .filter((workflow): workflow is CachedComfyuiWorkflow => Boolean(workflow))
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

export function registerComfyuiWorkflowCacheIpc() {
  ipcMain.handle(
    'workflow:choose-directory',
    async (): Promise<ChooseLocalComfyuiWorkflowDirectoryResult> => {
      const result = await dialog.showOpenDialog({
        properties: ['openDirectory'],
        title: '选择 ComfyUI Workflow 文件夹',
      })
      if (result.canceled || !result.filePaths[0]) {
        return { ok: false, error: { code: 'CANCELLED', message: '已取消选择' } }
      }
      return { ok: true, data: { path: result.filePaths[0] } }
    },
  )
  ipcMain.handle('workflow:list-local', (_event, category?: ComfyuiWorkflowCategory) =>
    comfyuiWorkflowCacheManager.listWorkflows(category),
  )
  ipcMain.handle('workflow:import-local', (_event, input: ImportLocalComfyuiWorkflowInput) =>
    comfyuiWorkflowCacheManager.importWorkflow(input),
  )
  ipcMain.handle(
    'workflow:import-directory',
    (_event, input: ImportLocalComfyuiWorkflowDirectoryInput) =>
      comfyuiWorkflowCacheManager.importWorkflowDirectory(input),
  )
  ipcMain.handle('workflow:remove-local', (_event, input: { id: string }) =>
    comfyuiWorkflowCacheManager.removeWorkflow(input.id),
  )
}
