import { createHash, randomUUID } from 'node:crypto'
import type { Dirent } from 'node:fs'
import { mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { AppErrorClass, WORKBENCH_DIRECTORIES } from '@tengyu-aipod/shared'
import { z } from 'zod'

const PENDING_TITLE_WRITES_FOLDER = 'pending-title-writes'
const PENDING_TITLE_WRITE_VERSION = 1 as const

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
}

type PendingTitleWriteInput = Omit<PendingTitleWrite, 'version' | 'updatedAt'>

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

function pendingDirectoryReadError(path: string, error: unknown) {
  const filesystemCode = filesystemErrorCode(error)
  return new AppErrorClass(
    'HTTP_5XX',
    `无法读取标题待补写目录，请检查工作区权限和目录状态后重试：${path}`,
    false,
    {
      operation: 'listPendingTitleWrites',
      path,
      ...(filesystemCode ? { filesystemCode } : {}),
    },
    error,
  )
}

export async function savePendingTitleWrite(workbenchRoot: string, input: PendingTitleWriteInput) {
  const filePath = pendingTitleWritePath(workbenchRoot, input.runId, input.batchDir)
  const directory = pendingTitleWritesDirectory(workbenchRoot, input.runId)
  const value: PendingTitleWrite = {
    ...input,
    version: PENDING_TITLE_WRITE_VERSION,
    updatedAt: Date.now(),
  }
  await mkdir(directory, { recursive: true })
  const temporaryPath = `${filePath}.${randomUUID()}.tmp`
  try {
    await writeFile(temporaryPath, JSON.stringify(value, null, 2), 'utf8')
    await rename(temporaryPath, filePath)
  } finally {
    await rm(temporaryPath, { force: true })
  }
  return { ...value, filePath }
}

export async function removePendingTitleWrite(
  workbenchRoot: string,
  record: Pick<PendingTitleWriteRecord, 'runId' | 'batchDir'>,
) {
  await rm(pendingTitleWritePath(workbenchRoot, record.runId, record.batchDir), { force: true })
}

async function readPendingRecord(filePath: string): Promise<PendingTitleWriteRecord> {
  try {
    const parsed = pendingTitleWriteSchema.parse(JSON.parse(await readFile(filePath, 'utf8')))
    return { ...parsed, filePath }
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
