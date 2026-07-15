import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { access, readFile } from 'node:fs/promises'
import {
  AppErrorClass,
  type PhotoshopJob,
  type PhotoshopJobResult,
  type PhotoshopProgressLogEntry,
  type PhotoshopTaskGroup,
  type PsdTemplate,
} from '@tengyu-aipod/shared'
import {
  errorForDiagnosticLog,
  writeOptionalDiagnosticLogEvent,
} from '../lib/diagnostic-log-service'
import type { SqliteDatabase } from '../lib/sqlite'
import { getConfiguredWorkbenchRoot } from '../lib/workbench-config'
import { getDefaultWorkbenchDatabase } from '../lib/workbench-db'
import { type PhotoshopComAdapter, photoshopComAdapter } from './com-adapter'
import {
  type PhotoshopTemplateBatchJsxFile,
  writePhotoshopJobJsx,
  writePhotoshopTemplateBatchJsx,
} from './jsx-generator'

type AccessFn = (path: string) => Promise<void>
type TextReader = (path: string, encoding: BufferEncoding) => Promise<string>
type SleepFn = (ms: number) => Promise<void>
type HashFileFn = (path: string) => Promise<string>
type JsxWriter = (job: Omit<PhotoshopJob, 'result_file_path'>) => Promise<{
  jsx_path: string
  result_file_path: string
}>
type TemplateBatchJsxWriter = (
  template: PsdTemplate,
  groups: PhotoshopTaskGroup[],
  cancelFilePath: string,
) => Promise<PhotoshopTemplateBatchJsxFile>

export interface WorkflowStepRecorder {
  recordRunning(job: PhotoshopJob, attempt: number): Promise<void>
  recordCompleted(job: PhotoshopJob, attempt: number, outputs: string[]): Promise<void>
  recordFailed(job: PhotoshopJob, attempt: number, error: AppErrorClass): Promise<void>
  recordCancelled?(job: PhotoshopJob, attempt: number): Promise<void>
}

interface PhotoshopExecutionEngineOptions {
  platform?: NodeJS.Platform
  comAdapter?: Pick<PhotoshopComAdapter, 'runJsxFile'>
  writeJsx?: JsxWriter
  readTextFile?: TextReader
  accessFile?: AccessFn
  sleep?: SleepFn
  recorder?: WorkflowStepRecorder
  shouldSkipJob?: (job: PhotoshopJob) => Promise<boolean>
  writeTemplateBatchJsx?: TemplateBatchJsxWriter
  readDiagnosticWorkbenchRoot?: () => Promise<string | null>
}

interface RawJsxResult {
  ok?: boolean
  error?: string
  outputs?: unknown
  stages?: unknown
}

const MAX_RETRIES = 5

