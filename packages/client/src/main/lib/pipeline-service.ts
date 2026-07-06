import { randomUUID } from 'node:crypto'
import { copyFile, mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises'
import { basename, extname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import {
  AppErrorClass,
  type PhotoshopPrintAsset,
  type PipelineComfyuiImg2imgConfig,
  type PipelineComfyuiWorkflowConfig,
  type PipelineDetectionConfig,
  type PipelineExtractConfig,
  type PipelineGrsaiImageConfig,
  type PipelineItemRecord,
  type PipelineItemStatus,
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
  type GenerationImageCompletePayload,
  type GenerationProgress,
  type GenerationPromptInput,
  type GenerationRunImage,
  type GenerationRunResult,
  generateTxt2imgPrompts,
  requestGenerationCancel,
  runComfyuiExtractBatch,
  runComfyuiImg2imgBatch,
  runComfyuiMattingBatch,
  runComfyuiTxt2imgBatch,
  runExtractBatch,
  runMixedMattingBatch,
  runTxt2imgBatch,
} from './generation-service'
import { shouldPipelineDetectionAllow } from './pipeline-policy'
import type {
  PipelinePrintStageRegistration,
  PipelinePrintStreamItem,
  PipelineStageRuntimeContext,
} from './pipeline-stage-types'
import { createDetectionStage } from './pipeline-stages/detection-stage'
import { createPhotoshopStage } from './pipeline-stages/photoshop-stage'
import { createTitleStage } from './pipeline-stages/title-stage'
import type { SqliteDatabase } from './sqlite'
import { tempFileManager } from './temp-file-manager'
import { type TitleBatchResult, titleService } from './title-service'
import {
  assertTargetDoesNotExist,
  nextVisibleImageName,
  normalizedVisibleImageNaming,
} from './user-visible-filename'
import {
  openWorkbenchDatabase as openWorkbenchDatabaseFile,
  workbenchDatabasePath,
} from './workbench-db'
import { assertPathInsideWorkbench, canonicalPath } from './workbench-path-guard'

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
  printSkuId?: string
  prompt?: string
}

type PipelineVisibleFilenameFields = {
  filenamePrefix?: string
  filenameSeparator?: string
}

type StreamingSourceProducerResult = GenerationRunResult & {
  itemCount: number
}

type StreamingSourceProducerCallbacks = {
  onPlannedCount?: (count: number) => void
}

type PipelineResumeState = {
  completedItemsByStep: Map<PipelineStepKey, PipelineItemRecord[]>
  completedItemByStepAndKey: Map<string, PipelineItemRecord>
  completedSourceKeys: Set<string>
  completedSourceStep: PipelineStepRecord | null
}

type ActivePipelineRun = {
  db: Pick<SqliteDatabase, 'prepare'>
  cancelRequested: boolean
  interrupted: boolean
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

const comfyuiImg2imgPromptConfigSchema = promptConfigSchema.extend({
  mode: z.enum(['ai', 'workflow']),
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

const comfyuiImg2imgWorkflowSchema = comfyuiWorkflowSchema.extend({
  batchSize: z.number().optional(),
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

const sourceSchema = z.union([
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
    mode: z.literal('txt2img'),
    provider: z.literal('comfyui-chenyu'),
    prompt: promptConfigSchema,
    comfyui: comfyuiWorkflowSchema,
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
    mode: z.literal('img2img'),
    provider: z.literal('comfyui-chenyu'),
    sourceFolder: z.string(),
    prompt: comfyuiImg2imgPromptConfigSchema.optional(),
    comfyui: comfyuiImg2imgWorkflowSchema,
  }),
  z.object({
    mode: z.literal('existing_prints'),
    printFolder: z.string(),
    startStep: z.enum(['matting', 'detection', 'photoshop']).optional(),
  }),
])

const pipelineRunConfigBaseSchema = z.object({
  name: z.string().optional(),
  printSkuCode: z.string().optional(),
  filenameSeparator: z.string().optional(),
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
    replaceRange: z.enum(['auto', 'topmost', 'top', 'all']).optional(),
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
    if (
      config.source.mode === 'existing_prints' &&
      (config.source.startStep ?? 'photoshop') === 'photoshop'
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: '从 PS 套版开始时必须启用 PS 套版',
        path: ['photoshop', 'enabled'],
      })
    }
  } else {
    if (
      !normalizedVisibleImageNaming({
        prefix: config.printSkuCode,
        separator: config.filenameSeparator ?? '-',
      })
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: '启用 PS 套版时必须填写可用的印花货号前缀',
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
  }
  if (config.source.mode === 'existing_prints') {
    const startStep = config.source.startStep ?? 'photoshop'
    if (startStep === 'matting' && !config.matting.enabled) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: '从抠图开始时必须启用抠图',
        path: ['matting', 'enabled'],
      })
    }
    if (startStep === 'detection' && !config.detection.enabled) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: '从侵权检测开始时必须启用侵权检测',
        path: ['detection', 'enabled'],
      })
    }
  }
})

