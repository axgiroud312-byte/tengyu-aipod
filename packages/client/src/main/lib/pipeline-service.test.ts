import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import {
  type PhotoshopPrintAsset,
  type PipelineProgress,
  type PipelineResultSection,
  type PipelineRunConfig,
  WORKBENCH_DIRECTORIES,
} from '@tengyu-aipod/shared'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { collectionFolderLock } from './collection-folder-lock'
import type {
  GenerationProgress,
  GenerationRunImage,
  GenerationRunResult,
} from './generation-service'
import { PipelineService, registerPipelineIpc } from './pipeline-service'
import type { TitleBatchResult } from './title-service'

const originalPlatform = Object.getOwnPropertyDescriptor(process, 'platform')

type GenerationBatchDependencies = {
  emitProgress?: (progress: GenerationProgress) => void
}

type Txt2imgMockInput = {
  capability?: 'txt2img' | 'img2img'
  prompts: string[]
  taskId?: string
}

const mocks = vi.hoisted(() => ({
  workbenchRoot: '',
  ipcHandlers: new Map<string, (...args: unknown[]) => unknown>(),
  sentEvents: [] as Array<{ channel: string; payload: unknown }>,
  runBatch: vi.fn(
    async (
      prints: PhotoshopPrintAsset[],
      _templates: unknown,
      config: {
        taskId: string
        outputRoot: string
        outputLayout: 'template_first' | 'sku_first'
      },
    ) => {
      const printId = prints[0]?.id ?? 'print'
      const outputPath = join(config.outputRoot, 'shirt', printId, '01.jpg')
      return {
        ok: true,
        task_id: config.taskId,
        output_layout: config.outputLayout,
        templates_total: 1,
        groups_total: 1,
        groups_completed: 1,
        outputs: [outputPath],
        templates: [
          {
            template_id: 'tpl-shirt',
            template_name: 'shirt',
            groups_total: 1,
            groups_completed: 1,
            outputs: [outputPath],
          },
        ],
        result_groups: [
          {
            template_id: 'tpl-shirt',
            template_name: 'shirt',
            group_index: 0,
            sku_folder: printId,
            print_ids: [printId],
            outputs: [outputPath],
          },
        ],
      }
    },
  ),
  runTitleBatch: vi.fn(
    async (input: {
      batchDir: string
      taskId: string
      titleFileName?: string
    }): Promise<TitleBatchResult> => ({
      taskId: input.taskId,
      xlsxPath: join(input.batchDir, `${input.titleFileName ?? '标题'}.xlsx`),
      total: 1,
      succeeded: 1,
      failed: 0,
      skipped: 0,
      results: [
        {
          skuCode: 'pri_existing',
          status: 'success' as const,
          title: 'Generated title',
          imagePath: join(input.batchDir, 'pri_existing', '01.jpg'),
        },
      ],
    }),
  ),
  createTaskDir: vi.fn(async (module: string, taskId: string) => {
    const taskDir = join(mocks.workbenchRoot, '.workbench', 'tmp', module, taskId)
    await mkdir(taskDir, { recursive: true })
    return taskDir
  }),
  cleanupTask: vi.fn(async () => undefined),
  runTxt2imgBatch: vi.fn(
    async (
      input: Txt2imgMockInput,
      _dependencies?: GenerationBatchDependencies,
    ): Promise<GenerationRunResult> => ({
      taskId: 'txt2img-task',
      total: 1,
      succeeded: 1,
      failed: 0,
      images: [
        {
          prompt: input.prompts[0] ?? 'new print',
          url: 'file://generated.png',
          localPath: join(mocks.workbenchRoot, 'generated.png'),
        },
      ],
      failures: [],
    }),
  ),
  runExtractBatch: vi.fn(async (input: { sourceImagePaths: string[]; taskId: string }) => ({
    taskId: input.taskId,
    capability: 'extract' as const,
    total: input.sourceImagePaths.length,
    succeeded: input.sourceImagePaths.length,
    failed: 0,
    images: input.sourceImagePaths.map((sourcePath, index) => ({
      prompt: 'extract print',
      url: `file://extracted-${index + 1}.png`,
      localPath: sourcePath,
    })),
    failures: [],
  })),
  runComfyuiMattingBatch: vi.fn(async (input: { sourceImagePaths: string[]; taskId: string }) => ({
    taskId: input.taskId,
    capability: 'matting' as const,
    total: input.sourceImagePaths.length,
    succeeded: input.sourceImagePaths.length,
    failed: 0,
    images: input.sourceImagePaths.map((sourcePath, index) => ({
      prompt: 'matting print',
      url: `file://matted-${index + 1}.png`,
      localPath: join(dirname(sourcePath), `matted-${index + 1}.png`),
    })),
    failures: [],
  })),
  runDetectionBatch: vi.fn(),
}))

vi.mock('electron', () => ({
  BrowserWindow: {
    getAllWindows: () => [
      {
        webContents: {
          send: (channel: string, payload: unknown) => {
            mocks.sentEvents.push({ channel, payload })
          },
        },
      },
    ],
  },
  ipcMain: {
    handle: (channel: string, handler: (...args: unknown[]) => unknown) => {
      mocks.ipcHandlers.set(channel, handler)
    },
  },
}))

vi.mock('../onboarding', () => ({
  readAppConfig: () => ({ workbench_root: mocks.workbenchRoot }),
}))

vi.mock('../photoshop/multi-batch', () => ({
  runBatch: mocks.runBatch,
}))

vi.mock('./title-service', () => ({
  titleService: {
    runTitleBatch: mocks.runTitleBatch,
    cancelTask: vi.fn(),
  },
}))

vi.mock('./temp-file-manager', () => ({
  tempFileManager: {
    createTaskDir: mocks.createTaskDir,
    cleanupTask: mocks.cleanupTask,
  },
}))

vi.mock('./detection-service', () => ({
  detectionService: {
    runDetectionBatch: mocks.runDetectionBatch,
    cancelTask: vi.fn(),
  },
}))

