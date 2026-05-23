import { createHash, randomUUID } from 'node:crypto'
import { copyFile, mkdir, readFile, rm, stat } from 'node:fs/promises'
import { basename, extname, join } from 'node:path'
import {
  AppErrorClass,
  type RiskLevel,
  type Skill,
  type SkillSummary,
  WORKBENCH_DIRECTORIES,
} from '@tengyu-aipod/shared'
import Database from 'better-sqlite3'
import { BrowserWindow, ipcMain } from 'electron'
import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions'
import { readAppConfig } from '../onboarding'
import { AliyunBailianAdapter, type VisionResponse } from './aliyun-bailian-adapter'
import { getSecret } from './keychain'
import {
  PreprocessError,
  type PreprocessFormat,
  type PreprocessOptions,
  SharpPreprocessPool,
} from './preprocess-pool'
import { skillCacheManager } from './skill-cache'
import { tempFileManager } from './temp-file-manager'

export type DetectionThreshold = {
  passMax?: number
  reviewMax?: number
}

export type DetectionBatchConfig = {
  imagePaths: string[]
  skillId: string
  skillVersion?: string
  model: string
  variables?: Record<string, unknown>
  threshold?: DetectionThreshold
  preprocess?: {
    compress?: boolean
    maxSize?: number
    format?: PreprocessFormat
    quality?: number
  }
  concurrency?: number
  maxRetries?: number
  forceRetest?: boolean
  taskId?: string
}

export type DetectionProgress = {
  task_id: string
  processed: number
  total: number
  succeeded: number
  failed: number
  skipped: number
  current_image?: string
}

export type DetectionErrorCode = 'preprocess_failed' | 'llm_parse_failed' | 'llm_failed'

export type DetectionImageResult =
  | {
      imagePath: string
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
      artifactId?: string
      printId?: string
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
}

export type DetectionTaskEvent =
  | { ok: true; result: DetectionBatchResult }
  | { ok: false; taskId: string; error: string }

type DetectionServiceDependencies = {
  skillCache?: Pick<typeof skillCacheManager, 'getSkill'>
  createBailianAdapter?: (apiKey: string) => Pick<AliyunBailianAdapter, 'visionCompletion'>
  preprocessPool?: Pick<SharpPreprocessPool, 'process' | 'close'>
  readConfig?: typeof readAppConfig
  getSecret?: typeof getSecret
  openDatabase?: (workbenchRoot: string) => Pick<Database.Database, 'exec' | 'prepare' | 'close'>
  emitProgress?: (progress: DetectionProgress) => void
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

const DEFAULT_MODEL = 'qwen3-vl-flash'
const DEFAULT_THRESHOLD = { passMax: 39, reviewMax: 69 }
const MODEL_OPTIONS = ['qwen3-vl-flash', 'qwen3-vl-plus', 'qwen-vl-max'] as const

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

export function parseDetectionResponse(text: string): { score: number; reason: string } | null {
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
  if (!scoreMatch?.[1]) {
    return null
  }

  const reasonMatch = text.match(/(?:reason|依据|理由)\s*[:：]\s*([^\n\r]+)/i)
  return {
    score: clampScore(Number.parseInt(scoreMatch[1], 10)),
    reason: reasonMatch?.[1]?.trim() ?? '',
  }
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
    if (!Number.isFinite(score)) {
      return null
    }
    return {
      score: clampScore(score),
      reason: typeof record.reason === 'string' ? record.reason.trim() : '',
    }
  } catch {
    return null
  }
}

async function hashFile(path: string) {
  const buffer = await readFile(path)
  return createHash('sha256').update(buffer).digest('hex')
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

function detectionOutputPath(
  workbenchRoot: string,
  riskLevel: RiskLevel,
  printId: string,
  imagePath: string,
) {
  const ext = extname(imagePath).toLowerCase() || '.jpg'
  return join(workbenchRoot, WORKBENCH_DIRECTORIES.detection, riskLevel, `${printId}${ext}`)
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
) {
  let nextIndex = 0
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (nextIndex < items.length) {
      const current = items[nextIndex]
      nextIndex += 1
      if (current !== undefined) {
        await worker(current)
      }
    }
  })
  await Promise.all(workers)
}

