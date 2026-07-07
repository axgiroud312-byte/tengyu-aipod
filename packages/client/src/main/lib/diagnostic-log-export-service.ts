import { createHash } from 'node:crypto'
import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises'
import { basename, dirname, isAbsolute, join, relative } from 'node:path'
import { promisify } from 'node:util'
import { deflateRaw } from 'node:zlib'
import { AppErrorClass } from '@tengyu-aipod/shared'
import type { SqliteDatabase } from './sqlite'
import { openWorkbenchDatabase, workbenchDatabasePath } from './workbench-db'

const deflateRawAsync = promisify(deflateRaw)

export type DiagnosticLogZipExportInput = {
  workbenchRoot: string
  outputPath: string
  now?: Date
}

export type DiagnosticLogZipExportResult = {
  path: string
  files: number
  bytes: number
}

type ExportEntry = {
  archivePath: string
  filePath?: string
  data?: Buffer
}

type ZipEntry = {
  archivePath: string
  data: Buffer
}

type PipelineRunLogRow = {
  id: string
  name: string
  source_mode: string
  status: string
  created_at: number
  logs_json: string | null
}

type PhotoshopWorkflowStepRow = {
  id: string
  task_id: string
  step: string
  status: string
  attempt: number
  error_json: string | null
  updated_at: number
}

export async function exportDiagnosticLogZip(
  input: DiagnosticLogZipExportInput,
): Promise<DiagnosticLogZipExportResult> {
  if (!input.workbenchRoot.trim()) {
    throw new AppErrorClass('HTTP_4XX', '请先在设置里选择工作区', false)
  }
  if (!input.outputPath.trim()) {
    throw new AppErrorClass('INVALID_INPUT', '日志导出路径不能为空', false)
  }

  const db = openWorkbenchDatabase(workbenchDatabasePath(input.workbenchRoot))
  try {
    const entries: ExportEntry[] = []
    const seenArchivePaths = new Set<string>()
    const logsRoot = join(input.workbenchRoot, '.workbench', 'logs')

    await addDirectoryEntries({
      archiveRoot: 'logs',
      dir: logsRoot,
      entries,
      seenArchivePaths,
    })

    for (const evidenceDir of await collectListingEvidenceDirs(input.workbenchRoot, db)) {
      await addDirectoryEntries({
        archiveRoot: archiveRootForEvidenceDir(input.workbenchRoot, evidenceDir),
        dir: evidenceDir,
        entries,
        seenArchivePaths,
      })
    }

    addDataEntry(entries, seenArchivePaths, {
      archivePath: 'sqlite/pipeline/logs.jsonl',
      data: Buffer.from(exportPipelineLogsJsonl(db), 'utf8'),
    })
    addDataEntry(entries, seenArchivePaths, {
      archivePath: 'sqlite/photoshop/workflow-steps.jsonl',
      data: Buffer.from(exportPhotoshopWorkflowStepsJsonl(db), 'utf8'),
    })

    addDataEntry(entries, seenArchivePaths, {
      archivePath: 'manifest.json',
      data: Buffer.from(
        JSON.stringify(
          {
            version: 1,
            createdAt: (input.now ?? new Date()).toISOString(),
            files: entries.map((entry) => entry.archivePath).sort(),
          },
          null,
          2,
        ),
        'utf8',
      ),
    })

    const zipEntries = await materializeEntries(entries, input.workbenchRoot)
    const zip = await createZipBuffer(zipEntries, input.now ?? new Date())
    await mkdir(dirname(input.outputPath), { recursive: true })
    await writeFile(input.outputPath, zip)

    return {
      path: input.outputPath,
      files: zipEntries.length,
      bytes: zip.byteLength,
    }
  } finally {
    db.close()
  }
}

async function addDirectoryEntries(input: {
  archiveRoot: string
  dir: string
  entries: ExportEntry[]
  seenArchivePaths: Set<string>
}) {
  const files = await listFiles(input.dir)
  for (const file of files) {
    const archivePath = joinArchivePath(input.archiveRoot, relative(input.dir, file))
    addFileEntry(input.entries, input.seenArchivePaths, archivePath, file)
  }
}

async function listFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => [])
  const files: string[] = []
  for (const entry of entries) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) {
      files.push(...(await listFiles(path)))
      continue
    }
    if (entry.isFile()) {
      files.push(path)
    }
  }
  return files
}

