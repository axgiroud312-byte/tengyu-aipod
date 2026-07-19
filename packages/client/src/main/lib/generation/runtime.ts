import { createHash, randomUUID } from 'node:crypto'
import { readFile, stat } from 'node:fs/promises'
import { extname, isAbsolute, join, relative } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import {
  AppErrorClass,
  type GenerationCapability,
  type Skill,
  WORKBENCH_DIRECTORIES,
} from '@tengyu-aipod/shared'
import { BrowserWindow } from 'electron'
import { readAppConfig } from '../../onboarding'
import {
  ChenyuCloudClient,
  type ChenyuInstanceInfo,
  chenyuStatusName,
} from '../chenyu-cloud-client'
import type { ChenyuWorkflowRunner } from '../chenyu-workflow-runner'
import { ComfyHttpClient } from '../comfy-http-client'
import { ComfyuiChenyuAdapter } from '../comfyui-chenyu-adapter'
import {
  ComfyuiInstanceManager,
  type ComfyuiInstanceRecord,
  type ComfyuiInstanceSummary,
  comfyuiUrlCandidates,
} from '../comfyui-instance-manager'
import {
  type ComfyuiWorkflowCategory,
  comfyuiWorkflowCacheManager,
} from '../comfyui-workflow-cache'
import {
  type DiagnosticLogWriter,
  createOptionalDiagnosticLogWriter,
} from '../diagnostic-log-service'
import type { GenerationConcurrencyController } from '../generation-concurrency'
import {
  GRSAI_SUPPORTED_MODELS,
  type GenerateResponse,
  type GrsaiAdapter,
  type GrsaiModel,
} from '../grsai-adapter'
import type { getSecret } from '../keychain'
import type { PromptReferenceImage, promptGeneratorService } from '../prompt-generator-service'
import type { skillCacheManager } from '../skill-cache'
import type { SqliteDatabase } from '../sqlite'
import { type TempFileManager, tempFileManager } from '../temp-file-manager'
import { assertTargetDoesNotExist, nextVisibleImageName } from '../user-visible-filename'
import {
  openWorkbenchDatabase as openWorkbenchDatabaseFile,
  workbenchDatabasePath,
} from '../workbench-db'
import {
  beginGenerationTask,
  finishGenerationTask,
  markGenerationResultCancelled,
} from './task-registry'
import type {
  GenerationDebugLogDetails,
  GenerationDebugLogEntry,
  GenerationDebugLogLevel,
  GenerationImageCompletePayload,
  GenerationProgress,
  GenerationPromptResolvedPayload,
  GenerationRunResult,
  GenerationTaskEvent,
  Img2imgReferencePayload,
} from './types'

export type GenerationDatabase = Pick<SqliteDatabase, 'exec' | 'prepare' | 'close'>

export type GenerationDebugLogContext = {
  taskId?: string | undefined
  capability?: GenerationCapability | undefined
}

export type GenerationServiceDependencies = {
  readConfig?: typeof readAppConfig
  getSecret?: typeof getSecret
  openDatabase?: (workbenchRoot: string) => GenerationDatabase
  skillCache?: Pick<typeof skillCacheManager, 'getSkill' | 'listSkills'>
  workflowCache?: Pick<typeof comfyuiWorkflowCacheManager, 'listWorkflows' | 'get'>
  promptGenerator?: Pick<typeof promptGeneratorService, 'generatePrompts'>
  createGrsaiAdapter?: (apiKey: string) => Pick<GrsaiAdapter, 'generate'>
  createComfyuiAdapter?: (input: {
    apiKey: string
    workbenchRoot: string
    instance?: ComfyuiInstanceSummary
    diagnostics?: DiagnosticLogWriter
  }) => Pick<ComfyuiChenyuAdapter, 'generate'>
  getChenyuInstanceInfo?: (input: {
    apiKey: string
    instanceUuid: string
  }) => Promise<ChenyuInstanceInfo>
  createChenyuWorkflowRunner?: (input: {
    apiKey: string
    workbenchRoot: string
    diagnostics?: DiagnosticLogWriter
  }) => Pick<ChenyuWorkflowRunner, 'listWorkflows' | 'getWorkflowInfo' | 'runImageWorkflow'>
  downloadImage?: (url: string) => Promise<Buffer>
  emitProgress?: (progress: GenerationProgress) => void
  emitDebugLog?: (entry: GenerationDebugLogEntry) => void
  onImageComplete?: (image: GenerationImageCompletePayload) => void | Promise<void>
  onPromptResolved?: (payload: GenerationPromptResolvedPayload) => void | Promise<void>
  strictImageComplete?: boolean | undefined
  tempFiles?: Pick<TempFileManager, 'createTaskDir' | 'cleanupTask'>
}

