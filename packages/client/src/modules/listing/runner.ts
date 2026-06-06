import { randomUUID } from 'node:crypto'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import {
  AppErrorClass,
  type ListingConfig,
  type ListingErrorCode,
  type ListingFailure,
  type ListingItem,
  type ListingPlatformKey,
  type ListingProgress,
  type ListingResult,
  type ListingStage,
  type ListingStatus,
  type ListingTaskInput,
  type ListingTaskStatus,
  type ListingTemplateConfig,
  type ListingTemplateKey,
  type ListingWorkspaceInput,
  type ListingWorkspaceStatus,
  SLICE_8_LISTING_TEMPLATES,
  WORKBENCH_DIRECTORIES,
  type WorkspaceResult,
  createListingFailure,
  listingFailureFromAppError,
} from '@tengyu-aipod/shared'
import type { Browser as PlaywrightBrowser, Page as PlaywrightPage } from 'playwright'
import { z } from 'zod'
import { bitBrowserClient } from '../../main/lib/bit-browser-client'
import {
  type BrowserProfileLockManager,
  browserProfileLocks,
} from '../../main/lib/browser-profile-lock'
import { type CDPClient, cdpClient } from '../../main/lib/cdp-client'
import { loadBatchAsListingItems } from '../../main/lib/listing-batch-loader'
import { type SqliteDatabase, openSqliteDatabase } from '../../main/lib/sqlite'
import { assertPathInsideWorkbench } from '../../main/lib/workbench-path-guard'
import { sheinWorkflow } from './platforms/dianxiaomi-shein/workflow'
import { temuPopWorkflow } from './platforms/dianxiaomi-temu-pop/workflow'
import { type ListingTaskListInput, SqliteListingTaskStore } from './task-store'

const nodeRequire = createRequire(import.meta.url)
type ElectronBrowserWindowConstructor = typeof import('electron').BrowserWindow

export type ListingWorkspace = {
  profile_id: string
  workspace_id?: string
  task_id?: string
}

export type ListingRunConfig = {
  task_id?: string
  batch_id?: string
  batch_dir: string
  platform: ListingPlatformKey
  template: ListingTemplateConfig
  workspaces: ListingWorkspace[]
  submit_mode?: ListingConfig['submitMode']
  max_attempts?: number
  timeout_ms?: number
  fail_streak_limit?: number
  resume?: boolean
  retry_failed_only?: boolean
  evidence_dir?: string
}

export type BatchResult = {
  taskId: string
  batchId: string
  totalCount: number
  successCount: number
  failedCount: number
  skippedCount: number
  workspaceResults: WorkspaceResult[]
  results: ListingResult[]
}

export type ListingWorkflow = {
  runListingItem: (
    page: PlaywrightPage,
    item: ListingItem,
    config: ListingConfig,
  ) => Promise<ListingResult>
}

export type ListingStatusRow = {
  id: string
  batch_path: string
  sku_code: string
  platform: string
  workspace_id: string
  status: ListingStatus
  draft_template_id: string | null
  retry_count: number
  last_attempted_at: number | null
  last_error_code?: string | null
  last_error: string | null
  evidence_dir: string | null
  created_at: number
}

export type ListingStatusListInput = {
  batchDir: string
  platform?: ListingPlatformKey
  status?: ListingStatus
}

export type ListingStatusStore = {
  find(args: ListingStatusKey): Promise<ListingStatusRow | null> | ListingStatusRow | null
  upsert(args: ListingStatusUpsert): Promise<void> | void
  close?(): void
}

export type ListingTaskStore = {
  updateTaskStatus(
    taskId: string,
    status: ListingTaskStatus,
    lastRunTaskId?: string | null,
  ): Promise<unknown> | unknown
  updateWorkspaceStatus(
    workspaceId: string,
    status: ListingWorkspaceStatus,
    currentTaskId: string | null,
  ): Promise<unknown> | unknown
  close?(): void
}

export type ListingProgressEmitter = (progress: ListingProgress) => void

export type ListingRunnerDependencies = {
  readConfig?: () => Promise<{ workbench_root?: string | undefined }>
  openStatusStore?: (workbenchRoot: string) => ListingStatusStore
  openTaskStore?: (workbenchRoot: string) => ListingTaskStore
  cdp?: Pick<CDPClient, 'connectToProfile' | 'disconnect'>
  locks?: BrowserProfileLockManager
  workflows?: Partial<Record<ListingPlatformKey, ListingWorkflow>>
  tempFiles?: ListingTempFiles
  emitProgress?: ListingProgressEmitter
  randomId?: () => string
  now?: () => number
  sleep?: (ms: number) => Promise<void>
}

export type ListingBackgroundRunDependencies = {
  runner?: Pick<ListingRunner, 'runLocalListingBatch'>
  readConfig?: () => Promise<{ workbench_root?: string | undefined }>
  openTaskStore?: (workbenchRoot: string) => ListingTaskStore
  randomId?: () => string
}

type ListingTempFiles = {
  createTaskDir(module: 'listing', taskId: string): Promise<string>
}

type ResolvedRunConfig = Required<
  Pick<
    ListingRunConfig,
    | 'batch_id'
    | 'evidence_dir'
    | 'fail_streak_limit'
    | 'max_attempts'
    | 'resume'
    | 'retry_failed_only'
    | 'submit_mode'
  >
> &
  Omit<
    ListingRunConfig,
    | 'batch_id'
    | 'evidence_dir'
    | 'fail_streak_limit'
    | 'max_attempts'
    | 'resume'
    | 'retry_failed_only'
    | 'submit_mode'
  > & {
    task_id: string
    timeout_ms: number
  }

type ListingStatusKey = {
  batchPath: string
  sku: string
  platform: ListingPlatformKey
  workspaceId: string
}

type ListingStatusUpsert = ListingStatusKey & {
  status: ListingStatus
  retryCount: number
  lastAttemptedAt: number
  lastErrorCode?: ListingErrorCode | string | null
  lastError?: string | null
  evidenceDir?: string | null
  draftTemplateId?: string | null
}

type WorkspaceRuntime = {
  profileId: string
  totalCount: number
  finishedCount: number
  successCount: number
  failedCount: number
  skippedCount: number
}

type ProgressSnapshot = {
  total: number
  completed: number
  failed: number
  skipped: number
  pending: number
  byWorkspace: Map<string, WorkspaceRuntime>
  current?: {
    profileId: string
    sku: string
    stage: ListingStage
    attempt: number
  }
  lastError: ListingFailure | undefined
}