async function collectListingEvidenceDirs(workbenchRoot: string, db: SqliteDatabase) {
  const dirs = new Set<string>()
  if (tableExists(db, 'listing_status') && columnExists(db, 'listing_status', 'evidence_dir')) {
    const rows = db
      .prepare(
        `SELECT DISTINCT evidence_dir
         FROM listing_status
         WHERE evidence_dir IS NOT NULL AND evidence_dir <> ''`,
      )
      .all() as Array<{ evidence_dir: string }>
    for (const row of rows) {
      dirs.add(row.evidence_dir)
    }
  }

  for (const dir of await findEvidenceDirs(join(workbenchRoot, '.workbench', 'tmp', 'listing'))) {
    dirs.add(dir)
  }

  const existingDirs: string[] = []
  for (const dir of dirs) {
    const info = await stat(dir).catch(() => null)
    if (info?.isDirectory()) {
      existingDirs.push(dir)
    }
  }
  return existingDirs
}

async function findEvidenceDirs(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => [])
  const dirs: string[] = []
  for (const entry of entries) {
    const path = join(dir, entry.name)
    if (!entry.isDirectory()) {
      continue
    }
    if (entry.name === 'evidence') {
      dirs.push(path)
      continue
    }
    dirs.push(...(await findEvidenceDirs(path)))
  }
  return dirs
}

function archiveRootForEvidenceDir(workbenchRoot: string, evidenceDir: string) {
  const relativeDir = relative(workbenchRoot, evidenceDir)
  if (relativeDir && !relativeDir.startsWith('..') && !isAbsolute(relativeDir)) {
    return normalizeArchivePath(relativeDir)
  }
  return joinArchivePath(
    'listing-evidence',
    `${hashText(evidenceDir)}-${safePathSegment(basename(evidenceDir))}`,
  )
}

function exportPipelineLogsJsonl(db: SqliteDatabase) {
  if (!tableExists(db, 'pipeline_runs')) {
    return ''
  }
  const rows = db
    .prepare(
      `SELECT id, name, source_mode, status, created_at, logs_json
       FROM pipeline_runs
       ORDER BY created_at ASC`,
    )
    .all() as unknown as PipelineRunLogRow[]
  const lines: string[] = []
  for (const row of rows) {
    const logs = parseJsonArray(row.logs_json)
    if (logs.length === 0) {
      lines.push(
        JSON.stringify({
          module: 'pipeline',
          run_id: row.id,
          run_name: row.name,
          source_mode: row.source_mode,
          status: row.status,
          created_at: row.created_at,
          log: null,
        }),
      )
      continue
    }
    for (const log of logs) {
      lines.push(
        JSON.stringify({
          module: 'pipeline',
          run_id: row.id,
          run_name: row.name,
          source_mode: row.source_mode,
          status: row.status,
          created_at: row.created_at,
          log,
        }),
      )
    }
  }
  return lines.length ? `${lines.join('\n')}\n` : ''
}

function exportPhotoshopWorkflowStepsJsonl(db: SqliteDatabase) {
  if (!tableExists(db, 'workflow_steps')) {
    return ''
  }
  const rows = db
    .prepare(
      `SELECT id, task_id, step, status, attempt, error_json, updated_at
       FROM workflow_steps
       WHERE module = 'photoshop'
       ORDER BY updated_at ASC`,
    )
    .all() as unknown as PhotoshopWorkflowStepRow[]
  const lines = rows.map((row) =>
    JSON.stringify({
      module: 'photoshop',
      step_id: row.id,
      task_id: row.task_id,
      step: row.step,
      status: row.status,
      attempt: row.attempt,
      updated_at: row.updated_at,
      error: parseJsonObject(row.error_json),
    }),
  )
  return lines.length ? `${lines.join('\n')}\n` : ''
}

function tableExists(db: SqliteDatabase, table: string) {
  const row = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?")
    .get(table) as { name?: string } | undefined
  return Boolean(row?.name)
}

function columnExists(db: SqliteDatabase, table: string, column: string) {
  const rows = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>
  return rows.some((row) => row.name === column)
}

function addFileEntry(
  entries: ExportEntry[],
  seenArchivePaths: Set<string>,
  archivePath: string,
  filePath: string,
) {
  const normalized = normalizeArchivePath(archivePath)
  if (!normalized || seenArchivePaths.has(normalized)) {
    return
  }
  seenArchivePaths.add(normalized)
  entries.push({ archivePath: normalized, filePath })
}

function addDataEntry(
  entries: ExportEntry[],
  seenArchivePaths: Set<string>,
  entry: { archivePath: string; data: Buffer },
) {
  const normalized = normalizeArchivePath(entry.archivePath)
  if (!normalized || seenArchivePaths.has(normalized)) {
    return
  }
  seenArchivePaths.add(normalized)
  entries.push({ archivePath: normalized, data: entry.data })
}

