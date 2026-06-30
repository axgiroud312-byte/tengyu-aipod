import { createHash, randomUUID } from 'node:crypto'
import { appendFile, mkdir, readFile, readdir, rm, stat } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { AppErrorClass } from '@tengyu-aipod/shared'
import { readAppConfig } from './workbench-config'

export type DiagnosticModule = 'generation' | 'video' | 'detection' | 'title'

export type DiagnosticLogEvent = {
  type: string
  provider?: string
  operation?: string
  itemKey?: string
  attempt?: number
  data?: unknown
  error?: unknown
}

export type DiagnosticLogWriter = {
  path: string
  runId: string
  append: (event: DiagnosticLogEvent) => Promise<void>
}

export type DiagnosticLogWriterInput = {
  module: DiagnosticModule
  taskId?: string
  runId?: string
  workbenchRoot: string
  meta?: Record<string, unknown>
}

export type DiagnosticCleanupOptions = {
  retentionMs?: number
  maxBytes?: number
}

const DIAGNOSTIC_RETENTION_MS = 7 * 24 * 60 * 60 * 1000
const DIAGNOSTIC_MAX_BYTES = 1024 * 1024 * 1024
const DIAGNOSTIC_CLEANUP_INTERVAL_MS = 24 * 60 * 60 * 1000

export async function createDiagnosticLogWriter(
  input: DiagnosticLogWriterInput,
): Promise<DiagnosticLogWriter> {
  const runId = safePathSegment(input.runId ?? input.taskId ?? diagnosticRunId(input.module))
  const logDir = join(input.workbenchRoot, '.workbench', 'logs', 'diagnostics', input.module)
  const logPath = join(logDir, `${runId}.jsonl`)
  await mkdir(logDir, { recursive: true })

  let appendQueue = Promise.resolve()
  const writer: DiagnosticLogWriter = {
    path: logPath,
    runId,
    append: (event) => {
      const sanitizedEvent = sanitizeDiagnosticValue(event) as Record<string, unknown>
      const line = `${JSON.stringify({
        ts: new Date().toISOString(),
        module: input.module,
        runId,
        ...(input.taskId ? { taskId: input.taskId } : {}),
        ...sanitizedEvent,
      })}\n`
      appendQueue = appendQueue.then(async () => {
        await mkdir(logDir, { recursive: true })
        await appendFile(logPath, line, 'utf8')
      })
      return appendQueue
    },
  }

  await writer.append({
    type: 'task_started',
    data: {
      ...(input.meta ?? {}),
      diagnosticsLogPath: logPath,
    },
  })
  return writer
}

export async function createOptionalDiagnosticLogWriter(
  input: Omit<DiagnosticLogWriterInput, 'workbenchRoot'> & { workbenchRoot?: string | undefined },
): Promise<DiagnosticLogWriter | null> {
  if (!input.workbenchRoot) {
    return null
  }
  return createDiagnosticLogWriter({
    ...input,
    workbenchRoot: input.workbenchRoot,
  })
}

export function diagnosticRunId(module: DiagnosticModule) {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
  return `${module}_${timestamp}_${randomUUID().slice(0, 8)}`
}

export async function cleanupDiagnosticLogs(workbenchRoot?: string | undefined) {
  const root = workbenchRoot ?? (await readAppConfig()).workbench_root
  if (!root) {
    return
  }
  await cleanupDiagnosticLogsAtRoot(root)
}

export async function deleteAllWorkbenchLogFiles(workbenchRoot?: string | undefined) {
  const root = workbenchRoot ?? (await readAppConfig()).workbench_root
  if (!root) {
    throw new AppErrorClass('HTTP_4XX', '请先选择工作区', false)
  }
  const logsRoot = join(root, '.workbench', 'logs')
  const files = await listLogFiles(logsRoot)
  const deletedBytes = files.reduce((sum, file) => sum + file.size, 0)
  await rm(logsRoot, { recursive: true, force: true })
  await mkdir(logsRoot, { recursive: true })
  return {
    path: logsRoot,
    deletedFiles: files.length,
    deletedBytes,
  }
}

export async function cleanupDiagnosticLogsForTest(
  workbenchRoot: string,
  options: Required<DiagnosticCleanupOptions>,
) {
  await cleanupDiagnosticLogsAtRoot(workbenchRoot, options)
}

async function cleanupDiagnosticLogsAtRoot(root: string, options: DiagnosticCleanupOptions = {}) {
  const diagnosticsRoot = join(root, '.workbench', 'logs', 'diagnostics')
  const files = await listDiagnosticFiles(diagnosticsRoot)
  const now = Date.now()
  const retentionMs = options.retentionMs ?? DIAGNOSTIC_RETENTION_MS
  const maxBytes = options.maxBytes ?? DIAGNOSTIC_MAX_BYTES
  const kept: Array<{ path: string; mtimeMs: number; size: number }> = []

  for (const file of files) {
    if (now - file.mtimeMs > retentionMs) {
      await rm(file.path, { force: true }).catch(() => null)
      continue
    }
    kept.push(file)
  }

  let totalBytes = kept.reduce((sum, item) => sum + item.size, 0)
  for (const file of kept.sort((left, right) => left.mtimeMs - right.mtimeMs)) {
    if (totalBytes <= maxBytes) {
      break
    }
    await rm(file.path, { force: true }).catch(() => null)
    totalBytes -= file.size
  }
}

