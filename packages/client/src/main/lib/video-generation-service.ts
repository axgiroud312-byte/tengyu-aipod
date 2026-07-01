import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import { basename, dirname, extname, isAbsolute, join } from 'node:path'
import { AppErrorClass, WORKBENCH_DIRECTORIES } from '@tengyu-aipod/shared'
import { BrowserWindow, dialog, ipcMain, shell } from 'electron'
import sharp from 'sharp'
import { z } from 'zod'
import {
  type DiagnosticLogWriter,
  createOptionalDiagnosticLogWriter,
  errorForDiagnosticLog,
} from './diagnostic-log-service'
import { getSecret } from './keychain'
import { type SqliteDatabase, openSqliteDatabase } from './sqlite'
import { assertTargetDoesNotExist, sanitizeVisibleFilenamePart } from './user-visible-filename'
import { readAppConfig } from './workbench-config'
import { assertPathInsideWorkbench } from './workbench-path-guard'

const HAPPYHORSE_BASE_URL = 'https://dashscope.aliyuncs.com/api/v1'
const IMAGE_SIZE_LIMIT_BYTES = 20 * 1024 * 1024
const VIDEO_POLL_INTERVAL_MS = 15_000
const VIDEO_RUNTIME_LOG_LIMIT = 1000
const IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp'])

export type VideoGenerationMode = 'image-to-video' | 'reference-to-video'
export type HappyHorseVersion = 'happyhorse-1.1' | 'happyhorse-1.0'
export type HappyHorseResolution = '720P' | '1080P'
export type HappyHorseTaskStatus =
  | 'PENDING'
  | 'RUNNING'
  | 'SUCCEEDED'
  | 'FAILED'
  | 'CANCELED'
  | 'UNKNOWN'
export type VideoGenerationStatus =
  | 'validating'
  | 'submitting'
  | 'pending'
  | 'running'
  | 'downloading'
  | 'succeeded'
  | 'failed'
  | 'stopped'
export type HappyHorseRatio =
  | '16:9'
  | '9:16'
  | '3:4'
  | '4:3'
  | '4:5'
  | '5:4'
  | '1:1'
  | '9:21'
  | '21:9'

export type VideoRunInput = {
  mode: VideoGenerationMode
  taskName?: string | undefined
  prompt?: string | undefined
  imagePaths: string[]
  modelVersion: HappyHorseVersion
  resolution: HappyHorseResolution
  duration: 3 | 5 | 8 | 10 | 15
  watermark: boolean
  ratio?: HappyHorseRatio | undefined
}

export type VideoImageMetadata = {
  path: string
  name: string
  mime: string
  bytes: number
  sha256: string
  width: number
  height: number
  dataUrl: string
}

export type VideoProgressEvent = {
  task_id: string
  mode: VideoGenerationMode
  status: VideoGenerationStatus
  message: string
  taskStatus?: HappyHorseTaskStatus
  remoteTaskId?: string
  outputPath?: string
  videoUrl?: string
  diagnosticsLogPath?: string
  error?: string
}

export type VideoCompletedEvent =
  | {
      ok: true
      task_id: string
      mode: VideoGenerationMode
      remoteTaskId: string
      videoUrl: string
      outputPath: string
      diagnosticsLogPath?: string
    }
  | {
      ok: false
      task_id: string
      mode: VideoGenerationMode
      error: string
      diagnosticsLogPath?: string
    }

export type VideoRuntimeLogEntry = {
  id: string
  timestamp: number
  level: 'debug' | 'info' | 'warn' | 'error'
  mode: VideoGenerationMode
  message: string
  taskId?: string
  details?: {
    operation?: 'validate' | 'submit' | 'poll' | 'download' | 'completed' | 'stop' | 'error'
    remoteTaskId?: string
    taskStatus?: string
    model?: string
    resolution?: string
    duration?: number
    ratio?: string
    imageCount?: number
    outputPath?: string
    videoUrl?: string
    error?: string
  }
}

type VideoTaskRecord = {
  stopped: boolean
  mode: VideoGenerationMode
  logs: VideoRuntimeLogEntry[]
}

type HappyHorseCreateResponse = {
  output?: { task_id?: string }
  request_id?: string
  code?: string
  message?: string
}

