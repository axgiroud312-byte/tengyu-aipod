import { createHash, randomUUID } from 'node:crypto'
import { readFile, stat } from 'node:fs/promises'
import { extname, isAbsolute, join, relative } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { AppErrorClass, type GenerationCapability, type Skill } from '@tengyu-aipod/shared'
import { ipcMain } from 'electron'
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
import type { GenerationConcurrencyController } from './generation-concurrency'
import {
  getChenyuWorkflowInfo,
  listChenyuWorkflowMarket,
  runChenyuWorkflow,
} from './generation/capabilities/chenyu-workflow'
import {
  runComfyuiExtract,
  runComfyuiExtractBatch,
  runExtract,
  runExtractBatch,
} from './generation/capabilities/extract'
import { runComfyuiImg2img, runComfyuiImg2imgBatch } from './generation/capabilities/img2img'
import {
  runComfyuiExtractMatting,
  runComfyuiExtractMattingBatch,
  runComfyuiMatting,
  runComfyuiMattingBatch,
  runMixedMatting,
  runMixedMattingBatch,
} from './generation/capabilities/matting'
import {
  runComfyuiTxt2img,
  runComfyuiTxt2imgBatch,
  runTxt2img,
  runTxt2imgBatch,
} from './generation/capabilities/txt2img'
import {
  type GenerationDatabase,
  type GenerationServiceDependencies,
  appErrorMessage,
  createGenerationDebugLogger,
  generationTaskOutputFolder,
  openWorkbenchDatabase,
  promptGenerationErrorDetails,
  promptPreview,
  safeBaseName,
} from './generation/runtime'
import {
  chooseGenerationImageFolder,
  listExtractSources,
  listImg2imgSources,
  resolveImg2imgReferences,
  scanGenerationImageFolder,
} from './generation/sources'
import { requestGenerationTaskCancel } from './generation/task-registry'
import type {
  ChenyuWorkflowMarketListInput,
  ChenyuWorkflowRunInput,
  ComfyuiExtractRunInput,
  ComfyuiImg2imgRunInput,
  ComfyuiInstanceRunInput,
  ComfyuiTxt2imgRunInput,
  ExtractRunInput,
  GenerationProgress,
  GenerationPromptInput,
  GenerationRunResult,
  Txt2imgPromptDraft,
  Txt2imgRunInput,
} from './generation/types'
import { GRSAI_SUPPORTED_MODELS, type GenerateResponse, type GrsaiModel } from './grsai-adapter'
import {
  type PromptReferenceImage,
  parsePrompts,
  promptGeneratorService,
} from './prompt-generator-service'
import type { SqliteDatabase } from './sqlite'
import {
  assertTargetDoesNotExist,
  nextVisibleImageName,
  visibleImageNamingEnabled,
} from './user-visible-filename'
export {
  chooseGenerationImageFolder,
  listExtractSources,
  listImg2imgSources,
  resolveImg2imgReferences,
  scanGenerationImageFolder,
}
export {
  getActiveGenerationTaskCount,
  requestAllGenerationCancels,
} from './generation/task-registry'
export { getChenyuWorkflowInfo, listChenyuWorkflowMarket, runChenyuWorkflow }
export { runComfyuiExtract, runComfyuiExtractBatch, runExtract, runExtractBatch }
export { runComfyuiImg2img, runComfyuiImg2imgBatch }
export {
  runComfyuiExtractMatting,
  runComfyuiExtractMattingBatch,
  runComfyuiMatting,
  runComfyuiMattingBatch,
  runMixedMatting,
  runMixedMattingBatch,
}
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
