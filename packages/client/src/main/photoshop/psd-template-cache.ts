import type {
  PsdClipArea,
  PsdGuides,
  PsdLayerInfo,
  PsdSmartObject,
  PsdTemplate,
  PsdTextLayer,
  SmartObjectMode,
} from '@tengyu-aipod/shared'
import { type BetterSqliteDatabase, getDefaultWorkbenchDatabase } from '../lib/workbench-db'

export interface PsdTemplateCache {
  findByHash(fileHash: string): Promise<PsdTemplate | null>
  save(template: PsdTemplate): Promise<void>
  list(): Promise<PsdTemplate[]>
}

interface PsdTemplateRow {
  id: string
  file_path: string
  file_hash: string
  doc_size_w: number
  doc_size_h: number
  smart_objects: string
  guides: string
  clip_areas: string
  mode: SmartObjectMode
  representative_so_count: number
  scanned_at: number
  layers: string
  text_layers: string
}

type DatabaseProvider = () => BetterSqliteDatabase | Promise<BetterSqliteDatabase>

function parseJson<T>(value: string): T {
  return JSON.parse(value) as T
}

export class SqlitePsdTemplateCache implements PsdTemplateCache {
  private readonly dbProvider: DatabaseProvider
  private schemaReady = false

  constructor(options: { db?: BetterSqliteDatabase; dbProvider?: DatabaseProvider } = {}) {
    this.dbProvider = options.db
      ? () => options.db as BetterSqliteDatabase
      : (options.dbProvider ?? getDefaultWorkbenchDatabase)
  }

  async findByHash(fileHash: string): Promise<PsdTemplate | null> {
    const db = await this.db()
    const row = db.prepare('SELECT * FROM psd_templates WHERE file_hash = ?').get(fileHash) as
      | PsdTemplateRow
      | undefined

    return row ? this.fromRow(row) : null
  }

  async save(template: PsdTemplate): Promise<void> {
    const db = await this.db()
    db.prepare(
      `INSERT INTO psd_templates (
        id,
        file_path,
        file_hash,
        doc_size_w,
        doc_size_h,
        smart_objects,
        guides,
        clip_areas,
        mode,
        representative_so_count,
        scanned_at,
        layers,
        text_layers
      ) VALUES (
        @id,
        @file_path,
        @file_hash,
        @doc_size_w,
        @doc_size_h,
        @smart_objects,
        @guides,
        @clip_areas,
        @mode,
        @representative_so_count,
        @scanned_at,
        @layers,
        @text_layers
      )
      ON CONFLICT(file_hash) DO UPDATE SET
        file_path = excluded.file_path,
        doc_size_w = excluded.doc_size_w,
        doc_size_h = excluded.doc_size_h,
        smart_objects = excluded.smart_objects,
        guides = excluded.guides,
        clip_areas = excluded.clip_areas,
        mode = excluded.mode,
        representative_so_count = excluded.representative_so_count,
        scanned_at = excluded.scanned_at,
        layers = excluded.layers,
        text_layers = excluded.text_layers`,
    ).run(this.toRow(template))
  }

  async list(): Promise<PsdTemplate[]> {
    const db = await this.db()
    const rows = db
      .prepare('SELECT * FROM psd_templates ORDER BY scanned_at DESC')
      .all() as PsdTemplateRow[]

    return rows.map((row) => this.fromRow(row))
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
      CREATE TABLE IF NOT EXISTS psd_templates (
        id TEXT PRIMARY KEY,
        file_path TEXT NOT NULL,
        file_hash TEXT NOT NULL,
        doc_size_w INTEGER NOT NULL,
        doc_size_h INTEGER NOT NULL,
        smart_objects TEXT NOT NULL,
        guides TEXT NOT NULL,
        clip_areas TEXT NOT NULL,
        mode TEXT NOT NULL,
        representative_so_count INTEGER NOT NULL,
        scanned_at INTEGER NOT NULL,
        layers TEXT NOT NULL DEFAULT '[]',
        text_layers TEXT NOT NULL DEFAULT '[]',
        UNIQUE(file_hash)
      );
      CREATE INDEX IF NOT EXISTS idx_psd_templates_file_path ON psd_templates(file_path);
    `)

    const columns = db.prepare('PRAGMA table_info(psd_templates)').all() as Array<{ name: string }>
    const names = new Set(columns.map((column) => column.name))
    if (!names.has('layers')) {
      db.exec("ALTER TABLE psd_templates ADD COLUMN layers TEXT NOT NULL DEFAULT '[]'")
    }
    if (!names.has('text_layers')) {
      db.exec("ALTER TABLE psd_templates ADD COLUMN text_layers TEXT NOT NULL DEFAULT '[]'")
    }
  }

  private toRow(template: PsdTemplate) {
    return {
      id: template.id,
      file_path: template.file_path,
      file_hash: template.file_hash,
      doc_size_w: template.doc_size.w,
      doc_size_h: template.doc_size.h,
      smart_objects: JSON.stringify(template.smart_objects),
      guides: JSON.stringify(template.guides),
      clip_areas: JSON.stringify(template.clip_areas),
      mode: template.mode,
      representative_so_count: template.representative_so_count,
      scanned_at: template.scanned_at,
      layers: JSON.stringify(template.layers),
      text_layers: JSON.stringify(template.text_layers),
    }
  }

  private fromRow(row: PsdTemplateRow): PsdTemplate {
    return {
      id: row.id,
      file_path: row.file_path,
      file_hash: row.file_hash,
      doc_size: { w: row.doc_size_w, h: row.doc_size_h },
      smart_objects: parseJson<PsdSmartObject[]>(row.smart_objects),
      guides: parseJson<PsdGuides>(row.guides),
      clip_areas: parseJson<PsdClipArea[]>(row.clip_areas),
      mode: row.mode,
      representative_so_count: row.representative_so_count,
      scanned_at: row.scanned_at,
      layers: parseJson<PsdLayerInfo[]>(row.layers),
      text_layers: parseJson<PsdTextLayer[]>(row.text_layers),
    }
  }
}

export const psdTemplateCache = new SqlitePsdTemplateCache()
