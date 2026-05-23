import { mkdir, readdir, rm, stat, utimes } from 'node:fs/promises'
import { join } from 'node:path'
import { ipcMain } from 'electron'
import { readAppConfig } from '../onboarding'

export type TempModule =
  | 'collection'
  | 'generation'
  | 'detection'
  | 'photoshop'
  | 'matting'
  | 'title'
  | 'listing'

type CleanupTaskOptions = {
  keepIfFailed?: boolean
}

const ORPHAN_MAX_AGE_MS = 24 * 60 * 60 * 1000
const FAILED_KEEP_MS = 60 * 60 * 1000

async function tmpRoot() {
  const config = await readAppConfig()
  if (!config.workbench_root) {
    throw new Error('workbench_root is required before temp files can be used')
  }
  return join(config.workbench_root, '.workbench', 'tmp')
}

async function pathExists(path: string) {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}

async function dirSizeBytes(path: string): Promise<number> {
  let total = 0
  const entries = await readdir(path, { withFileTypes: true }).catch(() => [])
  for (const entry of entries) {
    const fullPath = join(path, entry.name)
    if (entry.isDirectory()) {
      total += await dirSizeBytes(fullPath)
      continue
    }
    if (entry.isFile()) {
      total += (await stat(fullPath)).size
    }
  }
  return total
}

export class TempFileManager {
  private readonly delayedCleanup = new Map<string, NodeJS.Timeout>()
  private readonly sessionDirs = new Set<string>()

  constructor(private readonly failedKeepMs = FAILED_KEEP_MS) {}

  async createTaskDir(module: TempModule, taskId: string) {
    const dir = await this.getTaskDir(module, taskId)
    await mkdir(dir, { recursive: true })
    this.sessionDirs.add(`${module}/${taskId}`)
    return dir
  }

  async getTaskDir(module: TempModule, taskId: string) {
    return join(await tmpRoot(), module, taskId)
  }

  async cleanupTask(module: TempModule, taskId: string, options: CleanupTaskOptions = {}) {
    const key = `${module}/${taskId}`
    const dir = await this.getTaskDir(module, taskId)
    this.sessionDirs.delete(key)

    const existingTimer = this.delayedCleanup.get(key)
    if (existingTimer) {
      clearTimeout(existingTimer)
      this.delayedCleanup.delete(key)
    }

    if (options.keepIfFailed) {
      await this.markForDelayedCleanup(dir)
      const timer = setTimeout(() => {
        void rm(dir, { recursive: true, force: true }).finally(() => {
          this.delayedCleanup.delete(key)
        })
      }, this.failedKeepMs)
      this.delayedCleanup.set(key, timer)
      return
    }

    await rm(dir, { recursive: true, force: true })
  }

  async cleanupOrphans() {
    const root = await tmpRoot()
    const now = Date.now()
    const modules = await readdir(root, { withFileTypes: true }).catch(() => [])

    for (const moduleEntry of modules) {
      if (!moduleEntry.isDirectory()) {
        continue
      }
      const modulePath = join(root, moduleEntry.name)
      const taskDirs = await readdir(modulePath, { withFileTypes: true }).catch(() => [])
      for (const taskEntry of taskDirs) {
        if (!taskEntry.isDirectory()) {
          continue
        }
        const taskPath = join(modulePath, taskEntry.name)
        const info = await stat(taskPath)
        const modifiedAt = Number.isFinite(info.mtimeMs) ? info.mtimeMs : info.ctimeMs
        if (now - modifiedAt > ORPHAN_MAX_AGE_MS) {
          await rm(taskPath, { recursive: true, force: true })
        }
      }
    }
  }

  async cleanupSession() {
    await Promise.all(
      Array.from(this.sessionDirs).map(async (key) => {
        const [module, taskId] = key.split('/')
        if (!module || !taskId) {
          return
        }
        await this.cleanupTask(module as TempModule, taskId)
      }),
    )
  }

  async cleanupAll() {
    const root = await tmpRoot()
    this.clearTimers()
    this.sessionDirs.clear()
    await rm(root, { recursive: true, force: true })
    await mkdir(root, { recursive: true })
  }

  async getDiskUsage(): Promise<Record<string, number>> {
    const root = await tmpRoot()
    const usage: Record<string, number> = {}
    const modules = await readdir(root, { withFileTypes: true }).catch(() => [])

    for (const moduleEntry of modules) {
      if (moduleEntry.isDirectory()) {
        usage[moduleEntry.name] = await dirSizeBytes(join(root, moduleEntry.name))
      }
    }

    return usage
  }

  clearTimers() {
    for (const timer of this.delayedCleanup.values()) {
      clearTimeout(timer)
    }
    this.delayedCleanup.clear()
  }

  private async markForDelayedCleanup(dir: string) {
    if (await pathExists(dir)) {
      const date = new Date()
      await utimes(dir, date, date).catch(() => null)
    }
  }
}

export const tempFileManager = new TempFileManager()

export function registerTempFileIpc() {
  ipcMain.handle('temp-file:get-usage', () => tempFileManager.getDiskUsage())
  ipcMain.handle('temp-file:cleanup-all', async () => {
    await tempFileManager.cleanupAll()
    return { ok: true }
  })
}
