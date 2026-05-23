import { mkdir, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

let workbenchRoot = ''

vi.mock('electron', () => ({
  ipcMain: {
    handle: vi.fn(),
  },
}))

vi.mock('../onboarding', () => ({
  readAppConfig: () => ({ workbench_root: workbenchRoot }),
}))

const { TempFileManager } = await import('./temp-file-manager')

beforeEach(async () => {
  workbenchRoot = await import('node:fs/promises').then(({ mkdtemp }) =>
    mkdtemp(join(tmpdir(), 'tengyu-temp-manager-')),
  )
  vi.useRealTimers()
})

afterEach(async () => {
  vi.useRealTimers()
  await rm(workbenchRoot, { recursive: true, force: true })
})

describe('TempFileManager', () => {
  it('creates and resolves task directories under .workbench/tmp', async () => {
    const manager = new TempFileManager()

    const dir = await manager.createTaskDir('title', 'task-1')

    expect(dir).toBe(join(workbenchRoot, '.workbench', 'tmp', 'title', 'task-1'))
    await expect(stat(dir)).resolves.toMatchObject({ isDirectory: expect.any(Function) })
  })

  it('cleans task directories immediately', async () => {
    const manager = new TempFileManager()
    const dir = await manager.createTaskDir('detection', 'task-2')
    await writeFile(join(dir, 'image.jpg'), 'image')

    await manager.cleanupTask('detection', 'task-2')

    await expect(stat(dir)).rejects.toThrow()
  })

  it('keeps failed task directories for delayed cleanup', async () => {
    const manager = new TempFileManager(1)
    const dir = await manager.createTaskDir('title', 'failed')
    await writeFile(join(dir, 'debug.jpg'), 'debug')

    await manager.cleanupTask('title', 'failed', { keepIfFailed: true })
    await expect(stat(dir)).resolves.toBeTruthy()

    await new Promise((resolve) => setTimeout(resolve, 20))
    await expect(stat(dir)).rejects.toThrow()
  })

  it('cleans orphan task directories older than 24 hours', async () => {
    const manager = new TempFileManager()
    const oldDir = join(workbenchRoot, '.workbench', 'tmp', 'title', 'old')
    const freshDir = join(workbenchRoot, '.workbench', 'tmp', 'title', 'fresh')
    await mkdir(oldDir, { recursive: true })
    await mkdir(freshDir, { recursive: true })
    const oldDate = new Date(Date.now() - 25 * 60 * 60 * 1000)
    await import('node:fs/promises').then(({ utimes }) => utimes(oldDir, oldDate, oldDate))

    await manager.cleanupOrphans()

    await expect(stat(oldDir)).rejects.toThrow()
    await expect(stat(freshDir)).resolves.toBeTruthy()
  })

  it('reports disk usage by module', async () => {
    const manager = new TempFileManager()
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
    const manager = new TempFileManager()
    const dir = await manager.createTaskDir('generation', 'task-3')
    await writeFile(join(dir, 'prompt.json'), '{}')

    await manager.cleanupAll()

    await expect(stat(dir)).rejects.toThrow()
    await expect(stat(join(workbenchRoot, '.workbench', 'tmp'))).resolves.toBeTruthy()
  })
})