const DEFAULT_MAX_ATTEMPTS = 2
const DEFAULT_TIMEOUT_MS = 30_000
const DEFAULT_FAIL_STREAK_LIMIT = 3
const DEFAULT_STAGE: ListingStage = 'enter_page'
const DEFAULT_SUBMIT_MODE: ListingConfig['submitMode'] = 'save-draft'
const listingPlatformKeySchema = z.enum(['temu-pop', 'shein'])
const listingTemplateKeySchema = z.enum(['temu-clothing', 'temu-general', 'shein'])
const listingSkuModeSchema = z.enum(['manual', 'one-click-generate'])
const listingSubmitModeSchema = z.enum(['save-draft', 'publish'])
const listingTaskStatusSchema = z.enum(['queued', 'running', 'paused', 'completed', 'failed'])
const listingWorkspaceStatusSchema = z.enum(['idle', 'running', 'paused', 'failed', 'completed'])

const listingWorkspaceInputSchema = z.object({
  profile_id: z.string().min(1),
  profile_name: z.string().min(1),
  platform: listingPlatformKeySchema,
})

const listingWorkspaceRunSchema = z.object({
  profile_id: z.string().min(1),
  task_id: z.string().min(1).optional(),
  workspace_id: z.string().min(1).optional(),
})

const listingTaskInputSchema = z.object({
  workspace_id: z.string().min(1),
  platform: listingPlatformKeySchema,
  template_key: listingTemplateKeySchema,
  draft_template_id: z.string().min(1),
  shop_name: z.string().min(1),
  batch_dir: z.string().min(1),
  sku_mode: listingSkuModeSchema,
  submit_mode: listingSubmitModeSchema,
  max_attempts: z.number().int().min(1).max(5),
  fail_streak_limit: z.number().int().min(1).max(10),
  resume: z.boolean(),
})

const listingTaskListInputSchema = z
  .object({
    workspaceId: z.string().min(1).optional(),
    status: listingTaskStatusSchema.optional(),
  })
  .optional()

const listingTaskStatusInputSchema = z.object({
  taskId: z.string().min(1),
  status: listingTaskStatusSchema,
  lastRunTaskId: z.string().min(1).nullable().optional(),
})

const listingTaskDeleteInputSchema = z.object({
  taskId: z.string().min(1),
})

const listingWorkspaceStatusInputSchema = z.object({
  workspaceId: z.string().min(1),
  status: listingWorkspaceStatusSchema,
  currentTaskId: z.string().min(1).nullable(),
})

const listingRunConfigSchema = z.object({
  task_id: z.string().min(1).optional(),
  batch_id: z.string().min(1).optional(),
  batch_dir: z.string().min(1),
  platform: listingPlatformKeySchema,
  template: z.custom<ListingTemplateConfig>(isListingTemplateConfig),
  workspaces: z.array(listingWorkspaceRunSchema).min(1),
  submit_mode: listingSubmitModeSchema.optional(),
  max_attempts: z.number().int().min(1).max(5).optional(),
  timeout_ms: z.number().int().min(1_000).max(120_000).optional(),
  fail_streak_limit: z.number().int().min(1).max(10).optional(),
  resume: z.boolean().optional(),
  retry_failed_only: z.boolean().optional(),
  evidence_dir: z.string().min(1).optional(),
})

const listingRunRequestSchema = z.object({
  config: listingRunConfigSchema,
  items: z.array(z.custom<ListingItem>(isListingItemLike)),
})

export async function runLocalListingBatch(
  config: ListingRunConfig,
  items: ListingItem[],
  dependencies: ListingRunnerDependencies = {},
): Promise<BatchResult> {
  const runner = new ListingRunner(dependencies)
  return runner.runLocalListingBatch(config, items)
}

export async function runWorkspace(
  profileId: string,
  queue: ListingItem[],
  config: ListingRunConfig,
  dependencies: ListingRunnerDependencies = {},
): Promise<WorkspaceResult> {
  const runner = new ListingRunner(dependencies)
  return runner.runWorkspace(profileId, queue, config)
}

export async function runItemWithRetries(
  page: PlaywrightPage,
  item: ListingItem,
  config: ListingRunConfig,
  dependencies: ListingRunnerDependencies = {},
): Promise<ListingResult> {
  const runner = new ListingRunner(dependencies)
  return runner.runItemWithRetries(
    page,
    item,
    normalizeRunConfig(config, dependencies),
    0,
    config.workspaces[0]?.profile_id ?? '',
  )
}

export class ListingRunner {
  private readonly readConfig: () => Promise<{ workbench_root?: string | undefined }>
  private readonly openStatusStore: (workbenchRoot: string) => ListingStatusStore
  private readonly openTaskStore: (workbenchRoot: string) => ListingTaskStore
  private readonly cdp: Pick<CDPClient, 'connectToProfile' | 'disconnect'>
  private readonly locks: BrowserProfileLockManager
  private readonly workflows: Partial<Record<ListingPlatformKey, ListingWorkflow>>
  private readonly tempFiles: ListingTempFiles
  private readonly emitProgress: ListingProgressEmitter | undefined
  private readonly randomId: () => string
  private readonly now: () => number
  private readonly sleep: (ms: number) => Promise<void>

  constructor(dependencies: ListingRunnerDependencies = {}) {
    this.readConfig = dependencies.readConfig ?? readAppConfig
    this.openStatusStore = dependencies.openStatusStore ?? openWorkbenchListingStatusStore
    this.openTaskStore = dependencies.openTaskStore ?? openWorkbenchListingTaskStore
    this.cdp = dependencies.cdp ?? cdpClient
    this.locks = dependencies.locks ?? browserProfileLocks
    this.workflows = dependencies.workflows ?? {}
    this.tempFiles = dependencies.tempFiles ?? {
      createTaskDir: async (module, taskId) =>
        (await import('../../main/lib/temp-file-manager')).tempFileManager.createTaskDir(
          module,
          taskId,
        ),
    }
    this.emitProgress = dependencies.emitProgress
    this.randomId = dependencies.randomId ?? randomUUID
    this.now = dependencies.now ?? Date.now
    this.sleep = dependencies.sleep ?? sleep
  }