export const GENERATION_CAPABILITY_FOLDERS = {
  txt2img: '文生图',
  img2img: '图生图',
  extract: '提取',
  matting: '抠图',
} satisfies Record<GenerationCapability, string>

const GENERATION_TASK_PREFIX: Record<GenerationCapability, string> = {
  txt2img: '文生图',
  img2img: '图生图',
  extract: '提取',
  matting: '抠图',
}

let generationDebugLogSequence = 0
const DEFAULT_GENERATION_MODEL: GrsaiModel = 'gpt-image-2'
const IMAGE_EXTENSIONS = /\.(?:jpe?g|png|webp)$/i

export function generationImageIdentity(
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

export function submitGenerationTask(taskId: string, run: () => Promise<GenerationRunResult>) {
  beginGenerationTask(taskId)
  void run()
    .then((result) => {
      emitCompleted({ ok: true, result: markGenerationResultCancelled(result) })
    })
    .catch((error) => {
      emitCompleted({ ok: false, taskId, error: appErrorMessage(error) })
    })
    .finally(() => {
      finishGenerationTask(taskId)
    })
}

export function clampInt(value: number, min: number, max: number, fallback: number) {
  if (!Number.isFinite(value)) {
    return fallback
  }
  return Math.max(min, Math.min(max, Math.floor(value)))
}

export function normalizeModel(model: string) {
  return GRSAI_SUPPORTED_MODELS.includes(model as GrsaiModel) ? model : DEFAULT_GENERATION_MODEL
}

export function comfyuiSizePx(input: { width?: number | undefined; height?: number | undefined }) {
  return {
    width: clampInt(input.width ?? 1024, 256, 4096, 1024),
    height: clampInt(input.height ?? 1024, 256, 4096, 1024),
  }
}

export function requestedComfyuiSourceCount(input: {
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

export function comfyuiImg2imgBatchSize(input: { batchSize?: number | undefined }) {
  return clampInt(input.batchSize ?? 1, 1, 8, 1)
}

export function comfyuiImg2imgPromptMode(input: {
  promptMode?: 'ai' | 'workflow' | 'manual' | undefined
  prompt?: string | undefined
}) {
  if (input.promptMode) {
    return input.promptMode
  }
  return input.prompt?.trim() ? 'manual' : 'workflow'
}

export function promptGeneratorDependencies(dependencies: GenerationServiceDependencies) {
  return {
    ...(dependencies.skillCache ? { skillCache: dependencies.skillCache } : {}),
    ...(dependencies.getSecret ? { getSecret: dependencies.getSecret } : {}),
    ...(dependencies.readConfig ? { readConfig: dependencies.readConfig } : {}),
  }
}

export function promptSkillCategory(
  capability: Extract<GenerationCapability, 'txt2img' | 'img2img' | 'extract'>,
  printMode: 'local' | 'full' = 'local',
) {
  if (capability === 'txt2img') {
    return printMode === 'full' ? 'txt2img-full-print' : 'txt2img-local-print'
  }
  return printMode === 'full' ? 'img2img-full-reference' : 'img2img-local-reference'
}

export class ComfyuiInstanceLockManager {
  private readonly locks = new Map<string, string>()

  async run<T>(
    input: { instanceUuid?: string | undefined },
    taskId: string,
    operation: () => Promise<T>,
  ) {
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

function comfyuiInstanceLockKey(input: { instanceUuid?: string | undefined }) {
  return input.instanceUuid?.trim() || 'default'
}

async function selectedComfyuiInstance(
  input: { instanceUuid?: string | undefined },
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

export async function createComfyuiAdapterForRun(
  input: { instanceUuid?: string | undefined },
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

export function observeGenerationError(
  controller: Pick<GenerationConcurrencyController, 'onResponse'>,
  error: unknown,
) {
  if (error instanceof AppErrorClass && error.code === 'HTTP_429') {
    controller.onResponse(429)
  }
}

export function openWorkbenchDatabase(workbenchRoot: string) {
  return openWorkbenchDatabaseFile(workbenchDatabasePath(workbenchRoot))
}

export function createGenerationDiagnostics(
  workbenchRoot: string,
  taskId: string,
  meta: Record<string, unknown>,
) {
  return createOptionalDiagnosticLogWriter({
    module: 'generation',
    taskId,
    workbenchRoot,
    meta,
  })
}

export async function finishGenerationResultWithDiagnostics(
  diagnostics: DiagnosticLogWriter | null,
  result: GenerationRunResult,
  provider: string,
  operation: string,
) {
  const finalResult = markGenerationResultCancelled(result)
  await diagnostics
    ?.append({
      type: 'task_completed',
      provider,
      operation,
      data: {
        total: finalResult.total,
        succeeded: finalResult.succeeded,
        failed: finalResult.failed,
        cancelled: finalResult.cancelled ?? false,
      },
    })
    .catch(() => null)
  return finalResult
}

export async function readWorkbenchRoot(readConfig: typeof readAppConfig = readAppConfig) {
  const workbenchConfig = await readConfig()
  if (!workbenchConfig.workbench_root) {
    throw new AppErrorClass('HTTP_4XX', '请先在设置里选择工作区', false)
  }
  return workbenchConfig.workbench_root
}

export async function assertLocalComfyuiWorkflowExists(
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

export function safeBaseName(value: string) {
  const safe = (value || 'print').replace(/[\\/:*?"<>|]/g, '_').trim()
  return safe || 'print'
}

export function timestampSlug(value = Date.now()) {
  const date = new Date(value)
  const pad = (input: number, length = 2) => String(input).padStart(length, '0')
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`
}

export function generationTaskId(
  inputTaskId: string | undefined,
  capability: GenerationCapability,
) {
  const custom = inputTaskId?.trim()
  return safeBaseName(custom || `${GENERATION_TASK_PREFIX[capability]}-${timestampSlug()}`)
}

export function generationTaskOutputFolder(
  workbenchRoot: string,
  capability: GenerationCapability,
  taskId: string,
) {
  return join(
    workbenchRoot,
    WORKBENCH_DIRECTORIES.generation,
    GENERATION_CAPABILITY_FOLDERS[capability],
    safeBaseName(taskId),
  )
}

export function generationOutputTaskName(
  input: { outputTaskName?: string | undefined },
  taskId: string,
) {
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

export async function generationTargetPath(
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

export function comfyuiRunOptions(
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

export function fileUrl(path: string) {
  return pathToFileURL(path).toString()
}

async function hashFile(path: string) {
  const buffer = await readFile(path)
  return createHash('sha256').update(buffer).digest('hex')
}

export async function imageIdentity(imagePath: string) {
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

export async function imageReference(imagePath: string): Promise<PromptReferenceImage> {
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

export function newPrintId() {
  return `pri_${randomUUID().replace(/-/g, '').slice(0, 12)}`
}

export function assertInsideFolder(path: string, folder: string) {
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

export function assertNotInsideFolder(path: string, folder: string) {
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

export function registerSourceArtifact(
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

export async function registerManualPrintSourceArtifacts(
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

export async function comfyuiSourceArtifactIds(
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

export async function readReferenceForArtifact(
  db: Pick<SqliteDatabase, 'prepare'>,
  workbenchRoot: string,
  artifactId: string,
): Promise<Img2imgReferencePayload> {
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

export async function registerExtractArtifact(
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

export async function registerGeneratedArtifact(
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

export async function defaultDownloadImage(url: string) {
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

export function generatedImageExtension(image: { url: string; local_path?: string }) {
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

export function appErrorMessage(error: unknown) {
  if (error instanceof AppErrorClass) {
    return error.message
  }
  if (error instanceof Error) {
    return error.message
  }
  return String(error)
}

export function promptGenerationErrorDetails(error: unknown): GenerationDebugLogDetails {
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

export function emitProgress(progress: GenerationProgress) {
  for (const window of BrowserWindow.getAllWindows()) {
    window.webContents.send('generation:progress', progress)
  }
}

export function emitCompleted(event: GenerationTaskEvent) {
  for (const window of BrowserWindow.getAllWindows()) {
    window.webContents.send('generation:completed', event)
  }
  if (event.ok) {
    createGenerationDebugLogger(
      {},
      { taskId: event.result.taskId, capability: capabilityFromResult(event.result) },
    )('任务完成', event.result.failed > 0 ? 'warn' : 'info', {
      operation: 'completed',
      total: event.result.total,
      succeeded: event.result.succeeded,
      failed: event.result.failed,
      savedPath: event.result.images[0]?.localPath ?? null,
    })
    return
  }
  createGenerationDebugLogger({}, { taskId: event.taskId })('任务失败', 'error', {
    operation: 'completed',
    error: event.error,
  })
}

export function emitGenerationDebugLog(entry: GenerationDebugLogEntry) {
  for (const window of BrowserWindow.getAllWindows()) {
    window.webContents.send('generation:debug-log', entry)
  }
}

export function createGenerationDebugLogger(
  dependencies: Pick<GenerationServiceDependencies, 'emitDebugLog'> = {},
  baseContext: GenerationDebugLogContext = {},
) {
  const emit = dependencies.emitDebugLog ?? emitGenerationDebugLog
  return (
    message: string,
    level: GenerationDebugLogLevel = 'info',
    details?: GenerationDebugLogDetails,
    context: GenerationDebugLogContext = {},
  ) => {
    const nextContext = { ...baseContext, ...context }
    emit({
      id: `${Date.now()}-${++generationDebugLogSequence}`,
      timestamp: Date.now(),
      level,
      message,
      ...(nextContext.taskId ? { taskId: nextContext.taskId } : {}),
      ...(nextContext.capability ? { capability: nextContext.capability } : {}),
      ...(details ? { details: compactGenerationDebugDetails(details) } : {}),
    })
  }
}

export function createGenerationProgressEmitter(
  dependencies: Pick<GenerationServiceDependencies, 'emitProgress' | 'emitDebugLog'>,
) {
  const emit = dependencies.emitProgress ?? emitProgress
  const debug = createGenerationDebugLogger(dependencies)
  return (progress: GenerationProgress) => {
    emit(progress)
    debug(
      generationProgressMessage(progress),
      'debug',
      {
        operation: 'progress',
        processed: progress.processed,
        total: progress.total,
        succeeded: progress.succeeded,
        failed: progress.failed,
        prompt: progress.current_prompt ? promptPreview(progress.current_prompt) : undefined,
      },
      { taskId: progress.task_id, capability: progress.capability },
    )
  }
}

export async function emitImageComplete(
  dependencies: Pick<
    GenerationServiceDependencies,
    'onImageComplete' | 'emitDebugLog' | 'strictImageComplete'
  >,
  payload: GenerationImageCompletePayload,
) {
  if (!dependencies.onImageComplete) {
    return
  }
  try {
    await dependencies.onImageComplete(payload)
  } catch (error) {
    createGenerationDebugLogger(dependencies, {
      taskId: payload.taskId,
      capability: payload.capability,
    })('逐张完成回调失败', 'warn', {
      operation: 'onImageComplete',
      error: appErrorMessage(error),
      printId: payload.printId,
      artifactId: payload.artifactId ?? null,
      path: payload.path,
    })
    if (dependencies.strictImageComplete) {
      throw new AppErrorClass(
        error instanceof AppErrorClass ? error.code : 'HTTP_5XX',
        appErrorMessage(error),
        error instanceof AppErrorClass ? error.retryable : true,
        {
          ...(error instanceof AppErrorClass ? error.details : {}),
          kind: 'generation_callback_fatal',
        },
        error,
      )
    }
  }
}

export async function emitPromptResolved(
  dependencies: Pick<GenerationServiceDependencies, 'onPromptResolved' | 'emitDebugLog'>,
  payload: GenerationPromptResolvedPayload,
) {
  if (!dependencies.onPromptResolved) {
    return
  }
  try {
    await dependencies.onPromptResolved(payload)
  } catch (error) {
    createGenerationDebugLogger(dependencies, {
      taskId: payload.taskId,
      capability: payload.capability,
    })('提示词持久化回调失败', 'error', {
      operation: 'onPromptResolved',
      error: appErrorMessage(error),
      sourceIndex: payload.inputIndex,
      sourceImage: payload.sourcePath,
      artifactId: payload.sourceArtifactId,
    })
    throw new AppErrorClass(
      error instanceof AppErrorClass ? error.code : 'HTTP_5XX',
      appErrorMessage(error),
      error instanceof AppErrorClass ? error.retryable : true,
      {
        ...(error instanceof AppErrorClass ? error.details : {}),
        kind: 'generation_callback_fatal',
      },
      error,
    )
  }
}

export function localPathFromGeneratedImage(image: { local_path?: string; url: string }) {
  if (image.local_path?.trim()) {
    return image.local_path
  }
  if (image.url.startsWith('file://')) {
    return fileURLToPath(image.url)
  }
  throw new AppErrorClass('HTTP_5XX', '生成结果缺少本地路径', true)
}

export function generationProgressMessage(progress: GenerationProgress) {
  if (progress.total > 0 && progress.processed >= progress.total) {
    return progress.failed > 0 ? '任务处理完成，有失败项' : '任务处理完成'
  }
  if (progress.current_prompt) {
    return '正在处理提示词'
  }
  if (progress.processed === 0) {
    return '任务开始处理'
  }
  return '任务进度更新'
}

export function capabilityFromResult(
  result: GenerationRunResult,
): GenerationCapability | undefined {
  const image = result.images[0]
  const capability = image?.localPath
    ? (Object.entries(GENERATION_CAPABILITY_FOLDERS).find(([, folder]) =>
        image.localPath?.includes(folder),
      )?.[0] as GenerationCapability | undefined)
    : undefined
  return capability
}

export function compactGenerationDebugDetails(details: GenerationDebugLogDetails) {
  return Object.fromEntries(
    Object.entries(details).filter((entry): entry is [string, string | number | boolean | null] => {
      return entry[1] !== undefined
    }),
  )
}

export function promptPreview(prompt: string, maxLength = 120) {
  const normalized = prompt.replace(/\s+/g, ' ').trim()
  if (normalized.length <= maxLength) {
    return normalized
  }
  return `${normalized.slice(0, maxLength)}...`
}

export function workflowLogDetails(input: {
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

export function emitComfyuiRequestLog(
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

export function emitTxt2imgProgress(
  result: GenerationRunResult,
  taskId: string,
  total: number,
  emit: (progress: GenerationProgress) => void,
  currentPrompt?: string,
) {
  emit({
    task_id: taskId,
    capability: 'txt2img',
    processed: result.succeeded + result.failed,
    total,
    succeeded: result.succeeded,
    failed: result.failed,
    images: result.images,
    ...(currentPrompt ? { current_prompt: currentPrompt } : {}),
  })
}

export function emitImg2imgProgress(
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

export function emitExtractProgress(
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

export { tempFileManager }
