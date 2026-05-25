import { randomUUID } from 'node:crypto'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import {
  AppErrorClass,
  type ListingConfig,
  type ListingFailure,
  type ListingItem,
  type ListingPlatformKey,
  type ListingProgress,
  type ListingResult,
  type ListingStage,
  type ListingStatus,
  type ListingTemplateConfig,
  type ListingTemplateKey,
  WORKBENCH_DIRECTORIES,
  type WorkspaceResult,
  createListingFailure,
  listingFailureFromAppError,
} from '@tengyu-aipod/shared'
import Database from 'better-sqlite3'
import type { Browser as PlaywrightBrowser, Page as PlaywrightPage } from 'playwright'
import {
  type BrowserProfileLockManager,
  browserProfileLocks,
} from '../../main/lib/browser-profile-lock'
import { type CDPClient, cdpClient } from '../../main/lib/cdp-client'
import { sheinWorkflow } from './platforms/dianxiaomi-shein/workflow'
import { temuPopWorkflow } from './platforms/dianxiaomi-temu-pop/workflow'

const nodeRequire = createRequire(import.meta.url)
type ElectronBrowserWindowConstructor = typeof import('electron').BrowserWindow

export type ListingWorkspace = {
  profile_id: string
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
  last_error: string | null
  evidence_dir: string | null
  created_at: number
}

export type ListingStatusStore = {
  find(args: ListingStatusKey): Promise<ListingStatusRow | null> | ListingStatusRow | null
  upsert(args: ListingStatusUpsert): Promise<void> | void
  close?(): void
}

export type ListingProgressEmitter = (progress: ListingProgress) => void

export type ListingRunnerDependencies = {
  readConfig?: () => Promise<{ workbench_root?: string | undefined }>
  openStatusStore?: (workbenchRoot: string) => ListingStatusStore
  cdp?: Pick<CDPClient, 'connectToProfile' | 'disconnect'>
  locks?: BrowserProfileLockManager
  workflows?: Partial<Record<ListingPlatformKey, ListingWorkflow>>
  emitProgress?: ListingProgressEmitter
  randomId?: () => string
  now?: () => number
  sleep?: (ms: number) => Promise<void>
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
  private readonly cdp: Pick<CDPClient, 'connectToProfile' | 'disconnect'>
  private readonly locks: BrowserProfileLockManager
  private readonly workflows: Partial<Record<ListingPlatformKey, ListingWorkflow>>
  private readonly emitProgress: ListingProgressEmitter | undefined
  private readonly randomId: () => string
  private readonly now: () => number
  private readonly sleep: (ms: number) => Promise<void>

  constructor(dependencies: ListingRunnerDependencies = {}) {
    this.readConfig = dependencies.readConfig ?? readAppConfig
    this.openStatusStore = dependencies.openStatusStore ?? openWorkbenchListingStatusStore
    this.cdp = dependencies.cdp ?? cdpClient
    this.locks = dependencies.locks ?? browserProfileLocks
    this.workflows = dependencies.workflows ?? {}
    this.emitProgress = dependencies.emitProgress
    this.randomId = dependencies.randomId ?? randomUUID
    this.now = dependencies.now ?? Date.now
    this.sleep = dependencies.sleep ?? sleep
  }

  async runLocalListingBatch(config: ListingRunConfig, items: ListingItem[]): Promise<BatchResult> {
    const resolved = normalizeRunConfig(config, {
      randomId: this.randomId,
    })
    if (resolved.workspaces.length === 0) {
      throw new AppErrorClass('HTTP_4XX', '请先选择至少一个比特浏览器工作区', false, {
        kind: 'validation',
      })
    }

    const workbenchRoot = await readWorkbenchRoot(this.readConfig)
    const store = this.openStatusStore(workbenchRoot)
    const queues = assignItemsToWorkspaces(items, resolved.workspaces)
    const progress = createProgressSnapshot(items.length, queues)

    try {
      this.emitBatchProgress(resolved, progress, 'pending')
      const workspaceResults = await Promise.all(
        Array.from(queues.entries()).map(([profileId, queue]) =>
          this.runWorkspaceQueue(profileId, queue, resolved, store, progress),
        ),
      )
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
    }
  }

  async runWorkspace(
    profileId: string,
    queue: ListingItem[],
    config: ListingRunConfig,
  ): Promise<WorkspaceResult> {
    const resolved = normalizeRunConfig(config, {
      randomId: this.randomId,
    })
    const workbenchRoot = await readWorkbenchRoot(this.readConfig)
    const store = this.openStatusStore(workbenchRoot)
    const progress = createProgressSnapshot(queue.length, new Map([[profileId, queue]]))
    try {
      return await this.runWorkspaceQueue(profileId, queue, resolved, store, progress)
    } finally {
      store.close?.()
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
  ): Promise<WorkspaceResult> {
    const lock = this.locks.acquire(profileId, 'listing', config.task_id)
    let browser: PlaywrightBrowser | null = null
    let page: PlaywrightPage | null = null
    const results: ListingResult[] = []
    let failStreak = 0

    try {
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
            evidenceDir: result.evidenceDir ?? evidenceDirFor(config, profileId, item),
          })
        } else {
          failStreak += 1
          await store.upsert({
            ...statusKey,
            status: 'failed',
            retryCount: result.attemptCount,
            lastAttemptedAt: this.now(),
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
            message: `连续 ${failStreak} 次失败，工作区暂停`,
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
              lastError: pausedFailure.message,
              evidenceDir: evidenceDirFor(config, profileId, remaining),
            })
          }
          this.emitBatchProgress(config, progress, 'failed')
          break
        }
      }
    } finally {
      await page?.close().catch(() => undefined)
      await this.closeBrowser(profileId, browser)
      lock.release()
    }

    const runtime = progress.byWorkspace.get(profileId)
    return {
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
}

