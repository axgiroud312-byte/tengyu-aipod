import { randomUUID } from 'node:crypto'
import type {
  ListingPlatformKey,
  ListingTaskInput,
  ListingTaskRecord,
  ListingTaskStatus,
  ListingTemplateKey,
  ListingWorkspaceInput,
  ListingWorkspaceRecord,
  ListingWorkspaceStatus,
} from '@tengyu-aipod/shared'
import type { SqliteDatabase } from '../../main/lib/sqlite'

export type ListingTaskStoreDatabase = Pick<SqliteDatabase, 'close' | 'exec' | 'prepare'>

export type ListingTaskListInput = {
  workspaceId?: string
  status?: ListingTaskStatus
}

export class SqliteListingTaskStore {
  constructor(private readonly db: ListingTaskStoreDatabase) {
    ensureListingOrchestrationTables(this.db)
  }

  listWorkspaces(): ListingWorkspaceRecord[] {
    const rows = this.db
      .prepare(
        `
        SELECT *
        FROM listing_workspaces
        ORDER BY updated_at DESC, profile_name ASC
      `,
      )
      .all() as unknown[]
    return rows.filter(isListingWorkspaceRecord)
  }

  upsertWorkspace(input: ListingWorkspaceInput): ListingWorkspaceRecord {
    const now = Date.now()
    this.db
      .prepare(
        `
        INSERT INTO listing_workspaces (
          id,
          profile_id,
          profile_name,
          platform,
          status,
          current_task_id,
          created_at,
          updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(profile_id, platform) DO UPDATE SET
          profile_name = excluded.profile_name,
          updated_at = excluded.updated_at
      `,
      )
      .run(
        randomUUID(),
        input.profile_id,
        input.profile_name,
        input.platform,
        'idle',
        null,
        now,
        now,
      )

    const workspace = this.findWorkspaceByProfile(input.profile_id, input.platform)
    if (!workspace) {
      throw new Error('保存上架工作区失败')
    }
    return workspace
  }

  findWorkspaceByProfile(
    profileId: string,
    platform: ListingPlatformKey,
  ): ListingWorkspaceRecord | null {
    const row = this.db
      .prepare(
        `
        SELECT *
        FROM listing_workspaces
        WHERE profile_id = ? AND platform = ?
      `,
      )
      .get(profileId, platform)
    return isListingWorkspaceRecord(row) ? row : null
  }

  updateWorkspaceStatus(
    workspaceId: string,
    status: ListingWorkspaceStatus,
    currentTaskId: string | null,
  ): ListingWorkspaceRecord | null {
    const now = Date.now()
    this.db
      .prepare(
        `
        UPDATE listing_workspaces
        SET status = ?, current_task_id = ?, updated_at = ?
        WHERE id = ?
      `,
      )
      .run(status, currentTaskId, now, workspaceId)
    return this.findWorkspaceById(workspaceId)
  }