function workbenchDbPath(workbenchRoot: string) {
  return join(workbenchRoot, '.workbench', 'workbench.db')
}

function openWorkbenchDatabase(workbenchRoot: string) {
  return new Database(workbenchDbPath(workbenchRoot))
}

function ensureDetectionTables(db: Pick<Database.Database, 'exec'>) {
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
  `)
}

function registerSourceArtifact(
  db: Pick<Database.Database, 'exec' | 'prepare'>,
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
  db: Pick<Database.Database, 'exec' | 'prepare'>,
  input: { artifactId: string; model: string; skill: SkillSummary },
) {
  ensureDetectionTables(db)
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
        ORDER BY created_at DESC
        LIMIT 1
      `,
    )
    .get(input.artifactId, input.model, input.skill.id, input.skill.version) as
    | CachedDetectionRow
    | undefined

  return row ?? null
}

function registerDetectionResult(
  db: Pick<Database.Database, 'exec' | 'prepare'>,
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
  imagePath: string
}

export class DetectionService {
  listModels() {
    return MODEL_OPTIONS
  }

  async runDetectionBatch(
    config: DetectionBatchConfig,
    dependencies: DetectionServiceDependencies = {},
  ): Promise<DetectionBatchResult> {
    const taskId = config.taskId ?? randomUUID()
    const ownsPool = !dependencies.preprocessPool
    let tempDirCreated = false
    let keepFailedTemp = false
    const resolved = {
      skillCache: dependencies.skillCache ?? skillCacheManager,
      createBailianAdapter:
        dependencies.createBailianAdapter ??
        ((apiKey: string) => new AliyunBailianAdapter({ apiKey, region: 'cn', maxRetries: 0 })),
      preprocessPool: dependencies.preprocessPool ?? new SharpPreprocessPool(),
      readConfig: dependencies.readConfig ?? readAppConfig,
      getSecret: dependencies.getSecret ?? getSecret,
      openDatabase: dependencies.openDatabase ?? openWorkbenchDatabase,
    }

    try {
      const workbenchConfig = await resolved.readConfig()
      if (!workbenchConfig.workbench_root) {
        throw new Error('workbench_root is required before detection can run')
      }
      const workbenchRoot = workbenchConfig.workbench_root

      if (config.imagePaths.length === 0) {
        return {
          taskId,
          total: 0,
          succeeded: 0,
          failed: 0,
          skipped: 0,
          results: [],
        }
      }

      await tempFileManager.createTaskDir('detection', taskId)
      tempDirCreated = true

      const skill = await resolved.skillCache.getSkill(config.skillId, config.skillVersion)
      const model = config.model || skill.recommendedModel || DEFAULT_MODEL
      const apiKey = await resolved.getSecret('bailian')
      if (!apiKey) {
        throw new AppErrorClass('HTTP_4XX', '缺少阿里云百炼 API Key，请先在设置中填写', false)
      }

      const adapter = resolved.createBailianAdapter(apiKey)
      const maxRetries = clampInt(config.maxRetries, 0, 5, 1)
      const concurrency = clampInt(config.concurrency, 1, 8, 3)
      const threshold = normalizeThreshold(config.threshold)
      const progress: DetectionProgress = {
        task_id: taskId,
        processed: 0,
        total: config.imagePaths.length,
        succeeded: 0,
        failed: 0,
        skipped: 0,
      }
      const results: Array<DetectionImageResult | undefined> = Array.from({
        length: config.imagePaths.length,
      })
      const emitProgress = (currentImage?: string) => {
        dependencies.emitProgress?.({
          ...progress,
          ...(currentImage ? { current_image: currentImage } : {}),
        })
      }

      emitProgress()

      const indexedImages = config.imagePaths.map((imagePath, index) => ({ index, imagePath }))
      await runWithConcurrency(indexedImages, concurrency, async (item) => {
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
        emitProgress(basename(item.imagePath))
      })

      keepFailedTemp = progress.failed > 0
      return {
        taskId,
        total: progress.total,
        succeeded: progress.succeeded,
        failed: progress.failed,
        skipped: progress.skipped,
        results: results.filter((item): item is DetectionImageResult => Boolean(item)),
      }
    } finally {
      if (ownsPool && 'close' in resolved.preprocessPool) {
        await resolved.preprocessPool.close()
      }

      if (tempDirCreated) {
        await tempFileManager.cleanupTask('detection', taskId, { keepIfFailed: keepFailedTemp })
      }
    }
  }