  async runLocalListingBatch(config: ListingRunConfig, items: ListingItem[]): Promise<BatchResult> {
    const workbenchRoot = await readWorkbenchRoot(this.readConfig)
    const resolved = await this.resolveRunConfig(config, workbenchRoot)
    if (resolved.workspaces.length === 0) {
      throw new AppErrorClass('HTTP_4XX', '请先选择至少一个比特浏览器环境', false, {
        kind: 'validation',
      })
    }

    const store = this.openStatusStore(workbenchRoot)
    const taskStore = hasTaskBindings(resolved.workspaces)
      ? this.openTaskStore(workbenchRoot)
      : undefined
    const queues = assignItemsToWorkspaces(items, resolved.workspaces)
    const progress = createProgressSnapshot(items.length, queues)

    try {
      this.emitBatchProgress(resolved, progress, 'pending')
      const settledWorkspaceResults = await Promise.allSettled(
        Array.from(queues.entries()).map(([profileId, queue]) =>
          this.runWorkspaceQueue(profileId, queue, resolved, store, progress, taskStore),
        ),
      )
      const workspaceResults: WorkspaceResult[] = []
      for (const result of settledWorkspaceResults) {
        if (result.status === 'rejected') {
          throw result.reason
        }
        workspaceResults.push(result.value)
      }
      const results = workspaceResults.flatMap((workspace) => workspace.results)
      return {
        taskId: resolved.task_id,
        batchId: resolved.batch_id,
        totalCount: items.length,
        successCount: results.filter((result) => result.status === 'success').length,
        failedCount: results.filter((result) => result.status === 'failed').length,
        skippedCount: results.filter((result) => result.status === 'skipped').length,
        workspaceResults,
        results,
      }
    } finally {
      store.close?.()
      taskStore?.close?.()
    }
  }

  async runWorkspace(
    profileId: string,
    queue: ListingItem[],
    config: ListingRunConfig,
  ): Promise<WorkspaceResult> {
    const workbenchRoot = await readWorkbenchRoot(this.readConfig)
    const resolved = await this.resolveRunConfig(config, workbenchRoot)
    const store = this.openStatusStore(workbenchRoot)
    const taskStore = hasTaskBindings(resolved.workspaces)
      ? this.openTaskStore(workbenchRoot)
      : undefined
    const progress = createProgressSnapshot(queue.length, new Map([[profileId, queue]]))
    try {
      return await this.runWorkspaceQueue(profileId, queue, resolved, store, progress, taskStore)
    } finally {
      store.close?.()
      taskStore?.close?.()
    }
  }

  async runItemWithRetries(
    page: PlaywrightPage,
    item: ListingItem,
    config: ResolvedRunConfig,
    previousRetryCount: number,
    profileId: string,
  ): Promise<ListingResult> {
    const startedAt = this.now()
    let lastFailure: ListingFailure | undefined
    for (let attempt = 1; attempt <= config.max_attempts; attempt += 1) {
      try {
        const result = await this.workflowFor(config.platform).runListingItem(
          page,
          item,
          toListingConfig(config, item, profileId),
        )
        return {
          ...result,
          attemptCount: attempt + previousRetryCount,
          startedAt: result.startedAt || startedAt,
          endedAt: result.endedAt || this.now(),
        }
      } catch (error) {
        lastFailure = failureFromUnknown(error, DEFAULT_STAGE)
        if (!lastFailure.retryable || attempt === config.max_attempts) {
          return createFailedResult(
            item,
            config,
            profileId,
            attempt + previousRetryCount,
            startedAt,
            lastFailure,
          )
        }
        await this.sleep(backoffMs(attempt))
      }
    }

    return createFailedResult(
      item,
      config,
      profileId,
      config.max_attempts + previousRetryCount,
      startedAt,
      lastFailure ??
        createListingFailure({
          code: 'UNKNOWN',
          message: `上架失败：${item.sku}`,
          stage: DEFAULT_STAGE,
        }),
    )
  }

  private async runWorkspaceQueue(
    profileId: string,
    queue: ListingItem[],
    config: ResolvedRunConfig,
    store: ListingStatusStore,
    progress: ProgressSnapshot,
    taskStore?: ListingTaskStore,
  ): Promise<WorkspaceResult> {
    let lock: ReturnType<BrowserProfileLockManager['acquire']> | null = null
    let browser: PlaywrightBrowser | null = null
    let page: PlaywrightPage | null = null
    const results: ListingResult[] = []
    let failStreak = 0
    const binding = workspaceBindingFor(config, profileId)

    try {
      lock = this.locks.acquire(profileId, 'listing', config.task_id)
      await markWorkspaceTaskRunning(taskStore, binding, config.task_id)
      browser = await this.cdp.connectToProfile(profileId)
      const context = await firstBrowserContext(browser)
      page = await context.newPage()
      page.setDefaultTimeout(config.timeout_ms)

      for (const item of queue) {
        const statusKey = statusKeyFor(config, item, profileId)
        const existingStatus =
          config.resume || config.retry_failed_only ? await store.find(statusKey) : null
        if (config.retry_failed_only && existingStatus?.status !== 'failed') {
          const skipped = createSkippedResult(item, config, profileId, '重试失败：非失败状态，跳过')
          results.push(skipped)
          markWorkspaceFinished(progress, profileId, skipped)
          this.emitBatchProgress(config, progress, 'skipped')
          continue
        }
        if (existingStatus?.status === 'success') {
          const skipped = createSkippedResult(item, config, profileId, '断点续传：已成功，跳过')
          results.push(skipped)
          markWorkspaceFinished(progress, profileId, skipped)
          this.emitBatchProgress(config, progress, 'skipped')
          continue
        }

        const retryCount =
          existingStatus?.status === 'failed' ? 0 : (existingStatus?.retry_count ?? 0)
        await store.upsert({
          ...statusKey,
          status: 'uploading',
          retryCount,
          lastAttemptedAt: this.now(),
          lastErrorCode: null,
          lastError: null,
          evidenceDir: evidenceDirFor(config, profileId, item),
        })
        progress.current = {
          profileId,
          sku: item.sku,
          stage: DEFAULT_STAGE,
          attempt: retryCount + 1,
        }
        this.emitBatchProgress(config, progress, 'uploading')

        const result = await this.runItemWithRetries(
          requirePage(page),
          item,
          config,
          retryCount,
          profileId,
        )
        results.push(result)
        if (result.status === 'success') {
          failStreak = 0
          await store.upsert({
            ...statusKey,
            status: 'success',
            retryCount: result.attemptCount,
            lastAttemptedAt: this.now(),
            lastErrorCode: null,
            evidenceDir: result.evidenceDir ?? evidenceDirFor(config, profileId, item),
          })
        } else {
          failStreak += 1
          await store.upsert({
            ...statusKey,
            status: 'failed',
            retryCount: result.attemptCount,
            lastAttemptedAt: this.now(),
            lastErrorCode: result.failure?.code ?? null,
            lastError: result.failure?.message ?? '上架失败',
            evidenceDir: result.evidenceDir ?? evidenceDirFor(config, profileId, item),
          })
        }

        if (result.failure) {
          progress.lastError = result.failure
        } else {
          progress.lastError = undefined
        }
        markWorkspaceFinished(progress, profileId, result)
        this.emitBatchProgress(config, progress, result.status)

        if (failStreak >= config.fail_streak_limit) {
          const pausedFailure = createListingFailure({
            code: 'CONSECUTIVE_FAILURES',
            message: `连续 ${failStreak} 次失败，店铺环境暂停`,
            stage: 'verify_result',
          })
          progress.lastError = pausedFailure
          for (const remaining of queue.slice(queue.indexOf(item) + 1)) {
            const skipped = createSkippedResult(remaining, config, profileId, pausedFailure.message)
            results.push(skipped)
            markWorkspaceFinished(progress, profileId, skipped)
            await store.upsert({
              ...statusKeyFor(config, remaining, profileId),
              status: 'skipped',
              retryCount: 0,
              lastAttemptedAt: this.now(),
              lastErrorCode: pausedFailure.code,
              lastError: pausedFailure.message,
              evidenceDir: evidenceDirFor(config, profileId, remaining),
            })
          }
          this.emitBatchProgress(config, progress, 'failed')
          break
        }
      }
    } catch (error) {
      await markWorkspaceTaskFailed(taskStore, binding, config.task_id)
      throw error
    } finally {
      await page?.close().catch(() => undefined)
      await this.closeBrowser(profileId, browser)
      lock?.release()
    }

    const runtime = progress.byWorkspace.get(profileId)
    const workspaceResult = {
      profileId,
      platform: config.platform,
      templateKey: config.template.key,
      totalCount: queue.length,
      successCount:
        runtime?.successCount ?? results.filter((result) => result.status === 'success').length,
      failedCount:
        runtime?.failedCount ?? results.filter((result) => result.status === 'failed').length,
      skippedCount:
        runtime?.skippedCount ?? results.filter((result) => result.status === 'skipped').length,
      results,
    }
    await markWorkspaceTaskFinished(taskStore, binding, config.task_id, workspaceResult)
    return workspaceResult
  }