type HappyHorseTaskResponse = {
  output?: {
    task_id?: string
    task_status?: string
    results?: Array<{ video_url?: string }>
    video_url?: string
  }
  request_id?: string
  code?: string
  message?: string
}

type VideoGenerationDependencies = {
  readConfig?: typeof readAppConfig
  getSecret?: typeof getSecret
  createFetch?: typeof fetch
  sleep?: (ms: number) => Promise<void>
  openDatabase?: (workbenchRoot: string) => SqliteDatabase
  now?: () => number
}

const videoRunInputSchema = z
  .object({
    mode: z.enum(['image-to-video', 'reference-to-video']),
    taskName: z.string().optional(),
    prompt: z.string().optional(),
    imagePaths: z.array(z.string()),
    modelVersion: z.enum(['happyhorse-1.1', 'happyhorse-1.0']),
    resolution: z.enum(['720P', '1080P']),
    duration: z.union([z.literal(3), z.literal(5), z.literal(8), z.literal(10), z.literal(15)]),
    watermark: z.boolean(),
    ratio: z.enum(['16:9', '9:16', '3:4', '4:3', '4:5', '5:4', '1:1', '9:21', '21:9']).optional(),
  })
  .superRefine((input, ctx) => {
    if (input.mode === 'reference-to-video' && !input.prompt?.trim()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: '参考生视频必须填写提示词',
        path: ['prompt'],
      })
    }
    if (input.mode === 'reference-to-video' && !input.ratio) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: '参考生视频必须选择比例',
        path: ['ratio'],
      })
    }
  })
const videoTaskIdInputSchema = z.object({ task_id: z.string().min(1) })
const videoOpenPathInputSchema = z.object({ path: z.string().min(1) })

const tasks = new Map<string, VideoTaskRecord>()

const VIDEO_MODE_LABELS: Record<VideoGenerationMode, string> = {
  'image-to-video': '图生视频',
  'reference-to-video': '参考生视频',
}

const VIDEO_MODEL_MAP: Record<VideoGenerationMode, Record<HappyHorseVersion, string>> = {
  'image-to-video': {
    'happyhorse-1.1': 'happyhorse-1.1-i2v',
    'happyhorse-1.0': 'happyhorse-1.0-i2v',
  },
  'reference-to-video': {
    'happyhorse-1.1': 'happyhorse-1.1-r2v',
    'happyhorse-1.0': 'happyhorse-1.0-r2v',
  },
}

export function resolveHappyHorseModel(mode: VideoGenerationMode, version: HappyHorseVersion) {
  return VIDEO_MODEL_MAP[mode][version]
}

export function videoTaskId(inputTaskName: string | undefined, now = Date.now()) {
  const clean = sanitizeVisibleFilenamePart(inputTaskName?.trim() ?? '')
  if (clean) {
    return clean
  }
  const date = new Date(now)
  const pad = (value: number, size = 2) => String(value).padStart(size, '0')
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`
}

export function videoOutputPath(
  workbenchRoot: string,
  mode: VideoGenerationMode,
  taskName: string,
) {
  return join(
    workbenchRoot,
    WORKBENCH_DIRECTORIES.video,
    VIDEO_MODE_LABELS[mode],
    videoTaskId(taskName),
    '0001.mp4',
  )
}

export function mapHappyHorseTaskStatus(status: string | undefined): HappyHorseTaskStatus {
  switch (status) {
    case 'PENDING':
    case 'RUNNING':
    case 'SUCCEEDED':
    case 'FAILED':
    case 'CANCELED':
      return status
    default:
      return 'UNKNOWN'
  }
}

export function mapTaskStatusToProgressStatus(status: HappyHorseTaskStatus): VideoGenerationStatus {
  switch (status) {
    case 'PENDING':
      return 'pending'
    case 'RUNNING':
      return 'running'
    case 'SUCCEEDED':
      return 'downloading'
    case 'FAILED':
    case 'CANCELED':
    case 'UNKNOWN':
      return 'failed'
  }
}

function parseVideoIpcInput<T>(schema: z.ZodType<T>, input: unknown, message: string): T {
  const parsed = schema.safeParse(input)
  if (!parsed.success) {
    throw new AppErrorClass('INVALID_INPUT', message, false, {
      issues: parsed.error.issues,
    })
  }
  return parsed.data
}

function workbenchDbPath(workbenchRoot: string) {
  return join(workbenchRoot, WORKBENCH_DIRECTORIES.metadata, 'workbench.db')
}

function openWorkbenchDatabase(workbenchRoot: string) {
  return openSqliteDatabase(workbenchDbPath(workbenchRoot))
}

function ensureVideoTables(db: Pick<SqliteDatabase, 'exec'>) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS tasks (
      id TEXT PRIMARY KEY,
      module TEXT NOT NULL,
      type TEXT NOT NULL,
      status TEXT NOT NULL,
      input_json TEXT NOT NULL DEFAULT '{}',
      result_json TEXT,
      error_json TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS workflow_steps (
      id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL,
      module TEXT NOT NULL,
      step TEXT NOT NULL,
      status TEXT NOT NULL,
      attempt INTEGER NOT NULL DEFAULT 0,
      params_snapshot TEXT NOT NULL DEFAULT '{}',
      output_json TEXT,
      error_json TEXT,
      updated_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_workflow_steps_task ON workflow_steps(task_id);
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
    CREATE INDEX IF NOT EXISTS idx_artifacts_provider_path ON artifacts(provider, file_path);
  `)
}