  startBatch(
    config: DetectionBatchConfig,
    emitProgress?: (progress: DetectionProgress) => void,
    emitCompleted?: (event: DetectionTaskEvent) => void,
  ) {
    const taskId = config.taskId ?? randomUUID()
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
    openDatabase: (workbenchRoot: string) => Pick<Database.Database, 'exec' | 'prepare' | 'close'>
  }): Promise<DetectionImageResult> {
    let identity: ImageIdentity
    try {
      identity = await imageIdentity(input.item.imagePath)
    } catch (error) {
      return {
        imagePath: input.item.imagePath,
        status: 'failed',
        errorCode: 'preprocess_failed',
        error: appErrorMessage(error),
      }
    }

    const db = input.openDatabase(input.workbenchRoot)
    try {
      registerSourceArtifact(db, {
        identity,
        imagePath: input.item.imagePath,
        taskId: input.taskId,
        createdAt: Date.now(),
      })

      if (!input.config.forceRetest) {
        const cached = readCachedDetection(db, {
          artifactId: identity.artifactId,
          model: input.model,
          skill: input.skill,
        })
        if (cached) {
          return {
            imagePath: input.item.imagePath,
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

      const parsed = await withRetries(input.maxRetries, async () => {
        const preprocessOptions: PreprocessOptions = {
          module: 'detection',
          taskId: input.taskId,
          workbenchRoot: input.workbenchRoot,
          input: input.item.imagePath,
          inputName: basename(input.item.imagePath),
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
        const preprocessed = await input.preprocessPool.process(preprocessOptions)
        let response: VisionResponse
        try {
          response = await input.adapter.visionCompletion({
            model: input.model,
            messages: createDetectionMessages(
              input.skill,
              preprocessed.dataUrl,
              input.config.variables,
            ),
            response_format: { type: 'json_object' },
          })
        } finally {
          await rm(preprocessed.outputPath, { force: true }).catch(() => null)
        }

        const parsed = parseDetectionResponse(response.text)
        if (!parsed) {
          throw new AppErrorClass('HTTP_5XX', '模型返回无法解析的检测结果', true, {
            kind: 'llm_parse_failed',
          })
        }
        return parsed
      })

      const riskLevel = classifyRisk(parsed.score, input.threshold)
      const outputPath = detectionOutputPath(
        input.workbenchRoot,
        riskLevel,
        identity.printId,
        input.item.imagePath,
      )
      await mkdir(join(input.workbenchRoot, WORKBENCH_DIRECTORIES.detection, riskLevel), {
        recursive: true,
      })
      await copyFile(input.item.imagePath, outputPath)
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

      return {
        imagePath: input.item.imagePath,
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
      return {
        imagePath: input.item.imagePath,
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
  for (const window of BrowserWindow.getAllWindows()) {
    window.webContents.send('detection:progress', progress)
  }
}

function emitDetectionCompleted(event: DetectionTaskEvent) {
  for (const window of BrowserWindow.getAllWindows()) {
    window.webContents.send('detection:completed', event)
  }
}

export function registerDetectionIpc() {
  ipcMain.handle('detection:list-models', () => detectionService.listModels())
  ipcMain.handle('detection:run', (_event, input: DetectionBatchConfig) =>
    detectionService.startBatch(input, emitDetectionProgress, emitDetectionCompleted),
  )
}
