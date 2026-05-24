import { join } from 'node:path'
import Database from 'better-sqlite3'

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

export type CollectionDatabase = Pick<Database.Database, 'exec' | 'prepare' | 'close'>

export function workbenchDbPath(workbenchRoot: string) {
  return join(workbenchRoot, '.workbench', 'workbench.db')
}

export function openCollectionDatabase(workbenchRoot: string) {
  return new Database(workbenchDbPath(workbenchRoot))
}

export function ensureCollectionRecordTables(db: Pick<Database.Database, 'exec'>) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS collection_records (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      sku_code TEXT,
      source_url TEXT NOT NULL,
      goods_link TEXT,
      page_url TEXT NOT NULL,
      saved_path TEXT,
      status TEXT NOT NULL,
      reason TEXT,
      file_size INTEGER,
      created_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_records_session ON collection_records(session_id);
    CREATE INDEX IF NOT EXISTS idx_records_status ON collection_records(status);
  `)
}

export function insertCollectionRecord(
  db: Pick<Database.Database, 'exec' | 'prepare'>,
  record: CollectionRecordInput,
) {
  ensureCollectionRecordTables(db)
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
