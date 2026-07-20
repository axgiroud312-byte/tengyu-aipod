import { randomUUID } from 'node:crypto'
import { basename, resolve } from 'node:path'
import { AppErrorClass } from '@tengyu-aipod/shared'
import { z } from 'zod'
import type { SqliteDatabase } from '../sqlite'

const PENDING_TITLE_WRITE_VERSION = 1 as const

const pendingTitleWriteSchema = z.object({
  version: z.literal(PENDING_TITLE_WRITE_VERSION),
  runId: z.string().min(1),
  batchDir: z.string().min(1),
  xlsxPath: z.string().min(1),
  titles: z.record(z.string(), z.string()),
  language: z.string().min(1),
  platform: z.string().min(1),
  model: z.string().min(1),
  skill: z.object({
    id: z.string().min(1),
    version: z.string().min(1),
  }),
  generatedAt: z.number().finite(),
  updatedAt: z.number().finite(),
})

const pendingTitleWriteRowSchema = z.object({
  run_id: z.string().min(1),
  batch_dir: z.string().min(1),
  xlsx_path: z.string().min(1),
  titles_json: z.string(),
  language: z.string().min(1),
  platform: z.string().min(1),
  model: z.string().min(1),
  skill_id: z.string().min(1),
  skill_version: z.string().min(1),
  generated_at: z.number().finite(),
  updated_at: z.number().finite(),
  revision: z.string().min(1),
})

export type PendingTitleWrite = z.infer<typeof pendingTitleWriteSchema>

export type PendingTitleWriteRecord = PendingTitleWrite & {
  revision: string
}

type PendingTitleWriteInput = Omit<PendingTitleWrite, 'version' | 'updatedAt'>
type PendingTitleWriteRemoval = Pick<PendingTitleWriteRecord, 'runId' | 'batchDir'> &
  Partial<Pick<PendingTitleWriteRecord, 'revision'>>
type PendingTitleWriteDatabase = Pick<SqliteDatabase, 'exec' | 'prepare'>

function pendingTitleWriteDatabaseError(
  operation: 'savePendingTitleWrite' | 'removePendingTitleWrite' | 'listPendingTitleWrites',
  error: unknown,
  details?: Record<string, unknown>,
) {
  if (error instanceof AppErrorClass) {
    return error
  }
  return new AppErrorClass(
    'WORKSPACE_IO_FAILED',
    '无法访问标题待补写记录，请检查工作区数据库权限和磁盘状态后重试',
    false,
    { operation, ...details },
    error,
  )
}

function rollbackQuietly(database: Pick<SqliteDatabase, 'exec'>) {
  try {
    database.exec('ROLLBACK')
  } catch {
    // Preserve the database error that caused the transaction to fail.
  }
}

function withImmediateTransaction<T>(
  database: PendingTitleWriteDatabase,
  operation: 'savePendingTitleWrite' | 'removePendingTitleWrite',
  details: Record<string, unknown>,
  execute: () => T,
): T {
  let transactionStarted = false
  try {
    database.exec('BEGIN IMMEDIATE')
    transactionStarted = true
    const result = execute()
    database.exec('COMMIT')
    return result
  } catch (error) {
    if (transactionStarted) {
      rollbackQuietly(database)
    }
    throw pendingTitleWriteDatabaseError(operation, error, details)
  }
}

function parsePendingTitleWriteRow(value: unknown): PendingTitleWriteRecord {
  try {
    const row = pendingTitleWriteRowSchema.parse(value)
    const titles = z.record(z.string(), z.string()).parse(JSON.parse(row.titles_json))
    return {
      version: PENDING_TITLE_WRITE_VERSION,
      runId: row.run_id,
      batchDir: row.batch_dir,
      xlsxPath: row.xlsx_path,
      titles,
      language: row.language,
      platform: row.platform,
      model: row.model,
      skill: { id: row.skill_id, version: row.skill_version },
      generatedAt: row.generated_at,
      updatedAt: row.updated_at,
      revision: row.revision,
    }
  } catch (error) {
    const row = value && typeof value === 'object' ? (value as Record<string, unknown>) : null
    throw new AppErrorClass(
      'INVALID_INPUT',
      '标题待补写数据库记录损坏，请修复工作区数据库后重试',
      false,
      {
        runId: typeof row?.run_id === 'string' ? row.run_id : null,
        batchDir: typeof row?.batch_dir === 'string' ? row.batch_dir : null,
      },
      error,
    )
  }
}