  private workflowFor(platform: ListingPlatformKey): ListingWorkflow {
    const workflow = this.workflows[platform]
    if (!workflow) {
      throw new AppErrorClass('HTTP_4XX', '上架平台 workflow 尚未接入', false, {
        kind: 'listing_workflow_missing',
        platform,
      })
    }
    return workflow
  }

  private emitBatchProgress(
    config: ResolvedRunConfig,
    progress: ProgressSnapshot,
    status: ListingStatus,
  ) {
    this.emitProgress?.({
      batchId: config.batch_id,
      profileId: progress.current?.profileId ?? '',
      status,
      totalCount: progress.total,
      finishedCount: progress.completed + progress.failed + progress.skipped,
      ...(progress.current ? { currentSku: progress.current.sku } : {}),
      ...(progress.current ? { currentStage: progress.current.stage } : {}),
      ...(progress.lastError ? { lastError: progress.lastError } : {}),
    })
  }

  private async closeBrowser(profileId: string, browser: PlaywrightBrowser | null) {
    if (browser?.isConnected()) {
      await browser.close().catch(() => undefined)
    }
    await this.cdp.disconnect(profileId).catch(() => undefined)
  }

  private async resolveRunConfig(
    config: ListingRunConfig,
    workbenchRoot: string,
  ): Promise<ResolvedRunConfig> {
    const taskId = config.task_id ?? this.randomId()
    return normalizeRunConfig(
      {
        ...config,
        task_id: taskId,
        evidence_dir: config.evidence_dir ?? (await this.createListingEvidenceRoot(taskId)),
      },
      {
        randomId: () => taskId,
        workbenchRoot,
      },
    )
  }

  private async createListingEvidenceRoot(taskId: string) {
    return this.tempFiles.createTaskDir('listing', taskId)
  }
}

export class SqliteListingStatusStore implements ListingStatusStore {
  constructor(private readonly db: Pick<SqliteDatabase, 'exec' | 'prepare' | 'close'>) {
    ensureListingStatusTable(this.db)
  }

  find(args: ListingStatusKey): ListingStatusRow | null {
    const row = this.db
      .prepare(
        `
        SELECT *
        FROM listing_status
        WHERE batch_path = ?
          AND sku_code = ?
          AND platform = ?
          AND workspace_id = ?
      `,
      )
      .get(args.batchPath, args.sku, args.platform, args.workspaceId)
    return isListingStatusRow(row) ? row : null
  }

  list(args: ListingStatusListInput): ListingStatusRow[] {
    const filters = ['batch_path = ?']
    const params: string[] = [args.batchDir]
    if (args.platform) {
      filters.push('platform = ?')
      params.push(args.platform)
    }
    if (args.status) {
      filters.push('status = ?')
      params.push(args.status)
    }
    const rows = this.db
      .prepare(
        `
        SELECT *
        FROM listing_status
        WHERE ${filters.join(' AND ')}
        ORDER BY last_attempted_at DESC, sku_code ASC
      `,
      )
      .all(...params)
    return rows.filter(isListingStatusRow)
  }

  upsert(args: ListingStatusUpsert): void {
    const now = Date.now()
    this.db
      .prepare(
        `
        INSERT INTO listing_status (
          id,
          batch_path,
          sku_code,
          platform,
          workspace_id,
          status,
          draft_template_id,
          retry_count,
          last_attempted_at,
          last_error_code,
          last_error,
          evidence_dir,
          created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(batch_path, sku_code, platform, workspace_id) DO UPDATE SET
          status = excluded.status,
          draft_template_id = excluded.draft_template_id,
          retry_count = excluded.retry_count,
          last_attempted_at = excluded.last_attempted_at,
          last_error_code = excluded.last_error_code,
          last_error = excluded.last_error,
          evidence_dir = excluded.evidence_dir
      `,
      )
      .run(
        randomUUID(),
        args.batchPath,
        args.sku,
        args.platform,
        args.workspaceId,
        args.status,
        args.draftTemplateId ?? null,
        args.retryCount,
        args.lastAttemptedAt,
        args.lastErrorCode ?? null,
        args.lastError ?? null,
        args.evidenceDir ?? null,
        now,
      )
  }

