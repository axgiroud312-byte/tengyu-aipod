import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { basename, extname, isAbsolute, join, relative } from 'node:path'
import { pathToFileURL } from 'node:url'
import {
  AppErrorClass,
  type GenerationCapability,
  type Skill,
  WORKBENCH_DIRECTORIES,
} from '@tengyu-aipod/shared'
import { BrowserWindow, dialog, ipcMain } from 'electron'
import { z } from 'zod'
import { readAppConfig } from '../onboarding'
import {
  ChenyuCloudClient,
  type ChenyuInstanceInfo,
  type ChenyuWorkflowMarketParams,
  chenyuStatusName,
} from './chenyu-cloud-client'
import {
  type ChenyuRunImageWorkflowInput,
  type ChenyuRunImageWorkflowResult,
  ChenyuWorkflowRunner,
} from './chenyu-workflow-runner'
import { ComfyHttpClient } from './comfy-http-client'
import { ComfyuiChenyuAdapter } from './comfyui-chenyu-adapter'
import {
  ComfyuiInstanceManager,
  type ComfyuiInstanceSummary,
  comfyuiUrlCandidates,
} from './comfyui-instance-manager'
import { type ComfyuiWorkflowSummary, comfyuiWorkflowCacheManager } from './comfyui-workflow-cache'
import {
  type DiagnosticLogWriter,
  createOptionalDiagnosticLogWriter,
  errorForDiagnosticLog,
} from './diagnostic-log-service'
import { GenerationConcurrencyController } from './generation-concurrency'
import { normalizeGenerationLocalConfig } from './generation-local-config'
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
import { type SqliteDatabase, openSqliteDatabase } from './sqlite'
import { type TempFileManager, tempFileManager } from './temp-file-manager'
import {
  assertTargetDoesNotExist,
  nextVisibleImageName,
  visibleImageNamingEnabled,
} from './user-visible-filename'

export type Txt2imgPromptDraft = {
  id: string
  text: string
  selected: boolean
}

export type GenerationPromptInput = {
  capability?: Extract<GenerationCapability, 'txt2img' | 'img2img' | 'extract'> | undefined
  skillId?: string | undefined
  skillVersion?: string | undefined
  printMode?: 'local' | 'full' | undefined
  requirement: string
  count: number
  model?: string | undefined
  modeInstruction?: string | undefined
  referenceImages?: Array<{ base64: string; mime_type: string }> | undefined
}

export type Txt2imgRunInput = {
  capability?: 'txt2img' | 'img2img' | undefined
  prompts: string[]
  model: string
  aspectRatio: string
  imageSize?: '1K' | '2K' | '4K' | undefined
  referenceImages?: Array<{ base64: string; mime_type: string }> | undefined
  concurrency: number
  taskId?: string | undefined
  filenamePrefix?: string | undefined
  filenameSeparator?: string | undefined
}

export type ComfyuiInstanceRunInput = {
  instanceUuid?: string | undefined
}

export type ComfyuiTxt2imgRunInput = ComfyuiInstanceRunInput & {
  prompts: string[]
  workflowId: string
  workflowName?: string | undefined
  workflowVersion?: string | undefined
  width?: number | undefined
  height?: number | undefined
  concurrency?: number | undefined
  taskId?: string | undefined
  filenamePrefix?: string | undefined
  filenameSeparator?: string | undefined
}

export type GenerationProgress = {
  task_id: string
  capability: GenerationCapability
  processed: number
  total: number
  succeeded: number
  failed: number
  current_prompt?: string | undefined
  images?: GenerationRunImage[] | undefined
  status?: 'running' | 'cancelled' | undefined
}

export type GenerationRunImage = {
  prompt: string
  url: string
  localPath?: string | undefined
  sourcePath?: string | undefined
  artifactId?: string | undefined
  printId?: string | undefined
}

export type GenerationRunResult = {
  taskId: string
  total: number
  succeeded: number
  failed: number
  images: GenerationRunImage[]
  failures: Array<{ prompt: string; error: string; sourcePath?: string }>
  cancelled?: boolean | undefined
  diagnosticsLogPath?: string | undefined
}

export type GenerationTaskEvent =
  | { ok: true; result: GenerationRunResult }
  | { ok: false; taskId: string; error: string }

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

export type GenerationDebugLogLevel = 'debug' | 'info' | 'warn' | 'error'

export type GenerationDebugLogEntry = {
  id: string
  timestamp: number
  level: GenerationDebugLogLevel
  message: string
  taskId?: string
  capability?: GenerationCapability
  details?: GenerationDebugLogDetails
}

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

export type ChooseGenerationImageFolderResult =
  | { ok: true; data: { path: string } }
  | { ok: false; error: { code: string; message: string } }

export type ExtractRunInput = {
  sourceImagePaths: string[]
  skillId: string
  skillVersion?: string | undefined
  variables?: Record<string, unknown> | undefined
  model: string
  aspectRatio: string
  imageSize?: '1K' | '2K' | '4K' | undefined
  concurrency: number
  taskId?: string | undefined
  filenamePrefix?: string | undefined
  filenameSeparator?: string | undefined
}

export type ComfyuiImg2imgRunInput = ComfyuiInstanceRunInput & {
  sourceArtifactIds?: string[] | undefined
  sourceImagePaths?: string[] | undefined
  workflowId: string
  workflowName?: string | undefined
  workflowVersion?: string | undefined
  prompt?: string | undefined
  width?: number | undefined
  height?: number | undefined
  batchSize?: number | undefined
  taskId?: string | undefined
  filenamePrefix?: string | undefined
  filenameSeparator?: string | undefined
}

export type ComfyuiExtractRunInput = ComfyuiInstanceRunInput & {
  sourceImagePaths: string[]
  workflowId: string
  workflowName?: string | undefined
  workflowVersion?: string | undefined
  skillId?: string | undefined
  skillVersion?: string | undefined
  prompt?: string | undefined
  width?: number | undefined
  height?: number | undefined
  taskId?: string | undefined
  filenamePrefix?: string | undefined
  filenameSeparator?: string | undefined
}

