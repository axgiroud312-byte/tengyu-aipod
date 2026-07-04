import { mkdtemp, rm } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { Worker } from 'node:worker_threads'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { openSqliteDatabase } from './sqlite'

let tempRoot = ''

beforeEach(async () => {
  tempRoot = await mkdtemp(join(tmpdir(), 'tengyu-sqlite-'))
})

afterEach(async () => {
  if (tempRoot) {
    await rm(tempRoot, { recursive: true, force: true })
  }
})

describe('openSqliteDatabase', () => {
  it('waits for a concurrent write lock instead of throwing SQLITE_BUSY immediately', async () => {
    const dbPath = join(tempRoot, 'workbench.db')
    const db = openSqliteDatabase(dbPath)
    const worker = createSqliteWriterWorker(dbPath)

    try {
      db.exec('CREATE TABLE writes (id INTEGER PRIMARY KEY, value TEXT NOT NULL)')
      await waitForWorkerMessage(worker, (message) => message.type === 'ready')

      db.exec('BEGIN IMMEDIATE')
      db.prepare('INSERT INTO writes (value) VALUES (?)').run('main')

      const resultPromise = waitForWorkerMessage(worker, (message) => message.type === 'result')
      worker.postMessage({ type: 'write' })
      await sleep(100)
      db.exec('COMMIT')

      const result = await resultPromise
      expect(result).toMatchObject({ ok: true })
      const row = db.prepare('SELECT COUNT(*) AS count FROM writes').get() as { count: number }
      expect(row.count).toBe(2)
    } finally {
      if (db.isTransaction) {
        db.exec('ROLLBACK')
      }
      await worker.terminate()
      db.close()
    }
  })
})

function createSqliteWriterWorker(dbPath: string) {
  const require = createRequire(import.meta.url)
  const tsxLoaderUrl = pathToFileURL(require.resolve('tsx')).href
  const sqliteModuleUrl = new URL('./sqlite.ts', import.meta.url).href

  return new Worker(
    `
      const { parentPort, workerData } = require('node:worker_threads')

      async function main() {
        const { openSqliteDatabase } = await import(workerData.sqliteModuleUrl)
        const db = openSqliteDatabase(workerData.dbPath)

        parentPort.postMessage({ type: 'ready' })
        parentPort.once('message', () => {
          try {
            db.prepare('INSERT INTO writes (value) VALUES (?)').run('worker')
            parentPort.postMessage({ type: 'result', ok: true })
          } catch (error) {
            parentPort.postMessage({
              type: 'result',
              ok: false,
              code: error?.code,
              message: error instanceof Error ? error.message : String(error),
            })
          } finally {
            db.close()
          }
        })
      }

      main().catch((error) => {
        parentPort.postMessage({
          type: 'result',
          ok: false,
          message: error instanceof Error ? error.message : String(error),
        })
      })
    `,
    {
      eval: true,
      execArgv: ['--import', tsxLoaderUrl],
      workerData: { dbPath, sqliteModuleUrl },
    },
  )
}

function waitForWorkerMessage(
  worker: Worker,
  predicate: (message: Record<string, unknown>) => boolean,
) {
  return new Promise<Record<string, unknown>>((resolve, reject) => {
    const onMessage = (message: Record<string, unknown>) => {
      if (!predicate(message)) {
        return
      }
      cleanup()
      resolve(message)
    }
    const onError = (error: Error) => {
      cleanup()
      reject(error)
    }
    const onExit = (code: number) => {
      if (code !== 0) {
        cleanup()
        reject(new Error(`SQLite worker exited with code ${code}`))
      }
    }
    const cleanup = () => {
      worker.off('message', onMessage)
      worker.off('error', onError)
      worker.off('exit', onExit)
    }

    worker.on('message', onMessage)
    worker.on('error', onError)
    worker.on('exit', onExit)
  })
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
