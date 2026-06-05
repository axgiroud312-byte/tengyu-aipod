import { isAbsolute, relative, resolve } from 'node:path'
import { AppErrorClass } from '@tengyu-aipod/shared'

export type CollectionFolderReadLock = {
  id: string
  folder: string
  release: () => void
}

type CollectionFolderLockOwner = {
  kind: 'pipeline'
  runId: string
}

type CollectionFolderReadLockRecord = {
  id: string
  folder: string
  owner: CollectionFolderLockOwner
}

export class CollectionFolderLock {
  private readonly readers = new Map<string, CollectionFolderReadLockRecord>()

  acquireRead(folder: string, owner: CollectionFolderLockOwner): CollectionFolderReadLock {
    const normalized = normalizeFolderPath(folder)
    const id = `${owner.kind}:${owner.runId}:${Date.now()}:${this.readers.size + 1}`
    this.readers.set(id, { id, folder: normalized, owner })
    let released = false
    return {
      id,
      folder: normalized,
      release: () => {
        if (released) {
          return
        }
        released = true
        this.readers.delete(id)
      },
    }
  }

  assertWritable(targetFolder: string) {
    const normalizedTarget = normalizeFolderPath(targetFolder)
    const conflict = Array.from(this.readers.values()).find((reader) =>
      pathsOverlap(reader.folder, normalizedTarget),
    )
    if (!conflict) {
      return
    }
    throw new AppErrorClass(
      'HTTP_4XX',
      '完整任务正在读取该采集目录，请等待完整任务结束后再写入同一目录',
      false,
      {
        kind: 'collection_folder_locked',
        runId: conflict.owner.runId,
        lockedFolder: conflict.folder,
        targetFolder: normalizedTarget,
      },
    )
  }

  clearForTests() {
    this.readers.clear()
  }
}

function normalizeFolderPath(folder: string) {
  const trimmed = folder.trim()
  if (!trimmed) {
    throw new AppErrorClass('HTTP_4XX', '采集目录不能为空', false, {
      kind: 'validation',
    })
  }
  return resolve(trimmed)
}

function pathsOverlap(left: string, right: string) {
  return sameOrInside(left, right) || sameOrInside(right, left)
}

function sameOrInside(child: string, parent: string) {
  if (child === parent) {
    return true
  }
  const value = relative(parent, child)
  return Boolean(value) && !value.startsWith('..') && !isAbsolute(value)
}

export const collectionFolderLock = new CollectionFolderLock()
