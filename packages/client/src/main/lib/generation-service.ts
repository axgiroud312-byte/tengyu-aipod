import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { basename, extname, isAbsolute, join, relative } from 'node:path'
import { pathToFileURL } from 'node:url'
import {
  AppErrorClass,
  type GenerationCapability,
  type Skill,
  WORKBENCH_DIRECTORIES,
} from '@tengyu-aipod/shared'
import Database from 'better-sqlite3'
import { BrowserWindow, ipcMain } from 'electron'
import { readAppConfig } from '../onboarding'
import { ChenyuCloudClient } from './chenyu-cloud-client'
import { ComfyHttpClient } from './comfy-http-client'
import { ComfyuiChenyuAdapter } from './comfyui-chenyu-adapter'
import { ComfyuiInstanceManager } from './comfyui-instance-manager'
import { type ComfyuiWorkflowSummary, comfyuiWorkflowCacheManager } from './comfyui-workflow-cache'
import { GenerationConcurrencyController } from './generation-concurrency'
import {
  GRSAI_SUPPORTED_MODELS,
  type GenerateRequest,
  GrsaiAdapter,
  type GrsaiModel,
} from './grsai-adapter'
import { getSecret } from './keychain'
import {
  type PromptReferenceImage,
  parsePrompts,
  promptGeneratorService,
} from './prompt-generator-service'
import { skillCacheManager } from './skill-cache'
import { type TempFileManager, tempFileManager } from './temp-file-manager'

export type Txt2imgPromptDraft = {
  id: string
  text: string
  selected: boolean
}

export type GenerationPromptInput = {
  capability?: Extract<GenerationCapability, 'txt2img' | 'img2img' | 'extract'>
  skillId?: string
  skillVersion?: string
  printMode?: 'local' | 'full'
  requirement: string
  count: number
  model?: string
  modeInstruction?: string
  referenceImages?: Array<{ base64: string; mime_type: string }>
}

export type Txt2imgRunInput = {
  capability?: 'txt2img' | 'img2img'
  prompts: string[]
  model: string
  aspectRatio: string
  imageSize: '1K' | '2K' | '4K'
  concurrency: number
}

export type GenerationProgress = {
  task_id: string
  capability: GenerationCapability
  processed: number
  total: number
  succeeded: number
  failed: number
  current_prompt?: string
}

export type GenerationRunResult = {
  taskId: string
  total: number
  succeeded: number
  failed: number
  images: Array<{
    prompt: string
    url: string
    localPath?: string
    sourcePath?: string
    artifactId?: string
    printId?: string
  }>
  failures: Array<{ prompt: string; error: string; sourcePath?: string }>
}

export type GenerationTaskEvent =
  | { ok: true; result: GenerationRunResult }
  | { ok: false; taskId: string; error: string }

export type GenerationImageSource = {
  id: string
  path: string
  name: string
  relativePath: string
  sizeBytes: number
  modifiedAt: number
  thumbnailUrl: string
}

export type ExtractSourcesResult = {
  folder: string
  images: GenerationImageSource[]
}

export type Img2imgPrintSource = GenerationImageSource & {
  artifactId: string
  printId: string | null
  step: string
}

export type Img2imgSourcesResult = {
  folders: string[]
  images: Img2imgPrintSource[]
}

export type ExtractRunInput = {
  sourceImagePaths: string[]
  skillId: string
  skillVersion?: string
  variables?: Record<string, unknown>
  promptCount: number
  llmModel?: string
  model: string
  aspectRatio: string
  imageSize: '1K' | '2K' | '4K'
  concurrency: number
  taskId?: string
}

export type ComfyuiImg2imgRunInput = {
  sourceArtifactIds: string[]
  workflowId: string
  workflowVersion?: string
  prompt: string
  taskId?: string
}

export type ComfyuiExtractRunInput = {
  sourceImagePaths: string[]
  workflowId: string
  workflowVersion?: string
  prompt?: string
  taskId?: string
}

export type ComfyuiMattingRunInput = {
  sourceArtifactIds: string[]
  workflowId: string
  workflowVersion?: string
  prompt?: string
  taskId?: string
}

export type MixedMattingRunInput = Omit<ComfyuiMattingRunInput, 'workflowId'> & {
  workflowId: string
  maskSkillId: string
  maskSkillVersion?: string
  maskModel: string
}

type GenerationDatabase = Pick<Database.Database, 'exec' | 'prepare' | 'close'>
type Img2imgReference = {
  artifactId: string
  printId: string
  imagePath: string
  reference: PromptReferenceImage
}

type GenerationServiceDependencies = {
  readConfig?: typeof readAppConfig
  getSecret?: typeof getSecret
  openDatabase?: (workbenchRoot: string) => GenerationDatabase
  skillCache?: Pick<typeof skillCacheManager, 'getSkill'>
  workflowCache?: Pick<typeof comfyuiWorkflowCacheManager, 'listWorkflows' | 'get'>
  promptGenerator?: Pick<typeof promptGeneratorService, 'generatePrompts'>
  createGrsaiAdapter?: (apiKey: string) => Pick<GrsaiAdapter, 'generate'>
  createComfyuiAdapter?: (input: {
    apiKey: string
    workbenchRoot: string
  }) => Pick<ComfyuiChenyuAdapter, 'generate'>
  downloadImage?: (url: string) => Promise<Buffer>
  emitProgress?: (progress: GenerationProgress) => void
  tempFiles?: Pick<TempFileManager, 'createTaskDir' | 'cleanupTask'>
}

const DEFAULT_GENERATION_MODEL: GrsaiModel = 'nano-banana-2'
const IMAGE_EXTENSIONS = /\.(?:jpe?g|png|webp)$/i
const nodeRequire = createRequire(import.meta.url)

function clampInt(value: number, min: number, max: number, fallback: number) {
  if (!Number.isFinite(value)) {
    return fallback
  }
  return Math.max(min, Math.min(max, Math.floor(value)))
}

function naturalCompare(left: string, right: string) {
  return left.localeCompare(right, 'zh-CN', { numeric: true, sensitivity: 'base' })
}

function normalizeModel(model: string) {
  return GRSAI_SUPPORTED_MODELS.includes(model as GrsaiModel) ? model : DEFAULT_GENERATION_MODEL
}

function workbenchDbPath(workbenchRoot: string) {
  return join(workbenchRoot, WORKBENCH_DIRECTORIES.metadata, 'workbench.db')
}

function openWorkbenchDatabase(workbenchRoot: string) {
  try {
    return new Database(workbenchDbPath(workbenchRoot))
  } catch (error) {
    return openNodeSqliteDatabase(workbenchDbPath(workbenchRoot), error)
  }
}

function openNodeSqliteDatabase(path: string, betterSqliteError: unknown): GenerationDatabase {
  try {
    const { DatabaseSync } = nodeRequire('node:sqlite') as typeof import('node:sqlite')
    return new DatabaseSync(path) as unknown as GenerationDatabase
  } catch (error) {
    throw betterSqliteError instanceof Error ? betterSqliteError : error
  }
}

