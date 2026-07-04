import { join } from 'node:path'
import { AppErrorClass, WORKBENCH_DIRECTORIES } from '@tengyu-aipod/shared'
import { ipcMain } from 'electron'
import { z } from 'zod'
import { readAppConfig } from '../onboarding'
import { type SqliteDatabase, openSqliteDatabase } from './sqlite'

export type CollectionConfigMode = 'click' | 'scroll'

export type CollectionSizeFilterConfig = {
  min_width: number
  max_width: number
  min_height: number
  max_height: number
}

export type CollectionConfig = {
  platform: string
  profile_id: string
  mode: CollectionConfigMode
  output_dir: string
  scroll_keywords: string
  size_filter: CollectionSizeFilterConfig
}

type CollectionConfigRow = {
  platform: string
  profile_id: string
  mode: string
  output_dir: string
  scroll_keywords: string
  min_width: number
  max_width: number
  min_height: number
  max_height: number
}

const DEFAULT_COLLECTION_CONFIG: CollectionConfig = {
  platform: 'temu',
  profile_id: '',
  mode: 'click',
  output_dir: '',
  scroll_keywords: '',
  size_filter: {
    min_width: 0,
    max_width: 0,
    min_height: 0,
    max_height: 0,
  },
}
const collectionConfigSchema = z.object({
  platform: z.string(),
  profile_id: z.string(),
  mode: z.enum(['click', 'scroll']),
  output_dir: z.string(),
  scroll_keywords: z.string(),
  size_filter: z.object({
    min_width: z.number(),
    max_width: z.number(),
    min_height: z.number(),
    max_height: z.number(),
  }),
})

function parseCollectionConfigIpcInput(input: unknown): CollectionConfig {
  const parsed = collectionConfigSchema.safeParse(input)
  if (!parsed.success) {
    throw new AppErrorClass('INVALID_INPUT', '采集配置参数不正确', false, {
      issues: parsed.error.issues,
    })
  }
  return parsed.data
}

function workbenchDbPath(workbenchRoot: string) {
  return join(workbenchRoot, WORKBENCH_DIRECTORIES.metadata, 'workbench.db')
}

function openWorkbenchDatabase(workbenchRoot: string) {
  return openSqliteDatabase(workbenchDbPath(workbenchRoot))
}

function ensureCollectionConfigTable(db: Pick<SqliteDatabase, 'exec'>) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS collection_config (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      platform TEXT NOT NULL,
      profile_id TEXT NOT NULL,
      mode TEXT NOT NULL,
      output_dir TEXT NOT NULL,
      scroll_keywords TEXT NOT NULL,
      min_width INTEGER NOT NULL,
      max_width INTEGER NOT NULL,
      min_height INTEGER NOT NULL,
      max_height INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
  `)
}

export async function getCollectionConfig(): Promise<CollectionConfig | null> {
  const workbenchRoot = await readWorkbenchRoot()
  const db = openWorkbenchDatabase(workbenchRoot)
  try {
    ensureCollectionConfigTable(db)
    const row = db
      .prepare(
        `
          SELECT
            platform,
            profile_id,
            mode,
            output_dir,
            scroll_keywords,
            min_width,
            max_width,
            min_height,
            max_height
          FROM collection_config
          WHERE id = 1
        `,
      )
      .get() as CollectionConfigRow | undefined

    return row ? normalizeCollectionConfig(rowToConfig(row)) : null
  } finally {
    db.close()
  }
}

export async function saveCollectionConfig(input: unknown): Promise<CollectionConfig> {
  const workbenchRoot = await readWorkbenchRoot()
  const config = normalizeCollectionConfig(input)
  const db = openWorkbenchDatabase(workbenchRoot)
  try {
    ensureCollectionConfigTable(db)
    db.prepare(
      `
        INSERT INTO collection_config (
          id,
          platform,
          profile_id,
          mode,
          output_dir,
          scroll_keywords,
          min_width,
          max_width,
          min_height,
          max_height,
          updated_at
        )
        VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          platform = excluded.platform,
          profile_id = excluded.profile_id,
          mode = excluded.mode,
          output_dir = excluded.output_dir,
          scroll_keywords = excluded.scroll_keywords,
          min_width = excluded.min_width,
          max_width = excluded.max_width,
          min_height = excluded.min_height,
          max_height = excluded.max_height,
          updated_at = excluded.updated_at
      `,
    ).run(
      config.platform,
      config.profile_id,
      config.mode,
      config.output_dir,
      config.scroll_keywords,
      config.size_filter.min_width,
      config.size_filter.max_width,
      config.size_filter.min_height,
      config.size_filter.max_height,
      Date.now(),
    )

    return config
  } finally {
    db.close()
  }
}

export function resetCollectionConfig(): CollectionConfig {
  return {
    ...DEFAULT_COLLECTION_CONFIG,
    size_filter: { ...DEFAULT_COLLECTION_CONFIG.size_filter },
  }
}

export function normalizeCollectionConfig(input: unknown): CollectionConfig {
  const record = isRecord(input) ? input : {}
  const sizeFilter = isRecord(record.size_filter) ? record.size_filter : {}

  return {
    platform: readString(record.platform, DEFAULT_COLLECTION_CONFIG.platform),
    profile_id: readString(record.profile_id, DEFAULT_COLLECTION_CONFIG.profile_id),
    mode: record.mode === 'scroll' ? 'scroll' : DEFAULT_COLLECTION_CONFIG.mode,
    output_dir: readString(record.output_dir, DEFAULT_COLLECTION_CONFIG.output_dir),
    scroll_keywords: readString(record.scroll_keywords, DEFAULT_COLLECTION_CONFIG.scroll_keywords),
    size_filter: {
      min_width: nonNegativeInteger(sizeFilter.min_width),
      max_width: nonNegativeInteger(sizeFilter.max_width),
      min_height: nonNegativeInteger(sizeFilter.min_height),
      max_height: nonNegativeInteger(sizeFilter.max_height),
    },
  }
}

export function registerCollectionConfigIpc() {
  ipcMain.handle('collection:get-config', () => getCollectionConfig())
  ipcMain.handle('collection:save-config', (_event, input: unknown) =>
    saveCollectionConfig(parseCollectionConfigIpcInput(input)),
  )
}

async function readWorkbenchRoot() {
  const config = await readAppConfig()
  if (!config.workbench_root) {
    throw new AppErrorClass('HTTP_4XX', '请先在设置里选择工作区', false)
  }
  return config.workbench_root
}

function rowToConfig(row: CollectionConfigRow): CollectionConfig {
  return {
    platform: row.platform,
    profile_id: row.profile_id,
    mode: row.mode === 'scroll' ? 'scroll' : 'click',
    output_dir: row.output_dir,
    scroll_keywords: row.scroll_keywords,
    size_filter: {
      min_width: row.min_width,
      max_width: row.max_width,
      min_height: row.min_height,
      max_height: row.max_height,
    },
  }
}

function readString(value: unknown, fallback: string) {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback
}

function nonNegativeInteger(value: unknown) {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    return Math.floor(value)
  }
  if (typeof value === 'string' && /^\d+(\.\d+)?$/.test(value)) {
    return Math.floor(Number(value))
  }
  return 0
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
