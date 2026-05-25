import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import type { PhotoshopJob, PsdTemplate } from '@tengyu-aipod/shared'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { TempFileManager } from '../lib/temp-file-manager'
import { PhotoshopExecutionEngine, SqlitePhotoshopWorkflowStepRecorder } from './execution-engine'
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
    expect(rows[1]?.params).toMatchObject({
      id: 'task-1:photoshop:0',
      status: 'completed',
      output_json: JSON.stringify({ outputs: job.output_paths }),
    })
  })

  it('runs a real Photoshop path A job when REAL_PS=1', async () => {
    if (process.env.REAL_PS !== '1') {
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