export type ComfyuiMattingRunInput = ComfyuiInstanceRunInput & {
  sourceArtifactIds?: string[] | undefined
  sourceImagePaths?: string[] | undefined
  workflowId: string
  workflowName?: string | undefined
  workflowVersion?: string | undefined
  prompt?: string | undefined
  width?: number | undefined
  height?: number | undefined
  taskId?: string | undefined
  filenamePrefix?: string | undefined
  filenameSeparator?: string | undefined
}

export type MixedMattingRunInput = Omit<ComfyuiMattingRunInput, 'workflowId'> & {
  workflowId: string
  maskSkillId?: string | undefined
  maskSkillVersion?: string | undefined
  maskModel?: string | undefined
}

export type ComfyuiExtractMattingRunInput = ComfyuiInstanceRunInput & {
  sourceImagePaths: string[]
  extractWorkflowId: string
  extractWorkflowName?: string | undefined
  extractWorkflowVersion?: string | undefined
  mattingWorkflowId: string
  mattingWorkflowName?: string | undefined
  mattingWorkflowVersion?: string | undefined
  skillId?: string | undefined
  skillVersion?: string | undefined
  prompt?: string | undefined
  width?: number | undefined
  height?: number | undefined
  taskId?: string | undefined
  filenamePrefix?: string | undefined
  filenameSeparator?: string | undefined
}

export type ChenyuWorkflowMarketListInput = {
  keyword?: string | undefined
  tag?: string | undefined
  sort?: string | undefined
  page?: number | undefined
  page_size?: number | undefined
}

export type ChenyuWorkflowRunInput = {
  capability: GenerationCapability
  workflowId: string
  revisionId?: string | undefined
  inputs?: Record<string, unknown> | undefined
  prompt?: string | undefined
  acceptExternalCostRisk?: boolean | undefined
  taskId?: string | undefined
}

function chenyuWorkflowMarketParams(
  input: ChenyuWorkflowMarketListInput,
): ChenyuWorkflowMarketParams {
  return {
    ...(input.keyword !== undefined ? { keyword: input.keyword } : {}),
    ...(input.tag !== undefined ? { tag: input.tag } : {}),
    ...(input.sort !== undefined ? { sort: input.sort } : {}),
    ...(input.page !== undefined ? { page: input.page } : {}),
    ...(input.page_size !== undefined ? { page_size: input.page_size } : {}),
  }
}

type GenerationDatabase = Pick<SqliteDatabase, 'exec' | 'prepare' | 'close'>
export type GenerationDebugLogDetails = Record<string, string | number | boolean | null | undefined>
type GenerationDebugLogContext = {
  taskId?: string | undefined
  capability?: GenerationCapability | undefined
}
type Img2imgReference = {
  artifactId: string
  printId: string
  imagePath: string
  reference: PromptReferenceImage
}

export type Img2imgReferencePayload = Img2imgReference

type GenerationServiceDependencies = {
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
  tempFiles?: Pick<TempFileManager, 'createTaskDir' | 'cleanupTask'>
}

const DEFAULT_GENERATION_MODEL: GrsaiModel = 'gpt-image-2'
const IMAGE_EXTENSIONS = /\.(?:jpe?g|png|webp)$/i
const GENERATION_CAPABILITY_FOLDERS = {
  txt2img: '文生图',
  img2img: '图生图',
  extract: '提取',
  matting: '抠图',
} satisfies Record<GenerationCapability, string>
let generationDebugLogSequence = 0
const activeGenerationTasks = new Set<string>()
const cancelledGenerationTasks = new Set<string>()

const generationCapabilitySchema = z.enum(['txt2img', 'img2img', 'extract', 'matting'])
const promptCapabilitySchema = z.enum(['txt2img', 'img2img', 'extract'])
const txt2imgCapabilitySchema = z.enum(['txt2img', 'img2img'])
const imageSizeSchema = z.enum(['1K', '2K', '4K'])
const referenceImageSchema = z.object({
  base64: z.string().min(1),
  mime_type: z.string().min(1),
})
const stringArraySchema = z.array(z.string())
const optionalStringSchema = z.string().optional()
const positiveNumberSchema = z.number().positive().optional()
const comfyuiImg2imgBatchSizeSchema = z.number().int().min(1).max(8).optional()

const generationPromptInputSchema = z.object({
  capability: promptCapabilitySchema.optional(),
  skillId: optionalStringSchema,
  skillVersion: optionalStringSchema,
  printMode: z.enum(['local', 'full']).optional(),
  requirement: z.string(),
  count: z.number(),
  model: optionalStringSchema,
  modeInstruction: optionalStringSchema,
  referenceImages: z.array(referenceImageSchema).optional(),
})

const txt2imgRunInputSchema = z.object({
  capability: txt2imgCapabilitySchema.optional(),
  prompts: stringArraySchema,
  model: z.string(),
  aspectRatio: z.string(),
  imageSize: imageSizeSchema.optional(),
  referenceImages: z.array(referenceImageSchema).optional(),
  concurrency: z.number(),
  taskId: optionalStringSchema,
  filenamePrefix: optionalStringSchema,
  filenameSeparator: optionalStringSchema,
})

const comfyuiInstanceRunInputSchema = z.object({
  instanceUuid: optionalStringSchema,
})

const comfyuiTxt2imgRunInputSchema = comfyuiInstanceRunInputSchema.extend({
  prompts: stringArraySchema,
  workflowId: z.string(),
  workflowName: optionalStringSchema,
  workflowVersion: optionalStringSchema,
  width: positiveNumberSchema,
  height: positiveNumberSchema,
  concurrency: positiveNumberSchema,
  taskId: optionalStringSchema,
  filenamePrefix: optionalStringSchema,
  filenameSeparator: optionalStringSchema,
})

