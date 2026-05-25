import { access, readFile } from 'node:fs/promises'
import { AppErrorClass, type PhotoshopJob, type PhotoshopJobResult } from '@tengyu-aipod/shared'
import { type BetterSqliteDatabase, getDefaultWorkbenchDatabase } from '../lib/workbench-db'
import { type PhotoshopComAdapter, photoshopComAdapter } from './com-adapter'
import { writePhotoshopJobJsx } from './jsx-generator'

type AccessFn = (path: string) => Promise<void>
type TextReader = (path: string, encoding: BufferEncoding) => Promise<string>
type SleepFn = (ms: number) => Promise<void>
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

type DatabaseProvider = () => BetterSqliteDatabase | Promise<BetterSqliteDatabase>

export class SqlitePhotoshopWorkflowStepRecorder implements WorkflowStepRecorder {
  private readonly dbProvider: DatabaseProvider
  private schemaReady = false

  constructor(options: { db?: BetterSqliteDatabase; dbProvider?: DatabaseProvider } = {}) {
    this.dbProvider = options.db
      ? () => options.db as BetterSqliteDatabase
      : (options.dbProvider ?? getDefaultWorkbenchDatabase)
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
        mockup_path: job.mockup_path,
        output_paths: job.output_paths,
        format: job.format,
      }),
      updated_at: Date.now(),
    })
  }

  async recordCompleted(job: PhotoshopJob, attempt: number, outputs: string[]): Promise<void> {
    const db = await this.db()
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
      output_json: JSON.stringify({ outputs }),
      updated_at: Date.now(),
    })
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

  private async db(): Promise<BetterSqliteDatabase> {
    const db = await this.dbProvider()
    if (!this.schemaReady) {
      this.ensureSchema(db)
      this.schemaReady = true
    }
    return db
  }

  private ensureSchema(db: BetterSqliteDatabase): void {
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

  constructor(options: PhotoshopExecutionEngineOptions = {}) {
    this.platform = options.platform ?? process.platform
    this.comAdapter = options.comAdapter ?? photoshopComAdapter
    this.writeJsx = options.writeJsx ?? writePhotoshopJobJsx
    this.readTextFile = options.readTextFile ?? readFile
    this.accessFile = options.accessFile ?? access
    this.sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)))
    this.recorder = options.recorder ?? photoshopWorkflowStepRecorder
  }

  async runJob(job: PhotoshopJob, maxRetries = 0): Promise<PhotoshopJobResult> {
    this.assertWindows()
    const attempts = Math.min(Math.max(maxRetries, 0), MAX_RETRIES) + 1
    let lastError: AppErrorClass | null = null

    return executionMutex.runExclusive(async () => {
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
