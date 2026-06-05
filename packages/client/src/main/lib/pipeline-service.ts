import { randomUUID } from 'node:crypto'
import { copyFile, mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises'
import { basename, extname, isAbsolute, join } from 'node:path'
import {
  AppErrorClass,
  type PhotoshopPrintAsset,
  type PipelineComfyuiWorkflowConfig,
  type PipelineDetectionConfig,
  type PipelineExtractConfig,
  type PipelineGrsaiImageConfig,
  type PipelineMattingConfig,
  type PipelinePreviewImage,
  type PipelineProgress,
  type PipelinePromptConfig,
  type PipelineReferenceImageInput,
  type PipelineResultImage,
  type PipelineResultSection,
  type PipelineResultSectionKey,
  type PipelineRunConfig,
  type PipelineRunDetail,
  type PipelineRunRecord,
  type PipelineRunStats,
  type PipelineRunStatus,
  type PipelineRuntimeLogEntry,
  type PipelineSourceConfig,
  type PipelineStepKey,
  type PipelineStepRecord,
  type PipelineStepStatus,
  type PipelineTaskEvent,
  SkuCodeSchema,
  WORKBENCH_DIRECTORIES,
} from '@tengyu-aipod/shared'
import { BrowserWindow, ipcMain } from 'electron'
import { z } from 'zod'
import { readAppConfig } from '../onboarding'
import { runBatch } from '../photoshop/multi-batch'
import { type CollectionFolderReadLock, collectionFolderLock } from './collection-folder-lock'
import {
  type DetectionBatchResult,
  type DetectionImageResult,
  detectionService,
} from './detection-service'
import {
  type GenerationProgress,
  type GenerationPromptInput,
  type GenerationRunImage,
  type GenerationRunResult,
  generateTxt2imgPrompts,
  runComfyuiExtractBatch,
  runComfyuiMattingBatch,
  runExtractBatch,
  runMixedMattingBatch,
  runTxt2imgBatch,
} from './generation-service'
import { shouldPipelineDetectionAllow } from './pipeline-policy'
import { type SqliteDatabase, openSqliteDatabase } from './sqlite'
import { tempFileManager } from './temp-file-manager'
import { type TitleBatchResult, titleService } from './title-service'
import { assertPathInsideWorkbench } from './workbench-path-guard'

const IMAGE_EXTENSIONS = /\.(?:jpe?g|png|webp)$/i
const WAITING_PHOTOSHOP_PRINT_FOLDER = '等待套版'
const PIPELINE_RUNS_FOLDER = 'pipeline-runs'
const IMAGE_PROCESSING_SECTION_KEY = 'image_processing'
const RESULT_SECTION_ORDER: PipelineResultSectionKey[] = [
  IMAGE_PROCESSING_SECTION_KEY,
  'detection_passed',
  'detection_blocked',
  'source_images',
  'reference_images',
  'print_products',
]
const DEFAULT_STATS: PipelineRunStats = {
  sourceImages: 0,
  prints: 0,
  detectionPass: 0,
  detectionReview: 0,
  detectionBlock: 0,
  photoshopGroups: 0,
  titleSucceeded: 0,
  titleFailed: 0,
}

type PipelineImage = {
  path: string
  artifactId?: string
  printId?: string
}

type ActivePipelineRun = {
  db: Pick<SqliteDatabase, 'prepare'>
  cancelled: boolean
  currentCancel: (() => void | Promise<void>) | null
  previewImages: PipelinePreviewImage[]
  resultSections: PipelineResultSection[]
  logs: PipelineRuntimeLogEntry[]
  collectionReadLock: CollectionFolderReadLock | null
}

class PromiseMutex {
  private current = Promise.resolve()

  async runExclusive<T>(fn: () => Promise<T>): Promise<T> {
    const previous = this.current
    let release: () => void = () => {}
    this.current = new Promise<void>((resolve) => {
      release = resolve
    })
    await previous
    try {
      return await fn()
    } finally {
      release()
    }
  }
}

const promptConfigSchema = z.object({
  mode: z.enum(['manual', 'ai']),
  prompts: z.array(z.string()).optional(),
  requirement: z.string().optional(),
  count: z.number().optional(),
  modeInstruction: z.string().optional(),
  skillId: z.string().optional(),
  skillVersion: z.string().optional(),
  model: z.string().optional(),
})

const grsaiImageSchema = z.object({
  model: z.string(),
  aspectRatio: z.string(),
  imageSize: z.enum(['1K', '2K', '4K']).optional(),
  concurrency: z.number().optional(),
})

const comfyuiWorkflowSchema = z.object({
  workflowId: z.string(),
  workflowName: z.string().optional(),
  workflowVersion: z.string().optional(),
  instanceUuid: z.string().optional(),
  width: z.number().optional(),
  height: z.number().optional(),
  concurrency: z.number().optional(),
})

const extractSchema = z.object({
  provider: z.enum(['grsai', 'comfyui-chenyu']),
  skillId: z.string().optional(),
  skillVersion: z.string().optional(),
  variables: z.record(z.unknown()).optional(),
  grsai: grsaiImageSchema.optional(),
  comfyui: comfyuiWorkflowSchema.optional(),
})

const referenceImageInputSchema = z.object({
  name: z.string().min(1),
  base64: z.string().min(1),
  mime_type: z.string().min(1),
})

const sourceSchema = z.discriminatedUnion('mode', [
  z.object({
    mode: z.literal('collection'),
    sourceFolder: z.string(),
    extract: extractSchema,
  }),
  z.object({
    mode: z.literal('txt2img'),
    provider: z.literal('grsai'),
    prompt: promptConfigSchema,
    grsai: grsaiImageSchema.optional(),
  }),
  z.object({
    mode: z.literal('img2img'),
    provider: z.literal('grsai'),
    sourceFolder: z.string().optional(),
    referenceImages: z.array(referenceImageInputSchema).optional(),
    referenceImagePaths: z.array(z.string()).optional(),
    prompt: promptConfigSchema,
    sendReferenceImages: z.boolean().optional(),
    grsai: grsaiImageSchema.optional(),
  }),
  z.object({
    mode: z.literal('existing_prints'),
    printFolder: z.string(),
  }),
])

const pipelineRunConfigBaseSchema = z.object({
  name: z.string().optional(),
  printSkuCode: SkuCodeSchema.optional(),
  printMode: z.enum(['local', 'full']),
  source: sourceSchema,
  matting: z.object({
    enabled: z.boolean(),
    mode: z.enum(['comfyui', 'mixed']),
    workflowId: z.string().optional(),
    workflowName: z.string().optional(),
    workflowVersion: z.string().optional(),
    instanceUuid: z.string().optional(),
    width: z.number().optional(),
    height: z.number().optional(),
    prompt: z.string().optional(),
    maskSkillId: z.string().optional(),
    maskSkillVersion: z.string().optional(),
    maskModel: z.string().optional(),
  }),
  detection: z.object({
    enabled: z.boolean(),
    allowReview: z.boolean().optional(),
    skillId: z.string().optional(),
    skillVersion: z.string().optional(),
    model: z.string().optional(),
    variables: z.record(z.unknown()).optional(),
    threshold: z
      .object({
        passMax: z.number().optional(),
        reviewMax: z.number().optional(),
      })
      .optional(),
    preprocess: z
      .object({
        compress: z.boolean().optional(),
        maxSize: z.number().optional(),
        format: z.enum(['jpg', 'png']).optional(),
        quality: z.number().optional(),
      })
      .optional(),
    concurrency: z.number().optional(),
    maxRetries: z.number().optional(),
  }),
  photoshop: z.object({
    enabled: z.boolean().optional(),
    templates: z.array(z.string()),
    outputRoot: z.string().optional(),
    replaceRange: z.enum(['auto', 'top', 'all']).optional(),
    format: z.enum(['jpg', 'png']).optional(),
    clipMode: z.enum(['none', 'auto', 'guides']).optional(),
    skipCompleted: z.boolean().optional(),
    maxRetries: z.number().optional(),
  }),
  title: z.object({
    enabled: z.boolean().optional(),
    platform: z.string(),
    language: z.string(),
    model: z.string(),
    titleFileName: z.string().optional(),
    imageIndex: z.number().optional(),
    extraRequirement: z.string().optional(),
    keywordGroups: z
      .array(
        z.object({
          prefix: z.string().optional(),
          suffix: z.string().optional(),
        }),
      )
      .optional(),
    keywordGroupSeparator: z.string().optional(),
    existingStrategy: z.enum(['skip', 'regenerate']).optional(),
    maxRetries: z.number().optional(),
    concurrency: z.number().optional(),
    preprocess: z
      .object({
        maxSize: z.number().optional(),
        compression: z.boolean().optional(),
        format: z.enum(['jpg', 'png']).optional(),
        quality: z.number().optional(),
      })
      .optional(),
  }),
})

const pipelineRunConfigSchema = pipelineRunConfigBaseSchema.superRefine((config, context) => {
  if (config.photoshop.enabled === false) {
    return
  }
  if (!config.printSkuCode) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: '启用 PS 套版时必须填写印花货号',
      path: ['printSkuCode'],
    })
  }
  if (config.photoshop.templates.length === 0) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: '启用 PS 套版时必须选择 PSD 模板',
      path: ['photoshop', 'templates'],
    })
  }
})

