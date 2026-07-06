import type {
  PipelineResultSection,
  PipelineRunConfig,
  PipelineRunDetail,
  PipelineRunStats,
  PipelineRuntimeLogEntry,
  PipelineSourceConfig,
} from '@tengyu-aipod/shared'
import type { SqliteDatabase } from '../sqlite'
import type {
  PipelineItemRecord,
  PipelineItemStatus,
  PipelineRunRecord,
  PipelineRunStatus,
  PipelineStepKey,
  PipelineStepRecord,
  PipelineStepStatus,
} from './types'

export type PipelineStoreDb = Pick<SqliteDatabase, 'prepare'>

export type UpsertPipelineItemInput = {
  runId: string
  itemKey: string
  stepKey: PipelineStepKey
  status: PipelineItemStatus
  sourcePath?: string | undefined
  outputPath?: string | undefined
  artifactId?: string | undefined
  printId?: string | undefined
  sourceArtifactIds?: string[] | undefined
  errorMessage?: string | undefined
  completed?: boolean | undefined
}

function optionalJsonText(value: unknown) {
  return typeof value === 'string' ? value : null
}

function parseJsonArray<T>(value: string | null | undefined): T[] {
  if (!value) {
    return []
  }
  try {
    const parsed = JSON.parse(value)
    return Array.isArray(parsed) ? (parsed as T[]) : []
  } catch {
    return []
  }
}

export function normalizePipelineRunRecord(value: unknown): PipelineRunRecord | null {
  if (!value || typeof value !== 'object') {
    return null
  }
  const row = value as Record<string, unknown>
  const id = row.id
  const name = row.name
  const sourceMode = row.source_mode
  const status = row.status
  const configJson = row.config_json
  const statsJson = row.stats_json
  const createdAt = row.created_at
  const isValid =
    typeof id === 'string' &&
    typeof name === 'string' &&
    typeof sourceMode === 'string' &&
    typeof status === 'string' &&
    typeof configJson === 'string' &&
    typeof statsJson === 'string' &&
    typeof createdAt === 'number'
  if (!isValid) {
    return null
  }
  return {
    id,
    name,
    source_mode: sourceMode as PipelineSourceConfig['mode'],
    status: status as PipelineRunStatus,
    config_json: configJson,
    stats_json: statsJson,
    result_sections_json: optionalJsonText(row.result_sections_json),
    logs_json: optionalJsonText(row.logs_json),
    error_summary: typeof row.error_summary === 'string' ? row.error_summary : null,
    created_at: createdAt,
    started_at: typeof row.started_at === 'number' ? row.started_at : null,
    completed_at: typeof row.completed_at === 'number' ? row.completed_at : null,
  }
}

function isPipelineStepRecord(value: unknown): value is PipelineStepRecord {
  if (!value || typeof value !== 'object') {
    return false
  }
  const row = value as Record<string, unknown>
  return (
    typeof row.id === 'string' &&
    typeof row.run_id === 'string' &&
    typeof row.step_key === 'string' &&
    typeof row.module === 'string' &&
    typeof row.label === 'string' &&
    typeof row.status === 'string' &&
    typeof row.input_count === 'number' &&
    typeof row.output_count === 'number' &&
    typeof row.updated_at === 'number'
  )
}

function isPipelineItemRecord(value: unknown): value is PipelineItemRecord {
  if (!value || typeof value !== 'object') {
    return false
  }
  const row = value as Record<string, unknown>
  return (
    typeof row.id === 'string' &&
    typeof row.run_id === 'string' &&
    typeof row.item_key === 'string' &&
    typeof row.step_key === 'string' &&
    typeof row.status === 'string' &&
    typeof row.created_at === 'number' &&
    typeof row.updated_at === 'number'
  )
}

export function readRunRow(db: PipelineStoreDb, runId: string) {
  const row = db.prepare('SELECT * FROM pipeline_runs WHERE id = ?').get(runId)
  return normalizePipelineRunRecord(row)
}

export function listRunRows(db: PipelineStoreDb) {
  const rows = db
    .prepare('SELECT * FROM pipeline_runs ORDER BY created_at DESC LIMIT 100')
    .all() as unknown[]
  return rows
    .map(normalizePipelineRunRecord)
    .filter((row): row is PipelineRunRecord => Boolean(row))
}