function newRuntimeLogEntry(
  mode: VideoGenerationMode,
  message: string,
  level: VideoRuntimeLogEntry['level'],
  taskId?: string,
  details?: VideoRuntimeLogEntry['details'],
): VideoRuntimeLogEntry {
  return {
    id: `${Date.now()}-${randomUUID().slice(0, 8)}`,
    timestamp: Date.now(),
    level,
    mode,
    message,
    ...(taskId ? { taskId } : {}),
    ...(details ? { details } : {}),
  }
}

function emitRuntimeLog(entry: VideoRuntimeLogEntry) {
  const record = entry.taskId ? tasks.get(entry.taskId) : null
  if (record) {
    record.logs = [...record.logs, entry].slice(-VIDEO_RUNTIME_LOG_LIMIT)
  }
  for (const window of BrowserWindow.getAllWindows()) {
    window.webContents.send('video:debug-log', entry)
  }
}

function emitVideoProgress(progress: VideoProgressEvent) {
  for (const window of BrowserWindow.getAllWindows()) {
    window.webContents.send('video:progress', progress)
  }
}

function emitVideoCompleted(event: VideoCompletedEvent) {
  for (const window of BrowserWindow.getAllWindows()) {
    window.webContents.send('video:completed', event)
  }
}

async function hashFile(path: string) {
  const buffer = await readFile(path)
  return createHash('sha256').update(buffer).digest('hex')
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

export async function validateVideoImages(
  mode: VideoGenerationMode,
  imagePaths: string[],
): Promise<VideoImageMetadata[]> {
  const normalized = Array.from(new Set(imagePaths.map((path) => path.trim()).filter(Boolean)))
  if (mode === 'image-to-video' && normalized.length !== 1) {
    throw new AppErrorClass('HTTP_4XX', '图生视频只能选择 1 张首帧图', false)
  }
  if (mode === 'reference-to-video' && (normalized.length < 1 || normalized.length > 9)) {
    throw new AppErrorClass('HTTP_4XX', '参考生视频需要 1-9 张参考图', false)
  }

  const results: VideoImageMetadata[] = []
  for (const imagePath of normalized) {
    if (!isAbsolute(imagePath)) {
      throw new AppErrorClass('HTTP_4XX', '图片路径必须是绝对路径', false, { imagePath })
    }
    const ext = extname(imagePath).toLowerCase()
    if (!IMAGE_EXTENSIONS.has(ext)) {
      throw new AppErrorClass('HTTP_4XX', '只支持 JPEG、PNG、WEBP 图片', false, { imagePath })
    }
    const info = await stat(imagePath)
    if (info.size > IMAGE_SIZE_LIMIT_BYTES) {
      throw new AppErrorClass('HTTP_4XX', '图片不能超过 20MB', false, { imagePath })
    }
    const buffer = await readFile(imagePath)
    const meta = await sharp(buffer).metadata()
    const width = meta.width ?? 0
    const height = meta.height ?? 0
    if (mode === 'image-to-video') {
      if (width < 300 || height < 300) {
        throw new AppErrorClass('HTTP_4XX', '首帧图宽高都不能小于 300px', false, { imagePath })
      }
      const ratio = width / height
      if (ratio < 1 / 2.5 || ratio > 2.5) {
        throw new AppErrorClass('HTTP_4XX', '首帧图宽高比必须在 1:2.5 到 2.5:1 之间', false, {
          imagePath,
        })
      }
    } else if (Math.min(width, height) < 400) {
      throw new AppErrorClass('HTTP_4XX', '参考图短边不能低于 400px', false, { imagePath })
    }
    const mime = mimeTypeFromPath(imagePath)
    const sha256 = createHash('sha256').update(buffer).digest('hex')
    results.push({
      path: imagePath,
      name: basename(imagePath),
      mime,
      bytes: info.size,
      sha256,
      width,
      height,
      dataUrl: `data:${mime};base64,${buffer.toString('base64')}`,
    })
  }
  return results
}

export function buildHappyHorsePayload(input: VideoRunInput, images: VideoImageMetadata[]) {
  const model = resolveHappyHorseModel(input.mode, input.modelVersion)
  const media =
    input.mode === 'image-to-video'
      ? [{ type: 'first_frame', url: images[0]?.dataUrl ?? '' }]
      : images.map((image) => ({ type: 'reference_image', url: image.dataUrl }))
  const payload: Record<string, unknown> = {
    model,
    input: {
      media,
    },
    parameters: {
      resolution: input.resolution,
      duration: input.duration,
      watermark: input.watermark,
    },
  }
  if (input.prompt?.trim()) {
    ;(payload.input as Record<string, unknown>).prompt = input.prompt.trim()
  }
  if (input.mode === 'reference-to-video' && input.ratio) {
    ;(payload.parameters as Record<string, unknown>).ratio = input.ratio
  }
  return payload
}

async function createHappyHorseTask(
  apiKey: string,
  payload: Record<string, unknown>,
  createFetch: typeof fetch,
) {
  const response = await createFetch(
    `${HAPPYHORSE_BASE_URL}/services/aigc/video-generation/video-synthesis`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'X-DashScope-Async': 'enable',
      },
      body: JSON.stringify(payload),
    },
  )
  if (!response.ok) {
    throw await toHappyHorseHttpError(response)
  }
  return (await response.json()) as HappyHorseCreateResponse
}

