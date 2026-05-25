import { mkdir, mkdtemp, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import type { PhotoshopPrintAsset, PsdTemplate } from '@tengyu-aipod/shared'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { TempFileManager } from '../lib/temp-file-manager'
import { PhotoshopExecutionEngine } from './execution-engine'
import { writePhotoshopJobJsx } from './jsx-generator'
import { PhotoshopMultiBatchRunner, createCompletedJobResult, runBatch } from './multi-batch'
import { PsdScanner } from './psd-scanner'

let tempDir = ''

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), 'tengyu-ps-batch-'))
})

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true })
})

function createTemplate(filePath: string, id: string): PsdTemplate {
  return {
    id,
    file_path: filePath,
    file_hash: id,
    doc_size: { w: 1000, h: 1000 },
    smart_objects: [
      {
        name: 'SO 1',
        path: 'SO 1',
        sort_order: 0,
        is_top_level: true,
        bounds: [0, 0, 100, 100],
        shared_indicator: 'so-1',
      },
    ],
    guides: { horizontal: [], vertical: [] },
    clip_areas: [{ x: 0, y: 0, w: 1000, h: 1000, is_full: true }],
    mode: 'single',
    representative_so_count: 1,
    scanned_at: 123,
    layers: [],
    text_layers: [],
  }
}

function createPrints(): PhotoshopPrintAsset[] {
  return [
    { id: 'img2', file_path: 'C:\\prints\\img2.png' },
    { id: 'img10', file_path: 'C:\\prints\\img10.png' },
  ]
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

describe('PhotoshopMultiBatchRunner', () => {
  it('runs every print group for every template and returns output summary', async () => {
    const scanned: string[] = []
    const executed: string[] = []
    const progress: string[] = []
    const templates = new Map([
      ['C:\\templates\\cup:front?.psd', createTemplate('C:\\templates\\cup:front?.psd', 'tpl-1')],
      ['C:\\templates\\keychain.psd', createTemplate('C:\\templates\\keychain.psd', 'tpl-2')],
    ])

    const result = await runBatch(
      createPrints(),
      [...templates.keys()],
      {
        taskId: 'batch-1',
        outputRoot: 'C:\\Users\\niilo\\Desktop\\新建文件夹',
        format: 'jpg',
        jpgQuality: 10,
      },
      {
        scanner: {
          scanPsd: async (path) => {
            scanned.push(path)
            return templates.get(path) as PsdTemplate
          },
        },
        engine: {
          runJob: async (job) => {
            executed.push(`${job.mockup_path}:${job.so_replacements[0]?.input_image}`)
            return createCompletedJobResult(job.output_paths)
          },
        },
        onProgress: (item) => {
          progress.push(`${item.template_name}:${item.group_index}`)
        },
      },
    )

    expect(scanned).toEqual(['C:\\templates\\cup:front?.psd', 'C:\\templates\\keychain.psd'])
    expect(executed).toHaveLength(4)
    expect(progress).toEqual(['cup_front_:0', 'cup_front_:1', 'keychain:0', 'keychain:1'])
    expect(result).toMatchObject({
      ok: true,
      task_id: 'batch-1',
      templates_total: 2,
      groups_total: 4,
      groups_completed: 4,
    })
    expect(result.outputs[0]).toBe('C:\\Users\\niilo\\Desktop\\新建文件夹/cup_front_/img2/01.jpg')
  })

  it('runs a small real multi-template Photoshop batch when REAL_PS=1', async () => {
    if (process.env.REAL_PS !== '1') {
      return
    }

    const materialRoot = process.env.PS_MATERIAL_ROOT
    const outputRoot = process.env.PS_OUTPUT_ROOT
    expect(materialRoot).toBeTruthy()
    expect(outputRoot).toBeTruthy()

    const materialFiles = (await readdir(materialRoot as string))
      .filter((file) => /\.(png|jpe?g)$/i.test(file))
      .slice(0, 1)
    expect(materialFiles.length).toBe(1)
    const prints = materialFiles.map((file) => ({
      id: basename(file, file.includes('.') ? file.slice(file.lastIndexOf('.')) : undefined),
      file_path: join(materialRoot as string, file),
    }))
    const realOutputRoot = join(outputRoot as string, `__codex_real_ps_multi_batch_${Date.now()}`)
    await mkdir(realOutputRoot, { recursive: true })

    const scanner = new PsdScanner({
      platform: 'win32',
      tempFiles: new TempFileManager({ rootDir: join(tempDir, 'scan-tmp') }),
      cache: createMemoryCache(),
    })
    const engine = new PhotoshopExecutionEngine({
      platform: 'win32',
      recorder: {
        recordRunning: async () => undefined,
        recordCompleted: async () => undefined,
        recordFailed: async () => undefined,
      },
      writeJsx: (job) =>
        writePhotoshopJobJsx(job, {
          tempFiles: new TempFileManager({ rootDir: join(tempDir, 'jsx-tmp') }),
        }),
    })
    const runner = new PhotoshopMultiBatchRunner({ scanner, engine })

    await expect(
      runner.runBatch(prints, ['C:\\Users\\niilo\\Desktop\\钥匙扣x.psd'], {
        taskId: 'real-multi-batch',
        outputRoot: realOutputRoot,
        format: 'jpg',
        jpgQuality: 10,
        maxRetries: 0,
      }),
    ).resolves.toMatchObject({
      ok: true,
      templates_total: 1,
      groups_completed: 1,
    })
  }, 120_000)
})