  createTask(input: ListingTaskInput): ListingTaskRecord {
    const now = Date.now()
    const id = randomUUID()
    this.db
      .prepare(
        `
        INSERT INTO listing_tasks (
          id,
          workspace_id,
          platform,
          template_key,
          draft_template_id,
          shop_name,
          batch_dir,
          sku_mode,
          submit_mode,
          max_attempts,
          fail_streak_limit,
          resume,
          status,
          last_run_task_id,
          created_at,
          updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      )
      .run(
        id,
        input.workspace_id,
        input.platform,
        input.template_key,
        input.draft_template_id,
        input.shop_name,
        input.batch_dir,
        input.sku_mode,
        input.submit_mode,
        input.max_attempts,
        input.fail_streak_limit,
        input.resume ? 1 : 0,
        'queued',
        null,
        now,
        now,
      )

    const task = this.findTaskById(id)
    if (!task) {
      throw new Error('保存上架任务失败')
    }
    return task
  }

  listTasks(input: ListingTaskListInput = {}): ListingTaskRecord[] {
    const filters: string[] = []
    const params: string[] = []
    if (input.workspaceId) {
      filters.push('workspace_id = ?')
      params.push(input.workspaceId)
    }
    if (input.status) {
      filters.push('status = ?')
      params.push(input.status)
    }
    const where = filters.length > 0 ? `WHERE ${filters.join(' AND ')}` : ''
    const rows = this.db
      .prepare(
        `
        SELECT *
        FROM listing_tasks
        ${where}
        ORDER BY created_at DESC
      `,
      )
      .all(...params)
    return rows.map(toListingTaskRecord).filter((row): row is ListingTaskRecord => Boolean(row))
  }

  updateTaskStatus(
    taskId: string,
    status: ListingTaskStatus,
    lastRunTaskId?: string | null,
  ): ListingTaskRecord | null {
    const now = Date.now()
    this.db
      .prepare(
        `
        UPDATE listing_tasks
        SET status = ?,
            last_run_task_id = COALESCE(?, last_run_task_id),
            updated_at = ?
        WHERE id = ?
      `,
      )
      .run(status, lastRunTaskId ?? null, now, taskId)
    return this.findTaskById(taskId)
  }

  deleteTask(taskId: string): void {
    this.db.prepare('DELETE FROM listing_tasks WHERE id = ?').run(taskId)
  }

  close(): void {
    this.db.close()
  }

  private findWorkspaceById(workspaceId: string): ListingWorkspaceRecord | null {
    const row = this.db.prepare('SELECT * FROM listing_workspaces WHERE id = ?').get(workspaceId)
    return isListingWorkspaceRecord(row) ? row : null
  }

  private findTaskById(taskId: string): ListingTaskRecord | null {
    const row = this.db.prepare('SELECT * FROM listing_tasks WHERE id = ?').get(taskId)
    return toListingTaskRecord(row)
  }
}

export function ensureListingOrchestrationTables(db: Pick<SqliteDatabase, 'exec'>): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS listing_workspaces (
      id TEXT PRIMARY KEY,
      profile_id TEXT NOT NULL,
      profile_name TEXT NOT NULL,
      platform TEXT NOT NULL,
      status TEXT NOT NULL,
      current_task_id TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      UNIQUE(profile_id, platform)
    );

    CREATE TABLE IF NOT EXISTS listing_tasks (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL,
      platform TEXT NOT NULL,
      template_key TEXT NOT NULL,
      draft_template_id TEXT NOT NULL,
      shop_name TEXT NOT NULL,
      batch_dir TEXT NOT NULL,
      sku_mode TEXT NOT NULL,
      submit_mode TEXT NOT NULL,
      max_attempts INTEGER NOT NULL,
      fail_streak_limit INTEGER NOT NULL,
      resume INTEGER NOT NULL,
      status TEXT NOT NULL,
      last_run_task_id TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      FOREIGN KEY(workspace_id) REFERENCES listing_workspaces(id)
    );

    CREATE INDEX IF NOT EXISTS idx_listing_tasks_workspace
      ON listing_tasks(workspace_id, status, created_at);
  `)
}

function isListingWorkspaceRecord(value: unknown): value is ListingWorkspaceRecord {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    typeof value.profile_id === 'string' &&
    typeof value.profile_name === 'string' &&
    isListingPlatformKey(value.platform) &&
    isListingWorkspaceStatus(value.status) &&
    (value.current_task_id === null || typeof value.current_task_id === 'string') &&
    typeof value.created_at === 'number' &&
    typeof value.updated_at === 'number'
  )
}

function toListingTaskRecord(value: unknown): ListingTaskRecord | null {
  if (
    !(
      isRecord(value) &&
      typeof value.id === 'string' &&
      typeof value.workspace_id === 'string' &&
      isListingPlatformKey(value.platform) &&
      isListingTemplateKey(value.template_key) &&
      typeof value.draft_template_id === 'string' &&
      typeof value.shop_name === 'string' &&
      typeof value.batch_dir === 'string' &&
      (value.sku_mode === 'manual' || value.sku_mode === 'one-click-generate') &&
      (value.submit_mode === 'save-draft' || value.submit_mode === 'publish') &&
      typeof value.max_attempts === 'number' &&
      typeof value.fail_streak_limit === 'number' &&
      (value.resume === 0 || value.resume === 1 || typeof value.resume === 'boolean') &&
      isListingTaskStatus(value.status) &&
      (value.last_run_task_id === null || typeof value.last_run_task_id === 'string') &&
      typeof value.created_at === 'number' &&
      typeof value.updated_at === 'number'
    )
  ) {
    return null
  }

  return {
    id: value.id,
    workspace_id: value.workspace_id,
    platform: value.platform,
    template_key: value.template_key,
    draft_template_id: value.draft_template_id,
    shop_name: value.shop_name,
    batch_dir: value.batch_dir,
    sku_mode: value.sku_mode,
    submit_mode: value.submit_mode,
    max_attempts: value.max_attempts,
    fail_streak_limit: value.fail_streak_limit,
    resume: value.resume === true || value.resume === 1,
    status: value.status,
    last_run_task_id: value.last_run_task_id,
    created_at: value.created_at,
    updated_at: value.updated_at,
  }
}

function isListingPlatformKey(value: unknown): value is ListingPlatformKey {
  return value === 'temu-pop' || value === 'shein'
}

function isListingTemplateKey(value: unknown): value is ListingTemplateKey {
  return value === 'temu-clothing' || value === 'temu-general' || value === 'shein'
}

function isListingWorkspaceStatus(value: unknown): value is ListingWorkspaceStatus {
  return (
    value === 'idle' ||
    value === 'running' ||
    value === 'paused' ||
    value === 'failed' ||
    value === 'completed'
  )
}

function isListingTaskStatus(value: unknown): value is ListingTaskStatus {
  return (
    value === 'queued' ||
    value === 'running' ||
    value === 'paused' ||
    value === 'completed' ||
    value === 'failed'
  )
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