async function materializeEntries(
  entries: ExportEntry[],
  workbenchRoot: string,
): Promise<ZipEntry[]> {
  const result: ZipEntry[] = []
  for (const entry of entries) {
    const data = entry.data ?? (entry.filePath ? await readFile(entry.filePath) : Buffer.alloc(0))
    result.push({
      archivePath: entry.archivePath,
      data: sanitizeDiagnosticExportEntry(entry.archivePath, data, workbenchRoot),
    })
  }
  return result.sort((left, right) => left.archivePath.localeCompare(right.archivePath))
}

function sanitizeDiagnosticExportEntry(archivePath: string, data: Buffer, workbenchRoot: string) {
  if (!isTextDiagnosticEntry(archivePath)) {
    return data
  }

  const text = data.toString('utf8')
  const sanitized =
    archivePath.endsWith('.jsonl') || archivePath.endsWith('.log')
      ? sanitizeDiagnosticJsonlText(text, workbenchRoot)
      : archivePath.endsWith('.json')
        ? sanitizeDiagnosticJsonText(text, workbenchRoot)
        : redactEmbeddedLocalPaths(text, workbenchRoot)
  return Buffer.from(sanitized, 'utf8')
}

function sanitizeDiagnosticJsonlText(text: string, workbenchRoot: string) {
  return text
    .split(/(\r?\n)/)
    .map((part) => {
      if (part === '\n' || part === '\r\n' || !part.trim()) {
        return part
      }
      try {
        return JSON.stringify(
          sanitizeDiagnosticExportValue(JSON.parse(part) as unknown, workbenchRoot),
        )
      } catch {
        return redactEmbeddedLocalPaths(part, workbenchRoot)
      }
    })
    .join('')
}

function sanitizeDiagnosticJsonText(text: string, workbenchRoot: string) {
  try {
    return JSON.stringify(sanitizeDiagnosticExportValue(JSON.parse(text) as unknown, workbenchRoot))
  } catch {
    return redactEmbeddedLocalPaths(text, workbenchRoot)
  }
}

function sanitizeDiagnosticExportValue(value: unknown, workbenchRoot: string, key = ''): unknown {
  if (isPromptContentKey(key) && typeof value === 'string') {
    return redactedText('prompt', value)
  }
  if (isSkillContentKey(key) && value && typeof value === 'object') {
    return redactSkillValue(value)
  }
  if (typeof value === 'string') {
    if (isLocalPathValue(value, workbenchRoot) || (isLocalPathKey(key) && looksLikePath(value))) {
      return redactedLocalPath(value)
    }
    return redactEmbeddedLocalPaths(value, workbenchRoot)
  }
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeDiagnosticExportValue(item, workbenchRoot, key))
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([entryKey, entryValue]) => [
        entryKey,
        sanitizeDiagnosticExportValue(entryValue, workbenchRoot, entryKey),
      ]),
    )
  }
  return value
}

function redactSkillValue(value: object) {
  const input = value as Record<string, unknown>
  return {
    redacted: 'skill',
    ...(typeof input.id === 'string' ? { id: input.id } : {}),
    ...(typeof input.skill_id === 'string' ? { skill_id: input.skill_id } : {}),
    ...(typeof input.name === 'string' ? { name: input.name } : {}),
    ...(typeof input.version === 'string' ? { version: input.version } : {}),
    ...(typeof input.skill_version === 'string' ? { skill_version: input.skill_version } : {}),
    sha256: hashText(JSON.stringify(value)),
  }
}

function redactedLocalPath(value: string) {
  return {
    redacted: 'local-path',
    name: basename(value),
    sha256: hashText(value),
  }
}

function redactedText(kind: 'prompt', value: string) {
  return {
    redacted: kind,
    chars: value.length,
    sha256: hashText(value),
  }
}

function isTextDiagnosticEntry(archivePath: string) {
  return /\.(jsonl|json|log|txt)$/i.test(archivePath)
}

function isPromptContentKey(key: string) {
  return /(^|_)(prompt|current_prompt|prompt_snapshot)$/i.test(key) || /systemPrompt/i.test(key)
}

function isSkillContentKey(key: string) {
  return /^skill$/i.test(key) || /skill[-_]?content|skillPrompt|skill_prompt/i.test(key)
}

function isLocalPathKey(key: string) {
  return /(^|_)(path|dir|folder|file|outputPath|sourcePath|xlsxPath|diagnosticsLogPath)(_|$)/i.test(
    key,
  )
}

function isLocalPathValue(value: string, workbenchRoot: string) {
  return (
    isAbsolute(value) ||
    value.startsWith('\\\\') ||
    Boolean(workbenchRoot && value.includes(workbenchRoot))
  )
}

function looksLikePath(value: string) {
  return /[\\/]/.test(value)
}