vi.mock('./generation-service', () => ({
  generateTxt2imgPrompts: vi.fn(),
  runComfyuiExtractBatch: vi.fn(),
  runComfyuiMattingBatch: mocks.runComfyuiMattingBatch,
  runExtractBatch: mocks.runExtractBatch,
  runMixedMattingBatch: vi.fn(),
  runTxt2imgBatch: mocks.runTxt2imgBatch,
}))

function setPlatform(value: NodeJS.Platform) {
  Object.defineProperty(process, 'platform', {
    configurable: true,
    enumerable: true,
    value,
  })
}

async function createPrint(path: string) {
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, 'image')
}

function createPhotoshopBatchResult(
  prints: PhotoshopPrintAsset[],
  config: {
    taskId: string
    outputRoot: string
    outputLayout: 'template_first' | 'sku_first'
  },
) {
  const printId = prints[0]?.id ?? 'print'
  const outputPath = join(config.outputRoot, 'shirt', printId, '01.jpg')
  return {
    ok: true,
    task_id: config.taskId,
    output_layout: config.outputLayout,
    templates_total: 1,
    groups_total: 1,
    groups_completed: 1,
    outputs: [outputPath],
    templates: [
      {
        template_id: 'tpl-shirt',
        template_name: 'shirt',
        groups_total: 1,
        groups_completed: 1,
        outputs: [outputPath],
      },
    ],
    result_groups: [
      {
        template_id: 'tpl-shirt',
        template_name: 'shirt',
        group_index: 0,
        sku_folder: printId,
        print_ids: [printId],
        outputs: [outputPath],
      },
    ],
  }
}

function progressEvents() {
  return mocks.sentEvents
    .filter((event) => event.channel === 'pipeline:progress')
    .map((event) => event.payload as PipelineProgress)
}

function imageProcessingSections() {
  return progressEvents()
    .map((event) => event.result_sections?.find((section) => section.key === 'image_processing'))
    .filter((section): section is PipelineResultSection => Boolean(section))
}

function imageProcessingSection(detail: Awaited<ReturnType<PipelineService['getRun']>>) {
  return detail?.result_sections?.find((section) => section.key === 'image_processing')
}

function baseConfig(printFolder: string): PipelineRunConfig {
  return {
    name: '完整任务测试',
    printSkuCode: 'TY-BASE',
    printMode: 'local',
    source: {
      mode: 'existing_prints',
      printFolder,
    },
    matting: {
      enabled: false,
      mode: 'comfyui',
    },
    detection: {
      enabled: false,
    },
    photoshop: {
      enabled: true,
      templates: ['C:\\templates\\shirt.psd'],
      replaceRange: 'auto',
      format: 'jpg',
      clipMode: 'auto',
      skipCompleted: true,
      maxRetries: 1,
    },
    title: {
      enabled: true,
      platform: 'temu',
      language: 'en',
      model: 'qwen3.6-flash',
      titleFileName: '标题',
      existingStrategy: 'skip',
    },
  }
}

