import { mkdir, readdir, rm, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { AppErrorClass } from '@tengyu-aipod/shared'
import { getWorkbenchRoot } from './workbench-config'

type WorkbenchRootProvider = () => string | Promise<string>

interface TempFileManagerOptions {
  rootDir?: string
  workbenchRootProvider?: WorkbenchRootProvider
  now?: () => number
  orphanTtlMs?: number
}

interface CleanupTaskOptions {
  keepIfFailed?: boolean
  failedTtlMs?: number
}

const DEFAULT_ORPHAN_TTL_MS = 24 * 60 * 60 * 1000
const DEFAULT_FAILED_TTL_MS = 60 * 60 * 1000
const SAFE_SEGMENT_PATTERN = /^[A-Za-z0-9_-]{1,120}$/

function assertSafeSegment(value: string, label: string): void {
  if (!SAFE_SEGMENT_PATTERN.test(value)) {
    throw new AppErrorClass('INVALID_INPUT', `${label} 只能包含字母、数字、下划线或短横线`, false, {
      [label]: value,
    })
  }
}

export class TempFileManager {
  private readonly rootDir: string | undefined
  private readonly workbenchRootProvider: WorkbenchRootProvider
  private readonly now: () => number
  private readonly orphanTtlMs: number

  constructor(options: TempFileManagerOptions = {}) {
    this.rootDir = options.rootDir
    this.workbenchRootProvider = options.workbenchRootProvider ?? getWorkbenchRoot
    this.now = options.now ?? Date.now
    this.orphanTtlMs = options.orphanTtlMs ?? DEFAULT_ORPHAN_TTL_MS
  }

  async rootPath(): Promise<string> {
    if (this.rootDir) {
      return this.rootDir
    }
    return join(await this.workbenchRootProvider(), '.workbench', 'tmp')
  }

  async createTaskDir(module: string, taskId: string): Promise<string> {
    const taskDir = await this.getTaskDir(module, taskId)
    await mkdir(taskDir, { recursive: true })
    return taskDir
  }

  async getTaskDir(module: string, taskId: string): Promise<string> {
    assertSafeSegment(module, 'module')
    assertSafeSegment(taskId, 'task_id')
    return join(await this.rootPath(), module, taskId)
  }

  async cleanupTask(
    module: string,
    taskId: string,
    options: CleanupTaskOptions = {},
  ): Promise<void> {
    const taskDir = await this.getTaskDir(module, taskId)
    if (options.keepIfFailed) {
      const ttlMs = options.failedTtlMs ?? DEFAULT_FAILED_TTL_MS
      setTimeout(() => {
        void rm(taskDir, { recursive: true, force: true })
      }, ttlMs).unref()
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
              if (this.now() - info.mtimeMs > this.orphanTtlMs) {
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
}

export const tempFileManager = new TempFileManager()
