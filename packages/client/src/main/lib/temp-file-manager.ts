import { mkdir, readdir, rm, stat, utimes } from 'node:fs/promises'
import { join } from 'node:path'
import { AppErrorClass } from '@tengyu-aipod/shared'
import { ipcMain } from 'electron'
import { getWorkbenchRoot } from './workbench-config'

export type TempModule =
  | 'collection'
  | 'generation'
  | 'detection'
  | 'photoshop'
  | 'matting'
  | 'title'
  | 'listing'

type WorkbenchRootProvider = () => string | Promise<string>

interface TempFileManagerOptions {
  rootDir?: string
  workbenchRootProvider?: WorkbenchRootProvider
  now?: () => number
  orphanTtlMs?: number
  failedTtlMs?: number
}

interface CleanupTaskOptions {
  keepIfFailed?: boolean
  failedTtlMs?: number
}

const DEFAULT_ORPHAN_TTL_MS = 24 * 60 * 60 * 1000
const DEFAULT_FAILED_TTL_MS = 60 * 60 * 1000
const DEFAULT_PERIODIC_CLEANUP_INTERVAL_MS = 6 * 60 * 60 * 1000
const MAX_SAFE_SEGMENT_LENGTH = 120
const RESERVED_PATH_CHARS = new Set(['<', '>', ':', '"', '/', '\\', '|', '?', '*'])

function hasUnsafePathChar(value: string) {
  return Array.from(value).some((char) => RESERVED_PATH_CHARS.has(char) || char.charCodeAt(0) < 32)
}

function assertSafeSegment(value: string, label: string): void {
  if (
    !value ||
    value.length > MAX_SAFE_SEGMENT_LENGTH ||
    value === '.' ||
    value === '..' ||
    hasUnsafePathChar(value)
  ) {
    throw new AppErrorClass(
      'INVALID_INPUT',
      `${label} 不能为空，且不能包含路径分隔符、控制字符或系统保留字符`,
      false,
      {
        [label]: value,
      },
    )
  }
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
  private readonly rootDir: string | undefined
  private readonly workbenchRootProvider: WorkbenchRootProvider
  private readonly now: () => number
  private readonly orphanTtlMs: number
  private readonly defaultFailedTtlMs: number
  private readonly delayedCleanup = new Map<string, NodeJS.Timeout>()
  private periodicCleanupTimer: NodeJS.Timeout | null = null
  private readonly sessionDirs = new Set<string>()

  constructor(optionsOrFailedTtlMs: TempFileManagerOptions | number = {}) {
    const options: TempFileManagerOptions =
      typeof optionsOrFailedTtlMs === 'number' ? {} : optionsOrFailedTtlMs
    const defaultFailedTtlMs =
      typeof optionsOrFailedTtlMs === 'number'
        ? optionsOrFailedTtlMs
        : (options.failedTtlMs ?? DEFAULT_FAILED_TTL_MS)

    this.rootDir = options.rootDir
    this.workbenchRootProvider = options.workbenchRootProvider ?? getWorkbenchRoot
    this.now = options.now ?? Date.now
    this.orphanTtlMs = options.orphanTtlMs ?? DEFAULT_ORPHAN_TTL_MS
    this.defaultFailedTtlMs = defaultFailedTtlMs
  }

  async rootPath(): Promise<string> {
    if (this.rootDir) {
      return this.rootDir
    }
    return join(await this.workbenchRootProvider(), '.workbench', 'tmp')
  }

  async createTaskDir(module: TempModule | string, taskId: string): Promise<string> {
    const taskDir = await this.getTaskDir(module, taskId)
    await mkdir(taskDir, { recursive: true })
    this.sessionDirs.add(`${module}/${taskId}`)
    return taskDir
  }

  async getTaskDir(module: TempModule | string, taskId: string): Promise<string> {
    assertSafeSegment(module, 'module')
    assertSafeSegment(taskId, 'task_id')
    return join(await this.rootPath(), module, taskId)
  }

  async cleanupTask(
    module: TempModule | string,
    taskId: string,
    options: CleanupTaskOptions = {},
  ): Promise<void> {
    const key = `${module}/${taskId}`
    const taskDir = await this.getTaskDir(module, taskId)
    this.sessionDirs.delete(key)

    const existingTimer = this.delayedCleanup.get(key)
    if (existingTimer) {
      clearTimeout(existingTimer)
      this.delayedCleanup.delete(key)
    }

    if (options.keepIfFailed) {
      const failedTtlMs = options.failedTtlMs ?? this.defaultFailedTtlMs
      await this.markForDelayedCleanup(taskDir)
      const timer = setTimeout(() => {
        void rm(taskDir, { recursive: true, force: true }).finally(() => {
          this.delayedCleanup.delete(key)
        })
      }, failedTtlMs)
      timer.unref?.()
      this.delayedCleanup.set(key, timer)
      return
    }

    await rm(taskDir, { recursive: true, force: true })
  }

  async cleanupOrphans(): Promise<void> {
    const root = await this.rootPath()
    let modules: string[]
    try {
      modules = await readdir(root)
    } catch {
      return
    }

    await Promise.all(
      modules.map(async (module) => {
        const moduleDir = join(root, module)
        let taskIds: string[]
        try {
          taskIds = await readdir(moduleDir)
        } catch {
          return
        }

        await Promise.all(
          taskIds.map(async (taskId) => {
            const taskDir = join(moduleDir, taskId)
            try {
              const info = await stat(taskDir)
              const modifiedAt = Number.isFinite(info.mtimeMs) ? info.mtimeMs : info.ctimeMs
              if (this.now() - modifiedAt > this.orphanTtlMs) {
                await rm(taskDir, { recursive: true, force: true })
              }
            } catch {
              // Orphan cleanup is best effort.
            }
          }),
        )
      }),
    )
  }

  startPeriodicCleanup(intervalMs = DEFAULT_PERIODIC_CLEANUP_INTERVAL_MS) {
    this.stopPeriodicCleanup()
    const timer = setInterval(() => {
      void this.cleanupOrphans().catch(() => null)
    }, intervalMs)
    timer.unref?.()
    this.periodicCleanupTimer = timer
  }

  stopPeriodicCleanup() {
    if (this.periodicCleanupTimer) {
      clearInterval(this.periodicCleanupTimer)
      this.periodicCleanupTimer = null
    }
  }

  async cleanupSession() {
    await Promise.all(
      Array.from(this.sessionDirs).map(async (key) => {
        const [module, taskId] = key.split('/')
        if (!module || !taskId) {
          return
        }
        await this.cleanupTask(module, taskId)
      }),
    )
  }

  async cleanupAll() {
    const root = await this.rootPath()
    this.clearTimers()
    this.sessionDirs.clear()
    await rm(root, { recursive: true, force: true })
    await mkdir(root, { recursive: true })
  }

  async getDiskUsage(): Promise<Record<string, number>> {
    const root = await this.rootPath()
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
    this.stopPeriodicCleanup()
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