  close(): void {
    this.db.close()
  }
}

export function registerListingRunnerIpc() {
  const ipcMain = electronIpcMain()
  ipcMain.handle('listing:list-templates', () => SLICE_8_LISTING_TEMPLATES.map((item) => item))
  ipcMain.handle('listing:list-profiles', () => bitBrowserClient.listProfiles())
  ipcMain.handle('listing:list-saved-workspaces', async () =>
    withListingTaskStore((store) => store.listWorkspaces()),
  )
  ipcMain.handle('listing:save-workspace', async (_event, input: unknown) =>
    withListingTaskStore((store) => store.upsertWorkspace(parseListingWorkspaceInput(input))),
  )
  ipcMain.handle('listing:update-workspace-status', async (_event, input: unknown) => {
    const parsed = parseListingWorkspaceStatusInput(input)
    return withListingTaskStore((store) =>
      store.updateWorkspaceStatus(parsed.workspaceId, parsed.status, parsed.currentTaskId),
    )
  })
  ipcMain.handle('listing:list-tasks', async (_event, input: unknown) =>
    withListingTaskStore((store) => store.listTasks(parseListingTaskListInput(input))),
  )
  ipcMain.handle('listing:create-task', async (_event, input: unknown) => {
    const taskInput = parseListingTaskInput(input)
    await assertListingBatchDir(taskInput.batch_dir)
    return withListingTaskStore((store) => store.createTask(taskInput))
  })
  ipcMain.handle('listing:update-task-status', async (_event, input: unknown) => {
    const parsed = parseListingTaskStatusInput(input)
    return withListingTaskStore((store) =>
      store.updateTaskStatus(parsed.taskId, parsed.status, parsed.lastRunTaskId),
    )
  })
  ipcMain.handle('listing:delete-task', async (_event, input: unknown) => {
    const parsed = parseListingTaskDeleteInput(input)
    return withListingTaskStore((store) => store.deleteTask(parsed.taskId))
  })
  ipcMain.handle('listing:choose-batch-dir', async () => {
    const config = await readAppConfig()
    const result = await electronDialog().showOpenDialog({
      ...(config.workbench_root
        ? { defaultPath: join(config.workbench_root, WORKBENCH_DIRECTORIES.listing) }
        : {}),
      properties: ['openDirectory'],
      title: '选择上架素材批次目录',
    })
    if (result.canceled || !result.filePaths[0]) {
      return { ok: false, error: { code: 'CANCELLED', message: '已取消选择目录' } }
    }
    return { ok: true, data: { path: result.filePaths[0] } }
  })
  ipcMain.handle('listing:scan-batch-dir', async (_event, input: unknown) => {
    if (!isRecord(input) || typeof input.batchDir !== 'string') {
      throw new AppErrorClass('HTTP_4XX', '上架批次扫描参数不正确', false, {
        kind: 'validation',
      })
    }
    await assertListingBatchDir(input.batchDir)
    return loadBatchAsListingItems(input.batchDir, {
      template: listingTemplateByKey(input.templateKey),
    })
  })
  ipcMain.handle('listing:list-status', async (_event, input: unknown) => {
    const listInput = parseListingStatusListInput(input)
    const workbenchRoot = await readWorkbenchRoot(readAppConfig)
    await assertPathInsideWorkbench(workbenchRoot, listInput.batchDir, {
      domain: 'listing',
      label: '上架批次目录',
    })
    const store = openWorkbenchListingStatusStore(workbenchRoot)
    try {
      return store.list(listInput)
    } finally {
      store.close()
    }
  })
  ipcMain.handle('listing:open-path', async (_event, input: unknown) => {
    if (!isRecord(input) || typeof input.path !== 'string') {
      throw new AppErrorClass('HTTP_4XX', '打开上架证据路径参数不正确', false, {
        kind: 'validation',
      })
    }
    const workbenchRoot = await readWorkbenchRoot(readAppConfig)
    await assertPathInsideWorkbench(workbenchRoot, input.path, {
      domain: 'visible-workbench',
      label: '上架证据路径',
    })
    const error = await electronShell().openPath(input.path)
    if (error) {
      return { ok: false, error: { code: 'OPEN_PATH_FAILED', message: error } }
    }
    return { ok: true }
  })
  ipcMain.handle('listing:run', async (_event, input: unknown) => {
    const runRequest = parseListingRunRequest(input)
    await assertListingBatchDir(runRequest.config.batch_dir)
    if (runRequest.config.evidence_dir) {
      const workbenchRoot = await readWorkbenchRoot(readAppConfig)
      await assertPathInsideWorkbench(workbenchRoot, runRequest.config.evidence_dir, {
        domain: 'visible-workbench',
        label: '上架证据目录',
      })
    }
    return startListingRunInBackground(runRequest.config, runRequest.items, {
      randomId: randomUUID,
    })
  })
}

function assignItemsToWorkspaces(items: ListingItem[], workspaces: ListingWorkspace[]) {
  const queues = new Map<string, ListingItem[]>()
  for (const workspace of workspaces) {
    queues.set(workspace.profile_id, [])
  }
  for (const [index, item] of items.entries()) {
    const workspace = workspaces[index % workspaces.length]
    if (!workspace) {
      continue
    }
    queues.get(workspace.profile_id)?.push(item)
  }
  return queues
}

function hasTaskBindings(workspaces: ListingWorkspace[]) {
  return workspaces.some((workspace) => Boolean(workspace.workspace_id && workspace.task_id))
}

function workspaceBindingFor(config: ResolvedRunConfig, profileId: string) {
  const workspace = config.workspaces.find((item) => item.profile_id === profileId)
  return workspaceBindingForConfig(workspace)
}

function workspaceBindingForConfig(workspace: ListingWorkspace | undefined) {
  if (!workspace?.workspace_id || !workspace.task_id) {
    return null
  }
  return {
    taskId: workspace.task_id,
    workspaceId: workspace.workspace_id,
  }
}

async function markWorkspaceTaskRunning(
  store: ListingTaskStore | undefined,
  binding: ReturnType<typeof workspaceBindingFor>,
  runTaskId: string,
) {
  if (!store || !binding) {
    return
  }
  await store.updateTaskStatus(binding.taskId, 'running', runTaskId)
  await store.updateWorkspaceStatus(binding.workspaceId, 'running', binding.taskId)
}

