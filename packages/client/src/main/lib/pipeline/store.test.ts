import { afterEach, describe, expect, it } from 'vitest'
import { type SqliteDatabase, openSqliteDatabase } from '../sqlite'
import { runWorkbenchMigrations } from '../workbench-migrations'
import { markPersistedRunningPipelineStateInterrupted } from './store'

describe('pipeline store startup cleanup', () => {
  let db: SqliteDatabase | null = null

  afterEach(() => {
    db?.close()
    db = null
  })

  it('rolls back run, step, and item cleanup when one status update fails', () => {
    const database = openSqliteDatabase(':memory:')
    db = database
    runWorkbenchMigrations(database)
    database
      .prepare(
        `
        INSERT INTO pipeline_runs (
          id, name, source_mode, status, config_json, stats_json, created_at, started_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `,
      )
      .run('run-startup', '启动清理', 'existing_prints', 'running', '{}', '{}', 100, 100)
    database
      .prepare(
        `
        INSERT INTO pipeline_steps (
          id, run_id, step_key, module, label, status, started_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `,
      )
      .run('step-startup', 'run-startup', 'source', 'generation', '来源', 'running', 100, 100)
    database
      .prepare(
        `
        INSERT INTO pipeline_items (
          id, run_id, item_key, step_key, status, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
      `,
      )
      .run('item-startup', 'run-startup', 'print-1', 'source', 'running', 100, 100)
    database.exec(`
      CREATE TRIGGER reject_pipeline_item_cleanup
      BEFORE UPDATE ON pipeline_items
      BEGIN
        SELECT RAISE(ABORT, 'forced pipeline item cleanup failure');
      END;
    `)

    expect(() => markPersistedRunningPipelineStateInterrupted(database, 200)).toThrow(
      'forced pipeline item cleanup failure',
    )

    expect(
      database.prepare('SELECT status FROM pipeline_runs WHERE id = ?').get('run-startup'),
    ).toEqual({ status: 'running' })
    expect(
      database.prepare('SELECT status FROM pipeline_steps WHERE id = ?').get('step-startup'),
    ).toEqual({ status: 'running' })
    expect(
      database.prepare('SELECT status FROM pipeline_items WHERE id = ?').get('item-startup'),
    ).toEqual({ status: 'running' })
  })
})
