import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import type { PhotoshopJob, PsdTemplate } from '@tengyu-aipod/shared'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { TempFileManager } from '../lib/temp-file-manager'
import {
  PhotoshopExecutionEngine,
  SqlitePhotoshopWorkflowStepRecorder,
  createPhotoshopJobSignature,
  shouldSkipJob,
} from './execution-engine'
import { writePhotoshopJobJsx } from './jsx-generator'
import { PsdScanner } from './psd-scanner'

let tempDir = ''

const noopRecorder = {
  recordRunning: async () => undefined,
  recordCompleted: async () => undefined,
  recordFailed: async () => undefined,
}

function createMemoryCache() {
  const templates = new Map<string, PsdTemplate>()
  return {
    findByHash: async (fileHash: string) => templates.get(fileHash) ?? null,
    save: async (template: PsdTemplate) => {
      templates.set(template.file_hash, template)
    },
    list: async () => [...templates.values()],
  }
}

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), 'tengyu-ps-exec-'))
})

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true })
})

function createJob(overrides: Partial<PhotoshopJob> = {}): PhotoshopJob {
  return {
    task_id: 'task-1',
    group_index: 0,
    mockup_path: 'C:\\templates\\mockup.psd',
    so_replacements: [{ layer_path: 'SO 1', input_image: 'C:\\prints\\img1.png' }],
    clip_areas: [{ x: 0, y: 0, w: 100, h: 100, is_full: true }],
    output_paths: [join(tempDir, '01.jpg')],
    format: 'jpg',
    jpg_quality: 10,
    result_file_path: '',
    ...overrides,
  }
}