function openWorkbenchDatabase(workbenchRoot: string) {
  return openWorkbenchDatabaseFile(workbenchDatabasePath(workbenchRoot))
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

async function pathExists(path: string) {
  return Boolean(await stat(path).catch(() => null))
}

function resumeItemMapKey(stepKey: PipelineStepKey, itemKey: string) {
  return `${stepKey}:${itemKey}`
}

function sourceArtifactIdsFromRecord(item: PipelineItemRecord) {
  return parseJsonArray<string>(item.source_artifact_ids_json)
}

function streamItemFromPipelineItem(item: PipelineItemRecord): PipelinePrintStreamItem | null {
  const path = item.output_path ?? item.source_path
  if (!path) {
    return null
  }
  return {
    itemKey: item.item_key,
    path,
    sourceArtifactIds: sourceArtifactIdsFromRecord(item),
    ...(item.artifact_id ? { artifactId: item.artifact_id } : {}),
    ...(item.print_id ? { printId: item.print_id } : {}),
  }
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
            ...(image.prompt ? { prompt: image.prompt } : {}),
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
    ...(image.prompt ? { prompt: image.prompt } : {}),
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
  const raw =
    (image.printSkuId ?? image.printId ?? basename(image.path, extname(image.path))) ||
    `print-${index + 1}`
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
  filenameSeparator: string | undefined,
): Promise<PipelineImage[]> {
  const naming = normalizedVisibleImageNaming({
    prefix: printSkuCode,
    separator: filenameSeparator ?? '-',
  })
  if (!naming) {
    return prints
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
      const filename = nextVisibleImageName({
        ...naming,
        index,
        ext: imageFileExtension(image.path),
      })
      if (!filename) {
        throw new AppErrorClass('INVALID_INPUT', '印花货号清洗后为空', false, {
          printSkuCode,
        })
      }
      const targetPath = join(waitingFolder, filename)
      await assertTargetDoesNotExist(targetPath)
      await copyFile(image.path, targetPath)
      return {
        path: targetPath,
        ...(image.artifactId ? { artifactId: image.artifactId } : {}),
        ...(image.printId ? { printId: image.printId } : {}),
        printSkuId: basename(targetPath, extname(targetPath)),
      }
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

function parsePipelineRunIdInput(input: unknown) {
  const parsed = z.object({ run_id: z.string().min(1) }).safeParse(input)
  if (!parsed.success) {
    throw new AppErrorClass('INVALID_INPUT', '完整任务 ID 无效', false, {
      issues: parsed.error.issues,
    })
  }
  return parsed.data
}

function printSkuLockKey(config: PipelineRunConfig) {
  if (config.photoshop.enabled === false) {
    return null
  }
  const naming = normalizedVisibleImageNaming({
    prefix: config.printSkuCode,
    separator: config.filenameSeparator ?? '-',
  })
  return naming ? `${naming.prefix}${naming.separator}`.toLowerCase() : null
}

function pipelineVisibleFilenameFields(config: PipelineRunConfig): PipelineVisibleFilenameFields {
  const naming = normalizedVisibleImageNaming({
    prefix: config.printSkuCode,
    separator: config.filenameSeparator ?? '-',
  })
  if (!naming) {
    return {}
  }
  return {
    filenamePrefix: naming.prefix,
    filenameSeparator: naming.separator,
  }
}

function runConfigSourceHasReferences(
  source: PipelineSourceConfig,
): source is Extract<PipelineSourceConfig, { mode: 'img2img'; provider: 'grsai' }> {
  return (
    source.mode === 'img2img' &&
    source.provider === 'grsai' &&
    Boolean(source.referenceImagePaths?.length)
  )
}

function existingPrintStartStep(config: PipelineRunConfig) {
  return config.source.mode === 'existing_prints' ? (config.source.startStep ?? 'photoshop') : null
}

function shouldRunMattingStep(config: PipelineRunConfig) {
  const startStep = existingPrintStartStep(config)
  if (startStep && startStep !== 'matting') {
    return false
  }
  return config.matting.enabled
}

function shouldRunDetectionStep(config: PipelineRunConfig) {
  if (existingPrintStartStep(config) === 'photoshop') {
    return false
  }
  return config.detection.enabled
}

function sourceResultSectionKey(config: PipelineRunConfig): PipelineResultSectionKey {
  if (config.source.mode === 'collection') {
    return 'source_images'
  }
  if (config.source.mode === 'existing_prints') {
    return IMAGE_PROCESSING_SECTION_KEY
  }
  return shouldRunMattingStep(config) ? 'source_images' : IMAGE_PROCESSING_SECTION_KEY
}

function sourceResultSectionTitle(config: PipelineRunConfig) {
  if (config.source.mode === 'collection') {
    return '采集图'
  }
  if (sourceResultSectionKey(config) === IMAGE_PROCESSING_SECTION_KEY) {
    return '图像处理'
  }
  return '来源印花'
}

function sourceFailureLogLabel(config: PipelineRunConfig) {
  if (config.source.mode === 'txt2img') {
    return '文生图'
  }
  if (config.source.mode === 'img2img') {
    return '图生图'
  }
  return null
}

function sameOrInsidePath(child: string, parent: string) {
  if (child === parent) {
    return true
  }
  const path = relative(parent, child)
  return Boolean(path) && path !== '..' && !path.startsWith(`..${sep}`) && !isAbsolute(path)
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

function isPipelineItemRecord(value: unknown): value is PipelineItemRecord {
  if (!value || typeof value !== 'object') {
    return false
  }
  const row = value as Record<string, unknown>
  return (
    typeof row.id === 'string' &&
    typeof row.run_id === 'string' &&
    typeof row.item_key === 'string' &&
    typeof row.step_key === 'string' &&
    typeof row.status === 'string' &&
    typeof row.created_at === 'number' &&
    typeof row.updated_at === 'number'
  )
}

function readItemRows(db: Pick<SqliteDatabase, 'prepare'>, runId: string) {
  const rows = db
    .prepare(
      `
        SELECT *
        FROM pipeline_items
        WHERE run_id = ?
        ORDER BY created_at ASC, updated_at ASC
      `,
    )
    .all(runId) as unknown[]
  return rows.filter(isPipelineItemRecord)
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
    items: readItemRows(db, runId),
    result_sections: parseJsonArray<PipelineResultSection>(run.result_sections_json),
    logs: parseJsonArray<PipelineRuntimeLogEntry>(run.logs_json),
  }
}

class AsyncItemQueue<T> implements AsyncIterable<T> {
  private readonly values: T[] = []
  private readonly waiters: Array<{
    resolve: (value: IteratorResult<T>) => void
    reject: (reason?: unknown) => void
  }> = []
  private done = false
  private error: unknown = null

  push(value: T) {
    const waiter = this.waiters.shift()
    if (waiter) {
      waiter.resolve({ value, done: false })
      return
    }
    this.values.push(value)
  }

  end() {
    this.done = true
    while (this.waiters.length > 0) {
      this.waiters.shift()?.resolve({ value: undefined, done: true })
    }
  }

  fail(error: unknown) {
    this.error = error
    this.done = true
    while (this.waiters.length > 0) {
      this.waiters.shift()?.reject(error)
    }
  }

  [Symbol.asyncIterator](): AsyncIterator<T> {
    return {
      next: () => {
        const value = this.values.shift()
        if (value !== undefined) {
          return Promise.resolve({ value, done: false })
        }
        if (this.error) {
          return Promise.reject(this.error)
        }
        if (this.done) {
          return Promise.resolve({ value: undefined, done: true })
        }
        return new Promise<IteratorResult<T>>((resolve, reject) => {
          this.waiters.push({ resolve, reject })
        })
      },
    }
  }
}

async function* passThroughStageItems<T>(input: AsyncIterable<T>) {
  for await (const item of input) {
    yield item
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

function comfyuiImg2imgOptionalFields(config: PipelineComfyuiImg2imgConfig) {
  return {
    ...comfyuiOptionalFields(config),
    ...(config.batchSize !== undefined ? { batchSize: config.batchSize } : {}),
  }
}

function comfyuiImg2imgPromptFields(
  prompt: PipelinePromptConfig | undefined,
  printMode: PipelineRunConfig['printMode'],
) {
  if (!prompt || prompt.mode === 'workflow') {
    return { promptMode: 'workflow' as const }
  }
  return {
    promptMode: 'ai' as const,
    printMode,
    ...(prompt.skillId ? { promptSkillId: prompt.skillId } : {}),
    ...(prompt.skillVersion ? { promptSkillVersion: prompt.skillVersion } : {}),
    ...(prompt.model ? { promptModel: prompt.model } : {}),
    ...(prompt.modeInstruction ? { modeInstruction: prompt.modeInstruction } : {}),
    ...(prompt.requirement ? { requirement: prompt.requirement } : {}),
  }
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
  private readonly comfyuiInstanceQueues = new Map<string, PromiseMutex>()

  private comfyuiQueueForInstance(instanceUuid?: string | undefined) {
    const key = instanceUuid?.trim() || ''
    const existing = this.comfyuiInstanceQueues.get(key)
    if (existing) {
      return existing
    }
    const created = new PromiseMutex()
    this.comfyuiInstanceQueues.set(key, created)
    return created
  }

  startRun(config: PipelineRunConfig) {
    const runId = randomUUID()
    void this.runPipeline(runId, config)
      .then((detail) => emitPipelineCompleted({ ok: true, result: detail }))
      .catch((error) =>
        emitPipelineCompleted({ ok: false, run_id: runId, error: appErrorMessage(error) }),
      )
    return runId
  }

  startResume(runId: string) {
    void this.resumeRun(runId)
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
    active.cancelRequested = true
    void active.currentCancel?.()
    return true
  }

  getActiveRunCount() {
    return this.activeRuns.size
  }

  async listRuns(): Promise<PipelineRunRecord[]> {
    const workbenchRoot = await this.readWorkbenchRoot()
    const db = openWorkbenchDatabase(workbenchRoot)
    try {
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

  async markPersistedRunningRunsInterrupted() {
    const workbenchRoot = await this.readWorkbenchRoot()
    const db = openWorkbenchDatabase(workbenchRoot)
    try {
      db.prepare(
        `
          UPDATE pipeline_runs
          SET status = 'interrupted',
              error_summary = COALESCE(error_summary, '完整任务已中断，已完成产物已保留'),
              completed_at = COALESCE(completed_at, ?)
          WHERE status = 'running'
        `,
      ).run(Date.now())
      db.prepare(
        `
          UPDATE pipeline_steps
          SET status = 'interrupted',
              completed_at = COALESCE(completed_at, ?),
              updated_at = ?
          WHERE status = 'running'
        `,
      ).run(Date.now(), Date.now())
      db.prepare(
        `
          UPDATE pipeline_items
          SET status = 'interrupted',
              completed_at = COALESCE(completed_at, ?),
              updated_at = ?
          WHERE status = 'running'
        `,
      ).run(Date.now(), Date.now())
    } finally {
      db.close()
    }
  }

  async markActiveRunsInterrupted() {
    const now = Date.now()
    for (const [runId, active] of this.activeRuns.entries()) {
      try {
        active.interrupted = true
        active.collectionReadLock?.release()
        active.db
          .prepare(
            `
              UPDATE pipeline_runs
              SET status = 'interrupted',
                  error_summary = ?,
                  completed_at = ?
              WHERE id = ?
            `,
          )
          .run('完整任务已中断，已完成产物已保留', now, runId)
        active.db
          .prepare(
            `
              UPDATE pipeline_steps
              SET status = 'interrupted',
                  completed_at = COALESCE(completed_at, ?),
                  updated_at = ?
              WHERE run_id = ? AND status = 'running'
            `,
          )
          .run(now, now, runId)
        active.db
          .prepare(
            `
              UPDATE pipeline_items
              SET status = 'interrupted',
                  completed_at = COALESCE(completed_at, ?),
                  updated_at = ?
              WHERE run_id = ? AND status = 'running'
            `,
          )
          .run(now, now, runId)
        this.appendLog(runId, {
          level: 'warn',
          message: '完整任务已中断，已完成产物已保留',
        })
      } catch {
        // 退出路径只尽力落状态，不阻断进程关闭。
      }
    }
  }

  async getRun(runId: string): Promise<PipelineRunDetail | null> {
    const workbenchRoot = await this.readWorkbenchRoot()
    const db = openWorkbenchDatabase(workbenchRoot)
    try {
      return readRunDetail(db, runId)
    } finally {
      db.close()
    }
  }

  async resumeRun(runId: string): Promise<PipelineRunDetail> {
    const workbenchRoot = await this.readWorkbenchRoot()
    const db = openWorkbenchDatabase(workbenchRoot)
    let activePrintSkuLock: string | null = null
    try {
      const detail = this.requireRunDetail(db, runId)
      if (detail.run.status === 'running') {
        throw new AppErrorClass('HTTP_4XX', '完整任务正在运行,不能续跑', false, { runId })
      }
      if (detail.run.status !== 'interrupted' && detail.run.status !== 'failed') {
        throw new AppErrorClass('HTTP_4XX', '只有已中断或失败的完整任务可以续跑', false, {
          runId,
          status: detail.run.status,
        })
      }

      const parsedConfig = parsePipelineRunConfig(JSON.parse(detail.run.config_json))
      if (process.platform === 'darwin' && parsedConfig.photoshop.enabled !== false) {
        throw new AppErrorClass(
          'HTTP_4XX',
          '完整任务包含 PS 套版，当前 v1 仅支持在 Windows 执行',
          false,
        )
      }
      activePrintSkuLock = this.acquirePrintSkuLock(runId, parsedConfig)
      await this.assertRunConfigPaths(workbenchRoot, parsedConfig)
      await this.assertResumeDiskState(workbenchRoot, runId, parsedConfig, detail)

      const active: ActivePipelineRun = {
        db,
        cancelRequested: false,
        interrupted: false,
        currentCancel: null,
        previewImages: [],
        resultSections: detail.result_sections ?? [],
        logs: detail.logs ?? [],
        collectionReadLock: null,
      }
      this.activeRuns.set(runId, active)
      const stats = parseStats(detail.run.stats_json)
      const resumeState = this.buildResumeState(detail)

      try {
        active.collectionReadLock =
          parsedConfig.source.mode === 'collection'
            ? collectionFolderLock.acquireRead(parsedConfig.source.sourceFolder, {
                kind: 'pipeline',
                runId,
              })
            : null
        this.markRunResuming(db, runId, stats)
        this.appendLog(runId, {
          level: 'info',
          message: '完整任务从中断处继续',
          details: { sourceMode: parsedConfig.source.mode, printMode: parsedConfig.printMode },
        })
        this.emitRunProgress(db, runId, 'running', null, stats, '完整任务从中断处继续')

        await this.runStreamingPipeline(
          db,
          active,
          runId,
          detail.run.name,
          workbenchRoot,
          parsedConfig,
          stats,
          resumeState,
        )

        if (active.interrupted) {
          return this.requireRunDetail(db, runId)
        }
        if (active.cancelRequested) {
          this.appendLog(runId, { level: 'warn', message: '完整任务已取消' })
          this.completeRun(db, runId, 'cancelled', stats, '完整任务已取消')
        } else {
          this.appendLog(runId, { level: 'info', message: '完整任务续跑完成' })
          this.completeRun(db, runId, 'completed', stats, null)
        }
        return this.requireRunDetail(db, runId)
      } catch (error) {
        if (active.interrupted) {
          return this.requireRunDetail(db, runId)
        }
        const status: PipelineRunStatus = active.cancelRequested ? 'cancelled' : 'failed'
        this.appendLog(runId, {
          level: active.cancelRequested ? 'warn' : 'error',
          message: active.cancelRequested ? '完整任务已取消' : '完整任务续跑失败',
          details: { error: appErrorMessage(error) },
        })
        this.completeRun(db, runId, status, stats, appErrorMessage(error))
        if (!active.cancelRequested) {
          throw error
        }
        return this.requireRunDetail(db, runId)
      } finally {
        active.collectionReadLock?.release()
        this.activeRuns.delete(runId)
      }
    } finally {
      this.releasePrintSkuLock(activePrintSkuLock, runId)
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
        cancelRequested: false,
        interrupted: false,
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
        this.createRun(db, runId, runName, runConfig)
        this.appendLog(runId, {
          level: 'info',
          message: '完整任务已启动',
          details: { sourceMode: runConfig.source.mode, printMode: runConfig.printMode },
        })
        this.emitRunProgress(db, runId, 'running', null, stats, '完整任务已启动')

        await this.runStreamingPipeline(db, active, runId, runName, workbenchRoot, runConfig, stats)

        if (active.interrupted) {
          return this.requireRunDetail(db, runId)
        }
        if (active.cancelRequested) {
          this.appendLog(runId, { level: 'warn', message: '完整任务已取消' })
          this.completeRun(db, runId, 'cancelled', stats, '完整任务已取消')
        } else {
          this.appendLog(runId, { level: 'info', message: '完整任务完成' })
          this.completeRun(db, runId, 'completed', stats, null)
        }
        return this.requireRunDetail(db, runId)
      } catch (error) {
        if (active.interrupted) {
          return this.requireRunDetail(db, runId)
        }
        const status: PipelineRunStatus = active.cancelRequested ? 'cancelled' : 'failed'
        this.appendLog(runId, {
          level: active.cancelRequested ? 'warn' : 'error',
          message: active.cancelRequested ? '完整任务已取消' : '完整任务失败',
          details: { error: appErrorMessage(error) },
        })
        this.completeRun(db, runId, status, stats, appErrorMessage(error))
        if (!active.cancelRequested) {
          throw error
        }
        return this.requireRunDetail(db, runId)
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
    if (
      config.source.mode !== 'img2img' ||
      config.source.provider !== 'grsai' ||
      !config.source.referenceImages?.length
    ) {
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
      config.source.referenceImages.map(
        async (image: PipelineReferenceImageInput, index: number) => {
          const baseName = safePathSegment(basename(image.name, extname(image.name)))
          const targetPath = join(
            referenceFolder,
            `${String(index + 1).padStart(2, '0')}-${baseName}${referenceImageExtension(image)}`,
          )
          await writeFile(targetPath, decodeReferenceImageBase64(image.base64))
          return targetPath
        },
      ),
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
      const printFolder = await assertPathInsideWorkbench(
        workbenchRoot,
        config.source.printFolder,
        {
          domain: 'generation',
          label: '完整任务印花来源目录',
        },
      )
      const generationRoot = await canonicalPath(
        resolve(workbenchRoot, WORKBENCH_DIRECTORIES.generation),
      )
      const waitingRoot = await canonicalPath(join(generationRoot, WAITING_PHOTOSHOP_PRINT_FOLDER))
      if (printFolder === generationRoot || sameOrInsidePath(printFolder, waitingRoot)) {
        throw new AppErrorClass(
          'HTTP_4XX',
          '已有印花来源必须选择 02-印花工作区 下的具体印花文件夹，不能选择根目录或等待套版目录',
          false,
          { kind: 'invalid_existing_print_folder', printFolder },
        )
      }
    }
    if (config.source.mode === 'img2img') {
      if (config.source.provider === 'grsai' && config.source.sourceFolder) {
        await assertPathInsideWorkbench(workbenchRoot, config.source.sourceFolder, {
          domain: 'generation',
          label: '完整任务图生图来源目录',
        })
      }
      if (config.source.provider === 'grsai') {
        for (const referencePath of config.source.referenceImagePaths ?? []) {
          await assertPathInsideWorkbench(workbenchRoot, referencePath, {
            domain: 'local-image',
            label: '完整任务图生图参考图',
          })
        }
      }
    }
    if (config.photoshop.enabled !== false && config.photoshop.outputRoot) {
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

  private markRunResuming(
    db: Pick<SqliteDatabase, 'prepare'>,
    runId: string,
    stats: PipelineRunStats,
  ) {
    db.prepare(
      `
        UPDATE pipeline_runs
        SET status = 'running',
            stats_json = ?,
            error_summary = NULL,
            started_at = COALESCE(started_at, ?),
            completed_at = NULL
        WHERE id = ?
      `,
    ).run(JSON.stringify(stats), Date.now(), runId)
  }

  private buildResumeState(detail: PipelineRunDetail): PipelineResumeState {
    const completedItemsByStep = new Map<PipelineStepKey, PipelineItemRecord[]>()
    const completedItemByStepAndKey = new Map<string, PipelineItemRecord>()
    for (const item of detail.items ?? []) {
      if (item.status !== 'completed' && item.status !== 'skipped' && item.status !== 'filtered') {
        continue
      }
      const items = completedItemsByStep.get(item.step_key) ?? []
      items.push(item)
      completedItemsByStep.set(item.step_key, items)
      completedItemByStepAndKey.set(resumeItemMapKey(item.step_key, item.item_key), item)
    }
    return {
      completedItemsByStep,
      completedItemByStepAndKey,
      completedSourceStep:
        detail.steps.find((step) => step.step_key === 'source' && step.status === 'completed') ??
        null,
      completedSourceKeys: new Set(
        (detail.items ?? [])
          .filter((item) => item.step_key === 'source' && item.status === 'completed')
          .map((item) => item.item_key),
      ),
    }
  }

  private async assertResumeDiskState(
    workbenchRoot: string,
    runId: string,
    config: PipelineRunConfig,
    detail: PipelineRunDetail,
  ) {
    if (config.photoshop.enabled !== false) {
      const waitingFolder = join(
        workbenchRoot,
        WORKBENCH_DIRECTORIES.generation,
        WAITING_PHOTOSHOP_PRINT_FOLDER,
        safePathSegment(runId),
      )
      const waitingStat = await stat(waitingFolder).catch(() => null)
      if (!waitingStat?.isDirectory()) {
        throw new AppErrorClass('HTTP_4XX', '源目录已被清理,无法续跑', false, {
          runId,
          waitingFolder,
        })
      }
    }

    for (const item of detail.items ?? []) {
      if (item.step_key !== 'source' || item.status !== 'completed') {
        continue
      }
      const sourcePath = item.output_path ?? item.source_path
      if (sourcePath && !(await pathExists(sourcePath))) {
        throw new AppErrorClass('HTTP_4XX', '源目录已被清理,无法续跑', false, {
          runId,
          sourcePath,
        })
      }
    }
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
      items: readItemRows(db, runId),
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

  private assertCanAcceptMoreWork(active: ActivePipelineRun) {
    if (active.cancelRequested) {
      throw new AppErrorClass('HTTP_4XX', '完整任务已取消', false)
    }
  }

  private stopAcceptingMoreWork(active: ActivePipelineRun) {
    return active.cancelRequested
  }

  private async withGenerationCancel<T>(
    active: ActivePipelineRun,
    taskId: string,
    run: () => Promise<T>,
  ): Promise<T> {
    active.currentCancel = () => {
      requestGenerationCancel(taskId)
    }
    try {
      return await run()
    } finally {
      active.currentCancel = null
    }
  }

  private upsertPipelineItem(
    db: Pick<SqliteDatabase, 'prepare'>,
    input: {
      runId: string
      itemKey: string
      stepKey: PipelineStepKey
      status: PipelineItemStatus
      sourcePath?: string | undefined
      outputPath?: string | undefined
      artifactId?: string | undefined
      printId?: string | undefined
      sourceArtifactIds?: string[] | undefined
      errorMessage?: string | undefined
      completed?: boolean | undefined
    },
  ) {
    const now = Date.now()
    db.prepare(
      `
        INSERT INTO pipeline_items (
          id,
          run_id,
          item_key,
          step_key,
          status,
          source_path,
          output_path,
          artifact_id,
          print_id,
          source_artifact_ids_json,
          error_message,
          created_at,
          updated_at,
          completed_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(run_id, item_key, step_key) DO UPDATE SET
          status = excluded.status,
          source_path = COALESCE(excluded.source_path, pipeline_items.source_path),
          output_path = COALESCE(excluded.output_path, pipeline_items.output_path),
          artifact_id = COALESCE(excluded.artifact_id, pipeline_items.artifact_id),
          print_id = COALESCE(excluded.print_id, pipeline_items.print_id),
          source_artifact_ids_json = COALESCE(
            excluded.source_artifact_ids_json,
            pipeline_items.source_artifact_ids_json
          ),
          error_message = excluded.error_message,
          updated_at = excluded.updated_at,
          completed_at = excluded.completed_at
      `,
    ).run(
      `${input.runId}:${input.itemKey}:${input.stepKey}`,
      input.runId,
      input.itemKey,
      input.stepKey,
      input.status,
      input.sourcePath ?? null,
      input.outputPath ?? null,
      input.artifactId ?? null,
      input.printId ?? null,
      input.sourceArtifactIds ? JSON.stringify(input.sourceArtifactIds) : null,
      input.errorMessage ?? null,
      now,
      now,
      input.completed ? now : null,
    )
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
    this.assertCanAcceptMoreWork(active)
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
      if (active.interrupted) {
        db.prepare(
          `
            UPDATE pipeline_steps
            SET status = 'interrupted',
                output_count = ?,
                output_json = ?,
                error_json = NULL,
                completed_at = ?,
                updated_at = ?
            WHERE run_id = ? AND step_key = ?
          `,
        ).run(
          result.outputCount,
          JSON.stringify(result.outputJson ?? null),
          Date.now(),
          Date.now(),
          input.runId,
          input.stepKey,
        )
        return result.output
      }
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
        active.cancelRequested ? 'cancelled' : 'failed',
        JSON.stringify({ message: appErrorMessage(error) }),
        Date.now(),
        Date.now(),
        input.runId,
        input.stepKey,
      )
      this.appendLog(input.runId, {
        level: active.cancelRequested ? 'warn' : 'error',
        step_key: input.stepKey,
        message: active.cancelRequested ? `${input.label}已取消` : `${input.label}失败`,
        details: { error: appErrorMessage(error) },
      })
      this.emitRunProgress(
        db,
        input.runId,
        active.cancelRequested ? 'cancelled' : 'failed',
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
              items: referencePaths.map((path: string, index: number) =>
                resultImageFromPath('source', basename(path), path, index),
              ),
              paginated: true,
              defaultCollapsed: true,
            }),
          )
        }
        const output = await this.resolveSourceImages(
          active,
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
              key: sourceResultSectionKey(config),
              title: sourceResultSectionTitle(config),
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

  private buildStreamingPrintStages(
    db: Pick<SqliteDatabase, 'exec' | 'prepare'>,
    active: ActivePipelineRun,
    runId: string,
    taskName: string,
    workbenchRoot: string,
    config: PipelineRunConfig,
    stats: PipelineRunStats,
    visibleFilenameFields: PipelineVisibleFilenameFields,
    sourceTotalRef: { value: number },
    sourceFailedRef: { value: number },
  ): PipelinePrintStageRegistration[] {
    const stages: PipelinePrintStageRegistration[] = []

    if (config.source.mode === 'collection') {
      stages.push({
        stepKey: 'extract',
        create: (context) =>
          this.createStreamingExtractStage(db, active, context, stats, visibleFilenameFields),
      })
    }

    if (shouldRunMattingStep(config)) {
      stages.push({
        stepKey: 'matting',
        create: (context) =>
          this.createStreamingMattingStage(
            db,
            active,
            context,
            stats,
            visibleFilenameFields,
            sourceTotalRef,
            sourceFailedRef,
          ),
      })
    }

    if (shouldRunDetectionStep(config)) {
      stages.push({
        stepKey: 'detection',
        create: createDetectionStage({
          db,
          stats,
          upsertPipelineItem: (input) => this.upsertPipelineItem(db, input),
          updateResultSection: (nextRunId, section) => this.updateResultSection(nextRunId, section),
          appendLog: (nextRunId, input) => this.appendLog(nextRunId, input),
          emitRunningProgress: (nextRunId, message) =>
            this.emitRunProgress(db, nextRunId, 'running', 'detection', stats, message),
          setCurrentCancel: (cancel) => {
            active.currentCancel = cancel
          },
          assertNotCancelled: () => this.assertCanAcceptMoreWork(active),
        }),
      })
    }

    if (config.photoshop.enabled !== false) {
      stages.push({
        stepKey: 'photoshop',
        create: createPhotoshopStage({
          db,
          stats,
          workbenchRoot,
          photoshopMutex: this.photoshopMutex,
          runBatch,
          upsertPipelineItem: (input) => this.upsertPipelineItem(db, input),
          updateResultSection: (nextRunId, section) => this.updateResultSection(nextRunId, section),
          appendLog: (nextRunId, input) => this.appendLog(nextRunId, input),
          emitRunningProgress: (nextRunId, message) =>
            this.emitRunProgress(db, nextRunId, 'running', 'photoshop', stats, message),
          setCurrentCancel: (cancel) => {
            active.currentCancel = cancel
          },
          assertNotCancelled: () => this.assertCanAcceptMoreWork(active),
        }),
      })
    }

    if (config.photoshop.enabled !== false && config.title.enabled !== false) {
      stages.push({
        stepKey: 'title',
        create: createTitleStage({
          db: {
            exec: (...args) => db.exec(...args),
            prepare: (...args) => db.prepare(...args),
          },
          workbenchRoot,
          stats,
          upsertPipelineItem: (input) => this.upsertPipelineItem(db, input),
          appendLog: (nextRunId, input) => this.appendLog(nextRunId, input),
          emitRunningProgress: (nextRunId, message) =>
            this.emitRunProgress(db, nextRunId, 'running', 'title', stats, message),
          setCurrentCancel: (cancel) => {
            active.currentCancel = cancel
          },
          assertNotCancelled: () => this.assertCanAcceptMoreWork(active),
        }),
      })
    }

    return stages
  }

  private applyStreamingPrintStages(
    input: AsyncIterable<PipelinePrintStreamItem>,
    stages: PipelinePrintStageRegistration[],
    createContext: (stepKey: PipelineStepKey) => PipelineStageRuntimeContext,
    resumeState?: PipelineResumeState | undefined,
  ) {
    let current: AsyncIterable<PipelinePrintStreamItem> = input
    const pumps: Promise<void>[] = []
    for (const stage of stages) {
      const stageInput = current
      const stageOutput = new AsyncItemQueue<PipelinePrintStreamItem>()
      const context = createContext(stage.stepKey)
      pumps.push(
        (async () => {
          try {
            const stageItems = this.createResumeAwareStage(
              stage.stepKey,
              stage.create(context),
              stageInput,
              context,
              resumeState,
            )
            for await (const item of stageItems) {
              stageOutput.push(item)
            }
            stageOutput.end()
          } catch (error) {
            stageOutput.fail(error)
          }
        })(),
      )
      current = stageOutput
    }
    return {
      output: current,
      completed: Promise.all(pumps).then(() => undefined),
    }
  }

  private createResumeAwareStage(
    stepKey: PipelineStepKey,
    stage: ReturnType<PipelinePrintStageRegistration['create']>,
    input: AsyncIterable<PipelinePrintStreamItem>,
    context: PipelineStageRuntimeContext,
    resumeState?: PipelineResumeState | undefined,
  ): AsyncIterable<PipelinePrintStreamItem> {
    if (!resumeState) {
      return stage(input, context)
    }
    const activeResumeState = resumeState
    const service = this
    async function* resumeAwareStage() {
      const pendingItems: PipelinePrintStreamItem[] = []
      for await (const item of input) {
        const resumedItems = service.resumeOutputItemsForStage(
          stepKey,
          item,
          context.config,
          activeResumeState,
        )
        if (resumedItems) {
          for (const resumedItem of resumedItems) {
            yield resumedItem
          }
          continue
        }
        pendingItems.push(item)
      }
      if (pendingItems.length === 0) {
        return
      }
      async function* pendingInput() {
        for (const item of pendingItems) {
          yield item
        }
      }
      for await (const item of stage(pendingInput(), context)) {
        yield item
      }
    }
    return resumeAwareStage()
  }

  private resumeOutputItemsForStage(
    stepKey: PipelineStepKey,
    item: PipelinePrintStreamItem,
    config: PipelineRunConfig,
    resumeState: PipelineResumeState,
  ): PipelinePrintStreamItem[] | null {
    if (stepKey === 'photoshop') {
      const completed = config.photoshop.templates.flatMap((templatePath) => {
        const stageItemKey = `${item.itemKey}:${safePathSegment(templatePath)}`
        const record = resumeState.completedItemByStepAndKey.get(
          resumeItemMapKey('photoshop', stageItemKey),
        )
        const streamItem = record ? streamItemFromPipelineItem(record) : null
        return streamItem ? [streamItem] : []
      })
      return completed.length === config.photoshop.templates.length ? completed : null
    }

    const record = resumeState.completedItemByStepAndKey.get(
      resumeItemMapKey(stepKey, item.itemKey),
    )
    if (!record) {
      return null
    }
    const streamItem = streamItemFromPipelineItem(record)
    if (streamItem) {
      return [streamItem]
    }
    return stepKey === 'title' ? [item] : []
  }

  private async runStreamingPipeline(
    db: Pick<SqliteDatabase, 'exec' | 'prepare'>,
    active: ActivePipelineRun,
    runId: string,
    runName: string,
    workbenchRoot: string,
    config: PipelineRunConfig,
    stats: PipelineRunStats,
    resumeState?: PipelineResumeState | undefined,
  ) {
    const visibleFilenameFields = pipelineVisibleFilenameFields(config)
    const sourceQueue = new AsyncItemQueue<PipelinePrintStreamItem>()
    const outputItems: PipelineImage[] = []
    const sourceItems: PipelineImage[] = []
    const sourceSectionKey = sourceResultSectionKey(config)
    const sourceSectionTitle = sourceResultSectionTitle(config)
    const sourceTotalRef = { value: 0 }
    const sourceFailedRef = { value: 0 }
    let plannedSourceCount = 0
    const sourceLabel = config.source.mode === 'collection' ? '准备来源' : '来源生图'
    const sourceModule =
      config.source.mode === 'existing_prints' ? 'generation' : config.source.mode

    const refreshSourceSection = () => {
      const total = Math.max(sourceTotalRef.value, plannedSourceCount)
      const loadingCount = Math.max(0, total - sourceItems.length - sourceFailedRef.value)
      this.updateResultSection(
        runId,
        resultSection({
          key: sourceSectionKey,
          title: sourceSectionTitle,
          items: [
            ...sourceItems.map((image, index) =>
              resultImageFromPipelineImage('source', basename(image.path), image, index),
            ),
            ...loadingResultImages('source', '图像加载中', loadingCount),
          ],
          total,
          failed: sourceFailedRef.value,
          paginated: true,
          defaultCollapsed: sourceSectionKey === 'source_images',
        }),
      )
      this.emitRunProgress(
        db,
        runId,
        'running',
        'source',
        stats,
        config.source.mode === 'collection' ? '正在扫描采集来源图片' : '正在流式准备来源印花',
      )
    }

    db.prepare(
      `
        INSERT INTO pipeline_steps (
          id, run_id, step_key, module, label, status, input_count, output_count, output_json,
          error_json, started_at, completed_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?, NULL, ?)
        ON CONFLICT(run_id, step_key) DO UPDATE SET
          status = excluded.status,
          input_count = excluded.input_count,
          output_count = excluded.output_count,
          output_json = NULL,
          error_json = NULL,
          started_at = excluded.started_at,
          completed_at = NULL,
          updated_at = excluded.updated_at
      `,
    ).run(
      `${runId}:source`,
      runId,
      'source',
      sourceModule,
      sourceLabel,
      'running',
      0,
      0,
      Date.now(),
      Date.now(),
    )
    this.emitRunProgress(
      db,
      runId,
      'running',
      'source',
      stats,
      config.source.mode === 'collection' ? '正在扫描采集来源图片' : '正在流式准备来源印花',
    )
    const stageRegistrations = this.buildStreamingPrintStages(
      db,
      active,
      runId,
      runName,
      workbenchRoot,
      config,
      stats,
      visibleFilenameFields,
      sourceTotalRef,
      sourceFailedRef,
    )
    const stagePipeline = this.applyStreamingPrintStages(
      sourceQueue,
      stageRegistrations,
      (stepKey) => ({
        runId,
        taskName: runName,
        config,
        stepKey,
        isCancelled: () => active.cancelRequested,
      }),
      resumeState,
    )
    const consumeOutputPromise = (async () => {
      for await (const item of stagePipeline.output) {
        outputItems.push({
          path: item.path,
          ...(item.artifactId ? { artifactId: item.artifactId } : {}),
          ...(item.printId ? { printId: item.printId } : {}),
          ...(item.prompt ? { prompt: item.prompt } : {}),
        })
      }
    })()

    for (const item of resumeState?.completedItemsByStep.get('source') ?? []) {
      const payload = streamItemFromPipelineItem(item)
      if (!payload) {
        continue
      }
      sourceTotalRef.value += 1
      const image: PipelineImage = {
        path: payload.path,
        ...(payload.artifactId ? { artifactId: payload.artifactId } : {}),
        ...(payload.printId ? { printId: payload.printId } : {}),
        ...(payload.prompt ? { prompt: payload.prompt } : {}),
      }
      sourceItems.push(image)
      if (config.source.mode !== 'collection') {
        stats.prints = sourceItems.length
      }
      refreshSourceSection()
      if (!this.stopAcceptingMoreWork(active)) {
        sourceQueue.push(payload)
      }
    }

    try {
      const result = await this.runStreamingSourceProducer(
        db,
        active,
        runId,
        runName,
        config,
        stats,
        visibleFilenameFields,
        sourceQueue,
        (payload) => {
          sourceTotalRef.value += 1
          const image: PipelineImage = {
            path: payload.path,
            ...(payload.artifactId ? { artifactId: payload.artifactId } : {}),
            ...(payload.printId ? { printId: payload.printId } : {}),
            ...(payload.prompt ? { prompt: payload.prompt } : {}),
          }
          sourceItems.push(image)
          if (config.source.mode !== 'collection') {
            stats.prints = sourceItems.length
          }
          this.upsertPipelineItem(db, {
            runId,
            itemKey: payload.itemKey,
            stepKey: 'source',
            status: 'completed',
            outputPath: payload.path,
            artifactId: payload.artifactId,
            printId: payload.printId,
            sourceArtifactIds: payload.sourceArtifactIds,
            completed: true,
          })
          refreshSourceSection()
          db.prepare(
            `
              UPDATE pipeline_steps
              SET input_count = ?, output_count = ?, updated_at = ?
              WHERE run_id = ? AND step_key = 'source'
            `,
          ).run(sourceTotalRef.value, sourceItems.length, Date.now(), runId)
          if (!this.stopAcceptingMoreWork(active)) {
            sourceQueue.push(payload)
            this.emitRunProgress(
              db,
              runId,
              'running',
              'source',
              stats,
              config.source.mode === 'collection' ? '来源图片已进入提取' : '来源印花已流出',
            )
          }
        },
        {
          onPlannedCount: (count) => {
            plannedSourceCount = count
            refreshSourceSection()
          },
        },
        resumeState,
      )
      sourceFailedRef.value = result.failed
      const failureLogLabel = sourceFailureLogLabel(config)
      if (failureLogLabel) {
        this.appendGenerationFailureLog(runId, 'source', failureLogLabel, result)
      }
      refreshSourceSection()
      sourceQueue.end()
      await consumeOutputPromise
      await stagePipeline.completed
      db.prepare(
        `
          UPDATE pipeline_steps
          SET status = 'completed',
              input_count = ?,
              output_count = ?,
              output_json = ?,
              completed_at = ?,
              updated_at = ?
          WHERE run_id = ? AND step_key = 'source'
        `,
      ).run(
        sourceTotalRef.value,
        sourceItems.length,
        JSON.stringify({
          total: result.total,
          itemCount: result.itemCount,
          succeeded: result.succeeded,
          failed: result.failed,
        }),
        Date.now(),
        Date.now(),
        runId,
      )
      if (!shouldRunMattingStep(config)) {
        this.recordSkippedStep(db, runId, 'matting', 'generation', '抠图', outputItems.length)
      }
      if (!shouldRunDetectionStep(config)) {
        this.recordSkippedStep(db, runId, 'detection', 'detection', '侵权检测', outputItems.length)
      }
      if (config.photoshop.enabled === false) {
        this.recordSkippedStep(db, runId, 'photoshop', 'photoshop', 'PS 套版', outputItems.length)
        this.recordSkippedStep(db, runId, 'title', 'title', '标题生成', outputItems.length)
      } else if (config.title.enabled === false) {
        this.recordSkippedStep(db, runId, 'title', 'title', '标题生成', outputItems.length)
      }
    } catch (error) {
      sourceQueue.end()
      throw error
    }
  }

  private async resolveSourceImages(
    active: ActivePipelineRun,
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
      if (source.provider === 'comfyui-chenyu') {
        emitPreviewImages([], prompts.length, 0)
        const result = await this.withGenerationCancel(active, `${runId}-txt2img`, async () =>
          runComfyuiTxt2imgBatch(
            {
              prompts,
              workflowId: source.comfyui.workflowId,
              taskId: `${runId}-txt2img`,
              ...pipelineVisibleFilenameFields(config),
              ...comfyuiOptionalFields(source.comfyui),
            },
            {
              emitProgress: emitGenerationProgressAsPipeline(
                runId,
                'source',
                emitMessage,
                emitPreviewImages,
              ),
            },
          ),
        )
        emitPreviewImages(result.images, result.total, result.failed)
        this.appendGenerationFailureLog(runId, 'source', '文生图', result)
        return { extractSources: [], prints: usableGenerationImages(result, '文生图') }
      }
      if (!source.grsai) {
        throw new AppErrorClass('HTTP_4XX', '文生图缺少 Grsai 配置', false)
      }
      const grsaiConfig = source.grsai
      emitPreviewImages([], prompts.length, 0)
      const result = await this.withGenerationCancel(active, `${runId}-txt2img`, async () =>
        runTxt2imgBatch(
          {
            capability: 'txt2img',
            prompts,
            model: grsaiConfig.model,
            aspectRatio: grsaiConfig.aspectRatio,
            concurrency: grsaiConfig.concurrency ?? 3,
            taskId: `${runId}-txt2img`,
            ...pipelineVisibleFilenameFields(config),
            ...grsaiOptionalFields(grsaiConfig),
          },
          {
            emitProgress: emitGenerationProgressAsPipeline(
              runId,
              'source',
              emitMessage,
              emitPreviewImages,
            ),
          },
        ),
      )
      emitPreviewImages(result.images, result.total, result.failed)
      this.appendGenerationFailureLog(runId, 'source', '文生图', result)
      return { extractSources: [], prints: usableGenerationImages(result, '文生图') }
    }

    if (source.mode === 'img2img' && source.provider === 'comfyui-chenyu') {
      const sourcePaths = await scanImageFiles(source.sourceFolder)
      if (sourcePaths.length === 0) {
        throw new AppErrorClass('HTTP_4XX', '图生图图片文件夹里没有可用图片', false)
      }
      const comfyuiConfig = source.comfyui
      const batchSize = comfyuiConfig.batchSize ?? 1
      emitMessage(`图生图来源 ${sourcePaths.length} 张，每张生成 ${batchSize} 张`)
      emitPreviewImages([], sourcePaths.length * batchSize, 0)
      const result = await this.withGenerationCancel(active, `${runId}-img2img`, async () =>
        runComfyuiImg2imgBatch(
          {
            sourceImagePaths: sourcePaths,
            workflowId: comfyuiConfig.workflowId,
            taskId: `${runId}-img2img`,
            ...pipelineVisibleFilenameFields(config),
            ...comfyuiImg2imgOptionalFields(comfyuiConfig),
            ...comfyuiImg2imgPromptFields(source.prompt, config.printMode),
          },
          {
            emitProgress: emitGenerationProgressAsPipeline(
              runId,
              'source',
              emitMessage,
              emitPreviewImages,
            ),
          },
        ),
      )
      emitPreviewImages(result.images, result.total, result.failed)
      this.appendGenerationFailureLog(runId, 'source', '图生图', result)
      return { extractSources: [], prints: usableGenerationImages(result, '图生图') }
    }

    if (source.mode !== 'img2img') {
      throw new AppErrorClass('HTTP_4XX', '完整任务来源配置无效', false)
    }

    const sourcePaths = source.referenceImagePaths?.length
      ? source.referenceImagePaths
      : source.sourceFolder
        ? await scanImageFiles(source.sourceFolder)
        : []
    if (
      sourcePaths.length === 0 &&
      (source.prompt.mode !== 'manual' || source.sendReferenceImages)
    ) {
      throw new AppErrorClass('HTTP_4XX', '请先添加至少一张图生图参考图', false)
    }
    if (!source.grsai) {
      throw new AppErrorClass('HTTP_4XX', '图生图缺少 Grsai 配置', false)
    }
    const grsaiConfig = source.grsai
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
    const result = await this.withGenerationCancel(active, `${runId}-img2img`, async () =>
      runTxt2imgBatch(
        {
          capability: 'img2img',
          prompts,
          model: grsaiConfig.model,
          aspectRatio: grsaiConfig.aspectRatio,
          concurrency: grsaiConfig.concurrency ?? 3,
          taskId: `${runId}-img2img`,
          ...(references?.length ? { referenceImages: references } : {}),
          ...pipelineVisibleFilenameFields(config),
          ...grsaiOptionalFields(grsaiConfig),
        },
        {
          emitProgress: emitGenerationProgressAsPipeline(
            runId,
            'source',
            emitMessage,
            emitPreviewImages,
          ),
        },
      ),
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
    visibleFilenameFields: PipelineVisibleFilenameFields,
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
          active,
          runId,
          runId,
          source.extract,
          sourceImages,
          visibleFilenameFields,
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
    active: ActivePipelineRun,
    runId: string,
    outputTaskName: string,
    config: PipelineExtractConfig,
    sourceImages: PipelineImage[],
    visibleFilenameFields: PipelineVisibleFilenameFields,
    emitMessage: (message: string) => void,
    emitPreviewImages: (images: GenerationRunImage[], total: number, failed: number) => void,
    onImageComplete?: (payload: GenerationImageCompletePayload) => void | Promise<void>,
  ): Promise<GenerationRunResult> {
    const sourceImagePaths = sourceImages.map((image) => image.path)
    if (config.provider === 'grsai') {
      const grsaiConfig = config.grsai
      const skillId = config.skillId
      if (!grsaiConfig || !skillId) {
        throw new AppErrorClass('HTTP_4XX', 'Grsai 提取需要选择模型和提取 Skill', false)
      }
      return this.withGenerationCancel(active, `${runId}-extract`, async () =>
        runExtractBatch(
          {
            sourceImagePaths,
            skillId,
            model: grsaiConfig.model,
            aspectRatio: grsaiConfig.aspectRatio,
            concurrency: grsaiConfig.concurrency ?? 3,
            taskId: `${runId}-extract`,
            outputTaskName,
            ...(config.skillVersion ? { skillVersion: config.skillVersion } : {}),
            ...(config.variables ? { variables: config.variables } : {}),
            ...visibleFilenameFields,
            ...grsaiOptionalFields(grsaiConfig),
          },
          {
            emitProgress: emitGenerationProgressAsPipeline(
              runId,
              'extract',
              emitMessage,
              emitPreviewImages,
            ),
            ...(onImageComplete ? { onImageComplete } : {}),
          },
        ),
      )
    }
    if (!config.comfyui) {
      throw new AppErrorClass('HTTP_4XX', 'ComfyUI 提取需要选择工作流', false)
    }
    const comfyuiConfig = config.comfyui
    return this.withGenerationCancel(active, `${runId}-extract`, async () =>
      runComfyuiExtractBatch(
        {
          sourceImagePaths,
          workflowId: comfyuiConfig.workflowId,
          taskId: `${runId}-extract`,
          outputTaskName,
          ...(config.skillId ? { skillId: config.skillId } : {}),
          ...(config.skillVersion ? { skillVersion: config.skillVersion } : {}),
          ...visibleFilenameFields,
          ...comfyuiOptionalFields(comfyuiConfig),
        },
        {
          emitProgress: emitGenerationProgressAsPipeline(
            runId,
            'extract',
            emitMessage,
            emitPreviewImages,
          ),
          ...(onImageComplete ? { onImageComplete } : {}),
        },
      ),
    )
  }

  private async runStreamingSourceProducer(
    db: Pick<SqliteDatabase, 'prepare'>,
    active: ActivePipelineRun,
    runId: string,
    taskName: string,
    config: PipelineRunConfig,
    stats: PipelineRunStats,
    visibleFilenameFields: PipelineVisibleFilenameFields,
    _queue: AsyncItemQueue<PipelinePrintStreamItem>,
    onItem: (item: PipelinePrintStreamItem) => void,
    callbacks: StreamingSourceProducerCallbacks = {},
    resumeState?: PipelineResumeState | undefined,
  ): Promise<StreamingSourceProducerResult> {
    const source = config.source
    if (source.mode === 'collection') {
      const sourcePaths = await scanImageFiles(source.sourceFolder)
      if (sourcePaths.length === 0) {
        throw new AppErrorClass('HTTP_4XX', '采集目录里没有可提取的图片', false)
      }
      callbacks.onPlannedCount?.(sourcePaths.length)
      for (const [index, sourcePath] of sourcePaths.entries()) {
        this.assertCanAcceptMoreWork(active)
        const itemKey = `source-${index + 1}`
        if (resumeState?.completedSourceKeys.has(itemKey)) {
          continue
        }
        onItem({
          itemKey,
          path: sourcePath,
          sourceArtifactIds: [],
        })
      }
      return {
        taskId: `${runId}-collection-source`,
        total: sourcePaths.length,
        succeeded: sourcePaths.length,
        failed: 0,
        images: [],
        failures: [],
        itemCount: sourcePaths.length,
      }
    }
    if (source.mode === 'existing_prints') {
      const paths = await scanImageFiles(source.printFolder)
      if (paths.length === 0) {
        throw new AppErrorClass('HTTP_4XX', '印花目录里没有可套版图片', false)
      }
      callbacks.onPlannedCount?.(paths.length)
      for (const [index, path] of paths.entries()) {
        this.assertCanAcceptMoreWork(active)
        const itemKey = `existing-print-${index + 1}`
        if (resumeState?.completedSourceKeys.has(itemKey)) {
          continue
        }
        onItem({
          itemKey,
          path,
          sourceArtifactIds: [],
        })
      }
      return {
        taskId: `${runId}-existing-prints-source`,
        total: paths.length,
        succeeded: paths.length,
        failed: 0,
        images: paths.map((path) => ({
          prompt: '',
          url: '',
          localPath: path,
        })),
        failures: [],
        itemCount: paths.length,
      }
    }
    if (source.mode === 'txt2img') {
      const completedSourceCount = resumeState?.completedItemsByStep.get('source')?.length ?? 0
      const completedSourceStep = resumeState?.completedSourceStep
      if (completedSourceStep && completedSourceCount >= completedSourceStep.output_count) {
        const total = Math.max(
          completedSourceStep.input_count,
          completedSourceStep.output_count,
          completedSourceCount,
        )
        callbacks.onPlannedCount?.(total)
        return {
          taskId: `${runId}-txt2img`,
          total,
          succeeded: completedSourceCount,
          failed: Math.max(0, total - completedSourceCount),
          images: [],
          failures: [],
          itemCount: completedSourceCount,
        }
      }
      const prompts = await resolvePrompts(source.prompt, 'txt2img', config.printMode)
      callbacks.onPlannedCount?.(prompts.length)
      if (source.provider === 'comfyui-chenyu') {
        const queue = this.comfyuiQueueForInstance(source.comfyui.instanceUuid)
        const aggregate: GenerationRunResult = {
          taskId: `${runId}-txt2img`,
          total: prompts.length,
          succeeded: completedSourceCount,
          failed: 0,
          images: [],
          failures: [],
        }
        let itemCount = completedSourceCount
        for (const [index, prompt] of prompts.entries()) {
          if (index < completedSourceCount) {
            continue
          }
          this.assertCanAcceptMoreWork(active)
          const taskId = `${runId}-txt2img-${index + 1}`
          const result = await this.withGenerationCancel(active, taskId, async () =>
            queue.runExclusive(() =>
              runComfyuiTxt2imgBatch(
                {
                  prompts: [prompt],
                  workflowId: source.comfyui.workflowId,
                  taskId,
                  outputTaskName: taskName,
                  filenameStartIndex: index,
                  ...visibleFilenameFields,
                  ...comfyuiOptionalFields(source.comfyui),
                },
                {
                  onImageComplete: async (payload) => {
                    if (this.stopAcceptingMoreWork(active)) {
                      return
                    }
                    itemCount += 1
                    onItem({
                      itemKey: payload.printId,
                      path: payload.path,
                      artifactId: payload.artifactId,
                      printId: payload.printId,
                      prompt: payload.prompt,
                      sourceArtifactIds: payload.sourceArtifactIds,
                    })
                  },
                },
              ),
            ),
          )
          aggregate.succeeded += result.succeeded
          aggregate.failed += result.failed
          aggregate.images.push(...result.images)
          aggregate.failures.push(...result.failures)
        }
        this.recordStreamingSourceFailures(db, runId, aggregate, itemCount)
        return { ...aggregate, itemCount }
      }
      if (!source.grsai) {
        throw new AppErrorClass('HTTP_4XX', '文生图缺少 Grsai 配置', false)
      }
      const grsaiConfig = source.grsai
      let itemCount = 0
      const promptsToRun = prompts.slice(completedSourceCount)
      if (promptsToRun.length === 0) {
        return {
          taskId: `${runId}-txt2img`,
          total: prompts.length,
          succeeded: completedSourceCount,
          failed: 0,
          images: [],
          failures: [],
          itemCount: completedSourceCount,
        }
      }
      const result = await this.withGenerationCancel(active, `${runId}-txt2img`, async () =>
        runTxt2imgBatch(
          {
            capability: 'txt2img',
            prompts: promptsToRun,
            model: grsaiConfig.model,
            aspectRatio: grsaiConfig.aspectRatio,
            concurrency: grsaiConfig.concurrency ?? 3,
            taskId: `${runId}-txt2img`,
            outputTaskName: taskName,
            ...visibleFilenameFields,
            ...grsaiOptionalFields(grsaiConfig),
          },
          {
            onImageComplete: async (payload) => {
              if (this.stopAcceptingMoreWork(active)) {
                return
              }
              itemCount += 1
              onItem({
                itemKey: payload.printId,
                path: payload.path,
                artifactId: payload.artifactId,
                printId: payload.printId,
                prompt: payload.prompt,
                sourceArtifactIds: payload.sourceArtifactIds,
              })
            },
            emitProgress: emitGenerationProgressAsPipeline(runId, 'source', () => undefined),
          },
        ),
      )
      this.recordStreamingSourceFailures(db, runId, result, completedSourceCount + itemCount)
      return {
        ...result,
        total: prompts.length,
        succeeded: completedSourceCount + result.succeeded,
        itemCount: completedSourceCount + itemCount,
      }
    }
    if (source.mode === 'img2img' && source.provider === 'comfyui-chenyu') {
      const sourcePaths = await scanImageFiles(source.sourceFolder)
      const batchSize = source.comfyui.batchSize ?? 1
      callbacks.onPlannedCount?.(sourcePaths.length * batchSize)
      const queue = this.comfyuiQueueForInstance(source.comfyui.instanceUuid)
      const aggregate: GenerationRunResult = {
        taskId: `${runId}-img2img`,
        total: sourcePaths.length * batchSize,
        succeeded: 0,
        failed: 0,
        images: [],
        failures: [],
      }
      let itemCount = 0
      for (const [index, sourcePath] of sourcePaths.entries()) {
        this.assertCanAcceptMoreWork(active)
        const taskId = `${runId}-img2img-${index + 1}`
        const result = await this.withGenerationCancel(active, taskId, async () =>
          queue.runExclusive(() =>
            runComfyuiImg2imgBatch(
              {
                sourceImagePaths: [sourcePath],
                workflowId: source.comfyui.workflowId,
                taskId,
                outputTaskName: taskName,
                filenameStartIndex: index * batchSize,
                ...visibleFilenameFields,
                ...comfyuiImg2imgOptionalFields(source.comfyui),
                ...comfyuiImg2imgPromptFields(source.prompt, config.printMode),
              },
              {
                onImageComplete: async (payload) => {
                  if (this.stopAcceptingMoreWork(active)) {
                    return
                  }
                  itemCount += 1
                  onItem({
                    itemKey: payload.printId,
                    path: payload.path,
                    artifactId: payload.artifactId,
                    printId: payload.printId,
                    prompt: payload.prompt,
                    sourceArtifactIds: payload.sourceArtifactIds,
                  })
                },
              },
            ),
          ),
        )
        aggregate.succeeded += result.succeeded
        aggregate.failed += result.failed
        aggregate.images.push(...result.images)
        aggregate.failures.push(...result.failures)
      }
      this.recordStreamingSourceFailures(db, runId, aggregate, itemCount)
      return { ...aggregate, itemCount }
    }
    if (source.mode === 'img2img' && source.provider === 'grsai') {
      const sourcePaths = source.referenceImagePaths?.length
        ? source.referenceImagePaths
        : source.sourceFolder
          ? await scanImageFiles(source.sourceFolder)
          : []
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
      callbacks.onPlannedCount?.(prompts.length)
      if (!source.grsai) {
        throw new AppErrorClass('HTTP_4XX', '图生图缺少 Grsai 配置', false)
      }
      const grsaiConfig = source.grsai
      let itemCount = 0
      const result = await this.withGenerationCancel(active, `${runId}-img2img`, async () =>
        runTxt2imgBatch(
          {
            capability: 'img2img',
            prompts,
            model: grsaiConfig.model,
            aspectRatio: grsaiConfig.aspectRatio,
            concurrency: grsaiConfig.concurrency ?? 3,
            taskId: `${runId}-img2img`,
            outputTaskName: taskName,
            ...(references?.length ? { referenceImages: references } : {}),
            ...visibleFilenameFields,
            ...grsaiOptionalFields(grsaiConfig),
          },
          {
            onImageComplete: async (payload) => {
              if (this.stopAcceptingMoreWork(active)) {
                return
              }
              itemCount += 1
              onItem({
                itemKey: payload.printId,
                path: payload.path,
                artifactId: payload.artifactId,
                printId: payload.printId,
                prompt: payload.prompt,
                sourceArtifactIds: payload.sourceArtifactIds,
              })
            },
          },
        ),
      )
      this.recordStreamingSourceFailures(db, runId, result, itemCount)
      return { ...result, itemCount }
    }
    throw new AppErrorClass('HTTP_5XX', '当前来源暂不支持流式生产者', true)
  }

  private recordStreamingSourceFailures(
    db: Pick<SqliteDatabase, 'prepare'>,
    runId: string,
    result: GenerationRunResult,
    itemCount: number,
  ) {
    if (result.failed <= 0) {
      return
    }
    const baseIndex = Math.max(0, itemCount)
    for (const [index, failure] of result.failures.entries()) {
      const itemKey = `source-failure-${baseIndex + index + 1}`
      this.upsertPipelineItem(db, {
        runId,
        itemKey,
        stepKey: 'source',
        status: 'failed',
        sourcePath: failure.sourcePath,
        sourceArtifactIds: [],
        errorMessage: failure.error,
        completed: true,
      })
    }
  }

  private createStreamingExtractStage(
    db: Pick<SqliteDatabase, 'prepare'>,
    active: ActivePipelineRun,
    context: PipelineStageRuntimeContext,
    stats: PipelineRunStats,
    visibleFilenameFields: PipelineVisibleFilenameFields,
  ) {
    const collectionSource =
      context.config.source.mode === 'collection' ? context.config.source : null
    if (!collectionSource) {
      throw new AppErrorClass('HTTP_5XX', '仅 collection 来源可创建 extract stage', true)
    }
    const activeCollectionSource = collectionSource
    let queued = 0
    let completed = 0
    let failed = 0
    const outputItems: PipelineImage[] = []

    const refreshExtractSection = () => {
      this.updateResultSection(
        context.runId,
        resultSection({
          key: IMAGE_PROCESSING_SECTION_KEY,
          title: '图像处理',
          items: outputItems.map((image, index) =>
            resultImageFromPipelineImage('extract', basename(image.path), image, index),
          ),
          total: queued,
          failed,
        }),
      )
    }

    return (input: AsyncIterable<PipelinePrintStreamItem>) => {
      const service = this
      async function* stage(items: AsyncIterable<PipelinePrintStreamItem>) {
        db.prepare(
          `
            INSERT INTO pipeline_steps (
              id, run_id, step_key, module, label, status, input_count, output_count, output_json,
              error_json, started_at, completed_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?, NULL, ?)
            ON CONFLICT(run_id, step_key) DO UPDATE SET
              status = excluded.status,
              input_count = excluded.input_count,
              output_count = excluded.output_count,
              output_json = NULL,
              error_json = NULL,
              started_at = excluded.started_at,
              completed_at = NULL,
              updated_at = excluded.updated_at
          `,
        ).run(
          `${context.runId}:extract`,
          context.runId,
          'extract',
          'generation',
          '提取',
          'running',
          0,
          0,
          Date.now(),
          Date.now(),
        )

        const sourceItems: PipelinePrintStreamItem[] = []
        for await (const item of items) {
          service.assertCanAcceptMoreWork(active)
          queued += 1
          sourceItems.push(item)
          service.upsertPipelineItem(db, {
            runId: context.runId,
            itemKey: item.itemKey,
            stepKey: 'extract',
            status: 'running',
            sourcePath: item.path,
            sourceArtifactIds: item.sourceArtifactIds,
          })
          db.prepare(
            `
              UPDATE pipeline_steps
              SET input_count = ?, updated_at = ?
              WHERE run_id = ? AND step_key = 'extract'
            `,
          ).run(queued, Date.now(), context.runId)
          service.emitRunProgress(db, context.runId, 'running', 'extract', stats, '提取流处理中')
        }

        if (sourceItems.length === 0) {
          db.prepare(
            `
              UPDATE pipeline_steps
              SET status = 'completed',
                  input_count = 0,
                  output_count = 0,
                  output_json = ?,
                  completed_at = ?,
                  updated_at = ?
              WHERE run_id = ? AND step_key = 'extract'
            `,
          ).run(
            JSON.stringify({ total: 0, succeeded: 0, failed: 0 }),
            Date.now(),
            Date.now(),
            context.runId,
          )
          service.emitRunProgress(db, context.runId, 'running', 'extract', stats, '提取完成')
          return
        }

        const sourceItemByArtifactId = new Map<string, PipelinePrintStreamItem>()
        const sourceItemsByPath = new Map(sourceItems.map((item) => [item.path, item] as const))
        const stageOutput = new AsyncItemQueue<PipelinePrintStreamItem>()

        service.updateResultSection(
          context.runId,
          resultSection({
            key: IMAGE_PROCESSING_SECTION_KEY,
            title: '图像处理',
            items: loadingResultImages('extract', '图像加载中', sourceItems.length),
            total: sourceItems.length,
          }),
        )

        for (const sourceItem of sourceItems) {
          if (sourceItem.sourceArtifactIds[0]) {
            sourceItemByArtifactId.set(sourceItem.sourceArtifactIds[0], sourceItem)
          }
        }

        const extractResult = await service.runExtractConfig(
          active,
          context.runId,
          context.taskName,
          activeCollectionSource.extract,
          sourceItems.map((item) => ({ path: item.path })),
          visibleFilenameFields,
          (message) => {
            service.appendLog(context.runId, {
              level: 'info',
              step_key: 'extract',
              message,
            })
            service.emitRunProgress(db, context.runId, 'running', 'extract', stats, message)
          },
          (_images, total, failedCount) => {
            service.updateResultSection(
              context.runId,
              resultSection({
                key: IMAGE_PROCESSING_SECTION_KEY,
                title: '图像处理',
                items: [
                  ...outputItems.map((image, index) =>
                    resultImageFromPipelineImage('extract', basename(image.path), image, index),
                  ),
                  ...loadingResultImages(
                    'extract',
                    '图像加载中',
                    Math.max(0, total - outputItems.length - failedCount),
                  ),
                ],
                total,
                failed: failedCount,
              }),
            )
            service.emitRunProgress(db, context.runId, 'running', 'extract', stats, '提取流处理中')
          },
          async (payload) => {
            const sourceArtifactId = payload.sourceArtifactIds[0]
            const sourceItem = sourceArtifactId
              ? sourceItemByArtifactId.get(sourceArtifactId)
              : undefined
            const itemKey = payload.printId ?? sourceItem?.itemKey ?? `extract-${completed + 1}`
            const prompt = payload.prompt ?? sourceItem?.prompt
            completed += 1
            outputItems.push({
              path: payload.path,
              ...(payload.artifactId ? { artifactId: payload.artifactId } : {}),
              ...(payload.printId ? { printId: payload.printId } : {}),
              ...(prompt ? { prompt } : {}),
            })
            stats.prints = completed
            service.upsertPipelineItem(db, {
              runId: context.runId,
              itemKey,
              stepKey: 'extract',
              status: 'completed',
              sourcePath: sourceItem?.path,
              outputPath: payload.path,
              artifactId: payload.artifactId,
              printId: payload.printId,
              sourceArtifactIds: payload.sourceArtifactIds,
              completed: true,
            })
            refreshExtractSection()
            db.prepare(
              `
                UPDATE pipeline_steps
                SET output_count = ?, updated_at = ?
                WHERE run_id = ? AND step_key = 'extract'
              `,
            ).run(completed, Date.now(), context.runId)
            stageOutput.push({
              itemKey,
              path: payload.path,
              artifactId: payload.artifactId,
              printId: payload.printId,
              prompt,
              sourceArtifactIds: payload.sourceArtifactIds,
            })
          },
        )

        failed = extractResult.failed
        service.appendGenerationFailureLog(context.runId, 'extract', '提取', extractResult)
        for (const failure of extractResult.failures) {
          const failedItem = failure.sourcePath
            ? sourceItemsByPath.get(failure.sourcePath)
            : undefined
          if (!failedItem) {
            continue
          }
          service.upsertPipelineItem(db, {
            runId: context.runId,
            itemKey: failedItem.itemKey,
            stepKey: 'extract',
            status: 'failed',
            sourcePath: failedItem.path,
            sourceArtifactIds: failedItem.sourceArtifactIds,
            errorMessage: failure.error,
            completed: true,
          })
        }
        refreshExtractSection()
        db.prepare(
          `
            UPDATE pipeline_steps
            SET status = 'completed',
                input_count = ?,
                output_count = ?,
                output_json = ?,
                completed_at = ?,
                updated_at = ?
            WHERE run_id = ? AND step_key = 'extract'
          `,
        ).run(
          queued,
          completed,
          JSON.stringify({
            total: extractResult.total,
            succeeded: extractResult.succeeded,
            failed: extractResult.failed,
          }),
          Date.now(),
          Date.now(),
          context.runId,
        )
        service.emitRunProgress(db, context.runId, 'running', 'extract', stats, '提取完成')
        stageOutput.end()

        for await (const item of stageOutput) {
          yield item
        }
      }
      return stage(input)
    }
  }

  private createStreamingMattingStage(
    db: Pick<SqliteDatabase, 'prepare'>,
    active: ActivePipelineRun,
    context: PipelineStageRuntimeContext,
    stats: PipelineRunStats,
    visibleFilenameFields: PipelineVisibleFilenameFields,
    sourceTotalRef: { value: number },
    sourceFailedRef: { value: number },
  ) {
    const queue = this.comfyuiQueueForInstance(context.config.matting.instanceUuid)
    let queued = 0
    let completed = 0
    let failed = 0
    let outputIndex = 0
    const outputItems: PipelineImage[] = []

    const refreshMattingSection = () => {
      this.updateResultSection(
        context.runId,
        resultSection({
          key: IMAGE_PROCESSING_SECTION_KEY,
          title: '抠图结果',
          items: outputItems.map((image, index) =>
            resultImageFromPipelineImage('matting', basename(image.path), image, index),
          ),
          total: sourceTotalRef.value,
          failed,
        }),
      )
    }

    return (input: AsyncIterable<PipelinePrintStreamItem>) => {
      const service = this
      async function* stage(items: AsyncIterable<PipelinePrintStreamItem>) {
        db.prepare(
          `
            INSERT INTO pipeline_steps (
              id, run_id, step_key, module, label, status, input_count, output_count, output_json,
              error_json, started_at, completed_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?, NULL, ?)
            ON CONFLICT(run_id, step_key) DO UPDATE SET
              status = excluded.status,
              input_count = excluded.input_count,
              output_count = excluded.output_count,
              output_json = NULL,
              error_json = NULL,
              started_at = excluded.started_at,
              completed_at = NULL,
              updated_at = excluded.updated_at
          `,
        ).run(
          `${context.runId}:matting`,
          context.runId,
          'matting',
          'generation',
          '抠图',
          'running',
          0,
          0,
          Date.now(),
          Date.now(),
        )
        for await (const item of items) {
          service.assertCanAcceptMoreWork(active)
          queued += 1
          db.prepare(
            `
              UPDATE pipeline_steps
              SET input_count = ?, updated_at = ?
              WHERE run_id = ? AND step_key = 'matting'
            `,
          ).run(queued, Date.now(), context.runId)
          service.emitRunProgress(db, context.runId, 'running', 'matting', stats, '抠图流处理中')
          service.upsertPipelineItem(db, {
            runId: context.runId,
            itemKey: item.itemKey,
            stepKey: 'matting',
            status: 'running',
            sourcePath: item.path,
            artifactId: item.artifactId,
            printId: item.printId,
            sourceArtifactIds: item.sourceArtifactIds,
          })

          try {
            let result: GenerationRunResult
            if (context.config.matting.mode === 'mixed') {
              const workflowId = context.config.matting.workflowId
              if (!workflowId) {
                throw new AppErrorClass('HTTP_4XX', '混合抠图需要选择 ComfyUI 工作流', false)
              }
              const taskId = `${context.runId}-matting-${item.itemKey}`
              result = await service.withGenerationCancel(active, taskId, () =>
                queue.runExclusive(() =>
                  runMixedMattingBatch(
                    {
                      sourceImagePaths: [item.path],
                      workflowId,
                      taskId,
                      outputTaskName: context.taskName,
                      filenameStartIndex: outputIndex,
                      ...visibleFilenameFields,
                      ...mattingOptionalFields(context.config.matting),
                    },
                    {},
                  ),
                ),
              )
            } else {
              const workflowId = context.config.matting.workflowId
              if (!workflowId) {
                throw new AppErrorClass('HTTP_4XX', '抠图需要选择 ComfyUI 工作流', false)
              }
              const taskId = `${context.runId}-matting-${item.itemKey}`
              result = await service.withGenerationCancel(active, taskId, () =>
                queue.runExclusive(() =>
                  runComfyuiMattingBatch(
                    {
                      sourceImagePaths: [item.path],
                      workflowId,
                      taskId,
                      outputTaskName: context.taskName,
                      filenameStartIndex: outputIndex,
                      ...visibleFilenameFields,
                      ...mattingOptionalFields(context.config.matting),
                    },
                    {},
                  ),
                ),
              )
            }
            const output = usableGenerationImages(result, '抠图')[0]
            if (!output) {
              throw new AppErrorClass('HTTP_4XX', '抠图未产生结果', false)
            }
            completed += 1
            outputIndex += result.succeeded
            const outputWithPrompt: PipelineImage = {
              ...output,
              ...(item.prompt
                ? { prompt: item.prompt }
                : output.prompt
                  ? { prompt: output.prompt }
                  : {}),
            }
            outputItems.push(outputWithPrompt)
            stats.prints = completed
            service.upsertPipelineItem(db, {
              runId: context.runId,
              itemKey: item.itemKey,
              stepKey: 'matting',
              status: 'completed',
              sourcePath: item.path,
              outputPath: output.path,
              artifactId: output.artifactId,
              printId: output.printId,
              sourceArtifactIds: item.sourceArtifactIds,
              completed: true,
            })
            refreshMattingSection()
            db.prepare(
              `
                UPDATE pipeline_steps
                SET output_count = ?, updated_at = ?
                WHERE run_id = ? AND step_key = 'matting'
              `,
            ).run(completed, Date.now(), context.runId)
            service.emitRunProgress(db, context.runId, 'running', 'matting', stats, '抠图流处理中')
            yield {
              itemKey: item.itemKey,
              path: output.path,
              artifactId: output.artifactId,
              printId: output.printId,
              prompt: outputWithPrompt.prompt,
              sourceArtifactIds: item.sourceArtifactIds,
            } satisfies PipelinePrintStreamItem
          } catch (error) {
            failed += 1
            service.upsertPipelineItem(db, {
              runId: context.runId,
              itemKey: item.itemKey,
              stepKey: 'matting',
              status: 'failed',
              sourcePath: item.path,
              artifactId: item.artifactId,
              printId: item.printId,
              sourceArtifactIds: item.sourceArtifactIds,
              errorMessage: appErrorMessage(error),
              completed: true,
            })
            service.appendLog(context.runId, {
              level: 'warn',
              step_key: 'matting',
              message: '单张抠图失败，已跳过',
              details: {
                itemKey: item.itemKey,
                error: appErrorMessage(error),
              },
            })
            refreshMattingSection()
          }
        }
        db.prepare(
          `
            UPDATE pipeline_steps
            SET status = 'completed',
                input_count = ?,
                output_count = ?,
                output_json = ?,
                completed_at = ?,
                updated_at = ?
            WHERE run_id = ? AND step_key = 'matting'
          `,
        ).run(
          queued,
          completed,
          JSON.stringify({
            total: sourceTotalRef.value,
            succeeded: completed,
            failed,
            sourceFailed: sourceFailedRef.value,
          }),
          Date.now(),
          Date.now(),
          context.runId,
        )
        service.emitRunProgress(db, context.runId, 'running', 'matting', stats, '抠图完成')
      }
      return stage(input)
    }
  }

  private async runMattingStep(
    db: Pick<SqliteDatabase, 'prepare'>,
    active: ActivePipelineRun,
    runId: string,
    config: PipelineMattingConfig,
    prints: PipelineImage[],
    stats: PipelineRunStats,
    visibleFilenameFields: PipelineVisibleFilenameFields,
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
          const workflowId = config.workflowId
          if (!workflowId) {
            throw new AppErrorClass('HTTP_4XX', '混合抠图需要选择 ComfyUI 工作流', false)
          }
          result = await this.withGenerationCancel(active, `${runId}-matting`, async () =>
            runMixedMattingBatch(
              {
                sourceImagePaths,
                workflowId,
                taskId: `${runId}-matting`,
                ...visibleFilenameFields,
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
            ),
          )
        } else {
          const workflowId = config.workflowId
          if (!workflowId) {
            throw new AppErrorClass('HTTP_4XX', '抠图需要选择 ComfyUI 工作流', false)
          }
          result = await this.withGenerationCancel(active, `${runId}-matting`, async () =>
            runComfyuiMattingBatch(
              {
                sourceImagePaths,
                workflowId,
                taskId: `${runId}-matting`,
                ...visibleFilenameFields,
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
            ),
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
    requireContinuingPrints: boolean,
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
          imageInputs: prints.map((image) => ({
            path: image.path,
            ...(image.artifactId ? { artifactId: image.artifactId } : {}),
            ...(image.printId ? { printId: image.printId } : {}),
          })),
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
        if (requireContinuingPrints && output.images.length === 0) {
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
        let completed = false
        try {
          const photoshopPrints = await preparePhotoshopPrints(
            workbenchRoot,
            runId,
            prints,
            config.printSkuCode,
            config.filenameSeparator,
          )
          emitMessage('正在等待 Photoshop 空闲')
          const result = await this.photoshopMutex.runExclusive(async () => {
            this.assertCanAcceptMoreWork(active)
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
          completed = true
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
        } finally {
          active.currentCancel = null
          if (completed) {
            await tempFileManager.cleanupTask('photoshop', taskId)
          } else {
            await tempFileManager.cleanupTask('photoshop', taskId, { keepIfFailed: true })
          }
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
          this.assertCanAcceptMoreWork(active)
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
  ipcMain.handle('pipeline:resume', (_event, input: unknown) => {
    return pipelineService.startResume(parsePipelineRunIdInput(input).run_id)
  })
  ipcMain.handle('pipeline:cancel', (_event, input: { run_id: string }) => ({
    ok: pipelineService.cancelRun(input.run_id),
  }))
  ipcMain.handle('pipeline:list-runs', () => pipelineService.listRuns())
  ipcMain.handle('pipeline:get-run', (_event, input: { run_id: string }) =>
    pipelineService.getRun(input.run_id),
  )
}
