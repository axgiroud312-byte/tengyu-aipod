import { mkdir, mkdtemp, rm, stat, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TempFileManager } from './temp-file-manager'

const electronAppGetPath = vi.hoisted(() => vi.fn())

vi.mock('electron', () => ({
  app: {
    getPath: electronAppGetPath,
  },
  ipcMain: {
    handle: vi.fn(),
  },
}))

let tempDir = ''

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), 'tengyu-temp-files-'))
  electronAppGetPath.mockImplementation(() => tempDir)
  vi.useRealTimers()
})

afterEach(async () => {
  vi.useRealTimers()
  await rm(tempDir, { recursive: true, force: true })
})

describe('TempFileManager', () => {
  it('creates isolated task directories under module roots', async () => {
    const manager = new TempFileManager({ rootDir: tempDir })

    await expect(manager.createTaskDir('photoshop', 'scan-abc')).resolves.toBe(
      join(tempDir, 'photoshop', 'scan-abc'),
    )
    const info = await stat(join(tempDir, 'photoshop', 'scan-abc'))
    expect(info.isDirectory()).toBe(true)
  })

  it('allows localized task names while keeping them inside the module root', async () => {
    const manager = new TempFileManager({ rootDir: tempDir })
    const taskId = '检测-20260601-182806'

    await expect(manager.createTaskDir('detection', taskId)).resolves.toBe(
      join(tempDir, 'detection', taskId),
    )
    await expect(stat(join(tempDir, 'detection', taskId))).resolves.toBeTruthy()
  })

  it('creates and resolves task directories under .workbench/tmp', async () => {
    const manager = new TempFileManager({
      workbenchRootProvider: () => tempDir,
    })

    const dir = await manager.createTaskDir('title', 'task-1')

    expect(dir).toBe(join(tempDir, '.workbench', 'tmp', 'title', 'task-1'))
    await expect(stat(dir)).resolves.toMatchObject({ isDirectory: expect.any(Function) })
  })

  it('rejects unsafe path segments', async () => {
    const manager = new TempFileManager({ rootDir: tempDir })

    await expect(manager.createTaskDir('photoshop', '../bad')).rejects.toMatchObject({
      code: 'INVALID_INPUT',
    })
    await expect(manager.createTaskDir('photoshop', 'bad/name')).rejects.toMatchObject({
      code: 'INVALID_INPUT',
    })
    await expect(manager.createTaskDir('photoshop', '..')).rejects.toMatchObject({
      code: 'INVALID_INPUT',
    })
  })

  it('cleans task directories immediately', async () => {
    const manager = new TempFileManager({ rootDir: tempDir })
    const dir = await manager.createTaskDir('detection', 'task-2')
    await writeFile(join(dir, 'image.jpg'), 'image')

    await manager.cleanupTask('detection', 'task-2')

    await expect(stat(dir)).rejects.toThrow()
  })

  it('keeps failed task directories for delayed cleanup', async () => {
    const manager = new TempFileManager({ rootDir: tempDir, failedTtlMs: 1 })
    const dir = await manager.createTaskDir('title', 'failed')
    await writeFile(join(dir, 'debug.jpg'), 'debug')

    await manager.cleanupTask('title', 'failed', { keepIfFailed: true })
    await expect(stat(dir)).resolves.toBeTruthy()

    await vi.waitFor(async () => {
      await expect(stat(dir)).rejects.toThrow()
    })
  })

  it('cleans orphan task directories older than 24 hours', async () => {
    const oldDir = join(tempDir, 'photoshop', 'old-task')
    const freshDir = join(tempDir, 'photoshop', 'fresh-task')
    await mkdir(oldDir, { recursive: true })
    await mkdir(freshDir, { recursive: true })
    const oldDate = new Date(0)
    await utimes(oldDir, oldDate, oldDate)

    const manager = new TempFileManager({
      rootDir: tempDir,
      now: () => 48 * 60 * 60 * 1000,
      orphanTtlMs: 24 * 60 * 60 * 1000,
    })
    await manager.cleanupOrphans()

    await expect(stat(oldDir)).rejects.toThrow()
    await expect(stat(freshDir)).resolves.toBeDefined()
  })

  it('cleans orphan task directories every 6 hours after startup', async () => {
    vi.useFakeTimers()
    class CountingTempFileManager extends TempFileManager {
      cleanupCalls = 0

      override async cleanupOrphans(): Promise<void> {
        this.cleanupCalls += 1
      }
    }
    const manager = new CountingTempFileManager({ rootDir: tempDir })
    manager.startPeriodicCleanup()

    await vi.advanceTimersByTimeAsync(6 * 60 * 60 * 1000 - 1)
    expect(manager.cleanupCalls).toBe(0)

    await vi.advanceTimersByTimeAsync(1)
    expect(manager.cleanupCalls).toBe(1)

    manager.stopPeriodicCleanup()
  })

  it('reports disk usage by module', async () => {
    const manager = new TempFileManager({ rootDir: tempDir })
    const titleDir = await manager.createTaskDir('title', 'usage-title')
    const detectionDir = await manager.createTaskDir('detection', 'usage-detection')
    await writeFile(join(titleDir, 'a.bin'), Buffer.alloc(3))
    await writeFile(join(detectionDir, 'b.bin'), Buffer.alloc(5))

    await expect(manager.getDiskUsage()).resolves.toMatchObject({
      title: 3,
      detection: 5,
    })
  })

  it('cleans all temp files', async () => {
    const manager = new TempFileManager({
      workbenchRootProvider: () => tempDir,
    })
    const dir = await manager.createTaskDir('generation', 'task-3')
    await writeFile(join(dir, 'prompt.json'), '{}')

    await manager.cleanupAll()

    await expect(stat(dir)).rejects.toThrow()
    await expect(stat(join(tempDir, '.workbench', 'tmp'))).resolves.toBeTruthy()
  })
})