export function readStepRows(db: PipelineStoreDb, runId: string) {
  const rows = db
    .prepare(
      `
        SELECT *
        FROM pipeline_steps
        WHERE run_id = ?
        ORDER BY started_at IS NULL, started_at ASC, updated_at ASC
      `,
    )
    .all(runId) as unknown[]
  return rows.filter(isPipelineStepRecord)
}

export function readItemRows(db: PipelineStoreDb, runId: string) {
  const rows = db
    .prepare(
      `
        SELECT *
        FROM pipeline_items
        WHERE run_id = ?
        ORDER BY created_at ASC, updated_at ASC
      `,
    )
    .all(runId) as unknown[]
  return rows.filter(isPipelineItemRecord)
}

export function readRunDetail(db: PipelineStoreDb, runId: string): PipelineRunDetail | null {
  const run = readRunRow(db, runId)
  if (!run) {
    return null
  }
  return {
    run,
    steps: readStepRows(db, runId),
    items: readItemRows(db, runId),
    result_sections: parseJsonArray<PipelineResultSection>(run.result_sections_json),
    logs: parseJsonArray<PipelineRuntimeLogEntry>(run.logs_json),
  }
}

export function insertPipelineRun(
  db: PipelineStoreDb,
  input: {
    runId: string
    name: string
    config: PipelineRunConfig
    stats: PipelineRunStats
  },
) {
  const now = Date.now()
  db.prepare(
    `
      INSERT INTO pipeline_runs (
        id,
        name,
        source_mode,
        status,
        config_json,
        stats_json,
        result_sections_json,
        logs_json,
        error_summary,
        created_at,
        started_at,
        completed_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, NULL)
    `,
  ).run(
    input.runId,
    input.name,
    input.config.source.mode,
    'running',
    JSON.stringify(input.config),
    JSON.stringify(input.stats),
    '[]',
    '[]',
    now,
    now,
  )
}

export function updatePipelineRunCompleted(
  db: PipelineStoreDb,
  input: {
    runId: string
    status: PipelineRunStatus
    stats: PipelineRunStats
    error: string | null
  },
) {
  db.prepare(
    `
      UPDATE pipeline_runs
      SET status = ?,
          stats_json = ?,
          error_summary = ?,
          completed_at = ?
      WHERE id = ?
    `,
  ).run(input.status, JSON.stringify(input.stats), input.error, Date.now(), input.runId)
}

export function markPipelineRunResuming(
  db: PipelineStoreDb,
  input: {
    runId: string
    stats: PipelineRunStats
  },
) {
  db.prepare(
    `
      UPDATE pipeline_runs
      SET status = 'running',
          stats_json = ?,
          error_summary = NULL,
          started_at = COALESCE(started_at, ?),
          completed_at = NULL
      WHERE id = ?
    `,
  ).run(JSON.stringify(input.stats), Date.now(), input.runId)
}

export function updatePipelineRunUiState(
  db: PipelineStoreDb,
  input: {
    runId: string
    resultSections: PipelineResultSection[]
    logs: PipelineRuntimeLogEntry[]
  },
) {
  db.prepare(
    `
      UPDATE pipeline_runs
      SET result_sections_json = ?,
          logs_json = ?
      WHERE id = ?
    `,
  ).run(JSON.stringify(input.resultSections), JSON.stringify(input.logs), input.runId)
}

export function markPersistedRunningPipelineRunsInterrupted(
  db: PipelineStoreDb,
  completedAt: number,
) {
  db.prepare(
    `
      UPDATE pipeline_runs
      SET status = 'interrupted',
          error_summary = COALESCE(error_summary, '完整任务已中断，已完成产物已保留'),
          completed_at = COALESCE(completed_at, ?)
      WHERE status = 'running'
    `,
  ).run(completedAt)
}

export function markPersistedRunningPipelineStepsInterrupted(
  db: PipelineStoreDb,
  input: {
    completedAt: number
    updatedAt: number
  },
) {
  db.prepare(
    `
      UPDATE pipeline_steps
      SET status = 'interrupted',
          completed_at = COALESCE(completed_at, ?),
          updated_at = ?
      WHERE status = 'running'
    `,
  ).run(input.completedAt, input.updatedAt)
}