function readPendingTitleWrite(
  database: Pick<SqliteDatabase, 'prepare'>,
  runId: string,
  batchDir: string,
) {
  const row = database
    .prepare(
      `
        SELECT
          run_id,
          batch_dir,
          xlsx_path,
          titles_json,
          language,
          platform,
          model,
          skill_id,
          skill_version,
          generated_at,
          updated_at,
          revision
        FROM pending_title_writes
        WHERE run_id = ? AND batch_dir = ?
      `,
    )
    .get(runId, batchDir)
  return row ? parsePendingTitleWriteRow(row) : null
}

export function pendingTitleXlsxPathKey(xlsxPath: string) {
  const absolutePath = resolve(xlsxPath)
  return process.platform === 'win32' ? absolutePath.toLowerCase() : absolutePath
}

export async function savePendingTitleWrite(
  database: PendingTitleWriteDatabase,
  input: PendingTitleWriteInput,
) {
  return withImmediateTransaction(
    database,
    'savePendingTitleWrite',
    { runId: input.runId, batchDir: input.batchDir },
    () => {
      const existing = readPendingTitleWrite(database, input.runId, input.batchDir)
      const value = pendingTitleWriteSchema.parse({
        ...input,
        titles: {
          ...(existing?.titles ?? {}),
          ...input.titles,
        },
        version: PENDING_TITLE_WRITE_VERSION,
        updatedAt: Date.now(),
      })
      const revision = randomUUID()
      database
        .prepare(
          `
            INSERT INTO pending_title_writes (
              run_id,
              batch_dir,
              xlsx_path,
              titles_json,
              language,
              platform,
              model,
              skill_id,
              skill_version,
              generated_at,
              updated_at,
              revision
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(run_id, batch_dir) DO UPDATE SET
              xlsx_path = excluded.xlsx_path,
              titles_json = excluded.titles_json,
              language = excluded.language,
              platform = excluded.platform,
              model = excluded.model,
              skill_id = excluded.skill_id,
              skill_version = excluded.skill_version,
              generated_at = excluded.generated_at,
              updated_at = excluded.updated_at,
              revision = excluded.revision
          `,
        )
        .run(
          value.runId,
          value.batchDir,
          value.xlsxPath,
          JSON.stringify(value.titles),
          value.language,
          value.platform,
          value.model,
          value.skill.id,
          value.skill.version,
          value.generatedAt,
          value.updatedAt,
          revision,
        )
      return { ...value, revision }
    },
  )
}

export async function removePendingTitleWrite(
  database: PendingTitleWriteDatabase,
  record: PendingTitleWriteRemoval,
) {
  return withImmediateTransaction(
    database,
    'removePendingTitleWrite',
    { runId: record.runId, batchDir: record.batchDir },
    () => {
      if (record.revision !== undefined) {
        database
          .prepare(
            'DELETE FROM pending_title_writes WHERE run_id = ? AND batch_dir = ? AND revision = ?',
          )
          .run(record.runId, record.batchDir, record.revision)
        return
      }
      database
        .prepare('DELETE FROM pending_title_writes WHERE run_id = ? AND batch_dir = ?')
        .run(record.runId, record.batchDir)
    },
  )
}

export async function listPendingTitleWrites(database: Pick<SqliteDatabase, 'prepare'>) {
  try {
    return database
      .prepare(
        `
          SELECT
            run_id,
            batch_dir,
            xlsx_path,
            titles_json,
            language,
            platform,
            model,
            skill_id,
            skill_version,
            generated_at,
            updated_at,
            revision
          FROM pending_title_writes
          ORDER BY updated_at, run_id, batch_dir
        `,
      )
      .all()
      .map(parsePendingTitleWriteRow)
  } catch (error) {
    throw pendingTitleWriteDatabaseError('listPendingTitleWrites', error)
  }
}

export function pendingTitleMap(record: PendingTitleWriteRecord) {
  return new Map(Object.entries(record.titles))
}

export function pendingTitleBatchName(record: PendingTitleWriteRecord) {
  return basename(record.batchDir)
}
