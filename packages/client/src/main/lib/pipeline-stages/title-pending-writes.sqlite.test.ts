import { access, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { openWorkbenchDatabase, workbenchDatabasePath } from '../workbench-db'
import {
  listPendingTitleWrites,
  pendingTitleMap,
  removePendingTitleWrite,
  savePendingTitleWrite,
} from './title-pending-writes'

const tempRoots: string[] = []

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('pending title writes in SQLite', () => {
  it('restores a pending title after reopening the database without writing recovery files', async () => {
    const workbenchRoot = await mkdtemp(join(tmpdir(), 'tengyu-pending-title-sqlite-'))
    tempRoots.push(workbenchRoot)
    const databasePath = workbenchDatabasePath(workbenchRoot)
    const batchDir = join(workbenchRoot, '04-上架工作区', 'shirt')
    let database = openWorkbenchDatabase(databasePath)

    try {
      await savePendingTitleWrite(database, {
        runId: 'run-restart',
        batchDir,
        xlsxPath: join(batchDir, '标题.xlsx'),
        titles: { 'SKU-001': 'Recovered title' },
        language: 'en',
        platform: 'temu',
        model: 'qwen3.6-flash',
        skill: { id: 'title-temu-en', version: '1' },
        generatedAt: 1_000,
      })
    } finally {
      database.close()
    }

    database = openWorkbenchDatabase(databasePath)
    try {
      const records = await listPendingTitleWrites(database)
      expect(records).toHaveLength(1)
      const record = records[0]
      if (!record) {
        throw new Error('pending title record was not restored')
      }
      expect(record).toMatchObject({
        runId: 'run-restart',
        batchDir,
        xlsxPath: join(batchDir, '标题.xlsx'),
        language: 'en',
        platform: 'temu',
        model: 'qwen3.6-flash',
        skill: { id: 'title-temu-en', version: '1' },
        generatedAt: 1_000,
      })
      expect(pendingTitleMap(record)).toEqual(new Map([['SKU-001', 'Recovered title']]))
    } finally {
      database.close()
    }

    await expect(access(join(workbenchRoot, '.workbench', 'pipeline-runs'))).rejects.toMatchObject({
      code: 'ENOENT',
    })
  })

  it('merges titles and prevents a stale revision from deleting newer state', async () => {
    const workbenchRoot = await mkdtemp(join(tmpdir(), 'tengyu-pending-title-merge-'))
    tempRoots.push(workbenchRoot)
    const database = openWorkbenchDatabase(workbenchDatabasePath(workbenchRoot))
    const batchDir = join(workbenchRoot, '04-上架工作区', 'shirt')
    const input = {
      runId: 'run-merge',
      batchDir,
      xlsxPath: join(batchDir, '标题.xlsx'),
      language: 'en',
      platform: 'temu',
      model: 'qwen3.6-flash',
      skill: { id: 'title-temu-en', version: '1' },
      generatedAt: 1_000,
    }

    try {
      const stale = await savePendingTitleWrite(database, {
        ...input,
        titles: { 'SKU-001': 'First title' },
      })
      const current = await savePendingTitleWrite(database, {
        ...input,
        titles: { 'SKU-002': 'Second title' },
      })

      await removePendingTitleWrite(database, stale)
      const [preserved] = await listPendingTitleWrites(database)
      if (!preserved) {
        throw new Error('newer pending title record was deleted by a stale revision')
      }
      expect(pendingTitleMap(preserved)).toEqual(
        new Map([
          ['SKU-001', 'First title'],
          ['SKU-002', 'Second title'],
        ]),
      )

      await removePendingTitleWrite(database, current)
      await expect(listPendingTitleWrites(database)).resolves.toEqual([])
    } finally {
      database.close()
    }
  })

  it('keeps different runs and workbook paths as separate pending records', async () => {
    const workbenchRoot = await mkdtemp(join(tmpdir(), 'tengyu-pending-title-isolation-'))
    tempRoots.push(workbenchRoot)
    const database = openWorkbenchDatabase(workbenchDatabasePath(workbenchRoot))
    const batchDir = join(workbenchRoot, '04-上架工作区', 'shirt')
    const baseInput = {
      batchDir,
      language: 'en',
      platform: 'temu',
      model: 'qwen3.6-flash',
      skill: { id: 'title-temu-en', version: '1' },
      generatedAt: 1_000,
    }

    try {
      await savePendingTitleWrite(database, {
        ...baseInput,
        runId: 'run-old-workbook',
        xlsxPath: join(batchDir, '旧标题.xlsx'),
        titles: { 'SKU-OLD': 'Old workbook title' },
      })
      await savePendingTitleWrite(database, {
        ...baseInput,
        runId: 'run-new-workbook',
        xlsxPath: join(batchDir, '新标题.xlsx'),
        titles: { 'SKU-NEW': 'New workbook title' },
      })

      const records = await listPendingTitleWrites(database)
      expect(records).toHaveLength(2)
      expect(records).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            runId: 'run-old-workbook',
            xlsxPath: join(batchDir, '旧标题.xlsx'),
            titles: { 'SKU-OLD': 'Old workbook title' },
          }),
          expect.objectContaining({
            runId: 'run-new-workbook',
            xlsxPath: join(batchDir, '新标题.xlsx'),
            titles: { 'SKU-NEW': 'New workbook title' },
          }),
        ]),
      )
    } finally {
      database.close()
    }
  })

  it('rolls back a failed replacement and preserves the previous pending record', async () => {
    const workbenchRoot = await mkdtemp(join(tmpdir(), 'tengyu-pending-title-rollback-'))
    tempRoots.push(workbenchRoot)
    const database = openWorkbenchDatabase(workbenchDatabasePath(workbenchRoot))
    const batchDir = join(workbenchRoot, '04-上架工作区', 'shirt')
    const input = {
      runId: 'run-rollback',
      batchDir,
      xlsxPath: join(batchDir, '标题.xlsx'),
      language: 'en',
      platform: 'temu',
      model: 'qwen3.6-flash',
      skill: { id: 'title-temu-en', version: '1' },
      generatedAt: 1_000,
    }

    try {
      await savePendingTitleWrite(database, {
        ...input,
        titles: { 'SKU-001': 'Preserved title' },
      })
      database.exec(`
        CREATE TRIGGER reject_pending_title_update
        BEFORE UPDATE ON pending_title_writes
        BEGIN
          SELECT RAISE(ABORT, 'forced pending title failure');
        END;
      `)

      await expect(
        savePendingTitleWrite(database, {
          ...input,
          titles: { 'SKU-002': 'Rejected title' },
        }),
      ).rejects.toMatchObject({
        code: 'WORKSPACE_IO_FAILED',
        retryable: false,
        details: {
          operation: 'savePendingTitleWrite',
          runId: 'run-rollback',
          batchDir,
        },
      })
      database.exec('DROP TRIGGER reject_pending_title_update')

      const [record] = await listPendingTitleWrites(database)
      if (!record) {
        throw new Error('pending title record was lost after transaction rollback')
      }
      expect(pendingTitleMap(record)).toEqual(new Map([['SKU-001', 'Preserved title']]))
    } finally {
      database.close()
    }
  })
})
