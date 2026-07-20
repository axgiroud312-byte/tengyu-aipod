import { createHash, randomUUID } from 'node:crypto'
import type { Dirent } from 'node:fs'
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
  type PipelineRunStats,
  type PipelineRuntimeLogEntry,
  type PipelineSourceConfig,
  type PipelineSourceManifestItem,
  type PipelineTaskEvent,
  WORKBENCH_DIRECTORIES,
  isPipelineRunConfig,
  pipelineRunConfigBaseSchema,
} from '@tengyu-aipod/shared'
import { BrowserWindow, ipcMain } from 'electron'
import { z } from 'zod'
import { readAppConfig } from '../../onboarding'
import { runBatch } from '../../photoshop/multi-batch'
import { type CollectionFolderReadLock, collectionFolderLock } from '../collection-folder-lock'
import {
  type DetectionBatchResult,
  type DetectionImageResult,
  detectionService,
} from '../detection-service'
import { errorForDiagnosticLog, writeOptionalDiagnosticLogEvent } from '../diagnostic-log-service'
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
} from '../generation-service'
import { appErrorFromGenerationFailure, fatalGenerationFailure } from '../generation/failures'
import { shouldPipelineDetectionAllow } from '../pipeline-policy'
import type {
  PipelinePrintStageRegistration,
  PipelinePrintStreamItem,
  PipelineStageRuntimeContext,
} from '../pipeline-stage-types'
import { createDetectionStage } from '../pipeline-stages/detection-stage'
import {
  PHOTOSHOP_MUTEX_TIMEOUT_ERROR_KIND,
  createPhotoshopStage,
} from '../pipeline-stages/photoshop-stage'
import { createTitleStage } from '../pipeline-stages/title-stage'
import type { SqliteDatabase } from '../sqlite'
import { tempFileManager } from '../temp-file-manager'
import { type TitleBatchResult, titleService } from '../title-service'
import {
  assertTargetDoesNotExist,
  nextVisibleImageName,
  normalizedVisibleImageNaming,
} from '../user-visible-filename'
import {
  openWorkbenchDatabase as openWorkbenchDatabaseFile,
  workbenchDatabasePath,
} from '../workbench-db'
import {
  type WorkbenchPathDomain,
  assertPathInsideWorkbench,
  canonicalPath,
} from '../workbench-path-guard'
import * as pipelineStore from './store'
import type {
  PipelineItemRecord,
  PipelineRunRecord,
  PipelineRunStatus,
  PipelineStepKey,
  PipelineStepRecord,
} from './types'

const IMAGE_EXTENSIONS = /\.(?:jpe?g|png|webp)$/i
const WAITING_PHOTOSHOP_PRINT_FOLDER = '等待套版'
const PIPELINE_RUNS_FOLDER = 'pipeline-runs'
const IMAGE_PROCESSING_SECTION_KEY = 'image_processing'
const PHOTOSHOP_MUTEX_TIMEOUT_MS = 10 * 60 * 1000
const PROGRESS_DETAIL_INTERVAL = 32
const RESULT_DETAIL_MAX_LATENCY_MS = 50
const UI_STATE_PERSIST_INTERVAL = 32
const PIPELINE_CANCELLED_MESSAGE = '完整任务已取消'
const PIPELINE_CANCELLED_ERROR_KIND = 'pipeline_cancelled'
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
  itemsByStep: Map<PipelineStepKey, PipelineItemRecord[]>
  itemByStepAndKey: Map<string, PipelineItemRecord>
  completedItemsByStep: Map<PipelineStepKey, PipelineItemRecord[]>
  completedItemByStepAndKey: Map<string, PipelineItemRecord>
  filteredItemByStepAndKey: Map<string, PipelineItemRecord>
  completedSourceKeys: Set<string>
  completedSourceStep: PipelineStepRecord | null
}

type PipelineCancelHandler = () => void | Promise<void>

type PendingPipelineProgress = {
  status: PipelineRunStatus
  currentStep: PipelineStepKey | null
  stats: PipelineRunStats
  message: string
  includeDetails: boolean
}

type PreparedPipelineRun = {
  workbenchRoot: string
  config: PipelineRunConfig
}

type ActivePipelineRun = {
  db: Pick<SqliteDatabase, 'prepare'>
  resuming: boolean
  cancelRequested: boolean
  stopError: unknown | null
  interrupted: boolean
  cancelHandlers: Map<string, PipelineCancelHandler>
  previewImages: PipelinePreviewImage[]
  resultSections: PipelineResultSection[]
  logs: PipelineRuntimeLogEntry[]
  collectionReadLock: CollectionFolderReadLock | null
  pendingProgress: PendingPipelineProgress | null
  lastProgress: PendingPipelineProgress | null
  progressFlushHandle: ReturnType<typeof setImmediate> | null
  resultDetailFlushHandle: ReturnType<typeof setTimeout> | null
  progressError: unknown | null
  progressRevision: number
  nextFullProgressRevision: number
  forceNextProgressDetails: boolean
  resultSectionsDirty: boolean
  lastDetailedProgressAt: number
  uiStateDirty: boolean
  uiStateFlushHandle: ReturnType<typeof setImmediate> | null
  uiStateError: unknown | null
  uiStateRevision: number
  nextUiStatePersistRevision: number
}

function isPipelineCancellationError(error: unknown) {
  return (
    error instanceof AppErrorClass &&
    error.code === 'HTTP_4XX' &&
    (error.details?.kind === PIPELINE_CANCELLED_ERROR_KIND ||
      error.message === PIPELINE_CANCELLED_MESSAGE)
  )
}

function pipelineFailureWasCancellation(active: ActivePipelineRun, error: unknown) {
  return (
    active.cancelRequested &&
    isPipelineCancellationError(error) &&
    (active.stopError === null || isPipelineCancellationError(active.stopError))
  )
}

type PromiseMutexOptions = {
  waitTimeoutMs?: number
  timeoutError?: () => Error
}

class PromiseMutex {
  private current = Promise.resolve()

  constructor(private readonly defaults: PromiseMutexOptions = {}) {}

  async runExclusive<T>(fn: () => Promise<T>): Promise<T> {
    const previous = this.current
    let release: () => void = () => {}
    let acquired = false
    this.current = new Promise<void>((resolve) => {
      release = resolve
    })
    try {
      await this.waitForPrevious(previous)
      acquired = true
      return await fn()
    } finally {
      if (acquired) {
        release()
      } else {
        // A timed-out waiter must preserve the queue until the current holder releases.
        void previous.then(release)
      }
    }
  }

  private async waitForPrevious(previous: Promise<void>) {
    const waitTimeoutMs = this.defaults.waitTimeoutMs
    if (waitTimeoutMs === undefined) {
      await previous
      return
    }
    let timeoutId: ReturnType<typeof setTimeout> | undefined
    try {
      await Promise.race([
        previous,
        new Promise<never>((_, reject) => {
          timeoutId = setTimeout(() => {
            reject(
              this.defaults.timeoutError?.() ??
                new AppErrorClass('HTTP_5XX', '任务等待超时,请稍后重试', true),
            )
          }, waitTimeoutMs)
        }),
      ])
    } finally {
      if (timeoutId !== undefined) {
        clearTimeout(timeoutId)
      }
    }
  }
}

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

const INTERNAL_RECOVERY_METADATA_MESSAGE = '完整任务启动参数包含内部恢复数据'
const pipelineLaunchConfigSchema = pipelineRunConfigSchema.superRefine((config, context) => {
  const source = config.source
  if ('sourceManifest' in source && source.sourceManifest !== undefined) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: INTERNAL_RECOVERY_METADATA_MESSAGE,
      path: ['source', 'sourceManifest'],
    })
  }
  if (
    source.mode === 'img2img' &&
    source.provider === 'grsai' &&
    source.referenceImagePaths !== undefined
  ) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: INTERNAL_RECOVERY_METADATA_MESSAGE,
      path: ['source', 'referenceImagePaths'],
    })
  }
  if (source.mode !== 'txt2img' && source.mode !== 'img2img') {
    return
  }
  if (source.prompt?.mode === 'ai' && source.prompt.prompts !== undefined) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: INTERNAL_RECOVERY_METADATA_MESSAGE,
      path: ['source', 'prompt', 'prompts'],
    })
  }
  if (source.prompt?.resolvedPromptsBySourceKey !== undefined) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: INTERNAL_RECOVERY_METADATA_MESSAGE,
      path: ['source', 'prompt', 'resolvedPromptsBySourceKey'],
    })
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

function sourceManifestItemKey(prefix: string, folder: string, imagePath: string) {
  const relativePath = relative(resolve(folder), resolve(imagePath))
    .split(sep)
    .join('/')
    .normalize('NFC')
  const pathIdentity = process.platform === 'win32' ? relativePath.toLowerCase() : relativePath
  const digest = createHash('sha256').update(pathIdentity).digest('hex').slice(0, 32)
  return `${prefix}-${digest}`
}

function buildSourceManifest(
  prefix: string,
  folder: string,
  paths: readonly string[],
): PipelineSourceManifestItem[] {
  return paths.map((path) => ({
    itemKey: sourceManifestItemKey(prefix, folder, path),
    path,
  }))
}