const extractRunInputSchema = z.object({
  sourceImagePaths: stringArraySchema,
  skillId: z.string(),
  skillVersion: optionalStringSchema,
  variables: z.record(z.unknown()).optional(),
  model: z.string(),
  aspectRatio: z.string(),
  imageSize: imageSizeSchema.optional(),
  concurrency: z.number(),
  taskId: optionalStringSchema,
  filenamePrefix: optionalStringSchema,
  filenameSeparator: optionalStringSchema,
})

const comfyuiSourceInputSchema = comfyuiInstanceRunInputSchema.extend({
  sourceArtifactIds: stringArraySchema.optional(),
  sourceImagePaths: stringArraySchema.optional(),
  workflowId: z.string(),
  workflowName: optionalStringSchema,
  workflowVersion: optionalStringSchema,
  prompt: optionalStringSchema,
  width: positiveNumberSchema,
  height: positiveNumberSchema,
  batchSize: comfyuiImg2imgBatchSizeSchema,
  taskId: optionalStringSchema,
  filenamePrefix: optionalStringSchema,
  filenameSeparator: optionalStringSchema,
})

const comfyuiExtractRunInputSchema = comfyuiInstanceRunInputSchema.extend({
  sourceImagePaths: stringArraySchema,
  workflowId: z.string(),
  workflowName: optionalStringSchema,
  workflowVersion: optionalStringSchema,
  skillId: optionalStringSchema,
  skillVersion: optionalStringSchema,
  prompt: optionalStringSchema,
  width: positiveNumberSchema,
  height: positiveNumberSchema,
  taskId: optionalStringSchema,
  filenamePrefix: optionalStringSchema,
  filenameSeparator: optionalStringSchema,
})

const comfyuiExtractMattingRunInputSchema = comfyuiInstanceRunInputSchema.extend({
  sourceImagePaths: stringArraySchema,
  extractWorkflowId: z.string(),
  extractWorkflowName: optionalStringSchema,
  extractWorkflowVersion: optionalStringSchema,
  mattingWorkflowId: z.string(),
  mattingWorkflowName: optionalStringSchema,
  mattingWorkflowVersion: optionalStringSchema,
  skillId: optionalStringSchema,
  skillVersion: optionalStringSchema,
  prompt: optionalStringSchema,
  width: positiveNumberSchema,
  height: positiveNumberSchema,
  taskId: optionalStringSchema,
  filenamePrefix: optionalStringSchema,
  filenameSeparator: optionalStringSchema,
})

const mixedMattingRunInputSchema = comfyuiSourceInputSchema.extend({
  maskSkillId: optionalStringSchema,
  maskSkillVersion: optionalStringSchema,
  maskModel: optionalStringSchema,
})

const chenyuWorkflowMarketListInputSchema = z
  .object({
    keyword: optionalStringSchema,
    tag: optionalStringSchema,
    sort: optionalStringSchema,
    page: z.number().optional(),
    page_size: z.number().optional(),
  })
  .optional()

const chenyuWorkflowRunInputSchema = z.object({
  capability: generationCapabilitySchema,
  workflowId: z.string(),
  revisionId: optionalStringSchema,
  inputs: z.record(z.unknown()).optional(),
  prompt: optionalStringSchema,
  acceptExternalCostRisk: z.boolean().optional(),
  taskId: optionalStringSchema,
})

const scanGenerationImageFolderInputSchema = z.object({ folder: z.string() })
const resolveImg2imgReferencesInputSchema = z.object({ artifactIds: stringArraySchema })
const chenyuWorkflowInfoInputSchema = z.object({ workflowId: z.string() })
const generationCancelInputSchema = z.object({ task_id: z.string() })

function parseGenerationIpcInput<T>(schema: z.ZodType<T>, input: unknown, message: string): T {
  const parsed = schema.safeParse(input)
  if (!parsed.success) {
    throw new AppErrorClass('INVALID_INPUT', message, false, {
      issues: parsed.error.issues,
    })
  }
  return parsed.data
}

export function requestGenerationCancel(taskId: string) {
  if (!activeGenerationTasks.has(taskId)) {
    return false
  }
  cancelledGenerationTasks.add(taskId)
  createGenerationDebugLogger({}, { taskId })('任务已请求取消', 'warn', {
    operation: 'cancel',
  })
  return true
}

function beginGenerationTask(taskId: string) {
  activeGenerationTasks.add(taskId)
  cancelledGenerationTasks.delete(taskId)
}

function finishGenerationTask(taskId: string) {
  activeGenerationTasks.delete(taskId)
  cancelledGenerationTasks.delete(taskId)
}

function isGenerationCancelled(taskId: string) {
  return cancelledGenerationTasks.has(taskId)
}

function markGenerationResultCancelled(result: GenerationRunResult) {
  if (isGenerationCancelled(result.taskId)) {
    result.cancelled = true
  }
  return result
}