async function markWorkspaceTaskFailed(
  store: ListingTaskStore | undefined,
  binding: ReturnType<typeof workspaceBindingFor>,
  runTaskId: string,
) {
  if (!store || !binding) {
    return
  }
  await store.updateTaskStatus(binding.taskId, 'failed', runTaskId)
  await store.updateWorkspaceStatus(binding.workspaceId, 'failed', null)
}

async function markWorkspaceTaskFinished(
  store: ListingTaskStore | undefined,
  binding: ReturnType<typeof workspaceBindingFor>,
  runTaskId: string,
  result: WorkspaceResult,
) {
  if (!store || !binding) {
    return
  }
  const hasFailedItems = result.failedCount > 0
  await store.updateTaskStatus(binding.taskId, hasFailedItems ? 'failed' : 'completed', runTaskId)
  await store.updateWorkspaceStatus(
    binding.workspaceId,
    hasFailedItems ? 'failed' : 'completed',
    null,
  )
}

function normalizeRunConfig(
  config: ListingRunConfig,
  dependencies: Pick<ListingRunnerDependencies, 'randomId'> & { workbenchRoot?: string } = {},
): ResolvedRunConfig {
  const taskId = config.task_id ?? dependencies.randomId?.() ?? randomUUID()
  return {
    ...config,
    task_id: taskId,
    batch_id: config.batch_id ?? taskId,
    submit_mode: config.submit_mode ?? DEFAULT_SUBMIT_MODE,
    max_attempts: config.max_attempts ?? DEFAULT_MAX_ATTEMPTS,
    timeout_ms: config.timeout_ms ?? DEFAULT_TIMEOUT_MS,
    fail_streak_limit: config.fail_streak_limit ?? DEFAULT_FAIL_STREAK_LIMIT,
    resume: config.resume ?? true,
    retry_failed_only: config.retry_failed_only ?? false,
    evidence_dir:
      config.evidence_dir ??
      join(
        dependencies.workbenchRoot ?? config.batch_dir,
        WORKBENCH_DIRECTORIES.metadata,
        'tmp',
        'listing',
        taskId,
      ),
  }
}

function toListingConfig(
  config: ResolvedRunConfig,
  item: ListingItem,
  profileId: string,
): ListingConfig {
  return {
    batchId: config.batch_id,
    profileId,
    template: config.template,
    submitMode: config.submit_mode,
    maxAttempts: config.max_attempts,
    timeoutMs: config.timeout_ms,
    evidenceDir: evidenceDirFor(config, profileId, item),
    allowMutation: true,
    allowPublish: config.submit_mode === 'publish',
  }
}

export function startListingRunInBackground(
  config: ListingRunConfig,
  items: ListingItem[],
  dependencies: ListingBackgroundRunDependencies = {},
): string {
  const taskId = config.task_id ?? dependencies.randomId?.() ?? randomUUID()
  const runConfig = { ...config, task_id: taskId }
  const runner = dependencies.runner ?? listingRunner
  void runner.runLocalListingBatch(runConfig, items).catch((error: unknown) =>
    markBoundListingTasksFailed(runConfig, taskId, dependencies).catch(() => {
      console.error('Failed to mark background listing run as failed', error)
    }),
  )
  return taskId
}

async function markBoundListingTasksFailed(
  config: ListingRunConfig,
  runTaskId: string,
  dependencies: ListingBackgroundRunDependencies,
): Promise<void> {
  const bindings = config.workspaces
    .map((workspace) => workspaceBindingForConfig(workspace))
    .filter((binding): binding is NonNullable<ReturnType<typeof workspaceBindingForConfig>> =>
      Boolean(binding),
    )
  if (bindings.length === 0) {
    return
  }

  const workbenchRoot = await readWorkbenchRoot(dependencies.readConfig ?? readAppConfig)
  const store =
    dependencies.openTaskStore?.(workbenchRoot) ?? openWorkbenchListingTaskStore(workbenchRoot)
  try {
    for (const binding of bindings) {
      await store.updateTaskStatus(binding.taskId, 'failed', runTaskId)
      await store.updateWorkspaceStatus(binding.workspaceId, 'failed', null)
    }
  } finally {
    store.close?.()
  }
}

function createProgressSnapshot(
  total: number,
  queues: Map<string, ListingItem[]>,
): ProgressSnapshot {
  const byWorkspace = new Map<string, WorkspaceRuntime>()
  for (const [profileId, queue] of queues) {
    byWorkspace.set(profileId, {
      profileId,
      totalCount: queue.length,
      finishedCount: 0,
      successCount: 0,
      failedCount: 0,
      skippedCount: 0,
    })
  }
  return {
    total,
    completed: 0,
    failed: 0,
    skipped: 0,
    pending: total,
    byWorkspace,
    lastError: undefined,
  }
}

function markWorkspaceFinished(
  progress: ProgressSnapshot,
  profileId: string,
  result: ListingResult,
) {
  const runtime = progress.byWorkspace.get(profileId)
  if (runtime) {
    runtime.finishedCount += 1
    if (result.status === 'success') {
      runtime.successCount += 1
    } else if (result.status === 'failed') {
      runtime.failedCount += 1
    } else if (result.status === 'skipped') {
      runtime.skippedCount += 1
    }
  }

  if (result.status === 'success') {
    progress.completed += 1
  } else if (result.status === 'failed') {
    progress.failed += 1
  } else if (result.status === 'skipped') {
    progress.skipped += 1
  }
  progress.pending = Math.max(
    progress.total - progress.completed - progress.failed - progress.skipped,
    0,
  )
}

function statusKeyFor(
  config: ResolvedRunConfig,
  item: ListingItem,
  profileId: string,
): ListingStatusKey {
  return {
    batchPath: config.batch_dir,
    sku: item.sku,
    platform: config.platform,
    workspaceId: profileId,
  }
}

function evidenceDirFor(config: ResolvedRunConfig, profileId: string, item: ListingItem) {
  return join(config.evidence_dir, 'evidence', profileId || 'workspace', item.sku)
}

function createSkippedResult(
  item: ListingItem,
  config: ResolvedRunConfig,
  profileId: string,
  message: string,
): ListingResult {
  const now = Date.now()
  return {
    itemId: item.id,
    sku: item.sku,
    status: 'skipped',
    attemptCount: 0,
    startedAt: now,
    endedAt: now,
    stages: [],
    editUrl: item.editUrl,
    evidenceDir: evidenceDirFor(config, profileId, item),
    failure: createListingFailure({
      code: 'UNKNOWN',
      message,
      stage: DEFAULT_STAGE,
    }),
  }
}