export class SqliteListingStatusStore implements ListingStatusStore {
  constructor(private readonly db: Pick<Database.Database, 'exec' | 'prepare' | 'close'>) {
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
          last_error,
          evidence_dir,
          created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(batch_path, sku_code, platform, workspace_id) DO UPDATE SET
          status = excluded.status,
          draft_template_id = excluded.draft_template_id,
          retry_count = excluded.retry_count,
          last_attempted_at = excluded.last_attempted_at,
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
  ipcMain.handle('listing:run', async (_event, input: unknown) => {
    if (!isListingRunRequest(input)) {
      throw new AppErrorClass('HTTP_4XX', '上架任务参数不正确', false, {
        kind: 'validation',
      })
    }
    const taskId = input.config.task_id ?? randomUUID()
    void listingRunner
      .runLocalListingBatch({ ...input.config, task_id: taskId }, input.items)
      .catch(() => null)
    return taskId
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

function normalizeRunConfig(
  config: ListingRunConfig,
  dependencies: Pick<ListingRunnerDependencies, 'randomId'> = {},
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
      config.evidence_dir ?? join(config.batch_dir, '.workbench', 'tmp', 'listing', taskId),
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
  return join(config.evidence_dir, profileId || 'workspace', item.sku)
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
  return new SqliteListingStatusStore(new Database(workbenchDbPath(workbenchRoot)))
}

function ensureListingStatusTable(db: Pick<Database.Database, 'exec'>) {
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
      last_error TEXT,
      evidence_dir TEXT,
      created_at INTEGER NOT NULL,
      UNIQUE(batch_path, sku_code, platform, workspace_id)
    );
  `)
}

async function readWorkbenchRoot(
  readConfig: () => Promise<{ workbench_root?: string | undefined }>,
) {
  const config = await readConfig()
  if (!config.workbench_root) {
    throw new AppErrorClass('HTTP_4XX', '请先设置素材总目录', false)
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

function isListingRunRequest(value: unknown): value is {
  config: ListingRunConfig
  items: ListingItem[]
} {
  if (!isRecord(value) || !isRecord(value.config) || !Array.isArray(value.items)) {
    return false
  }
  return typeof value.config.batch_dir === 'string' && value.items.every(isListingItemLike)
}

function isListingItemLike(value: unknown): value is ListingItem {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    typeof value.sku === 'string' &&
    typeof value.title === 'string'
  )
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

function emitListingProgress(progress: ListingProgress) {
  for (const window of electronBrowserWindow().getAllWindows()) {
    window.webContents.send('listing:progress', progress)
  }
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