function generatedSourceOutputItemKey(sourceItemKey: string, outputIndex: number) {
  return `${sourceItemKey}-${outputIndex + 1}`
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
    throw new AppErrorClass('INVALID_INPUT', '请选择有效的图片文件夹', false, { folder })
  }

  let folderStat: Awaited<ReturnType<typeof stat>>
  try {
    folderStat = await stat(folder)
  } catch (error) {
    const filesystemCode = readFilesystemErrorCode(error)
    if (filesystemCode === 'ENOENT' || filesystemCode === 'ENOTDIR') {
      throw new AppErrorClass('INVALID_INPUT', '选择的路径不是文件夹', false, {
        folder,
        filesystemCode,
      })
    }
    throw new AppErrorClass(
      'WORKSPACE_IO_FAILED',
      `无法读取图片文件夹，请检查目录权限和状态后重试：${folder}`,
      false,
      { folder, operation: 'stat', filesystemCode },
      error,
    )
  }
  if (!folderStat.isDirectory()) {
    throw new AppErrorClass('INVALID_INPUT', '选择的路径不是文件夹', false, { folder })
  }

  const files: string[] = []
  async function visit(currentFolder: string) {
    let entries: Dirent[]
    try {
      entries = await readdir(currentFolder, { withFileTypes: true })
    } catch (error) {
      throw new AppErrorClass(
        'WORKSPACE_IO_FAILED',
        `无法扫描图片文件夹，请检查目录权限和状态后重试：${currentFolder}`,
        false,
        {
          folder,
          currentFolder,
          operation: 'readdir',
          filesystemCode: readFilesystemErrorCode(error),
        },
        error,
      )
    }
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

function readFilesystemErrorCode(error: unknown) {
  if (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    typeof error.code === 'string'
  ) {
    return error.code
  }
  return undefined
}

async function assertPipelinePathInsideWorkbench(
  workbenchRoot: string,
  targetPath: string,
  options: { domain: WorkbenchPathDomain; label: string },
) {
  try {
    return await assertPathInsideWorkbench(workbenchRoot, targetPath, options)
  } catch (error) {
    if (error instanceof AppErrorClass && error.code === 'HTTP_4XX') {
      throw new AppErrorClass('INVALID_INPUT', error.message, false, error.details, error)
    }
    throw error
  }
}

async function pathExists(path: string) {
  try {
    await stat(path)
    return true
  } catch (error) {
    const filesystemCode = readFilesystemErrorCode(error)
    if (filesystemCode === 'ENOENT' || filesystemCode === 'ENOTDIR') {
      return false
    }
    throw new AppErrorClass(
      'WORKSPACE_IO_FAILED',
      '无法检查续跑文件状态，请检查文件权限和状态后重试',
      false,
      { path, operation: 'stat', ...(filesystemCode ? { filesystemCode } : {}) },
      error,
    )
  }
}

function resumeItemMapKey(stepKey: PipelineStepKey, itemKey: string) {
  return `${stepKey}:${itemKey}`
}

function generatedSourceItemKey(
  sourceMode: Extract<PipelineSourceConfig['mode'], 'txt2img' | 'img2img'>,
  payload: GenerationImageCompletePayload,
) {
  if (
    Number.isSafeInteger(payload.inputIndex) &&
    Number.isSafeInteger(payload.outputIndex) &&
    (payload.inputIndex ?? -1) >= 0 &&
    (payload.outputIndex ?? -1) >= 0
  ) {
    return `${sourceMode}-${(payload.inputIndex ?? 0) + 1}-${(payload.outputIndex ?? 0) + 1}`
  }
  return payload.printId
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

function mergeById<T extends { id: string }>(existing: readonly T[], incoming: readonly T[]) {
  const merged = new Map(existing.map((item) => [item.id, item] as const))
  for (const item of incoming) {
    merged.set(item.id, item)
  }
  return Array.from(merged.values())
}

function mergeResumeResultSection(
  existing: PipelineResultSection,
  incoming: PipelineResultSection,
): PipelineResultSection {
  const items = mergeById(
    existing.items.filter((item) => item.status === 'success'),
    incoming.items,
  )
  const groups =
    existing.groups || incoming.groups
      ? mergeById(existing.groups ?? [], incoming.groups ?? [])
      : undefined
  const completed = groups?.length ?? items.filter((item) => item.status === 'success').length
  const requestedFailed = incoming.failed ?? 0
  const total = Math.max(existing.total, incoming.total, completed + requestedFailed)
  return {
    ...existing,
    ...incoming,
    items,
    ...(groups ? { groups } : {}),
    total,
    completed,
    failed: Math.max(requestedFailed, total - completed),
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
    const firstError = result.failures[0]?.error
    throw new AppErrorClass('HTTP_4XX', firstError || `${stepName} 未产生可继续处理的印花`, false, {
      total: result.total,
      failed: result.failed,
      ...(firstError ? { stepName } : {}),
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
  if (!parsed.success || !isPipelineRunConfig(parsed.data)) {
    throw new AppErrorClass('INVALID_INPUT', '完整任务参数无效', false, {
      issues: parsed.success ? [] : parsed.error.issues,
    })
  }
  return parsed.data
}

function parsePipelineLaunchConfig(input: unknown): PipelineRunConfig {
  const parsed = pipelineLaunchConfigSchema.safeParse(input)
  if (!parsed.success || !isPipelineRunConfig(parsed.data)) {
    const issues = parsed.success ? [] : parsed.error.issues
    const recoveryIssue = issues.find(
      (issue) => issue.message === INTERNAL_RECOVERY_METADATA_MESSAGE,
    )
    throw new AppErrorClass('INVALID_INPUT', recoveryIssue?.message ?? '完整任务参数无效', false, {
      issues,
    })
  }
  return parsed.data
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

function fatalGenerationResultError(result: GenerationRunResult, stepKey: PipelineStepKey) {
  const failure = fatalGenerationFailure(result.failures)
  return failure
    ? appErrorFromGenerationFailure(failure, {
        kind: 'generation_provider_fatal',
        stepKey,
      })
    : null
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
  if (prompt.mode === 'manual' || prompt.prompts?.length) {
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
  private readonly fireAndForgetStartKeys = new Map<string, string>()
  private readonly fireAndForgetResumeRunIds = new Set<string>()
  private readonly photoshopMutex = new PromiseMutex({
    waitTimeoutMs: PHOTOSHOP_MUTEX_TIMEOUT_MS,
    timeoutError: () =>
      new AppErrorClass('PS_COM_FAILED', 'Photoshop 无响应,请检查 PS 后重试', true, {
        kind: PHOTOSHOP_MUTEX_TIMEOUT_ERROR_KIND,
        timeout_ms: PHOTOSHOP_MUTEX_TIMEOUT_MS,
      }),
  })
  async startRun(config: unknown) {
    const parsedConfig = parsePipelineLaunchConfig(config)
    const runId = randomUUID()
    const startKey = this.acquireFireAndForgetStartKey(runId, parsedConfig)
    let prepared: PreparedPipelineRun
    try {
      prepared = await this.prepareRun(runId, parsedConfig)
    } catch (error) {
      this.releaseFireAndForgetStartKey(startKey, runId)
      throw error
    }
    void this.runPipeline(runId, prepared.config, prepared)
      .then((detail) => emitPipelineCompleted({ ok: true, result: detail }))
      .catch((error) =>
        emitPipelineCompleted({ ok: false, run_id: runId, error: appErrorMessage(error) }),
      )
      .finally(() => {
        this.releaseFireAndForgetStartKey(startKey, runId)
      })
    return runId
  }

  startResume(runId: string) {
    if (this.activeRuns.has(runId) || this.fireAndForgetResumeRunIds.has(runId)) {
      throw new AppErrorClass('INVALID_INPUT', '完整任务正在运行,不能重复续跑', false, {
        runId,
      })
    }
    this.fireAndForgetResumeRunIds.add(runId)
    void this.resumeRun(runId)
      .then((detail) => emitPipelineCompleted({ ok: true, result: detail }))
      .catch((error) =>
        emitPipelineCompleted({ ok: false, run_id: runId, error: appErrorMessage(error) }),
      )
      .finally(() => {
        this.fireAndForgetResumeRunIds.delete(runId)
      })
    return runId
  }

  cancelRun(runId: string) {
    const active = this.activeRuns.get(runId)
    if (!active) {
      return false
    }
    active.cancelRequested = true
    this.invokeCancelHandlers(active)
    return true
  }

  private invokeCancelHandlers(active: ActivePipelineRun) {
    for (const cancel of active.cancelHandlers.values()) {
      try {
        const result = cancel()
        if (result instanceof Promise) {
          void result.catch(() => undefined)
        }
      } catch {
        // Cancellation is best effort; stage cleanup still owns the underlying error path.
      }
    }
  }

  private stopRunForStageError(active: ActivePipelineRun, error: unknown) {
    if (active.stopError !== null) {
      return
    }
    active.stopError = error
    this.invokeCancelHandlers(active)
  }

  getActiveRunCount() {
    return this.activeRuns.size
  }

  async listRuns(): Promise<PipelineRunRecord[]> {
    const workbenchRoot = await this.readWorkbenchRoot()
    const db = openWorkbenchDatabase(workbenchRoot)
    try {
      return pipelineStore.listRunRows(db)
    } finally {
      db.close()
    }
  }

  async markPersistedRunningRunsInterrupted() {
    const config = await readAppConfig()
    if (!config.workbench_root) {
      return
    }
    const db = openWorkbenchDatabase(config.workbench_root)
    try {
      pipelineStore.markPersistedRunningPipelineStateInterrupted(db, Date.now())
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
        pipelineStore.markPipelineRunInterrupted(active.db, {
          runId,
          errorSummary: '完整任务已中断，已完成产物已保留',
          completedAt: now,
        })
        pipelineStore.markPipelineRunRunningStepsInterrupted(active.db, {
          runId,
          completedAt: now,
          updatedAt: now,
        })
        pipelineStore.markPipelineRunRunningItemsInterrupted(active.db, {
          runId,
          completedAt: now,
          updatedAt: now,
        })
        this.appendLog(runId, {
          level: 'warn',
          message: '完整任务已中断，已完成产物已保留',
        })
        this.flushRunUiState(runId, active)
      } catch {
        // 退出路径只尽力落状态，不阻断进程关闭。
      }
    }
  }

  async getRun(runId: string): Promise<PipelineRunDetail | null> {
    const workbenchRoot = await this.readWorkbenchRoot()
    const db = openWorkbenchDatabase(workbenchRoot)
    try {
      return pipelineStore.readRunDetail(db, runId)
    } finally {
      db.close()
    }
  }

  async resumeRun(runId: string): Promise<PipelineRunDetail> {
    const workbenchRoot = await this.readWorkbenchRoot()
    const db = openWorkbenchDatabase(workbenchRoot)
    let activePrintSkuLock: string | null = null
    try {
      const detail = this.requireRunDetail(db, runId, 'INVALID_INPUT')
      if (detail.run.status === 'running') {
        throw new AppErrorClass('INVALID_INPUT', '完整任务正在运行,不能续跑', false, { runId })
      }
      if (detail.run.status !== 'interrupted' && detail.run.status !== 'failed') {
        throw new AppErrorClass('INVALID_INPUT', '只有已中断或失败的完整任务可以续跑', false, {
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
      const resumeState = this.buildResumeState(detail)
      this.assertSourceManifestCanResume(parsedConfig, resumeState)
      this.assertGenerationSourceCanResume(parsedConfig, resumeState)
      await this.assertResumeDiskState(runId, parsedConfig, detail)

      const active: ActivePipelineRun = {
        db,
        resuming: true,
        cancelRequested: false,
        stopError: null,
        interrupted: false,
        cancelHandlers: new Map(),
        previewImages: [],
        resultSections: detail.result_sections ?? [],
        logs: detail.logs ?? [],
        collectionReadLock: null,
        pendingProgress: null,
        lastProgress: null,
        progressFlushHandle: null,
        resultDetailFlushHandle: null,
        progressError: null,
        progressRevision: 0,
        nextFullProgressRevision: 1,
        forceNextProgressDetails: false,
        resultSectionsDirty: false,
        lastDetailedProgressAt: 0,
        uiStateDirty: false,
        uiStateFlushHandle: null,
        uiStateError: null,
        uiStateRevision: 0,
        nextUiStatePersistRevision: 1,
      }
      this.activeRuns.set(runId, active)
      const stats = parseStats(detail.run.stats_json)
      let pipelineFailed = false

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
          this.emitRunProgress(
            db,
            runId,
            'interrupted',
            null,
            stats,
            '完整任务已中断，已完成产物已保留',
          )
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
        pipelineFailed = true
        if (active.interrupted) {
          return this.requireRunDetail(db, runId)
        }
        const cancelled = pipelineFailureWasCancellation(active, error)
        const status: PipelineRunStatus = cancelled ? 'cancelled' : 'failed'
        this.appendLog(runId, {
          level: cancelled ? 'warn' : 'error',
          message: cancelled ? PIPELINE_CANCELLED_MESSAGE : '完整任务续跑失败',
          details: { error: appErrorMessage(error) },
        })
        if (!cancelled) {
          await this.writePipelineDiagnostic({
            workbenchRoot,
            runId,
            type: 'pipeline_resume_failed',
            operation: 'resumeRun',
            error,
            data: {
              sourceMode: parsedConfig.source.mode,
              printMode: parsedConfig.printMode,
              status,
              stats,
            },
          })
        }
        const terminalError = await this.completeRunAfterFailure({
          db,
          runId,
          status,
          stats,
          error,
          workbenchRoot,
          operation: 'resumeRun',
        })
        if (!cancelled) {
          throw error
        }
        if (terminalError) {
          throw terminalError
        }
        return this.requireRunDetail(db, runId)
      } finally {
        active.collectionReadLock?.release()
        this.finalizeActiveRunState(runId, active, pipelineFailed)
      }
    } finally {
      this.releasePrintSkuLock(activePrintSkuLock, runId)
      db.close()
    }
  }

  async runPipeline(
    runId: string,
    config: PipelineRunConfig,
    preparedRun?: PreparedPipelineRun | undefined,
  ): Promise<PipelineRunDetail> {
    const prepared = preparedRun ?? (await this.prepareRun(runId, config))
    const activePrintSkuLock = this.acquirePrintSkuLock(runId, prepared.config)
    try {
      const { workbenchRoot, config: runConfig } = prepared
      const db = openWorkbenchDatabase(workbenchRoot)
      const active: ActivePipelineRun = {
        db,
        resuming: false,
        cancelRequested: false,
        stopError: null,
        interrupted: false,
        cancelHandlers: new Map(),
        previewImages: [],
        resultSections: [],
        logs: [],
        collectionReadLock: null,
        pendingProgress: null,
        lastProgress: null,
        progressFlushHandle: null,
        resultDetailFlushHandle: null,
        progressError: null,
        progressRevision: 0,
        nextFullProgressRevision: 1,
        forceNextProgressDetails: false,
        resultSectionsDirty: false,
        lastDetailedProgressAt: 0,
        uiStateDirty: false,
        uiStateFlushHandle: null,
        uiStateError: null,
        uiStateRevision: 0,
        nextUiStatePersistRevision: 1,
      }
      this.activeRuns.set(runId, active)
      const stats: PipelineRunStats = { ...DEFAULT_STATS }
      const runName = runConfig.name?.trim() || `完整任务-${timestampSlug()}`
      let pipelineFailed = false

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
          this.emitRunProgress(
            db,
            runId,
            'interrupted',
            null,
            stats,
            '完整任务已中断，已完成产物已保留',
          )
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
        pipelineFailed = true
        if (active.interrupted) {
          return this.requireRunDetail(db, runId)
        }
        const cancelled = pipelineFailureWasCancellation(active, error)
        const status: PipelineRunStatus = cancelled ? 'cancelled' : 'failed'
        this.appendLog(runId, {
          level: cancelled ? 'warn' : 'error',
          message: cancelled ? PIPELINE_CANCELLED_MESSAGE : '完整任务失败',
          details: { error: appErrorMessage(error) },
        })
        if (!cancelled) {
          await this.writePipelineDiagnostic({
            workbenchRoot,
            runId,
            type: 'pipeline_run_failed',
            operation: 'runPipeline',
            error,
            data: {
              sourceMode: runConfig.source.mode,
              printMode: runConfig.printMode,
              status,
              stats,
            },
          })
        }
        const terminalError = await this.completeRunAfterFailure({
          db,
          runId,
          status,
          stats,
          error,
          workbenchRoot,
          operation: 'runPipeline',
        })
        if (!cancelled) {
          throw error
        }
        if (terminalError) {
          throw terminalError
        }
        return this.requireRunDetail(db, runId)
      } finally {
        active.collectionReadLock?.release()
        try {
          this.finalizeActiveRunState(runId, active, pipelineFailed)
        } finally {
          db.close()
        }
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

  private acquireFireAndForgetStartKey(runId: string, config: PipelineRunConfig) {
    const lockKey = printSkuLockKey(config)
    if (!lockKey) {
      return null
    }
    const activeRunId = this.fireAndForgetStartKeys.get(lockKey)
    if (activeRunId) {
      throw new AppErrorClass(
        'HTTP_4XX',
        `印花货号 ${config.printSkuCode} 已有进行中完整任务，请等待或取消后再启动`,
        false,
        { activeRunId, printSkuCode: config.printSkuCode },
      )
    }
    this.fireAndForgetStartKeys.set(lockKey, runId)
    return lockKey
  }

  private releaseFireAndForgetStartKey(lockKey: string | null, runId: string) {
    if (lockKey && this.fireAndForgetStartKeys.get(lockKey) === runId) {
      this.fireAndForgetStartKeys.delete(lockKey)
    }
  }

  private async writePipelineDiagnostic(input: {
    workbenchRoot: string
    runId: string
    type: string
    operation: string
    error: unknown
    data?: Record<string, unknown> | undefined
  }) {
    await writeOptionalDiagnosticLogEvent({
      module: 'pipeline',
      runId: input.runId,
      workbenchRoot: input.workbenchRoot,
      meta: {
        operation: input.operation,
        runId: input.runId,
      },
      event: {
        type: input.type,
        operation: input.operation,
        data: input.data ?? {},
        error: errorForDiagnosticLog(input.error),
      },
    }).catch(() => null)
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

  private async prepareRun(runId: string, config: PipelineRunConfig): Promise<PreparedPipelineRun> {
    const parsedConfig = parsePipelineRunConfig(config)
    if (process.platform === 'darwin' && parsedConfig.photoshop.enabled !== false) {
      throw new AppErrorClass(
        'HTTP_4XX',
        '完整任务包含 PS 套版，当前 v1 仅支持在 Windows 执行',
        false,
      )
    }
    const workbenchRoot = await this.readWorkbenchRoot()
    await this.assertRunConfigPaths(workbenchRoot, parsedConfig)
    return {
      workbenchRoot,
      config: await this.normalizeRunConfig(workbenchRoot, runId, parsedConfig),
    }
  }

  private async normalizeRunConfig(
    workbenchRoot: string,
    runId: string,
    config: PipelineRunConfig,
  ): Promise<PipelineRunConfig> {
    let normalizedConfig = config
    if (
      config.source.mode === 'img2img' &&
      config.source.provider === 'grsai' &&
      config.source.referenceImages?.length
    ) {
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
      normalizedConfig = {
        ...config,
        source: {
          ...sourceWithoutUploads,
          referenceImagePaths,
        },
      }
    }

    const source = normalizedConfig.source
    if (source.mode === 'collection') {
      const paths = await scanImageFiles(source.sourceFolder)
      if (paths.length === 0) {
        throw new AppErrorClass('INVALID_INPUT', '采集目录里没有可提取的图片', false)
      }
      return {
        ...normalizedConfig,
        source: {
          ...source,
          sourceManifest: buildSourceManifest('source', source.sourceFolder, paths),
        },
      }
    }
    if (source.mode === 'existing_prints') {
      const paths = await scanImageFiles(source.printFolder)
      if (paths.length === 0) {
        throw new AppErrorClass('INVALID_INPUT', '印花目录里没有可套版图片', false)
      }
      return {
        ...normalizedConfig,
        source: {
          ...source,
          sourceManifest: buildSourceManifest('existing-print', source.printFolder, paths),
        },
      }
    }
    if (source.mode === 'img2img' && source.provider === 'comfyui-chenyu') {
      const paths = await scanImageFiles(source.sourceFolder)
      if (paths.length === 0) {
        throw new AppErrorClass('INVALID_INPUT', '图生图图片文件夹里没有可用图片', false)
      }
      return {
        ...normalizedConfig,
        source: {
          ...source,
          sourceManifest: buildSourceManifest('img2img', source.sourceFolder, paths),
        },
      }
    }
    return normalizedConfig
  }

  private async assertRunConfigPaths(workbenchRoot: string, config: PipelineRunConfig) {
    if (config.source.mode === 'collection') {
      await assertPipelinePathInsideWorkbench(workbenchRoot, config.source.sourceFolder, {
        domain: 'collection',
        label: '完整任务采集来源目录',
      })
    }
    if (config.source.mode === 'existing_prints') {
      const printFolder = await assertPipelinePathInsideWorkbench(
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
          'INVALID_INPUT',
          '已有印花来源必须选择 02-印花工作区 下的具体印花文件夹，不能选择根目录或等待套版目录',
          false,
          { kind: 'invalid_existing_print_folder', printFolder },
        )
      }
    }
    if (config.source.mode === 'img2img') {
      if (config.source.provider === 'grsai' && config.source.sourceFolder) {
        await assertPipelinePathInsideWorkbench(workbenchRoot, config.source.sourceFolder, {
          domain: 'generation',
          label: '完整任务图生图来源目录',
        })
      }
      if (config.source.provider === 'grsai') {
        for (const referencePath of config.source.referenceImagePaths ?? []) {
          await assertPipelinePathInsideWorkbench(workbenchRoot, referencePath, {
            domain: 'local-image',
            label: '完整任务图生图参考图',
          })
        }
      }
    }
    if (config.photoshop.enabled !== false && config.photoshop.outputRoot) {
      await assertPipelinePathInsideWorkbench(workbenchRoot, config.photoshop.outputRoot, {
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
    pipelineStore.insertPipelineRun(db, {
      runId,
      name,
      config,
      stats: DEFAULT_STATS,
    })
  }

  private persistResolvedAiPromptPlan(
    db: Pick<SqliteDatabase, 'prepare'>,
    runId: string,
    config: PipelineRunConfig,
    prompts: string[],
  ) {
    const source = config.source
    if ((source.mode !== 'txt2img' && source.mode !== 'img2img') || source.prompt?.mode !== 'ai') {
      return
    }
    source.prompt.prompts = [...prompts]
    pipelineStore.updatePipelineRunConfig(db, { runId, config })
  }

  private completeRun(
    db: Pick<SqliteDatabase, 'exec' | 'prepare'>,
    runId: string,
    status: PipelineRunStatus,
    stats: PipelineRunStats,
    error: string | null,
  ) {
    const active = this.activeRuns.get(runId)
    db.exec('BEGIN IMMEDIATE')
    try {
      if (status === 'failed' || status === 'cancelled') {
        const now = Date.now()
        const terminalMessage =
          error ?? (status === 'cancelled' ? '完整任务已取消' : '完整任务失败')
        pipelineStore.markPipelineRunRunningStepsTerminal(db, {
          runId,
          status,
          errorMessage: terminalMessage,
          completedAt: now,
          updatedAt: now,
        })
        pipelineStore.markPipelineRunRunningItemsTerminal(db, {
          runId,
          status: status === 'failed' ? 'failed' : 'interrupted',
          errorMessage: terminalMessage,
          completedAt: now,
          updatedAt: now,
        })
      }
      pipelineStore.updatePipelineRunCompleted(db, { runId, status, stats, error })
      db.exec('COMMIT')
    } catch (transactionError) {
      try {
        db.exec('ROLLBACK')
      } catch {
        // Preserve the transaction error; it identifies the failed terminal write.
      }
      throw transactionError
    }
    if (active) {
      this.flushRunUiState(runId, active)
    }
    this.emitRunProgress(db, runId, status, null, stats, error ?? '完整任务完成')
  }

  private async completeRunAfterFailure(input: {
    db: Pick<SqliteDatabase, 'exec' | 'prepare'>
    runId: string
    status: Extract<PipelineRunStatus, 'cancelled' | 'failed'>
    stats: PipelineRunStats
    error: unknown
    workbenchRoot: string
    operation: 'resumeRun' | 'runPipeline'
  }) {
    try {
      this.completeRun(
        input.db,
        input.runId,
        input.status,
        input.stats,
        appErrorMessage(input.error),
      )
      return null
    } catch (terminalError) {
      await this.writePipelineDiagnostic({
        workbenchRoot: input.workbenchRoot,
        runId: input.runId,
        type: 'pipeline_terminalization_failed',
        operation: input.operation,
        error: terminalError,
        data: { primaryError: appErrorMessage(input.error), status: input.status },
      })
      return terminalError
    }
  }

  private markRunResuming(
    db: Pick<SqliteDatabase, 'prepare'>,
    runId: string,
    stats: PipelineRunStats,
  ) {
    pipelineStore.markPipelineRunResuming(db, { runId, stats })
  }

  private buildResumeState(detail: PipelineRunDetail): PipelineResumeState {
    const itemsByStep = new Map<PipelineStepKey, PipelineItemRecord[]>()
    const itemByStepAndKey = new Map<string, PipelineItemRecord>()
    const completedItemsByStep = new Map<PipelineStepKey, PipelineItemRecord[]>()
    const completedItemByStepAndKey = new Map<string, PipelineItemRecord>()
    const filteredItemByStepAndKey = new Map<string, PipelineItemRecord>()
    for (const item of detail.items ?? []) {
      const allItems = itemsByStep.get(item.step_key) ?? []
      allItems.push(item)
      itemsByStep.set(item.step_key, allItems)
      itemByStepAndKey.set(resumeItemMapKey(item.step_key, item.item_key), item)
      if (item.status === 'filtered') {
        filteredItemByStepAndKey.set(resumeItemMapKey(item.step_key, item.item_key), item)
        continue
      }
      if (item.status !== 'completed' && item.status !== 'skipped') {
        continue
      }
      const items = completedItemsByStep.get(item.step_key) ?? []
      items.push(item)
      completedItemsByStep.set(item.step_key, items)
      completedItemByStepAndKey.set(resumeItemMapKey(item.step_key, item.item_key), item)
    }
    return {
      itemsByStep,
      itemByStepAndKey,
      completedItemsByStep,
      completedItemByStepAndKey,
      filteredItemByStepAndKey,
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

  private assertGenerationSourceCanResume(
    config: PipelineRunConfig,
    resumeState: PipelineResumeState,
  ) {
    const source = config.source
    if (source.mode !== 'txt2img' && source.mode !== 'img2img') {
      return
    }
    if (resumeState.completedSourceStep) {
      return
    }
    if (source.mode === 'img2img' && source.provider === 'comfyui-chenyu') {
      if (source.prompt?.mode === 'ai') {
        const promptBySourceKey = source.prompt.resolvedPromptsBySourceKey ?? {}
        const sourceManifest = source.sourceManifest ?? []
        const completedSourceItems = resumeState.completedItemsByStep.get('source') ?? []
        const missingPromptSnapshot = completedSourceItems.some((item) => {
          const sourceItem = sourceManifest.find((manifestItem) =>
            item.item_key.startsWith(`${manifestItem.itemKey}-`),
          )
          return !sourceItem || !promptBySourceKey[sourceItem.itemKey]?.trim()
        })
        if (missingPromptSnapshot) {
          throw new AppErrorClass(
            'WORKSPACE_IO_FAILED',
            'AI 提示词未保存，无法安全续跑生成阶段，请使用已生成印花从“已有印花来源”新建完整任务',
            false,
          )
        }
      }
      return
    }
    if (source.prompt?.mode === 'ai' && !source.prompt.prompts?.some((prompt) => prompt.trim())) {
      throw new AppErrorClass(
        'WORKSPACE_IO_FAILED',
        'AI 提示词未保存，无法安全续跑生成阶段，请使用已生成印花从“已有印花来源”新建完整任务',
        false,
      )
    }
    const stableKeyPattern = new RegExp(`^${source.mode}-\\d+-\\d+$`)
    const completedSourceItems = resumeState.completedItemsByStep.get('source') ?? []
    if (completedSourceItems.some((item) => !stableKeyPattern.test(item.item_key))) {
      throw new AppErrorClass(
        'WORKSPACE_IO_FAILED',
        '该完整任务缺少可精确续跑的生成槽位记录，无法安全续跑，请使用已生成印花从“已有印花来源”新建完整任务',
        false,
      )
    }
  }

  private assertSourceManifestCanResume(
    config: PipelineRunConfig,
    resumeState: PipelineResumeState,
  ) {
    const source = config.source
    if (
      source.mode !== 'collection' &&
      source.mode !== 'existing_prints' &&
      !(source.mode === 'img2img' && source.provider === 'comfyui-chenyu')
    ) {
      return
    }
    if (!source.sourceManifest?.length) {
      if (resumeState.completedSourceStep) {
        return
      }
      throw new AppErrorClass(
        'WORKSPACE_IO_FAILED',
        '该完整任务缺少冻结来源清单，无法安全续跑，请从原来源重新启动新的完整任务',
        false,
      )
    }

    const sourceManifest = source.sourceManifest
    const manifestKeys = new Set(sourceManifest.map((item) => item.itemKey))
    const completedSourceItems = resumeState.completedItemsByStep.get('source') ?? []
    const hasUnknownKey = completedSourceItems.some((item) => {
      if (source.mode !== 'img2img') {
        return !manifestKeys.has(item.item_key)
      }
      return !sourceManifest.some((manifestItem) =>
        item.item_key.startsWith(`${manifestItem.itemKey}-`),
      )
    })
    if (hasUnknownKey) {
      throw new AppErrorClass(
        'WORKSPACE_IO_FAILED',
        '该完整任务的来源身份记录不完整，无法安全续跑，请从原来源重新启动新的完整任务',
        false,
      )
    }
  }

  private async assertResumeDiskState(
    runId: string,
    config: PipelineRunConfig,
    detail: PipelineRunDetail,
  ) {
    const reusableOutputSteps = new Set<PipelineStepKey>([
      'source',
      'extract',
      'matting',
      'detection',
    ])
    for (const item of detail.items ?? []) {
      if (item.status !== 'completed') {
        continue
      }
      if (item.step_key !== 'photoshop' && !reusableOutputSteps.has(item.step_key)) {
        continue
      }
      const recoveryPath =
        item.step_key === 'photoshop' ? item.output_path : (item.output_path ?? item.source_path)
      if (!recoveryPath || !(await pathExists(recoveryPath))) {
        throw new AppErrorClass('WORKSPACE_IO_FAILED', '源目录已被清理,无法续跑', false, {
          runId,
          stepKey: item.step_key,
          itemKey: item.item_key,
          recoveryPath,
        })
      }
    }

    if (config.photoshop.enabled === false) {
      return
    }
    const templateSuffixes = config.photoshop.templates.map(
      (templatePath) => `:${safePathSegment(templatePath)}`,
    )
    const photoshopItemsByInput = new Map<string, PipelineItemRecord[]>()
    for (const item of detail.items ?? []) {
      if (item.step_key !== 'photoshop') {
        continue
      }
      const suffix = templateSuffixes.find((value) => item.item_key.endsWith(value))
      if (!suffix) {
        continue
      }
      const inputKey = item.item_key.slice(0, -suffix.length)
      const items = photoshopItemsByInput.get(inputKey) ?? []
      items.push(item)
      photoshopItemsByInput.set(inputKey, items)
    }
    for (const [itemKey, items] of photoshopItemsByInput) {
      const completedTemplates = items.filter((item) => item.status === 'completed').length
      if (completedTemplates >= config.photoshop.templates.length) {
        continue
      }
      const waitingPath = items.map((item) => item.source_path).find(Boolean)
      if (waitingPath && !(await pathExists(waitingPath))) {
        throw new AppErrorClass('WORKSPACE_IO_FAILED', '源目录已被清理,无法续跑', false, {
          runId,
          stepKey: 'photoshop',
          itemKey,
          waitingPath,
        })
      }
    }
  }

  private requireRunDetail(
    db: Pick<SqliteDatabase, 'prepare'>,
    runId: string,
    missingCode: 'INVALID_INPUT' | 'WORKSPACE_IO_FAILED' = 'WORKSPACE_IO_FAILED',
  ): PipelineRunDetail {
    const detail = pipelineStore.readRunDetail(db, runId)
    if (!detail) {
      throw new AppErrorClass(missingCode, '完整任务记录缺失', false, { runId })
    }
    return detail
  }

  private persistRunUiState(runId: string, active: ActivePipelineRun) {
    active.uiStateDirty = true
    active.uiStateRevision += 1
    const shouldPersist = active.uiStateRevision >= active.nextUiStatePersistRevision
    if (shouldPersist) {
      while (active.uiStateRevision >= active.nextUiStatePersistRevision) {
        active.nextUiStatePersistRevision += UI_STATE_PERSIST_INTERVAL
      }
    }
    if (active.uiStateFlushHandle !== null) {
      return
    }
    if (!shouldPersist) {
      return
    }
    active.uiStateFlushHandle = setImmediate(() => {
      active.uiStateFlushHandle = null
      try {
        this.flushRunUiState(runId, active)
      } catch (error) {
        active.uiStateError = error
      }
    })
  }

  private flushRunUiState(runId: string, active: ActivePipelineRun) {
    if (active.uiStateFlushHandle !== null) {
      clearImmediate(active.uiStateFlushHandle)
      active.uiStateFlushHandle = null
    }
    if (active.uiStateError) {
      throw active.uiStateError
    }
    if (!active.uiStateDirty) {
      return
    }
    active.uiStateDirty = false
    try {
      pipelineStore.updatePipelineRunUiState(active.db, {
        runId,
        resultSections: active.resultSections,
        logs: active.logs,
      })
    } catch (error) {
      active.uiStateError = error
      throw error
    }
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
    if (!active) {
      this.emitProgressSnapshot(db, runId, {
        status,
        currentStep,
        stats: { ...stats },
        message,
        includeDetails: true,
      })
      return
    }
    active.progressRevision += 1
    const reachedFullSnapshot = active.progressRevision >= active.nextFullProgressRevision
    if (reachedFullSnapshot) {
      while (active.progressRevision >= active.nextFullProgressRevision) {
        active.nextFullProgressRevision += PROGRESS_DETAIL_INTERVAL
      }
    }
    const forceDetails = active.forceNextProgressDetails
    const resultDetailsDue =
      active.resultSectionsDirty &&
      Date.now() - active.lastDetailedProgressAt >= RESULT_DETAIL_MAX_LATENCY_MS
    const progress: PendingPipelineProgress = {
      status,
      currentStep,
      stats: { ...stats },
      message,
      includeDetails:
        status !== 'running' ||
        reachedFullSnapshot ||
        forceDetails ||
        resultDetailsDue ||
        active.pendingProgress?.includeDetails === true,
    }
    active.pendingProgress = progress
    active.lastProgress = progress
    active.forceNextProgressDetails = false
    if (status !== 'running' || forceDetails || resultDetailsDue) {
      this.flushRunProgress(runId, active)
      return
    }
    if (!progress.includeDetails) {
      this.scheduleResultDetailFlush(runId, active)
    }
    if (active.progressFlushHandle !== null) {
      return
    }
    active.progressFlushHandle = setImmediate(() => {
      active.progressFlushHandle = null
      try {
        this.flushRunProgress(runId, active)
      } catch (error) {
        active.progressError = error
      }
    })
  }

  private scheduleResultDetailFlush(runId: string, active: ActivePipelineRun) {
    if (
      !active.resultSectionsDirty ||
      active.resultDetailFlushHandle !== null ||
      active.lastProgress?.status !== 'running'
    ) {
      return
    }
    const delay = Math.max(
      0,
      RESULT_DETAIL_MAX_LATENCY_MS - (Date.now() - active.lastDetailedProgressAt),
    )
    active.resultDetailFlushHandle = setTimeout(() => {
      active.resultDetailFlushHandle = null
      if (this.activeRuns.get(runId) !== active || !active.resultSectionsDirty) {
        return
      }
      const latest = active.lastProgress
      if (!latest || latest.status !== 'running') {
        return
      }
      active.pendingProgress = { ...latest, includeDetails: true }
      try {
        this.flushRunProgress(runId, active)
      } catch (error) {
        active.progressError = error
      }
    }, delay)
  }

  private clearResultDetailFlush(active: ActivePipelineRun) {
    if (active.resultDetailFlushHandle === null) {
      return
    }
    clearTimeout(active.resultDetailFlushHandle)
    active.resultDetailFlushHandle = null
  }

  private emitProgressSnapshot(
    db: Pick<SqliteDatabase, 'prepare'>,
    runId: string,
    progress: PendingPipelineProgress,
    active?: ActivePipelineRun | undefined,
  ) {
    const persistedDetail =
      progress.includeDetails && !active ? pipelineStore.readRunDetail(db, runId) : null
    emitPipelineProgress({
      run_id: runId,
      status: progress.status,
      current_step: progress.currentStep,
      message: progress.message,
      stats: progress.stats,
      steps: pipelineStore.readStepRows(db, runId),
      ...(progress.includeDetails
        ? {
            items: pipelineStore.readItemRows(db, runId),
            ...(active ? { preview_images: active.previewImages } : {}),
            result_sections: active?.resultSections ?? persistedDetail?.result_sections ?? [],
            logs: active?.logs ?? persistedDetail?.logs ?? [],
          }
        : {}),
    })
  }

  private flushRunProgress(runId: string, active: ActivePipelineRun) {
    if (active.progressFlushHandle !== null) {
      clearImmediate(active.progressFlushHandle)
      active.progressFlushHandle = null
    }
    if (active.progressError) {
      throw active.progressError
    }
    const progress = active.pendingProgress
    if (!progress) {
      return
    }
    active.pendingProgress = null
    try {
      this.emitProgressSnapshot(active.db, runId, progress, active)
      if (progress.includeDetails) {
        active.lastDetailedProgressAt = Date.now()
        active.resultSectionsDirty = false
        active.forceNextProgressDetails = false
        this.clearResultDetailFlush(active)
      }
    } catch (error) {
      active.progressError = error
      throw error
    }
  }

  private flushPendingRunState(runId: string, active: ActivePipelineRun) {
    let firstError: unknown = null
    try {
      this.flushRunUiState(runId, active)
    } catch (error) {
      firstError = error
    }
    try {
      this.flushRunProgress(runId, active)
    } catch (error) {
      firstError ??= error
    }
    if (firstError) {
      throw firstError
    }
  }

  private finalizeActiveRunState(
    runId: string,
    active: ActivePipelineRun,
    pipelineFailed: boolean,
  ) {
    try {
      this.flushPendingRunState(runId, active)
    } catch (error) {
      if (!pipelineFailed) {
        throw error
      }
    } finally {
      this.clearResultDetailFlush(active)
      this.activeRuns.delete(runId)
    }
  }

  private updateResultSection(runId: string, section: PipelineResultSection) {
    const active = this.activeRuns.get(runId)
    if (!active) {
      return
    }
    if (!active.resultSections.some((item) => item.key === section.key)) {
      active.forceNextProgressDetails = true
    }
    active.resultSectionsDirty = true
    const existingSection = active.resultSections.find((item) => item.key === section.key)
    const nextSection =
      active.resuming && existingSection
        ? mergeResumeResultSection(existingSection, section)
        : section
    active.resultSections = [
      ...active.resultSections.filter((item) => item.key !== section.key),
      nextSection,
    ]
    active.resultSections = this.sortResultSections(active.resultSections)
    this.persistRunUiState(runId, active)
    this.scheduleResultDetailFlush(runId, active)
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
      throw new AppErrorClass('HTTP_4XX', PIPELINE_CANCELLED_MESSAGE, false, {
        kind: PIPELINE_CANCELLED_ERROR_KIND,
      })
    }
    if (active.stopError !== null) {
      throw active.stopError
    }
  }

  private stopAcceptingMoreWork(active: ActivePipelineRun) {
    return active.cancelRequested || active.stopError !== null
  }

  private setCancelHandler(
    active: ActivePipelineRun,
    key: string,
    cancel: PipelineCancelHandler | null,
  ) {
    if (cancel) {
      active.cancelHandlers.set(key, cancel)
      return
    }
    active.cancelHandlers.delete(key)
  }

  private async withGenerationCancel<T>(
    active: ActivePipelineRun,
    taskId: string,
    run: () => Promise<T>,
  ): Promise<T> {
    const cancelKey = `generation:${taskId}`
    const cancel = () => {
      requestGenerationCancel(taskId)
    }
    this.setCancelHandler(active, cancelKey, cancel)
    try {
      return await run()
    } finally {
      if (active.cancelHandlers.get(cancelKey) === cancel) {
        this.setCancelHandler(active, cancelKey, null)
      }
    }
  }

  private upsertPipelineItem(
    db: Pick<SqliteDatabase, 'prepare'>,
    input: pipelineStore.UpsertPipelineItemInput,
  ) {
    pipelineStore.upsertPipelineItem(db, input)
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
    pipelineStore.upsertPipelineStepRunning(db, {
      runId: input.runId,
      stepKey: input.stepKey,
      module: input.module,
      label: input.label,
      inputCount: input.inputCount,
      outputCount: 0,
    })
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
        pipelineStore.updatePipelineStepCompleted(db, {
          runId: input.runId,
          stepKey: input.stepKey,
          status: 'interrupted',
          outputCount: result.outputCount,
          outputJson: result.outputJson,
        })
        return result.output
      }
      pipelineStore.updatePipelineStepCompleted(db, {
        runId: input.runId,
        stepKey: input.stepKey,
        status: 'completed',
        outputCount: result.outputCount,
        outputJson: result.outputJson,
      })
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
      pipelineStore.updatePipelineStepFailed(db, {
        runId: input.runId,
        stepKey: input.stepKey,
        status: active.cancelRequested ? 'cancelled' : 'failed',
        errorJson: { message: appErrorMessage(error) },
      })
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
    pipelineStore.upsertPipelineStepSkipped(db, {
      runId,
      stepKey,
      module,
      label,
      inputCount,
      outputCount: inputCount,
    })
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
            this.setCancelHandler(active, 'stage:detection', cancel)
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
            this.setCancelHandler(active, 'stage:photoshop', cancel)
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
            this.setCancelHandler(active, 'stage:title', cancel)
          },
          assertNotCancelled: () => this.assertCanAcceptMoreWork(active),
        }),
      })
    }

    return stages
  }

  private applyStreamingPrintStages(
    db: Pick<SqliteDatabase, 'prepare'>,
    input: AsyncIterable<PipelinePrintStreamItem>,
    stages: PipelinePrintStageRegistration[],
    createContext: (stepKey: PipelineStepKey) => PipelineStageRuntimeContext,
    onStageError: (error: unknown) => void,
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
              db,
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
            onStageError(error)
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
    db: Pick<SqliteDatabase, 'prepare'>,
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
      const pendingInput = new AsyncItemQueue<PipelinePrintStreamItem>()
      const inputIterator = input[Symbol.asyncIterator]()
      const stageIterator = stage(pendingInput, context)[Symbol.asyncIterator]()
      let inputDone = false
      let stageDone = false
      let inputCount = 0
      let outputCount = 0
      let caughtError: unknown = null
      let hasCaughtError = false
      const routedItemKeys = new Set<string>()
      let inputNext = inputIterator.next().then((result) => ({ kind: 'input' as const, result }))
      let stageNext = stageIterator.next().then((result) => ({ kind: 'stage' as const, result }))

      try {
        while (!inputDone || !stageDone) {
          const next = await Promise.race([
            ...(inputDone ? [] : [inputNext]),
            ...(stageDone ? [] : [stageNext]),
          ])
          if (next.kind === 'stage') {
            if (next.result.done) {
              stageDone = true
              continue
            }
            outputCount += 1
            stageNext = stageIterator.next().then((result) => ({ kind: 'stage' as const, result }))
            yield next.result.value
            continue
          }

          if (next.result.done) {
            inputDone = true
            pendingInput.end()
            continue
          }
          inputNext = inputIterator.next().then((result) => ({ kind: 'input' as const, result }))
          const item = next.result.value
          if (routedItemKeys.has(item.itemKey)) {
            continue
          }
          routedItemKeys.add(item.itemKey)
          inputCount += 1
          const resumedItems = service.resumeOutputItemsForStage(
            stepKey,
            item,
            context.config,
            activeResumeState,
          )
          if (stepKey === 'photoshop' && resumedItems?.length) {
            for (const resumedItem of resumedItems) {
              outputCount += 1
              yield resumedItem
            }
            if (resumedItems.length === context.config.photoshop.templates.length) {
              continue
            }
            pendingInput.push(item)
            continue
          }
          if (resumedItems) {
            for (const resumedItem of resumedItems) {
              outputCount += 1
              yield resumedItem
            }
            continue
          }
          pendingInput.push(item)
        }
        pipelineStore.updatePipelineStepCounts(db, {
          runId: context.runId,
          stepKey,
          inputCount,
          outputCount,
        })
      } catch (error) {
        caughtError = error
        hasCaughtError = true
        throw error
      } finally {
        if (!stageDone) {
          if (hasCaughtError) {
            pendingInput.fail(caughtError)
          } else {
            pendingInput.end()
          }
          await stageNext.catch(() => undefined)
          await stageIterator.return?.().catch(() => undefined)
        }
        if (!inputDone) {
          void inputNext.catch(() => undefined)
          void inputIterator.return?.().catch(() => undefined)
        }
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
    if (resumeState.filteredItemByStepAndKey.has(resumeItemMapKey(stepKey, item.itemKey))) {
      return []
    }
    if (stepKey === 'photoshop') {
      const completed = config.photoshop.templates.flatMap((templatePath) => {
        const stageItemKey = `${item.itemKey}:${safePathSegment(templatePath)}`
        const record = resumeState.completedItemByStepAndKey.get(
          resumeItemMapKey('photoshop', stageItemKey),
        )
        const streamItem = record ? streamItemFromPipelineItem(record) : null
        return streamItem ? [streamItem] : []
      })
      return completed.length > 0 ? completed : null
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

  private reconcileResumeStats(
    db: Pick<SqliteDatabase, 'prepare'>,
    runId: string,
    config: PipelineRunConfig,
    stats: PipelineRunStats,
    resultSections: readonly PipelineResultSection[],
  ) {
    const items = pipelineStore.readItemRows(db, runId)
    const completedCount = (stepKey: PipelineStepKey) =>
      items.filter((item) => item.step_key === stepKey && item.status === 'completed').length

    stats.sourceImages = config.source.mode === 'collection' ? completedCount('source') : 0
    const finalPrintStep: PipelineStepKey = shouldRunDetectionStep(config)
      ? 'detection'
      : shouldRunMattingStep(config)
        ? 'matting'
        : config.source.mode === 'collection'
          ? 'extract'
          : 'source'
    stats.prints = completedCount(finalPrintStep)

    if (shouldRunDetectionStep(config)) {
      const passedItems =
        resultSections.find((section) => section.key === 'detection_passed')?.items ?? []
      stats.detectionReview = passedItems.filter((item) => item.risk_level === 'review').length
      stats.detectionPass = passedItems.length - stats.detectionReview
      stats.detectionBlock = items.filter(
        (item) => item.step_key === 'detection' && item.status === 'filtered',
      ).length
    }
    if (config.photoshop.enabled !== false) {
      stats.photoshopGroups = completedCount('photoshop')
    }
    if (config.photoshop.enabled !== false && config.title.enabled !== false) {
      stats.titleSucceeded = completedCount('title')
      stats.titleFailed = items.filter(
        (item) => item.step_key === 'title' && item.status === 'failed',
      ).length
    }
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

    pipelineStore.upsertPipelineStepRunning(db, {
      runId,
      stepKey: 'source',
      module: sourceModule,
      label: sourceLabel,
      inputCount: 0,
      outputCount: 0,
    })
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
      db,
      sourceQueue,
      stageRegistrations,
      (stepKey) => ({
        runId,
        taskName: runName,
        config,
        stepKey,
        isCancelled: () => active.cancelRequested,
        ...(resumeState
          ? {
              resume: {
                getItem: (resumeStepKey: PipelineStepKey, itemKey: string) =>
                  resumeState.itemByStepAndKey.get(resumeItemMapKey(resumeStepKey, itemKey)) ??
                  null,
                getItems: (resumeStepKey: PipelineStepKey) =>
                  resumeState.itemsByStep.get(resumeStepKey) ?? [],
              },
            }
          : {}),
      }),
      (error) => this.stopRunForStageError(active, error),
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
    void consumeOutputPromise.catch(() => undefined)

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
          pipelineStore.updatePipelineStepCounts(db, {
            runId,
            stepKey: 'source',
            inputCount: sourceTotalRef.value,
            outputCount: sourceItems.length,
          })
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
      if (resumeState) {
        this.reconcileResumeStats(db, runId, config, stats, active.resultSections)
      }
      pipelineStore.updatePipelineStepCompletedWithInput(db, {
        runId,
        stepKey: 'source',
        inputCount: sourceTotalRef.value,
        outputCount: sourceItems.length,
        outputJson: {
          total: result.total,
          itemCount: result.itemCount,
          succeeded: result.succeeded,
          failed: result.failed,
        },
      })
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
      await consumeOutputPromise.catch(() => undefined)
      await stagePipeline.completed
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
        throw new AppErrorClass('INVALID_INPUT', '采集目录里没有可提取的图片', false)
      }
      return { extractSources: imagesFromPaths(paths), prints: [] }
    }

    if (source.mode === 'existing_prints') {
      const paths = await scanImageFiles(source.printFolder)
      if (paths.length === 0) {
        throw new AppErrorClass('INVALID_INPUT', '印花目录里没有可套版图片', false)
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
              instanceLockOwner: runId,
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
        throw new AppErrorClass('INVALID_INPUT', '图生图图片文件夹里没有可用图片', false)
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
            instanceLockOwner: runId,
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
            ...(onImageComplete ? { onImageComplete, strictImageComplete: true } : {}),
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
          instanceLockOwner: runId,
          emitProgress: emitGenerationProgressAsPipeline(
            runId,
            'extract',
            emitMessage,
            emitPreviewImages,
          ),
          ...(onImageComplete ? { onImageComplete, strictImageComplete: true } : {}),
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
        taskId: `${runId}-${source.mode}-source`,
        total,
        succeeded: completedSourceCount,
        failed: Math.max(0, total - completedSourceCount),
        images: [],
        failures: [],
        itemCount: completedSourceCount,
      }
    }
    if (source.mode === 'collection') {
      const sourceManifest = source.sourceManifest
      if (!sourceManifest?.length) {
        throw new AppErrorClass('WORKSPACE_IO_FAILED', '完整任务缺少冻结采集来源清单', false)
      }
      callbacks.onPlannedCount?.(sourceManifest.length)
      for (const sourceItem of sourceManifest) {
        this.assertCanAcceptMoreWork(active)
        if (resumeState?.completedSourceKeys.has(sourceItem.itemKey)) {
          continue
        }
        onItem({
          itemKey: sourceItem.itemKey,
          path: sourceItem.path,
          sourceArtifactIds: [],
        })
      }
      return {
        taskId: `${runId}-collection-source`,
        total: sourceManifest.length,
        succeeded: sourceManifest.length,
        failed: 0,
        images: [],
        failures: [],
        itemCount: sourceManifest.length,
      }
    }
    if (source.mode === 'existing_prints') {
      const sourceManifest = source.sourceManifest
      if (!sourceManifest?.length) {
        throw new AppErrorClass('WORKSPACE_IO_FAILED', '完整任务缺少冻结已有印花来源清单', false)
      }
      callbacks.onPlannedCount?.(sourceManifest.length)
      for (const sourceItem of sourceManifest) {
        this.assertCanAcceptMoreWork(active)
        if (resumeState?.completedSourceKeys.has(sourceItem.itemKey)) {
          continue
        }
        onItem({
          itemKey: sourceItem.itemKey,
          path: sourceItem.path,
          sourceArtifactIds: [],
        })
      }
      return {
        taskId: `${runId}-existing-prints-source`,
        total: sourceManifest.length,
        succeeded: sourceManifest.length,
        failed: 0,
        images: sourceManifest.map((item) => ({
          prompt: '',
          url: '',
          localPath: item.path,
        })),
        failures: [],
        itemCount: sourceManifest.length,
      }
    }
    if (source.mode === 'txt2img') {
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
      this.persistResolvedAiPromptPlan(db, runId, config, prompts)
      callbacks.onPlannedCount?.(prompts.length)
      if (source.provider === 'comfyui-chenyu') {
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
          const itemKey = `txt2img-${index + 1}-1`
          if (resumeState?.completedSourceKeys.has(itemKey)) {
            continue
          }
          this.assertCanAcceptMoreWork(active)
          const taskId = `${runId}-txt2img-${index + 1}`
          const result = await this.withGenerationCancel(active, taskId, async () =>
            runComfyuiTxt2imgBatch(
              {
                prompts: [prompt],
                workflowId: source.comfyui.workflowId,
                taskId,
                outputTaskName: taskName,
                filenameStartIndex: index,
                inputIndexes: [index],
                ...visibleFilenameFields,
                ...comfyuiOptionalFields(source.comfyui),
              },
              {
                instanceLockOwner: runId,
                strictImageComplete: true,
                onImageComplete: async (payload) => {
                  itemCount += 1
                  onItem({
                    itemKey: generatedSourceItemKey('txt2img', payload),
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
          aggregate.succeeded += result.succeeded
          aggregate.failed += result.failed
          aggregate.images.push(...result.images)
          aggregate.failures.push(...result.failures)
          const fatalError = fatalGenerationResultError(result, 'source')
          if (fatalError) {
            this.recordStreamingSourceFailures(db, runId, result, itemCount)
            throw fatalError
          }
        }
        this.recordStreamingSourceFailures(db, runId, aggregate, itemCount)
        return { ...aggregate, itemCount }
      }
      if (!source.grsai) {
        throw new AppErrorClass('HTTP_4XX', '文生图缺少 Grsai 配置', false)
      }
      const grsaiConfig = source.grsai
      let itemCount = 0
      const pendingPrompts = prompts.flatMap((prompt, index) =>
        resumeState?.completedSourceKeys.has(`txt2img-${index + 1}-1`)
          ? []
          : [{ prompt, inputIndex: index }],
      )
      if (pendingPrompts.length === 0) {
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
            prompts: pendingPrompts.map((item) => item.prompt),
            inputIndexes: pendingPrompts.map((item) => item.inputIndex),
            model: grsaiConfig.model,
            aspectRatio: grsaiConfig.aspectRatio,
            concurrency: grsaiConfig.concurrency ?? 3,
            taskId: `${runId}-txt2img`,
            outputTaskName: taskName,
            ...visibleFilenameFields,
            ...grsaiOptionalFields(grsaiConfig),
          },
          {
            strictImageComplete: true,
            onImageComplete: async (payload) => {
              itemCount += 1
              onItem({
                itemKey: generatedSourceItemKey('txt2img', payload),
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
      const fatalError = fatalGenerationResultError(result, 'source')
      if (fatalError) {
        throw fatalError
      }
      return {
        ...result,
        total: prompts.length,
        succeeded: completedSourceCount + result.succeeded,
        itemCount: completedSourceCount + itemCount,
      }
    }
    if (source.mode === 'img2img' && source.provider === 'comfyui-chenyu') {
      const sourceManifest = source.sourceManifest
      if (!sourceManifest?.length) {
        throw new AppErrorClass('WORKSPACE_IO_FAILED', '完整任务缺少冻结图生图来源清单', false)
      }
      const aiPromptConfig = source.prompt?.mode === 'ai' ? source.prompt : null
      const batchSize = source.comfyui.batchSize ?? 1
      callbacks.onPlannedCount?.(sourceManifest.length * batchSize)
      const aggregate: GenerationRunResult = {
        taskId: `${runId}-img2img`,
        total: sourceManifest.length * batchSize,
        succeeded: completedSourceCount,
        failed: 0,
        images: [],
        failures: [],
      }
      let itemCount = completedSourceCount
      for (const [index, sourceItem] of sourceManifest.entries()) {
        const pendingOutputIndexes = Array.from(
          { length: batchSize },
          (_, outputIndex) => outputIndex,
        ).filter(
          (outputIndex) =>
            !resumeState?.completedSourceKeys.has(
              generatedSourceOutputItemKey(sourceItem.itemKey, outputIndex),
            ),
        )
        const outputBatches =
          resumeState && pendingOutputIndexes.length < batchSize
            ? pendingOutputIndexes.map((outputIndex) => [outputIndex])
            : [pendingOutputIndexes]
        for (const outputIndexes of outputBatches) {
          if (outputIndexes.length === 0) {
            continue
          }
          this.assertCanAcceptMoreWork(active)
          const firstOutputIndex = outputIndexes[0] ?? 0
          const taskId = resumeState
            ? `${runId}-img2img-${index + 1}-${firstOutputIndex + 1}`
            : `${runId}-img2img-${index + 1}`
          const resolvedPrompt = aiPromptConfig?.resolvedPromptsBySourceKey?.[sourceItem.itemKey]
          const result = await this.withGenerationCancel(active, taskId, async () =>
            runComfyuiImg2imgBatch(
              {
                sourceImagePaths: [sourceItem.path],
                workflowId: source.comfyui.workflowId,
                taskId,
                outputTaskName: taskName,
                filenameStartIndex: index * batchSize + firstOutputIndex,
                inputIndexes: [index],
                outputIndexes,
                ...visibleFilenameFields,
                ...comfyuiImg2imgOptionalFields(source.comfyui),
                batchSize: outputIndexes.length,
                ...comfyuiImg2imgPromptFields(source.prompt, config.printMode),
                ...(resolvedPrompt !== undefined ? { resolvedPrompt } : {}),
              },
              {
                instanceLockOwner: runId,
                strictImageComplete: true,
                ...(aiPromptConfig
                  ? {
                      onPromptResolved: async (payload) => {
                        if (
                          payload.inputIndex !== index ||
                          resolve(payload.sourcePath) !== resolve(sourceItem.path)
                        ) {
                          throw new AppErrorClass(
                            'HTTP_5XX',
                            '图生图提示词来源与冻结来源清单不一致，已停止任务',
                            false,
                            {
                              expectedInputIndex: index,
                              actualInputIndex: payload.inputIndex,
                              expectedSourcePath: sourceItem.path,
                              actualSourcePath: payload.sourcePath,
                            },
                          )
                        }
                        const resolvedPrompt = payload.prompt.trim()
                        if (!resolvedPrompt) {
                          throw new AppErrorClass(
                            'HTTP_5XX',
                            '图生图提示词为空，无法保存后继续生图',
                            false,
                            { sourceItemKey: sourceItem.itemKey },
                          )
                        }
                        aiPromptConfig.resolvedPromptsBySourceKey = {
                          ...aiPromptConfig.resolvedPromptsBySourceKey,
                          [sourceItem.itemKey]: resolvedPrompt,
                        }
                        pipelineStore.updatePipelineRunConfig(db, { runId, config })
                      },
                    }
                  : {}),
                onImageComplete: async (payload) => {
                  itemCount += 1
                  onItem({
                    itemKey: generatedSourceOutputItemKey(
                      sourceItem.itemKey,
                      payload.outputIndex ?? 0,
                    ),
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
          aggregate.succeeded += result.succeeded
          aggregate.failed += result.failed
          aggregate.images.push(...result.images)
          aggregate.failures.push(...result.failures)
          const fatalError = fatalGenerationResultError(result, 'source')
          if (fatalError) {
            this.recordStreamingSourceFailures(db, runId, result, itemCount)
            throw fatalError
          }
        }
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
      this.persistResolvedAiPromptPlan(db, runId, config, prompts)
      callbacks.onPlannedCount?.(prompts.length)
      if (!source.grsai) {
        throw new AppErrorClass('HTTP_4XX', '图生图缺少 Grsai 配置', false)
      }
      const grsaiConfig = source.grsai
      const completedSourceCount = resumeState?.completedItemsByStep.get('source')?.length ?? 0
      const pendingPrompts = prompts.flatMap((prompt, index) =>
        resumeState?.completedSourceKeys.has(`img2img-${index + 1}-1`)
          ? []
          : [{ prompt, inputIndex: index }],
      )
      if (pendingPrompts.length === 0) {
        return {
          taskId: `${runId}-img2img`,
          total: prompts.length,
          succeeded: completedSourceCount,
          failed: 0,
          images: [],
          failures: [],
          itemCount: completedSourceCount,
        }
      }
      let itemCount = 0
      const result = await this.withGenerationCancel(active, `${runId}-img2img`, async () =>
        runTxt2imgBatch(
          {
            capability: 'img2img',
            prompts: pendingPrompts.map((item) => item.prompt),
            inputIndexes: pendingPrompts.map((item) => item.inputIndex),
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
            strictImageComplete: true,
            onImageComplete: async (payload) => {
              itemCount += 1
              onItem({
                itemKey: generatedSourceItemKey('img2img', payload),
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
      this.recordStreamingSourceFailures(db, runId, result, completedSourceCount + itemCount)
      const fatalError = fatalGenerationResultError(result, 'source')
      if (fatalError) {
        throw fatalError
      }
      return {
        ...result,
        total: prompts.length,
        succeeded: completedSourceCount + result.succeeded,
        itemCount: completedSourceCount + itemCount,
      }
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
        pipelineStore.upsertPipelineStepRunning(db, {
          runId: context.runId,
          stepKey: 'extract',
          module: 'generation',
          label: '提取',
          inputCount: 0,
          outputCount: 0,
        })

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
          pipelineStore.updatePipelineStepInputCount(db, {
            runId: context.runId,
            stepKey: 'extract',
            inputCount: queued,
          })
          service.emitRunProgress(db, context.runId, 'running', 'extract', stats, '提取流处理中')
        }

        if (sourceItems.length === 0) {
          pipelineStore.updatePipelineStepCompletedWithInput(db, {
            runId: context.runId,
            stepKey: 'extract',
            inputCount: 0,
            outputCount: 0,
            outputJson: { total: 0, succeeded: 0, failed: 0 },
          })
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

        const extractResultPromise = service
          .runExtractConfig(
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
              service.emitRunProgress(
                db,
                context.runId,
                'running',
                'extract',
                stats,
                '提取流处理中',
              )
            },
            async (payload) => {
              const sourceArtifactId = payload.sourceArtifactIds[0]
              const sourceItem =
                (payload.sourcePath ? sourceItemsByPath.get(payload.sourcePath) : undefined) ??
                (sourceArtifactId ? sourceItemByArtifactId.get(sourceArtifactId) : undefined)
              const itemKey = sourceItem?.itemKey ?? payload.printId ?? `extract-${completed + 1}`
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
                sourcePath: sourceItem?.path ?? payload.sourcePath,
                outputPath: payload.path,
                artifactId: payload.artifactId,
                printId: payload.printId,
                sourceArtifactIds: payload.sourceArtifactIds,
                completed: true,
              })
              refreshExtractSection()
              pipelineStore.updatePipelineStepOutputCount(db, {
                runId: context.runId,
                stepKey: 'extract',
                outputCount: completed,
              })
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
          .then(
            (result) => {
              stageOutput.end()
              return result
            },
            (error: unknown) => {
              stageOutput.fail(error)
              throw error
            },
          )

        let extractResult: GenerationRunResult
        try {
          for await (const item of stageOutput) {
            yield item
          }
          extractResult = await extractResultPromise
        } catch (error) {
          await extractResultPromise.catch(() => undefined)
          throw error
        }

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
        pipelineStore.updatePipelineStepCompletedWithInput(db, {
          runId: context.runId,
          stepKey: 'extract',
          inputCount: queued,
          outputCount: completed,
          outputJson: {
            total: extractResult.total,
            succeeded: extractResult.succeeded,
            failed: extractResult.failed,
          },
        })
        service.emitRunProgress(db, context.runId, 'running', 'extract', stats, '提取完成')
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
        pipelineStore.upsertPipelineStepRunning(db, {
          runId: context.runId,
          stepKey: 'matting',
          module: 'generation',
          label: '抠图',
          inputCount: 0,
          outputCount: 0,
        })
        for await (const item of items) {
          service.assertCanAcceptMoreWork(active)
          queued += 1
          pipelineStore.updatePipelineStepInputCount(db, {
            runId: context.runId,
            stepKey: 'matting',
            inputCount: queued,
          })
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

          let generationResultReturned = false
          let fatalResultObserved = false
          try {
            let result: GenerationRunResult
            if (context.config.matting.mode === 'mixed') {
              const workflowId = context.config.matting.workflowId
              if (!workflowId) {
                throw new AppErrorClass('HTTP_4XX', '混合抠图需要选择 ComfyUI 工作流', false)
              }
              const taskId = `${context.runId}-matting-${item.itemKey}`
              result = await service.withGenerationCancel(active, taskId, () =>
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
                  { instanceLockOwner: context.runId },
                ),
              )
            } else {
              const workflowId = context.config.matting.workflowId
              if (!workflowId) {
                throw new AppErrorClass('HTTP_4XX', '抠图需要选择 ComfyUI 工作流', false)
              }
              const taskId = `${context.runId}-matting-${item.itemKey}`
              result = await service.withGenerationCancel(active, taskId, () =>
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
                  { instanceLockOwner: context.runId },
                ),
              )
            }
            generationResultReturned = true
            const fatalError = fatalGenerationResultError(result, 'matting')
            if (fatalError) {
              fatalResultObserved = true
              throw fatalError
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
            pipelineStore.updatePipelineStepOutputCount(db, {
              runId: context.runId,
              stepKey: 'matting',
              outputCount: completed,
            })
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
            if (!generationResultReturned || fatalResultObserved) {
              throw error
            }
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
        const outputJson = {
          total: sourceTotalRef.value,
          succeeded: completed,
          failed,
          sourceFailed: sourceFailedRef.value,
        }
        if (queued > 0 && completed === 0 && failed > 0) {
          service.appendLog(context.runId, {
            level: 'warn',
            step_key: 'matting',
            message: '抠图全部失败，本次没有可继续的印花',
            details: outputJson,
          })
        }
        pipelineStore.updatePipelineStepCompletedWithInput(db, {
          runId: context.runId,
          stepKey: 'matting',
          inputCount: queued,
          outputCount: completed,
          outputJson,
        })
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
                instanceLockOwner: runId,
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
                instanceLockOwner: runId,
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
        const cancelKey = `legacy:detection:${taskId}`
        const cancel = () => {
          detectionService.cancelTask(taskId)
        }
        this.setCancelHandler(active, cancelKey, cancel)
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
        let result: Awaited<ReturnType<typeof detectionService.runDetectionBatch>>
        try {
          result = await detectionService.runDetectionBatch({
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
        } finally {
          if (active.cancelHandlers.get(cancelKey) === cancel) {
            this.setCancelHandler(active, cancelKey, null)
          }
        }
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
        const cancelKey = `legacy:photoshop:${taskId}`
        const cancel = () => writeFile(cancelFilePath, String(Date.now()), 'utf8')
        this.setCancelHandler(active, cancelKey, cancel)
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
              smartObjectReplaceMode: config.photoshop.smartObjectReplaceMode ?? 'replaceContents',
              smartObjectInnerFitMode: config.photoshop.smartObjectInnerFitMode ?? 'fill',
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
          if (active.cancelHandlers.get(cancelKey) === cancel) {
            this.setCancelHandler(active, cancelKey, null)
          }
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
          const cancelKey = `legacy:title:${taskId}`
          const cancel = () => {
            titleService.cancelTask(taskId)
          }
          this.setCancelHandler(active, cancelKey, cancel)
          let result: TitleBatchResult
          try {
            result = await titleService.runTitleBatch({
              ...config.title,
              batchDir,
              taskId,
            })
          } finally {
            if (active.cancelHandlers.get(cancelKey) === cancel) {
              this.setCancelHandler(active, cancelKey, null)
            }
          }
          results.push(result)
          stats.titleSucceeded += result.succeeded
          stats.titleFailed += result.failed
        }
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
    return pipelineService.startRun(input)
  })
  ipcMain.handle('pipeline:resume', (_event, input: unknown) => {
    return pipelineService.startResume(parsePipelineRunIdInput(input).run_id)
  })
  ipcMain.handle('pipeline:cancel', (_event, input: unknown) => ({
    ok: pipelineService.cancelRun(parsePipelineRunIdInput(input).run_id),
  }))
  ipcMain.handle('pipeline:list-runs', () => pipelineService.listRuns())
  ipcMain.handle('pipeline:get-run', (_event, input: unknown) =>
    pipelineService.getRun(parsePipelineRunIdInput(input).run_id),
  )
}
