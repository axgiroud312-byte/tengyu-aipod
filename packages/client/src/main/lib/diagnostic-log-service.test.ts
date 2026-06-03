import { mkdir, readFile, rm, stat, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  cleanupDiagnosticLogsForTest,
  createDiagnosticLogWriter,
  deleteAllWorkbenchLogFiles,
  sanitizeDiagnosticValue,
} from './diagnostic-log-service'

let workbenchRoot = ''

async function exists(path: string) {
  return stat(path)
    .then(() => true)
    .catch(() => false)
}

async function readJsonl(path: string) {
  const text = await readFile(path, 'utf8')
  return text
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Record<string, unknown>)
}

beforeEach(async () => {
  workbenchRoot = join(tmpdir(), `diagnostic-log-${Date.now()}-${Math.random()}`)
  await mkdir(workbenchRoot, { recursive: true })
})

afterEach(async () => {
  if (workbenchRoot) {
    await rm(workbenchRoot, { recursive: true, force: true })
  }
})

describe('diagnostic log service', () => {
  it('writes serialized jsonl events under module folders', async () => {
    const writer = await createDiagnosticLogWriter({
      module: 'generation',
      taskId: 'task:one',
      workbenchRoot,
      meta: { prompt: 'full prompt' },
    })

    await Promise.all([
      writer.append({ type: 'request', data: { index: 1 } }),
      writer.append({ type: 'response', data: { index: 2 } }),
      writer.append({ type: 'parse_result', data: { index: 3 } }),
    ])

    expect(writer.path).toContain(join('.workbench', 'logs', 'diagnostics', 'generation'))
    expect(writer.path.endsWith('task_one.jsonl')).toBe(true)
    const events = await readJsonl(writer.path)
    expect(events.map((event) => event.type)).toEqual([
      'task_started',
      'request',
      'response',
      'parse_result',
    ])
  })

  it('redacts secrets and image payloads', async () => {
    const dataUrl = `data:image/png;base64,${Buffer.from('image bytes').toString('base64')}`
    const writer = await createDiagnosticLogWriter({
      module: 'detection',
      taskId: 'detect-1',
      workbenchRoot,
      meta: { apiKey: 'sk-secret' },
    })
    await writer.append({
      type: 'request',
      data: {
        authorization: 'Bearer token',
        image: {
          dataUrl,
          base64: Buffer.from('raw image').toString('base64'),
        },
      },
    })

    const text = await readFile(writer.path, 'utf8')
    expect(text).not.toContain('sk-secret')
    expect(text).not.toContain('Bearer token')
    expect(text).not.toContain(dataUrl)
    const events = await readJsonl(writer.path)
    expect(events[0]).toMatchObject({
      data: { apiKey: '[REDACTED]' },
    })
    expect(events[1]).toMatchObject({
      data: {
        authorization: '[REDACTED]',
        image: {
          dataUrl: {
            redacted: 'data-url',
            mime: 'image/png',
          },
          base64: {
            redacted: 'image-payload',
          },
        },
      },
    })
  })

  it('redacts buffers directly', () => {
    expect(sanitizeDiagnosticValue({ imageData: Buffer.from('abc') })).toMatchObject({
      imageData: {
        redacted: 'buffer',
        bytes: 3,
      },
    })
  })

  it('cleans files by age and total size', async () => {
    const root = join(workbenchRoot, '.workbench', 'logs', 'diagnostics', 'title')
    await mkdir(root, { recursive: true })
    const oldFile = join(root, 'old.jsonl')
    const olderKeptFile = join(root, 'older-kept.jsonl')
    const newestFile = join(root, 'newest.jsonl')
    await writeFile(oldFile, 'old')
    await writeFile(olderKeptFile, 'x'.repeat(30))
    await writeFile(newestFile, 'y'.repeat(30))

    const nowSeconds = Date.now() / 1000
    await utimes(oldFile, nowSeconds - 10, nowSeconds - 10)
    await utimes(olderKeptFile, nowSeconds - 3, nowSeconds - 3)
    await utimes(newestFile, nowSeconds - 1, nowSeconds - 1)

    await cleanupDiagnosticLogsForTest(workbenchRoot, {
      retentionMs: 5_000,
      maxBytes: 50,
    })

    expect(await exists(oldFile)).toBe(false)
    expect(await exists(olderKeptFile)).toBe(false)
    expect(await exists(newestFile)).toBe(true)
  })

  it('deletes all workbench log files and recreates the logs directory', async () => {
    const logsRoot = join(workbenchRoot, '.workbench', 'logs')
    const diagnosticFile = join(logsRoot, 'diagnostics', 'generation', 'task.jsonl')
    const mainLog = join(logsRoot, 'main.log')
    const tmpFile = join(workbenchRoot, '.workbench', 'tmp', 'keep.txt')
    await mkdir(join(logsRoot, 'diagnostics', 'generation'), { recursive: true })
    await mkdir(join(workbenchRoot, '.workbench', 'tmp'), { recursive: true })
    await writeFile(diagnosticFile, 'diagnostic')
    await writeFile(mainLog, 'main')
    await writeFile(tmpFile, 'tmp')

    const result = await deleteAllWorkbenchLogFiles(workbenchRoot)

    expect(result).toMatchObject({
      path: logsRoot,
      deletedFiles: 2,
      deletedBytes: 'diagnostic'.length + 'main'.length,
    })
    expect(await exists(logsRoot)).toBe(true)
    expect(await exists(diagnosticFile)).toBe(false)
    expect(await exists(mainLog)).toBe(false)
    expect(await exists(tmpFile)).toBe(true)
  })

  it('lets existing writers recreate their module directory after deleting all logs', async () => {
    const writer = await createDiagnosticLogWriter({
      module: 'generation',
      taskId: 'active-task',
      workbenchRoot,
    })

    await deleteAllWorkbenchLogFiles(workbenchRoot)
    await writer.append({ type: 'response', data: { text: 'after delete' } })

    const events = await readJsonl(writer.path)
    expect(events).toEqual([
      expect.objectContaining({
        type: 'response',
        data: { text: 'after delete' },
      }),
    ])
  })
})