function ensureGenerationTables(db: Pick<Database.Database, 'exec'>) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS artifacts (
      id TEXT PRIMARY KEY,
      task_id TEXT,
      sku_code TEXT,
      print_id TEXT,
      step TEXT NOT NULL,
      provider TEXT,
      model_or_workflow TEXT,
      skill_id TEXT,
      skill_version TEXT,
      source_artifact_ids TEXT,
      file_path TEXT NOT NULL,
      file_size INTEGER,
      file_hash TEXT,
      prompt_snapshot TEXT,
      params_snapshot TEXT,
      created_at INTEGER NOT NULL
    );
  `)
}

async function readWorkbenchRoot(readConfig: typeof readAppConfig = readAppConfig) {
  const workbenchConfig = await readConfig()
  if (!workbenchConfig.workbench_root) {
    throw new AppErrorClass('HTTP_4XX', '请先设置素材总目录', false)
  }
  return workbenchConfig.workbench_root
}

function fileUrl(path: string) {
  return pathToFileURL(path).toString()
}

async function hashFile(path: string) {
  const buffer = await readFile(path)
  return createHash('sha256').update(buffer).digest('hex')
}

async function imageIdentity(imagePath: string) {
  const [fileHash, info] = await Promise.all([hashFile(imagePath), stat(imagePath)])
  const shortHash = fileHash.slice(0, 16)
  return {
    artifactId: `art_${shortHash}`,
    printId: `pri_${shortHash}`,
    fileHash,
    fileSize: info.size,
  }
}

async function imageReference(imagePath: string): Promise<PromptReferenceImage> {
  const buffer = await readFile(imagePath)
  return {
    base64: buffer.toString('base64'),
    mime_type: mimeTypeFromPath(imagePath),
  }
}

function mimeTypeFromPath(path: string) {
  const ext = extname(path).toLowerCase()
  if (ext === '.jpg' || ext === '.jpeg') {
    return 'image/jpeg'
  }
  if (ext === '.webp') {
    return 'image/webp'
  }
  return 'image/png'
}

function safeBaseName(value: string) {
  return (value || 'print').replace(/[\\/:*?"<>|]/g, '_')
}

function newPrintId() {
  return `pri_${randomUUID().replace(/-/g, '').slice(0, 12)}`
}

async function uniqueTargetPath(folder: string, baseName: string, ext: string) {
  let index = 0
  while (true) {
    const suffix = index === 0 ? '' : `_v${index + 1}`
    const candidate = join(folder, `${safeBaseName(baseName)}${suffix}${ext}`)
    try {
      await stat(candidate)
      index += 1
    } catch {
      return candidate
    }
  }
}

async function scanImageFolderRecursive(root: string): Promise<GenerationImageSource[]> {
  const images: GenerationImageSource[] = []

  async function visit(folder: string) {
    const entries = await readdir(folder, { withFileTypes: true }).catch(() => [])
    for (const entry of entries.sort((left, right) => naturalCompare(left.name, right.name))) {
      const entryPath = join(folder, entry.name)
      if (entry.isDirectory()) {
        await visit(entryPath)
        continue
      }
      if (!entry.isFile() || !IMAGE_EXTENSIONS.test(entry.name)) {
        continue
      }
      const info = await stat(entryPath)
      const relativePath = relative(root, entryPath)
      images.push({
        id: createHash('sha256').update(entryPath).digest('hex').slice(0, 16),
        path: entryPath,
        name: entry.name,
        relativePath,
        sizeBytes: info.size,
        modifiedAt: info.mtimeMs,
        thumbnailUrl: fileUrl(entryPath),
      })
    }
  }

  await visit(root)
  return images.sort((left, right) => naturalCompare(left.relativePath, right.relativePath))
}

function assertInsideFolder(path: string, folder: string) {
  if (!isAbsolute(path)) {
    throw new AppErrorClass('HTTP_4XX', '源图路径必须是绝对路径', false)
  }
  const rel = relative(folder, path)
  if (rel.startsWith('..') || isAbsolute(rel)) {
    throw new AppErrorClass('HTTP_4XX', '提取只能选择 01-采集 目录下的源图', false, {
      path,
    })
  }
}

function assertNotInsideFolder(path: string, folder: string) {
  if (!isAbsolute(path)) {
    throw new AppErrorClass('HTTP_4XX', '印花路径必须是绝对路径', false)
  }
  const rel = relative(folder, path)
  if (!rel.startsWith('..') && !isAbsolute(rel)) {
    throw new AppErrorClass('HTTP_4XX', '图生图不能直接选择 01-采集 原图，请先提取成印花', false, {
      path,
    })
  }
}

function rowString(row: Record<string, unknown>, key: string) {
  const value = row[key]
  return typeof value === 'string' ? value : ''
}

function readImg2imgArtifactRows(db: Pick<Database.Database, 'prepare'>) {
  return db
    .prepare(`
      SELECT id, print_id, step, file_path
      FROM artifacts
      WHERE step IN ('txt2img', 'img2img', 'extract', 'manual-import')
      ORDER BY created_at DESC
    `)
    .all() as Array<Record<string, unknown>>
}

function registerPrintSourceArtifact(
  db: Pick<Database.Database, 'exec' | 'prepare'>,
  input: {
    identity: Awaited<ReturnType<typeof imageIdentity>>
    imagePath: string
    step: Extract<GenerationCapability, 'txt2img' | 'img2img' | 'extract'>
    taskId: string
    createdAt: number
  },
) {
  ensureGenerationTables(db)
  db.prepare(`
    INSERT INTO artifacts (
      id,
      task_id,
      print_id,
      step,
      provider,
      source_artifact_ids,
      file_path,
      file_size,
      file_hash,
      created_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      file_path = excluded.file_path,
      file_size = excluded.file_size,
      file_hash = excluded.file_hash
  `).run(
    input.identity.artifactId,
    input.taskId,
    input.identity.printId,
    input.step,
    'manual-import',
    '[]',
    input.imagePath,
    input.identity.fileSize,
    input.identity.fileHash,
    input.createdAt,
  )
}

async function ensureFolderPrintArtifacts(
  db: Pick<Database.Database, 'exec' | 'prepare'>,
  folders: Array<{
    path: string
    step: Extract<GenerationCapability, 'txt2img' | 'img2img' | 'extract'>
  }>,
  existingRows: Array<Record<string, unknown>>,
) {
  const registeredPaths = new Set(existingRows.map((row) => rowString(row, 'file_path')))
  for (const folder of folders) {
    const images = await scanImageFolderRecursive(folder.path)
    for (const image of images) {
      if (registeredPaths.has(image.path)) {
        continue
      }
      const identity = await imageIdentity(image.path)
      registerPrintSourceArtifact(db, {
        identity,
        imagePath: image.path,
        step: folder.step,
        taskId: 'img2img-source-scan',
        createdAt: Date.now(),
      })
      registeredPaths.add(image.path)
    }
  }
}

async function sourceFromArtifactRow(
  workbenchRoot: string,
  row: Record<string, unknown>,
): Promise<Img2imgPrintSource | null> {
  const imagePath = rowString(row, 'file_path')
  if (!imagePath || !IMAGE_EXTENSIONS.test(imagePath)) {
    return null
  }

  try {
    const info = await stat(imagePath)
    const workbenchRelativePath = relative(workbenchRoot, imagePath)
    const relativePath =
      workbenchRelativePath.startsWith('..') || isAbsolute(workbenchRelativePath)
        ? imagePath
        : workbenchRelativePath
    return {
      id: rowString(row, 'id'),
      artifactId: rowString(row, 'id'),
      printId: rowString(row, 'print_id') || null,
      step: rowString(row, 'step'),
      path: imagePath,
      name: basename(imagePath),
      relativePath,
      sizeBytes: info.size,
      modifiedAt: info.mtimeMs,
      thumbnailUrl: fileUrl(imagePath),
    }
  } catch {
    return null
  }
}

async function readReferenceForArtifact(
  db: Pick<Database.Database, 'prepare'>,
  workbenchRoot: string,
  collectionFolder: string,
  artifactId: string,
): Promise<Img2imgReference> {
  const row = db
    .prepare('SELECT id, print_id, file_path, step FROM artifacts WHERE id = ?')
    .get(artifactId) as Record<string, unknown> | undefined
  if (!row) {
    throw new AppErrorClass('HTTP_4XX', '选择的印花不存在', false, { artifactId })
  }

  const rowArtifactId = rowString(row, 'id')
  const imagePath = rowString(row, 'file_path')
  const step = rowString(row, 'step')
  if (!['txt2img', 'img2img', 'extract', 'manual-import'].includes(step)) {
    throw new AppErrorClass('HTTP_4XX', '图生图只能选择已生成或导入的印花', false, {
      artifactId,
      step,
    })
  }
  assertNotInsideFolder(imagePath, collectionFolder)
  const rel = relative(workbenchRoot, imagePath)
  if (rel.startsWith('..') || isAbsolute(rel)) {
    // 外部导入允许不在工作台内，但路径必须来自 artifacts 表。
  }
  return {
    artifactId: rowArtifactId,
    imagePath,
    reference: await imageReference(imagePath),
    printId: rowString(row, 'print_id') || rowArtifactId,
  }
}

function registerSourceArtifact(
  db: Pick<Database.Database, 'exec' | 'prepare'>,
  input: {
    identity: Awaited<ReturnType<typeof imageIdentity>>
    imagePath: string
    taskId: string
    createdAt: number
  },
) {
  ensureGenerationTables(db)
  db.prepare(`
    INSERT INTO artifacts (
      id,
      task_id,
      print_id,
      step,
      provider,
      source_artifact_ids,
      file_path,
      file_size,
      file_hash,
      created_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      file_path = excluded.file_path,
      file_size = excluded.file_size,
      file_hash = excluded.file_hash
  `).run(
    input.identity.artifactId,
    input.taskId,
    input.identity.printId,
    'manual-import',
    'manual-import',
    '[]',
    input.imagePath,
    input.identity.fileSize,
    input.identity.fileHash,
    input.createdAt,
  )
}

async function registerExtractArtifact(
  db: Pick<Database.Database, 'exec' | 'prepare'>,
  input: {
    taskId: string
    printId: string
    targetPath: string
    sourceArtifactId: string
    prompt: string
    model: string
    skill: Skill
    params: Record<string, unknown>
    createdAt: number
  },
) {
  ensureGenerationTables(db)
  const [fileHash, info] = await Promise.all([hashFile(input.targetPath), stat(input.targetPath)])
  const artifactId = randomUUID()
  db.prepare(`
    INSERT INTO artifacts (
      id,
      task_id,
      print_id,
      step,
      provider,
      model_or_workflow,
      skill_id,
      skill_version,
      source_artifact_ids,
      file_path,
      file_size,
      file_hash,
      prompt_snapshot,
      params_snapshot,
      created_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    artifactId,
    input.taskId,
    input.printId,
    'extract',
    'grsai',
    input.model,
    input.skill.id,
    input.skill.version,
    JSON.stringify([input.sourceArtifactId]),
    input.targetPath,
    info.size,
    fileHash,
    input.prompt,
    JSON.stringify(input.params),
    input.createdAt,
  )
  return { artifactId, printId: input.printId }
}

async function defaultDownloadImage(url: string) {
  if (url.startsWith('file://')) {
    return readFile(new URL(url))
  }

  const response = await fetch(url)
  if (!response.ok) {
    throw new AppErrorClass('HTTP_5XX', '下载 Grsai 结果图失败', true, {
      status: response.status,
      url,
    })
  }
  return Buffer.from(await response.arrayBuffer())
}

function appErrorMessage(error: unknown) {
  if (error instanceof AppErrorClass) {
    return error.message
  }
  if (error instanceof Error) {
    return error.message
  }
  return String(error)
}

function emitProgress(progress: GenerationProgress) {
  for (const window of BrowserWindow.getAllWindows()) {
    window.webContents.send('generation:progress', progress)
  }
}

function emitCompleted(event: GenerationTaskEvent) {
  for (const window of BrowserWindow.getAllWindows()) {
    window.webContents.send('generation:completed', event)
  }
}

export async function listExtractSources(
  dependencies: Pick<GenerationServiceDependencies, 'readConfig'> = {},
): Promise<ExtractSourcesResult> {
  const workbenchRoot = await readWorkbenchRoot(dependencies.readConfig)
  const folder = join(workbenchRoot, WORKBENCH_DIRECTORIES.collection)
  return {
    folder,
    images: await scanImageFolderRecursive(folder),
  }
}

export async function listImg2imgSources(
  dependencies: Pick<GenerationServiceDependencies, 'readConfig' | 'openDatabase'> = {},
): Promise<Img2imgSourcesResult> {
  const workbenchRoot = await readWorkbenchRoot(dependencies.readConfig)
  const sourceFolders = [
    {
      path: join(workbenchRoot, WORKBENCH_DIRECTORIES.generation, '01-文生图'),
      step: 'txt2img' as const,
    },
    {
      path: join(workbenchRoot, WORKBENCH_DIRECTORIES.generation, '02-图生图'),
      step: 'img2img' as const,
    },
    {
      path: join(workbenchRoot, WORKBENCH_DIRECTORIES.generation, '03-提取'),
      step: 'extract' as const,
    },
  ]
  const collectionFolder = join(workbenchRoot, WORKBENCH_DIRECTORIES.collection)
  const db = (dependencies.openDatabase ?? openWorkbenchDatabase)(workbenchRoot)

  try {
    ensureGenerationTables(db)
    const initialRows = readImg2imgArtifactRows(db)
    await ensureFolderPrintArtifacts(db, sourceFolders, initialRows)
    const rows = readImg2imgArtifactRows(db)
    const sources = await Promise.all(rows.map((row) => sourceFromArtifactRow(workbenchRoot, row)))
    return {
      folders: sourceFolders.map((folder) => folder.path),
      images: sources
        .filter((source): source is Img2imgPrintSource => Boolean(source))
        .filter((source) => {
          try {
            assertNotInsideFolder(source.path, collectionFolder)
            return true
          } catch {
            return false
          }
        }),
    }
  } finally {
    db.close()
  }
}

export async function listComfyuiImg2imgWorkflows(
  dependencies: {
    workflowCache?: Pick<typeof comfyuiWorkflowCacheManager, 'listWorkflows'>
  } = {},
): Promise<ComfyuiWorkflowSummary[]> {
  const workflowCache = dependencies.workflowCache ?? comfyuiWorkflowCacheManager
  const workflows = await workflowCache.listWorkflows('img2img')
  return workflows.filter((workflow) => workflow.capability === 'img2img')
}

export async function listComfyuiExtractWorkflows(
  dependencies: {
    workflowCache?: Pick<typeof comfyuiWorkflowCacheManager, 'listWorkflows'>
  } = {},
): Promise<ComfyuiWorkflowSummary[]> {
  const workflowCache = dependencies.workflowCache ?? comfyuiWorkflowCacheManager
  const workflows = await workflowCache.listWorkflows('extract')
  return workflows.filter((workflow) => workflow.capability === 'extract')
}

export async function listComfyuiMattingWorkflows(
  dependencies: {
    workflowCache?: Pick<typeof comfyuiWorkflowCacheManager, 'listWorkflows'>
  } = {},
): Promise<ComfyuiWorkflowSummary[]> {
  const workflowCache = dependencies.workflowCache ?? comfyuiWorkflowCacheManager
  const workflows = await workflowCache.listWorkflows('matting')
  return workflows.filter((workflow) => workflow.capability === 'matting')
}

export async function listComfyuiMixedMattingWorkflows(
  dependencies: {
    workflowCache?: Pick<typeof comfyuiWorkflowCacheManager, 'listWorkflows'>
  } = {},
): Promise<ComfyuiWorkflowSummary[]> {
  const workflowCache = dependencies.workflowCache ?? comfyuiWorkflowCacheManager
  const workflows = await workflowCache.listWorkflows('matting-mixed')
  return workflows.filter((workflow) => workflow.capability === 'matting-mixed')
}

export async function generateTxt2imgPrompts(input: GenerationPromptInput) {
  const count = clampInt(input.count, 1, 20, 5)
  const capability = input.capability ?? 'txt2img'
  const prompts = await promptGeneratorService.generatePrompts({
    ...(input.skillId ? { skillId: input.skillId } : { category: capability }),
    variables: {
      printMode: input.printMode === 'full' ? '满印' : '局部',
      requirement: input.requirement,
      count,
      modeInstruction: input.modeInstruction ?? '',
    },
    count,
    ...(input.model ? { model: input.model } : {}),
    ...(input.referenceImages?.length ? { refImages: input.referenceImages } : {}),
    userMessage:
      input.modeInstruction ??
      `生成 ${count} 条适合 Grsai ${capability === 'img2img' ? '图生图' : '文生图'}的英文印花提示词。`,
    responseFormat: 'json_object',
  })

  return prompts.map((text) => ({
    id: randomUUID(),
    text,
    selected: true,
  })) satisfies Txt2imgPromptDraft[]
}

export async function runTxt2img(input: Txt2imgRunInput) {
  const prompts = input.prompts.map((prompt) => prompt.trim()).filter(Boolean)
  if (prompts.length === 0) {
    throw new AppErrorClass('HTTP_4XX', '请先准备至少一条提示词', false)
  }

  const apiKey = await getSecret('grsai')
  if (!apiKey) {
    throw new AppErrorClass('HTTP_4XX', '缺少 Grsai API Key', false, { provider: 'grsai' })
  }

  const taskId = `gen_${randomUUID()}`
  void runTxt2imgTask(taskId, prompts, input, apiKey)
  return taskId
}

export async function runExtract(
  input: ExtractRunInput,
  dependencies: GenerationServiceDependencies = {},
) {
  const sourceImagePaths = Array.from(
    new Set(input.sourceImagePaths.map((imagePath) => imagePath.trim()).filter(Boolean)),
  )
  if (sourceImagePaths.length === 0) {
    throw new AppErrorClass('HTTP_4XX', '请先选择至少一张采集源图', false)
  }
  if (!input.skillId.trim()) {
    throw new AppErrorClass('HTTP_4XX', '请选择提取 Skill', false)
  }

  const apiKey = await (dependencies.getSecret ?? getSecret)('grsai')
  if (!apiKey) {
    throw new AppErrorClass('HTTP_4XX', '缺少 Grsai API Key', false, { provider: 'grsai' })
  }

  const taskId = input.taskId ?? `extract_${randomUUID()}`
  void runExtractBatch(
    { ...input, taskId, sourceImagePaths },
    {
      ...dependencies,
      getSecret: async () => apiKey,
    },
  )
    .then((result) => {
      emitCompleted({ ok: true, result })
    })
    .catch((error) => {
      emitCompleted({ ok: false, taskId, error: appErrorMessage(error) })
    })
  return taskId
}

export async function runComfyuiImg2img(
  input: ComfyuiImg2imgRunInput,
  dependencies: GenerationServiceDependencies = {},
) {
  const sourceArtifactIds = Array.from(
    new Set(input.sourceArtifactIds.map((artifactId) => artifactId.trim()).filter(Boolean)),
  )
  if (sourceArtifactIds.length === 0) {
    throw new AppErrorClass('HTTP_4XX', '请先选择至少一个印花', false)
  }
  if (!input.workflowId.trim()) {
    throw new AppErrorClass('HTTP_4XX', '请选择 ComfyUI 图生图工作流', false)
  }

  const apiKey = await (dependencies.getSecret ?? getSecret)('chenyu')
  if (!apiKey) {
    throw new AppErrorClass('HTTP_4XX', '缺少晨羽智云 API Key', false, {
      provider: 'comfyui-chenyu',
    })
  }

  const taskId = input.taskId ?? `img2img_${randomUUID()}`
  void runComfyuiImg2imgBatch(
    { ...input, taskId, sourceArtifactIds },
    {
      ...dependencies,
      getSecret: async () => apiKey,
    },
  )
    .then((result) => {
      emitCompleted({ ok: true, result })
    })
    .catch((error) => {
      emitCompleted({ ok: false, taskId, error: appErrorMessage(error) })
    })
  return taskId
}

export async function runComfyuiExtract(
  input: ComfyuiExtractRunInput,
  dependencies: GenerationServiceDependencies = {},
) {
  const sourceImagePaths = Array.from(
    new Set(input.sourceImagePaths.map((imagePath) => imagePath.trim()).filter(Boolean)),
  )
  if (sourceImagePaths.length === 0) {
    throw new AppErrorClass('HTTP_4XX', '请先选择至少一张采集源图', false)
  }
  if (!input.workflowId.trim()) {
    throw new AppErrorClass('HTTP_4XX', '请选择 ComfyUI 提取工作流', false)
  }

  const apiKey = await (dependencies.getSecret ?? getSecret)('chenyu')
  if (!apiKey) {
    throw new AppErrorClass('HTTP_4XX', '缺少晨羽智云 API Key', false, {
      provider: 'comfyui-chenyu',
    })
  }

  const taskId = input.taskId ?? `extract_comfy_${randomUUID()}`
  void runComfyuiExtractBatch(
    { ...input, taskId, sourceImagePaths },
    {
      ...dependencies,
      getSecret: async () => apiKey,
    },
  )
    .then((result) => {
      emitCompleted({ ok: true, result })
    })
    .catch((error) => {
      emitCompleted({ ok: false, taskId, error: appErrorMessage(error) })
    })
  return taskId
}

export async function runComfyuiMatting(
  input: ComfyuiMattingRunInput,
  dependencies: GenerationServiceDependencies = {},
) {
  const sourceArtifactIds = Array.from(
    new Set(input.sourceArtifactIds.map((artifactId) => artifactId.trim()).filter(Boolean)),
  )
  if (sourceArtifactIds.length === 0) {
    throw new AppErrorClass('HTTP_4XX', '请先选择至少一个印花', false)
  }
  if (!input.workflowId.trim()) {
    throw new AppErrorClass('HTTP_4XX', '请选择 ComfyUI 抠图工作流', false)
  }

  const apiKey = await (dependencies.getSecret ?? getSecret)('chenyu')
  if (!apiKey) {
    throw new AppErrorClass('HTTP_4XX', '缺少晨羽智云 API Key', false, {
      provider: 'comfyui-chenyu',
    })
  }

  const taskId = input.taskId ?? `matting_comfy_${randomUUID()}`
  void runComfyuiMattingBatch(
    { ...input, taskId, sourceArtifactIds },
    {
      ...dependencies,
      getSecret: async () => apiKey,
    },
  )
    .then((result) => {
      emitCompleted({ ok: true, result })
    })
    .catch((error) => {
      emitCompleted({ ok: false, taskId, error: appErrorMessage(error) })
    })
  return taskId
}

export async function runMixedMatting(
  input: MixedMattingRunInput,
  dependencies: GenerationServiceDependencies = {},
) {
  const sourceArtifactIds = Array.from(
    new Set(input.sourceArtifactIds.map((artifactId) => artifactId.trim()).filter(Boolean)),
  )
  if (sourceArtifactIds.length === 0) {
    throw new AppErrorClass('HTTP_4XX', '请先选择至少一个印花', false)
  }
  if (!input.workflowId.trim()) {
    throw new AppErrorClass('HTTP_4XX', '请选择 ComfyUI 混合抠图工作流', false)
  }
  const grsaiKey = await (dependencies.getSecret ?? getSecret)('grsai')
  if (!grsaiKey) {
    throw new AppErrorClass('HTTP_4XX', '缺少 Grsai API Key', false, { provider: 'grsai' })
  }
  const chenyuKey = await (dependencies.getSecret ?? getSecret)('chenyu')
  if (!chenyuKey) {
    throw new AppErrorClass('HTTP_4XX', '缺少晨羽智云 API Key', false, {
      provider: 'comfyui-chenyu',
    })
  }

  const taskId = input.taskId ?? `matting_mixed_${randomUUID()}`
  void runMixedMattingBatch(
    { ...input, taskId, sourceArtifactIds },
    {
      ...dependencies,
      getSecret: async (key: string) => {
        if (key === 'grsai') {
          return grsaiKey
        }
        if (key === 'chenyu') {
          return chenyuKey
        }
        return ''
      },
    },
  )
    .then((result) => {
      emitCompleted({ ok: true, result })
    })
    .catch((error) => {
      emitCompleted({ ok: false, taskId, error: appErrorMessage(error) })
    })
  return taskId
}

async function runTxt2imgTask(
  taskId: string,
  prompts: string[],
  input: Txt2imgRunInput,
  apiKey: string,
) {
  const capability = input.capability ?? 'txt2img'
  const controller = new GenerationConcurrencyController({
    workers: clampInt(input.concurrency, 1, 10, 3),
  })
  const adapter = new GrsaiAdapter(apiKey)
  const result: GenerationRunResult = {
    taskId,
    total: prompts.length,
    succeeded: 0,
    failed: 0,
    images: [],
    failures: [],
  }

  try {
    await Promise.all(
      prompts.map((prompt, index) =>
        controller.run(`${taskId}-${index}`, async () => {
          emitProgress({
            task_id: taskId,
            capability,
            processed: result.succeeded + result.failed,
            total: prompts.length,
            succeeded: result.succeeded,
            failed: result.failed,
            current_prompt: prompt,
          })

          try {
            const response = await adapter.generate({
              capability: 'txt2img',
              prompt,
              output: {
                aspect_ratio: input.aspectRatio,
                image_size_label: input.imageSize,
              },
              model: normalizeModel(input.model),
            } satisfies GenerateRequest)
            if (response.status !== 'succeeded') {
              throw response.error ?? new AppErrorClass('GRSAI_FAILED', 'Grsai 生成失败', true)
            }
            result.succeeded += response.images.length
            result.images.push(...response.images.map((image) => ({ prompt, url: image.url })))
          } catch (error) {
            result.failed += 1
            result.failures.push({ prompt, error: appErrorMessage(error) })
          } finally {
            emitProgress({
              task_id: taskId,
              capability,
              processed: result.succeeded + result.failed,
              total: prompts.length,
              succeeded: result.succeeded,
              failed: result.failed,
              current_prompt: prompt,
            })
          }
        }),
      ),
    )
    emitCompleted({ ok: true, result })
  } catch (error) {
    emitCompleted({ ok: false, taskId, error: appErrorMessage(error) })
  }
}

export async function runExtractBatch(
  input: ExtractRunInput,
  dependencies: GenerationServiceDependencies = {},
) {
  const sourceImagePaths = Array.from(
    new Set(input.sourceImagePaths.map((imagePath) => imagePath.trim()).filter(Boolean)),
  )
  if (sourceImagePaths.length === 0) {
    throw new AppErrorClass('HTTP_4XX', '请先选择至少一张采集源图', false)
  }
  if (!input.skillId.trim()) {
    throw new AppErrorClass('HTTP_4XX', '请选择提取 Skill', false)
  }

  const apiKey = await (dependencies.getSecret ?? getSecret)('grsai')
  if (!apiKey) {
    throw new AppErrorClass('HTTP_4XX', '缺少 Grsai API Key', false, { provider: 'grsai' })
  }

  const taskId = input.taskId ?? `extract_${randomUUID()}`
  const promptCount = clampInt(input.promptCount, 1, 20, 1)
  const result: GenerationRunResult = {
    taskId,
    total: sourceImagePaths.length * promptCount,
    succeeded: 0,
    failed: 0,
    images: [],
    failures: [],
  }
  let db: GenerationDatabase | null = null
  const emit = dependencies.emitProgress ?? emitProgress

  try {
    const concurrency = clampInt(input.concurrency, 1, 10, 3)
    const model = normalizeModel(input.model)
    const controller = new GenerationConcurrencyController({ workers: concurrency })
    const adapter = dependencies.createGrsaiAdapter?.(apiKey) ?? new GrsaiAdapter(apiKey)
    const promptGenerator = dependencies.promptGenerator ?? promptGeneratorService
    const skillCache = dependencies.skillCache ?? skillCacheManager
    const downloadImage = dependencies.downloadImage ?? defaultDownloadImage
    const workbenchRoot = await readWorkbenchRoot(dependencies.readConfig)
    const sourceFolder = join(workbenchRoot, WORKBENCH_DIRECTORIES.collection)
    const outputFolder = join(workbenchRoot, WORKBENCH_DIRECTORIES.generation, '03-提取')
    db = (dependencies.openDatabase ?? openWorkbenchDatabase)(workbenchRoot)
    const activeDb = db
    ensureGenerationTables(db)
    await mkdir(outputFolder, { recursive: true })
    const skill = await skillCache.getSkill(input.skillId.trim(), input.skillVersion)

    await Promise.all(
      sourceImagePaths.map((sourceImagePath, sourceIndex) =>
        controller.run(`${taskId}-${sourceIndex}`, async () => {
          assertInsideFolder(sourceImagePath, sourceFolder)
          const sourceIdentity = await imageIdentity(sourceImagePath)
          registerSourceArtifact(activeDb, {
            identity: sourceIdentity,
            imagePath: sourceImagePath,
            taskId,
            createdAt: Date.now(),
          })
          const reference = await imageReference(sourceImagePath)
          const prompts = await promptGenerator.generatePrompts({
            skill,
            variables: {
              ...(input.variables ?? {}),
              count: promptCount,
              sourceImage: basename(sourceImagePath),
            },
            refImages: [reference],
            count: promptCount,
            ...(input.llmModel ? { model: input.llmModel } : {}),
            userMessage:
              '识别源图中的印花元素，生成白底居中的英文印花提取提示词。每条提示词只描述要提取成独立印花的内容。',
            responseFormat: 'json_object',
          })

          for (const prompt of prompts) {
            emitExtractProgress(result, sourceImagePaths.length * promptCount, taskId, emit, prompt)
            try {
              const response = await adapter.generate({
                capability: 'extract',
                prompt,
                reference_images: [reference],
                output: {
                  aspect_ratio: input.aspectRatio,
                  image_size_label: input.imageSize,
                  format: 'png',
                },
                model,
              } satisfies GenerateRequest)
              if (response.status !== 'succeeded') {
                throw response.error ?? new AppErrorClass('GRSAI_FAILED', 'Grsai 提取失败', true)
              }

              if (response.images.length === 0) {
                throw new AppErrorClass('GRSAI_FAILED', 'Grsai 未返回结果图', true)
              }

              for (const image of response.images) {
                const printId = newPrintId()
                const targetPath = await uniqueTargetPath(outputFolder, printId, '.png')
                const imageBuffer = image.local_path
                  ? await readFile(image.local_path)
                  : await downloadImage(image.url)
                await writeFile(targetPath, imageBuffer)
                const artifact = await registerExtractArtifact(activeDb, {
                  taskId,
                  printId,
                  targetPath,
                  sourceArtifactId: sourceIdentity.artifactId,
                  prompt,
                  model,
                  skill,
                  params: {
                    aspectRatio: input.aspectRatio,
                    imageSize: input.imageSize,
                    variables: input.variables ?? {},
                  },
                  createdAt: Date.now(),
                })
                result.succeeded += 1
                result.images.push({
                  prompt,
                  url: fileUrl(targetPath),
                  localPath: targetPath,
                  sourcePath: sourceImagePath,
                  artifactId: artifact.artifactId,
                  printId: artifact.printId,
                })
              }
            } catch (error) {
              result.failed += 1
              result.failures.push({
                prompt,
                sourcePath: sourceImagePath,
                error: appErrorMessage(error),
              })
            } finally {
              emitExtractProgress(
                result,
                sourceImagePaths.length * promptCount,
                taskId,
                emit,
                prompt,
              )
            }
          }
        }),
      ),
    )
    return result
  } finally {
    db?.close()
  }
}

export async function runComfyuiExtractBatch(
  input: ComfyuiExtractRunInput,
  dependencies: GenerationServiceDependencies = {},
) {
  const sourceImagePaths = Array.from(
    new Set(input.sourceImagePaths.map((imagePath) => imagePath.trim()).filter(Boolean)),
  )
  if (sourceImagePaths.length === 0) {
    throw new AppErrorClass('HTTP_4XX', '请先选择至少一张采集源图', false)
  }
  if (!input.workflowId.trim()) {
    throw new AppErrorClass('HTTP_4XX', '请选择 ComfyUI 提取工作流', false)
  }

  const apiKey = await (dependencies.getSecret ?? getSecret)('chenyu')
  if (!apiKey) {
    throw new AppErrorClass('HTTP_4XX', '缺少晨羽智云 API Key', false, {
      provider: 'comfyui-chenyu',
    })
  }

  const taskId = input.taskId ?? `extract_comfy_${randomUUID()}`
  const result: GenerationRunResult = {
    taskId,
    total: sourceImagePaths.length,
    succeeded: 0,
    failed: 0,
    images: [],
    failures: [],
  }
  const emit = dependencies.emitProgress ?? emitProgress
  const workbenchRoot = await readWorkbenchRoot(dependencies.readConfig)
  const sourceFolder = join(workbenchRoot, WORKBENCH_DIRECTORIES.collection)
  const db = (dependencies.openDatabase ?? openWorkbenchDatabase)(workbenchRoot)

  try {
    ensureGenerationTables(db)
    const adapter =
      dependencies.createComfyuiAdapter?.({ apiKey, workbenchRoot }) ??
      new ComfyuiChenyuAdapter({
        instanceManager: new ComfyuiInstanceManager({
          chenyu: new ChenyuCloudClient(apiKey),
        }),
        comfyHttp: new ComfyHttpClient(await currentComfyuiUrl(workbenchRoot, db)),
        workflowCache: dependencies.workflowCache ?? comfyuiWorkflowCacheManager,
        workbenchRoot,
        openDatabase: dependencies.openDatabase ?? openWorkbenchDatabase,
      })

    for (const sourceImagePath of sourceImagePaths) {
      emitExtractProgress(result, sourceImagePaths.length, taskId, emit)
      try {
        assertInsideFolder(sourceImagePath, sourceFolder)
        const sourceIdentity = await imageIdentity(sourceImagePath)
        registerSourceArtifact(db, {
          identity: sourceIdentity,
          imagePath: sourceImagePath,
          taskId,
          createdAt: Date.now(),
        })
        const response = await adapter.generate({
          capability: 'extract',
          prompt: input.prompt?.trim() || 'Extract the print from the source product image.',
          workflow_id: input.workflowId.trim(),
          reference_images: [await imageReference(sourceImagePath)],
          output: { format: 'png' },
          options: {
            taskId,
            sourceArtifactIds: [sourceIdentity.artifactId],
            ...(input.workflowVersion ? { workflowVersion: input.workflowVersion } : {}),
          },
        } satisfies GenerateRequest)
        if (response.status !== 'succeeded') {
          throw response.error ?? new AppErrorClass('HTTP_5XX', 'ComfyUI 提取失败', true)
        }
        result.succeeded += response.images.length
        result.images.push(
          ...response.images.map((image) => ({
            prompt: input.prompt ?? '',
            url: image.url,
            ...(image.local_path ? { localPath: image.local_path } : {}),
            sourcePath: sourceImagePath,
            artifactId: sourceIdentity.artifactId,
            printId: sourceIdentity.printId,
          })),
        )
      } catch (error) {
        result.failed += 1
        result.failures.push({
          prompt: input.prompt ?? '',
          sourcePath: sourceImagePath,
          error: appErrorMessage(error),
        })
      } finally {
        emitExtractProgress(result, sourceImagePaths.length, taskId, emit)
      }
    }

    return result
  } finally {
    db.close()
  }
}

export async function runComfyuiMattingBatch(
  input: ComfyuiMattingRunInput,
  dependencies: GenerationServiceDependencies = {},
) {
  const sourceArtifactIds = Array.from(
    new Set(input.sourceArtifactIds.map((artifactId) => artifactId.trim()).filter(Boolean)),
  )
  if (sourceArtifactIds.length === 0) {
    throw new AppErrorClass('HTTP_4XX', '请先选择至少一个印花', false)
  }
  if (!input.workflowId.trim()) {
    throw new AppErrorClass('HTTP_4XX', '请选择 ComfyUI 抠图工作流', false)
  }

  const apiKey = await (dependencies.getSecret ?? getSecret)('chenyu')
  if (!apiKey) {
    throw new AppErrorClass('HTTP_4XX', '缺少晨羽智云 API Key', false, {
      provider: 'comfyui-chenyu',
    })
  }

  const taskId = input.taskId ?? `matting_comfy_${randomUUID()}`
  const result: GenerationRunResult = {
    taskId,
    total: sourceArtifactIds.length,
    succeeded: 0,
    failed: 0,
    images: [],
    failures: [],
  }
  const emit = dependencies.emitProgress ?? emitProgress
  const workbenchRoot = await readWorkbenchRoot(dependencies.readConfig)
  const collectionFolder = join(workbenchRoot, WORKBENCH_DIRECTORIES.collection)
  const db = (dependencies.openDatabase ?? openWorkbenchDatabase)(workbenchRoot)

  try {
    ensureGenerationTables(db)
    const adapter =
      dependencies.createComfyuiAdapter?.({ apiKey, workbenchRoot }) ??
      new ComfyuiChenyuAdapter({
        instanceManager: new ComfyuiInstanceManager({
          chenyu: new ChenyuCloudClient(apiKey),
        }),
        comfyHttp: new ComfyHttpClient(await currentComfyuiUrl(workbenchRoot, db)),
        workflowCache: dependencies.workflowCache ?? comfyuiWorkflowCacheManager,
        workbenchRoot,
        openDatabase: dependencies.openDatabase ?? openWorkbenchDatabase,
      })

    for (const artifactId of sourceArtifactIds) {
      emitMattingProgress(result, taskId, sourceArtifactIds.length, emit)
      try {
        const source = await readReferenceForArtifact(
          db,
          workbenchRoot,
          collectionFolder,
          artifactId,
        )
        const response = await adapter.generate({
          capability: 'matting',
          prompt: input.prompt?.trim() || 'Remove the background and output transparent PNG.',
          workflow_id: input.workflowId.trim(),
          reference_images: [source.reference],
          output: { format: 'png' },
          options: {
            taskId,
            sourceArtifactIds: [artifactId],
            printId: source.printId,
            ...(input.workflowVersion ? { workflowVersion: input.workflowVersion } : {}),
          },
        } satisfies GenerateRequest)
        if (response.status !== 'succeeded') {
          throw response.error ?? new AppErrorClass('HTTP_5XX', 'ComfyUI 抠图失败', true)
        }
        result.succeeded += response.images.length
        result.images.push(
          ...response.images.map((image) => ({
            prompt: input.prompt ?? '',
            url: image.url,
            ...(image.local_path ? { localPath: image.local_path } : {}),
            sourcePath: source.imagePath,
            artifactId,
            printId: source.printId,
          })),
        )
      } catch (error) {
        result.failed += 1
        result.failures.push({
          prompt: input.prompt ?? '',
          error: appErrorMessage(error),
          sourcePath: artifactId,
        })
      } finally {
        emitMattingProgress(result, taskId, sourceArtifactIds.length, emit)
      }
    }

    return result
  } finally {
    db.close()
  }
}

export async function runMixedMattingBatch(
  input: MixedMattingRunInput,
  dependencies: GenerationServiceDependencies = {},
) {
  const sourceArtifactIds = Array.from(
    new Set(input.sourceArtifactIds.map((artifactId) => artifactId.trim()).filter(Boolean)),
  )
  if (sourceArtifactIds.length === 0) {
    throw new AppErrorClass('HTTP_4XX', '请先选择至少一个印花', false)
  }
  if (!input.workflowId.trim()) {
    throw new AppErrorClass('HTTP_4XX', '请选择 ComfyUI 混合抠图工作流', false)
  }
  const grsaiKey = await (dependencies.getSecret ?? getSecret)('grsai')
  if (!grsaiKey) {
    throw new AppErrorClass('HTTP_4XX', '缺少 Grsai API Key', false, { provider: 'grsai' })
  }
  const chenyuKey = await (dependencies.getSecret ?? getSecret)('chenyu')
  if (!chenyuKey) {
    throw new AppErrorClass('HTTP_4XX', '缺少晨羽智云 API Key', false, {
      provider: 'comfyui-chenyu',
    })
  }

  const taskId = input.taskId ?? `matting_mixed_${randomUUID()}`
  const result: GenerationRunResult = {
    taskId,
    total: sourceArtifactIds.length,
    succeeded: 0,
    failed: 0,
    images: [],
    failures: [],
  }
  const emit = dependencies.emitProgress ?? emitProgress
  const workbenchRoot = await readWorkbenchRoot(dependencies.readConfig)
  const collectionFolder = join(workbenchRoot, WORKBENCH_DIRECTORIES.collection)
  const db = (dependencies.openDatabase ?? openWorkbenchDatabase)(workbenchRoot)
  const tempFiles = dependencies.tempFiles ?? tempFileManager
  let createdTempDir = false

  try {
    ensureGenerationTables(db)
    await tempFiles.createTaskDir('matting', taskId)
    createdTempDir = true
    const skill = await resolveMixedMattingMaskSkill(
      input,
      dependencies.skillCache ?? skillCacheManager,
    )
    const grsai = dependencies.createGrsaiAdapter?.(grsaiKey) ?? new GrsaiAdapter(grsaiKey)
    const downloadImage = dependencies.downloadImage ?? defaultDownloadImage
    const comfyui =
      dependencies.createComfyuiAdapter?.({ apiKey: chenyuKey, workbenchRoot }) ??
      new ComfyuiChenyuAdapter({
        instanceManager: new ComfyuiInstanceManager({
          chenyu: new ChenyuCloudClient(chenyuKey),
        }),
        comfyHttp: new ComfyHttpClient(await currentComfyuiUrl(workbenchRoot, db)),
        workflowCache: dependencies.workflowCache ?? comfyuiWorkflowCacheManager,
        workbenchRoot,
        openDatabase: dependencies.openDatabase ?? openWorkbenchDatabase,
      })

    for (const artifactId of sourceArtifactIds) {
      emitMattingProgress(result, taskId, sourceArtifactIds.length, emit)
      let maskPath: string | null = null
      try {
        const source = await readReferenceForArtifact(
          db,
          workbenchRoot,
          collectionFolder,
          artifactId,
        )
        maskPath = join(await tempFiles.createTaskDir('matting', taskId), 'mask.png')
        const maskModel = normalizeModel(input.maskModel ?? DEFAULT_GENERATION_MODEL)
        const maskResponse = await grsai.generate({
          capability: 'img2img',
          prompt: skill.systemPrompt,
          reference_images: [source.reference],
          output: {
            aspect_ratio: '1:1',
            image_size_label: '1K',
            format: 'png',
          },
          model: maskModel,
          options: {
            replyType: 'async',
            skillId: skill.id,
            skillVersion: skill.version,
          },
        } satisfies GenerateRequest)
        if (maskResponse.status !== 'succeeded') {
          throw (
            maskResponse.error ?? new AppErrorClass('GRSAI_FAILED', 'Grsai 黑白图生成失败', true)
          )
        }
        const maskImage = maskResponse.images[0]
        if (!maskImage) {
          throw new AppErrorClass('GRSAI_FAILED', 'Grsai 未返回黑白图', true)
        }
        const maskBuffer = maskImage.local_path
          ? await readFile(maskImage.local_path)
          : await downloadImage(maskImage.url)
        await writeFile(maskPath, maskBuffer)

        const response = await comfyui.generate({
          capability: 'matting',
          prompt:
            input.prompt?.trim() ||
            'Convert the black and white mask to alpha and composite it with the original print.',
          workflow_id: input.workflowId.trim(),
          reference_images: [source.reference, await imageReference(maskPath)],
          output: { format: 'png' },
          options: {
            taskId,
            sourceArtifactIds: [artifactId],
            printId: source.printId,
            workflowCategory: 'matting-mixed',
            artifactProvider: 'grsai+comfyui-mask',
            maskSkillId: skill.id,
            maskSkillVersion: skill.version,
            maskModel,
            imageSlotIndexes: {
              sourceImage: 0,
              originalImage: 0,
              image: 0,
              maskImage: 1,
              mask: 1,
              alpha: 1,
            },
            ...(input.workflowVersion ? { workflowVersion: input.workflowVersion } : {}),
          },
        } satisfies GenerateRequest)
        if (response.status !== 'succeeded') {
          throw response.error ?? new AppErrorClass('HTTP_5XX', 'ComfyUI 混合抠图失败', true)
        }
        result.succeeded += response.images.length
        result.images.push(
          ...response.images.map((image) => ({
            prompt: input.prompt ?? '',
            url: image.url,
            ...(image.local_path ? { localPath: image.local_path } : {}),
            sourcePath: source.imagePath,
            artifactId,
            printId: source.printId,
          })),
        )
      } catch (error) {
        result.failed += 1
        result.failures.push({
          prompt: input.prompt ?? '',
          error: appErrorMessage(error),
          sourcePath: artifactId,
        })
      } finally {
        if (maskPath) {
          await rm(maskPath, { force: true })
        }
        emitMattingProgress(result, taskId, sourceArtifactIds.length, emit)
      }
    }

    return result
  } finally {
    db.close()
    if (createdTempDir) {
      await tempFiles.cleanupTask('matting', taskId)
    }
  }
}

export async function runComfyuiImg2imgBatch(
  input: ComfyuiImg2imgRunInput,
  dependencies: GenerationServiceDependencies = {},
) {
  const sourceArtifactIds = Array.from(
    new Set(input.sourceArtifactIds.map((artifactId) => artifactId.trim()).filter(Boolean)),
  )
  if (sourceArtifactIds.length === 0) {
    throw new AppErrorClass('HTTP_4XX', '请先选择至少一个印花', false)
  }
  if (!input.workflowId.trim()) {
    throw new AppErrorClass('HTTP_4XX', '请选择 ComfyUI 图生图工作流', false)
  }

  const apiKey = await (dependencies.getSecret ?? getSecret)('chenyu')
  if (!apiKey) {
    throw new AppErrorClass('HTTP_4XX', '缺少晨羽智云 API Key', false, {
      provider: 'comfyui-chenyu',
    })
  }

  const taskId = input.taskId ?? `img2img_${randomUUID()}`
  const result: GenerationRunResult = {
    taskId,
    total: sourceArtifactIds.length,
    succeeded: 0,
    failed: 0,
    images: [],
    failures: [],
  }
  const emit = dependencies.emitProgress ?? emitProgress
  const workbenchRoot = await readWorkbenchRoot(dependencies.readConfig)
  const collectionFolder = join(workbenchRoot, WORKBENCH_DIRECTORIES.collection)
  const db = (dependencies.openDatabase ?? openWorkbenchDatabase)(workbenchRoot)

  try {
    ensureGenerationTables(db)
    const adapter =
      dependencies.createComfyuiAdapter?.({ apiKey, workbenchRoot }) ??
      new ComfyuiChenyuAdapter({
        instanceManager: new ComfyuiInstanceManager({
          chenyu: new ChenyuCloudClient(apiKey),
        }),
        comfyHttp: new ComfyHttpClient(await currentComfyuiUrl(workbenchRoot, db)),
        workflowCache: dependencies.workflowCache ?? comfyuiWorkflowCacheManager,
        workbenchRoot,
        openDatabase: dependencies.openDatabase ?? openWorkbenchDatabase,
      })

    for (const artifactId of sourceArtifactIds) {
      emitImg2imgProgress(result, taskId, sourceArtifactIds.length, emit)
      try {
        const source = await readReferenceForArtifact(
          db,
          workbenchRoot,
          collectionFolder,
          artifactId,
        )
        const response = await adapter.generate({
          capability: 'img2img',
          prompt: input.prompt.trim() || 'Generate an image-to-image print variation.',
          workflow_id: input.workflowId.trim(),
          reference_images: [source.reference],
          output: { format: 'png' },
          options: {
            taskId,
            sourceArtifactIds: [artifactId],
            printId: source.printId,
            ...(input.workflowVersion ? { workflowVersion: input.workflowVersion } : {}),
          },
        } satisfies GenerateRequest)
        if (response.status !== 'succeeded') {
          throw response.error ?? new AppErrorClass('HTTP_5XX', 'ComfyUI 图生图失败', true)
        }
        result.succeeded += response.images.length
        result.images.push(
          ...response.images.map((image) => ({
            prompt: input.prompt,
            url: image.url,
            ...(image.local_path ? { localPath: image.local_path } : {}),
            artifactId,
          })),
        )
      } catch (error) {
        result.failed += 1
        result.failures.push({
          prompt: input.prompt,
          error: appErrorMessage(error),
          sourcePath: artifactId,
        })
      } finally {
        emitImg2imgProgress(result, taskId, sourceArtifactIds.length, emit)
      }
    }

    return result
  } finally {
    db.close()
  }
}

function currentComfyuiUrl(workbenchRoot: string, db: Pick<Database.Database, 'prepare'>) {
  try {
    const row = db.prepare('SELECT comfyui_url FROM comfyui_instances WHERE id = 1').get() as
      | { comfyui_url?: string }
      | undefined
    if (row?.comfyui_url) {
      return row.comfyui_url
    }
  } catch {}

  throw new AppErrorClass('CHENYU_INSTANCE_DOWN', '请先创建并启动 ComfyUI 实例', false, {
    provider: 'comfyui-chenyu',
    workbenchRoot,
  })
}

function emitImg2imgProgress(
  result: GenerationRunResult,
  taskId: string,
  total: number,
  emit: (progress: GenerationProgress) => void,
) {
  emit({
    task_id: taskId,
    capability: 'img2img',
    processed: result.succeeded + result.failed,
    total,
    succeeded: result.succeeded,
    failed: result.failed,
  })
}

function emitMattingProgress(
  result: GenerationRunResult,
  taskId: string,
  total: number,
  emit: (progress: GenerationProgress) => void,
) {
  emit({
    task_id: taskId,
    capability: 'matting',
    processed: result.succeeded + result.failed,
    total,
    succeeded: result.succeeded,
    failed: result.failed,
  })
}

function emitExtractProgress(
  result: GenerationRunResult,
  total: number,
  taskId: string,
  emit: (progress: GenerationProgress) => void,
  currentPrompt?: string,
) {
  const progress: GenerationProgress = {
    task_id: taskId,
    capability: 'extract',
    processed: result.succeeded + result.failed,
    total,
    succeeded: result.succeeded,
    failed: result.failed,
    ...(currentPrompt ? { current_prompt: currentPrompt } : {}),
  }
  emit(progress)
}

export function parseManualPrompts(text: string) {
  return parsePrompts(text, 200)
}

export function registerGenerationIpc() {
  ipcMain.handle('generation:generate-prompts', (_event, input: GenerationPromptInput) =>
    generateTxt2imgPrompts(input),
  )
  ipcMain.handle('generation:list-extract-sources', () => listExtractSources())
  ipcMain.handle('generation:list-img2img-sources', () => listImg2imgSources())
  ipcMain.handle('generation:list-comfyui-img2img-workflows', () => listComfyuiImg2imgWorkflows())
  ipcMain.handle('generation:list-comfyui-extract-workflows', () => listComfyuiExtractWorkflows())
  ipcMain.handle('generation:list-comfyui-matting-workflows', () => listComfyuiMattingWorkflows())
  ipcMain.handle('generation:list-comfyui-mixed-matting-workflows', () =>
    listComfyuiMixedMattingWorkflows(),
  )
  ipcMain.handle('generation:parse-manual-prompts', (_event, text: string) =>
    parseManualPrompts(text),
  )
  ipcMain.handle('generation:run-txt2img', (_event, input: Txt2imgRunInput) => runTxt2img(input))
  ipcMain.handle('generation:run-extract', (_event, input: ExtractRunInput) => runExtract(input))
  ipcMain.handle('generation:run-comfyui-extract', (_event, input: ComfyuiExtractRunInput) =>
    runComfyuiExtract(input),
  )
  ipcMain.handle('generation:run-comfyui-matting', (_event, input: ComfyuiMattingRunInput) =>
    runComfyuiMatting(input),
  )
  ipcMain.handle('generation:run-mixed-matting', (_event, input: MixedMattingRunInput) =>
    runMixedMatting(input),
  )
  ipcMain.handle('generation:run-comfyui-img2img', (_event, input: ComfyuiImg2imgRunInput) =>
    runComfyuiImg2img(input),
  )
}