describe('PipelineService', () => {
  beforeEach(async () => {
    setPlatform('win32')
    mocks.workbenchRoot = await mkdtemp(join(tmpdir(), 'tengyu-pipeline-service-'))
    mocks.ipcHandlers.clear()
    mocks.runBatch.mockClear()
    mocks.runTitleBatch.mockClear()
    mocks.createTaskDir.mockClear()
    mocks.cleanupTask.mockClear()
    mocks.runTxt2imgBatch.mockClear()
    mocks.runExtractBatch.mockClear()
    mocks.runComfyuiMattingBatch.mockClear()
    mocks.runDetectionBatch.mockReset()
    mocks.sentEvents = []
  })

  afterEach(async () => {
    if (originalPlatform) {
      Object.defineProperty(process, 'platform', originalPlatform)
    }
    await rm(mocks.workbenchRoot, { recursive: true, force: true })
    collectionFolderLock.clearForTests()
    mocks.workbenchRoot = ''
  })

  it('writes default Photoshop output to the listing workspace so template batches stay first-level', async () => {
    const printFolder = join(mocks.workbenchRoot, WORKBENCH_DIRECTORIES.generation, 'ready')
    await createPrint(join(printFolder, 'existing.png'))

    const service = new PipelineService()
    const result = await service.runPipeline('run-default-output', baseConfig(printFolder))

    expect(result.run.status).toBe('completed')
    expect(mocks.runBatch).toHaveBeenCalledOnce()
    expect(mocks.runBatch.mock.calls[0]?.[2]).toMatchObject({
      outputRoot: join(mocks.workbenchRoot, WORKBENCH_DIRECTORIES.listing),
      outputLayout: 'template_first',
    })
    expect(mocks.runTitleBatch).toHaveBeenCalledWith(
      expect.objectContaining({
        batchDir: join(mocks.workbenchRoot, WORKBENCH_DIRECTORIES.listing, 'shirt'),
      }),
    )
  })

  it('cleans the Photoshop temp task directory after a successful Photoshop step', async () => {
    const printFolder = join(mocks.workbenchRoot, WORKBENCH_DIRECTORIES.generation, 'ready')
    await createPrint(join(printFolder, 'existing.png'))

    const service = new PipelineService()
    await service.runPipeline('run-clean-photoshop-temp', baseConfig(printFolder))

    expect(mocks.createTaskDir).toHaveBeenCalledWith(
      'photoshop',
      'run-clean-photoshop-temp-photoshop',
    )
    expect(mocks.cleanupTask).toHaveBeenCalledWith(
      'photoshop',
      'run-clean-photoshop-temp-photoshop',
    )
  })

  it('keeps failed Photoshop temp task directories on the delayed cleanup path', async () => {
    const printFolder = join(mocks.workbenchRoot, WORKBENCH_DIRECTORIES.generation, 'ready')
    await createPrint(join(printFolder, 'existing.png'))
    mocks.runBatch.mockRejectedValueOnce(new Error('Photoshop failed'))

    const service = new PipelineService()
    await expect(
      service.runPipeline('run-failed-photoshop-temp', baseConfig(printFolder)),
    ).rejects.toThrow('Photoshop failed')

    expect(mocks.createTaskDir).toHaveBeenCalledWith(
      'photoshop',
      'run-failed-photoshop-temp-photoshop',
    )
    expect(mocks.cleanupTask).toHaveBeenCalledWith(
      'photoshop',
      'run-failed-photoshop-temp-photoshop',
      { keepIfFailed: true },
    )
  })

  it('keeps a custom Photoshop output root when the user explicitly selects one', async () => {
    const printFolder = join(mocks.workbenchRoot, WORKBENCH_DIRECTORIES.generation, 'ready')
    const outputRoot = join(mocks.workbenchRoot, WORKBENCH_DIRECTORIES.listing, '自定义批次根')
    await createPrint(join(printFolder, 'existing.png'))

    const service = new PipelineService()
    await service.runPipeline('run-custom-output', {
      ...baseConfig(printFolder),
      photoshop: {
        ...baseConfig(printFolder).photoshop,
        outputRoot,
      },
    })

    expect(mocks.runBatch.mock.calls[0]?.[2]).toMatchObject({ outputRoot })
    expect(mocks.runTitleBatch).toHaveBeenCalledWith(
      expect.objectContaining({
        batchDir: join(outputRoot, 'shirt'),
      }),
    )
  })

  it('rejects a custom Photoshop output root outside the workbench when enabled is omitted', async () => {
    const printFolder = join(mocks.workbenchRoot, WORKBENCH_DIRECTORIES.generation, 'ready')
    await createPrint(join(printFolder, 'existing.png'))
    const config = baseConfig(printFolder)
    const { enabled: _enabled, ...photoshopWithoutEnabled } = config.photoshop

    const service = new PipelineService()
    await expect(
      service.runPipeline('run-custom-output-outside', {
        ...config,
        photoshop: {
          ...photoshopWithoutEnabled,
          outputRoot: join(dirname(mocks.workbenchRoot), 'outside-listing'),
        },
      }),
    ).rejects.toMatchObject({
      code: 'HTTP_4XX',
      message: '完整任务套版输出目录必须位于工作区允许目录内',
    })
    expect(mocks.runBatch).not.toHaveBeenCalled()
  })

  it('uses the print sku code for the waiting Photoshop print filename and sku folder id', async () => {
    const printFolder = join(mocks.workbenchRoot, WORKBENCH_DIRECTORIES.generation, 'ready')
    await createPrint(join(printFolder, 'existing.png'))

    const service = new PipelineService()
    await service.runPipeline('run-print-sku', {
      ...baseConfig(printFolder),
      printSkuCode: 'TY-001',
    })

    const waitingPrintPath = join(
      mocks.workbenchRoot,
      WORKBENCH_DIRECTORIES.generation,
      '等待套版',
      'run-print-sku',
      'TY-001.png',
    )
    await expect(readFile(waitingPrintPath, 'utf8')).resolves.toBe('image')
    expect(mocks.runBatch.mock.calls[0]?.[0]).toEqual([
      {
        id: 'TY-001',
        file_path: waitingPrintPath,
      },
    ])
    await expect(mocks.runBatch.mock.results[0]?.value).resolves.toMatchObject({
      outputs: [
        join(mocks.workbenchRoot, WORKBENCH_DIRECTORIES.listing, 'shirt', 'TY-001', '01.jpg'),
      ],
      result_groups: [expect.objectContaining({ sku_folder: 'TY-001' })],
    })
  })

  it('rejects Photoshop runs without a print sku code before starting work', async () => {
    const printFolder = join(mocks.workbenchRoot, WORKBENCH_DIRECTORIES.generation, 'ready')
    await createPrint(join(printFolder, 'existing.png'))
    const config = (({ printSkuCode: _printSkuCode, ...rest }) => rest)(baseConfig(printFolder))

    const service = new PipelineService()
    await expect(service.runPipeline('run-missing-print-sku', config)).rejects.toThrow(
      '完整任务参数无效',
    )
    expect(mocks.runBatch).not.toHaveBeenCalled()
  })

  it('rejects Photoshop runs without PSD templates before starting work', async () => {
    const printFolder = join(mocks.workbenchRoot, WORKBENCH_DIRECTORIES.generation, 'ready')
    await createPrint(join(printFolder, 'existing.png'))

    const service = new PipelineService()
    await expect(
      service.runPipeline('run-missing-templates', {
        ...baseConfig(printFolder),
        photoshop: {
          ...baseConfig(printFolder).photoshop,
          templates: [],
        },
      }),
    ).rejects.toThrow('完整任务参数无效')
    expect(mocks.runBatch).not.toHaveBeenCalled()
  })

  it('rejects concurrent Photoshop runs with the same print sku code', async () => {
    const printFolder = join(mocks.workbenchRoot, WORKBENCH_DIRECTORIES.generation, 'ready')
    await createPrint(join(printFolder, 'existing.png'))

    let resolvePhotoshop: (() => void) | undefined
    mocks.runBatch.mockImplementationOnce(
      async (
        prints: PhotoshopPrintAsset[],
        _templates: unknown,
        config: {
          taskId: string
          outputRoot: string
          outputLayout: 'template_first' | 'sku_first'
        },
      ) => {
        await new Promise<void>((resolve) => {
          resolvePhotoshop = resolve
        })
        return createPhotoshopBatchResult(prints, config)
      },
    )

    const service = new PipelineService()
    const config = {
      ...baseConfig(printFolder),
      printSkuCode: 'TY-LOCK',
    }
    const firstRun = service.runPipeline('run-lock-1', config)
    await vi.waitUntil(() => mocks.runBatch.mock.calls.length === 1)

    await expect(service.runPipeline('run-lock-2', config)).rejects.toThrow('已有进行中完整任务')

    resolvePhotoshop?.()
    await expect(firstRun).resolves.toMatchObject({
      run: expect.objectContaining({ status: 'completed' }),
    })
  })

  it('queues concurrent Photoshop runs with different print sku codes', async () => {
    const printFolder = join(mocks.workbenchRoot, WORKBENCH_DIRECTORIES.generation, 'ready')
    await createPrint(join(printFolder, 'existing.png'))

    let resolvePhotoshop: (() => void) | undefined
    mocks.runBatch.mockImplementation(
      async (
        prints: PhotoshopPrintAsset[],
        _templates: unknown,
        config: {
          taskId: string
          outputRoot: string
          outputLayout: 'template_first' | 'sku_first'
        },
      ) => {
        if (config.taskId === 'run-ps-lock-1-photoshop') {
          await new Promise<void>((resolve) => {
            resolvePhotoshop = resolve
          })
        }
        return createPhotoshopBatchResult(prints, config)
      },
    )

    const service = new PipelineService()
    const firstRun = service.runPipeline('run-ps-lock-1', {
      ...baseConfig(printFolder),
      printSkuCode: 'TY-LOCK-A',
    })
    await vi.waitUntil(() => mocks.runBatch.mock.calls.length === 1)

    const secondRun = service.runPipeline('run-ps-lock-2', {
      ...baseConfig(printFolder),
      printSkuCode: 'TY-LOCK-B',
    })
    await new Promise((resolve) => setTimeout(resolve, 20))

    expect(mocks.runBatch).toHaveBeenCalledTimes(1)
    resolvePhotoshop?.()
    await vi.waitUntil(() => mocks.runBatch.mock.calls.length === 2)
    await expect(Promise.all([firstRun, secondRun])).resolves.toHaveLength(2)
  })

  it('completes the title step when every title batch is skipped', async () => {
    const printFolder = join(mocks.workbenchRoot, WORKBENCH_DIRECTORIES.generation, 'ready')
    await createPrint(join(printFolder, 'existing.png'))
    mocks.runTitleBatch.mockResolvedValueOnce({
      taskId: 'run-title-skipped-title-1',
      xlsxPath: join(mocks.workbenchRoot, WORKBENCH_DIRECTORIES.listing, 'shirt', '标题.xlsx'),
      total: 1,
      succeeded: 0,
      failed: 0,
      skipped: 1,
      results: [
        {
          skuCode: 'TY-BASE',
          status: 'skipped' as const,
          title: 'Existing title',
        },
      ],
    })

    const service = new PipelineService()
    const result = await service.runPipeline('run-title-skipped', baseConfig(printFolder))

    expect(result.run.status).toBe('completed')
    expect(result.steps.find((step) => step.step_key === 'title')).toMatchObject({
      status: 'completed',
      output_count: 1,
    })
  })

  it('can complete before Photoshop and title when those stages are disabled', async () => {
    const printFolder = join(mocks.workbenchRoot, WORKBENCH_DIRECTORIES.generation, 'ready')
    await createPrint(join(printFolder, 'existing.png'))

    const service = new PipelineService()
    const result = await service.runPipeline('run-source-only', {
      ...baseConfig(printFolder),
      photoshop: {
        ...baseConfig(printFolder).photoshop,
        enabled: false,
        templates: [],
      },
      title: {
        ...baseConfig(printFolder).title,
        enabled: false,
      },
    })

    expect(result.run.status).toBe('completed')
    expect(mocks.runBatch).not.toHaveBeenCalled()
    expect(mocks.runTitleBatch).not.toHaveBeenCalled()
    expect(result.steps.map((step) => [step.step_key, step.status])).toEqual([
      ['source', 'completed'],
      ['matting', 'skipped'],
      ['detection', 'skipped'],
      ['photoshop', 'skipped'],
      ['title', 'skipped'],
    ])
  })

  it('rejects collection source folders outside the collection workspace', async () => {
    const outsideSource = join(mocks.workbenchRoot, 'outside-source')
    await createPrint(join(outsideSource, 'source.png'))

    const service = new PipelineService()

    await expect(
      service.runPipeline('run-outside-collection-source', {
        ...baseConfig('/unused'),
        source: {
          mode: 'collection',
          sourceFolder: outsideSource,
          extract: {
            provider: 'grsai',
            skillId: 'extract-skill',
            grsai: {
              model: 'gpt-image-2',
              aspectRatio: '1:1',
            },
          },
        },
        photoshop: {
          ...baseConfig('/unused').photoshop,
          enabled: false,
          templates: [],
        },
        title: {
          ...baseConfig('/unused').title,
          enabled: false,
        },
      }),
    ).rejects.toMatchObject({
      code: 'HTTP_4XX',
      details: { kind: 'path_outside_workbench' },
    })

    await expect(service.getRun('run-outside-collection-source')).resolves.toBeNull()
  })

  it('holds a collection folder read lock until the complete task finishes', async () => {
    const sourceFolder = join(
      mocks.workbenchRoot,
      WORKBENCH_DIRECTORIES.collection,
      'temu-20260531-120000',
    )
    await createPrint(join(sourceFolder, 'source.png'))
    let finishExtract: (() => void) | undefined
    mocks.runExtractBatch.mockImplementationOnce(
      async (input: { sourceImagePaths: string[]; taskId: string }) => {
        expect(() => collectionFolderLock.assertWritable(sourceFolder)).toThrow(
          '完整任务正在读取该采集目录',
        )
        await new Promise<void>((resolve) => {
          finishExtract = resolve
        })
        return {
          taskId: input.taskId,
          capability: 'extract' as const,
          total: input.sourceImagePaths.length,
          succeeded: input.sourceImagePaths.length,
          failed: 0,
          failures: [],
          images: input.sourceImagePaths.map((sourcePath, index) => ({
            prompt: 'extract print',
            url: `file://extracted-${index + 1}.png`,
            localPath: sourcePath,
          })),
        }
      },
    )

    const service = new PipelineService()
    const run = service.runPipeline('run-collection-read-lock', {
      ...baseConfig('/unused'),
      source: {
        mode: 'collection',
        sourceFolder,
        extract: {
          provider: 'grsai',
          skillId: 'extract-skill',
          grsai: {
            model: 'gpt-image-2',
            aspectRatio: '1:1',
          },
        },
      },
      photoshop: {
        ...baseConfig('/unused').photoshop,
        enabled: false,
        templates: [],
      },
      title: {
        ...baseConfig('/unused').title,
        enabled: false,
      },
    })
    await vi.waitUntil(() => mocks.runExtractBatch.mock.calls.length === 1)

    expect(() => collectionFolderLock.assertWritable(sourceFolder)).toThrow(
      '完整任务正在读取该采集目录',
    )

    finishExtract?.()
    await expect(run).resolves.toMatchObject({
      run: expect.objectContaining({ status: 'completed' }),
    })
    expect(() => collectionFolderLock.assertWritable(sourceFolder)).not.toThrow()
  })

  it('marks the active step as cancelled when a complete task is cancelled mid-step', async () => {
    const printFolder = join(mocks.workbenchRoot, WORKBENCH_DIRECTORIES.generation, 'ready')
    await createPrint(join(printFolder, 'existing.png'))
    let finishDetection: (() => void) | undefined
    mocks.runDetectionBatch.mockImplementationOnce(async () => {
      await new Promise<void>((resolve) => {
        finishDetection = resolve
      })
      return {
        taskId: 'run-cancel-detection-detection',
        total: 1,
        succeeded: 1,
        failed: 0,
        skipped: 0,
        results: [
          {
            imagePath: join(printFolder, 'existing.png'),
            thumbnailUrl: '',
            artifactId: 'art-cancel',
            printId: 'pri-cancel',
            status: 'success' as const,
            riskScore: 10,
            riskLevel: 'pass' as const,
            reason: '低风险',
            outputPath: join(mocks.workbenchRoot, 'cancel-output.png'),
            cached: false,
          },
        ],
      }
    })

    const service = new PipelineService()
    const run = service.runPipeline('run-cancel-detection', {
      ...baseConfig(printFolder),
      detection: {
        enabled: true,
        skillId: 'infringement-v2',
        model: 'qwen3.6-flash',
      },
      photoshop: {
        ...baseConfig(printFolder).photoshop,
        enabled: false,
        templates: [],
      },
      title: {
        ...baseConfig(printFolder).title,
        enabled: false,
      },
    })
    await vi.waitUntil(() => mocks.runDetectionBatch.mock.calls.length === 1)

    expect(service.cancelRun('run-cancel-detection')).toBe(true)
    finishDetection?.()
    await expect(run).rejects.toThrow('完整任务已取消')

    const detail = await service.getRun('run-cancel-detection')
    expect(detail?.run.status).toBe('cancelled')
    expect(detail?.steps.find((step) => step.step_key === 'detection')?.status).toBe('cancelled')
    const progressEvents = mocks.sentEvents.filter((event) => event.channel === 'pipeline:progress')
    const lastProgress = progressEvents.at(-1)?.payload as
      | { logs?: Array<{ message: string }> }
      | undefined
    expect(lastProgress?.logs?.some((log) => log.message === '侵权检测已取消')).toBe(true)
  })

  it('completes a detection-only run when every print is blocked', async () => {
    const printFolder = join(mocks.workbenchRoot, WORKBENCH_DIRECTORIES.generation, 'ready')
    const printPath = join(printFolder, 'existing.png')
    await createPrint(printPath)
    mocks.runDetectionBatch.mockResolvedValueOnce({
      taskId: 'run-detection-only-blocked-detection',
      total: 1,
      succeeded: 1,
      failed: 0,
      skipped: 0,
      results: [
        {
          imagePath: printPath,
          thumbnailUrl: '',
          artifactId: 'art-blocked',
          printId: 'pri-blocked',
          status: 'success' as const,
          riskScore: 98,
          riskLevel: 'block' as const,
          reason: '高风险',
          outputPath: printPath,
          cached: false,
        },
      ],
    })

    const service = new PipelineService()
    const result = await service.runPipeline('run-detection-only-blocked', {
      ...baseConfig(printFolder),
      detection: {
        enabled: true,
        skillId: 'infringement-v2',
        model: 'qwen3.6-flash',
        allowReview: false,
      },
      photoshop: {
        ...baseConfig(printFolder).photoshop,
        enabled: false,
        templates: [],
      },
      title: {
        ...baseConfig(printFolder).title,
        enabled: false,
      },
    })

    expect(result.run.status).toBe('completed')
    expect(mocks.runBatch).not.toHaveBeenCalled()
    expect(result.steps.find((step) => step.step_key === 'detection')).toMatchObject({
      status: 'completed',
      output_count: 0,
    })
    expect(
      (result.result_sections ?? []).find((section) => section.key === 'detection_blocked'),
    ).toEqual(
      expect.objectContaining({
        items: [expect.objectContaining({ artifact_id: 'art-blocked' })],
      }),
    )
  })

  it('persists uploaded img2img references outside business workspaces and keeps base64 out of the run config', async () => {
    const service = new PipelineService()
    const base64 = Buffer.from('reference-image').toString('base64')
    const result = await service.runPipeline('run-img2img-upload', {
      ...baseConfig('/unused'),
      source: {
        mode: 'img2img',
        provider: 'grsai',
        referenceImages: [{ name: 'dog shirt.png', base64, mime_type: 'image/png' }],
        prompt: { mode: 'manual', prompts: ['make a new dog shirt'] },
        sendReferenceImages: true,
        grsai: {
          model: 'gpt-image-2',
          aspectRatio: '1024x1024',
        },
      },
      photoshop: {
        ...baseConfig('/unused').photoshop,
        enabled: false,
        templates: [],
      },
      title: {
        ...baseConfig('/unused').title,
        enabled: false,
      },
    })

    const referenceFolder = join(
      mocks.workbenchRoot,
      WORKBENCH_DIRECTORIES.metadata,
      'pipeline-runs',
      'run-img2img-upload',
      'references',
    )
    const savedFiles = await readdir(referenceFolder)
    expect(savedFiles).toEqual(['01-dog shirt.png'])
    await expect(readFile(join(referenceFolder, savedFiles[0] ?? ''), 'utf8')).resolves.toBe(
      'reference-image',
    )
    const savedConfig = JSON.parse(result.run.config_json) as PipelineRunConfig
    expect(savedConfig.source).toMatchObject({
      mode: 'img2img',
      referenceImagePaths: [join(referenceFolder, '01-dog shirt.png')],
    })
    expect(JSON.stringify(savedConfig)).not.toContain(base64)
    expect(mocks.runTxt2imgBatch).toHaveBeenCalledWith(
      expect.objectContaining({
        capability: 'img2img',
        referenceImages: [{ base64, mime_type: 'image/png' }],
      }),
      expect.anything(),
    )
  })

  it('keeps uploaded img2img references out of the image model request when disabled', async () => {
    const service = new PipelineService()
    const base64 = Buffer.from('reference-image').toString('base64')
    await service.runPipeline('run-img2img-reference-disabled', {
      ...baseConfig('/unused'),
      source: {
        mode: 'img2img',
        provider: 'grsai',
        referenceImages: [{ name: 'reference.png', base64, mime_type: 'image/png' }],
        prompt: { mode: 'manual', prompts: ['make a new floral print'] },
        sendReferenceImages: false,
        grsai: {
          model: 'gpt-image-2',
          aspectRatio: '1024x1024',
        },
      },
      photoshop: {
        ...baseConfig('/unused').photoshop,
        enabled: false,
        templates: [],
      },
      title: {
        ...baseConfig('/unused').title,
        enabled: false,
      },
    })

    const generationInput = mocks.runTxt2imgBatch.mock.calls[0]?.[0] as
      | { capability?: string; referenceImages?: unknown[] }
      | undefined
    expect(generationInput).toMatchObject({ capability: 'img2img' })
    expect(generationInput?.referenceImages).toBeUndefined()
  })

  it('allows manual img2img without references when image model references are disabled', async () => {
    const service = new PipelineService()
    const result = await service.runPipeline('run-img2img-no-reference', {
      ...baseConfig('/unused'),
      source: {
        mode: 'img2img',
        provider: 'grsai',
        prompt: { mode: 'manual', prompts: ['make a new geometric print'] },
        sendReferenceImages: false,
        grsai: {
          model: 'gpt-image-2',
          aspectRatio: '1024x1024',
        },
      },
      photoshop: {
        ...baseConfig('/unused').photoshop,
        enabled: false,
        templates: [],
      },
      title: {
        ...baseConfig('/unused').title,
        enabled: false,
      },
    })

    expect(result.run.status).toBe('completed')
    expect(mocks.runTxt2imgBatch.mock.calls[0]?.[0]).toMatchObject({
      capability: 'img2img',
      prompts: ['make a new geometric print'],
    })
  })

  it('emits staged result sections and runtime logs for a complete task', async () => {
    const printFolder = join(mocks.workbenchRoot, WORKBENCH_DIRECTORIES.generation, 'ready')
    await createPrint(join(printFolder, 'existing.png'))

    const service = new PipelineService()
    await service.runPipeline('run-result-sections', {
      ...baseConfig(printFolder),
      photoshop: {
        ...baseConfig(printFolder).photoshop,
        enabled: false,
        templates: [],
      },
      title: {
        ...baseConfig(printFolder).title,
        enabled: false,
      },
    })

    const lastProgress = progressEvents().at(-1)

    expect(
      lastProgress?.result_sections?.find((section) => section.key === 'image_processing'),
    ).toMatchObject({
      total: 1,
      completed: 1,
      items: [
        expect.objectContaining({
          status: 'success',
          local_path: expect.stringContaining('existing.png'),
        }),
      ],
    })
    expect(lastProgress?.result_sections?.some((section) => section.key === 'print_products')).toBe(
      false,
    )
    expect(lastProgress?.logs?.map((entry) => entry.message)).toContain('完整任务完成')

    const detail = await service.getRun('run-result-sections')
    expect(imageProcessingSection(detail)).toMatchObject({
      total: 1,
      completed: 1,
      items: [expect.objectContaining({ local_path: expect.stringContaining('existing.png') })],
    })
    expect(detail?.logs?.map((entry) => entry.message)).toContain('完整任务完成')
  })

  it('creates expected loading slots, replaces successes in completion order, and hides failures', async () => {
    const prompts = Array.from({ length: 100 }, (_item, index) => `prompt ${index + 1}`)
    const completedImages: GenerationRunImage[] = [
      {
        prompt: 'prompt 42',
        url: 'file://done-42.png',
        localPath: join(mocks.workbenchRoot, 'done-42.png'),
      },
      {
        prompt: 'prompt 7',
        url: 'file://done-7.png',
        localPath: join(mocks.workbenchRoot, 'done-7.png'),
      },
    ]
    mocks.runTxt2imgBatch.mockImplementationOnce(
      async (input: Txt2imgMockInput, dependencies?: GenerationBatchDependencies) => {
        expect(input.prompts).toHaveLength(100)
        dependencies?.emitProgress?.({
          task_id: input.taskId ?? 'run-loading-slots-txt2img',
          capability: 'txt2img',
          processed: 1,
          total: 100,
          succeeded: 1,
          failed: 0,
          images: completedImages.slice(0, 1),
        })
        dependencies?.emitProgress?.({
          task_id: input.taskId ?? 'run-loading-slots-txt2img',
          capability: 'txt2img',
          processed: 100,
          total: 100,
          succeeded: 2,
          failed: 98,
          images: completedImages,
        })
        return {
          taskId: input.taskId ?? 'run-loading-slots-txt2img',
          total: 100,
          succeeded: 2,
          failed: 98,
          images: completedImages,
          failures: prompts.slice(2).map((prompt) => ({ prompt, error: 'content policy' })),
        }
      },
    )

    const service = new PipelineService()
    await service.runPipeline('run-loading-slots', {
      ...baseConfig('/unused'),
      source: {
        mode: 'txt2img',
        provider: 'grsai',
        prompt: { mode: 'manual', prompts },
        grsai: {
          model: 'gpt-image-2',
          aspectRatio: '1024x1024',
        },
      },
      photoshop: {
        ...baseConfig('/unused').photoshop,
        enabled: false,
        templates: [],
      },
      title: {
        ...baseConfig('/unused').title,
        enabled: false,
      },
    })

    const sections = imageProcessingSections()
    const initialLoading = sections.find(
      (section) =>
        section.total === 100 &&
        section.items.length === 100 &&
        section.items.every((item) => item.status === 'loading'),
    )
    expect(initialLoading).toMatchObject({
      completed: 0,
      failed: 0,
    })

    const firstSuccess = sections.find(
      (section) =>
        section.total === 100 &&
        section.completed === 1 &&
        section.items.filter((item) => item.status === 'loading').length === 99,
    )
    expect(firstSuccess?.items[0]).toMatchObject({
      status: 'success',
      local_path: completedImages[0]?.localPath,
    })

    const detail = await service.getRun('run-loading-slots')
    const finalSection = imageProcessingSection(detail)
    expect(finalSection).toMatchObject({
      total: 100,
      completed: 2,
      failed: 98,
    })
    expect(finalSection?.items).toHaveLength(2)
    expect(finalSection?.items.map((item) => item.local_path)).toEqual([
      completedImages[0]?.localPath,
      completedImages[1]?.localPath,
    ])
    expect(finalSection?.items.every((item) => item.status === 'success')).toBe(true)
    expect(detail?.logs?.find((entry) => entry.message === '文生图失败 98 张')).toMatchObject({
      level: 'warn',
      details: {
        total: 100,
        failed: 98,
        reasons: 'content policy x98',
      },
    })
  })

  it('keeps only the final matting group after collection extract then matting', async () => {
    const sourceFolder = join(
      mocks.workbenchRoot,
      WORKBENCH_DIRECTORIES.collection,
      'temu-20260605-120000',
    )
    await createPrint(join(sourceFolder, 'source-a.png'))
    await createPrint(join(sourceFolder, 'source-b.png'))

    const service = new PipelineService()
    await service.runPipeline('run-extract-then-matting', {
      ...baseConfig('/unused'),
      source: {
        mode: 'collection',
        sourceFolder,
        extract: {
          provider: 'grsai',
          skillId: 'extract-skill',
          grsai: {
            model: 'gpt-image-2',
            aspectRatio: '1024x1024',
          },
        },
      },
      matting: {
        enabled: true,
        mode: 'comfyui',
        workflowId: 'matting-workflow',
      },
      photoshop: {
        ...baseConfig('/unused').photoshop,
        enabled: false,
        templates: [],
      },
      title: {
        ...baseConfig('/unused').title,
        enabled: false,
      },
    })

    expect(mocks.runExtractBatch).toHaveBeenCalledOnce()
    expect(mocks.runComfyuiMattingBatch).toHaveBeenCalledOnce()
    const detail = await service.getRun('run-extract-then-matting')
    const finalSection = imageProcessingSection(detail)
    expect(finalSection).toMatchObject({
      total: 2,
      completed: 2,
      failed: 0,
    })
    expect(finalSection?.items).toHaveLength(2)
    expect(finalSection?.items.every((item) => item.step_key === 'matting')).toBe(true)
    expect(finalSection?.items.map((item) => item.local_path)).toEqual([
      join(sourceFolder, 'matted-1.png'),
      join(sourceFolder, 'matted-2.png'),
    ])
    expect(
      detail?.result_sections?.find((section) => section.key === 'source_images'),
    ).toMatchObject({
      default_collapsed: true,
      total: 2,
    })
  })

  it('runs detection against img2img outputs and splits passed and blocked sections', async () => {
    const generatedImages: GenerationRunImage[] = [
      {
        prompt: 'pass prompt',
        url: 'file://img2img-pass.png',
        localPath: join(mocks.workbenchRoot, 'img2img-pass.png'),
        artifactId: 'art-img2img-pass',
        printId: 'pri-img2img-pass',
      },
      {
        prompt: 'block prompt',
        url: 'file://img2img-block.png',
        localPath: join(mocks.workbenchRoot, 'img2img-block.png'),
        artifactId: 'art-img2img-block',
        printId: 'pri-img2img-block',
      },
    ]
    mocks.runTxt2imgBatch.mockResolvedValueOnce({
      taskId: 'run-img2img-detection-img2img',
      total: 2,
      succeeded: 2,
      failed: 0,
      images: generatedImages,
      failures: [],
    })
    mocks.runDetectionBatch.mockImplementationOnce(
      async (input: {
        imagePaths: string[]
        imageInputs?: Array<{ path: string; artifactId?: string; printId?: string }>
      }) => {
      expect(input.imagePaths).toEqual(generatedImages.map((image) => image.localPath))
      expect(input.imageInputs).toEqual([
        {
          path: generatedImages[0]?.localPath,
          artifactId: 'art-img2img-pass',
          printId: 'pri-img2img-pass',
        },
        {
          path: generatedImages[1]?.localPath,
          artifactId: 'art-img2img-block',
          printId: 'pri-img2img-block',
        },
      ])
      return {
        taskId: 'run-img2img-detection-detection',
        total: 2,
        succeeded: 2,
        failed: 0,
        skipped: 0,
        results: [
          {
            imagePath: generatedImages[0]?.localPath ?? '',
            thumbnailUrl: '',
            artifactId: 'art-img2img-pass',
            printId: 'pri-img2img-pass',
            status: 'success' as const,
            riskScore: 12,
            riskLevel: 'pass' as const,
            reason: '低风险',
            outputPath: join(mocks.workbenchRoot, 'detected-pass.png'),
            cached: false,
          },
          {
            imagePath: generatedImages[1]?.localPath ?? '',
            thumbnailUrl: '',
            artifactId: 'art-img2img-block',
            printId: 'pri-img2img-block',
            status: 'success' as const,
            riskScore: 92,
            riskLevel: 'block' as const,
            reason: '高风险',
            outputPath: join(mocks.workbenchRoot, 'detected-block.png'),
            cached: false,
          },
        ],
      }
    })

    const service = new PipelineService()
    await service.runPipeline('run-img2img-detection', {
      ...baseConfig('/unused'),
      source: {
        mode: 'img2img',
        provider: 'grsai',
        referenceImages: [
          {
            name: 'reference.png',
            base64: Buffer.from('reference-image').toString('base64'),
            mime_type: 'image/png',
          },
        ],
        prompt: {
          mode: 'manual',
          prompts: ['pass prompt', 'block prompt'],
        },
        sendReferenceImages: true,
        grsai: {
          model: 'gpt-image-2',
          aspectRatio: '1024x1024',
        },
      },
      detection: {
        enabled: true,
        allowReview: false,
        skillId: 'infringement-detection',
        skillVersion: 'v1',
        model: 'qwen3-vl-flash',
      },
      photoshop: {
        ...baseConfig('/unused').photoshop,
        enabled: false,
        templates: [],
      },
      title: {
        ...baseConfig('/unused').title,
        enabled: false,
      },
    })

    const detail = await service.getRun('run-img2img-detection')
    expect(imageProcessingSection(detail)?.items.map((item) => item.local_path)).toEqual(
      generatedImages.map((image) => image.localPath),
    )
    expect(
      detail?.result_sections?.find((section) => section.key === 'detection_passed'),
    ).toMatchObject({
      completed: 1,
      items: [expect.objectContaining({ print_id: 'pri-img2img-pass' })],
    })
    expect(
      detail?.result_sections?.find((section) => section.key === 'detection_blocked'),
    ).toMatchObject({
      completed: 1,
      items: [expect.objectContaining({ print_id: 'pri-img2img-block' })],
    })
  })

  it('emits detection passed and blocked sections using the full task pass rule', async () => {
    const printFolder = join(mocks.workbenchRoot, WORKBENCH_DIRECTORIES.generation, 'ready')
    await createPrint(join(printFolder, 'pass.png'))
    await createPrint(join(printFolder, 'review.png'))
    await createPrint(join(printFolder, 'block.png'))
    mocks.runDetectionBatch.mockResolvedValueOnce({
      taskId: 'run-detection-sections-detection',
      total: 3,
      succeeded: 3,
      failed: 0,
      skipped: 0,
      results: [
        {
          imagePath: join(printFolder, 'pass.png'),
          thumbnailUrl: '',
          artifactId: 'art-pass',
          printId: 'pri-pass',
          status: 'success' as const,
          riskScore: 10,
          riskLevel: 'pass' as const,
          reason: '低风险',
          outputPath: join(mocks.workbenchRoot, 'pass-output.png'),
          cached: false,
        },
        {
          imagePath: join(printFolder, 'review.png'),
          thumbnailUrl: '',
          artifactId: 'art-review',
          printId: 'pri-review',
          status: 'success' as const,
          riskScore: 55,
          riskLevel: 'review' as const,
          reason: '疑似',
          outputPath: join(mocks.workbenchRoot, 'review-output.png'),
          cached: false,
        },
        {
          imagePath: join(printFolder, 'block.png'),
          thumbnailUrl: '',
          artifactId: 'art-block',
          printId: 'pri-block',
          status: 'success' as const,
          riskScore: 90,
          riskLevel: 'block' as const,
          reason: '高风险',
          outputPath: join(mocks.workbenchRoot, 'block-output.png'),
          cached: false,
        },
      ],
    })

    const service = new PipelineService()
    await service.runPipeline('run-detection-sections', {
      ...baseConfig(printFolder),
      detection: {
        enabled: true,
        allowReview: false,
        skillId: 'infringement-detection',
        skillVersion: 'v1',
        model: 'qwen3-vl-flash',
      },
      photoshop: {
        ...baseConfig(printFolder).photoshop,
        enabled: false,
        templates: [],
      },
      title: {
        ...baseConfig(printFolder).title,
        enabled: false,
      },
    })

    const progressEvents = mocks.sentEvents.filter((event) => event.channel === 'pipeline:progress')
    const lastProgress = progressEvents.at(-1)?.payload as
      | {
          result_sections?: Array<{
            key: string
            completed: number
            items: Array<{ print_id?: string }>
          }>
        }
      | undefined
    const passed = lastProgress?.result_sections?.find(
      (section) => section.key === 'detection_passed',
    )
    const blocked = lastProgress?.result_sections?.find(
      (section) => section.key === 'detection_blocked',
    )

    expect(passed).toMatchObject({
      completed: 1,
      items: [expect.objectContaining({ print_id: 'pri-pass' })],
    })
    expect(blocked).toMatchObject({
      completed: 2,
      items: [
        expect.objectContaining({ print_id: 'pri-review' }),
        expect.objectContaining({ print_id: 'pri-block' }),
      ],
    })
  })

  it('rejects ComfyUI txt2img/img2img sources at the IPC schema boundary', () => {
    registerPipelineIpc()
    const handler = mocks.ipcHandlers.get('pipeline:run')
    if (!handler) {
      throw new Error('pipeline:run handler was not registered')
    }

    expect(() =>
      handler(
        {},
        {
          ...baseConfig('/prints'),
          source: {
            mode: 'txt2img',
            provider: 'comfyui-chenyu',
            prompt: { mode: 'manual', prompts: ['flower'] },
            comfyui: { workflowId: 'wf' },
          },
        },
      ),
    ).toThrow('完整任务参数无效')
  })

  it('rejects invalid print sku codes at the IPC schema boundary', () => {
    registerPipelineIpc()
    const handler = mocks.ipcHandlers.get('pipeline:run')
    if (!handler) {
      throw new Error('pipeline:run handler was not registered')
    }

    expect(() =>
      handler(
        {},
        {
          ...baseConfig('/prints'),
          printSkuCode: '印花 1',
        },
      ),
    ).toThrow('完整任务参数无效')
  })
})
