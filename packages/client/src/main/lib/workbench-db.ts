import { join } from 'node:path'
import { WORKBENCH_DIRECTORIES } from '@tengyu-aipod/shared'
import { type SqliteDatabase, openSqliteDatabase } from './sqlite'
import { getWorkbenchRoot } from './workbench-config'

let defaultDb: SqliteDatabase | null = null

export function openWorkbenchDatabase(dbPath: string): SqliteDatabase {
  return openSqliteDatabase(dbPath)
}

export function workbenchDatabasePath(workbenchRoot: string): string {
  return join(workbenchRoot, WORKBENCH_DIRECTORIES.metadata, 'workbench.db')
}

export async function defaultWorkbenchDatabasePath(): Promise<string> {
  return workbenchDatabasePath(await getWorkbenchRoot())
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
