import type {
  PsdClipArea,
  PsdGuides,
  PsdLayerInfo,
  PsdNativeSlice,
  PsdSmartObject,
  PsdTemplate,
  PsdTextLayer,
  SmartObjectMode,
} from '@tengyu-aipod/shared'
import type { SqliteDatabase } from '../lib/sqlite'
import { getDefaultWorkbenchDatabase } from '../lib/workbench-db'

const CURRENT_PSD_SCANNER_VERSION = 1

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
  native_slices?: string
  scanner_version: number
  mode: SmartObjectMode
  representative_so_count: number
  scanned_at: number
  layers: string
  text_layers: string
}

type DatabaseProvider = () => SqliteDatabase | Promise<SqliteDatabase>

function parseJson<T>(value: string): T {
  return JSON.parse(value) as T
}

export class SqlitePsdTemplateCache implements PsdTemplateCache {
  private readonly dbProvider: DatabaseProvider

  constructor(options: { db?: SqliteDatabase; dbProvider?: DatabaseProvider } = {}) {
    this.dbProvider = options.db
      ? () => options.db as SqliteDatabase
      : (options.dbProvider ?? getDefaultWorkbenchDatabase)
  }

  async findByHash(fileHash: string): Promise<PsdTemplate | null> {
    const db = await this.db()
    const row = db
      .prepare('SELECT * FROM psd_templates WHERE file_hash = ? AND scanner_version = ?')
      .get(fileHash, CURRENT_PSD_SCANNER_VERSION) as PsdTemplateRow | undefined

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
        native_slices,
        scanner_version,
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
        @native_slices,
        @scanner_version,
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
        native_slices = excluded.native_slices,
        scanner_version = excluded.scanner_version,
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
      .prepare('SELECT * FROM psd_templates WHERE scanner_version = ? ORDER BY scanned_at DESC')
      .all(CURRENT_PSD_SCANNER_VERSION) as unknown as PsdTemplateRow[]

    return rows.map((row) => this.fromRow(row))
  }

  private async db(): Promise<SqliteDatabase> {
    return await this.dbProvider()
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
      native_slices: JSON.stringify(template.native_slices),
      scanner_version: CURRENT_PSD_SCANNER_VERSION,
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
      native_slices: row.native_slices ? parseJson<PsdNativeSlice[]>(row.native_slices) : [],
      mode: row.mode,
      representative_so_count: row.representative_so_count,
      scanned_at: row.scanned_at,
      layers: parseJson<PsdLayerInfo[]>(row.layers),
      text_layers: parseJson<PsdTextLayer[]>(row.text_layers),
    }
  }
}

export const psdTemplateCache = new SqlitePsdTemplateCache()