describe('PhotoshopExecutionEngine', () => {
  it('creates a stable job signature from mockup, sorted replacements, clip mode, and format', () => {
    const left = createJob({
      so_replacements: [
        { layer_path: 'B', input_image: 'C:\\prints\\b.png' },
        { layer_path: 'A', input_image: 'C:\\prints\\a.png' },
      ],
      clip_mode: 'guides',
      format: 'png',
    })
    const right = createJob({
      so_replacements: [
        { layer_path: 'A', input_image: 'C:\\prints\\a.png' },
        { layer_path: 'B', input_image: 'C:\\prints\\b.png' },
      ],
      clip_mode: 'guides',
      format: 'png',
    })

    expect(createPhotoshopJobSignature(left)).toBe(createPhotoshopJobSignature(right))
    expect(createPhotoshopJobSignature({ ...right, clip_mode: 'none' })).not.toBe(
      createPhotoshopJobSignature(right),
    )
  })

  it('rejects non-Windows platforms before touching COM', async () => {
    const engine = new PhotoshopExecutionEngine({ platform: 'darwin' })

    await expect(engine.runJob(createJob())).rejects.toMatchObject({
      code: 'PS_UNSUPPORTED_PLATFORM',
    })
  })

  it('runs JSX through COM and verifies outputs', async () => {
    const resultPath = join(tempDir, 'job-result.json')
    const outputPath = join(tempDir, '01.jpg')
    await writeFile(resultPath, JSON.stringify({ ok: true, outputs: [outputPath] }), 'utf8')
    await writeFile(outputPath, 'fake image', 'utf8')
    const calls: string[] = []

    const engine = new PhotoshopExecutionEngine({
      platform: 'win32',
      writeJsx: async () => ({ jsx_path: join(tempDir, 'job.jsx'), result_file_path: resultPath }),
      comAdapter: {
        runJsxFile: async (path) => {
          calls.push(path)
        },
      },
      recorder: noopRecorder,
    })

    await expect(engine.runJob(createJob({ output_paths: [outputPath] }))).resolves.toMatchObject({
      ok: true,
      outputs: [outputPath],
      attempts: 1,
    })
    expect(calls).toEqual([join(tempDir, 'job.jsx')])
  })

  it('retries retryable output verification failures', async () => {
    const resultPath = join(tempDir, 'job-result.json')
    const outputPath = join(tempDir, '01.jpg')
    await writeFile(resultPath, JSON.stringify({ ok: true }), 'utf8')
    let checks = 0
    const sleeps: number[] = []

    const engine = new PhotoshopExecutionEngine({
      platform: 'win32',
      writeJsx: async () => ({ jsx_path: join(tempDir, 'job.jsx'), result_file_path: resultPath }),
      comAdapter: { runJsxFile: async () => undefined },
      recorder: noopRecorder,
      accessFile: async () => {
        checks += 1
        if (checks === 1) {
          throw new Error('missing')
        }
      },
      sleep: async (ms) => {
        sleeps.push(ms)
      },
    })

    await expect(
      engine.runJob(createJob({ output_paths: [outputPath] }), 1),
    ).resolves.toMatchObject({
      ok: true,
      attempts: 2,
    })
    expect(sleeps).toEqual([1000])
  })

  it('does not retry JSX logic failures', async () => {
    const resultPath = join(tempDir, 'job-result.json')
    await writeFile(resultPath, JSON.stringify({ ok: false, error: 'syntax error' }), 'utf8')

    const engine = new PhotoshopExecutionEngine({
      platform: 'win32',
      writeJsx: async () => ({ jsx_path: join(tempDir, 'job.jsx'), result_file_path: resultPath }),
      comAdapter: { runJsxFile: async () => undefined },
      recorder: noopRecorder,
    })

    await expect(engine.runJob(createJob(), 3)).rejects.toMatchObject({
      code: 'JSX_EXEC_FAILED',
      retryable: false,
    })
  })

  it('records workflow step transitions', async () => {
    const resultPath = join(tempDir, 'job-result.json')
    const outputPath = join(tempDir, '01.jpg')
    await writeFile(resultPath, JSON.stringify({ ok: true }), 'utf8')
    await writeFile(outputPath, 'fake image', 'utf8')
    const events: string[] = []

    const engine = new PhotoshopExecutionEngine({
      platform: 'win32',
      writeJsx: async () => ({ jsx_path: join(tempDir, 'job.jsx'), result_file_path: resultPath }),
      comAdapter: { runJsxFile: async () => undefined },
      recorder: {
        recordRunning: async (_job, attempt) => {
          events.push(`running:${attempt}`)
        },
        recordCompleted: async (_job, attempt) => {
          events.push(`completed:${attempt}`)
        },
        recordFailed: async (_job, attempt) => {
          events.push(`failed:${attempt}`)
        },
      },
    })

    await engine.runJob(createJob({ output_paths: [outputPath] }))

    expect(events).toEqual(['running:0', 'completed:0'])
  })

  it('skips completed jobs before writing JSX or running COM when enabled', async () => {
    const calls: string[] = []
    const engine = new PhotoshopExecutionEngine({
      platform: 'win32',
      shouldSkipJob: async () => true,
      writeJsx: async () => {
        calls.push('write')
        return {
          jsx_path: join(tempDir, 'job.jsx'),
          result_file_path: join(tempDir, 'result.json'),
        }
      },
      comAdapter: {
        runJsxFile: async () => {
          calls.push('com')
        },
      },
      recorder: noopRecorder,
    })

    await expect(engine.runJob(createJob(), 0, { skipCompleted: true })).resolves.toMatchObject({
      ok: true,
      attempts: 0,
      skipped: true,
    })
    expect(calls).toEqual([])
  })

  it('does not skip completed jobs unless the caller enables skipping', async () => {
    const resultPath = join(tempDir, 'job-result.json')
    const outputPath = join(tempDir, '01.jpg')
    await writeFile(resultPath, JSON.stringify({ ok: true }), 'utf8')
    await writeFile(outputPath, 'fake image', 'utf8')
    const calls: string[] = []
    const engine = new PhotoshopExecutionEngine({
      platform: 'win32',
      shouldSkipJob: async () => true,
      writeJsx: async () => ({ jsx_path: join(tempDir, 'job.jsx'), result_file_path: resultPath }),
      comAdapter: {
        runJsxFile: async () => {
          calls.push('com')
        },
      },
      recorder: noopRecorder,
    })

    await expect(engine.runJob(createJob({ output_paths: [outputPath] }))).resolves.toMatchObject({
      ok: true,
      attempts: 1,
    })
    expect(calls).toEqual(['com'])
  })

  it('persists workflow_steps rows through the sqlite recorder', async () => {
    const rows: Array<{ sql: string; params: Record<string, unknown> }> = []
    const db = {
      exec: () => undefined,
      prepare: (sql: string) => ({
        run: (params: Record<string, unknown>) => {
          rows.push({ sql, params })
        },
      }),
    }
    const recorder = new SqlitePhotoshopWorkflowStepRecorder({
      db: db as never,
      hashFile: async () => 'hash-01',
    })
    const job = createJob()

    await recorder.recordRunning(job, 0)
    await recorder.recordCompleted(job, 0, job.output_paths)

    expect(rows[0]?.params).toMatchObject({
      id: 'task-1:photoshop:0',
      task_id: 'task-1',
      module: 'photoshop',
      step: 'group-0',
      status: 'running',
    })
    expect(JSON.parse(String(rows[0]?.params.params_snapshot))).toMatchObject({
      job_signature: createPhotoshopJobSignature(job),
      clip_mode: 'auto',
    })
    expect(rows[1]?.params).toMatchObject({
      id: 'task-1:photoshop:0',
      status: 'completed',
      output_json: JSON.stringify({
        outputs: job.output_paths,
        output_hashes: { [job.output_paths[0] as string]: 'hash-01' },
      }),
    })
    expect(rows[2]?.params).toMatchObject({
      task_id: 'task-1',
      step_id: 'task-1:photoshop:0',
      provider: 'photoshop',
      file_path: job.output_paths[0],
      file_hash: 'hash-01',
    })
  })

  it('returns true from shouldSkipJob only when DB, files, and hashes match', async () => {
    const job = createJob({ output_paths: ['C:\\outputs\\01.jpg'] })
    const rows = [
      {
        params_snapshot: JSON.stringify({
          job_signature: createPhotoshopJobSignature(job),
        }),
      },
    ]
    const artifacts = [{ file_path: 'C:\\outputs\\01.jpg', file_hash: 'hash-01' }]
    const db = {
      prepare: (sql: string) => ({
        all: (...params: unknown[]) => {
          if (sql.includes('FROM workflow_steps')) {
            expect(params).toEqual(['task-1'])
            return rows
          }
          expect(params).toEqual(['C:\\outputs\\01.jpg'])
          return artifacts
        },
      }),
    }

    await expect(
      shouldSkipJob(job, {
        db: db as never,
        accessFile: async () => undefined,
        hashFile: async () => 'hash-01',
      }),
    ).resolves.toBe(true)
    await expect(
      shouldSkipJob(job, {
        db: db as never,
        accessFile: async () => undefined,
        hashFile: async () => 'changed',
      }),
    ).resolves.toBe(false)
    await expect(
      shouldSkipJob(job, {
        db: db as never,
        accessFile: async () => {
          throw new Error('missing')
        },
        hashFile: async () => 'hash-01',
      }),
    ).resolves.toBe(false)
  })

  it('runs a real Photoshop path A job when REAL_PS=1', async () => {
    if (process.env.REAL_PS !== '1' || process.env.REAL_PS_MUTATE !== '1') {
      return
    }

    const psdPath = 'C:\\Users\\niilo\\Desktop\\钥匙扣x.psd'
    const materialRoot = process.env.PS_MATERIAL_ROOT
    const outputRoot = process.env.PS_OUTPUT_ROOT
    expect(materialRoot).toBeTruthy()
    expect(outputRoot).toBeTruthy()

    const materialFiles = await readdir(materialRoot as string)
    const firstMaterial = materialFiles.find((file) => /\.(png|jpe?g)$/i.test(file))
    expect(firstMaterial).toBeTruthy()
    const scanner = new PsdScanner({
      platform: 'win32',
      tempFiles: new TempFileManager({ rootDir: join(tempDir, 'scan-tmp') }),
      cache: createMemoryCache(),
    })
    const template = await scanner.scanPsd(psdPath)
    const smartObject = template.smart_objects[0]
    expect(smartObject).toBeTruthy()

    const realOutputDir = join(outputRoot as string, '__codex_real_ps_execution_engine')
    await mkdir(realOutputDir, { recursive: true })
    const outputPath = join(realOutputDir, `${Date.now()}-${basename(firstMaterial as string)}.jpg`)
    const engine = new PhotoshopExecutionEngine({
      platform: 'win32',
      recorder: noopRecorder,
      writeJsx: (job) =>
        writePhotoshopJobJsx(job, {
          tempFiles: new TempFileManager({ rootDir: tempDir }),
        }),
    })

    await expect(
      engine.runJob({
        task_id: 'real-ps-exec',
        group_index: 0,
        mockup_path: psdPath,
        so_replacements: [
          {
            layer_path: smartObject?.path ?? '',
            input_image: join(materialRoot as string, firstMaterial as string),
          },
        ],
        clip_areas: [{ x: 0, y: 0, w: template.doc_size.w, h: template.doc_size.h, is_full: true }],
        output_paths: [outputPath],
        format: 'jpg',
        jpg_quality: 10,
        result_file_path: '',
      }),
    ).resolves.toMatchObject({ ok: true, outputs: [outputPath] })
  }, 120_000)
})