async function queryHappyHorseTask(
  apiKey: string,
  remoteTaskId: string,
  createFetch: typeof fetch,
) {
  const response = await createFetch(`${HAPPYHORSE_BASE_URL}/tasks/${remoteTaskId}`, {
    headers: {
      Authorization: `Bearer ${apiKey}`,
    },
  })
  if (!response.ok) {
    throw await toHappyHorseHttpError(response)
  }
  return (await response.json()) as HappyHorseTaskResponse
}

async function toHappyHorseHttpError(response: Response) {
  const text = await response.text().catch(() => '')
  if (response.status === 401 || response.status === 403) {
    return new AppErrorClass('HTTP_4XX', '阿里云百炼 API Key 无效或无权调用 HappyHorse', false, {
      status: response.status,
      body: text,
    })
  }
  if (response.status === 429) {
    return new AppErrorClass('HTTP_429', '阿里云百炼请求过于频繁，请稍后重试', true, {
      status: response.status,
      body: text,
    })
  }
  if (response.status === 402) {
    return new AppErrorClass('BAILIAN_QUOTA_EXCEEDED', '阿里云百炼额度不足', false, {
      status: response.status,
      body: text,
    })
  }
  if (response.status >= 500) {
    return new AppErrorClass('HTTP_5XX', '阿里云百炼服务暂时不可用', true, {
      status: response.status,
      body: text,
    })
  }
  return new AppErrorClass('HTTP_4XX', '阿里云百炼请求参数不正确', false, {
    status: response.status,
    body: text,
  })
}

async function downloadVideo(createFetch: typeof fetch, url: string, outputPath: string) {
  const response = await createFetch(url)
  if (!response.ok) {
    throw new AppErrorClass(
      'HTTP_5XX',
      '视频生成成功，但下载保存失败，请检查网络后重新生成',
      true,
      {
        status: response.status,
        url,
      },
    )
  }
  const arrayBuffer = await response.arrayBuffer()
  const buffer = Buffer.from(arrayBuffer)
  if (buffer.byteLength <= 0) {
    throw new AppErrorClass(
      'HTTP_5XX',
      '视频生成成功，但下载保存失败，请检查网络后重新生成',
      true,
      {
        url,
        bytes: 0,
      },
    )
  }
  await mkdir(dirname(outputPath), { recursive: true })
  await writeFile(outputPath, buffer)
  return buffer.byteLength
}