export function markPersistedRunningPipelineItemsInterrupted(
  db: PipelineStoreDb,
  input: {
    completedAt: number
    updatedAt: number
  },
) {
  db.prepare(
    `
      UPDATE pipeline_items
      SET status = 'interrupted',
          completed_at = COALESCE(completed_at, ?),
          updated_at = ?
      WHERE status = 'running'
    `,
  ).run(input.completedAt, input.updatedAt)
}

export function markPipelineRunInterrupted(
  db: PipelineStoreDb,
  input: {
    runId: string
    errorSummary: string
    completedAt: number
  },
) {
  db.prepare(
    `
      UPDATE pipeline_runs
      SET status = 'interrupted',
          error_summary = ?,
          completed_at = ?
      WHERE id = ?
    `,
  ).run(input.errorSummary, input.completedAt, input.runId)
}

export function markPipelineRunRunningStepsInterrupted(
  db: PipelineStoreDb,
  input: {
    runId: string
    completedAt: number
    updatedAt: number
  },
) {
  db.prepare(
    `
      UPDATE pipeline_steps
      SET status = 'interrupted',
          completed_at = COALESCE(completed_at, ?),
          updated_at = ?
      WHERE run_id = ? AND status = 'running'
    `,
  ).run(input.completedAt, input.updatedAt, input.runId)
}

export function markPipelineRunRunningItemsInterrupted(
  db: PipelineStoreDb,
  input: {
    runId: string
    completedAt: number
    updatedAt: number
  },
) {
  db.prepare(
    `
      UPDATE pipeline_items
      SET status = 'interrupted',
          completed_at = COALESCE(completed_at, ?),
          updated_at = ?
      WHERE run_id = ? AND status = 'running'
    `,
  ).run(input.completedAt, input.updatedAt, input.runId)
}

export function upsertPipelineItem(db: PipelineStoreDb, input: UpsertPipelineItemInput) {
  const now = Date.now()
  db.prepare(
    `
      INSERT INTO pipeline_items (
        id,
        run_id,
        item_key,
        step_key,
        status,
        source_path,
        output_path,
        artifact_id,
        print_id,
        source_artifact_ids_json,
        error_message,
        created_at,
        updated_at,
        completed_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(run_id, item_key, step_key) DO UPDATE SET
        status = excluded.status,
        source_path = COALESCE(excluded.source_path, pipeline_items.source_path),
        output_path = COALESCE(excluded.output_path, pipeline_items.output_path),
        artifact_id = COALESCE(excluded.artifact_id, pipeline_items.artifact_id),
        print_id = COALESCE(excluded.print_id, pipeline_items.print_id),
        source_artifact_ids_json = COALESCE(
          excluded.source_artifact_ids_json,
          pipeline_items.source_artifact_ids_json
        ),
        error_message = excluded.error_message,
        updated_at = excluded.updated_at,
        completed_at = excluded.completed_at
    `,
  ).run(
    `${input.runId}:${input.itemKey}:${input.stepKey}`,
    input.runId,
    input.itemKey,
    input.stepKey,
    input.status,
    input.sourcePath ?? null,
    input.outputPath ?? null,
    input.artifactId ?? null,
    input.printId ?? null,
    input.sourceArtifactIds ? JSON.stringify(input.sourceArtifactIds) : null,
    input.errorMessage ?? null,
    now,
    now,
    input.completed ? now : null,
  )
}

export function upsertPipelineStepRunning(
  db: PipelineStoreDb,
  input: {
    runId: string
    stepKey: PipelineStepKey
    module: string
    label: string
    inputCount: number
    outputCount: number
  },
) {
  const now = Date.now()
  db.prepare(
    `
      INSERT INTO pipeline_steps (
        id,
        run_id,
        step_key,
        module,
        label,
        status,
        input_count,
        output_count,
        output_json,
        error_json,
        started_at,
        completed_at,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?, NULL, ?)
      ON CONFLICT(run_id, step_key) DO UPDATE SET
        status = excluded.status,
        input_count = excluded.input_count,
        output_count = excluded.output_count,
        output_json = NULL,
        error_json = NULL,
        started_at = excluded.started_at,
        completed_at = NULL,
        updated_at = excluded.updated_at
    `,
  ).run(
    `${input.runId}:${input.stepKey}`,
    input.runId,
    input.stepKey,
    input.module,
    input.label,
    'running',
    input.inputCount,
    input.outputCount,
    now,
    now,
  )
}

