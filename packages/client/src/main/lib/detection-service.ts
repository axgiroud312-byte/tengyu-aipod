import { createHash, randomUUID } from 'node:crypto'
import { copyFile, mkdir, readFile, readdir, rm, stat } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { basename, dirname, extname, isAbsolute, join, relative } from 'node:path'
import { pathToFileURL } from 'node:url'
import {
  AppErrorClass,
  type RiskLevel,
  type Skill,
  type SkillSummary,
  WORKBENCH_DIRECTORIES,
} from '@tengyu-aipod/shared'
import type { BrowserWindow, ipcMain } from 'electron'
import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions'
import { z } from 'zod'
import { AliyunBailianAdapter, type VisionResponse } from './aliyun-bailian-adapter'
import {
  type DiagnosticLogWriter,
  createOptionalDiagnosticLogWriter,
  errorForDiagnosticLog,
  fileDiagnosticMetadata,
} from './diagnostic-log-service'
import { BAILIAN_VISION_MODELS } from './generation-local-config'
import { allowLocalImagePath } from './local-image-access'
import {
  PreprocessError,
  type PreprocessFormat,
  type PreprocessOptions,
  SharpPreprocessPool,
} from './preprocess-pool'
import { type SqliteDatabase, openSqliteDatabase } from './sqlite'
import { assertTargetDoesNotExist } from './user-visible-filename'
import { workbenchDatabasePath } from './workbench-db'

const nodeRequire = createRequire(import.meta.url)

export type DetectionThreshold = {
  passMax?: number | undefined
  reviewMax?: number | undefined
}

export type DetectionImageInput = {
  path: string
  artifactId?: string | undefined
  printId?: string | undefined
}

export type DetectionBatchConfig = {
  imagePaths: string[]
  imageInputs?: DetectionImageInput[] | undefined
  skillId: string
  skillVersion?: string | undefined
  model: string
  variables?: Record<string, unknown> | undefined
  threshold?: DetectionThreshold | undefined
  preprocess?:
    | {
        compress?: boolean | undefined
        maxSize?: number | undefined
        format?: PreprocessFormat | undefined
        quality?: number | undefined
      }
    | undefined
  concurrency?: number | undefined
  maxRetries?: number | undefined
  forceRetest?: boolean | undefined
  taskId?: string | undefined
}

export type DetectionProgress = {
  task_id: string
  processed: number
  total: number
  succeeded: number
  failed: number
  skipped: number
  diagnosticsLogPath?: string | undefined
  concurrency?: number | undefined
  current_image?: string | undefined
  status?: 'running' | 'cancelled' | undefined
}

export type DetectionInputSource = {
  key: string
  label: string
  folder: string
  count: number
}

export type DetectionInputSources = {
  dirs: string[]
  counts: Record<string, number>
  sources: DetectionInputSource[]
}

export type DetectionImageInfo = {
  id: string
  path: string
  name: string
  relativePath: string
  sizeBytes: number
  modifiedAt: number
  thumbnailUrl: string
}

export type DetectionStoredResult = {
  id: string
  artifactId: string
  taskId: string
  printId: string | null
  riskScore: number
  riskLevel: RiskLevel
  reason: string
  model: string
  skillId: string
  skillVersion: string
  outputPath: string
  imagePath: string
  thumbnailUrl: string
  createdAt: number
}

export type MattingCandidate = {
  id: string
  artifactId: string
  taskId: string
  printId: string | null
  sourcePath: string
  thumbnailUrl: string
  createdAt: number
}

export type DetectionErrorCode = 'preprocess_failed' | 'llm_parse_failed' | 'llm_failed'

export type DetectionImageResult =
  | {
      imagePath: string
      thumbnailUrl: string
      artifactId: string
      printId: string
      status: 'success'
      riskScore: number
      riskLevel: RiskLevel
      reason: string
      outputPath: string
      cached: false
    }
  | {
      imagePath: string
      thumbnailUrl: string
      artifactId: string
      printId: string
      status: 'skipped'
      riskScore: number
      riskLevel: RiskLevel
      reason: string
      outputPath: string
      cached: true
    }
  | {
      imagePath: string
      thumbnailUrl: string
      artifactId?: string | undefined
      printId?: string | undefined
      status: 'failed'
      errorCode: DetectionErrorCode
      error: string
    }

export type DetectionBatchResult = {
  taskId: string
  total: number
  succeeded: number
  failed: number
  skipped: number
  results: DetectionImageResult[]
  cancelled?: boolean | undefined
  diagnosticsLogPath?: string | undefined
}

export type DetectionTaskEvent =
  | { ok: true; result: DetectionBatchResult }
  | { ok: false; taskId: string; error: string }

export type ChooseDetectionInputFolderResult =
  | { ok: true; data: { path: string } }
  | { ok: false; error: { code: string; message: string } }

type DetectionServiceDependencies = {
  skillCache?: { getSkill: (id: string, version?: string | undefined) => Promise<Skill> }
  createBailianAdapter?: (apiKey: string) => Pick<AliyunBailianAdapter, 'visionCompletion'>
  preprocessPool?: Pick<SharpPreprocessPool, 'process' | 'close'>
  readConfig?: ReadAppConfig
  getSecret?: (key: string) => Promise<string | null>
  openDatabase?: (workbenchRoot: string) => Pick<SqliteDatabase, 'exec' | 'prepare' | 'close'>
  emitProgress?: (progress: DetectionProgress) => void
  tempFileManager?: DetectionTempFileManager
}

type ReadAppConfig = () => Promise<{ workbench_root?: string | undefined }>

type DetectionTempFileManager = {
  createTaskDir(module: 'detection', taskId: string): Promise<string>
  cleanupTask(
    module: 'detection',
    taskId: string,
    options?: { keepIfFailed?: boolean },
  ): Promise<void>
}

type ImageIdentity = {
  artifactId: string
  printId: string
  fileHash: string
  fileSize: number
}

type CachedDetectionRow = {
  artifactId: string
  taskId: string
  riskScore: number
  riskLevel: RiskLevel
  reason: string | null
  model: string
  skillId: string
  skillVersion: string
  thresholdSnapshot: string
  outputPath: string
  createdAt: number
}

const DEFAULT_MODEL = 'qwen3.6-flash'
const DEFAULT_THRESHOLD = { passMax: 39, reviewMax: 69 }
const riskLevelSchema = z.enum(['pass', 'review', 'block'])
const detectionStringArraySchema = z.array(z.string())
const detectionImageInputSchema = z.object({
  path: z.string(),
  artifactId: z.string().optional(),
  printId: z.string().optional(),
})
const detectionThresholdSchema = z.object({
  passMax: z.number().optional(),
  reviewMax: z.number().optional(),
})
const detectionPreprocessSchema = z.object({
  compress: z.boolean().optional(),
  maxSize: z.number().optional(),
  format: z.enum(['jpg', 'png']).optional(),
  quality: z.number().optional(),
})
const detectionBatchConfigSchema = z.object({
  imagePaths: detectionStringArraySchema,
  imageInputs: z.array(detectionImageInputSchema).optional(),
  skillId: z.string(),
  skillVersion: z.string().optional(),
  model: z.string(),
  variables: z.record(z.unknown()).optional(),
  threshold: detectionThresholdSchema.optional(),
  preprocess: detectionPreprocessSchema.optional(),
  concurrency: z.number().optional(),
  maxRetries: z.number().optional(),
  forceRetest: z.boolean().optional(),
  taskId: z.string().optional(),
})
const detectionScanFolderInputSchema = z.object({ folder: z.string() })
const detectionScanPathsInputSchema = z.object({ paths: detectionStringArraySchema })
const detectionCancelInputSchema = z.object({ task_id: z.string() })
const detectionListResultsInputSchema = z
  .object({
    task_id: z.string().nullable().optional(),
    risk_level: riskLevelSchema.nullable().optional(),
  })
  .optional()
