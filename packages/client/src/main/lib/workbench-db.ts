import { mkdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import type { Database as BetterSqliteDatabase } from 'better-sqlite3'
import { getWorkbenchRoot } from './workbench-config'

const require = createRequire(import.meta.url)
let defaultDb: BetterSqliteDatabase | null = null

export function openWorkbenchDatabase(dbPath: string): BetterSqliteDatabase {
  mkdirSync(dirname(dbPath), { recursive: true })
  const DatabaseConstructor = require('better-sqlite3') as {
    new (path: string): BetterSqliteDatabase
  }
  const db = new DatabaseConstructor(dbPath)
  db.pragma('journal_mode = WAL')
  return db
}

export async function defaultWorkbenchDatabasePath(): Promise<string> {
  return join(await getWorkbenchRoot(), '.workbench', 'workbench.db')
}

export async function getDefaultWorkbenchDatabase(): Promise<BetterSqliteDatabase> {
  if (!defaultDb) {
    defaultDb = openWorkbenchDatabase(await defaultWorkbenchDatabasePath())
  }
  return defaultDb
}

export function closeDefaultWorkbenchDatabase(): void {
  defaultDb?.close()
  defaultDb = null
}

export type { BetterSqliteDatabase }