export function upsertPipelineStepSkipped(
  db: PipelineStoreDb,
  input: {
    runId: string
    stepKey: PipelineStepKey
    module: string
    label: string
    inputCount: number
    outputCount: number
  },
) {
  const now = Date.now()
  db.prepare(
    `
      INSERT INTO pipeline_steps (
        id,
        run_id,
        step_key,
        module,
        label,
        status,
        input_count,
        output_count,
        output_json,
        error_json,
        started_at,
        completed_at,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL, ?, ?)
      ON CONFLICT(run_id, step_key) DO UPDATE SET
        status = excluded.status,
        input_count = excluded.input_count,
        output_count = excluded.output_count,
        completed_at = excluded.completed_at,
        updated_at = excluded.updated_at
    `,
  ).run(
    `${input.runId}:${input.stepKey}`,
    input.runId,
    input.stepKey,
    input.module,
    input.label,
    'skipped',
    input.inputCount,
    input.outputCount,
    now,
    now,
  )
}

export function updatePipelineStepInputCount(
  db: PipelineStoreDb,
  input: {
    runId: string
    stepKey: PipelineStepKey
    inputCount: number
  },
) {
  db.prepare(
    `
      UPDATE pipeline_steps
      SET input_count = ?, updated_at = ?
      WHERE run_id = ? AND step_key = ?
    `,
  ).run(input.inputCount, Date.now(), input.runId, input.stepKey)
}

export function updatePipelineStepOutputCount(
  db: PipelineStoreDb,
  input: {
    runId: string
    stepKey: PipelineStepKey
    outputCount: number
  },
) {
  db.prepare(
    `
      UPDATE pipeline_steps
      SET output_count = ?, updated_at = ?
      WHERE run_id = ? AND step_key = ?
    `,
  ).run(input.outputCount, Date.now(), input.runId, input.stepKey)
}

export function updatePipelineStepCounts(
  db: PipelineStoreDb,
  input: {
    runId: string
    stepKey: PipelineStepKey
    inputCount: number
    outputCount: number
  },
) {
  db.prepare(
    `
      UPDATE pipeline_steps
      SET input_count = ?, output_count = ?, updated_at = ?
      WHERE run_id = ? AND step_key = ?
    `,
  ).run(input.inputCount, input.outputCount, Date.now(), input.runId, input.stepKey)
}

export function updatePipelineStepCompleted(
  db: PipelineStoreDb,
  input: {
    runId: string
    stepKey: PipelineStepKey
    status: Extract<PipelineStepStatus, 'completed' | 'interrupted'>
    outputCount: number
    outputJson: unknown
  },
) {
  const now = Date.now()
  db.prepare(
    `
      UPDATE pipeline_steps
      SET status = ?,
          output_count = ?,
          output_json = ?,
          error_json = NULL,
          completed_at = ?,
          updated_at = ?
      WHERE run_id = ? AND step_key = ?
    `,
  ).run(
    input.status,
    input.outputCount,
    JSON.stringify(input.outputJson ?? null),
    now,
    now,
    input.runId,
    input.stepKey,
  )
}

export function updatePipelineStepCompletedWithInput(
  db: PipelineStoreDb,
  input: {
    runId: string
    stepKey: PipelineStepKey
    inputCount: number
    outputCount: number
    outputJson: unknown
  },
) {
  const now = Date.now()
  db.prepare(
    `
      UPDATE pipeline_steps
      SET status = 'completed',
          input_count = ?,
          output_count = ?,
          output_json = ?,
          completed_at = ?,
          updated_at = ?
      WHERE run_id = ? AND step_key = ?
    `,
  ).run(
    input.inputCount,
    input.outputCount,
    JSON.stringify(input.outputJson ?? null),
    now,
    now,
    input.runId,
    input.stepKey,
  )
}

export function updatePipelineStepFailed(
  db: PipelineStoreDb,
  input: {
    runId: string
    stepKey: PipelineStepKey
    status: Extract<PipelineStepStatus, 'cancelled' | 'failed'>
    errorJson: unknown
  },
) {
  const now = Date.now()
  db.prepare(
    `
      UPDATE pipeline_steps
      SET status = ?,
          error_json = ?,
          completed_at = ?,
          updated_at = ?
      WHERE run_id = ? AND step_key = ?
    `,
  ).run(input.status, JSON.stringify(input.errorJson), now, now, input.runId, input.stepKey)
}