const detectionArtifactIdInputSchema = z.object({ artifact_id: z.string() })
const detectionArtifactIdsInputSchema = z.object({ artifact_ids: detectionStringArraySchema })
const detectionPromoteToMattingInputSchema = z.object({
  artifact_ids: detectionStringArraySchema,
  mode: z.enum(['copy', 'move']).optional(),
})

function parseDetectionIpcInput<T>(schema: z.ZodType<T>, input: unknown, message: string): T {
  const parsed = schema.safeParse(input)
  if (!parsed.success) {
    throw new AppErrorClass('INVALID_INPUT', message, false, {
      issues: parsed.error.issues,
    })
  }
  return parsed.data
}
const IMAGE_EXTENSIONS = /\.(?:jpe?g|png|webp)$/i
const RISK_OUTPUT_FOLDERS: Record<RiskLevel, string> = {
  pass: '无风险',
  review: '疑似',
  block: '高风险',
}
const DETECTION_INPUT_SOURCE_DEFS = [
  {
    key: 'generation-extract',
    label: '02-印花工作区 / 提取',
    parts: [WORKBENCH_DIRECTORIES.generation, '提取'],
  },
  {
    key: 'generation-matting',
    label: '02-印花工作区 / 抠图',
    parts: [WORKBENCH_DIRECTORIES.generation, '抠图'],
  },
] as const

function createDefaultBailianAdapter(apiKey: string) {
  return new AliyunBailianAdapter({
    apiKey,
    region: 'cn',
    maxRetries: 0,
  })
}

async function listBailianProviderModels(
  recommendedFor: 'detection' | 'title' | 'prompt',
  needsVision: boolean,
) {
  const models = BAILIAN_VISION_MODELS.map((model) => ({
    id: model.id,
    label: model.label,
    modalities: [needsVision ? 'vision' : 'text'],
    recommendedFor: [recommendedFor],
  }))
  return models
}

function naturalCompare(left: string, right: string) {
  return left.localeCompare(right, 'zh-CN', { numeric: true, sensitivity: 'base' })
}

function clampInt(value: number | undefined, min: number, max: number, fallback: number) {
  if (!Number.isFinite(value)) {
    return fallback
  }
  return Math.max(min, Math.min(max, Math.floor(value as number)))
}

function clampScore(value: number) {
  return clampInt(value, 0, 100, 0)
}

function normalizeThreshold(threshold?: DetectionThreshold) {
  const passMax = clampScore(threshold?.passMax ?? DEFAULT_THRESHOLD.passMax)
  const reviewMax = clampScore(threshold?.reviewMax ?? DEFAULT_THRESHOLD.reviewMax)
  return {
    passMax: Math.min(passMax, reviewMax),
    reviewMax: Math.max(passMax, reviewMax),
  }
}

export function classifyRisk(score: number, threshold?: DetectionThreshold): RiskLevel {
  const normalized = normalizeThreshold(threshold)
  const clamped = clampScore(score)
  if (clamped <= normalized.passMax) {
    return 'pass'
  }
  if (clamped <= normalized.reviewMax) {
    return 'review'
  }
  return 'block'
}

type ParsedDetectionResponse = {
  score: number
  reason: string
  riskLevel?: RiskLevel
}

const RISK_LABEL_RESULTS: Record<string, { score: number; riskLevel: RiskLevel }> = {
  无侵权风险: { score: 0, riskLevel: 'pass' },
  无风险: { score: 0, riskLevel: 'pass' },
  pass: { score: 0, riskLevel: 'pass' },
  通过: { score: 0, riskLevel: 'pass' },
  侵权风险低: { score: 50, riskLevel: 'review' },
  疑似: { score: 50, riskLevel: 'review' },
  review: { score: 50, riskLevel: 'review' },
  复查: { score: 50, riskLevel: 'review' },
  侵权风险高: { score: 100, riskLevel: 'block' },
  高风险: { score: 100, riskLevel: 'block' },
  block: { score: 100, riskLevel: 'block' },
  拦截: { score: 100, riskLevel: 'block' },
  失败: { score: 100, riskLevel: 'block' },
}

function parseRiskLabel(value: unknown) {
  if (typeof value !== 'string') {
    return null
  }
  const normalized = value.trim()
  return RISK_LABEL_RESULTS[normalized] ?? RISK_LABEL_RESULTS[normalized.toLowerCase()] ?? null
}

export function parseDetectionResponse(text: string): ParsedDetectionResponse | null {
  const direct = parseDetectionJson(text)
  if (direct) {
    return direct
  }

  const codeBlock = text.match(/```(?:json)?\s*({[\s\S]+?})\s*```/i)
  if (codeBlock?.[1]) {
    const parsed = parseDetectionJson(codeBlock[1])
    if (parsed) {
      return parsed
    }
  }

  const scoreMatch = text.match(/(?:risk[_\s-]?score|风险值|score)\s*[:：]\s*(\d{1,3})/i)
  if (scoreMatch?.[1]) {
    const reasonMatch = text.match(/(?:reason|依据|理由)\s*[:：]\s*([^\n\r]+)/i)
    return {
      score: clampScore(Number.parseInt(scoreMatch[1], 10)),
      reason: reasonMatch?.[1]?.trim() ?? '',
    }
  }

  const riskMatch = text.match(
    /(?:risk|risk[_\s-]?level|风险|风险等级)\s*[:：]\s*(无侵权风险|无风险|侵权风险低|疑似|侵权风险高|高风险|pass|review|block)/i,
  )
  const risk = parseRiskLabel(riskMatch?.[1])
  if (risk) {
    const reasonMatch = text.match(/(?:reason|依据|理由)\s*[:：]\s*([^\n\r]+)/i)
    return {
      ...risk,
      reason: reasonMatch?.[1]?.trim() ?? '',
    }
  }

  return null
}

function parseDetectionJson(text: string) {
  try {
    const parsed = JSON.parse(text) as unknown
    if (!parsed || typeof parsed !== 'object') {
      return null
    }
    const record = parsed as Record<string, unknown>
    const rawScore = record.risk_score ?? record.riskScore ?? record.score
    const score =
      typeof rawScore === 'number'
        ? rawScore
        : typeof rawScore === 'string'
          ? Number.parseFloat(rawScore)
          : Number.NaN
    const reason = typeof record.reason === 'string' ? record.reason.trim() : ''
    if (Number.isFinite(score)) {
      return {
        score: clampScore(score),
        reason,
      }
    }

    const risk = parseRiskLabel(record.risk ?? record.risk_level ?? record.riskLevel)
    return risk ? { ...risk, reason } : null
  } catch {
    return null
  }
}

async function hashFile(path: string) {
  const buffer = await readFile(path)
  return createHash('sha256').update(buffer).digest('hex')
}

function fileUrl(path: string) {
  return pathToFileURL(path).toString()
}

