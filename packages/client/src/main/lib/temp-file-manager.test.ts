import { mkdir, mkdtemp, rm, stat, utimes } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { TempFileManager } from './temp-file-manager'

let tempDir = ''

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), 'tengyu-temp-files-'))
})

afterEach(async () => {
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

  it('rejects unsafe path segments', async () => {
    const manager = new TempFileManager({ rootDir: tempDir })

    await expect(manager.createTaskDir('photoshop', '../bad')).rejects.toMatchObject({
      code: 'INVALID_INPUT',
    })
  })

  it('cleans orphan task directories older than ttl', async () => {
    const oldTaskDir = join(tempDir, 'photoshop', 'old-task')
    const freshTaskDir = join(tempDir, 'photoshop', 'fresh-task')
    await mkdir(oldTaskDir, { recursive: true })
    await mkdir(freshTaskDir, { recursive: true })
    const oldDate = new Date(0)
    await utimes(oldTaskDir, oldDate, oldDate)

    const manager = new TempFileManager({
      rootDir: tempDir,
      now: () => 48 * 60 * 60 * 1000,
      orphanTtlMs: 24 * 60 * 60 * 1000,
    })
    await manager.cleanupOrphans()

    await expect(stat(oldTaskDir)).rejects.toThrow()
    await expect(stat(freshTaskDir)).resolves.toBeDefined()
  })
})