function submitGenerationTask(taskId: string, run: () => Promise<GenerationRunResult>) {
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

  const comfyuiUrl = comfyuiUrlCandidates(info.server_map, info.server_url)[0]?.url
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
  const instance = await selectedComfyuiInstance(input, apiKey, dependencies)
  return (
    dependencies.createComfyuiAdapter?.({
      apiKey,
      workbenchRoot,
      ...(instance ? { instance } : {}),
      ...(diagnostics ? { diagnostics } : {}),
    }) ??
    new ComfyuiChenyuAdapter({
      ...(instance ? { selectedInstance: instance } : {}),
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

function workbenchDbPath(workbenchRoot: string) {
  return join(workbenchRoot, WORKBENCH_DIRECTORIES.metadata, 'workbench.db')
}

function openWorkbenchDatabase(workbenchRoot: string) {
  return openSqliteDatabase(workbenchDbPath(workbenchRoot))
}

function createGenerationDiagnostics(
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

async function finishGenerationResultWithDiagnostics(
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

function ensureGenerationTables(db: Pick<SqliteDatabase, 'exec'>) {
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
    throw new AppErrorClass('HTTP_4XX', '请先在设置里选择工作区', false)
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

function safeBaseName(value: string) {
  const safe = (value || 'print').replace(/[\\/:*?"<>|]/g, '_').trim()
  return safe || 'print'
}

function newPrintId() {
  return `pri_${randomUUID().replace(/-/g, '').slice(0, 12)}`
}

function timestampSlug(value = Date.now()) {
  const date = new Date(value)
  const pad = (input: number, length = 2) => String(input).padStart(length, '0')
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`
}

const GENERATION_TASK_PREFIX: Record<GenerationCapability, string> = {
  txt2img: '文生图',
  img2img: '图生图',
  extract: '提取',
  matting: '抠图',
}

function generationTaskId(inputTaskId: string | undefined, capability: GenerationCapability) {
  const custom = inputTaskId?.trim()
  return safeBaseName(custom || `${GENERATION_TASK_PREFIX[capability]}-${timestampSlug()}`)
}

function extractMattingTaskId(inputTaskId: string | undefined) {
  const custom = inputTaskId?.trim()
  return safeBaseName(custom || `提取后抠图-${timestampSlug()}`)
}

function generationTaskOutputFolder(
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

function appErrorMessage(error: unknown) {
  if (error instanceof AppErrorClass) {
    return error.message
  }
  if (error instanceof Error) {
    return error.message
  }
  return String(error)
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

function emitProgress(progress: GenerationProgress) {
  for (const window of BrowserWindow.getAllWindows()) {
    window.webContents.send('generation:progress', progress)
  }
}

function emitCompleted(event: GenerationTaskEvent) {
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

function emitGenerationDebugLog(entry: GenerationDebugLogEntry) {
  for (const window of BrowserWindow.getAllWindows()) {
    window.webContents.send('generation:debug-log', entry)
  }
}

function createGenerationDebugLogger(
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

function createGenerationProgressEmitter(
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

function generationProgressMessage(progress: GenerationProgress) {
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

function capabilityFromResult(result: GenerationRunResult): GenerationCapability | undefined {
  const image = result.images[0]
  const capability = image?.localPath
    ? (Object.entries(GENERATION_CAPABILITY_FOLDERS).find(([, folder]) =>
        image.localPath?.includes(folder),
      )?.[0] as GenerationCapability | undefined)
    : undefined
  return capability
}

function compactGenerationDebugDetails(details: GenerationDebugLogDetails) {
  return Object.fromEntries(
    Object.entries(details).filter((entry): entry is [string, string | number | boolean | null] => {
      return entry[1] !== undefined
    }),
  )
}

function promptPreview(prompt: string, maxLength = 120) {
  const normalized = prompt.replace(/\s+/g, ' ').trim()
  if (normalized.length <= maxLength) {
    return normalized
  }
  return `${normalized.slice(0, maxLength)}...`
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
  })
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
    ensureGenerationTables(db)
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

export async function runTxt2img(input: Txt2imgRunInput) {
  const prompts = input.prompts.map((prompt) => prompt.trim()).filter(Boolean)
  if (prompts.length === 0) {
    throw new AppErrorClass('HTTP_4XX', '请先准备至少一条提示词', false)
  }

  const apiKey = await getSecret('grsai')
  if (!apiKey) {
    throw new AppErrorClass('HTTP_4XX', '缺少 Grsai API Key', false, { provider: 'grsai' })
  }

  const taskId = generationTaskId(input.taskId, input.capability ?? 'txt2img')
  createGenerationDebugLogger({}, { taskId, capability: input.capability ?? 'txt2img' })(
    '任务已提交',
    'info',
    {
      operation: 'submit',
      provider: 'grsai',
      total: prompts.length,
      model: input.model,
      aspectRatio: input.aspectRatio,
      concurrency: input.concurrency,
      referenceImageCount: input.referenceImages?.length ?? 0,
    },
  )
  submitGenerationTask(taskId, () => runTxt2imgTask(taskId, prompts, input, apiKey))
  return taskId
}

export async function runTxt2imgBatch(
  input: Txt2imgRunInput,
  dependencies: GenerationServiceDependencies = {},
) {
  const prompts = input.prompts.map((prompt) => prompt.trim()).filter(Boolean)
  if (prompts.length === 0) {
    throw new AppErrorClass('HTTP_4XX', '请先准备至少一条提示词', false)
  }

  const apiKey = await (dependencies.getSecret ?? getSecret)('grsai')
  if (!apiKey) {
    throw new AppErrorClass('HTTP_4XX', '缺少 Grsai API Key', false, { provider: 'grsai' })
  }

  return runTxt2imgTask(
    generationTaskId(input.taskId, input.capability ?? 'txt2img'),
    prompts,
    input,
    apiKey,
    dependencies,
  )
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
    ...workflowLogDetails(input),
    width: input.width ?? 1024,
    height: input.height ?? 1024,
  })
  submitGenerationTask(taskId, () =>
    runComfyuiImg2imgBatch(
      { ...input, taskId },
      {
        ...dependencies,
        getSecret: async () => apiKey,
      },
    ),
  )
  return taskId
}

export async function runComfyuiTxt2img(
  input: ComfyuiTxt2imgRunInput,
  dependencies: GenerationServiceDependencies = {},
) {
  const prompts = input.prompts.map((prompt) => prompt.trim()).filter(Boolean)
  if (prompts.length === 0) {
    throw new AppErrorClass('HTTP_4XX', '请先准备至少一条提示词', false)
  }
  if (!input.workflowId.trim()) {
    throw new AppErrorClass('HTTP_4XX', '请选择 ComfyUI 文生图工作流', false)
  }

  const apiKey = await (dependencies.getSecret ?? getSecret)('chenyu')
  if (!apiKey) {
    throw new AppErrorClass('HTTP_4XX', '缺少晨羽智云 API Key', false, {
      provider: 'comfyui-chenyu',
    })
  }

  const taskId = generationTaskId(input.taskId, 'txt2img')
  createGenerationDebugLogger({}, { taskId, capability: 'txt2img' })('任务已提交', 'info', {
    operation: 'submit',
    provider: 'comfyui-chenyu',
    total: prompts.length,
    ...workflowLogDetails(input),
    width: input.width ?? 1024,
    height: input.height ?? 1024,
    concurrency: input.concurrency ?? 1,
  })
  submitGenerationTask(taskId, () =>
    runComfyuiTxt2imgBatch(
      { ...input, taskId, prompts },
      {
        ...dependencies,
        getSecret: async () => apiKey,
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

async function runTxt2imgTask(
  taskId: string,
  prompts: string[],
  input: Txt2imgRunInput,
  apiKey: string,
  dependencies: GenerationServiceDependencies = {},
) {
  const capability = input.capability ?? 'txt2img'
  const workbenchConfig = await (dependencies.readConfig ?? readAppConfig)()
  if (!workbenchConfig.workbench_root) {
    throw new AppErrorClass('HTTP_4XX', '请先在设置里选择工作区', false)
  }
  const workbenchRoot = workbenchConfig.workbench_root
  const settings = normalizeGenerationLocalConfig(workbenchConfig.generation)
  const diagnostics = await createOptionalDiagnosticLogWriter({
    module: 'generation',
    taskId,
    workbenchRoot,
    meta: {
      provider: 'grsai',
      capability,
      promptCount: prompts.length,
      model: input.model,
      aspectRatio: input.aspectRatio,
      imageSize: input.imageSize ?? null,
      referenceImageCount: input.referenceImages?.length ?? 0,
    },
  })
  const controller = new GenerationConcurrencyController({
    workers: clampInt(input.concurrency, 1, 20, settings.grsai_concurrency),
  })
  const adapter =
    dependencies.createGrsaiAdapter?.(apiKey) ??
    new GrsaiAdapter(apiKey, settings.grsai_node, {
      retries: settings.grsai_retries,
      ...(diagnostics ? { diagnostics } : {}),
    })
  const downloadImage = dependencies.downloadImage ?? defaultDownloadImage
  const model = normalizeModel(input.model)
  const outputFolder = generationTaskOutputFolder(workbenchRoot, capability, taskId)
  const db = (dependencies.openDatabase ?? openWorkbenchDatabase)(workbenchRoot)
  const emit = createGenerationProgressEmitter(dependencies)
  const result: GenerationRunResult = {
    taskId,
    total: prompts.length,
    succeeded: 0,
    failed: 0,
    images: [],
    failures: [],
    ...(diagnostics ? { diagnosticsLogPath: diagnostics.path } : {}),
  }
  let outputIndex = 0

  try {
    ensureGenerationTables(db)
    await mkdir(outputFolder, { recursive: true })
    await Promise.all(
      prompts.map((prompt, index) =>
        controller.run(`${taskId}-${index}`, async () => {
          if (isGenerationCancelled(taskId)) {
            return
          }
          emit({
            task_id: taskId,
            capability,
            processed: result.succeeded + result.failed,
            total: prompts.length,
            succeeded: result.succeeded,
            failed: result.failed,
            current_prompt: prompt,
            images: result.images,
          })

          try {
            if (isGenerationCancelled(taskId)) {
              return
            }
            const response = await adapter.generate({
              capability,
              prompt,
              ...(input.referenceImages?.length ? { reference_images: input.referenceImages } : {}),
              output: {
                aspect_ratio: input.aspectRatio,
                ...(input.imageSize ? { image_size_label: input.imageSize } : {}),
              },
              model,
            } satisfies GenerateRequest)
            if (response.status !== 'succeeded') {
              throw response.error ?? new AppErrorClass('GRSAI_FAILED', 'Grsai 生成失败', true)
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
                generatedImageExtension(image),
                input,
                currentOutputIndex,
              )
              const imageBuffer = image.local_path
                ? await readFile(image.local_path)
                : await downloadImage(image.url)
              await writeFile(targetPath, imageBuffer)
              const artifact = await registerGeneratedArtifact(db, {
                taskId,
                printId,
                targetPath,
                capability,
                prompt,
                model,
                params: {
                  aspectRatio: input.aspectRatio,
                  imageSize: input.imageSize ?? null,
                  referenceImageCount: input.referenceImages?.length ?? 0,
                },
                createdAt: Date.now(),
              })
              result.succeeded += 1
              result.images.push({
                prompt,
                url: fileUrl(targetPath),
                localPath: targetPath,
                artifactId: artifact.artifactId,
                printId: artifact.printId,
              })
            }
          } catch (error) {
            observeGenerationError(controller, error)
            await diagnostics?.append({
              type: 'error',
              provider: 'grsai',
              operation: capability,
              itemKey: `prompt-${index + 1}`,
              error: errorForDiagnosticLog(error),
            })
            result.failed += 1
            result.failures.push({ prompt, error: appErrorMessage(error) })
          } finally {
            emit({
              task_id: taskId,
              capability,
              processed: result.succeeded + result.failed,
              total: prompts.length,
              succeeded: result.succeeded,
              failed: result.failed,
              current_prompt: prompt,
              images: result.images,
            })
          }
        }),
      ),
    )
    const finalResult = markGenerationResultCancelled(result)
    await diagnostics?.append({
      type: 'task_completed',
      provider: 'grsai',
      operation: capability,
      data: {
        total: finalResult.total,
        succeeded: finalResult.succeeded,
        failed: finalResult.failed,
        cancelled: finalResult.cancelled ?? false,
      },
    })
    return finalResult
  } finally {
    db.close()
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
  let outputIndex = 0

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
    const outputFolder = generationTaskOutputFolder(workbenchRoot, 'extract', taskId)
    db = (dependencies.openDatabase ?? openWorkbenchDatabase)(workbenchRoot)
    const activeDb = db
    ensureGenerationTables(db)
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
      ensureGenerationTables(db)
      const adapter = await createComfyuiAdapterForRun(
        input,
        apiKey,
        workbenchRoot,
        db,
        dependencies,
        diagnostics,
      )
      const debug = createGenerationDebugLogger(dependencies, { taskId, capability: 'extract' })
      let outputIndex = 0

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
              ...visibleFilenameOptions(input, filenameIndex),
              ...(input.workflowVersion ? { workflowVersion: input.workflowVersion } : {}),
            },
          } satisfies GenerateRequest)
          if (response.status !== 'succeeded') {
            throw response.error ?? new AppErrorClass('HTTP_5XX', 'ComfyUI 提取失败', true)
          }
          outputIndex += response.images.length
          result.succeeded += response.images.length
          result.images.push(
            ...response.images.map((image) => ({
              prompt,
              url: image.url,
              ...(image.local_path ? { localPath: image.local_path } : {}),
              sourcePath: sourceImagePath,
              ...generationImageIdentity(image, sourceIdentity),
            })),
          )
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
      ensureGenerationTables(db)
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
      let outputIndex = 0

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
              ...visibleFilenameOptions(input, filenameIndex),
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
          result.succeeded += 1
          result.images.push({
            prompt: mattingPrompt,
            url: finalImage.url,
            ...(finalImage.local_path ? { localPath: finalImage.local_path } : {}),
            sourcePath: sourceImagePath,
            ...generationImageIdentity(finalImage, sourceIdentity),
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
      ensureGenerationTables(db)
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
      let outputIndex = 0

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
              ...visibleFilenameOptions(input, filenameIndex),
              ...(input.workflowVersion ? { workflowVersion: input.workflowVersion } : {}),
            },
          } satisfies GenerateRequest)
          if (response.status !== 'succeeded') {
            throw response.error ?? new AppErrorClass('HTTP_5XX', 'ComfyUI 抠图失败', true)
          }
          outputIndex += response.images.length
          result.succeeded += response.images.length
          result.images.push(
            ...response.images.map((image) => ({
              prompt,
              url: image.url,
              ...(image.local_path ? { localPath: image.local_path } : {}),
              sourcePath: source.imagePath,
              ...generationImageIdentity(image, { artifactId, printId: source.printId }),
            })),
          )
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
      ensureGenerationTables(db)
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
      let outputIndex = 0

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
              ...visibleFilenameOptions(input, filenameIndex),
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
          result.succeeded += response.images.length
          result.images.push(
            ...response.images.map((image) => ({
              prompt,
              url: image.url,
              ...(image.local_path ? { localPath: image.local_path } : {}),
              sourcePath: source.imagePath,
              ...generationImageIdentity(image, { artifactId, printId: source.printId }),
            })),
          )
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

export async function runComfyuiTxt2imgBatch(
  input: ComfyuiTxt2imgRunInput,
  dependencies: GenerationServiceDependencies = {},
) {
  const prompts = input.prompts.map((prompt) => prompt.trim()).filter(Boolean)
  if (prompts.length === 0) {
    throw new AppErrorClass('HTTP_4XX', '请先准备至少一条提示词', false)
  }
  if (!input.workflowId.trim()) {
    throw new AppErrorClass('HTTP_4XX', '请选择 ComfyUI 文生图工作流', false)
  }

  const apiKey = await (dependencies.getSecret ?? getSecret)('chenyu')
  if (!apiKey) {
    throw new AppErrorClass('HTTP_4XX', '缺少晨羽智云 API Key', false, {
      provider: 'comfyui-chenyu',
    })
  }

  const taskId = generationTaskId(input.taskId, 'txt2img')
  return comfyuiInstanceLocks.run(input, taskId, async () => {
    const result: GenerationRunResult = {
      taskId,
      total: prompts.length,
      succeeded: 0,
      failed: 0,
      images: [],
      failures: [],
    }
    const emit = createGenerationProgressEmitter(dependencies)
    const workbenchRoot = await readWorkbenchRoot(dependencies.readConfig)
    const diagnostics = await createGenerationDiagnostics(workbenchRoot, taskId, {
      provider: 'comfyui-chenyu',
      capability: 'txt2img',
      workflowId: input.workflowId,
      promptCount: prompts.length,
      width: input.width ?? 1024,
      height: input.height ?? 1024,
    })
    if (diagnostics) {
      result.diagnosticsLogPath = diagnostics.path
    }
    const db = (dependencies.openDatabase ?? openWorkbenchDatabase)(workbenchRoot)

    try {
      ensureGenerationTables(db)
      const useVisibleFilenames = visibleImageNamingEnabled({
        prefix: input.filenamePrefix,
        separator: input.filenameSeparator,
      })
      const concurrency = useVisibleFilenames ? 1 : clampInt(input.concurrency ?? 1, 1, 20, 1)
      const controller = new GenerationConcurrencyController({ workers: concurrency })
      const adapter = await createComfyuiAdapterForRun(
        input,
        apiKey,
        workbenchRoot,
        db,
        dependencies,
        diagnostics,
      )
      const debug = createGenerationDebugLogger(dependencies, { taskId, capability: 'txt2img' })
      const width = clampInt(input.width ?? 1024, 256, 4096, 1024)
      const height = clampInt(input.height ?? 1024, 256, 4096, 1024)
      let outputIndex = 0

      await Promise.all(
        prompts.map((prompt, index) =>
          controller.run(`${taskId}-${index}`, async () => {
            if (isGenerationCancelled(taskId)) {
              return
            }
            emitTxt2imgProgress(result, taskId, prompts.length, emit, prompt)
            try {
              if (isGenerationCancelled(taskId)) {
                return
              }
              emitComfyuiRequestLog(debug, {
                ...input,
                prompt,
                sourceIndex: index + 1,
                total: prompts.length,
                width,
                height,
              })
              const response = await adapter.generate({
                capability: 'txt2img',
                prompt,
                workflow_id: input.workflowId.trim(),
                output: {
                  format: 'png',
                  size_px: { width, height },
                },
                options: {
                  taskId,
                  width,
                  height,
                  filenameIndex: outputIndex,
                  filenamePrefix: input.filenamePrefix,
                  filenameSeparator: input.filenameSeparator,
                  ...(input.workflowVersion ? { workflowVersion: input.workflowVersion } : {}),
                },
              } satisfies GenerateRequest)
              if (response.status !== 'succeeded') {
                throw response.error ?? new AppErrorClass('HTTP_5XX', 'ComfyUI 文生图失败', true)
              }
              outputIndex += response.images.length
              result.succeeded += response.images.length
              result.images.push(
                ...response.images.map((image) => ({
                  prompt,
                  url: image.url,
                  ...(image.local_path ? { localPath: image.local_path } : {}),
                  ...generationImageIdentity(image),
                })),
              )
            } catch (error) {
              await diagnostics
                ?.append({
                  type: 'error',
                  provider: 'comfyui-chenyu',
                  operation: 'txt2img',
                  itemKey: `prompt-${index + 1}`,
                  error: errorForDiagnosticLog(error),
                })
                .catch(() => null)
              result.failed += 1
              result.failures.push({ prompt, error: appErrorMessage(error) })
            } finally {
              emitTxt2imgProgress(result, taskId, prompts.length, emit, prompt)
            }
          }),
        ),
      )

      return await finishGenerationResultWithDiagnostics(
        diagnostics,
        result,
        'comfyui-chenyu',
        'txt2img',
      )
    } finally {
      db.close()
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
      width: input.width ?? 1024,
      height: input.height ?? 1024,
      batchSize: comfyuiImg2imgBatchSize(input),
    })
    const db = (dependencies.openDatabase ?? openWorkbenchDatabase)(workbenchRoot)

    try {
      ensureGenerationTables(db)
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
      let outputIndex = 0

      for (const [index, artifactId] of sourceArtifactIds.entries()) {
        if (isGenerationCancelled(taskId)) {
          break
        }
        emitImg2imgProgress(result, taskId, result.total, emit)
        try {
          const source = await readReferenceForArtifact(db, workbenchRoot, artifactId)
          const prompt = input.prompt?.trim() ?? ''
          const preserveWorkflowPrompt = prompt.length === 0
          const filenameIndex = outputIndex
          emitComfyuiRequestLog(debug, {
            ...input,
            prompt,
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
              ...visibleFilenameOptions(input, filenameIndex),
              ...(preserveWorkflowPrompt ? { preserveWorkflowPrompt: true } : {}),
              ...(input.workflowVersion ? { workflowVersion: input.workflowVersion } : {}),
            },
          } satisfies GenerateRequest)
          if (response.status !== 'succeeded') {
            throw response.error ?? new AppErrorClass('HTTP_5XX', 'ComfyUI 图生图失败', true)
          }
          outputIndex += response.images.length
          result.succeeded += response.images.length
          if (response.images.length < batchSize) {
            const missing = batchSize - response.images.length
            result.failed += missing
            result.failures.push({
              prompt,
              error: `ComfyUI 本次只返回 ${response.images.length}/${batchSize} 张图片`,
              sourcePath: artifactId,
            })
          }
          result.images.push(
            ...response.images.map((image) => ({
              prompt,
              url: image.url,
              ...(image.local_path ? { localPath: image.local_path } : {}),
              ...generationImageIdentity(image, { artifactId, printId: source.printId }),
            })),
          )
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
            prompt: input.prompt?.trim() ?? '',
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

export async function listChenyuWorkflowMarket(
  input: ChenyuWorkflowMarketListInput = {},
  dependencies: GenerationServiceDependencies = {},
) {
  const apiKey = await (dependencies.getSecret ?? getSecret)('chenyu')
  if (!apiKey) {
    throw new AppErrorClass('HTTP_4XX', '缺少晨羽智云 API Key', false, {
      provider: 'comfyui-chenyu-workflow',
    })
  }
  const runner =
    dependencies.createChenyuWorkflowRunner?.({ apiKey, workbenchRoot: '' }) ??
    new ChenyuWorkflowRunner({
      chenyu: new ChenyuCloudClient(apiKey),
      workbenchRoot: '',
      openDatabase: dependencies.openDatabase ?? openWorkbenchDatabase,
    })
  return runner.listWorkflows(chenyuWorkflowMarketParams(input))
}

export async function getChenyuWorkflowInfo(
  workflowId: string,
  dependencies: GenerationServiceDependencies = {},
) {
  if (!workflowId.trim()) {
    throw new AppErrorClass('HTTP_4XX', '请选择晨羽工作流', false, {
      provider: 'comfyui-chenyu-workflow',
    })
  }
  const apiKey = await (dependencies.getSecret ?? getSecret)('chenyu')
  if (!apiKey) {
    throw new AppErrorClass('HTTP_4XX', '缺少晨羽智云 API Key', false, {
      provider: 'comfyui-chenyu-workflow',
    })
  }
  const runner =
    dependencies.createChenyuWorkflowRunner?.({ apiKey, workbenchRoot: '' }) ??
    new ChenyuWorkflowRunner({
      chenyu: new ChenyuCloudClient(apiKey),
      workbenchRoot: '',
      openDatabase: dependencies.openDatabase ?? openWorkbenchDatabase,
    })
  return runner.getWorkflowInfo(workflowId)
}

export async function runChenyuWorkflow(
  input: ChenyuWorkflowRunInput,
  dependencies: GenerationServiceDependencies = {},
) {
  if (!input.workflowId.trim()) {
    throw new AppErrorClass('HTTP_4XX', '请选择晨羽工作流', false, {
      provider: 'comfyui-chenyu-workflow',
    })
  }
  const config = await (dependencies.readConfig ?? readAppConfig)()
  if (!config.workbench_root) {
    throw new AppErrorClass('HTTP_4XX', '请先在设置里选择工作区', false)
  }
  const workbenchRoot = config.workbench_root
  const apiKey = await (dependencies.getSecret ?? getSecret)('chenyu')
  if (!apiKey) {
    throw new AppErrorClass('HTTP_4XX', '缺少晨羽智云 API Key', false, {
      provider: 'comfyui-chenyu-workflow',
    })
  }

  const taskId = generationTaskId(input.taskId, input.capability)
  createGenerationDebugLogger({}, { taskId, capability: input.capability })('任务已提交', 'info', {
    operation: 'submit',
    provider: 'comfyui-chenyu-workflow',
    workflowId: input.workflowId,
    revisionId: input.revisionId ?? null,
  })
  submitGenerationTask(taskId, () =>
    runChenyuWorkflowTask(
      {
        workflowId: input.workflowId,
        capability: input.capability,
        ...(input.revisionId ? { revisionId: input.revisionId } : {}),
        ...(input.inputs ? { inputs: input.inputs } : {}),
        ...(input.prompt ? { prompt: input.prompt } : {}),
        ...(input.acceptExternalCostRisk !== undefined
          ? { acceptExternalCostRisk: input.acceptExternalCostRisk }
          : {}),
        taskId,
      },
      {
        ...dependencies,
        getSecret: async () => apiKey,
      },
      workbenchRoot,
      apiKey,
    ),
  )
  return taskId
}

async function runChenyuWorkflowTask(
  input: ChenyuRunImageWorkflowInput,
  dependencies: GenerationServiceDependencies,
  workbenchRoot: string,
  apiKey: string,
): Promise<GenerationRunResult> {
  const emit = createGenerationProgressEmitter(dependencies)
  const taskId = generationTaskId(input.taskId, input.capability)
  const diagnostics = await createGenerationDiagnostics(workbenchRoot, taskId, {
    provider: 'comfyui-chenyu-workflow',
    capability: input.capability,
    workflowId: input.workflowId,
    revisionId: input.revisionId ?? null,
    hasInputs: Boolean(input.inputs),
  })
  emit({
    task_id: taskId,
    capability: input.capability,
    processed: 0,
    total: 1,
    succeeded: 0,
    failed: 0,
    ...(input.prompt ? { current_prompt: input.prompt } : {}),
  })
  if (isGenerationCancelled(taskId)) {
    const cancelledResult: GenerationRunResult = {
      taskId,
      total: 1,
      succeeded: 0,
      failed: 0,
      images: [],
      failures: [],
      cancelled: true,
      ...(diagnostics ? { diagnosticsLogPath: diagnostics.path } : {}),
    }
    await diagnostics?.append({
      type: 'task_completed',
      provider: 'comfyui-chenyu-workflow',
      operation: input.capability,
      data: {
        total: cancelledResult.total,
        succeeded: cancelledResult.succeeded,
        failed: cancelledResult.failed,
        cancelled: true,
      },
    })
    return cancelledResult
  }
  const runner =
    dependencies.createChenyuWorkflowRunner?.({
      apiKey,
      workbenchRoot,
      ...(diagnostics ? { diagnostics } : {}),
    }) ??
    new ChenyuWorkflowRunner({
      chenyu: new ChenyuCloudClient(apiKey),
      workbenchRoot,
      openDatabase: dependencies.openDatabase ?? openWorkbenchDatabase,
      ...(diagnostics ? { diagnostics } : {}),
    })
  try {
    await diagnostics?.append({
      type: 'request',
      provider: 'comfyui-chenyu-workflow',
      operation: 'runImageWorkflow',
      data: { input },
    })
    const response = await runner.runImageWorkflow(input)
    await diagnostics?.append({
      type: 'response',
      provider: 'comfyui-chenyu-workflow',
      operation: 'runImageWorkflow',
      data: { raw: response },
    })
    const result = chenyuWorkflowRunResult(input, response)
    if (diagnostics) {
      result.diagnosticsLogPath = diagnostics.path
    }
    const finalResult = markGenerationResultCancelled(result)
    await diagnostics?.append({
      type: 'task_completed',
      provider: 'comfyui-chenyu-workflow',
      operation: input.capability,
      data: {
        total: finalResult.total,
        succeeded: finalResult.succeeded,
        failed: finalResult.failed,
        cancelled: finalResult.cancelled ?? false,
      },
    })
    emit({
      task_id: finalResult.taskId,
      capability: input.capability,
      processed: 1,
      total: 1,
      succeeded: finalResult.succeeded,
      failed: finalResult.failed,
      images: finalResult.images,
      ...(input.prompt ? { current_prompt: input.prompt } : {}),
    })
    return finalResult
  } catch (error) {
    await diagnostics?.append({
      type: 'task_failed',
      provider: 'comfyui-chenyu-workflow',
      operation: input.capability,
      error: errorForDiagnosticLog(error),
    })
    throw error
  }
}

function chenyuWorkflowRunResult(
  input: ChenyuRunImageWorkflowInput,
  response: ChenyuRunImageWorkflowResult,
): GenerationRunResult {
  return {
    taskId: input.taskId ?? response.submit.run_order_id,
    total: 1,
    succeeded: response.images.length,
    failed: 0,
    images: response.images.map((image) => ({
      prompt: input.prompt ?? '',
      url: image.url,
      localPath: image.local_path,
      artifactId: image.artifact_id,
    })),
    failures: [],
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

function emitTxt2imgProgress(
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
    parseManualPrompts(parseGenerationIpcInput(z.string(), text, '手动提示词文本参数不正确')),
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
      parseGenerationIpcInput(comfyuiSourceInputSchema, input, 'ComfyUI 抠图任务参数不正确'),
    ),
  )
  ipcMain.handle('generation:run-mixed-matting', (_event, input: unknown) =>
    runMixedMatting(
      parseGenerationIpcInput(mixedMattingRunInputSchema, input, '混合抠图任务参数不正确'),
    ),
  )
  ipcMain.handle('generation:run-comfyui-img2img', (_event, input: unknown) =>
    runComfyuiImg2img(
      parseGenerationIpcInput(comfyuiSourceInputSchema, input, 'ComfyUI 图生图任务参数不正确'),
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
