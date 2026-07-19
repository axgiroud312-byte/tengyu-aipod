import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  listPendingTitleWrites,
  pendingTitleMap,
  pendingTitleWritesDirectory,
  removePendingTitleWrite,
  savePendingTitleWrite,
} from './title-pending-writes'

const tempRoots: string[] = []

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('pending title writes', () => {
  it('keeps one latest sidecar for repeated locked writes to the same batch', async () => {
    const workbenchRoot = await mkdtemp(join(tmpdir(), 'tengyu-pending-title-'))
    tempRoots.push(workbenchRoot)
    const batchDir = join(workbenchRoot, '04-上架工作区', 'shirt')
    const baseInput = {
      runId: 'run-locked',
      batchDir,
      xlsxPath: join(batchDir, '标题.xlsx'),
      language: 'en',
      platform: 'temu',
      model: 'qwen3.6-flash',
      skill: { id: 'title-temu-en', version: '1' },
      generatedAt: 1,
    }

    await savePendingTitleWrite(workbenchRoot, {
      ...baseInput,
      titles: { 'SKU-001': 'First title' },
    })
    await savePendingTitleWrite(workbenchRoot, {
      ...baseInput,
      titles: {
        'SKU-001': 'Updated title',
        'SKU-002': 'Second title',
      },
    })

    const records = await listPendingTitleWrites(workbenchRoot)
    expect(records).toHaveLength(1)
    const record = records[0]
    if (!record) {
      throw new Error('pending title sidecar was not persisted')
    }
    expect(pendingTitleMap(record)).toEqual(
      new Map([
        ['SKU-001', 'Updated title'],
        ['SKU-002', 'Second title'],
      ]),
    )

    await removePendingTitleWrite(workbenchRoot, record)
    await expect(listPendingTitleWrites(workbenchRoot)).resolves.toEqual([])
  })

  it('reports a corrupt sidecar and leaves it available for recovery', async () => {
    const workbenchRoot = await mkdtemp(join(tmpdir(), 'tengyu-pending-title-corrupt-'))
    tempRoots.push(workbenchRoot)
    const directory = pendingTitleWritesDirectory(workbenchRoot, 'run-corrupt')
    const filePath = join(directory, 'corrupt.json')
    await mkdir(directory, { recursive: true })
    await writeFile(filePath, '{not-json', 'utf8')

    await expect(listPendingTitleWrites(workbenchRoot)).rejects.toThrow(filePath)
    await expect(readFile(filePath, 'utf8')).resolves.toBe('{not-json')
  })

  it('classifies a non-missing pending directory read failure with path context', async () => {
    const workbenchRoot = await mkdtemp(join(tmpdir(), 'tengyu-pending-title-read-'))
    tempRoots.push(workbenchRoot)
    const pendingRunsPath = join(workbenchRoot, '.workbench', 'pipeline-runs')
    await mkdir(join(workbenchRoot, '.workbench'), { recursive: true })
    await writeFile(pendingRunsPath, 'not a directory', 'utf8')

    await expect(listPendingTitleWrites(workbenchRoot)).rejects.toMatchObject({
      name: 'AppError',
      code: 'WORKSPACE_IO_FAILED',
      message: `无法读取标题待补写目录，请检查工作区权限和目录状态后重试：${pendingRunsPath}`,
      retryable: false,
      details: {
        operation: 'listPendingTitleWrites',
        path: pendingRunsPath,
        filesystemCode: 'ENOTDIR',
      },
    })
  })
})