function createFailedResult(
  item: ListingItem,
  config: ResolvedRunConfig,
  profileId: string,
  attemptCount: number,
  startedAt: number,
  failure: ListingFailure,
): ListingResult {
  return {
    itemId: item.id,
    sku: item.sku,
    status: 'failed',
    attemptCount,
    startedAt,
    endedAt: Date.now(),
    stages: [
      {
        stage: failure.stage,
        ok: false,
        startedAt,
        endedAt: Date.now(),
        error: failure,
      },
    ],
    editUrl: item.editUrl,
    evidenceDir: evidenceDirFor(config, profileId, item),
    failure,
  }
}

function failureFromUnknown(error: unknown, stage: ListingStage): ListingFailure {
  if (error instanceof AppErrorClass) {
    return listingFailureFromAppError(error, stage)
  }
  if (isListingFailureLike(error)) {
    return error
  }
  if (isRecord(error) && typeof error.message === 'string' && typeof error.code === 'string') {
    return createListingFailure({
      code: error.code === 'SELECTOR_NOT_FOUND' ? 'SELECTOR_NOT_FOUND' : 'UNKNOWN',
      message: error.message,
      stage,
      cause: error,
    })
  }
  return createListingFailure({
    code: 'UNKNOWN',
    message: error instanceof Error ? error.message : String(error),
    stage,
    cause: error,
  })
}

async function firstBrowserContext(browser: PlaywrightBrowser) {
  return browser.contexts()[0] ?? (await browser.newContext())
}

function requirePage(page: PlaywrightPage | null): PlaywrightPage {
  if (!page || page.isClosed()) {
    throw new AppErrorClass('BROWSER_NOT_CONNECTED', '上架页面已关闭', true)
  }
  return page
}

function backoffMs(attempt: number) {
  return 2 ** attempt * 1000
}

function sleep(ms: number) {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, ms)
  })
}

function workbenchDbPath(workbenchRoot: string) {
  return join(workbenchRoot, WORKBENCH_DIRECTORIES.metadata, 'workbench.db')
}

function openWorkbenchListingStatusStore(workbenchRoot: string) {
  return new SqliteListingStatusStore(openSqliteDatabase(workbenchDbPath(workbenchRoot)))
}

function openWorkbenchListingTaskStore(workbenchRoot: string) {
  return new SqliteListingTaskStore(openSqliteDatabase(workbenchDbPath(workbenchRoot)))
}

async function withListingTaskStore<T>(
  fn: (store: SqliteListingTaskStore) => T | Promise<T>,
): Promise<T> {
  const workbenchRoot = await readWorkbenchRoot(readAppConfig)
  const store = openWorkbenchListingTaskStore(workbenchRoot)
  try {
    return await fn(store)
  } finally {
    store.close()
  }
}

async function assertListingBatchDir(batchDir: string) {
  const workbenchRoot = await readWorkbenchRoot(readAppConfig)
  await assertPathInsideWorkbench(workbenchRoot, batchDir, {
    domain: 'listing',
    label: '上架批次目录',
  })
}