function normalizeDetectionImageInputs(config: DetectionBatchConfig): DetectionImageInput[] {
  if (config.imageInputs?.length) {
    return config.imageInputs.map((image) => ({ ...image }))
  }
  return config.imagePaths.map((path) => ({ path }))
}

async function imageIdentity(imagePath: string): Promise<ImageIdentity> {
  const [fileHash, info] = await Promise.all([hashFile(imagePath), stat(imagePath)])
  const shortHash = fileHash.slice(0, 16)
  return {
    artifactId: `art_${shortHash}`,
    printId: `pri_${shortHash}`,
    fileHash,
    fileSize: info.size,
  }
}

async function detectionImageIdentity(input: DetectionImageInput): Promise<ImageIdentity> {
  const identity = await imageIdentity(input.path)
  return {
    ...identity,
    ...(input.artifactId ? { artifactId: input.artifactId } : {}),
    ...(input.printId ? { printId: input.printId } : {}),
  }
}

function detectionOutputPath(
  workbenchRoot: string,
  taskId: string,
  riskLevel: RiskLevel,
  printId: string,
  imagePath: string,
) {
  const ext = extname(imagePath).toLowerCase() || '.jpg'
  const sourceName = basename(imagePath) || `${printId}${ext}`
  return join(
    workbenchRoot,
    WORKBENCH_DIRECTORIES.detection,
    safePathSegment(taskId),
    RISK_OUTPUT_FOLDERS[riskLevel],
    sourceName,
  )
}

function detectionTaskId(value = Date.now()) {
  return `检测-${timestampSlug(value)}`
}

function timestampSlug(value: number) {
  const date = new Date(value)
  const pad = (item: number) => String(item).padStart(2, '0')
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`
}

function safePathSegment(value: string) {
  return (value || 'task').replace(/[\\/:*?"<>|]/g, '_')
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

async function appendDiagnosticLog(
  diagnostics: DiagnosticLogWriter | null,
  event: Parameters<DiagnosticLogWriter['append']>[0],
) {
  await diagnostics?.append(event).catch(() => null)
}

function canRetry(error: unknown) {
  if (error instanceof AppErrorClass) {
    return error.retryable
  }
  return true
}

async function withRetries<T>(maxRetries: number, operation: () => Promise<T>) {
  let attempt = 0
  let lastError: unknown = null

  while (attempt <= maxRetries) {
    try {
      return await operation()
    } catch (error) {
      lastError = error
      if (attempt >= maxRetries || !canRetry(error)) {
        break
      }
      attempt += 1
    }
  }

  throw lastError
}

async function runWithConcurrency<T>(
  items: T[],
  concurrency: number,
  worker: (item: T) => Promise<void>,
  shouldContinue: () => boolean = () => true,
) {
  let nextIndex = 0
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (nextIndex < items.length && shouldContinue()) {
      const current = items[nextIndex]
      nextIndex += 1
      if (current !== undefined && shouldContinue()) {
        await worker(current)
      }
    }
  })
  await Promise.all(workers)
}

function openWorkbenchDatabase(workbenchRoot: string) {
  return openSqliteDatabase(workbenchDatabasePath(workbenchRoot))
}

function ensureDetectionTables(db: Pick<SqliteDatabase, 'exec'>) {
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

    CREATE TABLE IF NOT EXISTS detection_results (
      id TEXT PRIMARY KEY,
      artifact_id TEXT NOT NULL,
      task_id TEXT NOT NULL,
      risk_score INTEGER NOT NULL,
      risk_level TEXT NOT NULL,
      reason TEXT,
      model TEXT NOT NULL,
      skill_id TEXT NOT NULL,
      skill_version TEXT NOT NULL,
      threshold_snapshot TEXT NOT NULL,
      output_path TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_detection_artifact ON detection_results(artifact_id);
    CREATE INDEX IF NOT EXISTS idx_detection_level ON detection_results(risk_level);

    CREATE TABLE IF NOT EXISTS matting_candidates (
      id TEXT PRIMARY KEY,
      artifact_id TEXT NOT NULL,
      task_id TEXT NOT NULL,
      print_id TEXT,
      source_path TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      UNIQUE(artifact_id)
    );
  `)
}

async function readWorkbenchRoot(readConfig: ReadAppConfig = readAppConfig) {
  const workbenchConfig = await readConfig()
  if (!workbenchConfig.workbench_root) {
    throw new Error('请先在设置里选择工作区')
  }
  return workbenchConfig.workbench_root
}

function buildDetectionImageInfo(
  root: string,
  filePath: string,
  info: { size: number; mtimeMs: number },
) {
  return {
    id: createHash('sha256').update(filePath).digest('hex').slice(0, 16),
    path: filePath,
    name: basename(filePath),
    relativePath: relative(root, filePath).replace(/\\/g, '/'),
    sizeBytes: info.size,
    modifiedAt: info.mtimeMs,
    thumbnailUrl: fileUrl(filePath),
  }
}

async function scanImageFile(
  root: string,
  filePath: string,
  info?: { size: number; mtimeMs: number; isFile?: () => boolean } | null,
): Promise<DetectionImageInfo | null> {
  if (!IMAGE_EXTENSIONS.test(basename(filePath))) {
    return null
  }
  const fileInfo = info ?? (await stat(filePath).catch(() => null))
  if (!fileInfo) {
    return null
  }
  if ('isFile' in fileInfo && typeof fileInfo.isFile === 'function' && !fileInfo.isFile()) {
    return null
  }
  await allowLocalImagePath(filePath)
  return buildDetectionImageInfo(root, filePath, fileInfo)
}

function pathWithinOrEqual(root: string, candidate: string) {
  const rel = relative(root, candidate)
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))
}

function commonAncestorDirectory(paths: string[]) {
  const normalizedPaths = paths.map((path) => path.trim()).filter(Boolean)
  if (!normalizedPaths.length) {
    return null
  }

  let candidate = dirname(normalizedPaths[0] ?? '')
  while (candidate) {
    if (normalizedPaths.every((path) => pathWithinOrEqual(candidate, path))) {
      return candidate
    }

    const parent = dirname(candidate)
    if (parent === candidate) {
      return null
    }
    candidate = parent
  }
  return null
}

async function scanImageFolder(
  folder: string,
  options: { allowMissing?: boolean } = {},
): Promise<DetectionImageInfo[]> {
  const root = folder.trim()
  if (!root || !isAbsolute(root)) {
    throw new AppErrorClass('HTTP_4XX', '请选择有效的图片文件夹', false, { folder })
  }
  const rootInfo = await stat(root).catch(() => null)
  if (!rootInfo?.isDirectory()) {
    if (options.allowMissing) {
      return []
    }
    throw new AppErrorClass('HTTP_4XX', '选择的路径不是文件夹', false, { folder })
  }

  const images: DetectionImageInfo[] = []

  async function visit(currentFolder: string) {
    const entries = await readdir(currentFolder, { withFileTypes: true }).catch(() => [])
    for (const entry of entries.sort((left, right) => naturalCompare(left.name, right.name))) {
      const entryPath = join(currentFolder, entry.name)
      if (entry.isDirectory()) {
        await visit(entryPath)
        continue
      }
      if (!entry.isFile()) {
        continue
      }
      const image = await scanImageFile(root, entryPath)
      if (image) {
        images.push(image)
      }
    }
  }

  await visit(root)
  return images.sort((left, right) => naturalCompare(left.relativePath, right.relativePath))
}