function pathBasename(filePath: string) {
  return filePath.split(/[\\/]/).pop() ?? filePath
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

const executionMutex = new PromiseMutex()

const noopRecorder: WorkflowStepRecorder = {
  async recordRunning() {},
  async recordCompleted() {},
  async recordFailed() {},
}

type DatabaseProvider = () => SqliteDatabase | Promise<SqliteDatabase>

export async function hashOutputFile(path: string): Promise<string> {
  return new Promise((resolveHash, reject) => {
    const hash = createHash('sha256')
    const stream = createReadStream(path)
    stream.on('error', reject)
    stream.on('data', (chunk) => hash.update(chunk))
    stream.on('end', () => resolveHash(hash.digest('hex')))
  })
}

export function createPhotoshopJobSignature(job: PhotoshopJob): string {
  const replacements = [...job.so_replacements]
    .map((replacement) => ({
      inner_fit_mode: replacement.inner_fit_mode ?? 'fill',
      inner_layer_name: replacement.inner_layer_name ?? '',
      inner_layer_path: replacement.inner_layer_path ?? '',
      input_image: replacement.input_image,
      layer_path: replacement.layer_path,
      replace_mode: replacement.replace_mode ?? job.smart_object_replace_mode ?? 'replaceContents',
    }))
    .sort((left, right) => {
      const layerCompare = left.layer_path.localeCompare(right.layer_path)
      return layerCompare !== 0 ? layerCompare : left.input_image.localeCompare(right.input_image)
    })
  return createHash('sha256')
    .update(
      JSON.stringify({
        mockup_path: job.mockup_path,
        smart_object_replace_mode: job.smart_object_replace_mode ?? 'replaceContents',
        so_replacements: replacements,
        clip_mode: job.clip_mode ?? 'auto',
        format: job.format,
      }),
    )
    .digest('hex')
}

interface ArtifactRow {
  file_path: string
  file_hash: string
}

interface RawTemplateBatchGroupResult {
  group_index?: unknown
  sku_folder?: unknown
  outputs?: unknown
  skipped?: unknown
  error?: unknown
}

interface RawTemplateBatchResult {
  ok?: boolean
  cancelled?: boolean
  error?: string
  outputs?: unknown
  groups?: unknown
}

interface ShouldSkipJobOptions {
  db?: SqliteDatabase
  dbProvider?: DatabaseProvider
  accessFile?: AccessFn
  hashFile?: HashFileFn
}

export async function shouldSkipJob(
  job: PhotoshopJob,
  options: ShouldSkipJobOptions = {},
): Promise<boolean> {
  const dbProvider = options.db ? () => options.db as SqliteDatabase : options.dbProvider
  if (!dbProvider) {
    return false
  }

  const db = await dbProvider()
  const signature = createPhotoshopJobSignature(job)
  const rows = db
    .prepare(
      `SELECT params_snapshot
       FROM workflow_steps
       WHERE task_id = ?
         AND module = 'photoshop'
         AND status = 'completed'`,
    )
    .all(job.task_id) as Array<{ params_snapshot: string }>
  const hasCompletedStep = rows.some((row) => {
    try {
      const snapshot = JSON.parse(row.params_snapshot) as { job_signature?: unknown }
      return snapshot.job_signature === signature
    } catch {
      return false
    }
  })
  if (!hasCompletedStep) {
    return false
  }

  const accessFile = options.accessFile ?? access
  for (const outputPath of job.output_paths) {
    try {
      await accessFile(outputPath)
    } catch {
      return false
    }
  }

  if (job.output_paths.length === 0) {
    return false
  }

  const placeholders = job.output_paths.map(() => '?').join(',')
  const artifactRows = db
    .prepare(
      `SELECT file_path, file_hash
       FROM artifacts
       WHERE provider = 'photoshop'
         AND file_path IN (${placeholders})`,
    )
    .all(...job.output_paths) as unknown as ArtifactRow[]
  const expectedHashes = new Map(artifactRows.map((row) => [row.file_path, row.file_hash]))
  if (!job.output_paths.every((outputPath) => expectedHashes.has(outputPath))) {
    return false
  }

  const hashFile = options.hashFile ?? hashOutputFile
  for (const outputPath of job.output_paths) {
    if ((await hashFile(outputPath)) !== expectedHashes.get(outputPath)) {
      return false
    }
  }

  return true
}

export class SqlitePhotoshopWorkflowStepRecorder implements WorkflowStepRecorder {
  private readonly dbProvider: DatabaseProvider
  private readonly hashFile: HashFileFn

  constructor(
    options: {
      db?: SqliteDatabase
      dbProvider?: DatabaseProvider
      hashFile?: HashFileFn
    } = {},
  ) {
    this.dbProvider = options.db
      ? () => options.db as SqliteDatabase
      : (options.dbProvider ?? getDefaultWorkbenchDatabase)
    this.hashFile = options.hashFile ?? hashOutputFile
  }

  async recordRunning(job: PhotoshopJob, attempt: number): Promise<void> {
    const db = await this.db()
    db.prepare(
      `INSERT INTO workflow_steps (
        id,
        task_id,
        module,
        step,
        status,
        attempt,
        params_snapshot,
        updated_at
      ) VALUES (
        @id,
        @task_id,
        @module,
        @step,
        @status,
        @attempt,
        @params_snapshot,
        @updated_at
      )
      ON CONFLICT(id) DO UPDATE SET
        status = excluded.status,
        attempt = excluded.attempt,
        params_snapshot = excluded.params_snapshot,
        updated_at = excluded.updated_at`,
    ).run({
      id: this.stepId(job),
      task_id: job.task_id,
      module: 'photoshop',
      step: `group-${job.group_index}`,
      status: 'running',
      attempt,
      params_snapshot: JSON.stringify({
        group_index: job.group_index,
        job_signature: createPhotoshopJobSignature(job),
        mockup_path: job.mockup_path,
        output_paths: job.output_paths,
        clip_mode: job.clip_mode ?? 'auto',
        format: job.format,
      }),
      updated_at: Date.now(),
    })
  }

  async recordCompleted(job: PhotoshopJob, attempt: number, outputs: string[]): Promise<void> {
    const db = await this.db()
    const outputHashes: Record<string, string> = {}
    for (const output of outputs) {
      outputHashes[output] = await this.hashFile(output)
    }
    db.prepare(
      `UPDATE workflow_steps
      SET status = @status,
          attempt = @attempt,
          output_json = @output_json,
          error_json = NULL,
          updated_at = @updated_at
      WHERE id = @id`,
    ).run({
      id: this.stepId(job),
      status: 'completed',
      attempt,
      output_json: JSON.stringify({ outputs, output_hashes: outputHashes }),
      updated_at: Date.now(),
    })

    const artifactStatement = db.prepare(
      `INSERT INTO artifacts (
        id,
        task_id,
        step,
        provider,
        model_or_workflow,
        file_path,
        file_hash,
        params_snapshot,
        created_at
      ) VALUES (
        @id,
        @task_id,
        @step,
        @provider,
        @model_or_workflow,
        @file_path,
        @file_hash,
        @params_snapshot,
        @created_at
      )
      ON CONFLICT(id) DO UPDATE SET
        task_id = excluded.task_id,
        step = excluded.step,
        provider = excluded.provider,
        model_or_workflow = excluded.model_or_workflow,
        file_hash = excluded.file_hash,
        params_snapshot = excluded.params_snapshot,
        created_at = excluded.created_at`,
    )
    for (const output of outputs) {
      const fileHash = outputHashes[output]
      if (!fileHash) {
        throw new AppErrorClass('HTTP_5XX', 'Photoshop 输出 hash 缺失', true, {
          file_path: output,
        })
      }
      artifactStatement.run({
        id: `artifact:${createHash('sha1').update(output).digest('hex')}`,
        task_id: job.task_id,
        step: 'mockup',
        provider: 'photoshop',
        model_or_workflow: pathBasename(job.mockup_path),
        file_path: output,
        file_hash: fileHash,
        params_snapshot: JSON.stringify({
          group_index: job.group_index,
          job_signature: createPhotoshopJobSignature(job),
          mockup_path: job.mockup_path,
          output_path: output,
          clip_mode: job.clip_mode ?? 'auto',
          format: job.format,
        }),
        created_at: Date.now(),
      })
    }
  }

  async recordFailed(job: PhotoshopJob, attempt: number, error: AppErrorClass): Promise<void> {
    const db = await this.db()
    db.prepare(
      `UPDATE workflow_steps
      SET status = @status,
          attempt = @attempt,
          error_json = @error_json,
          updated_at = @updated_at
      WHERE id = @id`,
    ).run({
      id: this.stepId(job),
      status: 'failed',
      attempt,
      error_json: JSON.stringify({
        code: error.code,
        message: error.message,
        retryable: error.retryable,
        details: error.details,
      }),
      updated_at: Date.now(),
    })
  }

  async recordCancelled(job: PhotoshopJob, attempt: number): Promise<void> {
    const db = await this.db()
    db.prepare(
      `UPDATE workflow_steps
      SET status = @status,
          attempt = @attempt,
          error_json = @error_json,
          updated_at = @updated_at
      WHERE id = @id`,
    ).run({
      id: this.stepId(job),
      status: 'cancelled',
      attempt,
      error_json: JSON.stringify({
        code: 'CANCELLED',
        message: '用户取消 PS 套版任务',
        retryable: false,
      }),
      updated_at: Date.now(),
    })
  }

  private async db(): Promise<SqliteDatabase> {
    const db = await this.dbProvider()
    return db
  }

  private stepId(job: PhotoshopJob): string {
    return `${job.task_id}:photoshop:${job.group_index}`
  }
}

const photoshopWorkflowStepRecorder = new SqlitePhotoshopWorkflowStepRecorder()

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message
  }
  return String(error)
}

