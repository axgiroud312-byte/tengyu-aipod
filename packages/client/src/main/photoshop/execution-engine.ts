import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { access, readFile } from 'node:fs/promises'
import { AppErrorClass, type PhotoshopJob, type PhotoshopJobResult } from '@tengyu-aipod/shared'
import type { SqliteDatabase } from '../lib/sqlite'
import { getDefaultWorkbenchDatabase } from '../lib/workbench-db'
import { type PhotoshopComAdapter, photoshopComAdapter } from './com-adapter'
import { writePhotoshopJobJsx } from './jsx-generator'

type AccessFn = (path: string) => Promise<void>
type TextReader = (path: string, encoding: BufferEncoding) => Promise<string>
type SleepFn = (ms: number) => Promise<void>
type HashFileFn = (path: string) => Promise<string>
type JsxWriter = (job: Omit<PhotoshopJob, 'result_file_path'>) => Promise<{
  jsx_path: string
  result_file_path: string
}>

export interface WorkflowStepRecorder {
  recordRunning(job: PhotoshopJob, attempt: number): Promise<void>
  recordCompleted(job: PhotoshopJob, attempt: number, outputs: string[]): Promise<void>
  recordFailed(job: PhotoshopJob, attempt: number, error: AppErrorClass): Promise<void>
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
}

interface RawJsxResult {
  ok?: boolean
  error?: string
  outputs?: unknown
  stages?: unknown
}

const MAX_RETRIES = 5

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
      input_image: replacement.input_image,
      layer_path: replacement.layer_path,
    }))
    .sort((left, right) => {
      const layerCompare = left.layer_path.localeCompare(right.layer_path)
      return layerCompare !== 0 ? layerCompare : left.input_image.localeCompare(right.input_image)
    })
  return createHash('sha256')
    .update(
      JSON.stringify({
        mockup_path: job.mockup_path,
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
  private schemaReady = false

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
        step_id,
        provider,
        file_path,
        file_hash,
        created_at
      ) VALUES (
        @id,
        @task_id,
        @step_id,
        @provider,
        @file_path,
        @file_hash,
        @created_at
      )
      ON CONFLICT(file_path) DO UPDATE SET
        task_id = excluded.task_id,
        step_id = excluded.step_id,
        provider = excluded.provider,
        file_hash = excluded.file_hash,
        created_at = excluded.created_at`,
    )
    for (const output of outputs) {
      artifactStatement.run({
        id: `artifact:${createHash('sha1').update(output).digest('hex')}`,
        task_id: job.task_id,
        step_id: this.stepId(job),
        provider: 'photoshop',
        file_path: output,
        file_hash: outputHashes[output]!,
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

  private async db(): Promise<SqliteDatabase> {
    const db = await this.dbProvider()
    if (!this.schemaReady) {
      this.ensureSchema(db)
      this.schemaReady = true
    }
    return db
  }

  private ensureSchema(db: SqliteDatabase): void {
    db.exec(`
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
        task_id TEXT NOT NULL,
        step_id TEXT NOT NULL,
        provider TEXT NOT NULL,
        file_path TEXT NOT NULL UNIQUE,
        file_hash TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_artifacts_provider_path ON artifacts(provider, file_path);
    `)
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
            throw appError
          }
          await this.sleep(retryDelayMs(attempt))
        }
      }

      throw lastError ?? new AppErrorClass('JSX_EXEC_FAILED', 'Photoshop 执行失败', false)
    })
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