function registerSourceArtifact(
  db: Pick<SqliteDatabase, 'exec' | 'prepare'>,
  input: {
    identity: ImageIdentity
    imagePath: string
    taskId: string
    createdAt: number
  },
) {
  ensureDetectionTables(db)
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

function readCachedDetection(
  db: Pick<SqliteDatabase, 'exec' | 'prepare'>,
  input: { artifactId: string; model: string; skill: SkillSummary; threshold: DetectionThreshold },
) {
  ensureDetectionTables(db)
  const thresholdSnapshot = JSON.stringify(normalizeThreshold(input.threshold))
  const row = db
    .prepare(
      `
        SELECT
          artifact_id AS artifactId,
          task_id AS taskId,
          risk_score AS riskScore,
          risk_level AS riskLevel,
          reason,
          model,
          skill_id AS skillId,
          skill_version AS skillVersion,
          threshold_snapshot AS thresholdSnapshot,
          output_path AS outputPath,
          created_at AS createdAt
        FROM detection_results
        WHERE artifact_id = ?
          AND model = ?
          AND skill_id = ?
          AND skill_version = ?
          AND threshold_snapshot = ?
        ORDER BY created_at DESC
        LIMIT 1
      `,
    )
    .get(input.artifactId, input.model, input.skill.id, input.skill.version, thresholdSnapshot) as
    | CachedDetectionRow
    | undefined

  return row ?? null
}

function registerDetectionResult(
  db: Pick<SqliteDatabase, 'exec' | 'prepare'>,
  input: {
    taskId: string
    identity: ImageIdentity
    riskScore: number
    riskLevel: RiskLevel
    reason: string
    model: string
    skill: SkillSummary
    threshold: DetectionThreshold
    outputPath: string
    createdAt: number
  },
) {
  ensureDetectionTables(db)
  db.prepare(`
    INSERT INTO detection_results (
      id,
      artifact_id,
      task_id,
      risk_score,
      risk_level,
      reason,
      model,
      skill_id,
      skill_version,
      threshold_snapshot,
      output_path,
      created_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    randomUUID(),
    input.identity.artifactId,
    input.taskId,
    input.riskScore,
    input.riskLevel,
    input.reason,
    input.model,
    input.skill.id,
    input.skill.version,
    JSON.stringify(normalizeThreshold(input.threshold)),
    input.outputPath,
    input.createdAt,
  )
}

function registerMattingCandidate(
  db: Pick<SqliteDatabase, 'exec' | 'prepare'>,
  input: {
    taskId: string
    artifactId: string
    printId: string
    sourcePath: string
  },
) {
  ensureDetectionTables(db)
  db.prepare(`
    INSERT INTO matting_candidates (
      id,
      artifact_id,
      task_id,
      print_id,
      source_path,
      created_at
    )
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(artifact_id) DO UPDATE SET
      task_id = excluded.task_id,
      print_id = excluded.print_id,
      source_path = excluded.source_path,
      created_at = excluded.created_at
  `).run(randomUUID(), input.artifactId, input.taskId, input.printId, input.sourcePath, Date.now())
}

function buildDetectionUserPrompt(variables?: Record<string, unknown>) {
  const entries = Object.entries(variables ?? {})
  if (entries.length === 0) {
    return '请判断这张印花是否存在商标、卡通、名人、影视 IP 等侵权风险，并严格输出 JSON。'
  }

  const lines = entries.map(([key, value]) => {
    const rendered = Array.isArray(value) ? value.join(', ') : String(value)
    return `${key}: ${rendered}`
  })
  return [
    '请判断这张印花是否存在商标、卡通、名人、影视 IP 等侵权风险，并严格输出 JSON。',
    '用户配置：',
    ...lines,
  ].join('\n')
}

function createDetectionMessages(
  skill: Skill,
  dataUrl: string,
  variables?: Record<string, unknown>,
): ChatCompletionMessageParam[] {
  return [
    {
      role: 'system',
      content: skill.systemPrompt,
    },
    {
      role: 'user',
      content: [
        { type: 'image_url', image_url: { url: dataUrl } },
        { type: 'text', text: buildDetectionUserPrompt(variables) },
      ],
    },
  ]
}

function detectionErrorCode(error: unknown): DetectionErrorCode {
  if (error instanceof PreprocessError) {
    return 'preprocess_failed'
  }
  if (error instanceof AppErrorClass && error.details?.kind === 'llm_parse_failed') {
    return 'llm_parse_failed'
  }
  return 'llm_failed'
}

type IndexedImage = {
  index: number
  image: DetectionImageInput
}

type DetectionResultRow = {
  id: string
  artifactId: string
  taskId: string
  printId: string | null
  riskScore: number
  riskLevel: RiskLevel
  reason: string | null
  model: string
  skillId: string
  skillVersion: string
  outputPath: string
  sourcePath: string | null
  createdAt: number
}

type ArtifactImageRow = {
  artifactId: string
  printId: string | null
  filePath: string
}

function mapStoredResult(row: DetectionResultRow): DetectionStoredResult {
  const imagePath = row.outputPath || row.sourcePath || ''
  return {
    id: row.id,
    artifactId: row.artifactId,
    taskId: row.taskId,
    printId: row.printId,
    riskScore: row.riskScore,
    riskLevel: row.riskLevel,
    reason: row.reason ?? '',
    model: row.model,
    skillId: row.skillId,
    skillVersion: row.skillVersion,
    outputPath: row.outputPath,
    imagePath,
    thumbnailUrl: imagePath ? fileUrl(imagePath) : '',
    createdAt: row.createdAt,
  }
}

function resultSelectSql(whereSql: string) {
  return `
    SELECT
      dr.id,
      dr.artifact_id AS artifactId,
      dr.task_id AS taskId,
      dr.risk_score AS riskScore,
      dr.risk_level AS riskLevel,
      dr.reason,
      dr.model,
      dr.skill_id AS skillId,
      dr.skill_version AS skillVersion,
      dr.output_path AS outputPath,
      dr.created_at AS createdAt,
      a.print_id AS printId,
      a.file_path AS sourcePath
    FROM detection_results dr
    LEFT JOIN artifacts a ON a.id = dr.artifact_id
    ${whereSql}
    ORDER BY dr.risk_score DESC, dr.created_at DESC
  `
}

export async function chooseDetectionInputFolder(): Promise<ChooseDetectionInputFolderResult> {
  const result = await electronDialog().showOpenDialog({
    properties: ['openDirectory'],
    title: '选择侵权检测输入文件夹',
  })
  if (result.canceled || !result.filePaths[0]) {
    return { ok: false, error: { code: 'CANCELLED', message: '已取消选择' } }
  }
  return { ok: true, data: { path: result.filePaths[0] } }
}

export class DetectionService {
  private readonly activeTasks = new Set<string>()
  private readonly cancelledTasks = new Set<string>()

  async listModels() {
    return (await listBailianProviderModels('detection', true)).map((model) => model.id)
  }

  cancelTask(taskId: string) {
    if (!this.activeTasks.has(taskId)) {
      return false
    }
    this.cancelledTasks.add(taskId)
    return true
  }

  getActiveTaskCount() {
    return this.activeTasks.size
  }

  cancelAllTasks() {
    for (const taskId of this.activeTasks) {
      this.cancelledTasks.add(taskId)
    }
    return this.activeTasks.size
  }

  private isCancelled(taskId: string) {
    return this.cancelledTasks.has(taskId)
  }

  async listInputSources(
    dependencies: Pick<DetectionServiceDependencies, 'readConfig'> = {},
  ): Promise<DetectionInputSources> {
    const workbenchRoot = await readWorkbenchRoot(dependencies.readConfig)
    const sources = await Promise.all(
      DETECTION_INPUT_SOURCE_DEFS.map(async (source) => {
        const folder = join(workbenchRoot, ...source.parts)
        const count = (await scanImageFolder(folder, { allowMissing: true })).length
        return {
          key: source.key,
          label: source.label,
          folder,
          count,
        } satisfies DetectionInputSource
      }),
    )
    return {
      dirs: sources.map((source) => source.folder),
      counts: Object.fromEntries(sources.map((source) => [source.folder, source.count])),
      sources,
    }
  }

  async scanPaths(input: { paths: string[] }): Promise<DetectionImageInfo[]> {
    const uniquePaths = Array.from(
      new Set(input.paths.map((path) => path.trim()).filter(Boolean)),
    ).sort(naturalCompare)
    if (!uniquePaths.length) {
      return []
    }

    const images: DetectionImageInfo[] = []
    const seenPaths = new Set<string>()
    const filePaths: Array<{ path: string; info: { size: number; mtimeMs: number } }> = []

    for (const inputPath of uniquePaths) {
      const info = await stat(inputPath).catch(() => null)
      if (!info) {
        continue
      }
      if (info.isDirectory()) {
        const scannedImages = await scanImageFolder(inputPath, { allowMissing: true })
        for (const image of scannedImages) {
          if (seenPaths.has(image.path)) {
            continue
          }
          seenPaths.add(image.path)
          images.push(image)
        }
        continue
      }
      if (info.isFile()) {
        filePaths.push({
          path: inputPath,
          info: {
            size: info.size,
            mtimeMs: info.mtimeMs,
          },
        })
      }
    }

    const fileRoot = commonAncestorDirectory(filePaths.map((item) => item.path))
    for (const { path: filePath, info } of filePaths) {
      const image = await scanImageFile(fileRoot ?? dirname(filePath), filePath, info)
      if (!image || seenPaths.has(image.path)) {
        continue
      }
      seenPaths.add(image.path)
      images.push(image)
    }

    return images.sort((left, right) => naturalCompare(left.relativePath, right.relativePath))
  }

  async scanFolder(input: { folder: string }): Promise<DetectionImageInfo[]> {
    return scanImageFolder(input.folder)
  }

  async listResults(
    input: {
      task_id?: string | null | undefined
      risk_level?: RiskLevel | null | undefined
    } = {},
    dependencies: Pick<DetectionServiceDependencies, 'readConfig' | 'openDatabase'> = {},
  ): Promise<DetectionStoredResult[]> {
    const workbenchRoot = await readWorkbenchRoot(dependencies.readConfig)
    const db = (dependencies.openDatabase ?? openWorkbenchDatabase)(workbenchRoot)
    try {
      ensureDetectionTables(db)
      const conditions: string[] = []
      const params: string[] = []
      if (input.task_id) {
        conditions.push('dr.task_id = ?')
        params.push(input.task_id)
      }
      if (input.risk_level) {
        conditions.push('dr.risk_level = ?')
        params.push(input.risk_level)
      }
      const whereSql = conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''
      const rows = db.prepare(resultSelectSql(whereSql)).all(...params) as DetectionResultRow[]
      return rows.map(mapStoredResult)
    } finally {
      db.close()
    }
  }

  async getResult(
    input: { artifact_id: string },
    dependencies: Pick<DetectionServiceDependencies, 'readConfig' | 'openDatabase'> = {},
  ): Promise<DetectionStoredResult | null> {
    const workbenchRoot = await readWorkbenchRoot(dependencies.readConfig)
    const db = (dependencies.openDatabase ?? openWorkbenchDatabase)(workbenchRoot)
    try {
      ensureDetectionTables(db)
      const row = db
        .prepare(`${resultSelectSql('WHERE dr.artifact_id = ?')} LIMIT 1`)
        .get(input.artifact_id) as DetectionResultRow | undefined
      return row ? mapStoredResult(row) : null
    } finally {
      db.close()
    }
  }

  async retest(
    input: { artifact_ids: string[] },
    emitProgress?: (progress: DetectionProgress) => void,
    emitCompleted?: (event: DetectionTaskEvent) => void,
  ) {
    const workbenchRoot = await readWorkbenchRoot()
    const artifactIds = Array.from(new Set(input.artifact_ids.filter(Boolean)))
    if (artifactIds.length === 0) {
      throw new Error('请选择需要重测的图片')
    }

    const db = openWorkbenchDatabase(workbenchRoot)
    let rows: ArtifactImageRow[]
    try {
      ensureDetectionTables(db)
      const placeholders = artifactIds.map(() => '?').join(',')
      rows = db
        .prepare(
          `
            SELECT
              id AS artifactId,
              print_id AS printId,
              file_path AS filePath
            FROM artifacts
            WHERE id IN (${placeholders})
          `,
        )
        .all(...artifactIds) as ArtifactImageRow[]
    } finally {
      db.close()
    }

    const imagePaths = rows.map((row) => row.filePath).filter(Boolean)
    if (imagePaths.length === 0) {
      throw new Error('没有找到可重测的原始图片')
    }

    const config = await getDetectionConfig()
    if (!config?.skillId) {
      throw new Error('请先保存检测 Skill 配置')
    }

    return this.startBatch(
      {
        imagePaths,
        skillId: config.skillId,
        skillVersion: config.skillVersion,
        model: config.model,
        variables: config.variables,
        threshold: config.threshold,
        forceRetest: true,
      },
      emitProgress,
      emitCompleted,
    )
  }

  async promoteToMatting(
    input: { artifact_ids: string[]; mode?: 'copy' | 'move' | undefined },
    dependencies: Pick<DetectionServiceDependencies, 'readConfig' | 'openDatabase'> = {},
  ) {
    const workbenchRoot = await readWorkbenchRoot(dependencies.readConfig)
    const artifactIds = Array.from(new Set(input.artifact_ids.filter(Boolean)))
    if (artifactIds.length === 0) {
      return 0
    }

    const db = (dependencies.openDatabase ?? openWorkbenchDatabase)(workbenchRoot)
    try {
      ensureDetectionTables(db)
      const placeholders = artifactIds.map(() => '?').join(',')
      const rows = db
        .prepare(
          `
            SELECT
              dr.artifact_id AS artifactId,
              dr.task_id AS taskId,
              dr.output_path AS outputPath,
              a.print_id AS printId
            FROM detection_results dr
            LEFT JOIN artifacts a ON a.id = dr.artifact_id
            WHERE dr.artifact_id IN (${placeholders})
            ORDER BY dr.created_at DESC
          `,
        )
        .all(...artifactIds) as Array<{
        artifactId: string
        taskId: string
        outputPath: string
        printId: string | null
      }>

      const seen = new Set<string>()
      let promoted = 0
      for (const row of rows) {
        if (seen.has(row.artifactId)) {
          continue
        }
        seen.add(row.artifactId)

        registerMattingCandidate(db, {
          sourcePath: row.outputPath,
          taskId: row.taskId,
          artifactId: row.artifactId,
          printId: row.printId ?? basename(row.outputPath, extname(row.outputPath)),
        })
        promoted += 1
      }
      return promoted
    } finally {
      db.close()
    }
  }

  async listMattingCandidates(
    dependencies: Pick<DetectionServiceDependencies, 'readConfig' | 'openDatabase'> = {},
  ): Promise<MattingCandidate[]> {
    const workbenchRoot = await readWorkbenchRoot(dependencies.readConfig)
    const db = (dependencies.openDatabase ?? openWorkbenchDatabase)(workbenchRoot)
    try {
      ensureDetectionTables(db)
      const rows = db
        .prepare(
          `
            SELECT
              id,
              artifact_id AS artifactId,
              task_id AS taskId,
              print_id AS printId,
              source_path AS sourcePath,
              created_at AS createdAt
            FROM matting_candidates
            ORDER BY created_at DESC
          `,
        )
        .all() as Array<{
        id: string
        artifactId: string
        taskId: string
        printId: string | null
        sourcePath: string
        createdAt: number
      }>

      return rows.map((row) => ({
        id: row.id,
        artifactId: row.artifactId,
        taskId: row.taskId,
        printId: row.printId,
        sourcePath: row.sourcePath,
        thumbnailUrl: fileUrl(row.sourcePath),
        createdAt: row.createdAt,
      }))
    } finally {
      db.close()
    }
  }

  async deleteResult(
    input: { artifact_id: string },
    dependencies: Pick<DetectionServiceDependencies, 'readConfig' | 'openDatabase'> = {},
  ) {
    const workbenchRoot = await readWorkbenchRoot(dependencies.readConfig)
    const db = (dependencies.openDatabase ?? openWorkbenchDatabase)(workbenchRoot)
    try {
      ensureDetectionTables(db)
      const rows = db
        .prepare('SELECT output_path AS outputPath FROM detection_results WHERE artifact_id = ?')
        .all(input.artifact_id) as Array<{ outputPath: string }>
      for (const row of rows) {
        await rm(row.outputPath, { force: true }).catch(() => null)
      }
      db.prepare('DELETE FROM matting_candidates WHERE artifact_id = ?').run(input.artifact_id)
      const info = db
        .prepare('DELETE FROM detection_results WHERE artifact_id = ?')
        .run(input.artifact_id) as { changes: number | bigint }
      return Number(info.changes)
    } finally {
      db.close()
    }
  }

  async runDetectionBatch(
    config: DetectionBatchConfig,
    dependencies: DetectionServiceDependencies = {},
  ): Promise<DetectionBatchResult> {
    const taskId = config.taskId ?? detectionTaskId()
    this.activeTasks.add(taskId)
    this.cancelledTasks.delete(taskId)
    const ownsPool = !dependencies.preprocessPool
    let tempDirCreated = false
    let keepFailedTemp = false
    let diagnostics: DiagnosticLogWriter | null = null
    const resolved = {
      skillCache: dependencies.skillCache ?? skillCacheManager,
      createBailianAdapter: dependencies.createBailianAdapter,
      preprocessPool: dependencies.preprocessPool ?? new SharpPreprocessPool(),
      readConfig: dependencies.readConfig ?? readAppConfig,
      getSecret: dependencies.getSecret ?? getSecret,
      openDatabase: dependencies.openDatabase ?? openWorkbenchDatabase,
      tempFileManager: dependencies.tempFileManager ?? tempFileManager,
    }

    try {
      const workbenchConfig = await resolved.readConfig()
      if (!workbenchConfig.workbench_root) {
        throw new Error('请先在设置里选择工作区')
      }
      const workbenchRoot = workbenchConfig.workbench_root
      const imageInputs = normalizeDetectionImageInputs(config)
      diagnostics = await createOptionalDiagnosticLogWriter({
        module: 'detection',
        taskId,
        workbenchRoot,
        meta: {
          imageCount: imageInputs.length,
          skillId: config.skillId,
          skillVersion: config.skillVersion ?? null,
          model: config.model || DEFAULT_MODEL,
          threshold: normalizeThreshold(config.threshold),
          preprocess: config.preprocess ?? null,
          maxRetries: config.maxRetries ?? null,
          concurrency: config.concurrency ?? null,
          forceRetest: config.forceRetest ?? false,
        },
      })

      if (imageInputs.length === 0) {
        const emptyResult: DetectionBatchResult = {
          taskId,
          total: 0,
          succeeded: 0,
          failed: 0,
          skipped: 0,
          results: [],
          ...(diagnostics ? { diagnosticsLogPath: diagnostics.path } : {}),
        }
        await appendDiagnosticLog(diagnostics, {
          type: 'task_completed',
          operation: 'batch',
          data: emptyResult,
        })
        return emptyResult
      }

      await resolved.tempFileManager.createTaskDir('detection', taskId)
      tempDirCreated = true

      const skill = await resolved.skillCache.getSkill(config.skillId, config.skillVersion)
      const model = config.model || skill.recommendedModel || DEFAULT_MODEL
      const apiKey = await resolved.getSecret('bailian')
      if (!apiKey) {
        throw new AppErrorClass('HTTP_4XX', '缺少阿里云百炼 API Key，请先在设置中填写', false)
      }

      const adapter = resolved.createBailianAdapter?.(apiKey) ?? createDefaultBailianAdapter(apiKey)
      const maxRetries = clampInt(config.maxRetries, 0, 5, 1)
      const concurrency = clampInt(config.concurrency, 1, 20, 20)
      const threshold = normalizeThreshold(config.threshold)
      await appendDiagnosticLog(diagnostics, {
        type: 'config_resolved',
        provider: 'aliyun-bailian',
        operation: 'batch',
        data: {
          model,
          skill: {
            id: skill.id,
            version: skill.version,
            recommendedModel: skill.recommendedModel ?? null,
            systemPrompt: skill.systemPrompt,
            variables: skill.variables,
          },
          threshold,
          maxRetries,
          concurrency,
        },
      })
      const progress: DetectionProgress = {
        task_id: taskId,
        processed: 0,
        total: imageInputs.length,
        succeeded: 0,
        failed: 0,
        skipped: 0,
        ...(diagnostics ? { diagnosticsLogPath: diagnostics.path } : {}),
        concurrency,
        status: 'running',
      }
      const results: Array<DetectionImageResult | undefined> = Array.from({
        length: imageInputs.length,
      })
      const emitProgress = (currentImage?: string) => {
        dependencies.emitProgress?.({
          ...progress,
          ...(currentImage ? { current_image: currentImage } : {}),
        })
      }

      emitProgress()

      const indexedImages = imageInputs.map((image, index) => ({ index, image }))
      await runWithConcurrency(
        indexedImages,
        concurrency,
        async (item) => {
          const result = await this.processImage({
            item,
            config,
            taskId,
            model,
            skill,
            threshold,
            adapter,
            maxRetries,
            workbenchRoot,
            preprocessPool: resolved.preprocessPool,
            openDatabase: resolved.openDatabase,
            diagnostics,
          })
          results[item.index] = result
          progress.processed += 1
          if (result.status === 'success') {
            progress.succeeded += 1
          } else if (result.status === 'skipped') {
            progress.skipped += 1
          } else {
            progress.failed += 1
          }
          emitProgress(basename(item.image.path))
        },
        () => !this.isCancelled(taskId),
      )

      keepFailedTemp = progress.failed > 0
      const cancelled = this.isCancelled(taskId)
      progress.status = cancelled ? 'cancelled' : 'running'
      if (cancelled) {
        emitProgress()
      }
      const finalResult: DetectionBatchResult = {
        taskId,
        total: progress.total,
        succeeded: progress.succeeded,
        failed: progress.failed,
        skipped: progress.skipped,
        results: results.filter((item): item is DetectionImageResult => Boolean(item)),
        ...(cancelled ? { cancelled } : {}),
        ...(diagnostics ? { diagnosticsLogPath: diagnostics.path } : {}),
      }
      await appendDiagnosticLog(diagnostics, {
        type: 'task_completed',
        provider: 'aliyun-bailian',
        operation: 'batch',
        data: {
          total: finalResult.total,
          succeeded: finalResult.succeeded,
          failed: finalResult.failed,
          skipped: finalResult.skipped,
          cancelled: finalResult.cancelled ?? false,
        },
      })
      return finalResult
    } catch (error) {
      await appendDiagnosticLog(diagnostics, {
        type: 'task_failed',
        provider: 'aliyun-bailian',
        operation: 'batch',
        error: errorForDiagnosticLog(error),
      })
      throw error
    } finally {
      if (ownsPool && 'close' in resolved.preprocessPool) {
        await resolved.preprocessPool.close()
      }

      if (tempDirCreated) {
        await resolved.tempFileManager.cleanupTask('detection', taskId, {
          keepIfFailed: keepFailedTemp,
        })
      }
      this.activeTasks.delete(taskId)
      this.cancelledTasks.delete(taskId)
    }
  }

  startBatch(
    config: DetectionBatchConfig,
    emitProgress?: (progress: DetectionProgress) => void,
    emitCompleted?: (event: DetectionTaskEvent) => void,
  ) {
    const taskId = config.taskId ?? detectionTaskId()
    const dependencies = emitProgress ? { emitProgress } : {}
    void this.runDetectionBatch({ ...config, taskId }, dependencies)
      .then((result) => {
        emitCompleted?.({ ok: true, result })
      })
      .catch((error) => {
        emitCompleted?.({ ok: false, taskId, error: appErrorMessage(error) })
      })
    return taskId
  }

  private async processImage(input: {
    item: IndexedImage
    config: DetectionBatchConfig
    taskId: string
    model: string
    skill: Skill
    threshold: DetectionThreshold
    adapter: Pick<AliyunBailianAdapter, 'visionCompletion'>
    maxRetries: number
    workbenchRoot: string
    preprocessPool: Pick<SharpPreprocessPool, 'process'>
    openDatabase: (workbenchRoot: string) => Pick<SqliteDatabase, 'exec' | 'prepare' | 'close'>
    diagnostics: DiagnosticLogWriter | null
  }): Promise<DetectionImageResult> {
    let identity: ImageIdentity
    const imagePath = input.item.image.path
    const itemKey = basename(imagePath)
    try {
      identity = await detectionImageIdentity(input.item.image)
      await appendDiagnosticLog(input.diagnostics, {
        type: 'item_started',
        provider: 'aliyun-bailian',
        operation: 'detection',
        itemKey,
        data: {
          index: input.item.index,
          image: await fileDiagnosticMetadata(imagePath).catch(() => ({
            path: imagePath,
            name: itemKey,
          })),
          identity,
        },
      })
    } catch (error) {
      await appendDiagnosticLog(input.diagnostics, {
        type: 'item_failed',
        provider: 'aliyun-bailian',
        operation: 'detection',
        itemKey,
        error: errorForDiagnosticLog(error),
      })
      return {
        imagePath,
        thumbnailUrl: fileUrl(imagePath),
        status: 'failed',
        errorCode: 'preprocess_failed',
        error: appErrorMessage(error),
      }
    }

    const db = input.openDatabase(input.workbenchRoot)
    try {
      if (!input.item.image.artifactId) {
        registerSourceArtifact(db, {
          identity,
          imagePath,
          taskId: input.taskId,
          createdAt: Date.now(),
        })
      }

      if (!input.config.forceRetest) {
        const cached = readCachedDetection(db, {
          artifactId: identity.artifactId,
          model: input.model,
          skill: input.skill,
          threshold: input.threshold,
        })
        if (cached) {
          await appendDiagnosticLog(input.diagnostics, {
            type: 'decision',
            provider: 'aliyun-bailian',
            operation: 'skip_cached',
            itemKey,
            data: {
              reason: 'same artifact/model/skill/threshold already detected',
              cached,
            },
          })
          return {
            imagePath,
            thumbnailUrl: fileUrl(imagePath),
            artifactId: identity.artifactId,
            printId: identity.printId,
            status: 'skipped',
            riskScore: cached.riskScore,
            riskLevel: cached.riskLevel,
            reason: cached.reason ?? '',
            outputPath: cached.outputPath,
            cached: true,
          }
        }
      }

      let attempt = 0
      const parsed = await withRetries(input.maxRetries, async () => {
        attempt += 1
        const preprocessOptions: PreprocessOptions = {
          module: 'detection',
          taskId: input.taskId,
          workbenchRoot: input.workbenchRoot,
          input: imagePath,
          inputName: basename(imagePath),
          ...(input.config.preprocess?.maxSize !== undefined
            ? { maxSize: input.config.preprocess.maxSize }
            : {}),
          ...(input.config.preprocess?.compress !== undefined
            ? { compression: input.config.preprocess.compress }
            : {}),
          ...(input.config.preprocess?.format ? { format: input.config.preprocess.format } : {}),
          ...(input.config.preprocess?.quality !== undefined
            ? { quality: input.config.preprocess.quality }
            : {}),
        }
        try {
          await appendDiagnosticLog(input.diagnostics, {
            type: 'preprocess_request',
            provider: 'aliyun-bailian',
            operation: 'detection',
            itemKey,
            attempt,
            data: { options: preprocessOptions },
          })
          const preprocessed = await input.preprocessPool.process(preprocessOptions)
          const messages = createDetectionMessages(
            input.skill,
            preprocessed.dataUrl,
            input.config.variables,
          )
          await appendDiagnosticLog(input.diagnostics, {
            type: 'request',
            provider: 'aliyun-bailian',
            operation: 'detection',
            itemKey,
            attempt,
            data: {
              model: input.model,
              messages,
              response_format: { type: 'json_object' },
              preprocess: {
                output: await fileDiagnosticMetadata(preprocessed.outputPath).catch(() => ({
                  path: preprocessed.outputPath,
                  name: basename(preprocessed.outputPath),
                })),
                mimeType: preprocessed.mimeType,
                dataUrl: preprocessed.dataUrl,
              },
            },
          })
          let response: VisionResponse
          try {
            response = await input.adapter.visionCompletion({
              model: input.model,
              messages,
              response_format: { type: 'json_object' },
            })
          } finally {
            await rm(preprocessed.outputPath, { force: true }).catch(() => null)
          }
          await appendDiagnosticLog(input.diagnostics, {
            type: 'response',
            provider: 'aliyun-bailian',
            operation: 'detection',
            itemKey,
            attempt,
            data: {
              raw: response,
            },
          })

          const parsed = parseDetectionResponse(response.text)
          if (!parsed) {
            await appendDiagnosticLog(input.diagnostics, {
              type: 'parse_failed',
              provider: 'aliyun-bailian',
              operation: 'detection',
              itemKey,
              attempt,
              data: {
                rawText: response.text,
              },
            })
            throw new AppErrorClass('HTTP_5XX', '模型返回无法解析的检测结果', true, {
              kind: 'llm_parse_failed',
            })
          }
          await appendDiagnosticLog(input.diagnostics, {
            type: 'parse_result',
            provider: 'aliyun-bailian',
            operation: 'detection',
            itemKey,
            attempt,
            data: parsed,
          })
          return parsed
        } catch (error) {
          await appendDiagnosticLog(input.diagnostics, {
            type: 'attempt_failed',
            provider: 'aliyun-bailian',
            operation: 'detection',
            itemKey,
            attempt,
            error: errorForDiagnosticLog(error),
          })
          throw error
        }
      })

      const riskLevel = parsed.riskLevel ?? classifyRisk(parsed.score, input.threshold)
      const outputPath = detectionOutputPath(
        input.workbenchRoot,
        input.taskId,
        riskLevel,
        identity.printId,
        imagePath,
      )
      await mkdir(
        join(
          input.workbenchRoot,
          WORKBENCH_DIRECTORIES.detection,
          safePathSegment(input.taskId),
          RISK_OUTPUT_FOLDERS[riskLevel],
        ),
        { recursive: true },
      )
      await assertTargetDoesNotExist(outputPath)
      await copyFile(imagePath, outputPath)
      registerDetectionResult(db, {
        taskId: input.taskId,
        identity,
        riskScore: parsed.score,
        riskLevel,
        reason: parsed.reason,
        model: input.model,
        skill: input.skill,
        threshold: input.threshold,
        outputPath,
        createdAt: Date.now(),
      })
      await appendDiagnosticLog(input.diagnostics, {
        type: 'item_completed',
        provider: 'aliyun-bailian',
        operation: 'detection',
        itemKey,
        data: {
          artifactId: identity.artifactId,
          printId: identity.printId,
          riskScore: parsed.score,
          riskLevel,
          reason: parsed.reason,
          outputPath,
        },
      })

      return {
        imagePath,
        thumbnailUrl: fileUrl(imagePath),
        artifactId: identity.artifactId,
        printId: identity.printId,
        status: 'success',
        riskScore: parsed.score,
        riskLevel,
        reason: parsed.reason,
        outputPath,
        cached: false,
      }
    } catch (error) {
      await appendDiagnosticLog(input.diagnostics, {
        type: 'item_failed',
        provider: 'aliyun-bailian',
        operation: 'detection',
        itemKey,
        error: errorForDiagnosticLog(error),
      })
      return {
        imagePath,
        thumbnailUrl: fileUrl(imagePath),
        artifactId: identity.artifactId,
        printId: identity.printId,
        status: 'failed',
        errorCode: detectionErrorCode(error),
        error: appErrorMessage(error),
      }
    } finally {
      db.close()
    }
  }
}

export const detectionService = new DetectionService()

function emitDetectionProgress(progress: DetectionProgress) {
  for (const window of electronBrowserWindow().getAllWindows()) {
    window.webContents.send('detection:progress', progress)
  }
}

function emitDetectionCompleted(event: DetectionTaskEvent) {
  for (const window of electronBrowserWindow().getAllWindows()) {
    window.webContents.send('detection:completed', event)
  }
}

export function registerDetectionIpc() {
  const ipcMain = electronIpcMain()
  ipcMain.handle('detection:choose-input-folder', () => chooseDetectionInputFolder())
  ipcMain.handle('detection:list-input-sources', () => detectionService.listInputSources())
  ipcMain.handle('detection:scan-folder', (_event, input: unknown) =>
    detectionService.scanFolder(
      parseDetectionIpcInput(detectionScanFolderInputSchema, input, '检测图片文件夹参数不正确'),
    ),
  )
  ipcMain.handle('detection:scan-paths', (_event, input: unknown) =>
    detectionService.scanPaths(
      parseDetectionIpcInput(detectionScanPathsInputSchema, input, '检测图片路径参数不正确'),
    ),
  )
  ipcMain.handle('detection:list-models', () => detectionService.listModels())
  ipcMain.handle('detection:run', (_event, input: unknown) =>
    detectionService.startBatch(
      parseDetectionIpcInput(detectionBatchConfigSchema, input, '检测任务参数不正确'),
      emitDetectionProgress,
      emitDetectionCompleted,
    ),
  )
  ipcMain.handle('detection:cancel', (_event, input: unknown) => ({
    ok: detectionService.cancelTask(
      parseDetectionIpcInput(detectionCancelInputSchema, input, '检测取消参数不正确').task_id,
    ),
  }))
  ipcMain.handle('detection:list-results', (_event, input: unknown) =>
    detectionService.listResults(
      parseDetectionIpcInput(detectionListResultsInputSchema, input, '检测结果查询参数不正确'),
    ),
  )
  ipcMain.handle('detection:get-result', (_event, input: unknown) =>
    detectionService.getResult(
      parseDetectionIpcInput(detectionArtifactIdInputSchema, input, '检测结果详情参数不正确'),
    ),
  )
  ipcMain.handle('detection:retest', (_event, input: unknown) =>
    detectionService.retest(
      parseDetectionIpcInput(detectionArtifactIdsInputSchema, input, '复测参数不正确'),
      emitDetectionProgress,
      emitDetectionCompleted,
    ),
  )
  ipcMain.handle('detection:promote-to-matting', (_event, input: unknown) =>
    detectionService.promoteToMatting(
      parseDetectionIpcInput(detectionPromoteToMattingInputSchema, input, '检测转抠图参数不正确'),
    ),
  )
  ipcMain.handle('detection:list-matting-candidates', () =>
    detectionService.listMattingCandidates(),
  )
  ipcMain.handle('detection:delete-result', (_event, input: unknown) =>
    detectionService.deleteResult(
      parseDetectionIpcInput(detectionArtifactIdInputSchema, input, '删除检测结果参数不正确'),
    ),
  )
}

async function readAppConfig() {
  return (await import('../onboarding')).readAppConfig()
}

async function getSecret(key: string) {
  return (await import('./keychain')).getSecret(key)
}

async function getDetectionConfig() {
  return (await import('./detection-config')).getDetectionConfig()
}

const skillCacheManager = {
  getSkill: async (id: string, version?: string) =>
    (await import('./skill-cache')).skillCacheManager.getSkill(id, version),
}

const tempFileManager = {
  createTaskDir: async (module: 'detection', taskId: string) =>
    (await import('./temp-file-manager')).tempFileManager.createTaskDir(module, taskId),
  cleanupTask: async (module: 'detection', taskId: string, options?: { keepIfFailed?: boolean }) =>
    (await import('./temp-file-manager')).tempFileManager.cleanupTask(module, taskId, options),
}

function electronIpcMain(): typeof ipcMain {
  return (nodeRequire('electron') as typeof import('electron')).ipcMain
}

function electronBrowserWindow(): typeof BrowserWindow {
  return (nodeRequire('electron') as typeof import('electron')).BrowserWindow
}

function electronDialog(): typeof import('electron').dialog {
  return (nodeRequire('electron') as typeof import('electron')).dialog
}
