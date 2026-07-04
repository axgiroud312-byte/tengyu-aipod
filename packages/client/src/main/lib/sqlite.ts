import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { DatabaseSync, type StatementSync } from 'node:sqlite'

export type SqliteDatabase = DatabaseSync
export type SqliteStatement = StatementSync

export function openSqliteDatabase(path: string): SqliteDatabase {
  if (path !== ':memory:') {
    mkdirSync(dirname(path), { recursive: true })
  }

  const db = new DatabaseSync(path)
  db.exec('PRAGMA journal_mode = WAL')
  db.exec('PRAGMA busy_timeout = 5000')
  return db
}
