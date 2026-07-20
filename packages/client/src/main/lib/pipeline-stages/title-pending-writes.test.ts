import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  listPendingTitleWrites,
  pendingTitleMap,
  pendingTitleWritesDirectory,
  removePendingTitleWrite,
  savePendingTitleWrite,
} from './title-pending-writes'

vi.mock('node:fs/promises', async (importOriginal) => {
  const original = await importOriginal<typeof import('node:fs/promises')>()
  return {
    ...original,
    mkdir: vi.fn(original.mkdir),
    readFile: vi.fn(original.readFile),
    rename: vi.fn(original.rename),
    rm: vi.fn(original.rm),
    writeFile: vi.fn(original.writeFile),
  }
})

const tempRoots: string[] = []

function filesystemError(code: string, path: string) {
  const error = new Error(`${code}: fixture I/O failure, ${path}`) as NodeJS.ErrnoException
  error.code = code
  error.path = path
  return error
}

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('pending title writes', () => {
  it('merges repeated writes to the same batch and keeps the latest title per SKU', async () => {
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
      titles: { 'SKU-002': 'Second title' },
    })
    await savePendingTitleWrite(workbenchRoot, {
      ...baseInput,
      titles: { 'SKU-001': 'Updated title' },
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

  it('keeps a newer sidecar when an older retry snapshot finishes later', async () => {
    const workbenchRoot = await mkdtemp(join(tmpdir(), 'tengyu-pending-title-stale-remove-'))
    tempRoots.push(workbenchRoot)
    const batchDir = join(workbenchRoot, '04-上架工作区', 'shirt')
    const baseInput = {
      runId: 'run-stale-remove',
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
    const retrySnapshot = (await listPendingTitleWrites(workbenchRoot))[0]
    if (!retrySnapshot) {
      throw new Error('retry snapshot was not persisted')
    }

    await savePendingTitleWrite(workbenchRoot, {
      ...baseInput,
      titles: { 'SKU-002': 'Second title' },
    })
    await removePendingTitleWrite(workbenchRoot, retrySnapshot)

    const records = await listPendingTitleWrites(workbenchRoot)
    expect(records).toHaveLength(1)
    const current = records[0]
    if (!current) {
      throw new Error('newer pending title sidecar was removed by a stale retry')
    }
    expect(pendingTitleMap(current)).toEqual(
      new Map([
        ['SKU-001', 'First title'],
        ['SKU-002', 'Second title'],
      ]),
    )
  })

  it('reports a corrupt sidecar and leaves it available for recovery', async () => {
    const workbenchRoot = await mkdtemp(join(tmpdir(), 'tengyu-pending-title-corrupt-'))
    tempRoots.push(workbenchRoot)
    const directory = pendingTitleWritesDirectory(workbenchRoot, 'run-corrupt')
    const filePath = join(directory, 'corrupt.json')
    await mkdir(directory, { recursive: true })
    await writeFile(filePath, '{not-json', 'utf8')

    await expect(listPendingTitleWrites(workbenchRoot)).rejects.toMatchObject({
      name: 'AppError',
      code: 'INVALID_INPUT',
      message: `待补写标题记录损坏，请检查或移走后重试：${filePath}`,
      retryable: false,
      details: { filePath },
      cause: expect.any(SyntaxError),
    })
    await expect(readFile(filePath, 'utf8')).resolves.toBe('{not-json')
  })

  it('does not overwrite a corrupt existing sidecar while merging', async () => {
    const workbenchRoot = await mkdtemp(join(tmpdir(), 'tengyu-pending-title-merge-corrupt-'))
    tempRoots.push(workbenchRoot)
    const batchDir = join(workbenchRoot, '04-上架工作区', 'shirt')
    const baseInput = {
      runId: 'run-merge-corrupt',
      batchDir,
      xlsxPath: join(batchDir, '标题.xlsx'),
      language: 'en',
      platform: 'temu',
      model: 'qwen3.6-flash',
      skill: { id: 'title-temu-en', version: '1' },
      generatedAt: 1,
    }
    const record = await savePendingTitleWrite(workbenchRoot, {
      ...baseInput,
      titles: { 'SKU-001': 'Saved title' },
    })
    await writeFile(record.filePath, '{not-json', 'utf8')

    await expect(
      savePendingTitleWrite(workbenchRoot, {
        ...baseInput,
        titles: { 'SKU-002': 'New title' },
      }),
    ).rejects.toMatchObject({
      name: 'AppError',
      code: 'INVALID_INPUT',
      details: { filePath: record.filePath },
    })
    await expect(readFile(record.filePath, 'utf8')).resolves.toBe('{not-json')
  })

  it('does not overwrite an existing sidecar when its merge read fails', async () => {
    const workbenchRoot = await mkdtemp(join(tmpdir(), 'tengyu-pending-title-merge-read-'))
    tempRoots.push(workbenchRoot)
    const batchDir = join(workbenchRoot, '04-上架工作区', 'shirt')
    const baseInput = {
      runId: 'run-merge-read-failure',
      batchDir,
      xlsxPath: join(batchDir, '标题.xlsx'),
      language: 'en',
      platform: 'temu',
      model: 'qwen3.6-flash',
      skill: { id: 'title-temu-en', version: '1' },
      generatedAt: 1,
    }
    const record = await savePendingTitleWrite(workbenchRoot, {
      ...baseInput,
      titles: { 'SKU-001': 'Saved title' },
    })
    const error = filesystemError('EIO', record.filePath)
    vi.mocked(readFile).mockRejectedValueOnce(error)

    await expect(
      savePendingTitleWrite(workbenchRoot, {
        ...baseInput,
        titles: { 'SKU-002': 'New title' },
      }),
    ).rejects.toMatchObject({
      name: 'AppError',
      code: 'WORKSPACE_IO_FAILED',
      details: {
        operation: 'readPendingTitleWrite',
        path: record.filePath,
        filesystemCode: 'EIO',
      },
      cause: error,
    })

    const records = await listPendingTitleWrites(workbenchRoot)
    expect(records).toHaveLength(1)
    const preservedRecord = records[0]
    if (!preservedRecord) {
      throw new Error('existing pending title sidecar was not preserved')
    }
    expect(pendingTitleMap(preservedRecord)).toEqual(new Map([['SKU-001', 'Saved title']]))
  })

  it('classifies a sidecar read I/O failure and preserves its cause and path', async () => {
    const workbenchRoot = await mkdtemp(join(tmpdir(), 'tengyu-pending-title-file-read-'))
    tempRoots.push(workbenchRoot)
    const batchDir = join(workbenchRoot, '04-上架工作区', 'shirt')
    const record = await savePendingTitleWrite(workbenchRoot, {
      runId: 'run-read-failure',
      batchDir,
      xlsxPath: join(batchDir, '标题.xlsx'),
      titles: { 'SKU-001': 'Saved title' },
      language: 'en',
      platform: 'temu',
      model: 'qwen3.6-flash',
      skill: { id: 'title-temu-en', version: '1' },
      generatedAt: 1,
    })
    const error = filesystemError('EACCES', record.filePath)
    vi.mocked(readFile).mockRejectedValueOnce(error)

    await expect(listPendingTitleWrites(workbenchRoot)).rejects.toMatchObject({
      name: 'AppError',
      code: 'WORKSPACE_IO_FAILED',
      retryable: false,
      details: {
        operation: 'readPendingTitleWrite',
        path: record.filePath,
        filesystemCode: 'EACCES',
      },
      cause: error,
    })
  })

  it('classifies a sidecar directory creation failure with its cause and path', async () => {
    const workbenchRoot = await mkdtemp(join(tmpdir(), 'tengyu-pending-title-mkdir-'))
    tempRoots.push(workbenchRoot)
    const runId = 'run-mkdir-failure'
    const directory = pendingTitleWritesDirectory(workbenchRoot, runId)
    const batchDir = join(workbenchRoot, '04-上架工作区', 'shirt')
    const error = filesystemError('ENOSPC', directory)
    vi.mocked(mkdir).mockRejectedValueOnce(error)

    await expect(
      savePendingTitleWrite(workbenchRoot, {
        runId,
        batchDir,
        xlsxPath: join(batchDir, '标题.xlsx'),
        titles: { 'SKU-001': 'Saved title' },
        language: 'en',
        platform: 'temu',
        model: 'qwen3.6-flash',
        skill: { id: 'title-temu-en', version: '1' },
        generatedAt: 1,
      }),
    ).rejects.toMatchObject({
      name: 'AppError',
      code: 'WORKSPACE_IO_FAILED',
      retryable: false,
      details: {
        operation: 'createPendingTitleWriteDirectory',
        path: directory,
        filesystemCode: 'ENOSPC',
      },
      cause: error,
    })
  })

  it('classifies a sidecar temporary write failure with its cause and actual path', async () => {
    const workbenchRoot = await mkdtemp(join(tmpdir(), 'tengyu-pending-title-write-'))
    tempRoots.push(workbenchRoot)
    const batchDir = join(workbenchRoot, '04-上架工作区', 'shirt')
    const error = filesystemError('EIO', '')
    let temporaryPath = ''
    vi.mocked(writeFile).mockImplementationOnce(async (path) => {
      temporaryPath = String(path)
      error.path = temporaryPath
      throw error
    })

    let thrown: unknown
    try {
      await savePendingTitleWrite(workbenchRoot, {
        runId: 'run-write-failure',
        batchDir,
        xlsxPath: join(batchDir, '标题.xlsx'),
        titles: { 'SKU-001': 'Saved title' },
        language: 'en',
        platform: 'temu',
        model: 'qwen3.6-flash',
        skill: { id: 'title-temu-en', version: '1' },
        generatedAt: 1,
      })
    } catch (error) {
      thrown = error
    }

    expect(thrown).toMatchObject({
      name: 'AppError',
      code: 'WORKSPACE_IO_FAILED',
      retryable: false,
      details: {
        operation: 'writePendingTitleWriteTemporaryFile',
        path: temporaryPath,
        filesystemCode: 'EIO',
      },
      cause: error,
    })
  })

  it('classifies a sidecar replacement failure with its cause and actual path', async () => {
    const workbenchRoot = await mkdtemp(join(tmpdir(), 'tengyu-pending-title-rename-'))
    tempRoots.push(workbenchRoot)
    const batchDir = join(workbenchRoot, '04-上架工作区', 'shirt')
    const error = filesystemError('EPERM', '')
    let filePath = ''
    vi.mocked(rename).mockImplementationOnce(async (_temporaryPath, targetPath) => {
      filePath = String(targetPath)
      error.path = filePath
      throw error
    })

    let thrown: unknown
    try {
      await savePendingTitleWrite(workbenchRoot, {
        runId: 'run-rename-failure',
        batchDir,
        xlsxPath: join(batchDir, '标题.xlsx'),
        titles: { 'SKU-001': 'Saved title' },
        language: 'en',
        platform: 'temu',
        model: 'qwen3.6-flash',
        skill: { id: 'title-temu-en', version: '1' },
        generatedAt: 1,
      })
    } catch (error) {
      thrown = error
    }

    expect(thrown).toMatchObject({
      name: 'AppError',
      code: 'WORKSPACE_IO_FAILED',
      retryable: false,
      details: {
        operation: 'replacePendingTitleWrite',
        path: filePath,
        filesystemCode: 'EPERM',
      },
      cause: error,
    })
  })

  it('classifies a sidecar temporary cleanup failure with its cause and actual path', async () => {
    const workbenchRoot = await mkdtemp(join(tmpdir(), 'tengyu-pending-title-cleanup-'))
    tempRoots.push(workbenchRoot)
    const batchDir = join(workbenchRoot, '04-上架工作区', 'shirt')
    const error = filesystemError('EBUSY', '')
    let temporaryPath = ''
    vi.mocked(rm).mockImplementationOnce(async (path) => {
      temporaryPath = String(path)
      error.path = temporaryPath
      throw error
    })

    let thrown: unknown
    try {
      await savePendingTitleWrite(workbenchRoot, {
        runId: 'run-cleanup-failure',
        batchDir,
        xlsxPath: join(batchDir, '标题.xlsx'),
        titles: { 'SKU-001': 'Saved title' },
        language: 'en',
        platform: 'temu',
        model: 'qwen3.6-flash',
        skill: { id: 'title-temu-en', version: '1' },
        generatedAt: 1,
      })
    } catch (error) {
      thrown = error
    }

    expect(thrown).toMatchObject({
      name: 'AppError',
      code: 'WORKSPACE_IO_FAILED',
      retryable: false,
      details: {
        operation: 'cleanupPendingTitleWriteTemporaryFile',
        path: temporaryPath,
        filesystemCode: 'EBUSY',
      },
      cause: error,
    })
  })

  it('classifies a sidecar removal failure with its cause and path', async () => {
    const workbenchRoot = await mkdtemp(join(tmpdir(), 'tengyu-pending-title-remove-'))
    tempRoots.push(workbenchRoot)
    const batchDir = join(workbenchRoot, '04-上架工作区', 'shirt')
    const record = await savePendingTitleWrite(workbenchRoot, {
      runId: 'run-remove-failure',
      batchDir,
      xlsxPath: join(batchDir, '标题.xlsx'),
      titles: { 'SKU-001': 'Saved title' },
      language: 'en',
      platform: 'temu',
      model: 'qwen3.6-flash',
      skill: { id: 'title-temu-en', version: '1' },
      generatedAt: 1,
    })
    const error = filesystemError('EACCES', record.filePath)
    vi.mocked(rm).mockRejectedValueOnce(error)

    await expect(removePendingTitleWrite(workbenchRoot, record)).rejects.toMatchObject({
      name: 'AppError',
      code: 'WORKSPACE_IO_FAILED',
      retryable: false,
      details: {
        operation: 'removePendingTitleWrite',
        path: record.filePath,
        filesystemCode: 'EACCES',
      },
      cause: error,
    })
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