function taskStepId(taskId: string) {
  return `${taskId}:video:0`
}

function registerVideoTask(
  db: Pick<SqliteDatabase, 'exec' | 'prepare'>,
  taskId: string,
  input: VideoRunInput,
  now: number,
) {
  ensureVideoTables(db)
  db.prepare(`
    INSERT INTO tasks (
      id, module, type, status, input_json, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      status = excluded.status,
      input_json = excluded.input_json,
      updated_at = excluded.updated_at
  `).run(taskId, 'video', 'lightweight', 'running', JSON.stringify(input), now, now)
  db.prepare(`
    INSERT INTO workflow_steps (
      id, task_id, module, step, status, attempt, params_snapshot, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      status = excluded.status,
      params_snapshot = excluded.params_snapshot,
      updated_at = excluded.updated_at
  `).run(taskStepId(taskId), taskId, 'video', 'video', 'running', 0, JSON.stringify(input), now)
}

function completeVideoTask(
  db: Pick<SqliteDatabase, 'prepare'>,
  taskId: string,
  result: Record<string, unknown>,
  status: 'completed' | 'failed' | 'stopped',
  now: number,
  error?: unknown,
) {
  db.prepare(`
    UPDATE tasks
    SET status = ?, result_json = ?, error_json = ?, updated_at = ?
    WHERE id = ?
  `).run(status, JSON.stringify(result), error ? JSON.stringify(error) : null, now, taskId)
  db.prepare(`
    UPDATE workflow_steps
    SET status = ?, output_json = ?, error_json = ?, updated_at = ?
    WHERE id = ?
  `).run(
    status,
    JSON.stringify(result),
    error ? JSON.stringify(error) : null,
    now,
    taskStepId(taskId),
  )
}

