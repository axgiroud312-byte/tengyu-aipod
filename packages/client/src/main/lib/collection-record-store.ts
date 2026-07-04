import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { SqliteDatabase } from './sqlite'
import { openWorkbenchDatabase, workbenchDatabasePath } from './workbench-db'

export const COLLECTION_RECORD_LIST_LIMIT_DEFAULT = 20
export const COLLECTION_RECORD_LIST_LIMIT_MAX = 10_000

export type CollectionRecordStatus = 'success' | 'skipped' | 'failed'

export type CollectionRecordInput = {
  id: string
  sessionId: string
  skuCode?: string | null
  sourceUrl: string
  goodsLink?: string | null
  pageUrl: string
  savedPath?: string | null
  status: CollectionRecordStatus
  reason?: string | null
  fileSize?: number | null
  createdAt: number
}

export type CollectionRecordRow = CollectionRecordInput

export type CollectionDatabase = Pick<SqliteDatabase, 'exec' | 'prepare' | 'close'>

export type CollectionRecordQuery = {
  sessionId: string
  status?: CollectionRecordStatus | undefined
  limit?: number | undefined
}

export function openCollectionDatabase(workbenchRoot: string) {
  return openWorkbenchDatabase(workbenchDatabasePath(workbenchRoot))
}

export function insertCollectionRecord(
  db: Pick<SqliteDatabase, 'exec' | 'prepare'>,
  record: CollectionRecordInput,
) {
  db.prepare(`
    INSERT INTO collection_records (
      id,
      session_id,
      sku_code,
      source_url,
      goods_link,
      page_url,
      saved_path,
      status,
      reason,
      file_size,
      created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    record.id,
    record.sessionId,
    record.skuCode ?? null,
    record.sourceUrl,
    record.goodsLink ?? null,
    record.pageUrl,
    record.savedPath ?? null,
    record.status,
    record.reason ?? null,
    record.fileSize ?? null,
    record.createdAt,
  )
}

export function updateCollectionRecord(
  db: Pick<SqliteDatabase, 'exec' | 'prepare'>,
  record: CollectionRecordInput,
) {
  db.prepare(`
    UPDATE collection_records SET
      sku_code = ?,
      source_url = ?,
      goods_link = ?,
      page_url = ?,
      saved_path = ?,
      status = ?,
      reason = ?,
      file_size = ?,
      created_at = ?
    WHERE id = ?
  `).run(
    record.skuCode ?? null,
    record.sourceUrl,
    record.goodsLink ?? null,
    record.pageUrl,
    record.savedPath ?? null,
    record.status,
    record.reason ?? null,
    record.fileSize ?? null,
    record.createdAt,
    record.id,
  )
}

export function getCollectionRecord(
  db: Pick<SqliteDatabase, 'exec' | 'prepare'>,
  recordId: string,
): CollectionRecordRow | null {
  const row = db.prepare('SELECT * FROM collection_records WHERE id = ?').get(recordId) as
    | CollectionRecordDbRow
    | undefined
  return row ? mapCollectionRecordRow(row) : null
}

export function deleteCollectionRecord(
  db: Pick<SqliteDatabase, 'exec' | 'prepare'>,
  recordId: string,
) {
  return Number(db.prepare('DELETE FROM collection_records WHERE id = ?').run(recordId).changes)
}

export function listCollectionRecords(
  db: Pick<SqliteDatabase, 'exec' | 'prepare'>,
  query: CollectionRecordQuery,
): CollectionRecordRow[] {
  const limit = Math.max(
    1,
    Math.min(
      Math.floor(query.limit ?? COLLECTION_RECORD_LIST_LIMIT_DEFAULT),
      COLLECTION_RECORD_LIST_LIMIT_MAX,
    ),
  )
  const params: Array<string | number> = [query.sessionId]
  let sql = 'SELECT * FROM collection_records WHERE session_id = ?'
  if (query.status) {
    sql += ' AND status = ?'
    params.push(query.status)
  }
  sql += ' ORDER BY created_at DESC LIMIT ?'
  params.push(limit)
  const rows = db.prepare(sql).all(...params) as CollectionRecordDbRow[]
  return rows.map(mapCollectionRecordRow)
}

export async function exportCollectionManifest(
  db: Pick<SqliteDatabase, 'exec' | 'prepare'>,
  outputDir: string,
  sessionId: string,
) {
  const records = listCollectionRecords(db, {
    sessionId,
    limit: COLLECTION_RECORD_LIST_LIMIT_MAX,
  }).sort((left, right) => left.createdAt - right.createdAt)
  const manifestPath = join(outputDir, `${sessionId}-manifest.csv`)
  const csv = [
    ['sku_code', 'saved_path', 'source_url', 'goods_link', 'status', 'file_size', 'created_at'],
    ...records.map((record) => [
      record.skuCode ?? '',
      record.savedPath ?? '',
      record.sourceUrl,
      record.goodsLink ?? '',
      record.status,
      record.fileSize ?? '',
      record.createdAt,
    ]),
  ]
    .map((row) => row.map(csvCell).join(','))
    .join('\n')
  await mkdir(outputDir, { recursive: true })
  await writeFile(manifestPath, `${csv}\n`)
  return manifestPath
}

type CollectionRecordDbRow = {
  id: string
  session_id: string
  sku_code: string | null
  source_url: string
  goods_link: string | null
  page_url: string
  saved_path: string | null
  status: CollectionRecordStatus
  reason: string | null
  file_size: number | null
  created_at: number
}

function mapCollectionRecordRow(row: CollectionRecordDbRow): CollectionRecordRow {
  return {
    id: row.id,
    sessionId: row.session_id,
    skuCode: row.sku_code,
    sourceUrl: row.source_url,
    goodsLink: row.goods_link,
    pageUrl: row.page_url,
    savedPath: row.saved_path,
    status: row.status,
    reason: row.reason,
    fileSize: row.file_size,
    createdAt: row.created_at,
  }
}

function csvCell(value: string | number) {
  const text = String(value)
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}
