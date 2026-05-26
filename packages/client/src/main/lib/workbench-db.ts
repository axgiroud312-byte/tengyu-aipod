import { join } from 'node:path'
import { type SqliteDatabase, openSqliteDatabase } from './sqlite'
import { getWorkbenchRoot } from './workbench-config'

let defaultDb: SqliteDatabase | null = null

export function openWorkbenchDatabase(dbPath: string): SqliteDatabase {
  return openSqliteDatabase(dbPath)
}

export async function defaultWorkbenchDatabasePath(): Promise<string> {
  return join(await getWorkbenchRoot(), '.workbench', 'workbench.db')
}

export async function getDefaultWorkbenchDatabase(): Promise<SqliteDatabase> {
  if (!defaultDb) {
    defaultDb = openWorkbenchDatabase(await defaultWorkbenchDatabasePath())
  }
  return defaultDb
}

export function closeDefaultWorkbenchDatabase(): void {
  defaultDb?.close()
  defaultDb = null
}

export type { SqliteDatabase }