async function registerVideoArtifact(
  db: Pick<SqliteDatabase, 'exec' | 'prepare'>,
  input: {
    taskId: string
    outputPath: string
    prompt: string
    model: string
    params: Record<string, unknown>
    createdAt: number
  },
) {
  ensureVideoTables(db)
  const [fileHash, info] = await Promise.all([hashFile(input.outputPath), stat(input.outputPath)])
  db.prepare(`
    INSERT INTO artifacts (
      id, task_id, step, provider, model_or_workflow, source_artifact_ids, file_path, file_size, file_hash, prompt_snapshot, params_snapshot, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    `art_video_${randomUUID().replace(/-/g, '').slice(0, 12)}`,
    input.taskId,
    'video',
    'aliyun-bailian',
    input.model,
    '[]',
    input.outputPath,
    info.size,
    fileHash,
    input.prompt,
    JSON.stringify(input.params),
    input.createdAt,
  )
}

function ensureVideoTaskRecord(taskId: string, mode: VideoGenerationMode) {
  const record = tasks.get(taskId)
  if (record) {
    return record
  }
  const next = { stopped: false, mode, logs: [] }
  tasks.set(taskId, next)
  return next
}

function stopVideoTask(taskId: string) {
  const record = tasks.get(taskId)
  if (!record) {
    return false
  }
  record.stopped = true
  return true
}

export class VideoGenerationService {
  private readonly dependencies: Required<VideoGenerationDependencies>

  constructor(dependencies: VideoGenerationDependencies = {}) {
    this.dependencies = {
      readConfig: dependencies.readConfig ?? readAppConfig,
      getSecret: dependencies.getSecret ?? getSecret,
      createFetch: dependencies.createFetch ?? fetch,
      sleep: dependencies.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms))),
      openDatabase: dependencies.openDatabase ?? openWorkbenchDatabase,
      now: dependencies.now ?? Date.now,
    }
  }

  async run(input: VideoRunInput) {
    const config = await this.dependencies.readConfig()
    if (!config.workbench_root) {
      throw new AppErrorClass('HTTP_4XX', '请先在设置里选择工作区', false)
    }
    const apiKey = await this.dependencies.getSecret('bailian')
    if (!apiKey) {
      throw new AppErrorClass('HTTP_4XX', '请先到设置页填写阿里云百炼 API Key', false)
    }

    const taskId = `video_${randomUUID().replace(/-/g, '').slice(0, 12)}`
    ensureVideoTaskRecord(taskId, input.mode)
    void this.runInBackground(taskId, input, config.workbench_root, apiKey)
    return taskId
  }

  cancel(taskId: string) {
    return stopVideoTask(taskId)
  }

  private async runInBackground(
    taskId: string,
    input: VideoRunInput,
    workbenchRoot: string,
    apiKey: string,
  ) {
    const diagnostics = await createOptionalDiagnosticLogWriter({
      module: 'video',
      taskId,
      workbenchRoot,
      meta: {
        mode: input.mode,
        modelVersion: input.modelVersion,
        resolution: input.resolution,
        duration: input.duration,
      },
    })
    const db = this.dependencies.openDatabase(workbenchRoot)
    const createdAt = this.dependencies.now()
    try {
      registerVideoTask(db, taskId, input, createdAt)
      emitVideoProgress({
        task_id: taskId,
        mode: input.mode,
        status: 'validating',
        message: '正在校验本地图片',
        ...(diagnostics ? { diagnosticsLogPath: diagnostics.path } : {}),
      })
      emitRuntimeLog(
        newRuntimeLogEntry(input.mode, '开始校验本地图片', 'info', taskId, {
          operation: 'validate',
          imageCount: input.imagePaths.length,
        }),
      )
      const images = await validateVideoImages(input.mode, input.imagePaths)
      await diagnostics?.append({
        type: 'validated_images',
        operation: 'validate',
        data: {
          images: images.map((image) => ({
            path: image.path,
            name: image.name,
            mime: image.mime,
            bytes: image.bytes,
            sha256: image.sha256,
            width: image.width,
            height: image.height,
          })),
        },
      })

      const payload = buildHappyHorsePayload(input, images)
      emitVideoProgress({
        task_id: taskId,
        mode: input.mode,
        status: 'submitting',
        message: '正在提交 HappyHorse 任务',
        ...(diagnostics ? { diagnosticsLogPath: diagnostics.path } : {}),
      })
      emitRuntimeLog(
        newRuntimeLogEntry(input.mode, '提交 HappyHorse 任务', 'info', taskId, {
          operation: 'submit',
          model: resolveHappyHorseModel(input.mode, input.modelVersion),
          resolution: input.resolution,
          duration: input.duration,
          ...(input.ratio ? { ratio: input.ratio } : {}),
        }),
      )
      await diagnostics?.append({
        type: 'submit_payload',
        provider: 'aliyun-bailian',
        operation: 'submit',
        data: payload,
      })
      const createResponse = await createHappyHorseTask(
        apiKey,
        payload,
        this.dependencies.createFetch,
      )
      await diagnostics?.append({
        type: 'submit_response',
        provider: 'aliyun-bailian',
        operation: 'submit',
        data: createResponse,
      })
      const remoteTaskId = createResponse.output?.task_id?.trim()
      if (!remoteTaskId) {
        throw new AppErrorClass('HTTP_5XX', 'HappyHorse 未返回 task_id', true, {
          response: createResponse,
        })
      }
      emitRuntimeLog(
        newRuntimeLogEntry(input.mode, '已获取 task_id', 'info', taskId, {
          operation: 'submit',
          remoteTaskId,
        }),
      )

      let videoUrl = ''
      let remoteTaskIdForResult = remoteTaskId
      while (true) {
        const record = tasks.get(taskId)
        if (record?.stopped) {
          emitRuntimeLog(
            newRuntimeLogEntry(input.mode, '用户已停止查询', 'warn', taskId, {
              operation: 'stop',
              remoteTaskId,
            }),
          )
          emitVideoProgress({
            task_id: taskId,
            mode: input.mode,
            status: 'stopped',
            message: '已停止查询，云端任务可能继续运行并计费',
            remoteTaskId,
            ...(diagnostics ? { diagnosticsLogPath: diagnostics.path } : {}),
          })
          completeVideoTask(
            db,
            taskId,
            { remoteTaskId, stopped: true },
            'stopped',
            this.dependencies.now(),
          )
          emitVideoCompleted({
            ok: false,
            task_id: taskId,
            mode: input.mode,
            error: '已停止查询，云端任务可能继续运行并计费',
            ...(diagnostics ? { diagnosticsLogPath: diagnostics.path } : {}),
          })
          return
        }

        const taskResponse = await queryHappyHorseTask(
          apiKey,
          remoteTaskId,
          this.dependencies.createFetch,
        )
        await diagnostics?.append({
          type: 'poll_response',
          provider: 'aliyun-bailian',
          operation: 'poll',
          data: taskResponse,
        })
        const taskStatus = mapHappyHorseTaskStatus(taskResponse.output?.task_status)
        emitRuntimeLog(
          newRuntimeLogEntry(input.mode, '轮询任务状态', 'info', taskId, {
            operation: 'poll',
            remoteTaskId,
            taskStatus,
          }),
        )
        if (taskStatus === 'PENDING' || taskStatus === 'RUNNING') {
          emitVideoProgress({
            task_id: taskId,
            mode: input.mode,
            status: mapTaskStatusToProgressStatus(taskStatus),
            message: taskStatus === 'PENDING' ? '任务排队中' : '任务生成中',
            taskStatus,
            remoteTaskId,
            ...(diagnostics ? { diagnosticsLogPath: diagnostics.path } : {}),
          })
          await this.dependencies.sleep(VIDEO_POLL_INTERVAL_MS)
          continue
        }
        if (taskStatus === 'SUCCEEDED') {
          videoUrl =
            taskResponse.output?.results?.[0]?.video_url?.trim() ??
            taskResponse.output?.video_url?.trim() ??
            ''
          if (!videoUrl) {
            throw new AppErrorClass('HTTP_5XX', 'HappyHorse 成功但未返回 video_url', true, {
              response: taskResponse,
            })
          }
          remoteTaskIdForResult = taskResponse.output?.task_id?.trim() || remoteTaskId
          break
        }

        const errorMessage =
          taskStatus === 'CANCELED'
            ? '任务已取消'
            : taskStatus === 'UNKNOWN'
              ? '任务不存在或已过期，请重新生成'
              : `${taskResponse.code ?? 'FAILED'} ${taskResponse.message ?? '视频生成失败'}`
        throw new AppErrorClass('HTTP_4XX', errorMessage, false, {
          taskStatus,
          response: taskResponse,
        })
      }

      const outputPath = videoOutputPath(workbenchRoot, input.mode, input.taskName ?? '')
      await assertTargetDoesNotExist(outputPath).catch(() => {
        throw new AppErrorClass(
          'HTTP_4XX',
          '保存目录里已存在 0001.mp4，请更换任务名或删除旧文件后重试。',
          false,
          { outputPath },
        )
      })
      emitVideoProgress({
        task_id: taskId,
        mode: input.mode,
        status: 'downloading',
        message: '正在下载视频到本地',
        remoteTaskId: remoteTaskIdForResult,
        videoUrl,
        ...(diagnostics ? { diagnosticsLogPath: diagnostics.path } : {}),
      })
      emitRuntimeLog(
        newRuntimeLogEntry(input.mode, '开始下载视频', 'info', taskId, {
          operation: 'download',
          videoUrl,
          outputPath,
        }),
      )
      await diagnostics?.append({
        type: 'download_start',
        provider: 'aliyun-bailian',
        operation: 'download',
        data: { videoUrl, outputPath },
      })
      const bytes = await downloadVideo(this.dependencies.createFetch, videoUrl, outputPath)
      await diagnostics?.append({
        type: 'download_complete',
        provider: 'aliyun-bailian',
        operation: 'download',
        data: { videoUrl, outputPath, bytes },
      })

      const model = resolveHappyHorseModel(input.mode, input.modelVersion)
      await registerVideoArtifact(db, {
        taskId,
        outputPath,
        prompt: input.prompt?.trim() ?? '',
        model,
        params: {
          mode: input.mode,
          resolution: input.resolution,
          duration: input.duration,
          watermark: input.watermark,
          ...(input.ratio ? { ratio: input.ratio } : {}),
        },
        createdAt: this.dependencies.now(),
      })
      completeVideoTask(
        db,
        taskId,
        { remoteTaskId: remoteTaskIdForResult, outputPath, videoUrl },
        'completed',
        this.dependencies.now(),
      )
      emitRuntimeLog(
        newRuntimeLogEntry(input.mode, '视频已保存到本地', 'info', taskId, {
          operation: 'completed',
          outputPath,
          videoUrl,
        }),
      )
      emitVideoProgress({
        task_id: taskId,
        mode: input.mode,
        status: 'succeeded',
        message: '视频生成完成',
        outputPath,
        videoUrl,
        ...(diagnostics ? { diagnosticsLogPath: diagnostics.path } : {}),
      })
      emitVideoCompleted({
        ok: true,
        task_id: taskId,
        mode: input.mode,
        remoteTaskId: remoteTaskIdForResult,
        videoUrl,
        outputPath,
        ...(diagnostics ? { diagnosticsLogPath: diagnostics.path } : {}),
      })
    } catch (error) {
      await diagnostics?.append({
        type: 'task_failed',
        provider: 'aliyun-bailian',
        operation: 'error',
        error: errorForDiagnosticLog(error),
      })
      const message = error instanceof Error ? error.message : String(error)
      completeVideoTask(
        db,
        taskId,
        { error: message },
        'failed',
        this.dependencies.now(),
        errorForDiagnosticLog(error),
      )
      emitRuntimeLog(
        newRuntimeLogEntry(input.mode, '视频生成失败', 'error', taskId, {
          operation: 'error',
          error: message,
        }),
      )
      emitVideoProgress({
        task_id: taskId,
        mode: input.mode,
        status: 'failed',
        message,
        error: message,
        ...(diagnostics ? { diagnosticsLogPath: diagnostics.path } : {}),
      })
      emitVideoCompleted({
        ok: false,
        task_id: taskId,
        mode: input.mode,
        error: message,
        ...(diagnostics ? { diagnosticsLogPath: diagnostics.path } : {}),
      })
    } finally {
      tasks.delete(taskId)
      db.close()
    }
  }
}

export const videoGenerationService = new VideoGenerationService()

export async function chooseVideoImages(input?: { multiple?: boolean }) {
  const config = await readAppConfig()
  const result = await dialog.showOpenDialog({
    ...(config.workbench_root
      ? { defaultPath: join(config.workbench_root, WORKBENCH_DIRECTORIES.video) }
      : {}),
    properties: input?.multiple ? ['openFile', 'multiSelections'] : ['openFile'],
    filters: [
      {
        name: 'Images',
        extensions: ['jpg', 'jpeg', 'png', 'webp'],
      },
    ],
    title: '选择视频输入图片',
  })
  if (result.canceled || result.filePaths.length === 0) {
    return { ok: false, error: { code: 'CANCELLED', message: '已取消选择图片' } }
  }
  return { ok: true, data: { paths: result.filePaths } }
}

async function openVideoPath(path: string) {
  const config = await readAppConfig()
  if (!config.workbench_root) {
    throw new AppErrorClass('HTTP_4XX', '请先在设置里选择工作区', false)
  }
  await assertPathInsideWorkbench(config.workbench_root, path, {
    domain: 'visible-workbench',
    label: '视频打开路径',
  })
  const error = await shell.openPath(path)
  if (error) {
    return { ok: false, error: { code: 'OPEN_PATH_FAILED', message: error } }
  }
  return { ok: true }
}

export function registerVideoGenerationIpc() {
  ipcMain.handle('video:choose-images', (_event, input: unknown) =>
    chooseVideoImages(
      input && typeof input === 'object' && 'multiple' in input
        ? { multiple: Boolean((input as { multiple?: unknown }).multiple) }
        : undefined,
    ),
  )
  ipcMain.handle('video:run', (_event, input: unknown) =>
    videoGenerationService.run(
      parseVideoIpcInput(videoRunInputSchema, input, '视频生成任务参数不正确'),
    ),
  )
  ipcMain.handle('video:stop', (_event, input: unknown) => ({
    ok: videoGenerationService.cancel(
      parseVideoIpcInput(videoTaskIdInputSchema, input, '视频停止参数不正确').task_id,
    ),
  }))
  ipcMain.handle('video:open-path', (_event, input: unknown) =>
    openVideoPath(
      parseVideoIpcInput(videoOpenPathInputSchema, input, '视频打开路径参数不正确').path,
    ),
  )
}