function normalizeError(error: unknown): AppErrorClass {
  if (error instanceof AppErrorClass) {
    return error
  }
  return new AppErrorClass(
    'JSX_EXEC_FAILED',
    `Photoshop 执行失败：${getErrorMessage(error)}`,
    false,
    {
      cause_message: getErrorMessage(error),
    },
  )
}

function classifyJsxResult(result: RawJsxResult, job: PhotoshopJob): AppErrorClass | null {
  if (result.ok === true) {
    return null
  }
  const error = String(result.error ?? 'Photoshop JSX 未返回成功状态')
  const code = /Smart object layer not found/i.test(error)
    ? 'TEMPLATE_SCAN_FAILED'
    : 'JSX_EXEC_FAILED'
  return new AppErrorClass(code, `Photoshop JSX 执行失败：${error}`, false, {
    task_id: job.task_id,
    group_index: job.group_index,
    jsx_result: result as Record<string, unknown>,
  })
}

function classifyTemplateBatchResult(
  result: RawTemplateBatchResult,
  template: PsdTemplate,
): AppErrorClass | null {
  if (result.ok === true || result.cancelled === true) {
    return null
  }
  const error = String(result.error ?? 'Photoshop 模板批处理未返回成功状态')
  return new AppErrorClass('JSX_EXEC_FAILED', `Photoshop 模板批处理失败：${error}`, false, {
    template_id: template.id,
    template_path: template.file_path,
    jsx_result: result as Record<string, unknown>,
  })
}

