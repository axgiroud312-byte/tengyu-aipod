import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { basename, extname, isAbsolute, join, relative } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import {
  AppErrorClass,
  type GenerationCapability,
  type Skill,
  WORKBENCH_DIRECTORIES,
} from '@tengyu-aipod/shared'
import { dialog, ipcMain } from 'electron'
import { readAppConfig } from '../onboarding'
import { ChenyuCloudClient, type ChenyuInstanceInfo, chenyuStatusName } from './chenyu-cloud-client'
import { ComfyHttpClient } from './comfy-http-client'
import { ComfyuiChenyuAdapter } from './comfyui-chenyu-adapter'
import {
  ComfyuiInstanceManager,
  type ComfyuiInstanceRecord,
  type ComfyuiInstanceSummary,
  comfyuiUrlCandidates,
} from './comfyui-instance-manager'
import {
  type ComfyuiWorkflowCategory,
  type ComfyuiWorkflowSummary,
  comfyuiWorkflowCacheManager,
} from './comfyui-workflow-cache'
import {
  type DiagnosticLogWriter,
  createOptionalDiagnosticLogWriter,
  errorForDiagnosticLog,
} from './diagnostic-log-service'
import { GenerationConcurrencyController } from './generation-concurrency'
import { normalizeGenerationLocalConfig } from './generation-local-config'
import {
  getChenyuWorkflowInfo,
  listChenyuWorkflowMarket,
  runChenyuWorkflow,
} from './generation/capabilities/chenyu-workflow'
import {
  runComfyuiTxt2img,
  runComfyuiTxt2imgBatch,
  runTxt2img,
  runTxt2imgBatch,
} from './generation/capabilities/txt2img'
import {
  GENERATION_CAPABILITY_FOLDERS,
  type GenerationDatabase,
  type GenerationServiceDependencies,
  appErrorMessage,
  createGenerationDebugLogger,
  createGenerationDiagnostics,
  createGenerationProgressEmitter,
  emitImageComplete,
  finishGenerationResultWithDiagnostics,
  generationTaskId,
  generationTaskOutputFolder,
  openWorkbenchDatabase,
  promptPreview,
  readWorkbenchRoot,
  safeBaseName,
  submitGenerationTask,
  timestampSlug,
} from './generation/runtime'
import {
  isGenerationCancelled,
  markGenerationResultCancelled,
  requestGenerationTaskCancel,
} from './generation/task-registry'
import type {
  ChenyuWorkflowMarketListInput,
  ChenyuWorkflowRunInput,
  ChooseGenerationImageFolderResult,
  ComfyuiExtractMattingRunInput,
  ComfyuiExtractRunInput,
  ComfyuiImg2imgRunInput,
  ComfyuiInstanceRunInput,
  ComfyuiMattingRunInput,
  ComfyuiTxt2imgRunInput,
  ExtractRunInput,
  ExtractSourcesResult,
  GenerationDebugLogDetails,
  GenerationDebugLogEntry,
  GenerationDebugLogLevel,
  GenerationImageCompletePayload,
  GenerationImageSource,
  GenerationProgress,
  GenerationPromptInput,
  GenerationRunImage,
  GenerationRunResult,
  GenerationTaskEvent,
  Img2imgPrintSource,
  Img2imgReferencePayload,
  Img2imgSourcesResult,
  MixedMattingRunInput,
  Txt2imgPromptDraft,
  Txt2imgRunInput,
} from './generation/types'
import {
  GRSAI_SUPPORTED_MODELS,
  type GenerateRequest,
  type GenerateResponse,
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
import type { SqliteDatabase } from './sqlite'
import { tempFileManager } from './temp-file-manager'
import {
  assertTargetDoesNotExist,
  nextVisibleImageName,
  visibleImageNamingEnabled,
} from './user-visible-filename'
export {
  getActiveGenerationTaskCount,
  requestAllGenerationCancels,
} from './generation/task-registry'
export { getChenyuWorkflowInfo, listChenyuWorkflowMarket, runChenyuWorkflow }
export { runComfyuiTxt2img, runComfyuiTxt2imgBatch, runTxt2img, runTxt2imgBatch }
export type {
  ChenyuWorkflowMarketListInput,
  ChenyuWorkflowRunInput,
  ChooseGenerationImageFolderResult,
  ComfyuiExtractMattingRunInput,
  ComfyuiExtractRunInput,
  ComfyuiImg2imgRunInput,
  ComfyuiInstanceRunInput,
  ComfyuiMattingRunInput,
  ComfyuiTxt2imgRunInput,
  ExtractRunInput,
  ExtractSourcesResult,
  GenerationDebugLogDetails,
  GenerationDebugLogEntry,
  GenerationDebugLogLevel,
  GenerationImageCompletePayload,
  GenerationImageSource,
  GenerationProgress,
  GenerationPromptInput,
  GenerationRunImage,
  GenerationRunResult,
  GenerationTaskEvent,
  Img2imgPrintSource,
  Img2imgReferencePayload,
  Img2imgSourcesResult,
  MixedMattingRunInput,
  Txt2imgPromptDraft,
  Txt2imgRunInput,
} from './generation/types'
import {
  chenyuWorkflowInfoInputSchema,
  chenyuWorkflowMarketListInputSchema,
  chenyuWorkflowRunInputSchema,
  comfyuiExtractMattingRunInputSchema,
  comfyuiExtractRunInputSchema,
  comfyuiImg2imgRunInputSchema,
  comfyuiMattingRunInputSchema,
  comfyuiTxt2imgRunInputSchema,
  extractRunInputSchema,
  generationCancelInputSchema,
  generationPromptInputSchema,
  manualPromptsTextInputSchema,
  mixedMattingRunInputSchema,
  parseGenerationIpcInput,
  resolveImg2imgReferencesInputSchema,
  scanGenerationImageFolderInputSchema,
  txt2imgRunInputSchema,
} from './generation/schemas'

function generationImageIdentity(
  image: GenerateResponse['images'][number],
  fallback: { artifactId?: string | null; printId?: string | null } = {},
) {
  const artifactId = image.artifact_id ?? fallback.artifactId ?? undefined
  const printId = image.print_id ?? fallback.printId ?? undefined
  return {
    ...(artifactId ? { artifactId } : {}),
    ...(printId ? { printId } : {}),
  }
}

type Img2imgReference = Img2imgReferencePayload

function promptGeneratorDependencies(dependencies: GenerationServiceDependencies) {
  return {
    ...(dependencies.skillCache ? { skillCache: dependencies.skillCache } : {}),
    ...(dependencies.getSecret ? { getSecret: dependencies.getSecret } : {}),
    ...(dependencies.readConfig ? { readConfig: dependencies.readConfig } : {}),
  }
}

async function assertLocalComfyuiWorkflowExists(
  dependencies: GenerationServiceDependencies,
  input: {
    workflowId: string
    capability: ComfyuiWorkflowCategory
    workflowVersion?: string | undefined
  },
) {
  await (dependencies.workflowCache ?? comfyuiWorkflowCacheManager).get(
    input.workflowId.trim(),
    input.capability,
    input.workflowVersion,
  )
}

const DEFAULT_GENERATION_MODEL: GrsaiModel = 'gpt-image-2'
const IMAGE_EXTENSIONS = /\.(?:jpe?g|png|webp)$/i
export function requestGenerationCancel(taskId: string) {
  if (!requestGenerationTaskCancel(taskId)) {
    return false
  }
  createGenerationDebugLogger({}, { taskId })('任务已请求取消', 'warn', {
    operation: 'cancel',
  })
  return true
}

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

function requestedComfyuiSourceCount(input: {
  sourceArtifactIds?: string[] | undefined
  sourceImagePaths?: string[] | undefined
}) {
  const artifactCount = new Set(
    (input.sourceArtifactIds ?? []).map((artifactId) => artifactId.trim()).filter(Boolean),
  ).size
  const imagePathCount = new Set(
    (input.sourceImagePaths ?? []).map((imagePath) => imagePath.trim()).filter(Boolean),
  ).size
  return artifactCount + imagePathCount
}

function comfyuiSizePx(input: { width?: number | undefined; height?: number | undefined }) {
  return {
    width: clampInt(input.width ?? 1024, 256, 4096, 1024),
    height: clampInt(input.height ?? 1024, 256, 4096, 1024),
  }
}

function comfyuiImg2imgBatchSize(input: { batchSize?: number | undefined }) {
  return clampInt(input.batchSize ?? 1, 1, 8, 1)
}

function comfyuiOptionalSizePx(input: {
  width?: number | undefined
  height?: number | undefined
}) {
  if (input.width === undefined && input.height === undefined) {
    return undefined
  }
  return {
    width: clampInt(input.width ?? 1024, 256, 4096, 1024),
    height: clampInt(input.height ?? 1024, 256, 4096, 1024),
  }
}

function promptSkillCategory(
  capability: Extract<GenerationCapability, 'txt2img' | 'img2img' | 'extract'>,
  printMode: 'local' | 'full' = 'local',
) {
  if (capability === 'txt2img') {
    return printMode === 'full' ? 'txt2img-full-print' : 'txt2img-local-print'
  }
  return printMode === 'full' ? 'img2img-full-reference' : 'img2img-local-reference'
}

function comfyuiImg2imgPromptMode(input: ComfyuiImg2imgRunInput) {
  if (input.promptMode) {
    return input.promptMode
  }
  return input.prompt?.trim() ? 'manual' : 'workflow'
}

class ComfyuiInstanceLockManager {
  private readonly locks = new Map<string, string>()

  async run<T>(input: ComfyuiInstanceRunInput, taskId: string, operation: () => Promise<T>) {
    const lockKey = comfyuiInstanceLockKey(input)
    const runId = randomUUID()
    const holder = this.locks.get(lockKey)
    if (holder) {
      throw new AppErrorClass('HTTP_4XX', '该云机正在执行其他任务，请换一台或稍后再试', false, {
        provider: 'comfyui-chenyu',
        instance: lockKey,
        taskId,
      })
    }

    this.locks.set(lockKey, runId)
    try {
      return await operation()
    } finally {
      if (this.locks.get(lockKey) === runId) {
        this.locks.delete(lockKey)
      }
    }
  }
}

export const comfyuiInstanceLocks = new ComfyuiInstanceLockManager()

function comfyuiInstanceLockKey(input: ComfyuiInstanceRunInput) {
  return input.instanceUuid?.trim() || 'default'
}

async function selectedComfyuiInstance(
  input: ComfyuiInstanceRunInput,
  apiKey: string,
  dependencies: GenerationServiceDependencies,
  db: Pick<SqliteDatabase, 'prepare'>,
): Promise<ComfyuiInstanceSummary | undefined> {
  const instanceUuid = input.instanceUuid?.trim()
  if (!instanceUuid) {
    return undefined
  }

  const info =
    (await dependencies.getChenyuInstanceInfo?.({ apiKey, instanceUuid })) ??
    (await new ChenyuCloudClient(apiKey).getInstanceInfo(instanceUuid))
  const status = chenyuStatusName(info.status)
  if (status !== 'running') {
    throw new AppErrorClass('CHENYU_INSTANCE_DOWN', '所选云机未运行，请到设置页开机后重试', false, {
      provider: 'comfyui-chenyu',
      instanceUuid,
      status,
    })
  }

  const savedComfyuiUrl = savedComfyuiUrlForInstance(db, instanceUuid)
  const comfyuiUrl =
    comfyuiUrlCandidates(info.server_map, info.server_url)[0]?.url ?? savedComfyuiUrl
  if (!comfyuiUrl) {
    throw new AppErrorClass(
      'HTTP_4XX',
      '所选云机没有可用 ComfyUI 地址，请刷新实例列表或到设置页确认端口映射',
      false,
      {
        provider: 'comfyui-chenyu',
        instanceUuid,
      },
    )
  }

  const now = Date.now()
  return {
    provider: 'chenyu',
    instanceUuid: info.instance_uuid,
    comfyuiUrl,
    podUuid: null,
    gpuUuid: null,
    gpuName: null,
    status: 'running',
    podPriceHour: 0,
    gpuPriceHour: 0,
    autoShutdownAt: null,
    createdAt: now,
    lastUsedAt: now,
    runningMinutes: 0,
    estimatedCost: 0,
  }
}

async function createComfyuiAdapterForRun(
  input: ComfyuiInstanceRunInput,
  apiKey: string,
  workbenchRoot: string,
  db: Pick<SqliteDatabase, 'prepare'>,
  dependencies: GenerationServiceDependencies,
  diagnostics?: DiagnosticLogWriter | null,
) {
  const instance = await selectedComfyuiInstance(input, apiKey, dependencies, db)
  const currentInstance = instance ? null : readCurrentComfyuiInstanceRecord(db)
  return (
    dependencies.createComfyuiAdapter?.({
      apiKey,
      workbenchRoot,
      ...(instance ? { instance } : {}),
      ...(diagnostics ? { diagnostics } : {}),
    }) ??
    new ComfyuiChenyuAdapter({
      ...(instance ? { selectedInstance: instance } : {}),
      ...(currentInstance
        ? {
            selectedInstance: {
              ...currentInstance,
              runningMinutes: 0,
              estimatedCost: 0,
            } satisfies ComfyuiInstanceSummary,
          }
        : {}),
      instanceManager: new ComfyuiInstanceManager({
        chenyu: new ChenyuCloudClient(apiKey),
      }),
      comfyHttp: new ComfyHttpClient(instance?.comfyuiUrl ?? currentComfyuiUrl(workbenchRoot, db)),
      createComfyHttp: (baseUrl) => new ComfyHttpClient(baseUrl),
      workflowCache: dependencies.workflowCache ?? comfyuiWorkflowCacheManager,
      workbenchRoot,
      openDatabase: dependencies.openDatabase ?? openWorkbenchDatabase,
      ...(diagnostics ? { diagnostics } : {}),
    })
  )
}

function observeGenerationError(
  controller: Pick<GenerationConcurrencyController, 'onResponse'>,
  error: unknown,
) {
  if (error instanceof AppErrorClass && error.code === 'HTTP_429') {
    controller.onResponse(429)
  }
}

async function resolveMixedMattingMaskSkill(
  input: MixedMattingRunInput,
  skillCache: Pick<typeof skillCacheManager, 'getSkill' | 'listSkills'>,
) {
  const skillId = input.maskSkillId?.trim()
  if (skillId) {
    return skillCache.getSkill(skillId, input.maskSkillVersion)
  }

  const summaries = await skillCache.listSkills({
    module: 'generation',
    category: 'matting-mask',
  })
  const first = summaries[0]
  if (!first) {
    throw new AppErrorClass('HTTP_4XX', '没有可用的黑白图 Skill', false, {
      provider: 'grsai',
      category: 'matting-mask',
    })
  }

  return skillCache.getSkill(first.id, first.version)
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
  const pathHash = createHash('sha1').update(imagePath).digest('hex').slice(0, 8)
  return {
    artifactId: `art_${shortHash}_${pathHash}`,
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

function newPrintId() {
  return `pri_${randomUUID().replace(/-/g, '').slice(0, 12)}`
}

function extractMattingTaskId(inputTaskId: string | undefined) {
  const custom = inputTaskId?.trim()
  return safeBaseName(custom || `提取后抠图-${timestampSlug()}`)
}

function generationOutputTaskName(input: { outputTaskName?: string | undefined }, taskId: string) {
  return input.outputTaskName?.trim() || taskId
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

async function generationTargetPath(
  folder: string,
  fallbackBaseName: string,
  ext: string,
  naming: { filenamePrefix?: string | undefined; filenameSeparator?: string | undefined },
  outputIndex: number,
) {
  const visibleName = nextVisibleImageName({
    prefix: naming.filenamePrefix,
    separator: naming.filenameSeparator,
    index: outputIndex,
    ext,
  })
  if (!visibleName) {
    return uniqueTargetPath(folder, fallbackBaseName, ext)
  }
  const targetPath = join(folder, visibleName)
  await assertTargetDoesNotExist(targetPath)
  return targetPath
}

function visibleFilenameOptions(
  input: { filenamePrefix?: string | undefined; filenameSeparator?: string | undefined },
  index: number,
) {
  return {
    filenameIndex: index,
    ...(input.filenamePrefix ? { filenamePrefix: input.filenamePrefix } : {}),
    ...(input.filenameSeparator ? { filenameSeparator: input.filenameSeparator } : {}),
  }
}

function comfyuiRunOptions(
  workbenchRoot: string,
  capability: GenerationCapability,
  taskId: string,
  input: {
    outputTaskName?: string | undefined
    filenamePrefix?: string | undefined
    filenameSeparator?: string | undefined
  },
  index: number,
) {
  return {
    ...visibleFilenameOptions(input, index),
    outputFolderOverride: generationTaskOutputFolder(
      workbenchRoot,
      capability,
      generationOutputTaskName(input, taskId),
    ),
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
      const relativePath = relative(root, entryPath).replace(/\\/g, '/')
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

export async function chooseGenerationImageFolder(): Promise<ChooseGenerationImageFolderResult> {
  const result = await dialog.showOpenDialog({
    properties: ['openDirectory'],
    title: '选择图片文件夹',
  })
  if (result.canceled || !result.filePaths[0]) {
    return { ok: false, error: { code: 'CANCELLED', message: '已取消选择' } }
  }
  return { ok: true, data: { path: result.filePaths[0] } }
}

export async function scanGenerationImageFolder(input: {
  folder: string
}): Promise<GenerationImageSource[]> {
  const folder = input.folder.trim()
  if (!folder || !isAbsolute(folder)) {
    throw new AppErrorClass('HTTP_4XX', '请选择有效的图片文件夹', false, { folder })
  }
  const info = await stat(folder).catch(() => null)
  if (!info?.isDirectory()) {
    throw new AppErrorClass('HTTP_4XX', '选择的路径不是文件夹', false, { folder })
  }
  return scanImageFolderRecursive(folder)
}

function assertInsideFolder(path: string, folder: string) {
  if (!isAbsolute(path)) {
    throw new AppErrorClass('HTTP_4XX', '源图路径必须是绝对路径', false)
  }
  const rel = relative(folder, path)
  if (rel.startsWith('..') || isAbsolute(rel)) {
    throw new AppErrorClass('HTTP_4XX', '提取只能选择采集工作区下的源图', false, {
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
    throw new AppErrorClass('HTTP_4XX', '图生图不能直接选择采集原图，请先提取成印花', false, {
      path,
    })
  }
}

function rowString(row: Record<string, unknown>, key: string) {
  const value = row[key]
  return typeof value === 'string' ? value : ''
}

function readImg2imgArtifactRows(db: Pick<SqliteDatabase, 'prepare'>) {
  return db
    .prepare(`
      SELECT id, print_id, step, file_path
      FROM artifacts
      WHERE step IN ('txt2img', 'img2img', 'extract', 'matting', 'manual-import')
      ORDER BY created_at DESC
    `)
    .all() as Array<Record<string, unknown>>
}

function registerPrintSourceArtifact(
  db: Pick<SqliteDatabase, 'exec' | 'prepare'>,
  input: {
    identity: Awaited<ReturnType<typeof imageIdentity>>
    imagePath: string
    step: GenerationCapability
    taskId: string
    createdAt: number
  },
) {
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
  db: Pick<SqliteDatabase, 'exec' | 'prepare'>,
  folders: Array<{
    path: string
    step: GenerationCapability
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
  db: Pick<SqliteDatabase, 'prepare'>,
  workbenchRoot: string,
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
  if (!['txt2img', 'img2img', 'extract', 'matting', 'manual-import'].includes(step)) {
    throw new AppErrorClass('HTTP_4XX', '图生图只能选择已生成或导入的印花', false, {
      artifactId,
      step,
    })
  }
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
  db: Pick<SqliteDatabase, 'exec' | 'prepare'>,
  input: {
    identity: Awaited<ReturnType<typeof imageIdentity>>
    imagePath: string
    taskId: string
    createdAt: number
  },
) {
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

async function registerManualPrintSourceArtifacts(
  db: Pick<SqliteDatabase, 'exec' | 'prepare'>,
  input: {
    imagePaths?: string[] | undefined
    taskId: string
  },
) {
  const imagePaths = Array.from(
    new Set((input.imagePaths ?? []).map((imagePath) => imagePath.trim()).filter(Boolean)),
  )
  const artifactIds: string[] = []
  for (const imagePath of imagePaths) {
    if (!isAbsolute(imagePath) || !IMAGE_EXTENSIONS.test(imagePath)) {
      throw new AppErrorClass('HTTP_4XX', '请选择有效的图片文件', false, { imagePath })
    }
    const identity = await imageIdentity(imagePath)
    registerSourceArtifact(db, {
      identity,
      imagePath,
      taskId: input.taskId,
      createdAt: Date.now(),
    })
    artifactIds.push(identity.artifactId)
  }
  return artifactIds
}

async function comfyuiSourceArtifactIds(
  db: Pick<SqliteDatabase, 'exec' | 'prepare'>,
  input: {
    sourceArtifactIds?: string[] | undefined
    sourceImagePaths?: string[] | undefined
    taskId: string
  },
) {
  const existingArtifactIds = (input.sourceArtifactIds ?? [])
    .map((artifactId) => artifactId.trim())
    .filter(Boolean)
  const importedArtifactIds = await registerManualPrintSourceArtifacts(db, {
    imagePaths: input.sourceImagePaths,
    taskId: input.taskId,
  })
  return [...Array.from(new Set(existingArtifactIds)), ...importedArtifactIds]
}

async function registerExtractArtifact(
  db: Pick<SqliteDatabase, 'exec' | 'prepare'>,
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

async function registerGeneratedArtifact(
  db: Pick<SqliteDatabase, 'exec' | 'prepare'>,
  input: {
    taskId: string
    printId: string
    targetPath: string
    capability: Extract<GenerationCapability, 'txt2img' | 'img2img'>
    prompt: string
    model: string
    params: Record<string, unknown>
    sourceArtifactIds?: string[] | undefined
    createdAt: number
  },
) {
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
      source_artifact_ids,
      file_path,
      file_size,
      file_hash,
      prompt_snapshot,
      params_snapshot,
      created_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    artifactId,
    input.taskId,
    input.printId,
    input.capability,
    'grsai',
    input.model,
    JSON.stringify(input.sourceArtifactIds ?? []),
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

function generatedImageExtension(image: { url: string; local_path?: string }) {
  const localExt = image.local_path ? extname(image.local_path).toLowerCase() : ''
  if (localExt && IMAGE_EXTENSIONS.test(localExt)) {
    return localExt
  }

  try {
    const urlExt = extname(new URL(image.url).pathname).toLowerCase()
    if (urlExt && IMAGE_EXTENSIONS.test(urlExt)) {
      return urlExt
    }
  } catch {}

  return '.png'
}

function promptGenerationErrorDetails(error: unknown): GenerationDebugLogDetails {
  if (!(error instanceof AppErrorClass) || !error.details) {
    return {}
  }
  const details = error.details
  return {
    rawResponsePreview:
      typeof details.rawResponsePreview === 'string' ? details.rawResponsePreview : undefined,
    responseModel: typeof details.responseModel === 'string' ? details.responseModel : undefined,
    finishReason:
      typeof details.finishReason === 'string' || details.finishReason === null
        ? details.finishReason
        : undefined,
    expected: typeof details.expected === 'number' ? details.expected : undefined,
    actual: typeof details.actual === 'number' ? details.actual : undefined,
  }
}

function localPathFromGeneratedImage(image: { local_path?: string; url: string }) {
  if (image.local_path?.trim()) {
    return image.local_path
  }
  if (image.url.startsWith('file://')) {
    return fileURLToPath(image.url)
  }
  throw new AppErrorClass('HTTP_5XX', '生成结果缺少本地路径', true)
}

function workflowLogDetails(input: {
  workflowId: string
  workflowName?: string | undefined
  workflowVersion?: string | undefined
}) {
  return {
    workflowId: input.workflowId,
    ...(input.workflowName?.trim() ? { workflowName: input.workflowName.trim() } : {}),
    ...(input.workflowVersion ? { workflowVersion: input.workflowVersion } : {}),
  }
}

function emitComfyuiRequestLog(
  debug: ReturnType<typeof createGenerationDebugLogger>,
  input: {
    workflowId: string
    workflowName?: string | undefined
    workflowVersion?: string | undefined
    prompt: string
    sourceImage?: string | undefined
    sourceIndex?: number | undefined
    total?: number | undefined
    width?: number | undefined
    height?: number | undefined
    batchSize?: number | undefined
    promptMode?: string | undefined
  },
) {
  debug('发送 ComfyUI 请求', 'debug', {
    operation: 'request',
    provider: 'comfyui-chenyu',
    ...workflowLogDetails(input),
    prompt: promptPreview(input.prompt, 240),
    sourceImage: input.sourceImage,
    sourceIndex: input.sourceIndex,
    total: input.total,
    width: input.width,
    height: input.height,
    batchSize: input.batchSize,
    promptMode: input.promptMode,
  })
}

async function resolveComfyuiImg2imgPromptForSource(
  input: ComfyuiImg2imgRunInput,
  source: Img2imgReference,
  context: {
    sourceIndex: number
    total: number
    diagnostics: DiagnosticLogWriter | null
    dependencies: GenerationServiceDependencies
    debug: ReturnType<typeof createGenerationDebugLogger>
  },
) {
  const promptMode = comfyuiImg2imgPromptMode(input)
  if (promptMode === 'workflow') {
    return ''
  }
  if (promptMode === 'manual') {
    const prompt = input.prompt?.trim() ?? ''
    if (!prompt) {
      throw new AppErrorClass('HTTP_4XX', '请填写图生图提示词', false, {
        provider: 'comfyui-chenyu',
        promptMode,
      })
    }
    return prompt
  }

  const promptCategory = promptSkillCategory('img2img', input.printMode)
  const selectedSkillId = input.promptSkillId?.trim()
  const selectedSkillVersion = input.promptSkillVersion?.trim()
  context.debug('开始为源图生成提示词', 'info', {
    operation: 'prompt',
    provider: 'aliyun-bailian',
    promptMode,
    sourceIndex: context.sourceIndex,
    total: context.total,
    model: input.promptModel ?? null,
    skillId: selectedSkillId || undefined,
    skillVersion: selectedSkillVersion || undefined,
    skillCategory: selectedSkillId ? undefined : promptCategory,
    printMode: input.printMode ?? 'local',
    requirement: input.requirement ? promptPreview(input.requirement, 240) : undefined,
  })
  try {
    const prompts = await promptGeneratorService.generatePrompts(
      {
        ...(selectedSkillId
          ? {
              skillId: selectedSkillId,
              ...(selectedSkillVersion ? { skillVersion: selectedSkillVersion } : {}),
            }
          : { category: promptCategory }),
        variables: {
          printMode: input.printMode === 'full' ? '满印' : '局部',
          requirement: input.requirement ?? '',
          count: 1,
          modeInstruction: input.modeInstruction ?? '',
        },
        count: 1,
        refImages: [source.reference],
        userMessage:
          input.modeInstruction ?? '根据这张源图生成 1 条适合 ComfyUI 图生图的英文印花提示词。',
        responseFormat: 'json_object',
        ...(context.diagnostics ? { diagnostics: context.diagnostics } : {}),
        ...(input.promptModel ? { model: input.promptModel } : {}),
        onRawResponse: async (response) => {
          context.debug('百炼原始返回', 'debug', {
            operation: 'prompt',
            provider: 'aliyun-bailian',
            promptMode,
            sourceIndex: context.sourceIndex,
            expected: response.expected,
            rawResponsePreview: promptPreview(response.text, 800),
            responseModel: response.model,
            finishReason: response.finishReason,
          })
        },
      },
      {
        ...promptGeneratorDependencies(context.dependencies),
      },
    )
    const prompt = prompts[0]?.trim()
    if (!prompt) {
      throw new AppErrorClass('PROMPT_PARSE_FAILED', '百炼未返回可用提示词', true, {
        provider: 'aliyun-bailian',
        expected: 1,
        actual: prompts.length,
      })
    }
    context.debug('源图提示词生成完成', 'info', {
      operation: 'prompt',
      provider: 'aliyun-bailian',
      promptMode,
      sourceIndex: context.sourceIndex,
      prompt: promptPreview(prompt, 300),
    })
    await context.diagnostics
      ?.append({
        type: 'prompt_resolved',
        provider: 'aliyun-bailian',
        operation: 'comfyui_img2img_prompt',
        itemKey: source.artifactId,
        data: {
          sourceIndex: context.sourceIndex,
          sourceArtifactId: source.artifactId,
          sourcePath: source.imagePath,
          promptMode,
          prompt: promptPreview(prompt, 300),
          model: input.promptModel ?? null,
          skillId: selectedSkillId || null,
          skillVersion: selectedSkillVersion || null,
          skillCategory: selectedSkillId ? null : promptCategory,
        },
      })
      .catch(() => null)
    return prompt
  } catch (error) {
    const wrapped = new AppErrorClass(
      'COMFYUI_IMG2IMG_PROMPT_FAILED',
      `AI 写提示词失败：${appErrorMessage(error)}`,
      true,
      {
        provider: 'aliyun-bailian',
        sourceIndex: context.sourceIndex,
        sourceArtifactId: source.artifactId,
      },
      error,
    )
    await context.diagnostics
      ?.append({
        type: 'error',
        provider: 'aliyun-bailian',
        operation: 'comfyui_img2img_prompt',
        itemKey: source.artifactId,
        error: errorForDiagnosticLog(wrapped),
      })
      .catch(() => null)
    context.debug('源图提示词生成失败', 'error', {
      operation: 'prompt',
      provider: 'aliyun-bailian',
      promptMode,
      sourceIndex: context.sourceIndex,
      error: wrapped.message,
      ...promptGenerationErrorDetails(error),
    })
    throw wrapped
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
      path: join(
        workbenchRoot,
        WORKBENCH_DIRECTORIES.generation,
        GENERATION_CAPABILITY_FOLDERS.txt2img,
      ),
      step: 'txt2img' as const,
    },
    {
      path: join(
        workbenchRoot,
        WORKBENCH_DIRECTORIES.generation,
        GENERATION_CAPABILITY_FOLDERS.img2img,
      ),
      step: 'img2img' as const,
    },
    {
      path: join(
        workbenchRoot,
        WORKBENCH_DIRECTORIES.generation,
        GENERATION_CAPABILITY_FOLDERS.extract,
      ),
      step: 'extract' as const,
    },
    {
      path: join(
        workbenchRoot,
        WORKBENCH_DIRECTORIES.generation,
        GENERATION_CAPABILITY_FOLDERS.matting,
      ),
      step: 'matting' as const,
    },
  ]
  const collectionFolder = join(workbenchRoot, WORKBENCH_DIRECTORIES.collection)
  const db = (dependencies.openDatabase ?? openWorkbenchDatabase)(workbenchRoot)

  try {
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

export async function resolveImg2imgReferences(
  input: { artifactIds: string[] },
  dependencies: Pick<GenerationServiceDependencies, 'readConfig' | 'openDatabase'> = {},
): Promise<Img2imgReferencePayload[]> {
  const artifactIds = Array.from(
    new Set(input.artifactIds.map((artifactId) => artifactId.trim()).filter(Boolean)),
  )
  if (artifactIds.length === 0) {
    return []
  }

  const workbenchRoot = await readWorkbenchRoot(dependencies.readConfig)
  const db = (dependencies.openDatabase ?? openWorkbenchDatabase)(workbenchRoot)

  try {
    return Promise.all(
      artifactIds.map((artifactId) => readReferenceForArtifact(db, workbenchRoot, artifactId)),
    )
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

export async function listComfyuiTxt2imgWorkflows(
  dependencies: {
    workflowCache?: Pick<typeof comfyuiWorkflowCacheManager, 'listWorkflows'>
  } = {},
): Promise<ComfyuiWorkflowSummary[]> {
  const workflowCache = dependencies.workflowCache ?? comfyuiWorkflowCacheManager
  const workflows = await workflowCache.listWorkflows('txt2img')
  return workflows.filter((workflow) => workflow.capability === 'txt2img')
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
  const count = clampInt(input.count, 1, 1000, 5)
  const capability = input.capability ?? 'txt2img'
  const promptCategory = promptSkillCategory(capability, input.printMode)
  const selectedSkillId = input.skillId?.trim()
  const selectedSkillVersion = input.skillVersion?.trim()
  const debug = createGenerationDebugLogger({}, { capability })
  debug('开始生成提示词', 'info', {
    operation: 'prompt',
    count,
    model: input.model ?? null,
    skillId: selectedSkillId || undefined,
    skillVersion: selectedSkillVersion || undefined,
    skillCategory: selectedSkillId ? undefined : promptCategory,
    referenceImageCount: input.referenceImages?.length ?? 0,
    printMode: input.printMode ?? 'local',
    requirement: input.requirement ? promptPreview(input.requirement, 240) : undefined,
  })
  let diagnostics: DiagnosticLogWriter | null = null
  try {
    const workbenchConfig = await readAppConfig()
    diagnostics = await createOptionalDiagnosticLogWriter({
      module: 'generation',
      runId: `prompt_${Date.now()}`,
      workbenchRoot: workbenchConfig.workbench_root,
      meta: {
        operation: 'prompt_generation',
        capability,
        count,
        model: input.model ?? null,
        skillId: selectedSkillId || null,
        skillVersion: selectedSkillVersion || null,
        skillCategory: selectedSkillId ? null : promptCategory,
        printMode: input.printMode ?? 'local',
        referenceImageCount: input.referenceImages?.length ?? 0,
      },
    })
    if (diagnostics) {
      debug('诊断日志已创建', 'info', {
        operation: 'prompt',
        promptRunId: diagnostics.runId,
        savedPath: diagnostics.path,
      })
    } else {
      debug('未写入诊断日志：未设置工作区', 'warn', {
        operation: 'prompt',
      })
    }
  } catch (error) {
    debug('诊断日志创建失败', 'warn', {
      operation: 'prompt',
      error: appErrorMessage(error),
    })
  }
  try {
    const prompts = await promptGeneratorService.generatePrompts({
      ...(selectedSkillId
        ? {
            skillId: selectedSkillId,
            ...(selectedSkillVersion ? { skillVersion: selectedSkillVersion } : {}),
          }
        : { category: promptCategory }),
      variables: {
        printMode: input.printMode === 'full' ? '满印' : '局部',
        requirement: input.requirement,
        count,
        modeInstruction: input.modeInstruction ?? '',
      },
      count,
      ...(diagnostics ? { diagnostics } : {}),
      ...(input.model ? { model: input.model } : {}),
      ...(input.referenceImages?.length ? { refImages: input.referenceImages } : {}),
      userMessage:
        input.modeInstruction ??
        `生成 ${count} 条适合 Grsai ${capability === 'img2img' ? '图生图' : '文生图'}的英文印花提示词。`,
      responseFormat: 'json_object',
      onRawResponse: async (response) => {
        debug('百炼原始返回', 'debug', {
          operation: 'prompt',
          expected: response.expected,
          rawResponsePreview: promptPreview(response.text, 800),
          responseModel: response.model,
          finishReason: response.finishReason,
          chunkIndex: response.chunkIndex,
          chunkTotal: response.chunkTotal,
          savedPath: diagnostics?.path ?? null,
        })
      },
    })

    debug('提示词生成完成', 'info', {
      operation: 'prompt',
      count: prompts.length,
    })
    prompts.forEach((prompt, index) => {
      debug('百炼返回提示词', 'debug', {
        operation: 'prompt',
        promptIndex: index + 1,
        total: prompts.length,
        prompt: promptPreview(prompt, 300),
      })
    })
    return prompts.map((text) => ({
      id: randomUUID(),
      text,
      selected: true,
    })) satisfies Txt2imgPromptDraft[]
  } catch (error) {
    await diagnostics?.append({
      type: 'error',
      provider: 'aliyun-bailian',
      operation: 'prompt_generation',
      error: errorForDiagnosticLog(error),
    })
    debug('提示词生成失败', 'error', {
      operation: 'prompt',
      error: appErrorMessage(error),
      ...promptGenerationErrorDetails(error),
    })
    throw error
  }
}

export async function runExtract(
  input: ExtractRunInput,
  dependencies: GenerationServiceDependencies = {},
) {
  const sourceImagePaths = Array.from(
    new Set(input.sourceImagePaths.map((imagePath) => imagePath.trim()).filter(Boolean)),
  )
  if (sourceImagePaths.length === 0) {
    throw new AppErrorClass('HTTP_4XX', '请先选择至少一张源图', false)
  }
  if (!input.skillId.trim()) {
    throw new AppErrorClass('HTTP_4XX', '请选择提取 Skill', false)
  }

  const apiKey = await (dependencies.getSecret ?? getSecret)('grsai')
  if (!apiKey) {
    throw new AppErrorClass('HTTP_4XX', '缺少 Grsai API Key', false, { provider: 'grsai' })
  }

  const taskId = generationTaskId(input.taskId, 'extract')
  createGenerationDebugLogger({}, { taskId, capability: 'extract' })('任务已提交', 'info', {
    operation: 'submit',
    provider: 'grsai',
    sourceCount: sourceImagePaths.length,
    model: input.model,
    concurrency: input.concurrency,
  })
  submitGenerationTask(taskId, () =>
    runExtractBatch(
      { ...input, taskId, sourceImagePaths },
      {
        ...dependencies,
        getSecret: async () => apiKey,
      },
    ),
  )
  return taskId
}

export async function runComfyuiImg2img(
  input: ComfyuiImg2imgRunInput,
  dependencies: GenerationServiceDependencies = {},
) {
  const sourceCount = requestedComfyuiSourceCount(input)
  if (sourceCount === 0) {
    throw new AppErrorClass('HTTP_4XX', '请先选择至少一个印花', false)
  }
  if (!input.workflowId.trim()) {
    throw new AppErrorClass('HTTP_4XX', '请选择 ComfyUI 图生图工作流', false)
  }
  await assertLocalComfyuiWorkflowExists(dependencies, {
    workflowId: input.workflowId,
    capability: 'img2img',
    workflowVersion: input.workflowVersion,
  })

  const apiKey = await (dependencies.getSecret ?? getSecret)('chenyu')
  if (!apiKey) {
    throw new AppErrorClass('HTTP_4XX', '缺少晨羽智云 API Key', false, {
      provider: 'comfyui-chenyu',
    })
  }

  const taskId = generationTaskId(input.taskId, 'img2img')
  createGenerationDebugLogger({}, { taskId, capability: 'img2img' })('任务已提交', 'info', {
    operation: 'submit',
    provider: 'comfyui-chenyu',
    sourceCount,
    promptMode: comfyuiImg2imgPromptMode(input),
    ...workflowLogDetails(input),
    width: input.width ?? 1024,
    height: input.height ?? 1024,
  })
  submitGenerationTask(taskId, () =>
    runComfyuiImg2imgBatch(
      { ...input, taskId },
      {
        ...dependencies,
        getSecret: async (key) =>
          key === 'chenyu' ? apiKey : await (dependencies.getSecret ?? getSecret)(key),
      },
    ),
  )
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
    throw new AppErrorClass('HTTP_4XX', '请先选择至少一张源图', false)
  }
  if (!input.workflowId.trim()) {
    throw new AppErrorClass('HTTP_4XX', '请选择 ComfyUI 提取工作流', false)
  }
  await assertLocalComfyuiWorkflowExists(dependencies, {
    workflowId: input.workflowId,
    capability: 'extract',
    workflowVersion: input.workflowVersion,
  })

  const apiKey = await (dependencies.getSecret ?? getSecret)('chenyu')
  if (!apiKey) {
    throw new AppErrorClass('HTTP_4XX', '缺少晨羽智云 API Key', false, {
      provider: 'comfyui-chenyu',
    })
  }

  const taskId = generationTaskId(input.taskId, 'extract')
  createGenerationDebugLogger({}, { taskId, capability: 'extract' })('任务已提交', 'info', {
    operation: 'submit',
    provider: 'comfyui-chenyu',
    sourceCount: sourceImagePaths.length,
    ...workflowLogDetails(input),
    width: input.width ?? 1024,
    height: input.height ?? 1024,
  })
  submitGenerationTask(taskId, () =>
    runComfyuiExtractBatch(
      { ...input, taskId, sourceImagePaths },
      {
        ...dependencies,
        getSecret: async () => apiKey,
      },
    ),
  )
  return taskId
}

export async function runComfyuiExtractMatting(
  input: ComfyuiExtractMattingRunInput,
  dependencies: GenerationServiceDependencies = {},
) {
  const sourceImagePaths = Array.from(
    new Set(input.sourceImagePaths.map((imagePath) => imagePath.trim()).filter(Boolean)),
  )
  if (sourceImagePaths.length === 0) {
    throw new AppErrorClass('HTTP_4XX', '请先选择至少一张源图', false)
  }
  if (!input.extractWorkflowId.trim()) {
    throw new AppErrorClass('HTTP_4XX', '请选择 ComfyUI 提取工作流', false)
  }
  if (!input.mattingWorkflowId.trim()) {
    throw new AppErrorClass('HTTP_4XX', '请选择 ComfyUI 抠图工作流', false)
  }
  await assertLocalComfyuiWorkflowExists(dependencies, {
    workflowId: input.extractWorkflowId,
    capability: 'extract',
    workflowVersion: input.extractWorkflowVersion,
  })
  await assertLocalComfyuiWorkflowExists(dependencies, {
    workflowId: input.mattingWorkflowId,
    capability: 'matting',
    workflowVersion: input.mattingWorkflowVersion,
  })

  const apiKey = await (dependencies.getSecret ?? getSecret)('chenyu')
  if (!apiKey) {
    throw new AppErrorClass('HTTP_4XX', '缺少晨羽智云 API Key', false, {
      provider: 'comfyui-chenyu',
    })
  }

  const taskId = extractMattingTaskId(input.taskId)
  createGenerationDebugLogger({}, { taskId, capability: 'matting' })('任务已提交', 'info', {
    operation: 'submit',
    provider: 'comfyui-chenyu',
    sourceCount: sourceImagePaths.length,
    extractWorkflowId: input.extractWorkflowId,
    mattingWorkflowId: input.mattingWorkflowId,
    width: input.width ?? 1024,
    height: input.height ?? 1024,
  })
  submitGenerationTask(taskId, () =>
    runComfyuiExtractMattingBatch(
      { ...input, taskId, sourceImagePaths },
      {
        ...dependencies,
        getSecret: async () => apiKey,
      },
    ),
  )
  return taskId
}

export async function runComfyuiMatting(
  input: ComfyuiMattingRunInput,
  dependencies: GenerationServiceDependencies = {},
) {
  const sourceCount = requestedComfyuiSourceCount(input)
  if (sourceCount === 0) {
    throw new AppErrorClass('HTTP_4XX', '请先选择至少一个印花', false)
  }
  if (!input.workflowId.trim()) {
    throw new AppErrorClass('HTTP_4XX', '请选择 ComfyUI 抠图工作流', false)
  }
  await assertLocalComfyuiWorkflowExists(dependencies, {
    workflowId: input.workflowId,
    capability: 'matting',
    workflowVersion: input.workflowVersion,
  })

  const apiKey = await (dependencies.getSecret ?? getSecret)('chenyu')
  if (!apiKey) {
    throw new AppErrorClass('HTTP_4XX', '缺少晨羽智云 API Key', false, {
      provider: 'comfyui-chenyu',
    })
  }

  const taskId = generationTaskId(input.taskId, 'matting')
  createGenerationDebugLogger({}, { taskId, capability: 'matting' })('任务已提交', 'info', {
    operation: 'submit',
    provider: 'comfyui-chenyu',
    sourceCount,
    ...workflowLogDetails(input),
    width: input.width ?? 1024,
    height: input.height ?? 1024,
  })
  submitGenerationTask(taskId, () =>
    runComfyuiMattingBatch(
      { ...input, taskId },
      {
        ...dependencies,
        getSecret: async () => apiKey,
      },
    ),
  )
  return taskId
}

export async function runMixedMatting(
  input: MixedMattingRunInput,
  dependencies: GenerationServiceDependencies = {},
) {
  const sourceCount = requestedComfyuiSourceCount(input)
  if (sourceCount === 0) {
    throw new AppErrorClass('HTTP_4XX', '请先选择至少一个印花', false)
  }
  if (!input.workflowId.trim()) {
    throw new AppErrorClass('HTTP_4XX', '请选择 ComfyUI 混合抠图工作流', false)
  }
  await assertLocalComfyuiWorkflowExists(dependencies, {
    workflowId: input.workflowId,
    capability: 'matting-mixed',
    workflowVersion: input.workflowVersion,
  })
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

  const taskId = generationTaskId(input.taskId, 'matting')
  createGenerationDebugLogger({}, { taskId, capability: 'matting' })('任务已提交', 'info', {
    operation: 'submit',
    provider: 'grsai+comfyui',
    sourceCount,
    ...workflowLogDetails(input),
    maskModel: input.maskModel ?? null,
    width: input.width ?? 1024,
    height: input.height ?? 1024,
  })
  submitGenerationTask(taskId, () =>
    runMixedMattingBatch(
      { ...input, taskId },
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
    ),
  )
  return taskId
}

export async function runExtractBatch(
  input: ExtractRunInput,
  dependencies: GenerationServiceDependencies = {},
) {
  const sourceImagePaths = Array.from(
    new Set(input.sourceImagePaths.map((imagePath) => imagePath.trim()).filter(Boolean)),
  )
  if (sourceImagePaths.length === 0) {
    throw new AppErrorClass('HTTP_4XX', '请先选择至少一张源图', false)
  }
  if (!input.skillId.trim()) {
    throw new AppErrorClass('HTTP_4XX', '请选择提取 Skill', false)
  }

  const apiKey = await (dependencies.getSecret ?? getSecret)('grsai')
  if (!apiKey) {
    throw new AppErrorClass('HTTP_4XX', '缺少 Grsai API Key', false, { provider: 'grsai' })
  }

  const taskId = generationTaskId(input.taskId, 'extract')
  const result: GenerationRunResult = {
    taskId,
    total: sourceImagePaths.length,
    succeeded: 0,
    failed: 0,
    images: [],
    failures: [],
  }
  let db: GenerationDatabase | null = null
  let diagnostics: DiagnosticLogWriter | null = null
  const emit = createGenerationProgressEmitter(dependencies)
  let outputIndex = input.filenameStartIndex ?? 0

  try {
    const settings = normalizeGenerationLocalConfig((await readAppConfig()).generation)
    const concurrency = clampInt(input.concurrency, 1, 20, settings.grsai_concurrency)
    const model = normalizeModel(input.model)
    const controller = new GenerationConcurrencyController({ workers: concurrency })
    const skillCache = dependencies.skillCache ?? skillCacheManager
    const downloadImage = dependencies.downloadImage ?? defaultDownloadImage
    const workbenchRoot = await readWorkbenchRoot(dependencies.readConfig)
    diagnostics = await createGenerationDiagnostics(workbenchRoot, taskId, {
      provider: 'grsai',
      capability: 'extract',
      sourceCount: sourceImagePaths.length,
      model,
      aspectRatio: input.aspectRatio,
      skillId: input.skillId,
      skillVersion: input.skillVersion ?? null,
    })
    if (diagnostics) {
      result.diagnosticsLogPath = diagnostics.path
    }
    const adapter =
      dependencies.createGrsaiAdapter?.(apiKey) ??
      new GrsaiAdapter(apiKey, settings.grsai_node, {
        retries: settings.grsai_retries,
        ...(diagnostics ? { diagnostics } : {}),
      })
    const sourceFolder = join(workbenchRoot, WORKBENCH_DIRECTORIES.collection)
    const outputFolder = generationTaskOutputFolder(
      workbenchRoot,
      'extract',
      generationOutputTaskName(input, taskId),
    )
    db = (dependencies.openDatabase ?? openWorkbenchDatabase)(workbenchRoot)
    const activeDb = db
    await mkdir(outputFolder, { recursive: true })
    const skill = await skillCache.getSkill(input.skillId.trim(), input.skillVersion)

    await Promise.all(
      sourceImagePaths.map((sourceImagePath, sourceIndex) =>
        controller.run(`${taskId}-${sourceIndex}`, async () => {
          if (isGenerationCancelled(taskId)) {
            return
          }
          assertInsideFolder(sourceImagePath, sourceFolder)
          const sourceIdentity = await imageIdentity(sourceImagePath)
          registerSourceArtifact(activeDb, {
            identity: sourceIdentity,
            imagePath: sourceImagePath,
            taskId,
            createdAt: Date.now(),
          })
          const reference = await imageReference(sourceImagePath)
          const prompt =
            skill.systemPrompt.trim() || 'Extract the print from the source product image.'
          emitExtractProgress(result, sourceImagePaths.length, taskId, emit, prompt)
          try {
            if (isGenerationCancelled(taskId)) {
              return
            }
            const response = await adapter.generate({
              capability: 'extract',
              prompt,
              reference_images: [reference],
              output: {
                aspect_ratio: input.aspectRatio,
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

            controller.onResponse(200)
            for (const image of response.images) {
              const printId = newPrintId()
              const currentOutputIndex = outputIndex
              outputIndex += 1
              const targetPath = await generationTargetPath(
                outputFolder,
                printId,
                '.png',
                input,
                currentOutputIndex,
              )
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
              await emitImageComplete(dependencies, {
                taskId,
                capability: 'extract',
                path: targetPath,
                printId: artifact.printId,
                artifactId: artifact.artifactId,
                prompt,
                sourceArtifactIds: [sourceIdentity.artifactId],
              })
            }
          } catch (error) {
            observeGenerationError(controller, error)
            await diagnostics
              ?.append({
                type: 'error',
                provider: 'grsai',
                operation: 'extract',
                itemKey: basename(sourceImagePath),
                error: errorForDiagnosticLog(error),
              })
              .catch(() => null)
            result.failed += 1
            result.failures.push({
              prompt,
              sourcePath: sourceImagePath,
              error: appErrorMessage(error),
            })
          } finally {
            emitExtractProgress(result, sourceImagePaths.length, taskId, emit, prompt)
          }
        }),
      ),
    )
    return await finishGenerationResultWithDiagnostics(diagnostics, result, 'grsai', 'extract')
  } catch (error) {
    await diagnostics
      ?.append({
        type: 'task_failed',
        provider: 'grsai',
        operation: 'extract',
        error: errorForDiagnosticLog(error),
      })
      .catch(() => null)
    throw error
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
    throw new AppErrorClass('HTTP_4XX', '请先选择至少一张源图', false)
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

  const taskId = generationTaskId(input.taskId, 'extract')
  return comfyuiInstanceLocks.run(input, taskId, async () => {
    const result: GenerationRunResult = {
      taskId,
      total: sourceImagePaths.length,
      succeeded: 0,
      failed: 0,
      images: [],
      failures: [],
    }
    const emit = createGenerationProgressEmitter(dependencies)
    const skillId = input.skillId?.trim()
    const skill = skillId
      ? await (dependencies.skillCache ?? skillCacheManager).getSkill(skillId, input.skillVersion)
      : null
    const prompt =
      skill?.systemPrompt.trim() ||
      input.prompt?.trim() ||
      'Extract the print from the source product image.'
    const sizePx = comfyuiSizePx(input)
    const workbenchRoot = await readWorkbenchRoot(dependencies.readConfig)
    const diagnostics = await createGenerationDiagnostics(workbenchRoot, taskId, {
      provider: 'comfyui-chenyu',
      capability: 'extract',
      workflowId: input.workflowId,
      workflowName: input.workflowName ?? null,
      sourceCount: sourceImagePaths.length,
      width: sizePx.width,
      height: sizePx.height,
    })
    if (diagnostics) {
      result.diagnosticsLogPath = diagnostics.path
    }
    const db = (dependencies.openDatabase ?? openWorkbenchDatabase)(workbenchRoot)

    try {
      const adapter = await createComfyuiAdapterForRun(
        input,
        apiKey,
        workbenchRoot,
        db,
        dependencies,
        diagnostics,
      )
      const debug = createGenerationDebugLogger(dependencies, { taskId, capability: 'extract' })
      let outputIndex = input.filenameStartIndex ?? 0

      for (const [index, sourceImagePath] of sourceImagePaths.entries()) {
        if (isGenerationCancelled(taskId)) {
          break
        }
        emitExtractProgress(result, sourceImagePaths.length, taskId, emit, prompt)
        try {
          const sourceIdentity = await imageIdentity(sourceImagePath)
          registerSourceArtifact(db, {
            identity: sourceIdentity,
            imagePath: sourceImagePath,
            taskId,
            createdAt: Date.now(),
          })
          const filenameIndex = outputIndex
          emitComfyuiRequestLog(debug, {
            ...input,
            prompt,
            sourceImage: basename(sourceImagePath),
            sourceIndex: index + 1,
            total: sourceImagePaths.length,
            width: sizePx.width,
            height: sizePx.height,
          })
          const response = await adapter.generate({
            capability: 'extract',
            prompt,
            workflow_id: input.workflowId.trim(),
            reference_images: [await imageReference(sourceImagePath)],
            output: { format: 'png', size_px: sizePx },
            options: {
              taskId,
              sourceArtifactIds: [sourceIdentity.artifactId],
              width: sizePx.width,
              height: sizePx.height,
              ...comfyuiRunOptions(workbenchRoot, 'extract', taskId, input, filenameIndex),
              ...(input.workflowVersion ? { workflowVersion: input.workflowVersion } : {}),
            },
          } satisfies GenerateRequest)
          if (response.status !== 'succeeded') {
            throw response.error ?? new AppErrorClass('HTTP_5XX', 'ComfyUI 提取失败', true)
          }
          outputIndex += response.images.length
          for (const image of response.images) {
            const completedImage = {
              prompt,
              url: image.url,
              ...(image.local_path ? { localPath: image.local_path } : {}),
              sourcePath: sourceImagePath,
              ...generationImageIdentity(image, sourceIdentity),
            }
            result.succeeded += 1
            result.images.push(completedImage)
            await emitImageComplete(dependencies, {
              taskId,
              capability: 'extract',
              path: localPathFromGeneratedImage(image),
              printId: completedImage.printId ?? sourceIdentity.printId,
              artifactId: completedImage.artifactId,
              prompt: completedImage.prompt,
              sourceArtifactIds: [sourceIdentity.artifactId],
            })
          }
        } catch (error) {
          await diagnostics
            ?.append({
              type: 'error',
              provider: 'comfyui-chenyu',
              operation: 'extract',
              itemKey: basename(sourceImagePath),
              error: errorForDiagnosticLog(error),
            })
            .catch(() => null)
          result.failed += 1
          result.failures.push({
            prompt,
            sourcePath: sourceImagePath,
            error: appErrorMessage(error),
          })
        } finally {
          emitExtractProgress(result, sourceImagePaths.length, taskId, emit, prompt)
        }
      }

      return await finishGenerationResultWithDiagnostics(
        diagnostics,
        result,
        'comfyui-chenyu',
        'extract',
      )
    } finally {
      db.close()
    }
  })
}

export async function runComfyuiExtractMattingBatch(
  input: ComfyuiExtractMattingRunInput,
  dependencies: GenerationServiceDependencies = {},
) {
  const sourceImagePaths = Array.from(
    new Set(input.sourceImagePaths.map((imagePath) => imagePath.trim()).filter(Boolean)),
  )
  if (sourceImagePaths.length === 0) {
    throw new AppErrorClass('HTTP_4XX', '请先选择至少一张源图', false)
  }
  if (!input.extractWorkflowId.trim()) {
    throw new AppErrorClass('HTTP_4XX', '请选择 ComfyUI 提取工作流', false)
  }
  if (!input.mattingWorkflowId.trim()) {
    throw new AppErrorClass('HTTP_4XX', '请选择 ComfyUI 抠图工作流', false)
  }

  const apiKey = await (dependencies.getSecret ?? getSecret)('chenyu')
  if (!apiKey) {
    throw new AppErrorClass('HTTP_4XX', '缺少晨羽智云 API Key', false, {
      provider: 'comfyui-chenyu',
    })
  }

  const taskId = extractMattingTaskId(input.taskId)
  return comfyuiInstanceLocks.run(input, taskId, async () => {
    const result: GenerationRunResult = {
      taskId,
      total: sourceImagePaths.length,
      succeeded: 0,
      failed: 0,
      images: [],
      failures: [],
    }
    const emit = createGenerationProgressEmitter(dependencies)
    const skillId = input.skillId?.trim()
    const skill = skillId
      ? await (dependencies.skillCache ?? skillCacheManager).getSkill(skillId, input.skillVersion)
      : null
    const extractPrompt =
      skill?.systemPrompt.trim() ||
      input.prompt?.trim() ||
      'Extract the print from the source product image.'
    const mattingPrompt = 'Remove the background and output transparent PNG.'
    const sizePx = comfyuiSizePx(input)
    const workbenchRoot = await readWorkbenchRoot(dependencies.readConfig)
    const diagnostics = await createGenerationDiagnostics(workbenchRoot, taskId, {
      provider: 'comfyui-chenyu',
      capability: 'matting',
      operation: 'extract-matting',
      extractWorkflowId: input.extractWorkflowId,
      mattingWorkflowId: input.mattingWorkflowId,
      sourceCount: sourceImagePaths.length,
      width: sizePx.width,
      height: sizePx.height,
    })
    if (diagnostics) {
      result.diagnosticsLogPath = diagnostics.path
    }
    const db = (dependencies.openDatabase ?? openWorkbenchDatabase)(workbenchRoot)
    const tempFiles = dependencies.tempFiles ?? tempFileManager
    let createdTempDir = false

    try {
      const tempDir = await tempFiles.createTaskDir('matting', taskId)
      createdTempDir = true
      const adapter = await createComfyuiAdapterForRun(
        input,
        apiKey,
        workbenchRoot,
        db,
        dependencies,
        diagnostics,
      )
      const debug = createGenerationDebugLogger(dependencies, { taskId, capability: 'matting' })
      let outputIndex = input.filenameStartIndex ?? 0

      for (const [index, sourceImagePath] of sourceImagePaths.entries()) {
        if (isGenerationCancelled(taskId)) {
          break
        }
        emitMattingProgress(result, taskId, sourceImagePaths.length, emit)
        try {
          const sourceIdentity = await imageIdentity(sourceImagePath)
          registerSourceArtifact(db, {
            identity: sourceIdentity,
            imagePath: sourceImagePath,
            taskId,
            createdAt: Date.now(),
          })

          emitComfyuiRequestLog(debug, {
            workflowId: input.extractWorkflowId,
            workflowName: input.extractWorkflowName,
            workflowVersion: input.extractWorkflowVersion,
            prompt: extractPrompt,
            sourceImage: basename(sourceImagePath),
            sourceIndex: index + 1,
            total: sourceImagePaths.length,
            width: sizePx.width,
            height: sizePx.height,
          })
          const extractResponse = await adapter.generate({
            capability: 'extract',
            prompt: extractPrompt,
            workflow_id: input.extractWorkflowId.trim(),
            reference_images: [await imageReference(sourceImagePath)],
            output: { format: 'png', size_px: sizePx },
            options: {
              taskId: `${taskId}-extract-${index + 1}`,
              sourceArtifactIds: [sourceIdentity.artifactId],
              width: sizePx.width,
              height: sizePx.height,
              outputFolderOverride: join(tempDir, `extract-${index + 1}`),
              registerArtifact: false,
              maxOutputs: 1,
              ...(input.extractWorkflowVersion
                ? { workflowVersion: input.extractWorkflowVersion }
                : {}),
            },
          } satisfies GenerateRequest)
          if (extractResponse.status !== 'succeeded') {
            throw extractResponse.error ?? new AppErrorClass('HTTP_5XX', 'ComfyUI 提取失败', true)
          }
          const extractedImage = extractResponse.images[0]
          if (!extractedImage?.local_path) {
            throw new AppErrorClass('HTTP_5XX', 'ComfyUI 提取未返回本地图片', true)
          }
          const filenameIndex = outputIndex

          emitComfyuiRequestLog(debug, {
            workflowId: input.mattingWorkflowId,
            workflowName: input.mattingWorkflowName,
            workflowVersion: input.mattingWorkflowVersion,
            prompt: mattingPrompt,
            sourceImage: basename(extractedImage.local_path),
            sourceIndex: index + 1,
            total: sourceImagePaths.length,
            width: sizePx.width,
            height: sizePx.height,
          })
          const mattingResponse = await adapter.generate({
            capability: 'matting',
            prompt: mattingPrompt,
            workflow_id: input.mattingWorkflowId.trim(),
            reference_images: [await imageReference(extractedImage.local_path)],
            output: { format: 'png', size_px: sizePx },
            options: {
              taskId,
              sourceArtifactIds: [sourceIdentity.artifactId],
              printId: sourceIdentity.printId,
              width: sizePx.width,
              height: sizePx.height,
              maxOutputs: 1,
              ...comfyuiRunOptions(workbenchRoot, 'matting', taskId, input, filenameIndex),
              ...(input.mattingWorkflowVersion
                ? { workflowVersion: input.mattingWorkflowVersion }
                : {}),
            },
          } satisfies GenerateRequest)
          if (mattingResponse.status !== 'succeeded') {
            throw mattingResponse.error ?? new AppErrorClass('HTTP_5XX', 'ComfyUI 抠图失败', true)
          }
          const finalImage = mattingResponse.images[0]
          if (!finalImage) {
            throw new AppErrorClass('HTTP_5XX', 'ComfyUI 抠图未返回结果图', true)
          }
          outputIndex += 1
          const completedImage = {
            prompt: mattingPrompt,
            url: finalImage.url,
            ...(finalImage.local_path ? { localPath: finalImage.local_path } : {}),
            sourcePath: sourceImagePath,
            ...generationImageIdentity(finalImage, sourceIdentity),
          }
          result.succeeded += 1
          result.images.push(completedImage)
          await emitImageComplete(dependencies, {
            taskId,
            capability: 'matting',
            path: localPathFromGeneratedImage(finalImage),
            printId: completedImage.printId ?? sourceIdentity.printId,
            artifactId: completedImage.artifactId,
            prompt: completedImage.prompt,
            sourceArtifactIds: [sourceIdentity.artifactId],
          })
        } catch (error) {
          await diagnostics
            ?.append({
              type: 'error',
              provider: 'comfyui-chenyu',
              operation: 'extract-matting',
              itemKey: basename(sourceImagePath),
              error: errorForDiagnosticLog(error),
            })
            .catch(() => null)
          result.failed += 1
          result.failures.push({
            prompt: extractPrompt,
            sourcePath: sourceImagePath,
            error: appErrorMessage(error),
          })
        } finally {
          emitMattingProgress(result, taskId, sourceImagePaths.length, emit)
        }
      }

      return await finishGenerationResultWithDiagnostics(
        diagnostics,
        result,
        'comfyui-chenyu',
        'extract-matting',
      )
    } finally {
      db.close()
      if (createdTempDir) {
        await tempFiles.cleanupTask('matting', taskId)
      }
    }
  })
}

export async function runComfyuiMattingBatch(
  input: ComfyuiMattingRunInput,
  dependencies: GenerationServiceDependencies = {},
) {
  if (requestedComfyuiSourceCount(input) === 0) {
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

  const taskId = generationTaskId(input.taskId, 'matting')
  return comfyuiInstanceLocks.run(input, taskId, async () => {
    const emit = createGenerationProgressEmitter(dependencies)
    const workbenchRoot = await readWorkbenchRoot(dependencies.readConfig)
    const diagnostics = await createGenerationDiagnostics(workbenchRoot, taskId, {
      provider: 'comfyui-chenyu',
      capability: 'matting',
      workflowId: input.workflowId,
      sourceCount: requestedComfyuiSourceCount(input),
    })
    const db = (dependencies.openDatabase ?? openWorkbenchDatabase)(workbenchRoot)

    try {
      const sourceArtifactIds = await comfyuiSourceArtifactIds(db, {
        taskId,
        ...(input.sourceArtifactIds !== undefined
          ? { sourceArtifactIds: input.sourceArtifactIds }
          : {}),
        ...(input.sourceImagePaths !== undefined
          ? { sourceImagePaths: input.sourceImagePaths }
          : {}),
      })
      const result: GenerationRunResult = {
        taskId,
        total: sourceArtifactIds.length,
        succeeded: 0,
        failed: 0,
        images: [],
        failures: [],
        ...(diagnostics ? { diagnosticsLogPath: diagnostics.path } : {}),
      }
      const sizePx = comfyuiOptionalSizePx(input)
      const adapter = await createComfyuiAdapterForRun(
        input,
        apiKey,
        workbenchRoot,
        db,
        dependencies,
        diagnostics,
      )
      const debug = createGenerationDebugLogger(dependencies, { taskId, capability: 'matting' })
      let outputIndex = input.filenameStartIndex ?? 0

      for (const [index, artifactId] of sourceArtifactIds.entries()) {
        if (isGenerationCancelled(taskId)) {
          break
        }
        emitMattingProgress(result, taskId, sourceArtifactIds.length, emit)
        try {
          const source = await readReferenceForArtifact(db, workbenchRoot, artifactId)
          const prompt = input.prompt?.trim() || 'Remove the background and output transparent PNG.'
          const filenameIndex = outputIndex
          emitComfyuiRequestLog(debug, {
            ...input,
            prompt,
            sourceImage: basename(source.imagePath),
            sourceIndex: index + 1,
            total: sourceArtifactIds.length,
            ...(sizePx ? { width: sizePx.width, height: sizePx.height } : {}),
          })
          const response = await adapter.generate({
            capability: 'matting',
            prompt,
            workflow_id: input.workflowId.trim(),
            reference_images: [source.reference],
            output: { format: 'png', ...(sizePx ? { size_px: sizePx } : {}) },
            options: {
              taskId,
              sourceArtifactIds: [artifactId],
              printId: source.printId,
              ...(sizePx ? { width: sizePx.width, height: sizePx.height } : {}),
              ...comfyuiRunOptions(workbenchRoot, 'matting', taskId, input, filenameIndex),
              ...(input.workflowVersion ? { workflowVersion: input.workflowVersion } : {}),
            },
          } satisfies GenerateRequest)
          if (response.status !== 'succeeded') {
            throw response.error ?? new AppErrorClass('HTTP_5XX', 'ComfyUI 抠图失败', true)
          }
          outputIndex += response.images.length
          for (const image of response.images) {
            const completedImage = {
              prompt,
              url: image.url,
              ...(image.local_path ? { localPath: image.local_path } : {}),
              sourcePath: source.imagePath,
              ...generationImageIdentity(image, { artifactId, printId: source.printId }),
            }
            result.succeeded += 1
            result.images.push(completedImage)
            await emitImageComplete(dependencies, {
              taskId,
              capability: 'matting',
              path: localPathFromGeneratedImage(image),
              printId: completedImage.printId ?? source.printId,
              artifactId: completedImage.artifactId,
              prompt: completedImage.prompt,
              sourceArtifactIds: [artifactId],
            })
          }
        } catch (error) {
          await diagnostics
            ?.append({
              type: 'error',
              provider: 'comfyui-chenyu',
              operation: 'matting',
              itemKey: artifactId,
              error: errorForDiagnosticLog(error),
            })
            .catch(() => null)
          result.failed += 1
          result.failures.push({
            prompt: input.prompt?.trim() ?? '',
            error: appErrorMessage(error),
            sourcePath: artifactId,
          })
        } finally {
          emitMattingProgress(result, taskId, sourceArtifactIds.length, emit)
        }
      }

      return await finishGenerationResultWithDiagnostics(
        diagnostics,
        result,
        'comfyui-chenyu',
        'matting',
      )
    } finally {
      db.close()
    }
  })
}

export async function runMixedMattingBatch(
  input: MixedMattingRunInput,
  dependencies: GenerationServiceDependencies = {},
) {
  if (requestedComfyuiSourceCount(input) === 0) {
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

  const taskId = generationTaskId(input.taskId, 'matting')
  return comfyuiInstanceLocks.run(input, taskId, async () => {
    const emit = createGenerationProgressEmitter(dependencies)
    const workbenchRoot = await readWorkbenchRoot(dependencies.readConfig)
    const diagnostics = await createGenerationDiagnostics(workbenchRoot, taskId, {
      provider: 'grsai+comfyui-mask',
      capability: 'matting',
      workflowId: input.workflowId,
      sourceCount: requestedComfyuiSourceCount(input),
    })
    const db = (dependencies.openDatabase ?? openWorkbenchDatabase)(workbenchRoot)
    const tempFiles = dependencies.tempFiles ?? tempFileManager
    let createdTempDir = false

    try {
      const sourceArtifactIds = await comfyuiSourceArtifactIds(db, {
        taskId,
        ...(input.sourceArtifactIds !== undefined
          ? { sourceArtifactIds: input.sourceArtifactIds }
          : {}),
        ...(input.sourceImagePaths !== undefined
          ? { sourceImagePaths: input.sourceImagePaths }
          : {}),
      })
      const result: GenerationRunResult = {
        taskId,
        total: sourceArtifactIds.length,
        succeeded: 0,
        failed: 0,
        images: [],
        failures: [],
        ...(diagnostics ? { diagnosticsLogPath: diagnostics.path } : {}),
      }
      const sizePx = comfyuiOptionalSizePx(input)
      await tempFiles.createTaskDir('matting', taskId)
      createdTempDir = true
      const skill = await resolveMixedMattingMaskSkill(
        input,
        dependencies.skillCache ?? skillCacheManager,
      )
      const settings = normalizeGenerationLocalConfig((await readAppConfig()).generation)
      const grsai =
        dependencies.createGrsaiAdapter?.(grsaiKey) ??
        new GrsaiAdapter(grsaiKey, settings.grsai_node, {
          retries: settings.grsai_retries,
          ...(diagnostics ? { diagnostics } : {}),
        })
      const downloadImage = dependencies.downloadImage ?? defaultDownloadImage
      const comfyui = await createComfyuiAdapterForRun(
        input,
        chenyuKey,
        workbenchRoot,
        db,
        dependencies,
        diagnostics,
      )
      const debug = createGenerationDebugLogger(dependencies, { taskId, capability: 'matting' })
      let outputIndex = input.filenameStartIndex ?? 0

      for (const [index, artifactId] of sourceArtifactIds.entries()) {
        if (isGenerationCancelled(taskId)) {
          break
        }
        emitMattingProgress(result, taskId, sourceArtifactIds.length, emit)
        let maskPath: string | null = null
        try {
          const source = await readReferenceForArtifact(db, workbenchRoot, artifactId)
          maskPath = join(await tempFiles.createTaskDir('matting', taskId), 'mask.png')
          const maskModel = normalizeModel(input.maskModel ?? DEFAULT_GENERATION_MODEL)
          const maskResponse = await grsai.generate({
            capability: 'img2img',
            prompt: skill.systemPrompt,
            reference_images: [source.reference],
            output: {
              aspect_ratio: '1024x1024',
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

          const prompt =
            input.prompt?.trim() ||
            'Convert the black and white mask to alpha and composite it with the original print.'
          const filenameIndex = outputIndex
          emitComfyuiRequestLog(debug, {
            ...input,
            prompt,
            sourceImage: basename(source.imagePath),
            sourceIndex: index + 1,
            total: sourceArtifactIds.length,
            ...(sizePx ? { width: sizePx.width, height: sizePx.height } : {}),
          })
          const response = await comfyui.generate({
            capability: 'matting',
            prompt,
            workflow_id: input.workflowId.trim(),
            reference_images: [source.reference, await imageReference(maskPath)],
            output: { format: 'png', ...(sizePx ? { size_px: sizePx } : {}) },
            options: {
              taskId,
              sourceArtifactIds: [artifactId],
              printId: source.printId,
              ...(sizePx ? { width: sizePx.width, height: sizePx.height } : {}),
              ...comfyuiRunOptions(workbenchRoot, 'matting', taskId, input, filenameIndex),
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
          outputIndex += response.images.length
          for (const image of response.images) {
            const completedImage = {
              prompt,
              url: image.url,
              ...(image.local_path ? { localPath: image.local_path } : {}),
              sourcePath: source.imagePath,
              ...generationImageIdentity(image, { artifactId, printId: source.printId }),
            }
            result.succeeded += 1
            result.images.push(completedImage)
            await emitImageComplete(dependencies, {
              taskId,
              capability: 'matting',
              path: localPathFromGeneratedImage(image),
              printId: completedImage.printId ?? source.printId,
              artifactId: completedImage.artifactId,
              prompt: completedImage.prompt,
              sourceArtifactIds: [artifactId],
            })
          }
        } catch (error) {
          await diagnostics
            ?.append({
              type: 'error',
              provider: 'grsai+comfyui-mask',
              operation: 'matting',
              itemKey: artifactId,
              error: errorForDiagnosticLog(error),
            })
            .catch(() => null)
          result.failed += 1
          result.failures.push({
            prompt: input.prompt?.trim() ?? '',
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

      return await finishGenerationResultWithDiagnostics(
        diagnostics,
        result,
        'grsai+comfyui-mask',
        'matting',
      )
    } finally {
      db.close()
      if (createdTempDir) {
        await tempFiles.cleanupTask('matting', taskId)
      }
    }
  })
}

export async function runComfyuiImg2imgBatch(
  input: ComfyuiImg2imgRunInput,
  dependencies: GenerationServiceDependencies = {},
) {
  if (requestedComfyuiSourceCount(input) === 0) {
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

  const taskId = generationTaskId(input.taskId, 'img2img')
  return comfyuiInstanceLocks.run(input, taskId, async () => {
    const emit = createGenerationProgressEmitter(dependencies)
    const workbenchRoot = await readWorkbenchRoot(dependencies.readConfig)
    const diagnostics = await createGenerationDiagnostics(workbenchRoot, taskId, {
      provider: 'comfyui-chenyu',
      capability: 'img2img',
      workflowId: input.workflowId,
      sourceCount: requestedComfyuiSourceCount(input),
      promptMode: comfyuiImg2imgPromptMode(input),
      promptModel: input.promptModel ?? null,
      promptSkillId: input.promptSkillId ?? null,
      promptSkillVersion: input.promptSkillVersion ?? null,
      width: input.width ?? 1024,
      height: input.height ?? 1024,
      batchSize: comfyuiImg2imgBatchSize(input),
    })
    const db = (dependencies.openDatabase ?? openWorkbenchDatabase)(workbenchRoot)

    try {
      const sourceArtifactIds = await comfyuiSourceArtifactIds(db, {
        taskId,
        ...(input.sourceArtifactIds !== undefined
          ? { sourceArtifactIds: input.sourceArtifactIds }
          : {}),
        ...(input.sourceImagePaths !== undefined
          ? { sourceImagePaths: input.sourceImagePaths }
          : {}),
      })
      const result: GenerationRunResult = {
        taskId,
        total: sourceArtifactIds.length * comfyuiImg2imgBatchSize(input),
        succeeded: 0,
        failed: 0,
        images: [],
        failures: [],
        ...(diagnostics ? { diagnosticsLogPath: diagnostics.path } : {}),
      }
      const sizePx = comfyuiSizePx(input)
      const batchSize = comfyuiImg2imgBatchSize(input)
      const adapter = await createComfyuiAdapterForRun(
        input,
        apiKey,
        workbenchRoot,
        db,
        dependencies,
        diagnostics,
      )
      const debug = createGenerationDebugLogger(dependencies, { taskId, capability: 'img2img' })
      let outputIndex = input.filenameStartIndex ?? 0
      const promptMode = comfyuiImg2imgPromptMode(input)

      for (const [index, artifactId] of sourceArtifactIds.entries()) {
        if (isGenerationCancelled(taskId)) {
          break
        }
        emitImg2imgProgress(result, taskId, result.total, emit)
        try {
          const source = await readReferenceForArtifact(db, workbenchRoot, artifactId)
          const prompt = await resolveComfyuiImg2imgPromptForSource(input, source, {
            sourceIndex: index + 1,
            total: sourceArtifactIds.length,
            diagnostics,
            dependencies,
            debug,
          })
          const preserveWorkflowPrompt = promptMode === 'workflow'
          const filenameIndex = outputIndex
          emitComfyuiRequestLog(debug, {
            ...input,
            prompt,
            promptMode,
            sourceImage: basename(source.imagePath),
            sourceIndex: index + 1,
            total: sourceArtifactIds.length,
            width: sizePx.width,
            height: sizePx.height,
            batchSize,
          })
          const response = await adapter.generate({
            capability: 'img2img',
            prompt,
            workflow_id: input.workflowId.trim(),
            reference_images: [source.reference],
            output: { format: 'png', size_px: sizePx },
            options: {
              taskId,
              sourceArtifactIds: [artifactId],
              printId: source.printId,
              width: sizePx.width,
              height: sizePx.height,
              batchSize,
              maxOutputs: batchSize,
              ...comfyuiRunOptions(workbenchRoot, 'img2img', taskId, input, filenameIndex),
              ...(preserveWorkflowPrompt ? { preserveWorkflowPrompt: true } : {}),
              promptMode,
              ...(input.promptSkillId ? { promptSkillId: input.promptSkillId } : {}),
              ...(input.promptSkillVersion ? { promptSkillVersion: input.promptSkillVersion } : {}),
              ...(input.promptModel ? { promptModel: input.promptModel } : {}),
              ...(input.workflowVersion ? { workflowVersion: input.workflowVersion } : {}),
            },
          } satisfies GenerateRequest)
          if (response.status !== 'succeeded') {
            throw response.error ?? new AppErrorClass('HTTP_5XX', 'ComfyUI 图生图失败', true)
          }
          outputIndex += response.images.length
          for (const image of response.images) {
            const completedImage = {
              prompt: image.prompt ?? (preserveWorkflowPrompt ? '工作流默认提示词' : prompt),
              url: image.url,
              ...(image.local_path ? { localPath: image.local_path } : {}),
              ...generationImageIdentity(image, { artifactId, printId: source.printId }),
            }
            result.succeeded += 1
            result.images.push(completedImage)
            await emitImageComplete(dependencies, {
              taskId,
              capability: 'img2img',
              path: localPathFromGeneratedImage(image),
              printId: completedImage.printId ?? source.printId,
              artifactId: completedImage.artifactId,
              prompt: completedImage.prompt,
              sourceArtifactIds: [artifactId],
            })
          }
          if (response.images.length < batchSize) {
            const missing = batchSize - response.images.length
            result.failed += missing
            result.failures.push({
              prompt,
              error: `ComfyUI 本次只返回 ${response.images.length}/${batchSize} 张图片`,
              sourcePath: artifactId,
            })
          }
        } catch (error) {
          await diagnostics
            ?.append({
              type: 'error',
              provider: 'comfyui-chenyu',
              operation: 'img2img',
              itemKey: artifactId,
              error: errorForDiagnosticLog(error),
            })
            .catch(() => null)
          result.failed += batchSize
          result.failures.push({
            prompt: promptMode === 'workflow' ? '工作流默认提示词' : (input.prompt?.trim() ?? ''),
            error: appErrorMessage(error),
            sourcePath: artifactId,
          })
        } finally {
          emitImg2imgProgress(result, taskId, result.total, emit)
        }
      }

      return await finishGenerationResultWithDiagnostics(
        diagnostics,
        result,
        'comfyui-chenyu',
        'img2img',
      )
    } finally {
      db.close()
    }
  })
}

function currentComfyuiUrl(workbenchRoot: string, db: Pick<SqliteDatabase, 'prepare'>) {
  try {
    const row = db.prepare('SELECT comfyui_url FROM comfyui_instances WHERE id = 1').get() as
      | { comfyui_url?: string }
      | undefined
    if (row?.comfyui_url) {
      return row.comfyui_url
    }
  } catch {}

  throw new AppErrorClass('CHENYU_INSTANCE_DOWN', '请先到设置页选择默认云机并开机', false, {
    provider: 'comfyui-chenyu',
    workbenchRoot,
  })
}

function savedComfyuiUrlForInstance(db: Pick<SqliteDatabase, 'prepare'>, instanceUuid: string) {
  try {
    const row = db
      .prepare(
        `
          SELECT comfyui_url
          FROM comfyui_instances
          WHERE id = 1 AND instance_uuid = ?
        `,
      )
      .get(instanceUuid) as { comfyui_url?: string } | undefined
    return row?.comfyui_url?.trim() || null
  } catch {
    return null
  }
}

function readCurrentComfyuiInstanceRecord(
  db: Pick<SqliteDatabase, 'prepare'>,
): ComfyuiInstanceRecord | null {
  try {
    const row = db
      .prepare(
        `
          SELECT
            provider,
            instance_uuid AS instanceUuid,
            comfyui_url AS comfyuiUrl,
            pod_uuid AS podUuid,
            gpu_uuid AS gpuUuid,
            gpu_name AS gpuName,
            status,
            pod_price_hour AS podPriceHour,
            gpu_price_hour AS gpuPriceHour,
            auto_shutdown_at AS autoShutdownAt,
            created_at AS createdAt,
            last_used_at AS lastUsedAt
          FROM comfyui_instances
          WHERE id = 1
        `,
      )
      .get() as ComfyuiInstanceRecord | undefined
    return row?.status === 'running' ? row : null
  } catch {
    return null
  }
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
    images: result.images,
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
    images: result.images,
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
    images: result.images,
    ...(currentPrompt ? { current_prompt: currentPrompt } : {}),
  }
  emit(progress)
}

export function parseManualPrompts(text: string) {
  return parsePrompts(text, 200)
}

export function registerGenerationIpc() {
  ipcMain.handle('generation:generate-prompts', (_event, input: unknown) =>
    generateTxt2imgPrompts(
      parseGenerationIpcInput(generationPromptInputSchema, input, '生图提示词参数不正确'),
    ),
  )
  ipcMain.handle('generation:choose-image-folder', () => chooseGenerationImageFolder())
  ipcMain.handle('generation:scan-image-folder', (_event, input: unknown) =>
    scanGenerationImageFolder(
      parseGenerationIpcInput(scanGenerationImageFolderInputSchema, input, '图片文件夹参数不正确'),
    ),
  )
  ipcMain.handle('generation:list-extract-sources', () => listExtractSources())
  ipcMain.handle('generation:list-img2img-sources', () => listImg2imgSources())
  ipcMain.handle('generation:resolve-img2img-references', (_event, input: unknown) =>
    resolveImg2imgReferences(
      parseGenerationIpcInput(resolveImg2imgReferencesInputSchema, input, '图生图参考图参数不正确'),
    ),
  )
  ipcMain.handle('generation:list-comfyui-txt2img-workflows', () => listComfyuiTxt2imgWorkflows())
  ipcMain.handle('generation:list-comfyui-img2img-workflows', () => listComfyuiImg2imgWorkflows())
  ipcMain.handle('generation:list-comfyui-extract-workflows', () => listComfyuiExtractWorkflows())
  ipcMain.handle('generation:list-comfyui-matting-workflows', () => listComfyuiMattingWorkflows())
  ipcMain.handle('generation:list-comfyui-mixed-matting-workflows', () =>
    listComfyuiMixedMattingWorkflows(),
  )
  ipcMain.handle('generation:list-chenyu-workflows', (_event, input: unknown) =>
    listChenyuWorkflowMarket(
      parseGenerationIpcInput(
        chenyuWorkflowMarketListInputSchema,
        input,
        '晨羽工作流查询参数不正确',
      ) ?? {},
    ),
  )
  ipcMain.handle('generation:get-chenyu-workflow', (_event, input: unknown) =>
    getChenyuWorkflowInfo(
      parseGenerationIpcInput(chenyuWorkflowInfoInputSchema, input, '晨羽工作流详情参数不正确')
        .workflowId,
    ),
  )
  ipcMain.handle('generation:parse-manual-prompts', (_event, text: unknown) =>
    parseManualPrompts(
      parseGenerationIpcInput(manualPromptsTextInputSchema, text, '手动提示词文本参数不正确'),
    ),
  )
  ipcMain.handle('generation:run-txt2img', (_event, input: unknown) =>
    runTxt2img(parseGenerationIpcInput(txt2imgRunInputSchema, input, '文生图任务参数不正确')),
  )
  ipcMain.handle('generation:run-comfyui-txt2img', (_event, input: unknown) =>
    runComfyuiTxt2img(
      parseGenerationIpcInput(comfyuiTxt2imgRunInputSchema, input, 'ComfyUI 文生图任务参数不正确'),
    ),
  )
  ipcMain.handle('generation:run-extract', (_event, input: unknown) =>
    runExtract(parseGenerationIpcInput(extractRunInputSchema, input, '提取任务参数不正确')),
  )
  ipcMain.handle('generation:run-comfyui-extract', (_event, input: unknown) =>
    runComfyuiExtract(
      parseGenerationIpcInput(comfyuiExtractRunInputSchema, input, 'ComfyUI 提取任务参数不正确'),
    ),
  )
  ipcMain.handle('generation:run-comfyui-extract-matting', (_event, input: unknown) =>
    runComfyuiExtractMatting(
      parseGenerationIpcInput(
        comfyuiExtractMattingRunInputSchema,
        input,
        'ComfyUI 提取抠图任务参数不正确',
      ),
    ),
  )
  ipcMain.handle('generation:run-comfyui-matting', (_event, input: unknown) =>
    runComfyuiMatting(
      parseGenerationIpcInput(comfyuiMattingRunInputSchema, input, 'ComfyUI 抠图任务参数不正确'),
    ),
  )
  ipcMain.handle('generation:run-mixed-matting', (_event, input: unknown) =>
    runMixedMatting(
      parseGenerationIpcInput(mixedMattingRunInputSchema, input, '混合抠图任务参数不正确'),
    ),
  )
  ipcMain.handle('generation:run-comfyui-img2img', (_event, input: unknown) =>
    runComfyuiImg2img(
      parseGenerationIpcInput(comfyuiImg2imgRunInputSchema, input, 'ComfyUI 图生图任务参数不正确'),
    ),
  )
  ipcMain.handle('generation:run-chenyu-workflow', (_event, input: unknown) =>
    runChenyuWorkflow(
      parseGenerationIpcInput(chenyuWorkflowRunInputSchema, input, '晨羽工作流运行参数不正确'),
    ),
  )
  ipcMain.handle('generation:cancel', (_event, input: unknown) => ({
    ok: requestGenerationCancel(
      parseGenerationIpcInput(generationCancelInputSchema, input, '生图取消参数不正确').task_id,
    ),
  }))
}
