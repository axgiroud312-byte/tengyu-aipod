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
  type PipelineRunConfig,
  type PipelineRunDetail,
  type PipelineRunRecord,
  type PipelineRunStats,
  type PipelineRunStatus,
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
import { type DetectionBatchResult, detectionService } from './detection-service'
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

const IMAGE_EXTENSIONS = /\.(?:jpe?g|png|webp)$/i
const WAITING_PHOTOSHOP_PRINT_FOLDER = '等待套版'
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
  cancelled: boolean
  currentCancel: (() => void | Promise<void>) | null
  previewImages: PipelinePreviewImage[]
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
    sourceFolder: z.string(),
    prompt: promptConfigSchema,
    sendReferenceImages: z.boolean().optional(),
    grsai: grsaiImageSchema.optional(),
  }),
  z.object({
    mode: z.literal('existing_prints'),
    printFolder: z.string(),
  }),
])

const pipelineRunConfigSchema = z.object({
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
    templates: z.array(z.string()).min(1),
    outputRoot: z.string().optional(),
    replaceRange: z.enum(['auto', 'top', 'all']).optional(),
    format: z.enum(['jpg', 'png']).optional(),
    clipMode: z.enum(['none', 'auto', 'guides']).optional(),
    skipCompleted: z.boolean().optional(),
    maxRetries: z.number().optional(),
  }),
  title: z.object({
    platform: z.string(),
    language: z.string(),
    model: z.string(),
    titleFileName: z.string().optional(),
    imageIndex: z.number().optional(),
    extraRequirement: z.string().optional(),
    titlePrefix: z.string().optional(),
    titleSuffix: z.string().optional(),
    titleSeparator: z.string().optional(),
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

function workbenchDbPath(workbenchRoot: string) {
  return join(workbenchRoot, WORKBENCH_DIRECTORIES.metadata, 'workbench.db')
}

function openWorkbenchDatabase(workbenchRoot: string) {
  return openSqliteDatabase(workbenchDbPath(workbenchRoot))
}

function ensurePipelineTables(db: Pick<SqliteDatabase, 'exec'>) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS pipeline_runs (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      source_mode TEXT NOT NULL,
      status TEXT NOT NULL,
      config_json TEXT NOT NULL,
      stats_json TEXT NOT NULL,
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

function readRunRow(db: Pick<SqliteDatabase, 'prepare'>, runId: string) {
  const row = db.prepare('SELECT * FROM pipeline_runs WHERE id = ?').get(runId)
  return isPipelineRunRecord(row) ? row : null
}

function isPipelineRunRecord(value: unknown): value is PipelineRunRecord {
  if (!value || typeof value !== 'object') {
    return false
  }
  const row = value as Record<string, unknown>
  return (
    typeof row.id === 'string' &&
    typeof row.name === 'string' &&
    typeof row.source_mode === 'string' &&
    typeof row.status === 'string' &&
    typeof row.config_json === 'string' &&
    typeof row.stats_json === 'string' &&
    typeof row.created_at === 'number'
  )
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
  emitPreviewImages?: (images: GenerationRunImage[]) => void,
) {
  return (progress: GenerationProgress) => {
    if (progress.images) {
      emitPreviewImages?.(progress.images)
    }
    emitProgress(
      `${stepKey}：${progress.processed}/${progress.total}，成功 ${progress.succeeded}，失败 ${progress.failed}`,
    )
  }
}

export class PipelineService {
  private readonly activeRuns = new Map<string, ActivePipelineRun>()

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
      return rows.filter(isPipelineRunRecord)
    } finally {
      db.close()
    }
  }

  async getRun(runId: string): Promise<PipelineRunDetail | null> {
    const workbenchRoot = await this.readWorkbenchRoot()
    const db = openWorkbenchDatabase(workbenchRoot)
    try {
      ensurePipelineTables(db)
      const run = readRunRow(db, runId)
      if (!run) {
        return null
      }
      return { run, steps: readStepRows(db, runId) }
    } finally {
      db.close()
    }
  }

  async runPipeline(runId: string, config: PipelineRunConfig): Promise<PipelineRunDetail> {
    if (process.platform === 'darwin') {
      throw new AppErrorClass(
        'HTTP_4XX',
        '完整任务包含 PS 套版，当前 v1 仅支持在 Windows 执行',
        false,
      )
    }
    const workbenchRoot = await this.readWorkbenchRoot()
    const db = openWorkbenchDatabase(workbenchRoot)
    const active: ActivePipelineRun = { cancelled: false, currentCancel: null, previewImages: [] }
    this.activeRuns.set(runId, active)
    const stats: PipelineRunStats = { ...DEFAULT_STATS }
    const runName = config.name?.trim() || `完整任务-${timestampSlug()}`

    try {
      ensurePipelineTables(db)
      this.createRun(db, runId, runName, config)
      this.emitRunProgress(db, runId, 'running', null, stats, '完整任务已启动')

      const sourceImages = await this.runSourceStep(db, active, runId, config, stats)
      let prints = sourceImages.prints

      if (sourceImages.extractSources.length > 0) {
        prints = await this.runExtractStep(
          db,
          active,
          runId,
          config.source,
          sourceImages.extractSources,
          stats,
        )
      }

      if (config.matting.enabled) {
        prints = await this.runMattingStep(db, active, runId, config.matting, prints, stats)
      } else {
        this.recordSkippedStep(db, runId, 'matting', 'generation', '抠图', prints.length)
      }

      if (config.detection.enabled) {
        prints = await this.runDetectionStep(db, active, runId, config.detection, prints, stats)
      } else {
        this.recordSkippedStep(db, runId, 'detection', 'detection', '侵权检测', prints.length)
      }

      const photoshopResult = await this.runPhotoshopStep(
        db,
        active,
        runId,
        workbenchRoot,
        config,
        prints,
        stats,
      )
      await this.runTitleStep(db, active, runId, config, photoshopResult, stats)

      this.assertNotCancelled(active)
      this.completeRun(db, runId, 'completed', stats, null)
      return this.requireRunDetail(db, runId)
    } catch (error) {
      const status: PipelineRunStatus = active.cancelled ? 'cancelled' : 'failed'
      this.completeRun(db, runId, status, stats, appErrorMessage(error))
      throw error
    } finally {
      db.close()
      this.activeRuns.delete(runId)
    }
  }

  private async readWorkbenchRoot() {
    const config = await readAppConfig()
    if (!config.workbench_root) {
      throw new AppErrorClass('HTTP_4XX', '请先在设置里选择工作区', false)
    }
    return config.workbench_root
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
          error_summary,
          created_at,
          started_at,
          completed_at
        ) VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?, NULL)
      `,
    ).run(
      runId,
      name,
      config.source.mode,
      'running',
      JSON.stringify(config),
      JSON.stringify(DEFAULT_STATS),
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
    const run = readRunRow(db, runId)
    if (!run) {
      throw new AppErrorClass('HTTP_5XX', '完整任务记录缺失', true, { runId })
    }
    return { run, steps: readStepRows(db, runId) }
  }

  private emitRunProgress(
    db: Pick<SqliteDatabase, 'prepare'>,
    runId: string,
    status: PipelineRunStatus,
    currentStep: PipelineStepKey | null,
    stats: PipelineRunStats,
    message: string,
  ) {
    const previewImages = this.activeRuns.get(runId)?.previewImages
    emitPipelineProgress({
      run_id: runId,
      status,
      current_step: currentStep,
      message,
      stats: { ...stats },
      steps: readStepRows(db, runId),
      ...(previewImages ? { preview_images: previewImages } : {}),
    })
  }

  private updateGenerationPreviewImages(
    db: Pick<SqliteDatabase, 'prepare'>,
    runId: string,
    stepKey: PipelineStepKey,
    stats: PipelineRunStats,
    message: string,
    images: GenerationRunImage[],
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
    this.emitRunProgress(db, input.runId, 'running', input.stepKey, input.stats, input.message)

    const emitMessage = (message: string) => {
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
        active.cancelled ? 'failed' : 'failed',
        JSON.stringify({ message: appErrorMessage(error) }),
        Date.now(),
        Date.now(),
        input.runId,
        input.stepKey,
      )
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
        const output = await this.resolveSourceImages(runId, config, emitMessage, (images) =>
          this.updateGenerationPreviewImages(
            db,
            runId,
            'source',
            stats,
            '正在生成来源图片',
            images,
          ),
        )
        stats.sourceImages = output.extractSources.length
        stats.prints = output.prints.length
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
    emitPreviewImages: (images: GenerationRunImage[]) => void,
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
      return { extractSources: [], prints: usableGenerationImages(result, '文生图') }
    }

    const sourcePaths = await scanImageFiles(source.sourceFolder)
    if (sourcePaths.length === 0) {
      throw new AppErrorClass('HTTP_4XX', '图生图来源目录里没有图片', false)
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
        const result = await this.runExtractConfig(
          runId,
          source.extract,
          sourceImages,
          emitMessage,
          (images) =>
            this.updateGenerationPreviewImages(db, runId, 'extract', stats, '正在提取印花', images),
        )
        const prints = usableGenerationImages(result, '提取')
        stats.prints = prints.length
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
    emitPreviewImages: (images: GenerationRunImage[]) => void,
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
                (images) =>
                  this.updateGenerationPreviewImages(
                    db,
                    runId,
                    'matting',
                    stats,
                    '正在抠图',
                    images,
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
                (images) =>
                  this.updateGenerationPreviewImages(
                    db,
                    runId,
                    'matting',
                    stats,
                    '正在抠图',
                    images,
                  ),
              ),
            },
          )
        }
        const output = usableGenerationImages(result, '抠图')
        stats.prints = output.length
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
        const output = this.allowedDetectionImages(result, config.allowReview ?? true)
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
      run: async () => {
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
        const result = await runBatch(
          printAssetsFromImages(photoshopPrints),
          config.photoshop.templates,
          {
            taskId,
            outputRoot,
            outputLayout: 'template_first',
            replaceRange: config.photoshop.replaceRange ?? 'auto',
            format: config.photoshop.format ?? 'jpg',
            clipMode: config.photoshop.clipMode ?? 'auto',
            skipCompleted: config.photoshop.skipCompleted ?? true,
            maxRetries: config.photoshop.maxRetries ?? 1,
            cancelFilePath,
          },
        )
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
        if (results.length > 0 && totalSucceeded === 0) {
          throw new AppErrorClass('HTTP_4XX', '标题生成没有成功货号', false)
        }
        return {
          output: results,
          outputCount: totalSucceeded,
          outputJson: {
            batchDirs,
            titleFiles: results.map((result) => result.xlsxPath),
            succeeded: stats.titleSucceeded,
            failed: stats.titleFailed,
          },
        }
      },
    })
  }
}

export const pipelineService = new PipelineService()

export function registerPipelineIpc() {
  ipcMain.handle('pipeline:run', (_event, input: unknown) => {
    const parsed = pipelineRunConfigSchema.safeParse(input)
    if (!parsed.success) {
      throw new AppErrorClass('INVALID_INPUT', '完整任务参数无效', false, {
        issues: parsed.error.issues,
      })
    }
    return pipelineService.startRun(parsed.data as PipelineRunConfig)
  })
  ipcMain.handle('pipeline:cancel', (_event, input: { run_id: string }) => ({
    ok: pipelineService.cancelRun(input.run_id),
  }))
  ipcMain.handle('pipeline:list-runs', () => pipelineService.listRuns())
  ipcMain.handle('pipeline:get-run', (_event, input: { run_id: string }) =>
    pipelineService.getRun(input.run_id),
  )
}
