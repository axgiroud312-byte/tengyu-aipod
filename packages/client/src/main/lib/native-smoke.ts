import { AppErrorClass } from '@tengyu-aipod/shared'
import { dialog } from 'electron'
import pino from 'pino'
import { openSqliteDatabase } from './sqlite'

const logger = pino({ name: 'native-smoke' })

export function runNativeSmoke(): void {
  try {
    const db = openSqliteDatabase(':memory:')
    try {
      db.exec('CREATE TABLE native_smoke (id INTEGER PRIMARY KEY)')
      db.prepare('INSERT INTO native_smoke (id) VALUES (?)').run(1)
      const result = db.prepare('PRAGMA quick_check').get() as { quick_check?: string } | undefined
      if (result?.quick_check !== 'ok') {
        throw new Error(`SQLite quick_check failed: ${result?.quick_check ?? 'empty result'}`)
      }
    } finally {
      db.close()
    }
  } catch (error) {
    logger.error({ err: error }, 'Native smoke failed')
    dialog.showErrorBox(
      'Native dependency check failed',
      'Electron could not start the built-in SQLite runtime. Please reinstall dependencies or contact the developer.',
    )
    throw new AppErrorClass('HTTP_5XX', 'Native smoke failed', false, undefined, error)
  }
}
