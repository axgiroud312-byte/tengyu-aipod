import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { openSqliteDatabase } from './sqlite'
import { openWorkbenchDatabase } from './workbench-db'
import { CURRENT_WORKBENCH_SCHEMA_VERSION, runWorkbenchMigrations } from './workbench-migrations'

let tempRoot = ''

beforeEach(async () => {
  tempRoot = await mkdtemp(join(tmpdir(), 'tengyu-workbench-migrations-'))
})

afterEach(async () => {
  if (tempRoot) {
    await rm(tempRoot, { recursive: true, force: true })
  }
})

describe('workbench migrations', () => {
  it('migrates an empty database to the current schema version', () => {
    const db = openWorkbenchDatabase(join(tempRoot, 'workbench.db'))
    try {
      expect(userVersion(db)).toBe(CURRENT_WORKBENCH_SCHEMA_VERSION)
      expect(tableNames(db)).toEqual(
        expect.arrayContaining([
          'artifacts',
          'collection_config',
          'collection_records',
          'collection_sessions',
          'comfyui_instances',
          'detection_config',
          'detection_results',
          'matting_candidates',
          'pending_title_writes',
          'pipeline_items',
          'pipeline_runs',
          'pipeline_steps',
          'psd_templates',
          'skus',
          'tasks',
          'workflow_steps',
        ]),
      )
    } finally {
      db.close()
    }
  })

  it('migrates a version 3 database without dropping existing data', () => {
    const db = openSqliteDatabase(join(tempRoot, 'old-workbench.db'))
    try {
      db.exec(`
        CREATE TABLE artifacts (
          id TEXT PRIMARY KEY,
          task_id TEXT,
          provider TEXT,
          file_path TEXT NOT NULL,
          file_hash TEXT,
          created_at INTEGER NOT NULL
        );
        INSERT INTO artifacts (id, task_id, provider, file_path, file_hash, created_at)
        VALUES ('art-old', 'task-old', 'photoshop', 'C:/outputs/01.jpg', 'hash-old', 1000);

        CREATE TABLE pipeline_runs (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          source_mode TEXT NOT NULL,
          status TEXT NOT NULL,
          config_json TEXT NOT NULL,
          stats_json TEXT NOT NULL,
          error_summary TEXT,
          created_at INTEGER NOT NULL,
          started_at INTEGER,
          completed_at INTEGER
        );
        INSERT INTO pipeline_runs (
          id,
          name,
          source_mode,
          status,
          config_json,
          stats_json,
          created_at
        )
        VALUES ('run-old', 'Old run', 'txt2img', 'completed', '{}', '{}', 1000);

        CREATE TABLE psd_templates (
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
          UNIQUE(file_hash)
        );
        INSERT INTO psd_templates (
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
          scanned_at
        )
        VALUES ('tpl-old', 'C:/templates/mockup.psd', 'tpl-hash', 1000, 1000, '[]', '[]', '[]', 'single', 1, 1000);

        PRAGMA user_version = 3;
      `)

      runWorkbenchMigrations(db)

      expect(userVersion(db)).toBe(CURRENT_WORKBENCH_SCHEMA_VERSION)
      expect(tableNames(db)).toContain('pending_title_writes')
      expect(
        db
          .prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name = ?")
          .get('idx_pending_title_writes_xlsx_path'),
      ).toEqual({ name: 'idx_pending_title_writes_xlsx_path' })
      expect(columnNames(db, 'artifacts')).toEqual(
        expect.arrayContaining(['sku_code', 'print_id', 'step', 'model_or_workflow']),
      )
      expect(columnNames(db, 'pipeline_runs')).toEqual(
        expect.arrayContaining(['result_sections_json', 'logs_json']),
      )
      expect(columnNames(db, 'psd_templates')).toEqual(
        expect.arrayContaining(['layers', 'text_layers', 'scanner_version']),
      )
      expect(db.prepare('SELECT id, file_path FROM artifacts').get()).toEqual({
        id: 'art-old',
        file_path: 'C:/outputs/01.jpg',
      })
      expect(db.prepare('SELECT id, name FROM pipeline_runs').get()).toEqual({
        id: 'run-old',
        name: 'Old run',
      })
      expect(db.prepare('SELECT id, file_hash FROM psd_templates').get()).toEqual({
        id: 'tpl-old',
        file_hash: 'tpl-hash',
      })
      expect(db.prepare('SELECT scanner_version FROM psd_templates').get()).toEqual({
        scanner_version: 0,
      })
      db.prepare(
        `INSERT INTO pending_title_writes (
          run_id, batch_dir, xlsx_path, titles_json, language, platform, model,
          skill_id, skill_version, generated_at, updated_at, revision
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        'run-old',
        'C:/outputs/mockup',
        'C:/outputs/mockup/标题.xlsx',
        '{"SKU-OLD":"Old title"}',
        'en',
        'temu',
        'qwen-test',
        'title-test',
        '1',
        1000,
        1000,
        'revision-old',
      )
      expect(
        db
          .prepare('SELECT run_id, revision FROM pending_title_writes WHERE run_id = ?')
          .get('run-old'),
      ).toEqual({ run_id: 'run-old', revision: 'revision-old' })
    } finally {
      db.close()
    }
  })

  it('runs idempotently on repeated opens', () => {
    const dbPath = join(tempRoot, 'idempotent-workbench.db')
    const first = openWorkbenchDatabase(dbPath)
    try {
      first
        .prepare(
          'INSERT INTO collection_sessions (id, platform, profile_id, mode, status, output_dir, started_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
        )
        .run('session-old', 'temu', 'profile-1', 'click', 'active', 'C:/workbench/01', 1000)
    } finally {
      first.close()
    }

    const second = openWorkbenchDatabase(dbPath)
    try {
      expect(userVersion(second)).toBe(CURRENT_WORKBENCH_SCHEMA_VERSION)
      expect(
        second
          .prepare('SELECT id, status FROM collection_sessions WHERE id = ?')
          .get('session-old'),
      ).toEqual({ id: 'session-old', status: 'active' })
    } finally {
      second.close()
    }
  })
})

function userVersion(db: ReturnType<typeof openSqliteDatabase>): number {
  const row = db.prepare('PRAGMA user_version').get() as { user_version: number }
  return row.user_version
}

function tableNames(db: ReturnType<typeof openSqliteDatabase>): string[] {
  return (
    db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as Array<{
      name: string
    }>
  )
    .map((row) => row.name)
    .sort()
}

function columnNames(db: ReturnType<typeof openSqliteDatabase>, table: string): string[] {
  return (db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).map(
    (row) => row.name,
  )
}
