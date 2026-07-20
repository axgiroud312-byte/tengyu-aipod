import { createHash, randomUUID } from 'node:crypto'
import type { Dirent } from 'node:fs'
import { mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises'
import { basename, join, resolve } from 'node:path'
import { AppErrorClass, WORKBENCH_DIRECTORIES } from '@tengyu-aipod/shared'
import { z } from 'zod'

const PENDING_TITLE_WRITES_FOLDER = 'pending-title-writes'
const PENDING_TITLE_WRITE_VERSION = 1 as const
const pendingTitleWriteQueues = new Map<string, Promise<void>>()

const pendingTitleWriteSchema = z.object({
  version: z.literal(PENDING_TITLE_WRITE_VERSION),
  runId: z.string().min(1),
  batchDir: z.string().min(1),
  xlsxPath: z.string().min(1),
  titles: z.record(z.string(), z.string()),
  language: z.string().min(1),
  platform: z.string().min(1),
  model: z.string().min(1),
  skill: z.object({
    id: z.string().min(1),
    version: z.string().min(1),
  }),
  generatedAt: z.number().finite(),
  updatedAt: z.number().finite(),
})

export type PendingTitleWrite = z.infer<typeof pendingTitleWriteSchema>

export type PendingTitleWriteRecord = PendingTitleWrite & {
  filePath: string
  revision: string
}

type PendingTitleWriteInput = Omit<PendingTitleWrite, 'version' | 'updatedAt'>
type PendingTitleWriteRemoval = Pick<PendingTitleWriteRecord, 'runId' | 'batchDir'> &
  Partial<Pick<PendingTitleWriteRecord, 'revision'>>

function safePathSegment(value: string) {
  const sanitized = value.replace(/[^a-zA-Z0-9._-]+/g, '_').replace(/^\.+$/, '')
  return sanitized.slice(0, 120) || 'run'
}

function pendingRoot(workbenchRoot: string) {
  return join(workbenchRoot, WORKBENCH_DIRECTORIES.metadata, 'pipeline-runs')
}

export function pendingTitleWritesDirectory(workbenchRoot: string, runId: string) {
  return join(pendingRoot(workbenchRoot), safePathSegment(runId), PENDING_TITLE_WRITES_FOLDER)
}

function pendingTitleWritePath(workbenchRoot: string, runId: string, batchDir: string) {
  const batchHash = createHash('sha256').update(batchDir).digest('hex').slice(0, 24)
  return join(pendingTitleWritesDirectory(workbenchRoot, runId), `${batchHash}.json`)
}

function pendingTitleWriteRevision(contents: string) {
  return createHash('sha256').update(contents).digest('hex')
}

function pendingTitleWriteLockKey(filePath: string) {
  const absolutePath = resolve(filePath)
  return process.platform === 'win32' ? absolutePath.toLowerCase() : absolutePath
}

export function pendingTitleXlsxPathKey(xlsxPath: string) {
  const absolutePath = resolve(xlsxPath)
  return process.platform === 'win32' ? absolutePath.toLowerCase() : absolutePath
}

async function withPendingTitleWriteLock<T>(filePath: string, operation: () => Promise<T>) {
  const key = pendingTitleWriteLockKey(filePath)
  const previous = pendingTitleWriteQueues.get(key) ?? Promise.resolve()
  let release: () => void = () => undefined
  const current = new Promise<void>((resolveCurrent) => {
    release = resolveCurrent
  })
  const tail = previous.then(() => current)
  pendingTitleWriteQueues.set(key, tail)

  await previous
  try {
    return await operation()
  } finally {
    release()
    if (pendingTitleWriteQueues.get(key) === tail) {
      pendingTitleWriteQueues.delete(key)
    }
  }
}

function filesystemErrorCode(error: unknown) {
  if (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    typeof error.code === 'string'
  ) {
    return error.code
  }
  return null
}

function pendingTitleWriteIoError(
  input: { operation: string; path: string; message: string },
  error: unknown,
) {
  const filesystemCode = filesystemErrorCode(error)
  return new AppErrorClass(
    'WORKSPACE_IO_FAILED',
    `${input.message}：${input.path}`,
    false,
    {
      operation: input.operation,
      path: input.path,
      ...(filesystemCode ? { filesystemCode } : {}),
    },
    error,
  )
}

function pendingDirectoryReadError(path: string, error: unknown) {
  return pendingTitleWriteIoError(
    {
      operation: 'listPendingTitleWrites',
      path,
      message: '无法读取标题待补写目录，请检查工作区权限和目录状态后重试',
    },
    error,
  )
}

export async function savePendingTitleWrite(workbenchRoot: string, input: PendingTitleWriteInput) {
  const filePath = pendingTitleWritePath(workbenchRoot, input.runId, input.batchDir)
  const directory = pendingTitleWritesDirectory(workbenchRoot, input.runId)
  try {
    await mkdir(directory, { recursive: true })
  } catch (error) {
    throw pendingTitleWriteIoError(
      {
        operation: 'createPendingTitleWriteDirectory',
        path: directory,
        message: '无法创建标题待补写目录，请检查工作区权限和磁盘空间后重试',
      },
      error,
    )
  }
  return withPendingTitleWriteLock(filePath, async () => {
    const existing = await readPendingRecordIfPresent(filePath)
    const value: PendingTitleWrite = {
      ...input,
      titles: {
        ...(existing?.titles ?? {}),
        ...input.titles,
      },
      version: PENDING_TITLE_WRITE_VERSION,
      updatedAt: Date.now(),
    }
    const contents = JSON.stringify(value, null, 2)
    const temporaryPath = `${filePath}.${randomUUID()}.tmp`
    let operationFailed = false
    let operationError: unknown
    try {
      try {
        await writeFile(temporaryPath, contents, 'utf8')
      } catch (error) {
        throw pendingTitleWriteIoError(
          {
            operation: 'writePendingTitleWriteTemporaryFile',
            path: temporaryPath,
            message: '无法暂存标题待补写记录，请检查工作区权限和磁盘空间后重试',
          },
          error,
        )
      }
      try {
        await rename(temporaryPath, filePath)
      } catch (error) {
        throw pendingTitleWriteIoError(
          {
            operation: 'replacePendingTitleWrite',
            path: filePath,
            message: '无法保存标题待补写记录，请检查工作区权限和文件占用后重试',
          },
          error,
        )
      }
    } catch (error) {
      operationFailed = true
      operationError = error
    }
    try {
      await rm(temporaryPath, { force: true })
    } catch (error) {
      if (!operationFailed) {
        operationFailed = true
        operationError = pendingTitleWriteIoError(
          {
            operation: 'cleanupPendingTitleWriteTemporaryFile',
            path: temporaryPath,
            message: '无法清理标题待补写临时文件，请检查工作区权限和文件占用后重试',
          },
          error,
        )
      }
    }
    if (operationFailed) {
      throw operationError
    }
    return { ...value, filePath, revision: pendingTitleWriteRevision(contents) }
  })
}

export async function removePendingTitleWrite(
  workbenchRoot: string,
  record: PendingTitleWriteRemoval,
) {
  const filePath = pendingTitleWritePath(workbenchRoot, record.runId, record.batchDir)
  return withPendingTitleWriteLock(filePath, async () => {
    if (record.revision !== undefined) {
      const current = await readPendingRecordIfPresent(filePath)
      if (!current || current.revision !== record.revision) {
        return
      }
    }
    try {
      await rm(filePath, { force: true })
    } catch (error) {
      throw pendingTitleWriteIoError(
        {
          operation: 'removePendingTitleWrite',
          path: filePath,
          message: '无法删除标题待补写记录，请检查工作区权限和文件占用后重试',
        },
        error,
      )
    }
  })
}

async function readPendingRecord(filePath: string): Promise<PendingTitleWriteRecord> {
  let contents: string
  try {
    contents = await readFile(filePath, 'utf8')
  } catch (error) {
    throw pendingTitleWriteIoError(
      {
        operation: 'readPendingTitleWrite',
        path: filePath,
        message: '无法读取标题待补写记录，请检查工作区权限和文件状态后重试',
      },
      error,
    )
  }

  try {
    const parsed = pendingTitleWriteSchema.parse(JSON.parse(contents))
    return { ...parsed, filePath, revision: pendingTitleWriteRevision(contents) }
  } catch (error) {
    throw new AppErrorClass(
      'INVALID_INPUT',
      `待补写标题记录损坏，请检查或移走后重试：${filePath}`,
      false,
      { filePath },
      error,
    )
  }
}

async function readPendingRecordIfPresent(filePath: string) {
  try {
    return await readPendingRecord(filePath)
  } catch (error) {
    if (
      error instanceof AppErrorClass &&
      error.code === 'WORKSPACE_IO_FAILED' &&
      error.details?.filesystemCode === 'ENOENT'
    ) {
      return null
    }
    throw error
  }
}

export async function listPendingTitleWrites(workbenchRoot: string) {
  const root = pendingRoot(workbenchRoot)
  let runEntries: Dirent[]
  try {
    runEntries = await readdir(root, { withFileTypes: true })
  } catch (error) {
    if (filesystemErrorCode(error) === 'ENOENT') {
      return []
    }
    throw pendingDirectoryReadError(root, error)
  }

  const records: PendingTitleWriteRecord[] = []
  for (const runEntry of runEntries) {
    if (!runEntry.isDirectory()) {
      continue
    }
    const directory = join(pendingRoot(workbenchRoot), runEntry.name, PENDING_TITLE_WRITES_FOLDER)
    let files: Dirent[]
    try {
      files = await readdir(directory, { withFileTypes: true })
    } catch (error) {
      if (filesystemErrorCode(error) === 'ENOENT') {
        continue
      }
      throw pendingDirectoryReadError(directory, error)
    }
    for (const file of files) {
      if (!file.isFile() || !file.name.endsWith('.json')) {
        continue
      }
      const record = await readPendingRecord(join(directory, file.name))
      records.push(record)
    }
  }

  return records.sort((left, right) => left.updatedAt - right.updatedAt)
}

export function pendingTitleMap(record: PendingTitleWriteRecord) {
  return new Map(Object.entries(record.titles))
}

export function pendingTitleBatchName(record: PendingTitleWriteRecord) {
  return basename(record.batchDir)
}