function workbenchDbPath(workbenchRoot: string) {
  return join(workbenchRoot, WORKBENCH_DIRECTORIES.metadata, 'workbench.db')
}

function openWorkbenchDatabase(workbenchRoot: string) {
  return openSqliteDatabase(workbenchDbPath(workbenchRoot))
}

function ensurePipelineColumn(
  db: Pick<SqliteDatabase, 'exec' | 'prepare'>,
  table: 'pipeline_runs',
  column: string,
  definition: string,
) {
  const rows = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name?: unknown }>
  if (rows.some((row) => row.name === column)) {
    return
  }
  db.exec(`ALTER TABLE ${table} ADD COLUMN ${definition}`)
}

function ensurePipelineTables(db: Pick<SqliteDatabase, 'exec' | 'prepare'>) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS pipeline_runs (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      source_mode TEXT NOT NULL,
      status TEXT NOT NULL,
      config_json TEXT NOT NULL,
      stats_json TEXT NOT NULL,
      result_sections_json TEXT DEFAULT '[]',
      logs_json TEXT DEFAULT '[]',
      error_summary TEXT,
      created_at INTEGER NOT NULL,
      started_at INTEGER,
      completed_at INTEGER
    );

    CREATE TABLE IF NOT EXISTS pipeline_steps (
      id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL,
      step_key TEXT NOT NULL,
      module TEXT NOT NULL,
      label TEXT NOT NULL,
      status TEXT NOT NULL,
      input_count INTEGER NOT NULL DEFAULT 0,
      output_count INTEGER NOT NULL DEFAULT 0,
      output_json TEXT,
      error_json TEXT,
      started_at INTEGER,
      completed_at INTEGER,
      updated_at INTEGER NOT NULL,
      UNIQUE(run_id, step_key)
    );

    CREATE INDEX IF NOT EXISTS idx_pipeline_runs_status ON pipeline_runs(status);
    CREATE INDEX IF NOT EXISTS idx_pipeline_steps_run ON pipeline_steps(run_id);
  `)
  ensurePipelineColumn(
    db,
    'pipeline_runs',
    'result_sections_json',
    "result_sections_json TEXT DEFAULT '[]'",
  )
  ensurePipelineColumn(db, 'pipeline_runs', 'logs_json', "logs_json TEXT DEFAULT '[]'")
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

function timestampSlug(value = Date.now()) {
  const date = new Date(value)
  const pad = (input: number) => String(input).padStart(2, '0')
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(
    date.getHours(),
  )}${pad(date.getMinutes())}${pad(date.getSeconds())}`
}