export function startDiagnosticLogCleanupTimer() {
  const timer = setInterval(() => {
    void cleanupDiagnosticLogs().catch(() => null)
  }, DIAGNOSTIC_CLEANUP_INTERVAL_MS)
  return timer
}

export async function fileDiagnosticMetadata(path: string) {
  const [info, hash] = await Promise.all([
    stat(path),
    readFile(path)
      .then((buffer) => createHash('sha256').update(buffer).digest('hex'))
      .catch(() => null),
  ])
  return {
    path,
    name: basename(path),
    bytes: info.size,
    sha256: hash,
  }
}

export function errorForDiagnosticLog(error: unknown) {
  if (error instanceof AppErrorClass) {
    return {
      name: 'AppError',
      code: error.code,
      message: error.message,
      retryable: error.retryable,
      details: sanitizeDiagnosticValue(error.details ?? null),
      stack: stackPreview(error),
    }
  }
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: stackPreview(error),
    }
  }
  return {
    message: String(error),
  }
}

export function sanitizeDiagnosticValue(value: unknown, key = ''): unknown {
  if (isSecretKey(key)) {
    return '[REDACTED]'
  }
  if (typeof value === 'string') {
    if (isImagePayloadKey(key) || value.startsWith('data:')) {
      return imagePayloadMetadata(value)
    }
    return value
  }
  if (Buffer.isBuffer(value)) {
    return {
      redacted: 'buffer',
      bytes: value.byteLength,
      sha256: createHash('sha256').update(value).digest('hex'),
    }
  }
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeDiagnosticValue(item, key))
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([entryKey, entryValue]) => [
        entryKey,
        sanitizeDiagnosticValue(entryValue, entryKey),
      ]),
    )
  }
  return value
}

async function listDiagnosticFiles(root: string) {
  const result: Array<{ path: string; mtimeMs: number; size: number }> = []
  await walkDiagnosticFiles(root, result)
  return result
}

async function listLogFiles(root: string) {
  const result: Array<{ path: string; size: number }> = []
  await walkLogFiles(root, result)
  return result
}

async function walkLogFiles(dir: string, result: Array<{ path: string; size: number }>) {
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => [])
  for (const entry of entries) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) {
      await walkLogFiles(path, result)
      continue
    }
    if (!entry.isFile()) {
      continue
    }
    const info = await stat(path).catch(() => null)
    if (info) {
      result.push({ path, size: info.size })
    }
  }
}

async function walkDiagnosticFiles(
  dir: string,
  result: Array<{ path: string; mtimeMs: number; size: number }>,
) {
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => [])
  for (const entry of entries) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) {
      await walkDiagnosticFiles(path, result)
      continue
    }
    if (!entry.isFile() || !entry.name.endsWith('.jsonl')) {
      continue
    }
    const info = await stat(path).catch(() => null)
    if (info) {
      result.push({ path, mtimeMs: info.mtimeMs, size: info.size })
    }
  }
}

function imagePayloadMetadata(value: string) {
  const parsed = parseDataUrl(value)
  if (parsed) {
    return parsed
  }
  return {
    redacted: 'image-payload',
    length: value.length,
    sha256: createHash('sha256').update(value).digest('hex'),
  }
}

function parseDataUrl(value: string) {
  const match = value.match(/^data:([^;,]+)?(;base64)?,(.*)$/s)
  if (!match) {
    return null
  }
  const mime = match[1] || null
  const isBase64 = Boolean(match[2])
  const payload = match[3] ?? ''
  const bytes = isBase64 ? Buffer.from(payload, 'base64') : Buffer.from(payload)
  return {
    redacted: 'data-url',
    mime,
    encoding: isBase64 ? 'base64' : 'text',
    length: value.length,
    bytes: bytes.byteLength,
    sha256: createHash('sha256').update(bytes).digest('hex'),
  }
}

function safePathSegment(value: string) {
  return (value || 'diagnostic').replace(/[\\/:*?"<>|]/g, '_')
}

function isSecretKey(key: string) {
  return /api[-_]?key|authorization|password|secret|token/i.test(key)
}

function isImagePayloadKey(key: string) {
  return /base64|b64|dataUrl|data_url|imageData|image_data/i.test(key)
}

function stackPreview(error: Error) {
  return error.stack?.split('\n').slice(0, 6).join('\n') ?? null
}