function ensureListingStatusTable(db: Pick<SqliteDatabase, 'exec'>) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS listing_status (
      id TEXT PRIMARY KEY,
      batch_path TEXT NOT NULL,
      sku_code TEXT NOT NULL,
      platform TEXT NOT NULL,
      workspace_id TEXT NOT NULL,
      status TEXT NOT NULL,
      draft_template_id TEXT,
      retry_count INTEGER NOT NULL DEFAULT 0,
      last_attempted_at INTEGER,
      last_error_code TEXT,
      last_error TEXT,
      evidence_dir TEXT,
      created_at INTEGER NOT NULL,
      UNIQUE(batch_path, sku_code, platform, workspace_id)
    );
  `)
  try {
    db.exec('ALTER TABLE listing_status ADD COLUMN last_error_code TEXT;')
  } catch {
    // Existing databases may already have the column.
  }
}

async function readWorkbenchRoot(
  readConfig: () => Promise<{ workbench_root?: string | undefined }>,
) {
  const config = await readConfig()
  if (!config.workbench_root) {
    throw new AppErrorClass('HTTP_4XX', '请先在设置里选择工作区', false)
  }
  return config.workbench_root
}

async function readAppConfig() {
  return (await import('../../main/onboarding')).readAppConfig()
}

function isListingStatusRow(value: unknown): value is ListingStatusRow {
  if (!isRecord(value)) {
    return false
  }
  return (
    typeof value.id === 'string' &&
    typeof value.batch_path === 'string' &&
    typeof value.sku_code === 'string' &&
    typeof value.platform === 'string' &&
    typeof value.workspace_id === 'string' &&
    isListingStatus(value.status) &&
    typeof value.retry_count === 'number' &&
    typeof value.created_at === 'number'
  )
}

function isListingStatus(value: unknown): value is ListingStatus {
  return (
    value === 'pending' ||
    value === 'uploading' ||
    value === 'success' ||
    value === 'failed' ||
    value === 'skipped'
  )
}

function parseListingRunRequest(input: unknown): {
  config: ListingRunConfig
  items: ListingItem[]
} {
  const parsed = listingRunRequestSchema.safeParse(input)
  if (!parsed.success) {
    throw new AppErrorClass('HTTP_4XX', '上架任务参数不正确', false, {
      kind: 'validation',
      issues: parsed.error.issues,
    })
  }
  return {
    config: toListingRunConfig(parsed.data.config),
    items: parsed.data.items,
  }
}

function toListingRunConfig(config: z.infer<typeof listingRunConfigSchema>): ListingRunConfig {
  const result: ListingRunConfig = {
    batch_dir: config.batch_dir,
    platform: config.platform,
    template: config.template,
    workspaces: config.workspaces.map(toListingWorkspace),
  }
  if (config.task_id !== undefined) {
    result.task_id = config.task_id
  }
  if (config.batch_id !== undefined) {
    result.batch_id = config.batch_id
  }
  if (config.submit_mode !== undefined) {
    result.submit_mode = config.submit_mode
  }
  if (config.max_attempts !== undefined) {
    result.max_attempts = config.max_attempts
  }
  if (config.timeout_ms !== undefined) {
    result.timeout_ms = config.timeout_ms
  }
  if (config.fail_streak_limit !== undefined) {
    result.fail_streak_limit = config.fail_streak_limit
  }
  if (config.resume !== undefined) {
    result.resume = config.resume
  }
  if (config.retry_failed_only !== undefined) {
    result.retry_failed_only = config.retry_failed_only
  }
  if (config.evidence_dir !== undefined) {
    result.evidence_dir = config.evidence_dir
  }
  return result
}

function toListingWorkspace(
  workspace: z.infer<typeof listingWorkspaceRunSchema>,
): ListingWorkspace {
  const result: ListingWorkspace = {
    profile_id: workspace.profile_id,
  }
  if (workspace.task_id !== undefined) {
    result.task_id = workspace.task_id
  }
  if (workspace.workspace_id !== undefined) {
    result.workspace_id = workspace.workspace_id
  }
  return result
}

function isListingItemLike(value: unknown): value is ListingItem {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    typeof value.sku === 'string' &&
    typeof value.title === 'string'
  )
}

function isListingTemplateConfig(value: unknown): value is ListingTemplateConfig {
  return (
    isRecord(value) &&
    isListingTemplateKey(value.key) &&
    isListingPlatformKey(value.platform) &&
    typeof value.label === 'string' &&
    typeof value.editUrl === 'string' &&
    typeof value.materialRootDir === 'string' &&
    Array.isArray(value.excludedFolderNames) &&
    value.excludedFolderNames.every((item) => typeof item === 'string') &&
    (value.skuMode === 'manual' || value.skuMode === 'one-click-generate') &&
    typeof value.uploadVideo === 'boolean' &&
    Array.isArray(value.requiredImageGroups)
  )
}

function isListingTemplateKey(value: unknown): value is ListingTemplateKey {
  return value === 'temu-clothing' || value === 'temu-general' || value === 'shein'
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isListingFailureLike(error: unknown): error is ListingFailure {
  if (!isRecord(error)) {
    return false
  }
  return (
    typeof error.code === 'string' &&
    typeof error.appErrorCode === 'string' &&
    typeof error.message === 'string' &&
    typeof error.retryable === 'boolean' &&
    typeof error.stage === 'string'
  )
}

function electronIpcMain() {
  return (nodeRequire('electron') as typeof import('electron')).ipcMain
}

function electronDialog() {
  return (nodeRequire('electron') as typeof import('electron')).dialog
}

function electronShell() {
  return (nodeRequire('electron') as typeof import('electron')).shell
}

function emitListingProgress(progress: ListingProgress) {
  for (const window of electronBrowserWindow().getAllWindows()) {
    window.webContents.send('listing:progress', progress)
  }
}

function listingTemplateByKey(value: unknown) {
  const template = SLICE_8_LISTING_TEMPLATES.find((item) => item.key === value)
  return template ?? SLICE_8_LISTING_TEMPLATES[0]
}

function parseListingStatusListInput(input: unknown): ListingStatusListInput {
  if (!isRecord(input) || typeof input.batchDir !== 'string') {
    throw new AppErrorClass('HTTP_4XX', '读取上架状态参数不正确', false, {
      kind: 'validation',
    })
  }
  const result: ListingStatusListInput = {
    batchDir: input.batchDir,
  }
  if (isListingPlatformKey(input.platform)) {
    result.platform = input.platform
  }
  if (isListingStatus(input.status)) {
    result.status = input.status
  }
  return result
}

function parseListingWorkspaceInput(input: unknown): ListingWorkspaceInput {
  const parsed = listingWorkspaceInputSchema.safeParse(input)
  if (!parsed.success) {
    throw new AppErrorClass('HTTP_4XX', '保存店铺环境参数不正确', false, {
      kind: 'validation',
      issues: parsed.error.issues,
    })
  }
  return parsed.data
}

function parseListingWorkspaceStatusInput(input: unknown): {
  workspaceId: string
  status: ListingWorkspaceStatus
  currentTaskId: string | null
} {
  const parsed = listingWorkspaceStatusInputSchema.safeParse(input)
  if (!parsed.success) {
    throw new AppErrorClass('HTTP_4XX', '更新店铺环境状态参数不正确', false, {
      kind: 'validation',
      issues: parsed.error.issues,
    })
  }
  return parsed.data
}

function parseListingTaskInput(input: unknown): ListingTaskInput {
  const parsed = listingTaskInputSchema.safeParse(input)
  if (!parsed.success) {
    throw new AppErrorClass('HTTP_4XX', '保存上架任务参数不正确', false, {
      kind: 'validation',
      issues: parsed.error.issues,
    })
  }
  return parsed.data
}

function parseListingTaskListInput(input: unknown): ListingTaskListInput {
  const parsed = listingTaskListInputSchema.safeParse(input)
  if (!parsed.success) {
    throw new AppErrorClass('HTTP_4XX', '读取上架任务参数不正确', false, {
      kind: 'validation',
      issues: parsed.error.issues,
    })
  }
  const data = parsed.data ?? {}
  const result: ListingTaskListInput = {}
  if (data.workspaceId !== undefined) {
    result.workspaceId = data.workspaceId
  }
  if (data.status !== undefined) {
    result.status = data.status
  }
  return result
}

function parseListingTaskStatusInput(input: unknown): {
  taskId: string
  status: ListingTaskStatus
  lastRunTaskId?: string | null
} {
  const parsed = listingTaskStatusInputSchema.safeParse(input)
  if (!parsed.success) {
    throw new AppErrorClass('HTTP_4XX', '更新上架任务状态参数不正确', false, {
      kind: 'validation',
      issues: parsed.error.issues,
    })
  }
  const result: {
    taskId: string
    status: ListingTaskStatus
    lastRunTaskId?: string | null
  } = {
    taskId: parsed.data.taskId,
    status: parsed.data.status,
  }
  if (parsed.data.lastRunTaskId !== undefined) {
    result.lastRunTaskId = parsed.data.lastRunTaskId
  }
  return result
}

function parseListingTaskDeleteInput(input: unknown): {
  taskId: string
} {
  const parsed = listingTaskDeleteInputSchema.safeParse(input)
  if (!parsed.success) {
    throw new AppErrorClass('HTTP_4XX', '删除上架任务参数不正确', false, {
      kind: 'validation',
      issues: parsed.error.issues,
    })
  }
  return parsed.data
}

function isListingPlatformKey(value: unknown): value is ListingPlatformKey {
  return value === 'temu-pop' || value === 'shein'
}

function electronBrowserWindow(): ElectronBrowserWindowConstructor {
  return (nodeRequire('electron') as typeof import('electron')).BrowserWindow
}

export const listingRunner = new ListingRunner({
  emitProgress: emitListingProgress,
  workflows: {
    'temu-pop': temuPopWorkflow,
    shein: sheinWorkflow,
  },
})