function safePathSegment(value: string) {
  return value.replace(/[\\/:*?"<>|]/g, '_').trim() || '完整任务'
}

function imageFileExtension(path: string) {
  const extension = extname(path).toLowerCase()
  return /\.(?:jpe?g|png|webp)$/i.test(extension) ? extension : '.png'
}

function printSkuName(prefix: string, index: number, total: number) {
  if (total === 1) {
    return prefix
  }
  return `${prefix}-${String(index + 1).padStart(2, '0')}`
}

function naturalCompare(left: string, right: string) {
  return left.localeCompare(right, 'zh-CN', { numeric: true, sensitivity: 'base' })
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

function referenceImageExtension(image: PipelineReferenceImageInput) {
  const nameExtension = extname(image.name).toLowerCase()
  if (IMAGE_EXTENSIONS.test(nameExtension)) {
    return nameExtension
  }
  if (image.mime_type === 'image/jpeg') {
    return '.jpg'
  }
  if (image.mime_type === 'image/webp') {
    return '.webp'
  }
  return '.png'
}

function decodeReferenceImageBase64(value: string) {
  const payload = value.includes(',') ? value.slice(value.indexOf(',') + 1) : value
  return Buffer.from(payload, 'base64')
}

async function imageReference(imagePath: string) {
  const buffer = await readFile(imagePath)
  return {
    base64: buffer.toString('base64'),
    mime_type: mimeTypeFromPath(imagePath),
  }
}

async function scanImageFiles(folder: string): Promise<string[]> {
  if (!folder.trim() || !isAbsolute(folder)) {
    throw new AppErrorClass('HTTP_4XX', '请选择有效的图片文件夹', false, { folder })
  }
  const folderStat = await stat(folder).catch(() => null)
  if (!folderStat?.isDirectory()) {
    throw new AppErrorClass('HTTP_4XX', '选择的路径不是文件夹', false, { folder })
  }

  const files: string[] = []
  async function visit(currentFolder: string) {
    const entries = await readdir(currentFolder, { withFileTypes: true })
    for (const entry of entries.sort((left, right) => naturalCompare(left.name, right.name))) {
      const entryPath = join(currentFolder, entry.name)
      if (entry.isDirectory()) {
        await visit(entryPath)
        continue
      }
      if (entry.isFile() && IMAGE_EXTENSIONS.test(entry.name)) {
        files.push(entryPath)
      }
    }
  }
  await visit(folder)
  return files.sort(naturalCompare)
}

function imagesFromPaths(paths: string[]): PipelineImage[] {
  return Array.from(new Set(paths.filter(Boolean))).map((path) => ({ path }))
}

function imagesFromGeneration(result: GenerationRunResult): PipelineImage[] {
  return result.images.flatMap((image) =>
    image.localPath
      ? [
          {
            path: image.localPath,
            ...(image.artifactId ? { artifactId: image.artifactId } : {}),
            ...(image.printId ? { printId: image.printId } : {}),
          },
        ]
      : [],
  )
}

function resultImageId(prefix: string, index: number, fallback?: string | undefined) {
  return `${prefix}-${fallback || index + 1}`
}

function resultImageFromPath(
  stepKey: PipelineStepKey,
  label: string,
  path: string,
  index: number,
): PipelineResultImage {
  return {
    id: resultImageId(stepKey, index, path),
    status: 'success',
    step_key: stepKey,
    label,
    local_path: path,
  }
}

function resultImageFromPipelineImage(
  stepKey: PipelineStepKey,
  label: string,
  image: PipelineImage,
  index: number,
): PipelineResultImage {
  return {
    ...resultImageFromPath(stepKey, label, image.path, index),
    ...(image.artifactId ? { artifact_id: image.artifactId } : {}),
    ...(image.printId ? { print_id: image.printId } : {}),
  }
}

function resultImageFromGenerationImage(
  stepKey: PipelineStepKey,
  image: GenerationRunImage,
  index: number,
): PipelineResultImage {
  return {
    id: resultImageId(stepKey, index, image.localPath ?? image.url),
    status: 'success',
    step_key: stepKey,
    label: image.printId ?? image.artifactId ?? `产物 ${index + 1}`,
    url: image.url,
    ...(image.localPath ? { local_path: image.localPath } : {}),
    ...(image.sourcePath ? { source_path: image.sourcePath } : {}),
    ...(image.prompt ? { prompt: image.prompt } : {}),
    ...(image.artifactId ? { artifact_id: image.artifactId } : {}),
    ...(image.printId ? { print_id: image.printId } : {}),
  }
}

function loadingResultImages(
  stepKey: PipelineStepKey,
  label: string,
  count: number,
): PipelineResultImage[] {
  return Array.from({ length: Math.max(0, count) }, (_item, index) => ({
    id: `${stepKey}-loading-${index + 1}`,
    status: 'loading',
    step_key: stepKey,
    label: `${label} ${index + 1}`,
  }))
}

function resultSection(input: {
  key: PipelineResultSectionKey
  title: string
  items: PipelineResultImage[]
  total?: number
  failed?: number
  paginated?: boolean
  defaultCollapsed?: boolean
}): PipelineResultSection {
  return {
    key: input.key,
    title: input.title,
    items: input.items,
    total: input.total ?? input.items.length,
    completed: input.items.filter((item) => item.status === 'success').length,
    failed: input.failed ?? 0,
    collapsible: true,
    default_collapsed: input.defaultCollapsed ?? false,
    paginated: input.paginated ?? false,
  }
}

function resultImageFromDetection(
  item: DetectionImageResult,
  allowed: boolean,
  index: number,
): PipelineResultImage | null {
  if (item.status === 'failed') {
    return null
  }
  return {
    id: resultImageId('detection', index, item.artifactId),
    status: 'success',
    step_key: 'detection',
    label: item.printId || item.artifactId || `检测 ${index + 1}`,
    local_path: item.outputPath,
    source_path: item.imagePath,
    artifact_id: item.artifactId,
    print_id: item.printId,
    risk_score: item.riskScore,
    risk_level: item.riskLevel,
    reason: item.reason,
    allowed,
  }
}

function usableGenerationImages(result: GenerationRunResult, stepName: string): PipelineImage[] {
  const images = imagesFromGeneration(result)
  if (images.length === 0) {
    throw new AppErrorClass('HTTP_4XX', `${stepName} 未产生可继续处理的印花`, false, {
      total: result.total,
      failed: result.failed,
    })
  }
  return images
}

function printAssetId(image: PipelineImage, index: number) {
  const raw = (image.printId ?? basename(image.path, extname(image.path))) || `print-${index + 1}`
  return safePathSegment(raw)
}

function printAssetsFromImages(images: PipelineImage[]): PhotoshopPrintAsset[] {
  return images.map((image, index) => ({
    id: printAssetId(image, index),
    file_path: image.path,
  }))
}

async function preparePhotoshopPrints(
  workbenchRoot: string,
  runId: string,
  prints: PipelineImage[],
  printSkuCode: string | undefined,
): Promise<PipelineImage[]> {
  const prefix = printSkuCode?.trim()
  if (!prefix) {
    return prints
  }
  const parsed = SkuCodeSchema.safeParse(prefix)
  if (!parsed.success) {
    throw new AppErrorClass(
      'INVALID_INPUT',
      '印花货号只能使用英文、数字、短横线和下划线，长度 1-60',
      false,
      { printSkuCode },
    )
  }

  const waitingFolder = join(
    workbenchRoot,
    WORKBENCH_DIRECTORIES.generation,
    WAITING_PHOTOSHOP_PRINT_FOLDER,
    safePathSegment(runId),
  )
  await mkdir(waitingFolder, { recursive: true })

  return Promise.all(
    prints.map(async (image, index) => {
      const printName = printSkuName(parsed.data, index, prints.length)
      const targetPath = join(waitingFolder, `${printName}${imageFileExtension(image.path)}`)
      await copyFile(image.path, targetPath)
      return { path: targetPath }
    }),
  )
}

function parseStats(value: string): PipelineRunStats {
  try {
    return { ...DEFAULT_STATS, ...(JSON.parse(value) as Partial<PipelineRunStats>) }
  } catch {
    return { ...DEFAULT_STATS }
  }
}

function parsePipelineRunConfig(input: unknown): PipelineRunConfig {
  const parsed = pipelineRunConfigSchema.safeParse(input)
  if (!parsed.success) {
    throw new AppErrorClass('INVALID_INPUT', '完整任务参数无效', false, {
      issues: parsed.error.issues,
    })
  }
  return parsed.data as PipelineRunConfig
}

function printSkuLockKey(config: PipelineRunConfig) {
  if (config.photoshop.enabled === false || !config.printSkuCode) {
    return null
  }
  return config.printSkuCode.trim().toLowerCase()
}

function runConfigSourceHasReferences(
  source: PipelineSourceConfig,
): source is Extract<PipelineSourceConfig, { mode: 'img2img' }> {
  return source.mode === 'img2img' && Boolean(source.referenceImagePaths?.length)
}

function optionalJsonText(value: unknown) {
  return typeof value === 'string' ? value : null
}

function readRunRow(db: Pick<SqliteDatabase, 'prepare'>, runId: string) {
  const row = db.prepare('SELECT * FROM pipeline_runs WHERE id = ?').get(runId)
  return normalizePipelineRunRecord(row)
}

function normalizePipelineRunRecord(value: unknown): PipelineRunRecord | null {
  if (!value || typeof value !== 'object') {
    return null
  }
  const row = value as Record<string, unknown>
  const id = row.id
  const name = row.name
  const sourceMode = row.source_mode
  const status = row.status
  const configJson = row.config_json
  const statsJson = row.stats_json
  const createdAt = row.created_at
  const isValid =
    typeof id === 'string' &&
    typeof name === 'string' &&
    typeof sourceMode === 'string' &&
    typeof status === 'string' &&
    typeof configJson === 'string' &&
    typeof statsJson === 'string' &&
    typeof createdAt === 'number'
  if (!isValid) {
    return null
  }
  return {
    id,
    name,
    source_mode: sourceMode as PipelineSourceConfig['mode'],
    status: status as PipelineRunStatus,
    config_json: configJson,
    stats_json: statsJson,
    result_sections_json: optionalJsonText(row.result_sections_json),
    logs_json: optionalJsonText(row.logs_json),
    error_summary: typeof row.error_summary === 'string' ? row.error_summary : null,
    created_at: createdAt,
    started_at: typeof row.started_at === 'number' ? row.started_at : null,
    completed_at: typeof row.completed_at === 'number' ? row.completed_at : null,
  }
}

function isPipelineStepRecord(value: unknown): value is PipelineStepRecord {
  if (!value || typeof value !== 'object') {
    return false
  }
  const row = value as Record<string, unknown>
  return (
    typeof row.id === 'string' &&
    typeof row.run_id === 'string' &&
    typeof row.step_key === 'string' &&
    typeof row.module === 'string' &&
    typeof row.label === 'string' &&
    typeof row.status === 'string' &&
    typeof row.input_count === 'number' &&
    typeof row.output_count === 'number' &&
    typeof row.updated_at === 'number'
  )
}

function readStepRows(db: Pick<SqliteDatabase, 'prepare'>, runId: string) {
  const rows = db
    .prepare(
      `
        SELECT *
        FROM pipeline_steps
        WHERE run_id = ?
        ORDER BY started_at IS NULL, started_at ASC, updated_at ASC
      `,
    )
    .all(runId) as unknown[]
  return rows.filter(isPipelineStepRecord)
}

function parseJsonArray<T>(value: string | null | undefined): T[] {
  if (!value) {
    return []
  }
  try {
    const parsed = JSON.parse(value)
    return Array.isArray(parsed) ? (parsed as T[]) : []
  } catch {
    return []
  }
}

function generationFailureReasons(result: GenerationRunResult) {
  const counts = new Map<string, number>()
  for (const failure of result.failures) {
    const reason = failure.error.trim().replace(/\s+/g, ' ').slice(0, 160) || '未知原因'
    counts.set(reason, (counts.get(reason) ?? 0) + 1)
  }
  return Array.from(counts.entries())
    .slice(0, 5)
    .map(([reason, count]) => `${reason} x${count}`)
    .join('；')
}

function readRunDetail(
  db: Pick<SqliteDatabase, 'prepare'>,
  runId: string,
): PipelineRunDetail | null {
  const run = readRunRow(db, runId)
  if (!run) {
    return null
  }
  return {
    run,
    steps: readStepRows(db, runId),
    result_sections: parseJsonArray<PipelineResultSection>(run.result_sections_json),
    logs: parseJsonArray<PipelineRuntimeLogEntry>(run.logs_json),
  }
}

function defaultOutputRoot(workbenchRoot: string) {
  return join(workbenchRoot, WORKBENCH_DIRECTORIES.listing)
}

function ensurePromptList(prompts: string[] | undefined) {
  const parsed = (prompts ?? []).map((prompt) => prompt.trim()).filter(Boolean)
  if (parsed.length === 0) {
    throw new AppErrorClass('HTTP_4XX', '请至少准备一条提示词', false)
  }
  return parsed
}

function grsaiOptionalFields(config: PipelineGrsaiImageConfig) {
  const fields: { imageSize?: '1K' | '2K' | '4K' } = {}
  if (config.imageSize) {
    fields.imageSize = config.imageSize
  }
  return fields
}

function comfyuiOptionalFields(config: PipelineComfyuiWorkflowConfig) {
  const fields: {
    workflowName?: string
    workflowVersion?: string
    instanceUuid?: string
    width?: number
    height?: number
    concurrency?: number
  } = {}
  if (config.workflowName) {
    fields.workflowName = config.workflowName
  }
  if (config.workflowVersion) {
    fields.workflowVersion = config.workflowVersion
  }
  if (config.instanceUuid) {
    fields.instanceUuid = config.instanceUuid
  }
  if (config.width !== undefined) {
    fields.width = config.width
  }
  if (config.height !== undefined) {
    fields.height = config.height
  }
  if (config.concurrency !== undefined) {
    fields.concurrency = config.concurrency
  }
  return fields
}

function mattingOptionalFields(config: PipelineMattingConfig) {
  const fields: {
    workflowName?: string
    workflowVersion?: string
    instanceUuid?: string
    width?: number
    height?: number
    prompt?: string
    maskSkillId?: string
    maskSkillVersion?: string
    maskModel?: string
  } = {}
  if (config.workflowName) {
    fields.workflowName = config.workflowName
  }
  if (config.workflowVersion) {
    fields.workflowVersion = config.workflowVersion
  }
  if (config.instanceUuid) {
    fields.instanceUuid = config.instanceUuid
  }
  if (config.width !== undefined) {
    fields.width = config.width
  }
  if (config.height !== undefined) {
    fields.height = config.height
  }
  if (config.prompt) {
    fields.prompt = config.prompt
  }
  if (config.maskSkillId) {
    fields.maskSkillId = config.maskSkillId
  }
  if (config.maskSkillVersion) {
    fields.maskSkillVersion = config.maskSkillVersion
  }
  if (config.maskModel) {
    fields.maskModel = config.maskModel
  }
  return fields
}

async function resolvePrompts(
  prompt: PipelinePromptConfig,
  capability: 'txt2img' | 'img2img',
  printMode: PipelineRunConfig['printMode'],
  referenceImages?: Array<{ base64: string; mime_type: string }>,
) {
  if (prompt.mode === 'manual') {
    return ensurePromptList(prompt.prompts)
  }
  if (!prompt.requirement?.trim()) {
    throw new AppErrorClass('HTTP_4XX', 'AI 生成提示词需要填写印花要求', false)
  }
  const input: GenerationPromptInput = {
    capability,
    printMode,
    requirement: prompt.requirement,
    count: prompt.count ?? 5,
    ...(referenceImages?.length ? { referenceImages } : {}),
    ...(prompt.model ? { model: prompt.model } : {}),
    ...(prompt.modeInstruction ? { modeInstruction: prompt.modeInstruction } : {}),
    ...(prompt.skillId ? { skillId: prompt.skillId } : {}),
    ...(prompt.skillVersion ? { skillVersion: prompt.skillVersion } : {}),
  }
  const drafts = await generateTxt2imgPrompts(input)
  return ensurePromptList(drafts.filter((draft) => draft.selected).map((draft) => draft.text))
}

function emitPipelineProgress(progress: PipelineProgress) {
  for (const window of BrowserWindow.getAllWindows()) {
    window.webContents.send('pipeline:progress', progress)
  }
}

function emitPipelineCompleted(event: PipelineTaskEvent) {
  for (const window of BrowserWindow.getAllWindows()) {
    window.webContents.send('pipeline:completed', event)
  }
}

function emitGenerationProgressAsPipeline(
  runId: string,
  stepKey: PipelineStepKey,
  emitProgress: (message: string) => void,
  emitPreviewImages?: (images: GenerationRunImage[], total: number, failed: number) => void,
) {
  return (progress: GenerationProgress) => {
    if (progress.images) {
      emitPreviewImages?.(progress.images, progress.total, progress.failed)
    }
    emitProgress(
      `${stepKey}：${progress.processed}/${progress.total}，成功 ${progress.succeeded}，失败 ${progress.failed}`,
    )
  }
}

export class PipelineService {
  private readonly activeRuns = new Map<string, ActivePipelineRun>()
  private readonly activePrintSkuRuns = new Map<string, string>()
  private readonly photoshopMutex = new PromiseMutex()

  startRun(config: PipelineRunConfig) {
    const runId = randomUUID()
    void this.runPipeline(runId, config)
      .then((detail) => emitPipelineCompleted({ ok: true, result: detail }))
      .catch((error) =>
        emitPipelineCompleted({ ok: false, run_id: runId, error: appErrorMessage(error) }),
      )
    return runId
  }

  cancelRun(runId: string) {
    const active = this.activeRuns.get(runId)
    if (!active) {
      return false
    }
    active.cancelled = true
    void active.currentCancel?.()
    return true
  }

  async listRuns(): Promise<PipelineRunRecord[]> {
    const workbenchRoot = await this.readWorkbenchRoot()
    const db = openWorkbenchDatabase(workbenchRoot)
    try {
      ensurePipelineTables(db)
      const rows = db
        .prepare('SELECT * FROM pipeline_runs ORDER BY created_at DESC LIMIT 100')
        .all() as unknown[]
      return rows
        .map(normalizePipelineRunRecord)
        .filter((row): row is PipelineRunRecord => Boolean(row))
    } finally {
      db.close()
    }
  }

  async getRun(runId: string): Promise<PipelineRunDetail | null> {
    const workbenchRoot = await this.readWorkbenchRoot()
    const db = openWorkbenchDatabase(workbenchRoot)
    try {
      ensurePipelineTables(db)
      return readRunDetail(db, runId)
    } finally {
      db.close()
    }
  }

  async runPipeline(runId: string, config: PipelineRunConfig): Promise<PipelineRunDetail> {
    const parsedConfig = parsePipelineRunConfig(config)
    if (process.platform === 'darwin' && parsedConfig.photoshop.enabled !== false) {
      throw new AppErrorClass(
        'HTTP_4XX',
        '完整任务包含 PS 套版，当前 v1 仅支持在 Windows 执行',
        false,
      )
    }
    const activePrintSkuLock = this.acquirePrintSkuLock(runId, parsedConfig)
    try {
      const workbenchRoot = await this.readWorkbenchRoot()
      await this.assertRunConfigPaths(workbenchRoot, parsedConfig)
      const runConfig = await this.normalizeRunConfig(workbenchRoot, runId, parsedConfig)
      const db = openWorkbenchDatabase(workbenchRoot)
      const active: ActivePipelineRun = {
        db,
        cancelled: false,
        currentCancel: null,
        previewImages: [],
        resultSections: [],
        logs: [],
        collectionReadLock: null,
      }
      this.activeRuns.set(runId, active)
      const stats: PipelineRunStats = { ...DEFAULT_STATS }
      const runName = runConfig.name?.trim() || `完整任务-${timestampSlug()}`

      try {
        active.collectionReadLock =
          runConfig.source.mode === 'collection'
            ? collectionFolderLock.acquireRead(runConfig.source.sourceFolder, {
                kind: 'pipeline',
                runId,
              })
            : null
        ensurePipelineTables(db)
        this.createRun(db, runId, runName, runConfig)
        this.appendLog(runId, {
          level: 'info',
          message: '完整任务已启动',
          details: { sourceMode: runConfig.source.mode, printMode: runConfig.printMode },
        })
        this.emitRunProgress(db, runId, 'running', null, stats, '完整任务已启动')

        const sourceImages = await this.runSourceStep(db, active, runId, runConfig, stats)
        let prints = sourceImages.prints

        if (sourceImages.extractSources.length > 0) {
          prints = await this.runExtractStep(
            db,
            active,
            runId,
            runConfig.source,
            sourceImages.extractSources,
            stats,
          )
        }

        if (runConfig.matting.enabled) {
          prints = await this.runMattingStep(db, active, runId, runConfig.matting, prints, stats)
        } else {
          this.recordSkippedStep(db, runId, 'matting', 'generation', '抠图', prints.length)
        }

        if (runConfig.detection.enabled) {
          prints = await this.runDetectionStep(
            db,
            active,
            runId,
            runConfig.detection,
            prints,
            stats,
          )
        } else {
          this.recordSkippedStep(db, runId, 'detection', 'detection', '侵权检测', prints.length)
        }

        if (runConfig.photoshop.enabled === false) {
          this.recordSkippedStep(db, runId, 'photoshop', 'photoshop', 'PS 套版', prints.length)
          this.recordSkippedStep(db, runId, 'title', 'title', '标题生成', prints.length)
        } else {
          const photoshopResult = await this.runPhotoshopStep(
            db,
            active,
            runId,
            workbenchRoot,
            runConfig,
            prints,
            stats,
          )
          if (runConfig.title.enabled === false) {
            this.recordSkippedStep(
              db,
              runId,
              'title',
              'title',
              '标题生成',
              photoshopResult.result.templates.length,
            )
          } else {
            await this.runTitleStep(db, active, runId, runConfig, photoshopResult, stats)
          }
        }

        this.assertNotCancelled(active)
        this.appendLog(runId, { level: 'info', message: '完整任务完成' })
        this.completeRun(db, runId, 'completed', stats, null)
        return this.requireRunDetail(db, runId)
      } catch (error) {
        const status: PipelineRunStatus = active.cancelled ? 'cancelled' : 'failed'
        this.appendLog(runId, {
          level: active.cancelled ? 'warn' : 'error',
          message: active.cancelled ? '完整任务已取消' : '完整任务失败',
          details: { error: appErrorMessage(error) },
        })
        this.completeRun(db, runId, status, stats, appErrorMessage(error))
        throw error
      } finally {
        active.collectionReadLock?.release()
        db.close()
        this.activeRuns.delete(runId)
      }
    } finally {
      this.releasePrintSkuLock(activePrintSkuLock, runId)
    }
  }

  private acquirePrintSkuLock(runId: string, config: PipelineRunConfig) {
    const lockKey = printSkuLockKey(config)
    if (!lockKey) {
      return null
    }
    const activeRunId = this.activePrintSkuRuns.get(lockKey)
    if (activeRunId) {
      throw new AppErrorClass(
        'HTTP_4XX',
        `印花货号 ${config.printSkuCode} 已有进行中完整任务，请等待或取消后再启动`,
        false,
        { activeRunId, printSkuCode: config.printSkuCode },
      )
    }
    this.activePrintSkuRuns.set(lockKey, runId)
    return lockKey
  }

  private releasePrintSkuLock(lockKey: string | null, runId: string) {
    if (lockKey && this.activePrintSkuRuns.get(lockKey) === runId) {
      this.activePrintSkuRuns.delete(lockKey)
    }
  }

  private async readWorkbenchRoot() {
    const config = await readAppConfig()
    if (!config.workbench_root) {
      throw new AppErrorClass('HTTP_4XX', '请先在设置里选择工作区', false)
    }
    return config.workbench_root
  }

  private async normalizeRunConfig(
    workbenchRoot: string,
    runId: string,
    config: PipelineRunConfig,
  ): Promise<PipelineRunConfig> {
    if (config.source.mode !== 'img2img' || !config.source.referenceImages?.length) {
      return config
    }

    const referenceFolder = join(
      workbenchRoot,
      WORKBENCH_DIRECTORIES.metadata,
      PIPELINE_RUNS_FOLDER,
      safePathSegment(runId),
      'references',
    )
    await mkdir(referenceFolder, { recursive: true })
    const referenceImagePaths = await Promise.all(
      config.source.referenceImages.map(async (image, index) => {
        const baseName = safePathSegment(basename(image.name, extname(image.name)))
        const targetPath = join(
          referenceFolder,
          `${String(index + 1).padStart(2, '0')}-${baseName}${referenceImageExtension(image)}`,
        )
        await writeFile(targetPath, decodeReferenceImageBase64(image.base64))
        return targetPath
      }),
    )

    const { referenceImages: _referenceImages, ...sourceWithoutUploads } = config.source
    return {
      ...config,
      source: {
        ...sourceWithoutUploads,
        referenceImagePaths,
      },
    }
  }

  private async assertRunConfigPaths(workbenchRoot: string, config: PipelineRunConfig) {
    if (config.source.mode === 'collection') {
      await assertPathInsideWorkbench(workbenchRoot, config.source.sourceFolder, {
        domain: 'collection',
        label: '完整任务采集来源目录',
      })
    }
    if (config.source.mode === 'existing_prints') {
      await assertPathInsideWorkbench(workbenchRoot, config.source.printFolder, {
        domain: 'generation',
        label: '完整任务印花来源目录',
      })
    }
    if (config.source.mode === 'img2img') {
      if (config.source.sourceFolder) {
        await assertPathInsideWorkbench(workbenchRoot, config.source.sourceFolder, {
          domain: 'generation',
          label: '完整任务图生图来源目录',
        })
      }
      for (const referencePath of config.source.referenceImagePaths ?? []) {
        await assertPathInsideWorkbench(workbenchRoot, referencePath, {
          domain: 'local-image',
          label: '完整任务图生图参考图',
        })
      }
    }
    if (config.photoshop.enabled && config.photoshop.outputRoot) {
      await assertPathInsideWorkbench(workbenchRoot, config.photoshop.outputRoot, {
        domain: 'listing',
        label: '完整任务套版输出目录',
      })
    }
  }

  private createRun(
    db: Pick<SqliteDatabase, 'prepare'>,
    runId: string,
    name: string,
    config: PipelineRunConfig,
  ) {
    const now = Date.now()
    db.prepare(
      `
        INSERT INTO pipeline_runs (
          id,
          name,
          source_mode,
          status,
          config_json,
          stats_json,
          result_sections_json,
          logs_json,
          error_summary,
          created_at,
          started_at,
          completed_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, NULL)
      `,
    ).run(
      runId,
      name,
      config.source.mode,
      'running',
      JSON.stringify(config),
      JSON.stringify(DEFAULT_STATS),
      '[]',
      '[]',
      now,
      now,
    )
  }

  private completeRun(
    db: Pick<SqliteDatabase, 'prepare'>,
    runId: string,
    status: PipelineRunStatus,
    stats: PipelineRunStats,
    error: string | null,
  ) {
    db.prepare(
      `
        UPDATE pipeline_runs
        SET status = ?,
            stats_json = ?,
            error_summary = ?,
            completed_at = ?
        WHERE id = ?
      `,
    ).run(status, JSON.stringify(stats), error, Date.now(), runId)
    this.emitRunProgress(db, runId, status, null, stats, error ?? '完整任务完成')
  }

  private requireRunDetail(db: Pick<SqliteDatabase, 'prepare'>, runId: string): PipelineRunDetail {
    const detail = readRunDetail(db, runId)
    if (!detail) {
      throw new AppErrorClass('HTTP_5XX', '完整任务记录缺失', true, { runId })
    }
    return detail
  }

  private persistRunUiState(runId: string, active: ActivePipelineRun) {
    active.db
      .prepare(
        `
          UPDATE pipeline_runs
          SET result_sections_json = ?,
              logs_json = ?
          WHERE id = ?
        `,
      )
      .run(JSON.stringify(active.resultSections), JSON.stringify(active.logs), runId)
  }

  private sortResultSections(sections: PipelineResultSection[]) {
    return [...sections].sort((left, right) => {
      const leftIndex = RESULT_SECTION_ORDER.indexOf(left.key)
      const rightIndex = RESULT_SECTION_ORDER.indexOf(right.key)
      return (
        (leftIndex === -1 ? RESULT_SECTION_ORDER.length : leftIndex) -
        (rightIndex === -1 ? RESULT_SECTION_ORDER.length : rightIndex)
      )
    })
  }

  private emitRunProgress(
    db: Pick<SqliteDatabase, 'prepare'>,
    runId: string,
    status: PipelineRunStatus,
    currentStep: PipelineStepKey | null,
    stats: PipelineRunStats,
    message: string,
  ) {
    const active = this.activeRuns.get(runId)
    const previewImages = active?.previewImages
    const persistedDetail = active ? null : readRunDetail(db, runId)
    emitPipelineProgress({
      run_id: runId,
      status,
      current_step: currentStep,
      message,
      stats: { ...stats },
      steps: readStepRows(db, runId),
      ...(previewImages ? { preview_images: previewImages } : {}),
      result_sections: active?.resultSections ?? persistedDetail?.result_sections ?? [],
      logs: active?.logs ?? persistedDetail?.logs ?? [],
    })
  }

  private updateResultSection(runId: string, section: PipelineResultSection) {
    const active = this.activeRuns.get(runId)
    if (!active) {
      return
    }
    active.resultSections = [
      ...active.resultSections.filter((item) => item.key !== section.key),
      section,
    ]
    active.resultSections = this.sortResultSections(active.resultSections)
    this.persistRunUiState(runId, active)
  }

  private appendLog(runId: string, input: Omit<PipelineRuntimeLogEntry, 'id' | 'created_at'>) {
    const active = this.activeRuns.get(runId)
    if (!active) {
      return
    }
    active.logs = [
      ...active.logs,
      {
        id: `${Date.now()}-${active.logs.length + 1}`,
        created_at: Date.now(),
        ...input,
      },
    ].slice(-1000)
    this.persistRunUiState(runId, active)
  }

  private appendGenerationFailureLog(
    runId: string,
    stepKey: PipelineStepKey,
    label: string,
    result: GenerationRunResult,
  ) {
    if (result.failed <= 0) {
      return
    }
    this.appendLog(runId, {
      level: 'warn',
      step_key: stepKey,
      message: `${label}失败 ${result.failed} 张`,
      details: {
        total: result.total,
        failed: result.failed,
        reasons: generationFailureReasons(result) || '未返回失败原因',
      },
    })
  }

  private updateGenerationPreviewImages(
    db: Pick<SqliteDatabase, 'prepare'>,
    runId: string,
    stepKey: PipelineStepKey,
    stats: PipelineRunStats,
    message: string,
    images: GenerationRunImage[],
    expectedTotal?: number | undefined,
    failedCount = 0,
  ) {
    const active = this.activeRuns.get(runId)
    if (!active) {
      return
    }
    active.previewImages = images.map((image) => ({
      step_key: stepKey,
      prompt: image.prompt,
      url: image.url,
      ...(image.localPath ? { local_path: image.localPath } : {}),
      ...(image.sourcePath ? { source_path: image.sourcePath } : {}),
      ...(image.artifactId ? { artifact_id: image.artifactId } : {}),
      ...(image.printId ? { print_id: image.printId } : {}),
    }))
    const items = images.map((image, index) =>
      resultImageFromGenerationImage(stepKey, image, index),
    )
    const total = expectedTotal ?? items.length + failedCount
    const loadingCount = Math.max(0, total - items.length - failedCount)
    this.updateResultSection(
      runId,
      resultSection({
        key: IMAGE_PROCESSING_SECTION_KEY,
        title: '图像处理',
        items: [...items, ...loadingResultImages(stepKey, '图像加载中', loadingCount)],
        total,
        failed: failedCount,
      }),
    )
    this.emitRunProgress(db, runId, 'running', stepKey, stats, message)
  }

  private assertNotCancelled(active: ActivePipelineRun) {
    if (active.cancelled) {
      throw new AppErrorClass('HTTP_4XX', '完整任务已取消', false)
    }
  }

  private async executeStep<T>(
    db: Pick<SqliteDatabase, 'prepare'>,
    active: ActivePipelineRun,
    input: {
      runId: string
      stepKey: PipelineStepKey
      module: string
      label: string
      inputCount: number
      stats: PipelineRunStats
      message: string
      run: (
        emitMessage: (message: string) => void,
      ) => Promise<{ output: T; outputCount: number; outputJson?: unknown }>
    },
  ): Promise<T> {
    this.assertNotCancelled(active)
    const now = Date.now()
    db.prepare(
      `
        INSERT INTO pipeline_steps (
          id,
          run_id,
          step_key,
          module,
          label,
          status,
          input_count,
          output_count,
          output_json,
          error_json,
          started_at,
          completed_at,
          updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, 0, NULL, NULL, ?, NULL, ?)
        ON CONFLICT(run_id, step_key) DO UPDATE SET
          status = excluded.status,
          input_count = excluded.input_count,
          output_count = 0,
          output_json = NULL,
          error_json = NULL,
          started_at = excluded.started_at,
          completed_at = NULL,
          updated_at = excluded.updated_at
      `,
    ).run(
      `${input.runId}:${input.stepKey}`,
      input.runId,
      input.stepKey,
      input.module,
      input.label,
      'running',
      input.inputCount,
      now,
      now,
    )
    this.appendLog(input.runId, {
      level: 'info',
      step_key: input.stepKey,
      message: `${input.label}开始`,
      details: { inputCount: input.inputCount },
    })
    this.emitRunProgress(db, input.runId, 'running', input.stepKey, input.stats, input.message)

    const emitMessage = (message: string) => {
      this.appendLog(input.runId, {
        level: 'info',
        step_key: input.stepKey,
        message,
      })
      this.emitRunProgress(db, input.runId, 'running', input.stepKey, input.stats, message)
    }

    try {
      const result = await input.run(emitMessage)
      this.assertNotCancelled(active)
      db.prepare(
        `
          UPDATE pipeline_steps
          SET status = ?,
              output_count = ?,
              output_json = ?,
              error_json = NULL,
              completed_at = ?,
              updated_at = ?
          WHERE run_id = ? AND step_key = ?
        `,
      ).run(
        'completed',
        result.outputCount,
        JSON.stringify(result.outputJson ?? null),
        Date.now(),
        Date.now(),
        input.runId,
        input.stepKey,
      )
      this.appendLog(input.runId, {
        level: 'info',
        step_key: input.stepKey,
        message: `${input.label}完成`,
        details: { outputCount: result.outputCount },
      })
      this.emitRunProgress(
        db,
        input.runId,
        'running',
        input.stepKey,
        input.stats,
        `${input.label}完成`,
      )
      return result.output
    } catch (error) {
      db.prepare(
        `
          UPDATE pipeline_steps
          SET status = ?,
              error_json = ?,
              completed_at = ?,
              updated_at = ?
          WHERE run_id = ? AND step_key = ?
        `,
      ).run(
        active.cancelled ? 'cancelled' : 'failed',
        JSON.stringify({ message: appErrorMessage(error) }),
        Date.now(),
        Date.now(),
        input.runId,
        input.stepKey,
      )
      this.appendLog(input.runId, {
        level: active.cancelled ? 'warn' : 'error',
        step_key: input.stepKey,
        message: active.cancelled ? `${input.label}已取消` : `${input.label}失败`,
        details: { error: appErrorMessage(error) },
      })
      this.emitRunProgress(
        db,
        input.runId,
        active.cancelled ? 'cancelled' : 'failed',
        input.stepKey,
        input.stats,
        appErrorMessage(error),
      )
      throw error
    }
  }

  private recordSkippedStep(
    db: Pick<SqliteDatabase, 'prepare'>,
    runId: string,
    stepKey: PipelineStepKey,
    module: string,
    label: string,
    inputCount: number,
  ) {
    const now = Date.now()
    db.prepare(
      `
        INSERT INTO pipeline_steps (
          id,
          run_id,
          step_key,
          module,
          label,
          status,
          input_count,
          output_count,
          output_json,
          error_json,
          started_at,
          completed_at,
          updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL, ?, ?)
        ON CONFLICT(run_id, step_key) DO UPDATE SET
          status = excluded.status,
          input_count = excluded.input_count,
          output_count = excluded.output_count,
          completed_at = excluded.completed_at,
          updated_at = excluded.updated_at
      `,
    ).run(
      `${runId}:${stepKey}`,
      runId,
      stepKey,
      module,
      label,
      'skipped',
      inputCount,
      inputCount,
      now,
      now,
    )
    this.appendLog(runId, {
      level: 'info',
      step_key: stepKey,
      message: `${label}已跳过`,
      details: { inputCount },
    })
  }

  private async runSourceStep(
    db: Pick<SqliteDatabase, 'prepare'>,
    active: ActivePipelineRun,
    runId: string,
    config: PipelineRunConfig,
    stats: PipelineRunStats,
  ) {
    return this.executeStep(db, active, {
      runId,
      stepKey: 'source',
      module: config.source.mode === 'existing_prints' ? 'generation' : config.source.mode,
      label: '准备来源',
      inputCount: 0,
      stats,
      message: '正在准备来源',
      run: async (emitMessage) => {
        if (runConfigSourceHasReferences(config.source)) {
          const referencePaths = config.source.referenceImagePaths ?? []
          this.updateResultSection(
            runId,
            resultSection({
              key: 'reference_images',
              title: '参考图',
              items: referencePaths.map((path, index) =>
                resultImageFromPath('source', basename(path), path, index),
              ),
              paginated: true,
              defaultCollapsed: true,
            }),
          )
        }
        const output = await this.resolveSourceImages(
          runId,
          config,
          emitMessage,
          (images, total, failed) =>
            this.updateGenerationPreviewImages(
              db,
              runId,
              'source',
              stats,
              '正在生成来源图片',
              images,
              total,
              failed,
            ),
        )
        stats.sourceImages = output.extractSources.length
        stats.prints = output.prints.length
        if (output.extractSources.length > 0) {
          this.updateResultSection(
            runId,
            resultSection({
              key: 'source_images',
              title: '采集图',
              items: output.extractSources.map((image, index) =>
                resultImageFromPipelineImage('source', basename(image.path), image, index),
              ),
              paginated: true,
              defaultCollapsed: true,
            }),
          )
        }
        if (output.prints.length > 0 && config.source.mode === 'existing_prints') {
          this.updateResultSection(
            runId,
            resultSection({
              key: IMAGE_PROCESSING_SECTION_KEY,
              title: '图像处理',
              items: output.prints.map((image, index) =>
                resultImageFromPipelineImage('source', basename(image.path), image, index),
              ),
              total: output.prints.length,
            }),
          )
        }
        return {
          output,
          outputCount: output.extractSources.length + output.prints.length,
          outputJson: {
            extractSourceCount: output.extractSources.length,
            printCount: output.prints.length,
          },
        }
      },
    })
  }

  private async resolveSourceImages(
    runId: string,
    config: PipelineRunConfig,
    emitMessage: (message: string) => void,
    emitPreviewImages: (images: GenerationRunImage[], total: number, failed: number) => void,
  ): Promise<{ extractSources: PipelineImage[]; prints: PipelineImage[] }> {
    const source = config.source
    if (source.mode === 'collection') {
      const paths = await scanImageFiles(source.sourceFolder)
      if (paths.length === 0) {
        throw new AppErrorClass('HTTP_4XX', '采集目录里没有可提取的图片', false)
      }
      return { extractSources: imagesFromPaths(paths), prints: [] }
    }

    if (source.mode === 'existing_prints') {
      const paths = await scanImageFiles(source.printFolder)
      if (paths.length === 0) {
        throw new AppErrorClass('HTTP_4XX', '印花目录里没有可套版图片', false)
      }
      return { extractSources: [], prints: imagesFromPaths(paths) }
    }

    if (source.mode === 'txt2img') {
      const prompts = await resolvePrompts(source.prompt, 'txt2img', config.printMode)
      emitMessage(`文生图提示词 ${prompts.length} 条`)
      if (!source.grsai) {
        throw new AppErrorClass('HTTP_4XX', '文生图缺少 Grsai 配置', false)
      }
      emitPreviewImages([], prompts.length, 0)
      const result = await runTxt2imgBatch(
        {
          capability: 'txt2img',
          prompts,
          model: source.grsai.model,
          aspectRatio: source.grsai.aspectRatio,
          concurrency: source.grsai.concurrency ?? 3,
          taskId: `${runId}-txt2img`,
          ...grsaiOptionalFields(source.grsai),
        },
        {
          emitProgress: emitGenerationProgressAsPipeline(
            runId,
            'source',
            emitMessage,
            emitPreviewImages,
          ),
        },
      )
      emitPreviewImages(result.images, result.total, result.failed)
      this.appendGenerationFailureLog(runId, 'source', '文生图', result)
      return { extractSources: [], prints: usableGenerationImages(result, '文生图') }
    }

    const sourcePaths = source.referenceImagePaths?.length
      ? source.referenceImagePaths
      : source.sourceFolder
        ? await scanImageFiles(source.sourceFolder)
        : []
    if (sourcePaths.length === 0) {
      throw new AppErrorClass('HTTP_4XX', '请先添加至少一张图生图参考图', false)
    }
    if (!source.grsai) {
      throw new AppErrorClass('HTTP_4XX', '图生图缺少 Grsai 配置', false)
    }
    const references = source.sendReferenceImages
      ? await Promise.all(sourcePaths.map((imagePath) => imageReference(imagePath)))
      : undefined
    const promptReferences = await Promise.all(
      sourcePaths.slice(0, 4).map((imagePath) => imageReference(imagePath)),
    )
    const prompts = await resolvePrompts(
      source.prompt,
      'img2img',
      config.printMode,
      promptReferences,
    )
    emitPreviewImages([], prompts.length, 0)
    const result = await runTxt2imgBatch(
      {
        capability: 'img2img',
        prompts,
        model: source.grsai.model,
        aspectRatio: source.grsai.aspectRatio,
        concurrency: source.grsai.concurrency ?? 3,
        taskId: `${runId}-img2img`,
        ...(references?.length ? { referenceImages: references } : {}),
        ...grsaiOptionalFields(source.grsai),
      },
      {
        emitProgress: emitGenerationProgressAsPipeline(
          runId,
          'source',
          emitMessage,
          emitPreviewImages,
        ),
      },
    )
    emitPreviewImages(result.images, result.total, result.failed)
    this.appendGenerationFailureLog(runId, 'source', '图生图', result)
    return { extractSources: [], prints: usableGenerationImages(result, '图生图') }
  }

  private async runExtractStep(
    db: Pick<SqliteDatabase, 'prepare'>,
    active: ActivePipelineRun,
    runId: string,
    source: PipelineSourceConfig,
    sourceImages: PipelineImage[],
    stats: PipelineRunStats,
  ) {
    if (source.mode !== 'collection') {
      return []
    }
    return this.executeStep(db, active, {
      runId,
      stepKey: 'extract',
      module: 'generation',
      label: '提取',
      inputCount: sourceImages.length,
      stats,
      message: '正在从采集原图提取印花',
      run: async (emitMessage) => {
        this.updateResultSection(
          runId,
          resultSection({
            key: IMAGE_PROCESSING_SECTION_KEY,
            title: '图像处理',
            items: loadingResultImages('extract', '图像加载中', sourceImages.length),
            total: sourceImages.length,
          }),
        )
        this.emitRunProgress(db, runId, 'running', 'extract', stats, '正在提取印花')
        const result = await this.runExtractConfig(
          runId,
          source.extract,
          sourceImages,
          emitMessage,
          (images, total, failed) =>
            this.updateGenerationPreviewImages(
              db,
              runId,
              'extract',
              stats,
              '正在提取印花',
              images,
              total,
              failed,
            ),
        )
        this.appendGenerationFailureLog(runId, 'extract', '提取', result)
        const prints = usableGenerationImages(result, '提取')
        stats.prints = prints.length
        this.updateResultSection(
          runId,
          resultSection({
            key: IMAGE_PROCESSING_SECTION_KEY,
            title: '图像处理',
            items: prints.map((image, index) =>
              resultImageFromPipelineImage('extract', basename(image.path), image, index),
            ),
            total: result.total,
            failed: result.failed,
          }),
        )
        return {
          output: prints,
          outputCount: prints.length,
          outputJson: { total: result.total, succeeded: result.succeeded, failed: result.failed },
        }
      },
    })
  }

  private async runExtractConfig(
    runId: string,
    config: PipelineExtractConfig,
    sourceImages: PipelineImage[],
    emitMessage: (message: string) => void,
    emitPreviewImages: (images: GenerationRunImage[], total: number, failed: number) => void,
  ): Promise<GenerationRunResult> {
    const sourceImagePaths = sourceImages.map((image) => image.path)
    if (config.provider === 'grsai') {
      if (!config.grsai || !config.skillId) {
        throw new AppErrorClass('HTTP_4XX', 'Grsai 提取需要选择模型和提取 Skill', false)
      }
      return runExtractBatch(
        {
          sourceImagePaths,
          skillId: config.skillId,
          model: config.grsai.model,
          aspectRatio: config.grsai.aspectRatio,
          concurrency: config.grsai.concurrency ?? 3,
          taskId: `${runId}-extract`,
          ...(config.skillVersion ? { skillVersion: config.skillVersion } : {}),
          ...(config.variables ? { variables: config.variables } : {}),
          ...grsaiOptionalFields(config.grsai),
        },
        {
          emitProgress: emitGenerationProgressAsPipeline(
            runId,
            'extract',
            emitMessage,
            emitPreviewImages,
          ),
        },
      )
    }
    if (!config.comfyui) {
      throw new AppErrorClass('HTTP_4XX', 'ComfyUI 提取需要选择工作流', false)
    }
    return runComfyuiExtractBatch(
      {
        sourceImagePaths,
        workflowId: config.comfyui.workflowId,
        taskId: `${runId}-extract`,
        ...(config.skillId ? { skillId: config.skillId } : {}),
        ...(config.skillVersion ? { skillVersion: config.skillVersion } : {}),
        ...comfyuiOptionalFields(config.comfyui),
      },
      {
        emitProgress: emitGenerationProgressAsPipeline(
          runId,
          'extract',
          emitMessage,
          emitPreviewImages,
        ),
      },
    )
  }

  private async runMattingStep(
    db: Pick<SqliteDatabase, 'prepare'>,
    active: ActivePipelineRun,
    runId: string,
    config: PipelineMattingConfig,
    prints: PipelineImage[],
    stats: PipelineRunStats,
  ) {
    return this.executeStep(db, active, {
      runId,
      stepKey: 'matting',
      module: 'generation',
      label: '抠图',
      inputCount: prints.length,
      stats,
      message: '正在抠图',
      run: async (emitMessage) => {
        const sourceImagePaths = prints.map((image) => image.path)
        this.updateResultSection(
          runId,
          resultSection({
            key: IMAGE_PROCESSING_SECTION_KEY,
            title: '图像处理',
            items: loadingResultImages('matting', '图像加载中', prints.length),
            total: prints.length,
          }),
        )
        this.emitRunProgress(db, runId, 'running', 'matting', stats, '正在抠图')
        let result: GenerationRunResult
        if (config.mode === 'mixed') {
          if (!config.workflowId) {
            throw new AppErrorClass('HTTP_4XX', '混合抠图需要选择 ComfyUI 工作流', false)
          }
          result = await runMixedMattingBatch(
            {
              sourceImagePaths,
              workflowId: config.workflowId,
              taskId: `${runId}-matting`,
              ...mattingOptionalFields(config),
            },
            {
              emitProgress: emitGenerationProgressAsPipeline(
                runId,
                'matting',
                emitMessage,
                (images, total, failed) =>
                  this.updateGenerationPreviewImages(
                    db,
                    runId,
                    'matting',
                    stats,
                    '正在抠图',
                    images,
                    total,
                    failed,
                  ),
              ),
            },
          )
        } else {
          if (!config.workflowId) {
            throw new AppErrorClass('HTTP_4XX', '抠图需要选择 ComfyUI 工作流', false)
          }
          result = await runComfyuiMattingBatch(
            {
              sourceImagePaths,
              workflowId: config.workflowId,
              taskId: `${runId}-matting`,
              ...mattingOptionalFields(config),
            },
            {
              emitProgress: emitGenerationProgressAsPipeline(
                runId,
                'matting',
                emitMessage,
                (images, total, failed) =>
                  this.updateGenerationPreviewImages(
                    db,
                    runId,
                    'matting',
                    stats,
                    '正在抠图',
                    images,
                    total,
                    failed,
                  ),
              ),
            },
          )
        }
        this.appendGenerationFailureLog(runId, 'matting', '抠图', result)
        const output = usableGenerationImages(result, '抠图')
        stats.prints = output.length
        this.updateResultSection(
          runId,
          resultSection({
            key: IMAGE_PROCESSING_SECTION_KEY,
            title: '图像处理',
            items: output.map((image, index) =>
              resultImageFromPipelineImage('matting', basename(image.path), image, index),
            ),
            total: result.total,
            failed: result.failed,
          }),
        )
        return {
          output,
          outputCount: output.length,
          outputJson: { total: result.total, succeeded: result.succeeded, failed: result.failed },
        }
      },
    })
  }

  private async runDetectionStep(
    db: Pick<SqliteDatabase, 'prepare'>,
    active: ActivePipelineRun,
    runId: string,
    config: PipelineDetectionConfig,
    prints: PipelineImage[],
    stats: PipelineRunStats,
  ) {
    return this.executeStep(db, active, {
      runId,
      stepKey: 'detection',
      module: 'detection',
      label: '侵权检测',
      inputCount: prints.length,
      stats,
      message: '正在进行侵权检测',
      run: async () => {
        if (!config.skillId || !config.model) {
          throw new AppErrorClass('HTTP_4XX', '侵权检测需要选择 Skill 和模型', false)
        }
        const taskId = `${runId}-detection`
        active.currentCancel = () => {
          detectionService.cancelTask(taskId)
        }
        this.appendLog(runId, {
          level: 'info',
          step_key: 'detection',
          message: '侵权检测配置',
          details: {
            model: config.model,
            skillId: config.skillId,
            skillVersion: config.skillVersion,
            allowReview: config.allowReview ?? true,
          },
        })
        const result = await detectionService.runDetectionBatch({
          imagePaths: prints.map((image) => image.path),
          skillId: config.skillId,
          model: config.model,
          taskId,
          ...(config.skillVersion ? { skillVersion: config.skillVersion } : {}),
          ...(config.variables ? { variables: config.variables } : {}),
          ...(config.threshold ? { threshold: config.threshold } : {}),
          ...(config.preprocess ? { preprocess: config.preprocess } : {}),
          ...(config.concurrency !== undefined ? { concurrency: config.concurrency } : {}),
          ...(config.maxRetries !== undefined ? { maxRetries: config.maxRetries } : {}),
        })
        active.currentCancel = null
        const allowReview = config.allowReview ?? true
        const output = this.allowedDetectionImages(result, allowReview)
        const passed: PipelineResultImage[] = []
        const blocked: PipelineResultImage[] = []
        for (const [index, item] of result.results.entries()) {
          if (item.status === 'failed') {
            continue
          }
          const allowed = shouldPipelineDetectionAllow(item.riskLevel, allowReview)
          const image = resultImageFromDetection(item, allowed, index)
          if (!image) {
            continue
          }
          if (allowed) {
            passed.push(image)
          } else {
            blocked.push(image)
          }
        }
        this.updateResultSection(
          runId,
          resultSection({
            key: 'detection_passed',
            title: '侵权检测通过',
            items: passed,
            paginated: true,
          }),
        )
        this.updateResultSection(
          runId,
          resultSection({
            key: 'detection_blocked',
            title: '侵权检测未通过',
            items: blocked,
            paginated: true,
          }),
        )
        stats.detectionPass = output.pass
        stats.detectionReview = output.review
        stats.detectionBlock = output.block
        stats.prints = output.images.length
        if (output.images.length === 0) {
          throw new AppErrorClass('HTTP_4XX', '检测后没有可继续套版的印花', false)
        }
        return {
          output: output.images,
          outputCount: output.images.length,
          outputJson: {
            total: result.total,
            succeeded: result.succeeded,
            failed: result.failed,
            pass: output.pass,
            review: output.review,
            block: output.block,
            passed,
            blocked,
          },
        }
      },
    })
  }

  private allowedDetectionImages(result: DetectionBatchResult, allowReview: boolean) {
    let pass = 0
    let review = 0
    let block = 0
    const images: PipelineImage[] = []
    for (const item of result.results) {
      if (item.status === 'failed') {
        continue
      }
      if (!shouldPipelineDetectionAllow(item.riskLevel, allowReview)) {
        block += 1
        continue
      }
      if (item.riskLevel === 'review') {
        review += 1
      } else {
        pass += 1
      }
      images.push({
        path: item.outputPath,
        artifactId: item.artifactId,
        printId: item.printId,
      })
    }
    return { images, pass, review, block }
  }

  private async runPhotoshopStep(
    db: Pick<SqliteDatabase, 'prepare'>,
    active: ActivePipelineRun,
    runId: string,
    workbenchRoot: string,
    config: PipelineRunConfig,
    prints: PipelineImage[],
    stats: PipelineRunStats,
  ) {
    return this.executeStep(db, active, {
      runId,
      stepKey: 'photoshop',
      module: 'photoshop',
      label: 'PS 套版',
      inputCount: prints.length,
      stats,
      message: '正在执行 PS 套版',
      run: async (emitMessage) => {
        if (prints.length === 0) {
          throw new AppErrorClass('HTTP_4XX', '没有可套版的印花', false)
        }
        const outputRoot = config.photoshop.outputRoot || defaultOutputRoot(workbenchRoot)
        const taskId = `${runId}-photoshop`
        const taskDir = await tempFileManager.createTaskDir('photoshop', taskId)
        const cancelFilePath = join(taskDir, 'cancel.flag')
        active.currentCancel = () => writeFile(cancelFilePath, String(Date.now()), 'utf8')
        const photoshopPrints = await preparePhotoshopPrints(
          workbenchRoot,
          runId,
          prints,
          config.printSkuCode,
        )
        emitMessage('正在等待 Photoshop 空闲')
        const result = await this.photoshopMutex.runExclusive(async () => {
          this.assertNotCancelled(active)
          return runBatch(printAssetsFromImages(photoshopPrints), config.photoshop.templates, {
            taskId,
            outputRoot,
            outputLayout: 'template_first',
            replaceRange: config.photoshop.replaceRange ?? 'auto',
            format: config.photoshop.format ?? 'jpg',
            clipMode: config.photoshop.clipMode ?? 'auto',
            skipCompleted: config.photoshop.skipCompleted ?? true,
            maxRetries: config.photoshop.maxRetries ?? 1,
            cancelFilePath,
          })
        })
        active.currentCancel = null
        stats.photoshopGroups = result.groups_completed
        return {
          output: { result, outputRoot },
          outputCount: result.groups_completed,
          outputJson: {
            outputRoot,
            waitingPrintFolder: config.printSkuCode
              ? join(
                  workbenchRoot,
                  WORKBENCH_DIRECTORIES.generation,
                  WAITING_PHOTOSHOP_PRINT_FOLDER,
                  safePathSegment(runId),
                )
              : null,
            templatesTotal: result.templates_total,
            groupsCompleted: result.groups_completed,
            outputs: result.outputs.length,
          },
        }
      },
    })
  }

  private async runTitleStep(
    db: Pick<SqliteDatabase, 'prepare'>,
    active: ActivePipelineRun,
    runId: string,
    config: PipelineRunConfig,
    photoshop: { result: Awaited<ReturnType<typeof runBatch>>; outputRoot: string },
    stats: PipelineRunStats,
  ) {
    const batchDirs = Array.from(
      new Set(
        photoshop.result.templates.map((template) =>
          join(photoshop.outputRoot, template.template_name),
        ),
      ),
    )
    return this.executeStep(db, active, {
      runId,
      stepKey: 'title',
      module: 'title',
      label: '标题生成',
      inputCount: batchDirs.length,
      stats,
      message: '正在生成标题',
      run: async () => {
        const results: TitleBatchResult[] = []
        for (const [index, batchDir] of batchDirs.entries()) {
          this.assertNotCancelled(active)
          const taskId = `${runId}-title-${index + 1}`
          active.currentCancel = () => {
            titleService.cancelTask(taskId)
          }
          const result = await titleService.runTitleBatch({
            ...config.title,
            batchDir,
            taskId,
          })
          results.push(result)
          stats.titleSucceeded += result.succeeded
          stats.titleFailed += result.failed
        }
        active.currentCancel = null
        const totalSucceeded = results.reduce((sum, item) => sum + item.succeeded, 0)
        const totalSkipped = results.reduce((sum, item) => sum + item.skipped, 0)
        const totalFailed = results.reduce((sum, item) => sum + item.failed, 0)
        const onlySkipped = totalSkipped > 0 && totalFailed === 0
        if (results.length > 0 && totalSucceeded === 0 && !onlySkipped) {
          throw new AppErrorClass('HTTP_4XX', '标题生成没有成功货号', false)
        }
        return {
          output: results,
          outputCount: totalSucceeded + totalSkipped,
          outputJson: {
            batchDirs,
            titleFiles: results.map((result) => result.xlsxPath),
            succeeded: stats.titleSucceeded,
            failed: stats.titleFailed,
            skipped: totalSkipped,
          },
        }
      },
    })
  }
}

export const pipelineService = new PipelineService()

export function registerPipelineIpc() {
  ipcMain.handle('pipeline:run', (_event, input: unknown) => {
    return pipelineService.startRun(parsePipelineRunConfig(input))
  })
  ipcMain.handle('pipeline:cancel', (_event, input: { run_id: string }) => ({
    ok: pipelineService.cancelRun(input.run_id),
  }))
  ipcMain.handle('pipeline:list-runs', () => pipelineService.listRuns())
  ipcMain.handle('pipeline:get-run', (_event, input: { run_id: string }) =>
    pipelineService.getRun(input.run_id),
  )
}