function normalizeTemplateBatchGroups(
  result: RawTemplateBatchResult,
  pendingGroups: PhotoshopTaskGroup[],
): Array<{
  group_index: number
  sku_folder: string
  outputs: string[]
}> {
  const rawGroups = Array.isArray(result.groups)
    ? (result.groups as RawTemplateBatchGroupResult[])
    : []
  return rawGroups
    .filter((group) => group.error === undefined)
    .map((group) => {
      const groupIndex = Number(group.group_index)
      const sourceGroup = pendingGroups.find((item) => item.group_index === groupIndex)
      const outputs = Array.isArray(group.outputs)
        ? group.outputs.map((output) => String(output))
        : (sourceGroup?.job.output_paths ?? [])
      return {
        group_index: Number.isFinite(groupIndex) ? groupIndex : (sourceGroup?.group_index ?? 0),
        sku_folder: String(group.sku_folder ?? sourceGroup?.sku_folder ?? 'group'),
        outputs,
      }
    })
}

function retryDelayMs(attempt: number): number {
  return 2 ** attempt * 1000
}

function isRetryable(error: AppErrorClass): boolean {
  return error.retryable
}

export class PhotoshopExecutionEngine {
  private readonly platform: NodeJS.Platform
  private readonly comAdapter: Pick<PhotoshopComAdapter, 'runJsxFile'>
  private readonly writeJsx: JsxWriter
  private readonly readTextFile: TextReader
  private readonly accessFile: AccessFn
  private readonly sleep: SleepFn
  private readonly recorder: WorkflowStepRecorder
  private readonly shouldSkipJob: (job: PhotoshopJob) => Promise<boolean>
  private readonly writeTemplateBatchJsx: TemplateBatchJsxWriter
  private readonly readDiagnosticWorkbenchRoot: () => Promise<string | null>