function redactEmbeddedLocalPaths(value: string, workbenchRoot: string) {
  let result = value
  if (workbenchRoot) {
    result = result.replace(
      new RegExp(`${escapeRegExp(workbenchRoot)}[^"'\r\n\t]*`, 'g'),
      '[LOCAL_PATH_REDACTED]',
    )
  }
  return result.replace(/[A-Za-z]:[\\/][^"'\r\n\t]*/g, '[LOCAL_PATH_REDACTED]')
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

async function createZipBuffer(entries: ZipEntry[], now: Date) {
  const localParts: Buffer[] = []
  const centralParts: Buffer[] = []
  let offset = 0

  for (const entry of entries) {
    const name = Buffer.from(entry.archivePath, 'utf8')
    const compressed = await deflateRawAsync(entry.data)
    const crc = crc32(entry.data)
    const { date, time } = toDosDateTime(now)
    const localHeader = Buffer.alloc(30)
    localHeader.writeUInt32LE(0x04034b50, 0)
    localHeader.writeUInt16LE(20, 4)
    localHeader.writeUInt16LE(0x0800, 6)
    localHeader.writeUInt16LE(8, 8)
    localHeader.writeUInt16LE(time, 10)
    localHeader.writeUInt16LE(date, 12)
    localHeader.writeUInt32LE(crc, 14)
    localHeader.writeUInt32LE(compressed.byteLength, 18)
    localHeader.writeUInt32LE(entry.data.byteLength, 22)
    localHeader.writeUInt16LE(name.byteLength, 26)
    localHeader.writeUInt16LE(0, 28)

    localParts.push(localHeader, name, compressed)

    const centralHeader = Buffer.alloc(46)
    centralHeader.writeUInt32LE(0x02014b50, 0)
    centralHeader.writeUInt16LE(20, 4)
    centralHeader.writeUInt16LE(20, 6)
    centralHeader.writeUInt16LE(0x0800, 8)
    centralHeader.writeUInt16LE(8, 10)
    centralHeader.writeUInt16LE(time, 12)
    centralHeader.writeUInt16LE(date, 14)
    centralHeader.writeUInt32LE(crc, 16)
    centralHeader.writeUInt32LE(compressed.byteLength, 20)
    centralHeader.writeUInt32LE(entry.data.byteLength, 24)
    centralHeader.writeUInt16LE(name.byteLength, 28)
    centralHeader.writeUInt16LE(0, 30)
    centralHeader.writeUInt16LE(0, 32)
    centralHeader.writeUInt16LE(0, 34)
    centralHeader.writeUInt16LE(0, 36)
    centralHeader.writeUInt32LE(0, 38)
    centralHeader.writeUInt32LE(offset, 42)
    centralParts.push(centralHeader, name)

    offset += localHeader.byteLength + name.byteLength + compressed.byteLength
  }

  const localBuffer = Buffer.concat(localParts)
  const centralBuffer = Buffer.concat(centralParts)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(0, 4)
  end.writeUInt16LE(0, 6)
  end.writeUInt16LE(entries.length, 8)
  end.writeUInt16LE(entries.length, 10)
  end.writeUInt32LE(centralBuffer.byteLength, 12)
  end.writeUInt32LE(localBuffer.byteLength, 16)
  end.writeUInt16LE(0, 20)

  return Buffer.concat([localBuffer, centralBuffer, end])
}

const CRC32_TABLE = new Uint32Array(
  Array.from({ length: 256 }, (_unused, index) => {
    let value = index
    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1
    }
    return value >>> 0
  }),
)

function crc32(buffer: Buffer) {
  let crc = 0xffffffff
  for (const byte of buffer) {
    crc = (CRC32_TABLE[(crc ^ byte) & 0xff] ?? 0) ^ (crc >>> 8)
  }
  return (crc ^ 0xffffffff) >>> 0
}

function toDosDateTime(date: Date) {
  const year = Math.max(1980, date.getFullYear())
  return {
    time: (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2),
    date: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
  }
}

function parseJsonArray(value: string | null): unknown[] {
  if (!value) {
    return []
  }
  try {
    const parsed = JSON.parse(value) as unknown
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function parseJsonObject(value: string | null): unknown {
  if (!value) {
    return null
  }
  try {
    return JSON.parse(value) as unknown
  } catch {
    return { parse_error: true, raw: value }
  }
}

function normalizeArchivePath(path: string) {
  return path.replace(/\\/g, '/').replace(/^\/+/, '')
}

function joinArchivePath(...parts: string[]) {
  return normalizeArchivePath(parts.filter(Boolean).join('/'))
}

function hashText(value: string) {
  return createHash('sha256').update(value).digest('hex').slice(0, 12)
}

function safePathSegment(value: string) {
  return (value || 'evidence').replace(/[\\/:*?"<>|]/g, '_')
}
