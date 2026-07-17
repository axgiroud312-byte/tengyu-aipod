import { mkdir, mkdtemp, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import type {
  PhotoshopPrintAsset,
  PhotoshopProgressInfo,
  PhotoshopProgressLogEntry,
  PsdTemplate,
} from '@tengyu-aipod/shared'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { TempFileManager } from '../lib/temp-file-manager'
import { PhotoshopExecutionEngine } from './execution-engine'
import { writePhotoshopJobJsx, writePhotoshopTemplateBatchJsx } from './jsx-generator'
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
    native_slices: [],
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
    const skipFlags: Array<boolean | undefined> = []
    const progress: string[] = []
    const logStages: string[] = []
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
          runJob: async (job, _maxRetries, options) => {
            executed.push(`${job.mockup_path}:${job.so_replacements[0]?.input_image}`)
            skipFlags.push(options?.skipCompleted)
            return createCompletedJobResult(job.output_paths)
          },
        },
        onProgress: (item) => {
          progress.push(`${item.current_stage}:${item.template_name}:${item.group_index}`)
        },
        progressLogger: {
          write: (entry) => {
            logStages.push(entry.stage)
          },
        },
      },
    )

    expect(scanned).toEqual(['C:\\templates\\cup:front?.psd', 'C:\\templates\\keychain.psd'])
    expect(executed).toHaveLength(4)
    expect(skipFlags).toEqual([true, true, true, true])
    expect(progress).toEqual([
      'task_start:undefined:undefined',
      'task_start:cup_front_:0',
      'group_complete:cup_front_:0',
      'task_start:cup_front_:1',
      'group_complete:cup_front_:1',
      'task_start:keychain:0',
      'group_complete:keychain:0',
      'task_start:keychain:1',
      'group_complete:keychain:1',
      'task_complete:undefined:undefined',
    ])
    expect(logStages).toContain('task_start')
    expect(logStages).toContain('jsx_generate')
    expect(logStages).toContain('jsx_exec')
    expect(logStages).toContain('output_verify')
    expect(logStages).toContain('group_complete')
    expect(result).toMatchObject({
      ok: true,
      task_id: 'batch-1',
      templates_total: 2,
      groups_total: 4,
      groups_completed: 4,
    })
    expect(result.outputs[0]).toBe('C:\\Users\\niilo\\Desktop\\新建文件夹/cup_front_/img2/01.jpg')
  })

  it('applies the requested clipping mode before creating Photoshop jobs', async () => {
    const template = createTemplate('C:\\templates\\guide-template.psd', 'tpl-guides')
    template.guides = { horizontal: [500], vertical: [250, 750] }

    const executedClipCounts: number[] = []
    await runBatch(
      createPrints().slice(0, 1),
      [template.file_path],
      {
        taskId: 'batch-guides',
        outputRoot: 'C:\\Users\\niilo\\Desktop\\新建文件夹',
        clipMode: 'guides',
      },
      {
        scanner: {
          scanPsd: async () => template,
        },
        engine: {
          runJob: async (job) => {
            executedClipCounts.push(job.clip_areas.length)
            return createCompletedJobResult(job.output_paths)
          },
        },
        progressLogger: null,
      },
    )

    expect(executedClipCounts).toEqual([6])
  })

  it('can disable skip completed when running Photoshop jobs', async () => {
    const template = createTemplate('C:\\templates\\template.psd', 'tpl-1')
    const skipFlags: Array<boolean | undefined> = []

    await runBatch(
      createPrints().slice(0, 1),
      [template.file_path],
      {
        taskId: 'batch-no-skip',
        outputRoot: 'C:\\Users\\niilo\\Desktop\\新建文件夹',
        skipCompleted: false,
      },
      {
        scanner: {
          scanPsd: async () => template,
        },
        engine: {
          runJob: async (job, _maxRetries, options) => {
            skipFlags.push(options?.skipCompleted)
            return createCompletedJobResult(job.output_paths)
          },
        },
        progressLogger: null,
      },
    )

    expect(skipFlags).toEqual([false])
  })

  it('uses the full group total before the first multi-template progress event', async () => {
    const templates = new Map([
      ['C:\\templates\\cup.psd', createTemplate('C:\\templates\\cup.psd', 'tpl-cup')],
      ['C:\\templates\\shirt.psd', createTemplate('C:\\templates\\shirt.psd', 'tpl-shirt')],
    ])
    const progressTotals: number[] = []

    await runBatch(
      createPrints(),
      [...templates.keys()],
      {
        taskId: 'batch-stable-total',
        outputRoot: 'C:\\Users\\niilo\\Desktop\\新建文件夹',
      },
      {
        scanner: {
          scanPsd: async (path) => templates.get(path) as PsdTemplate,
        },
        engine: {
          runJob: async (job) => createCompletedJobResult(job.output_paths),
        },
        onProgress: (item) => {
          progressTotals.push(item.total_groups)
        },
        progressLogger: null,
      },
    )

    expect(progressTotals).not.toHaveLength(0)
    expect(progressTotals[0]).toBe(0)
    expect(new Set(progressTotals.slice(1))).toEqual(new Set([4]))
  })

  it('uses template-level execution when the engine supports it', async () => {
    const template = createTemplate('C:\\templates\\template.psd', 'tpl-1')
    const templateBatchCalls: string[] = []
    const perGroupCalls: string[] = []

    const result = await runBatch(
      createPrints(),
      [template.file_path],
      {
        taskId: 'batch-template-level',
        outputRoot: 'C:\\Users\\niilo\\Desktop\\新建文件夹',
        outputLayout: 'sku_first',
      },
      {
        scanner: {
          scanPsd: async () => template,
        },
        engine: {
          runTemplateBatch: async (_template, groups) => {
            templateBatchCalls.push(groups.map((group) => group.sku_folder).join(','))
            return {
              ok: true,
              outputs: groups.flatMap((group) => group.job.output_paths),
              groups: groups.map((group) => ({
                group_index: group.group_index,
                sku_folder: group.sku_folder,
                outputs: group.job.output_paths,
                skipped: false,
              })),
            }
          },
          runJob: async (job) => {
            perGroupCalls.push(job.mockup_path)
            return createCompletedJobResult(job.output_paths)
          },
        },
        progressLogger: null,
      },
    )

    expect(templateBatchCalls).toEqual(['img2,img10'])
    expect(perGroupCalls).toEqual([])
    expect(result.output_layout).toBe('sku_first')
    expect(result.result_groups).toEqual([
      {
        template_id: 'tpl-1',
        template_name: 'template',
        group_index: 0,
        sku_folder: 'img2',
        print_ids: ['img2'],
        outputs: ['C:\\Users\\niilo\\Desktop\\新建文件夹/img2/template/01.jpg'],
        status: 'completed',
      },
      {
        template_id: 'tpl-1',
        template_name: 'template',
        group_index: 1,
        sku_folder: 'img10',
        print_ids: ['img10'],
        outputs: ['C:\\Users\\niilo\\Desktop\\新建文件夹/img10/template/01.jpg'],
        status: 'completed',
      },
    ])
  })

  it('selects native slice export and preserves output naming at the runner boundary', async () => {
    const template = createTemplate('C:\\templates\\native.psd', 'tpl-native')
    template.native_slices = [
      { name: 'Front', kind: 'user', bounds: [0, 0, 500, 1000] },
      { name: 'Back', kind: 'layer', bounds: [500, 0, 1000, 1000] },
    ]
    const logs: PhotoshopProgressLogEntry[] = []
    const outputPaths: string[][] = []

    const result = await runBatch(
      createPrints().slice(0, 1),
      [template.file_path],
      {
        taskId: 'batch-native',
        outputRoot: 'C:\\outputs',
      },
      {
        scanner: { scanPsd: async () => template },
        engine: {
          runTemplateBatch: async (_template, groups) => {
            outputPaths.push(...groups.map((group) => group.job.output_paths))
            return {
              ok: true,
              outputs: groups.flatMap((group) => group.job.output_paths),
              groups: groups.map((group) => ({
                group_index: group.group_index,
                sku_folder: group.sku_folder,
                outputs: group.job.output_paths,
              })),
            }
          },
          runJob: async (job) => createCompletedJobResult(job.output_paths),
        },
        onLog: (entry) => {
          logs.push(entry)
        },
        progressLogger: null,
      },
    )

    expect(outputPaths).toEqual([
      ['C:\\outputs/native/img2/01.jpg', 'C:\\outputs/native/img2/02.jpg'],
    ])
    expect(logs).toContainEqual(
      expect.objectContaining({ stage: 'native_slice_detected', template_name: 'native' }),
    )
    expect(logs).not.toContainEqual(expect.objectContaining({ stage: 'native_slice_fallback' }))
    expect(result.outputs).toEqual(outputPaths[0])
  })

  it('logs one compatibility fallback when a template has no native slices', async () => {
    const template = createTemplate('C:\\templates\\legacy.psd', 'tpl-legacy')
    const logs: PhotoshopProgressLogEntry[] = []

    await runBatch(
      createPrints(),
      [template.file_path],
      { taskId: 'batch-legacy', outputRoot: 'C:\\outputs' },
      {
        scanner: { scanPsd: async () => template },
        engine: {
          runTemplateBatch: async (_template, groups) => ({
            ok: true,
            outputs: groups.flatMap((group) => group.job.output_paths),
            groups: groups.map((group) => ({
              group_index: group.group_index,
              sku_folder: group.sku_folder,
              outputs: group.job.output_paths,
            })),
          }),
          runJob: async (job) => createCompletedJobResult(job.output_paths),
        },
        onLog: (entry) => {
          logs.push(entry)
        },
        progressLogger: null,
      },
    )

    expect(logs.filter((entry) => entry.stage === 'native_slice_fallback')).toEqual([
      expect.objectContaining({
        message: '将使用旧模式裁切导出，速度会慢一些',
        template_name: 'legacy',
      }),
    ])
  })

  it('emits template-level progress as group_complete logs arrive', async () => {
    const template = createTemplate('C:\\templates\\template.psd', 'tpl-1')
    const progress: Array<{
      stage: string
      group: number | undefined
      completed: number
      verifiedOutputs: number
      resultGroupSku?: string | undefined
      resultGroupOutputs?: string[] | undefined
    }> = []
    let completedProgressBeforeReturn = 0

    await runBatch(
      createPrints(),
      [template.file_path],
      {
        taskId: 'batch-template-progress',
        outputRoot: 'C:\\Users\\niilo\\Desktop\\新建文件夹',
      },
      {
        scanner: {
          scanPsd: async () => template,
        },
        engine: {
          runTemplateBatch: async (_template, groups, _maxRetries, options) => {
            const firstGroup = groups[0]
            if (!firstGroup) {
              throw new Error('expected at least one Photoshop group')
            }
            await options.onLog?.({
              ts: Date.now(),
              level: 'info',
              stage: 'group_complete',
              group: firstGroup.group_index,
            })
            completedProgressBeforeReturn = progress.filter(
              (item) => item.stage === 'group_complete',
            ).length
            return {
              ok: true,
              outputs: groups.flatMap((group) => group.job.output_paths),
              groups: groups.map((group) => ({
                group_index: group.group_index,
                sku_folder: group.sku_folder,
                outputs: group.job.output_paths,
                skipped: false,
              })),
            }
          },
          runJob: async (job) => createCompletedJobResult(job.output_paths),
        },
        onProgress: (item) => {
          progress.push({
            stage: item.current_stage,
            group: item.group_index,
            completed: item.completed,
            verifiedOutputs: item.verified_outputs,
            resultGroupSku: item.result_group?.sku_folder,
            resultGroupOutputs: item.result_group?.outputs,
          })
        },
        progressLogger: null,
      },
    )

    expect(completedProgressBeforeReturn).toBe(1)
    expect(
      progress.find((item) => item.group === 0 && item.stage === 'group_complete'),
    ).toMatchObject({
      resultGroupSku: 'img2',
      resultGroupOutputs: ['C:\\Users\\niilo\\Desktop\\新建文件夹/template/img2/01.jpg'],
    })
    expect(
      progress.filter((item) => item.stage === 'group_complete').map((item) => item.group),
    ).toEqual([0, 1])
    expect(progress.at(-1)).toMatchObject({
      stage: 'task_complete',
      completed: 2,
      verifiedOutputs: 2,
    })
  })

  it('keeps cancelled template-level previews limited to completed groups', async () => {
    const template = createTemplate('C:\\templates\\template.psd', 'tpl-1')
    const progressStages: string[] = []

    const result = await runBatch(
      createPrints(),
      [template.file_path],
      {
        taskId: 'batch-cancelled',
        outputRoot: 'C:\\Users\\niilo\\Desktop\\新建文件夹',
        outputLayout: 'sku_first',
      },
      {
        scanner: {
          scanPsd: async () => template,
        },
        engine: {
          runTemplateBatch: async (_template, groups) => ({
            ok: false,
            cancelled: true,
            outputs: groups[0]?.job.output_paths ?? [],
            groups: groups[0]
              ? [
                  {
                    group_index: groups[0].group_index,
                    sku_folder: groups[0].sku_folder,
                    outputs: groups[0].job.output_paths,
                  },
                ]
              : [],
          }),
          runJob: async (job) => createCompletedJobResult(job.output_paths),
        },
        onProgress: (item) => {
          progressStages.push(item.current_stage)
        },
        progressLogger: null,
      },
    )

    expect(result).toMatchObject({
      ok: false,
      cancelled: true,
      groups_completed: 1,
    })
    expect(result.result_groups).toEqual([
      {
        template_id: 'tpl-1',
        template_name: 'template',
        group_index: 0,
        sku_folder: 'img2',
        print_ids: ['img2'],
        outputs: ['C:\\Users\\niilo\\Desktop\\新建文件夹/img2/template/01.jpg'],
        status: 'completed',
      },
    ])
    expect(progressStages.filter((stage) => stage === 'cancelled')).toHaveLength(1)
  })

  it('emits an existing public error log when a running batch fails', async () => {
    const template = createTemplate('C:\\templates\\template.psd', 'tpl-error')
    const logs: PhotoshopProgressLogEntry[] = []

    await expect(
      runBatch(
        createPrints(),
        [template.file_path],
        {
          taskId: 'batch-failed',
          outputRoot: 'C:\\Users\\niilo\\Desktop\\failed-output',
        },
        {
          scanner: { scanPsd: async () => template },
          engine: {
            runTemplateBatch: async () => {
              throw new Error('Photoshop execution failed')
            },
            runJob: async (job) => createCompletedJobResult(job.output_paths),
          },
          onLog: (entry) => {
            logs.push(entry)
          },
          progressLogger: null,
        },
      ),
    ).rejects.toThrow('Photoshop execution failed')

    expect(logs.at(-1)).toMatchObject({
      task_id: 'batch-failed',
      level: 'error',
      stage: 'group_complete',
      message: 'Photoshop execution failed',
    })
  })

  it('publishes task activity and failure when template scanning fails', async () => {
    const logs: PhotoshopProgressLogEntry[] = []
    const progress: PhotoshopProgressInfo[] = []

    await expect(
      runBatch(
        createPrints(),
        ['C:\\templates\\broken.psd'],
        {
          taskId: 'batch-scan-failed',
          outputRoot: 'C:\\Users\\niilo\\Desktop\\failed-output',
        },
        {
          scanner: {
            scanPsd: async () => {
              throw new Error('PSD scan failed')
            },
          },
          onProgress: (entry) => {
            progress.push(entry)
          },
          onLog: (entry) => {
            logs.push(entry)
          },
          progressLogger: null,
        },
      ),
    ).rejects.toThrow('PSD scan failed')

    expect(progress[0]).toMatchObject({
      task_id: 'batch-scan-failed',
      current_stage: 'task_start',
      total_groups: 0,
    })
    expect(logs.at(-1)).toMatchObject({
      task_id: 'batch-scan-failed',
      level: 'error',
      message: 'PSD scan failed',
    })
  })

  it('compares native-slice and legacy export with a real PSD when REAL_PS=1', async () => {
    if (process.env.REAL_PS !== '1' || process.env.REAL_PS_MUTATE !== '1') {
      return
    }

    const materialRoot = process.env.PS_MATERIAL_ROOT
    const outputRoot = process.env.PS_OUTPUT_ROOT
    const psdPath = process.env.PS_PSD_PATH
    expect(materialRoot).toBeTruthy()
    expect(outputRoot).toBeTruthy()
    expect(psdPath).toBeTruthy()

    const materialFiles = (await readdir(materialRoot as string))
      .filter((file) => /\.(png|jpe?g)$/i.test(file))
      .slice(0, 3)
    expect(materialFiles.length).toBeGreaterThan(0)
    const prints = materialFiles.map((file) => ({
      id: basename(file, file.includes('.') ? file.slice(file.lastIndexOf('.')) : undefined),
      file_path: join(materialRoot as string, file),
    }))
    const realOutputRoot = join(outputRoot as string, `__codex_real_ps_native_slice_${Date.now()}`)
    await mkdir(realOutputRoot, { recursive: true })

    const scanner = new PsdScanner({
      platform: 'win32',
      tempFiles: new TempFileManager({ rootDir: join(tempDir, 'scan-tmp') }),
      cache: createMemoryCache(),
    })
    const template = await scanner.scanPsd(psdPath as string)
    expect(template.native_slices.length).toBeGreaterThan(0)
    const legacyTemplate: PsdTemplate = {
      ...template,
      native_slices: [],
      clip_areas: template.native_slices.map((slice) => ({
        x: slice.bounds[0],
        y: slice.bounds[1],
        w: slice.bounds[2] - slice.bounds[0],
        h: slice.bounds[3] - slice.bounds[1],
        is_full: false,
      })),
    }
    const createEngine = (tempName: string) =>
      new PhotoshopExecutionEngine({
        platform: 'win32',
        shouldSkipJob: async () => false,
        recorder: {
          recordRunning: async () => undefined,
          recordCompleted: async () => undefined,
          recordFailed: async () => undefined,
        },
        writeJsx: (job) =>
          writePhotoshopJobJsx(job, {
            tempFiles: new TempFileManager({ rootDir: join(tempDir, tempName) }),
          }),
        writeTemplateBatchJsx: (nextTemplate, groups, cancelFilePath) =>
          writePhotoshopTemplateBatchJsx(
            {
              task_id: groups[0]?.job.task_id ?? tempName,
              mockup_path: nextTemplate.file_path,
              template_name: groups[0]?.template_name ?? 'template',
              native_slices: nextTemplate.native_slices,
              cancel_file_path: cancelFilePath,
              groups: groups.map((group) => ({
                group_index: group.group_index,
                sku_folder: group.sku_folder,
                so_replacements: group.job.so_replacements,
                clip_areas: group.job.clip_areas,
                output_paths: group.job.output_paths,
                format: group.job.format,
                jpg_quality: group.job.jpg_quality,
              })),
            },
            { tempFiles: new TempFileManager({ rootDir: join(tempDir, tempName) }) },
          ),
      })
    const runRealBatch = async (nextTemplate: PsdTemplate, mode: 'legacy' | 'native') => {
      const runner = new PhotoshopMultiBatchRunner({
        scanner: { scanPsd: async () => nextTemplate },
        engine: createEngine(`${mode}-jsx-tmp`),
        progressLogger: null,
      })
      const startedAt = performance.now()
      const result = await runner.runBatch(prints, [nextTemplate.file_path], {
        taskId: `real-${mode}`,
        outputRoot: join(realOutputRoot, mode),
        format: 'jpg',
        jpgQuality: 10,
        maxRetries: 0,
      })
      return { result, durationMs: performance.now() - startedAt }
    }

    const legacy = await runRealBatch(legacyTemplate, 'legacy')
    const native = await runRealBatch(template, 'native')

    expect(native.result.outputs).toHaveLength(legacy.result.outputs.length)
    expect(native.result.outputs.map((path) => basename(path))).toEqual(
      legacy.result.outputs.map((path) => basename(path)),
    )
    expect(native.durationMs).toBeLessThan(legacy.durationMs)
  }, 600_000)
})