  constructor(options: PhotoshopExecutionEngineOptions = {}) {
    this.platform = options.platform ?? process.platform
    this.comAdapter = options.comAdapter ?? photoshopComAdapter
    this.writeJsx = options.writeJsx ?? writePhotoshopJobJsx
    this.readTextFile = options.readTextFile ?? readFile
    this.accessFile = options.accessFile ?? access
    this.sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)))
    this.recorder = options.recorder ?? photoshopWorkflowStepRecorder
    this.shouldSkipJob =
      options.shouldSkipJob ??
      ((job) => shouldSkipJob(job, { dbProvider: getDefaultWorkbenchDatabase }))
    this.readDiagnosticWorkbenchRoot =
      options.readDiagnosticWorkbenchRoot ?? getConfiguredWorkbenchRoot
    this.writeTemplateBatchJsx =
      options.writeTemplateBatchJsx ??
      ((template, groups, cancelFilePath) =>
        writePhotoshopTemplateBatchJsx({
          task_id: groups[0]?.job.task_id ?? 'photoshop-batch',
          mockup_path: template.file_path,
          template_name: groups[0]?.template_name ?? pathBasename(template.file_path),
          cancel_file_path: cancelFilePath,
          groups: groups.map((group) => ({
            group_index: group.group_index,
            sku_folder: group.sku_folder,
            ...(group.job.smart_object_replace_mode
              ? { smart_object_replace_mode: group.job.smart_object_replace_mode }
              : {}),
            so_replacements: group.job.so_replacements,
            clip_areas: group.job.clip_areas,
            output_paths: group.job.output_paths,
            format: group.job.format,
            jpg_quality: group.job.jpg_quality,
          })),
        }))
  }

  async runJob(
    job: PhotoshopJob,
    maxRetries = 0,
    options: { skipCompleted?: boolean } = {},
  ): Promise<PhotoshopJobResult> {
    this.assertWindows()
    const attempts = Math.min(Math.max(maxRetries, 0), MAX_RETRIES) + 1
    let lastError: AppErrorClass | null = null

    return executionMutex.runExclusive(async () => {
      if (options.skipCompleted === true && (await this.shouldSkipJob(job))) {
        return { ok: true, outputs: job.output_paths, attempts: 0, skipped: true }
      }

      for (let attempt = 0; attempt < attempts; attempt += 1) {
        await this.recorder.recordRunning(job, attempt)
        try {
          const result = await this.runOnce(job)
          await this.recorder.recordCompleted(job, attempt, result.outputs)
          return { ...result, attempts: attempt + 1 }
        } catch (error) {
          const appError = normalizeError(error)
          lastError = appError
          await this.recorder.recordFailed(job, attempt, appError)
          if (!isRetryable(appError) || attempt === attempts - 1) {
            await this.writePhotoshopDiagnostic({
              type: 'photoshop_job_failed',
              operation: 'runJob',
              job,
              attempt,
              error: appError,
            })
            throw appError
          }
          await this.sleep(retryDelayMs(attempt))
        }
      }

      throw lastError ?? new AppErrorClass('JSX_EXEC_FAILED', 'Photoshop 执行失败', false)
    })
  }

  async runTemplateBatch(
    template: PsdTemplate,
    groups: PhotoshopTaskGroup[],
    maxRetries = 0,
    options: {
      skipCompleted?: boolean
      cancelFilePath?: string
      onLog?: (entry: PhotoshopProgressLogEntry) => void | Promise<void>
    } = {},
  ): Promise<{
    ok: boolean
    outputs: string[]
    groups: Array<{
      group_index: number
      sku_folder: string
      outputs: string[]
      skipped?: boolean
    }>
    cancelled?: boolean
  }> {
    this.assertWindows()
    const pendingGroups: PhotoshopTaskGroup[] = []
    const skippedGroups: Array<{
      group_index: number
      sku_folder: string
      outputs: string[]
      skipped: true
    }> = []

    return executionMutex.runExclusive(async () => {
      for (const group of groups) {
        if (options.skipCompleted === true && (await this.shouldSkipJob(group.job))) {
          skippedGroups.push({
            group_index: group.group_index,
            sku_folder: group.sku_folder,
            outputs: group.job.output_paths,
            skipped: true,
          })
          continue
        }
        pendingGroups.push(group)
      }

      if (pendingGroups.length === 0) {
        return {
          ok: true,
          outputs: skippedGroups.flatMap((group) => group.outputs),
          groups: skippedGroups,
        }
      }

      for (const group of pendingGroups) {
        await this.recorder.recordRunning(group.job, 0)
      }

      const cancelFilePath = options.cancelFilePath ?? ''
      const jobFile = await this.writeTemplateBatchJsx(template, pendingGroups, cancelFilePath)
      try {
        await this.runJsxFileWithLogTail(jobFile.jsx_path, jobFile.log_file_path, options.onLog)
        const raw = JSON.parse(
          await this.readTextFile(jobFile.result_file_path, 'utf8'),
        ) as RawTemplateBatchResult
        const batchError = classifyTemplateBatchResult(raw, template)
        if (batchError) {
          throw batchError
        }

        const groupResults = normalizeTemplateBatchGroups(raw, pendingGroups)
        for (const groupResult of groupResults) {
          await this.verifyOutputs(groupResult.outputs)
          const group = pendingGroups.find((item) => item.group_index === groupResult.group_index)
          if (group) {
            await this.recorder.recordCompleted(group.job, 0, groupResult.outputs)
          }
          for (const output of groupResult.outputs) {
            await options.onLog?.({
              ts: Date.now(),
              level: 'info',
              stage: 'output_verify',
              template_name: groups[0]?.template_name ?? pathBasename(template.file_path),
              group: groupResult.group_index,
              sku_folder: groupResult.sku_folder,
              output_file: output,
              message: '主进程已验证输出文件',
            })
          }
        }

        if (raw.cancelled === true) {
          const completedGroupIndexes = new Set(groupResults.map((group) => group.group_index))
          for (const group of pendingGroups) {
            if (!completedGroupIndexes.has(group.group_index)) {
              if (this.recorder.recordCancelled) {
                await this.recorder.recordCancelled(group.job, 0)
              } else {
                await this.recorder.recordFailed(
                  group.job,
                  0,
                  new AppErrorClass('JSX_EXEC_FAILED', '用户取消 PS 套版任务', false, {
                    cancelled: true,
                  }),
                )
              }
            }
          }
        }

        const outputs = [
          ...skippedGroups.flatMap((group) => group.outputs),
          ...groupResults.flatMap((group) => group.outputs),
        ]
        return {
          ok: raw.ok === true && raw.cancelled !== true,
          outputs,
          groups: [...skippedGroups, ...groupResults],
          ...(raw.cancelled === true ? { cancelled: true } : {}),
        }
      } catch (error) {
        const appError = normalizeError(error)
        for (const group of pendingGroups) {
          await this.recorder.recordFailed(group.job, 0, appError)
        }
        await this.writePhotoshopDiagnostic({
          type: 'photoshop_template_batch_failed',
          operation: 'runTemplateBatch',
          job: pendingGroups[0]?.job,
          attempt: 0,
          error: appError,
          data: {
            templateId: template.id,
            templateName: pathBasename(template.file_path),
            groups: pendingGroups.length,
          },
        })
        throw appError
      }
    })
  }

  private async writePhotoshopDiagnostic(input: {
    type: string
    operation: string
    job?: PhotoshopJob | undefined
    attempt: number
    error: AppErrorClass
    data?: Record<string, unknown> | undefined
  }) {
    const workbenchRoot = await this.readDiagnosticWorkbenchRoot().catch(() => null)
    await writeOptionalDiagnosticLogEvent({
      module: 'photoshop',
      runId: input.job?.task_id ?? 'photoshop',
      workbenchRoot: workbenchRoot ?? undefined,
      meta: {
        operation: input.operation,
        taskId: input.job?.task_id ?? null,
      },
      event: {
        type: input.type,
        operation: input.operation,
        ...(input.job?.group_index === undefined ? {} : { itemKey: String(input.job.group_index) }),
        attempt: input.attempt,
        data: {
          taskId: input.job?.task_id ?? null,
          groupIndex: input.job?.group_index ?? null,
          mockupPath: input.job?.mockup_path ?? null,
          outputPaths: input.job?.output_paths ?? [],
          ...(input.data ?? {}),
        },
        error: errorForDiagnosticLog(input.error),
      },
    }).catch(() => null)
  }

  private async runOnce(job: PhotoshopJob): Promise<Omit<PhotoshopJobResult, 'attempts'>> {
    const { result_file_path: _resultFilePath, ...jobWithoutResultPath } = job
    const jobFile = await this.writeJsx(jobWithoutResultPath)
    await this.comAdapter.runJsxFile(jobFile.jsx_path)

    const raw = JSON.parse(
      await this.readTextFile(jobFile.result_file_path, 'utf8'),
    ) as RawJsxResult
    const jsxError = classifyJsxResult(raw, job)
    if (jsxError) {
      throw jsxError
    }

    await this.verifyOutputs(job.output_paths)
    return {
      ok: true,
      outputs: job.output_paths,
      jsx_path: jobFile.jsx_path,
      result_file_path: jobFile.result_file_path,
    }
  }

  private async verifyOutputs(outputPaths: string[]): Promise<void> {
    const missing: string[] = []
    for (const outputPath of outputPaths) {
      try {
        await this.accessFile(outputPath)
      } catch {
        missing.push(outputPath)
      }
    }

    if (missing.length > 0) {
      throw new AppErrorClass('OUTPUT_VERIFY_FAILED', 'Photoshop 输出文件缺失', true, {
        missing_outputs: missing,
      })
    }
  }

  private async runJsxFileWithLogTail(
    jsxPath: string,
    logPath: string,
    onLog: ((entry: PhotoshopProgressLogEntry) => void | Promise<void>) | undefined,
  ): Promise<void> {
    if (!onLog) {
      await this.comAdapter.runJsxFile(jsxPath)
      return
    }

    let done = false
    let emittedLines = 0
    const emitNewLogs = async () => {
      let text = ''
      try {
        text = await this.readTextFile(logPath, 'utf8')
      } catch {
        return
      }
      const lines = text.split(/\r?\n/).filter((line) => line.trim().length > 0)
      for (const line of lines.slice(emittedLines)) {
        try {
          await onLog(JSON.parse(line) as PhotoshopProgressLogEntry)
        } catch {
          await onLog({
            ts: Date.now(),
            level: 'warn',
            stage: 'jsx_exec',
            message: 'Photoshop 日志行解析失败',
            error: line,
          })
        }
      }
      emittedLines = lines.length
    }
    const tail = async () => {
      while (!done) {
        await emitNewLogs()
        await this.sleep(100)
      }
      await emitNewLogs()
    }

    const tailPromise = tail()
    try {
      await this.comAdapter.runJsxFile(jsxPath)
    } finally {
      done = true
      await tailPromise
    }
  }

  private assertWindows(): void {
    if (this.platform !== 'win32') {
      throw new AppErrorClass(
        'PS_UNSUPPORTED_PLATFORM',
        'PS 套版仅支持 Windows，请在 Windows 电脑使用 Photoshop 执行功能',
        false,
        { platform: this.platform },
      )
    }
  }
}

export const photoshopExecutionEngine = new PhotoshopExecutionEngine()
