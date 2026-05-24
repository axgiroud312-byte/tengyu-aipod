import { createRequire } from 'node:module'
import { AppErrorClass } from '@tengyu-aipod/shared'

export type BrowserProfileModule = 'collection' | 'listing'

export type BrowserProfileHolder = {
  profileId: string
  module: BrowserProfileModule
  taskId: string
  acquiredAt: number
}

export class BrowserProfileLockHandle {
  private released = false

  constructor(
    public readonly holder: BrowserProfileHolder,
    private readonly releaseFn: () => void,
  ) {}

  release() {
    if (this.released) {
      return
    }
    this.released = true
    this.releaseFn()
  }
}

const nodeRequire = createRequire(import.meta.url)

export class BrowserProfileLockManager {
  private readonly locks = new Map<string, BrowserProfileHolder>()

  acquire(
    profileId: string,
    module: BrowserProfileModule,
    taskId: string,
  ): BrowserProfileLockHandle {
    const existing = this.locks.get(profileId)
    if (existing) {
      throw new AppErrorClass('PROFILE_LOCKED', '比特浏览器 profile 已被占用', false, {
        kind: 'resource_lock',
        profileId,
        module: existing.module,
        taskId: existing.taskId,
      })
    }

    const holder: BrowserProfileHolder = {
      profileId,
      module,
      taskId,
      acquiredAt: Date.now(),
    }
    this.locks.set(profileId, holder)
    return new BrowserProfileLockHandle(holder, () => {
      const current = this.locks.get(profileId)
      if (current?.taskId === taskId && current.module === module) {
        this.locks.delete(profileId)
      }
    })
  }

  status(profileId: string) {
    return this.locks.get(profileId) ?? null
  }

  list() {
    return Array.from(this.locks.values())
  }

  clear() {
    this.locks.clear()
  }
}

export const browserProfileLocks = new BrowserProfileLockManager()

export function registerBrowserProfileLockIpc(
  locks: BrowserProfileLockManager = browserProfileLocks,
) {
  const ipcMain = electronIpcMain()
  ipcMain.handle('browser-profile-lock:list', () => locks.list())
}

function electronIpcMain() {
  return (nodeRequire('electron') as typeof import('electron')).ipcMain
}
