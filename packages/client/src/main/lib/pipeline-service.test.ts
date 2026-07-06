import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, extname, join } from 'node:path'
import {
  type PhotoshopOutputLayout,
  type PhotoshopPrintAsset,
  type PipelineProgress,
  type PipelineResultSection,
  type PipelineRunConfig,
  type PipelineStartStep,
  WORKBENCH_DIRECTORIES,
} from '@tengyu-aipod/shared'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { collectionFolderLock } from './collection-folder-lock'
import type {
  GenerationProgress,
  GenerationRunImage,
  GenerationRunResult,
} from './generation-service'
import { generateTxt2imgPrompts } from './generation-service'
import { PipelineService, pipelineService, registerPipelineIpc } from './pipeline-service'
import { type TitleBatchResult, writeTitlesXlsx } from './title-service'
import { openWorkbenchDatabase, workbenchDatabasePath } from './workbench-db'

const originalPlatform = Object.getOwnPropertyDescriptor(process, 'platform')

type GenerationBatchDependencies = {
  emitProgress?: (progress: GenerationProgress) => void
  onImageComplete?: (payload: {
    taskId: string
    capability: 'txt2img' | 'img2img' | 'extract' | 'matting'
    path: string
    printId: string
    artifactId?: string
    prompt?: string
    sourceArtifactIds: string[]
  }) => void | Promise<void>
}

type Txt2imgMockInput = {
  capability?: 'txt2img' | 'img2img'
  prompts: string[]
  taskId?: string
  outputTaskName?: string
  filenameStartIndex?: number
}

type ComfyuiMockInput = {
  sourceImagePaths?: string[]
  prompts?: string[]
  batchSize?: number
  taskId?: string
  outputTaskName?: string
  filenameStartIndex?: number
}

function mockGenerationOutputPath(capabilityFolder: string, taskName: string, index: number) {
  return join(
    mocks.workbenchRoot,
    WORKBENCH_DIRECTORIES.generation,
    capabilityFolder,
    taskName,
    `${String(index + 1).padStart(4, '0')}.png`,
  )
}

function mockMattingResult(input: {
  taskId: string
  sourcePath: string
  outputPath: string
  artifactId?: string
  printId?: string
  prompt?: string
}): GenerationRunResult {
  return {
    taskId: input.taskId,
    total: 1,
    succeeded: 1,
    failed: 0,
    images: [
      {
        prompt: input.prompt ?? 'matting print',
        url: `file://${basename(input.outputPath)}`,
        localPath: input.outputPath,
        sourcePath: input.sourcePath,
        ...(input.artifactId ? { artifactId: input.artifactId } : {}),
        ...(input.printId ? { printId: input.printId } : {}),
      },
    ],
    failures: [],
  }
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
        outputLayout: PhotoshopOutputLayout
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
  createTitleProcessingSession: vi.fn(async () => ({
    taskId: 'title-session',
    model: 'qwen3.6-flash',
    skill: {
      id: 'title-temu-en',
      module: 'title',
      category: null,
      platform: 'temu',
      language: 'en',
      version: '1',
      enabled: true,
      recommendedModel: 'qwen3.6-flash',
      notes: null,
      systemPrompt: 'prompt',
      variables: [],
    },
    workbenchRoot: '',
    appendDiagnosticLog: vi.fn(async () => undefined),
    generateSku: vi.fn(async ({ skuCode }: { skuCode: string }) => ({
      skuCode,
      status: 'success' as const,
      baseTitle: `Base ${skuCode}`,
      imagePath: '',
    })),
    close: vi.fn(async () => undefined),
  })),
  cancelTitleTask: vi.fn(),
  createTaskDir: vi.fn(async (module: string, taskId: string) => {
    const taskDir = join(mocks.workbenchRoot, '.workbench', 'tmp', module, taskId)
    await mkdir(taskDir, { recursive: true })
    return taskDir
  }),
  cleanupTask: vi.fn(async () => undefined),
  runTxt2imgBatch: vi.fn(
    async (
      input: Txt2imgMockInput,
      dependencies?: GenerationBatchDependencies,
    ): Promise<GenerationRunResult> => {
      const image = {
        prompt: input.prompts[0] ?? 'new print',
        url: 'file://generated.png',
        localPath: join(mocks.workbenchRoot, 'generated.png'),
        artifactId: 'art-generated-default',
        printId: 'pri-generated-default',
      }
      void dependencies?.onImageComplete?.({
        taskId: input.taskId ?? 'txt2img-task',
        capability: (input.capability ?? 'txt2img') as 'txt2img' | 'img2img',
        path: image.localPath,
        printId: image.printId,
        artifactId: image.artifactId,
        sourceArtifactIds: [],
      })
      return {
        taskId: 'txt2img-task',
        total: 1,
        succeeded: 1,
        failed: 0,
        images: [image],
        failures: [],
      }
    },
  ),
  runExtractBatch: vi.fn(
    async (
      input: { sourceImagePaths: string[]; taskId: string },
      dependencies?: GenerationBatchDependencies,
    ) => {
      const images = input.sourceImagePaths.map((sourcePath, index) => ({
        prompt: 'extract print',
        url: `file://extracted-${index + 1}.png`,
        localPath: sourcePath,
        artifactId: `art-extract-${index + 1}`,
        printId: `pri-extract-${index + 1}`,
      }))
      for (const image of images) {
        await dependencies?.onImageComplete?.({
          taskId: input.taskId,
          capability: 'extract',
          path: image.localPath,
          printId: image.printId,
          artifactId: image.artifactId,
          sourceArtifactIds: [],
        })
      }
      return {
        taskId: input.taskId,
        capability: 'extract' as const,
        total: input.sourceImagePaths.length,
        succeeded: input.sourceImagePaths.length,
        failed: 0,
        images,
        failures: [],
      }
    },
  ),
  runComfyuiMattingBatch: vi.fn(
    async (
      input: ComfyuiMockInput & { sourceImagePaths: string[]; taskId: string },
    ): Promise<GenerationRunResult> => ({
      taskId: input.taskId,
      total: input.sourceImagePaths.length,
      succeeded: input.sourceImagePaths.length,
      failed: 0,
      images: input.sourceImagePaths.map((sourcePath, index) => {
        const outputIndex = (input.filenameStartIndex ?? 0) + index
        return {
          prompt: 'matting print',
          url: `file://matted-${outputIndex + 1}.png`,
          localPath: mockGenerationOutputPath(
            '抠图',
            input.outputTaskName ?? input.taskId,
            outputIndex,
          ),
          sourcePath,
          artifactId: `art-matted-${outputIndex + 1}`,
          printId: `pri-matted-${outputIndex + 1}`,
        }
      }),
      failures: [],
    }),
  ),
  runComfyuiTxt2imgBatch: vi.fn(async (input: Txt2imgMockInput) => {
    const taskId = input.taskId ?? 'comfyui-txt2img-task'
    const outputTaskName = input.outputTaskName ?? taskId
    return {
      taskId,
      total: input.prompts.length,
      succeeded: input.prompts.length,
      failed: 0,
      images: input.prompts.map((prompt, index) => {
        const outputIndex = (input.filenameStartIndex ?? 0) + index
        return {
          prompt,
          url: `file://comfyui-txt2img-${outputIndex + 1}.png`,
          localPath: mockGenerationOutputPath('文生图', outputTaskName, outputIndex),
        }
      }),
      failures: [],
    }
  }),
  runComfyuiImg2imgBatch: vi.fn(
    async (
      input: ComfyuiMockInput,
      dependencies?: GenerationBatchDependencies,
    ): Promise<GenerationRunResult> => {
      const paths = input.sourceImagePaths ?? []
      const batchSize = input.batchSize ?? 1
      const taskId = input.taskId ?? 'comfyui-img2img-task'
      const outputTaskName = input.outputTaskName ?? taskId
      const images = paths.flatMap((sourcePath, sourceIndex) =>
        Array.from({ length: batchSize }, (_item, batchIndex) => ({
          prompt: '',
          url: `file://comfyui-img2img-${sourceIndex + 1}-${batchIndex + 1}.png`,
          localPath: mockGenerationOutputPath(
            '图生图',
            outputTaskName,
            (input.filenameStartIndex ?? 0) + sourceIndex * batchSize + batchIndex,
          ),
          sourcePath,
          artifactId: `art-comfyui-img2img-${sourceIndex + 1}-${batchIndex + 1}`,
          printId: `pri-comfyui-img2img-${sourceIndex + 1}-${batchIndex + 1}`,
        })),
      )
      for (const image of images) {
        await dependencies?.onImageComplete?.({
          taskId,
          capability: 'img2img',
          path: image.localPath,
          printId: image.printId,
          artifactId: image.artifactId,
          sourceArtifactIds: [],
        })
      }
      return {
        taskId,
        total: paths.length * batchSize,
        succeeded: paths.length * batchSize,
        failed: 0,
        images,
        failures: [],
      }
    },
  ),
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

vi.mock('./title-service', async () => {
  const actual = await vi.importActual<typeof import('./title-service')>('./title-service')
  return {
    ...actual,
    titleService: {
      runTitleBatch: mocks.runTitleBatch,
      createProcessingSession: mocks.createTitleProcessingSession,
      cancelTask: mocks.cancelTitleTask,
    },
  }
})

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
  requestGenerationCancel: vi.fn(),
  runComfyuiExtractBatch: vi.fn(),
  runComfyuiImg2imgBatch: mocks.runComfyuiImg2imgBatch,
  runComfyuiMattingBatch: mocks.runComfyuiMattingBatch,
  runComfyuiTxt2imgBatch: mocks.runComfyuiTxt2imgBatch,
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

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((innerResolve, innerReject) => {
    resolve = innerResolve
    reject = innerReject
  })
  return { promise, resolve, reject }
}

function createTitleProductImage(path: string) {
  return mkdir(dirname(path), { recursive: true }).then(() => writeFile(path, 'product-image'))
}

function createPhotoshopBatchResult(
  prints: PhotoshopPrintAsset[],
  config: {
    taskId: string
    outputRoot: string
    outputLayout: PhotoshopOutputLayout
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

function existingPrintSource(
  printFolder: string,
  startStep?: PipelineStartStep,
): Extract<PipelineRunConfig['source'], { mode: 'existing_prints' }> {
  return {
    mode: 'existing_prints',
    printFolder,
    ...(startStep ? { startStep } : {}),
  }
}

function windowsBaseName(value: string) {
  return value.split(/[/\\]/).pop() ?? value
}

function updateRunStatusForTest(runId: string, status: 'running' | 'interrupted' | 'failed') {
  const db = openWorkbenchDatabase(workbenchDatabasePath(mocks.workbenchRoot))
  try {
    db.prepare(
      `
        UPDATE pipeline_runs
        SET status = ?,
            completed_at = ?
        WHERE id = ?
      `,
    ).run(status, Date.now(), runId)
  } finally {
    db.close()
  }
}

type ResumeCapablePipelineService = PipelineService & {
  resumeRun(runId: string): Promise<Awaited<ReturnType<PipelineService['getRun']>>>
}

describe('PipelineService', () => {
  beforeEach(async () => {
    setPlatform('win32')
    mocks.workbenchRoot = await mkdtemp(join(tmpdir(), 'tengyu-pipeline-service-'))
    mocks.ipcHandlers.clear()
    mocks.runBatch.mockClear()
    mocks.runTitleBatch.mockClear()
    mocks.createTitleProcessingSession.mockReset()
    mocks.createTitleProcessingSession.mockResolvedValue({
      taskId: 'title-session',
      model: 'qwen3.6-flash',
      skill: {
        id: 'title-temu-en',
        module: 'title',
        category: null,
        platform: 'temu',
        language: 'en',
        version: '1',
        enabled: true,
        recommendedModel: 'qwen3.6-flash',
        notes: null,
        systemPrompt: 'prompt',
        variables: [],
      },
      workbenchRoot: mocks.workbenchRoot,
      appendDiagnosticLog: vi.fn(async () => undefined),
      generateSku: vi.fn(async ({ skuCode }: { skuCode: string }) => ({
        skuCode,
        status: 'success' as const,
        baseTitle: `Base ${skuCode}`,
        imagePath: join(
          mocks.workbenchRoot,
          WORKBENCH_DIRECTORIES.listing,
          'shirt',
          skuCode,
          '01.jpg',
        ),
      })),
      close: vi.fn(async () => undefined),
    })
    mocks.cancelTitleTask.mockReset()
    mocks.createTaskDir.mockClear()
    mocks.cleanupTask.mockClear()
    mocks.runTxt2imgBatch.mockClear()
    mocks.runComfyuiTxt2imgBatch.mockClear()
    mocks.runComfyuiImg2imgBatch.mockClear()
    mocks.runExtractBatch.mockClear()
    mocks.runComfyuiMattingBatch.mockClear()
    mocks.runDetectionBatch.mockReset()
    vi.mocked(generateTxt2imgPrompts).mockReset()
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
    expect(result.steps.find((step) => step.step_key === 'photoshop')).toMatchObject({
      status: 'completed',
      output_count: 1,
    })
  })

  it('exposes complete task photoshop outputs as template and sku result groups', async () => {
    const printFolder = join(mocks.workbenchRoot, WORKBENCH_DIRECTORIES.generation, 'prints')
    await mkdir(printFolder, { recursive: true })
    await writeFile(join(printFolder, 'seed.png'), 'seed')

    mocks.runBatch.mockImplementation(async (prints, templates, config) => {
      const templatePath = Array.isArray(templates)
        ? String(templates[0] ?? 'template.psd')
        : 'template.psd'
      const templateName = basename(templatePath, extname(templatePath))
      const sku = prints[0]?.id ?? 'SKU-001'
      const outputPath = join(config.outputRoot, templateName, sku, '01.jpg')
      await mkdir(dirname(outputPath), { recursive: true })
      await writeFile(outputPath, 'mockup')
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
            template_id: `tpl-${templateName}`,
            template_name: templateName,
            groups_total: 1,
            groups_completed: 1,
            outputs: [outputPath],
          },
        ],
        result_groups: [
          {
            template_id: `tpl-${templateName}`,
            template_name: templateName,
            group_index: 0,
            sku_folder: sku,
            print_ids: [sku],
            outputs: [outputPath],
            status: 'completed' as const,
          },
        ],
      }
    })

    const service = new PipelineService()
    await service.runPipeline('run-photoshop-groups', {
      ...baseConfig(printFolder),
      printSkuCode: 'GZKJ',
      source: existingPrintSource(printFolder, 'photoshop'),
      matting: { ...baseConfig(printFolder).matting, enabled: false },
      detection: { enabled: false },
      photoshop: {
        enabled: true,
        templates: ['C:\\mockups\\front.psd', 'C:\\mockups\\back.psd'],
        outputRoot: join(mocks.workbenchRoot, WORKBENCH_DIRECTORIES.listing),
        replaceRange: 'auto',
        clipMode: 'auto',
        format: 'jpg',
        skipCompleted: true,
        maxRetries: 1,
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
            groups?: Array<{
              label: string
              template_batch?: string
              sku_code?: string
              cover_path?: string
              folder_path?: string
              items: Array<{ local_path?: string }>
            }>
          }>
        }
      | undefined
    const section = lastProgress?.result_sections?.find((item) => item.key === 'print_products')

    expect(section?.groups?.map((group) => group.label).sort()).toEqual([
      'back / GZKJ-0001',
      'front / GZKJ-0001',
    ])
    expect(section?.groups?.every((group) => group.items.length === 1)).toBe(true)
    expect(section?.groups?.every((group) => Boolean(group.cover_path))).toBe(true)
    expect(section?.groups?.every((group) => Boolean(group.folder_path))).toBe(true)
  })

  it('cleans the Photoshop temp task directory after a successful Photoshop step', async () => {
    const printFolder = join(mocks.workbenchRoot, WORKBENCH_DIRECTORIES.generation, 'ready')
    await createPrint(join(printFolder, 'existing.png'))

    const service = new PipelineService()
    await service.runPipeline('run-clean-photoshop-temp', baseConfig(printFolder))

    expect(mocks.createTaskDir).toHaveBeenCalledWith(
      'photoshop',
      expect.stringMatching(/^run-clean-photoshop-temp-photoshop-TY-BASE-0001-/),
    )
    expect(mocks.cleanupTask).toHaveBeenCalledWith(
      'photoshop',
      expect.stringMatching(/^run-clean-photoshop-temp-photoshop-TY-BASE-0001-/),
    )
  })

  it('keeps failed Photoshop temp task directories on the delayed cleanup path', async () => {
    const printFolder = join(mocks.workbenchRoot, WORKBENCH_DIRECTORIES.generation, 'ready')
    await createPrint(join(printFolder, 'existing.png'))
    mocks.runBatch.mockRejectedValueOnce(new Error('Photoshop failed'))

    const service = new PipelineService()
    const result = await service.runPipeline('run-failed-photoshop-temp', baseConfig(printFolder))

    expect(result.run.status).toBe('completed')
    expect(result.steps.find((step) => step.step_key === 'photoshop')).toMatchObject({
      status: 'completed',
      output_count: 0,
    })
    expect(result.logs?.find((entry) => entry.message === '单货号套版失败，已跳过')).toMatchObject({
      level: 'warn',
    })
    expect(mocks.createTaskDir).toHaveBeenCalledWith(
      'photoshop',
      expect.stringMatching(/^run-failed-photoshop-temp-photoshop-TY-BASE-0001-/),
    )
    expect(mocks.cleanupTask).toHaveBeenCalledWith(
      'photoshop',
      expect.stringMatching(/^run-failed-photoshop-temp-photoshop-TY-BASE-0001-/),
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
    expect(
      (await service.getRun('run-custom-output'))?.steps.find(
        (step) => step.step_key === 'photoshop',
      ),
    ).toMatchObject({
      status: 'completed',
      output_count: 1,
    })
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
      'TY-001-0001.png',
    )
    await expect(readFile(waitingPrintPath, 'utf8')).resolves.toBe('image')
    expect(mocks.runBatch.mock.calls[0]?.[0]).toEqual([
      {
        id: 'TY-001-0001',
        file_path: waitingPrintPath,
      },
    ])
    await expect(mocks.runBatch.mock.results[0]?.value).resolves.toMatchObject({
      outputs: [
        join(mocks.workbenchRoot, WORKBENCH_DIRECTORIES.listing, 'shirt', 'TY-001-0001', '01.jpg'),
      ],
      result_groups: [expect.objectContaining({ sku_folder: 'TY-001-0001' })],
    })
  })

  it('keeps the visible print sku folder when generated prints still carry internal print ids', async () => {
    const generatedPath = join(mocks.workbenchRoot, 'generated-with-print-id.png')
    await createPrint(generatedPath)
    mocks.runTxt2imgBatch.mockImplementationOnce(
      async (_input: Txt2imgMockInput, dependencies?: GenerationBatchDependencies) => {
        await dependencies?.onImageComplete?.({
          taskId: 'run-generated-print-sku-txt2img',
          capability: 'txt2img',
          path: generatedPath,
          printId: 'pri_generated_internal',
          sourceArtifactIds: [],
        })
        return {
          taskId: 'run-generated-print-sku-txt2img',
          total: 1,
          succeeded: 1,
          failed: 0,
          images: [
            {
              prompt: 'new print',
              url: 'file://generated-with-print-id.png',
              localPath: generatedPath,
              printId: 'pri_generated_internal',
            },
          ],
          failures: [],
        }
      },
    )

    const service = new PipelineService()
    await service.runPipeline('run-generated-print-sku', {
      ...baseConfig('/unused'),
      printSkuCode: 'GYX',
      source: {
        mode: 'txt2img',
        provider: 'grsai',
        prompt: { mode: 'manual', prompts: ['new print'] },
        grsai: {
          model: 'gpt-image-2',
          aspectRatio: '1024x1024',
        },
      },
    })

    const waitingPrintPath = join(
      mocks.workbenchRoot,
      WORKBENCH_DIRECTORIES.generation,
      '等待套版',
      'run-generated-print-sku',
      'GYX-0001.png',
    )
    expect(mocks.runBatch.mock.calls[0]?.[0]).toEqual([
      {
        id: 'GYX-0001',
        file_path: waitingPrintPath,
      },
    ])
    await expect(mocks.runBatch.mock.results[0]?.value).resolves.toMatchObject({
      outputs: [
        join(mocks.workbenchRoot, WORKBENCH_DIRECTORIES.listing, 'shirt', 'GYX-0001', '01.jpg'),
      ],
      result_groups: [expect.objectContaining({ sku_folder: 'GYX-0001' })],
    })
  })

  it('uses the configured filename separator and four digit sequence for multiple waiting Photoshop prints', async () => {
    const printFolder = join(mocks.workbenchRoot, WORKBENCH_DIRECTORIES.generation, 'ready')
    await createPrint(join(printFolder, 'existing-1.png'))
    await createPrint(join(printFolder, 'existing-2.png'))

    const service = new PipelineService()
    await service.runPipeline('run-print-sku-multiple', {
      ...baseConfig(printFolder),
      printSkuCode: 'GYX',
      filenameSeparator: '_',
    })

    const firstWaitingPrintPath = join(
      mocks.workbenchRoot,
      WORKBENCH_DIRECTORIES.generation,
      '等待套版',
      'run-print-sku-multiple',
      'GYX_0001.png',
    )
    const secondWaitingPrintPath = join(
      mocks.workbenchRoot,
      WORKBENCH_DIRECTORIES.generation,
      '等待套版',
      'run-print-sku-multiple',
      'GYX_0002.png',
    )
    await expect(readFile(firstWaitingPrintPath, 'utf8')).resolves.toBe('image')
    await expect(readFile(secondWaitingPrintPath, 'utf8')).resolves.toBe('image')
    expect(mocks.runBatch).toHaveBeenCalledTimes(2)
    expect(mocks.runBatch.mock.calls.map((call) => call[0])).toEqual([
      [{ id: 'GYX_0001', file_path: firstWaitingPrintPath }],
      [{ id: 'GYX_0002', file_path: secondWaitingPrintPath }],
    ])
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
          outputLayout: PhotoshopOutputLayout
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
          outputLayout: PhotoshopOutputLayout
        },
      ) => {
        if (config.taskId.startsWith('run-ps-lock-1-photoshop-')) {
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

  it('times out a stuck Photoshop mutex waiter and releases later callers', async () => {
    vi.useFakeTimers()
    type PhotoshopMutexForTest = {
      runExclusive<T>(fn: () => Promise<T>): Promise<T>
    }
    const service = new PipelineService()
    const mutex = (service as unknown as { photoshopMutex: PhotoshopMutexForTest }).photoshopMutex
    const holderEntered = createDeferred<void>()
    void mutex.runExclusive(async () => {
      holderEntered.resolve()
      return new Promise<never>(() => {})
    })
    await holderEntered.promise

    try {
      const waiter = mutex.runExclusive(async () => 'should-not-run')
      const waiterResult = waiter.then(
        (value) => ({ status: 'resolved' as const, value }),
        (error: unknown) => ({ status: 'rejected' as const, error }),
      )

      await vi.advanceTimersByTimeAsync(10 * 60 * 1000)
      await expect(
        Promise.race([waiterResult, Promise.resolve({ status: 'pending' as const })]),
      ).resolves.toMatchObject({
        status: 'rejected',
        error: expect.objectContaining({
          message: 'Photoshop 无响应,请检查 PS 后重试',
        }),
      })

      await expect(mutex.runExclusive(async () => 'released')).resolves.toBe('released')
    } finally {
      vi.useRealTimers()
    }
  })

  it('completes the title step when every title batch is skipped', async () => {
    const printFolder = join(mocks.workbenchRoot, WORKBENCH_DIRECTORIES.generation, 'ready')
    await createPrint(join(printFolder, 'existing.png'))
    const batchDir = join(mocks.workbenchRoot, WORKBENCH_DIRECTORIES.listing, 'shirt')
    await mkdir(batchDir, { recursive: true })
    await writeTitlesXlsx(
      join(batchDir, '标题.xlsx'),
      new Map(),
      new Map([['TY-BASE-0001', 'Existing title']]),
    )
    const generateSku = vi.fn(async ({ skuCode }: { skuCode: string }) => ({
      skuCode,
      status: 'success' as const,
      baseTitle: `Base ${skuCode}`,
      imagePath: join(batchDir, skuCode, '01.jpg'),
    }))
    mocks.createTitleProcessingSession.mockResolvedValueOnce({
      taskId: 'title-session-skipped',
      model: 'qwen3.6-flash',
      skill: {
        id: 'title-temu-en',
        module: 'title',
        category: null,
        platform: 'temu',
        language: 'en',
        version: '1',
        enabled: true,
        recommendedModel: 'qwen3.6-flash',
        notes: null,
        systemPrompt: 'prompt',
        variables: [],
      },
      workbenchRoot: mocks.workbenchRoot,
      appendDiagnosticLog: vi.fn(async () => undefined),
      generateSku,
      close: vi.fn(async () => undefined),
    })

    const service = new PipelineService()
    const result = await service.runPipeline('run-title-skipped', baseConfig(printFolder))

    expect(result.run.status).toBe('completed')
    expect(generateSku).not.toHaveBeenCalled()
    expect(result.steps.find((step) => step.step_key === 'title')).toMatchObject({
      status: 'completed',
      output_count: 1,
    })
    expect(
      result.items?.find((item) => item.step_key === 'title' && item.status === 'skipped'),
    ).toMatchObject({
      output_path: join(batchDir, '标题.xlsx'),
    })
  })

  it('can complete before Photoshop and title when those stages are disabled', async () => {
    const printFolder = join(mocks.workbenchRoot, WORKBENCH_DIRECTORIES.generation, 'ready')
    await createPrint(join(printFolder, 'existing.png'))
    mocks.runDetectionBatch.mockResolvedValueOnce({
      taskId: 'run-source-only-detection',
      total: 1,
      succeeded: 1,
      failed: 0,
      skipped: 0,
      results: [
        {
          imagePath: join(printFolder, 'existing.png'),
          thumbnailUrl: '',
          artifactId: 'art-source-only',
          printId: 'pri-source-only',
          status: 'success' as const,
          riskScore: 12,
          riskLevel: 'pass' as const,
          reason: '低风险',
          outputPath: join(mocks.workbenchRoot, 'source-only-output.png'),
          cached: false,
        },
      ],
    })

    const service = new PipelineService()
    const result = await service.runPipeline('run-source-only', {
      ...baseConfig(printFolder),
      source: existingPrintSource(printFolder, 'detection'),
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

    expect(result.run.status).toBe('completed')
    expect(mocks.runBatch).not.toHaveBeenCalled()
    expect(mocks.runTitleBatch).not.toHaveBeenCalled()
    expect(result.steps.map((step) => [step.step_key, step.status])).toEqual([
      ['source', 'completed'],
      ['detection', 'completed'],
      ['matting', 'skipped'],
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

  it('rejects existing print sources at the generation root or waiting folder', async () => {
    const generationRoot = join(mocks.workbenchRoot, WORKBENCH_DIRECTORIES.generation)
    const waitingFolder = join(generationRoot, '等待套版', 'run-existing-print-root')
    await createPrint(join(waitingFolder, 'existing.png'))

    const service = new PipelineService()

    await expect(
      service.runPipeline('run-existing-print-root', {
        ...baseConfig(generationRoot),
      }),
    ).rejects.toMatchObject({
      code: 'HTTP_4XX',
      message:
        '已有印花来源必须选择 02-印花工作区 下的具体印花文件夹，不能选择根目录或等待套版目录',
    })

    await expect(
      service.runPipeline('run-existing-print-waiting', {
        ...baseConfig(waitingFolder),
      }),
    ).rejects.toMatchObject({
      code: 'HTTP_4XX',
      message:
        '已有印花来源必须选择 02-印花工作区 下的具体印花文件夹，不能选择根目录或等待套版目录',
    })
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
            artifactId: `art-extract-lock-${index + 1}`,
            printId: `pri-extract-lock-${index + 1}`,
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

  it('soft-cancels a streaming run after the in-flight item finishes', async () => {
    const sourceStarted = createDeferred<void>()
    const finishSource = createDeferred<GenerationRunResult>()
    const mattingStarted = createDeferred<void>()
    const finishMatting = createDeferred<GenerationRunResult>()

    mocks.runTxt2imgBatch.mockImplementationOnce(
      async (input: Txt2imgMockInput, dependencies?: GenerationBatchDependencies) => {
        sourceStarted.resolve()
        await dependencies?.onImageComplete?.({
          taskId: input.taskId ?? 'run-soft-cancel-txt2img',
          capability: 'txt2img',
          path: join(mocks.workbenchRoot, 'soft-cancel-source-1.png'),
          printId: 'pri-soft-cancel-source-1',
          artifactId: 'art-soft-cancel-source-1',
          sourceArtifactIds: [],
        })
        return finishSource.promise
      },
    )
    mocks.runComfyuiMattingBatch.mockImplementationOnce(
      async (input: { sourceImagePaths: string[]; taskId: string }) => {
        mattingStarted.resolve()
        expect(input.sourceImagePaths).toEqual([
          join(mocks.workbenchRoot, 'soft-cancel-source-1.png'),
        ])
        return finishMatting.promise
      },
    )

    const service = new PipelineService()
    const runPromise = service.runPipeline('run-soft-cancel', {
      ...baseConfig('/unused'),
      source: {
        mode: 'txt2img',
        provider: 'grsai',
        prompt: { mode: 'manual', prompts: ['p1', 'p2'] },
        grsai: {
          model: 'gpt-image-2',
          aspectRatio: '1024x1024',
        },
      },
      matting: {
        enabled: true,
        mode: 'comfyui',
        workflowId: 'matting-workflow',
      },
      detection: {
        enabled: false,
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

    await sourceStarted.promise
    await mattingStarted.promise
    expect(service.cancelRun('run-soft-cancel')).toBe(true)

    finishMatting.resolve({
      taskId: 'run-soft-cancel-matting-pri-soft-cancel-source-1',
      total: 1,
      succeeded: 1,
      failed: 0,
      images: [
        {
          prompt: 'matted',
          url: 'file://soft-cancel-matted-1.png',
          localPath: join(mocks.workbenchRoot, 'soft-cancel-matted-1.png'),
          sourcePath: join(mocks.workbenchRoot, 'soft-cancel-source-1.png'),
          artifactId: 'art-soft-cancel-matted-1',
          printId: 'pri-soft-cancel-matted-1',
        },
      ],
      failures: [],
    })
    finishSource.resolve({
      taskId: 'run-soft-cancel-txt2img',
      total: 2,
      succeeded: 1,
      failed: 0,
      images: [
        {
          prompt: 'p1',
          url: 'file://soft-cancel-source-1.png',
          localPath: join(mocks.workbenchRoot, 'soft-cancel-source-1.png'),
          artifactId: 'art-soft-cancel-source-1',
          printId: 'pri-soft-cancel-source-1',
        },
      ],
      failures: [],
      cancelled: true,
    })

    const detail = await runPromise
    expect(detail.run.status).toBe('cancelled')
    expect(detail.run.error_summary).toBe('完整任务已取消')
    expect(detail.steps.find((step) => step.step_key === 'matting')?.status).toBe('completed')
    expect(
      detail.items?.find(
        (item) => item.step_key === 'matting' && item.item_key === 'pri-soft-cancel-source-1',
      ),
    ).toMatchObject({
      status: 'completed',
      output_path: join(mocks.workbenchRoot, 'soft-cancel-matted-1.png'),
    })
    const progressEvents = mocks.sentEvents.filter((event) => event.channel === 'pipeline:progress')
    const lastProgress = progressEvents.at(-1)?.payload as
      | { logs?: Array<{ message: string }> }
      | undefined
    expect(lastProgress?.logs?.some((log) => log.message === '完整任务已取消')).toBe(true)
  })

  it('marks active streaming records interrupted and keeps the interrupted status after in-flight work settles', async () => {
    const sourceStarted = createDeferred<void>()
    const finishSource = createDeferred<GenerationRunResult>()
    const mattingStarted = createDeferred<void>()
    const finishMatting = createDeferred<GenerationRunResult>()

    mocks.runTxt2imgBatch.mockImplementationOnce(
      async (input: Txt2imgMockInput, dependencies?: GenerationBatchDependencies) => {
        sourceStarted.resolve()
        await dependencies?.onImageComplete?.({
          taskId: input.taskId ?? 'run-interrupted-txt2img',
          capability: 'txt2img',
          path: join(mocks.workbenchRoot, 'interrupted-source-1.png'),
          printId: 'pri-interrupted-source-1',
          artifactId: 'art-interrupted-source-1',
          sourceArtifactIds: [],
        })
        return finishSource.promise
      },
    )
    mocks.runComfyuiMattingBatch.mockImplementationOnce(async () => {
      mattingStarted.resolve()
      return finishMatting.promise
    })

    const service = new PipelineService()
    const runPromise = service.runPipeline('run-interrupted', {
      ...baseConfig('/unused'),
      source: {
        mode: 'txt2img',
        provider: 'grsai',
        prompt: { mode: 'manual', prompts: ['p1'] },
        grsai: {
          model: 'gpt-image-2',
          aspectRatio: '1024x1024',
        },
      },
      matting: {
        enabled: true,
        mode: 'comfyui',
        workflowId: 'matting-workflow',
      },
      detection: {
        enabled: false,
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

    await sourceStarted.promise
    await mattingStarted.promise
    await service.markActiveRunsInterrupted()

    let detail = await service.getRun('run-interrupted')
    expect(detail?.run.status).toBe('interrupted')
    expect(detail?.run.error_summary).toBe('完整任务已中断，已完成产物已保留')
    expect(detail?.steps.find((step) => step.step_key === 'matting')?.status).toBe('interrupted')
    expect(
      detail?.items?.find(
        (item) => item.step_key === 'matting' && item.item_key === 'pri-interrupted-source-1',
      ),
    ).toMatchObject({ status: 'interrupted' })

    finishMatting.resolve({
      taskId: 'run-interrupted-matting-pri-interrupted-source-1',
      total: 1,
      succeeded: 1,
      failed: 0,
      images: [
        {
          prompt: 'matted',
          url: 'file://interrupted-matted-1.png',
          localPath: join(mocks.workbenchRoot, 'interrupted-matted-1.png'),
          sourcePath: join(mocks.workbenchRoot, 'interrupted-source-1.png'),
          artifactId: 'art-interrupted-matted-1',
          printId: 'pri-interrupted-matted-1',
        },
      ],
      failures: [],
    })
    finishSource.resolve({
      taskId: 'run-interrupted-txt2img',
      total: 1,
      succeeded: 1,
      failed: 0,
      images: [
        {
          prompt: 'p1',
          url: 'file://interrupted-source-1.png',
          localPath: join(mocks.workbenchRoot, 'interrupted-source-1.png'),
          artifactId: 'art-interrupted-source-1',
          printId: 'pri-interrupted-source-1',
        },
      ],
      failures: [],
    })

    await runPromise
    await service.markPersistedRunningRunsInterrupted()
    detail = await service.getRun('run-interrupted')
    expect(detail?.run.status).toBe('interrupted')
    expect(detail?.run.error_summary).toBe('完整任务已中断，已完成产物已保留')
  })

  it('rejects resuming a run that is already running', async () => {
    const service = new PipelineService() as ResumeCapablePipelineService
    await service.runPipeline('run-resume-running', {
      ...baseConfig('/unused'),
      source: {
        mode: 'txt2img',
        provider: 'comfyui-chenyu',
        prompt: { mode: 'manual', prompts: ['flower print'] },
        comfyui: {
          workflowId: 'wf-txt2img',
          instanceUuid: 'instance-a',
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
    updateRunStatusForTest('run-resume-running', 'running')

    await expect(service.resumeRun('run-resume-running')).rejects.toThrow('正在运行')
  })

  it('validates the waiting Photoshop copy folder before resuming', async () => {
    const printFolder = join(mocks.workbenchRoot, WORKBENCH_DIRECTORIES.generation, 'ready')
    await createPrint(join(printFolder, 'existing.png'))

    const service = new PipelineService() as ResumeCapablePipelineService
    await service.runPipeline('run-resume-missing-waiting-folder', baseConfig(printFolder))
    await rm(
      join(
        mocks.workbenchRoot,
        WORKBENCH_DIRECTORIES.generation,
        '等待套版',
        'run-resume-missing-waiting-folder',
      ),
      { recursive: true, force: true },
    )
    updateRunStatusForTest('run-resume-missing-waiting-folder', 'interrupted')

    await expect(service.resumeRun('run-resume-missing-waiting-folder')).rejects.toThrow(
      '源目录已被清理,无法续跑',
    )
  })

  it('resumes an interrupted ComfyUI txt2img run without regenerating completed source items', async () => {
    const secondSourceStarted = createDeferred<void>()
    const finishSecondSource = createDeferred<GenerationRunResult>()
    const firstSourcePath = join(mocks.workbenchRoot, 'resume-source-1.png')
    const secondSourcePath = join(mocks.workbenchRoot, 'resume-source-2.png')

    mocks.runComfyuiTxt2imgBatch.mockImplementationOnce(
      async (input: Txt2imgMockInput, dependencies?: GenerationBatchDependencies) => {
        const prompt = input.prompts[0] ?? ''
        await createPrint(firstSourcePath)
        await dependencies?.onImageComplete?.({
          taskId: input.taskId ?? 'run-resume-source-txt2img-1',
          capability: 'txt2img',
          path: firstSourcePath,
          printId: 'pri-resume-source-1',
          artifactId: 'art-resume-source-1',
          prompt,
          sourceArtifactIds: [],
        })
        return {
          taskId: input.taskId ?? 'run-resume-source-txt2img-1',
          total: 1,
          succeeded: 1,
          failed: 0,
          images: [
            {
              prompt,
              url: 'file://resume-source-1.png',
              localPath: firstSourcePath,
              artifactId: 'art-resume-source-1',
              printId: 'pri-resume-source-1',
            },
          ],
          failures: [],
        }
      },
    )
    mocks.runComfyuiTxt2imgBatch.mockImplementationOnce(async () => {
      secondSourceStarted.resolve()
      await finishSecondSource.promise
      return {
        taskId: 'run-resume-source-txt2img-2',
        total: 1,
        succeeded: 0,
        failed: 1,
        images: [],
        failures: [],
      }
    })

    const service = new PipelineService() as ResumeCapablePipelineService
    const runPromise = service.runPipeline('run-resume-source', {
      ...baseConfig('/unused'),
      source: {
        mode: 'txt2img',
        provider: 'comfyui-chenyu',
        prompt: { mode: 'manual', prompts: ['p1', 'p2'] },
        comfyui: {
          workflowId: 'wf-txt2img',
          instanceUuid: 'instance-a',
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

    await secondSourceStarted.promise
    await service.markActiveRunsInterrupted()
    finishSecondSource.reject(new Error('source process exited'))
    const interrupted = await runPromise
    expect(interrupted.run.status).toBe('interrupted')

    mocks.runComfyuiTxt2imgBatch.mockClear()
    mocks.runComfyuiTxt2imgBatch.mockImplementationOnce(
      async (input: Txt2imgMockInput, dependencies?: GenerationBatchDependencies) => {
        const prompt = input.prompts[0] ?? ''
        await createPrint(secondSourcePath)
        await dependencies?.onImageComplete?.({
          taskId: input.taskId ?? 'run-resume-source-txt2img-2',
          capability: 'txt2img',
          path: secondSourcePath,
          printId: 'pri-resume-source-2',
          artifactId: 'art-resume-source-2',
          prompt,
          sourceArtifactIds: [],
        })
        return {
          taskId: input.taskId ?? 'run-resume-source-txt2img-2',
          total: 1,
          succeeded: 1,
          failed: 0,
          images: [
            {
              prompt,
              url: 'file://resume-source-2.png',
              localPath: secondSourcePath,
              artifactId: 'art-resume-source-2',
              printId: 'pri-resume-source-2',
            },
          ],
          failures: [],
        }
      },
    )

    const resumed = await service.resumeRun('run-resume-source')

    expect(resumed?.run.status).toBe('completed')
    expect(mocks.runComfyuiTxt2imgBatch).toHaveBeenCalledOnce()
    expect(mocks.runComfyuiTxt2imgBatch.mock.calls[0]?.[0]).toMatchObject({
      prompts: ['p2'],
      filenameStartIndex: 1,
    })
    expect(
      (resumed?.items ?? []).filter(
        (item) => item.step_key === 'source' && item.status === 'completed',
      ),
    ).toHaveLength(2)
  })

  it('does not regenerate AI prompts when all txt2img source items were completed before resume', async () => {
    vi.mocked(generateTxt2imgPrompts).mockResolvedValueOnce([
      { id: '00000000-0000-4000-8000-000000000001', text: 'p1', selected: true },
      { id: '00000000-0000-4000-8000-000000000002', text: 'p2', selected: true },
    ])
    let sourceIndex = 0
    mocks.runComfyuiTxt2imgBatch.mockImplementation(
      async (input: Txt2imgMockInput, dependencies?: GenerationBatchDependencies) => {
        const images = await Promise.all(
          input.prompts.map(async (prompt) => {
            sourceIndex += 1
            const outputPath = join(mocks.workbenchRoot, `ai-resume-source-${sourceIndex}.png`)
            await createPrint(outputPath)
            const image = {
              prompt,
              url: `file://ai-resume-source-${sourceIndex}.png`,
              localPath: outputPath,
              artifactId: `art-ai-resume-source-${sourceIndex}`,
              printId: `pri-ai-resume-source-${sourceIndex}`,
            }
            await dependencies?.onImageComplete?.({
              taskId: input.taskId ?? `run-resume-all-source-ai-prompts-txt2img-${sourceIndex}`,
              capability: 'txt2img',
              path: image.localPath,
              printId: image.printId,
              artifactId: image.artifactId,
              prompt,
              sourceArtifactIds: [],
            })
            return image
          }),
        )
        return {
          taskId: input.taskId ?? 'run-resume-all-source-ai-prompts-txt2img',
          total: images.length,
          succeeded: images.length,
          failed: 0,
          images,
          failures: [],
        }
      },
    )

    const service = new PipelineService() as ResumeCapablePipelineService
    const firstRun = await service.runPipeline('run-resume-all-source-ai-prompts', {
      ...baseConfig('/unused'),
      source: {
        mode: 'txt2img',
        provider: 'comfyui-chenyu',
        prompt: {
          mode: 'ai',
          requirement: 'make two floral prints',
          count: 2,
          skillId: 'txt2img-local-print',
          skillVersion: '1.0.0',
          model: 'qwen3-vl-flash',
        },
        comfyui: {
          workflowId: 'wf-txt2img',
          instanceUuid: 'instance-a',
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
    expect(firstRun.run.status).toBe('completed')
    expect(
      (firstRun.items ?? []).filter(
        (item) => item.step_key === 'source' && item.status === 'completed',
      ),
    ).toHaveLength(2)

    updateRunStatusForTest('run-resume-all-source-ai-prompts', 'interrupted')
    vi.mocked(generateTxt2imgPrompts).mockReset()
    vi.mocked(generateTxt2imgPrompts).mockRejectedValue(
      new Error('prompt generator should not run on completed source resume'),
    )
    mocks.runComfyuiTxt2imgBatch.mockClear()

    const resumed = await service.resumeRun('run-resume-all-source-ai-prompts')

    expect(resumed?.run.status).toBe('completed')
    expect(generateTxt2imgPrompts).not.toHaveBeenCalled()
    expect(mocks.runComfyuiTxt2imgBatch).not.toHaveBeenCalled()
  })

  it('resumes past completed Photoshop and title items without rerunning their adapters', async () => {
    const printFolder = join(mocks.workbenchRoot, WORKBENCH_DIRECTORIES.generation, 'ready')
    await createPrint(join(printFolder, 'existing.png'))
    mocks.runBatch.mockImplementationOnce(async (prints, _templates, config) => {
      const result = createPhotoshopBatchResult(prints, config)
      const outputPath = result.result_groups[0]?.outputs[0]
      if (outputPath) {
        await createTitleProductImage(outputPath)
      }
      return result
    })

    const service = new PipelineService() as ResumeCapablePipelineService
    const firstRun = await service.runPipeline('run-resume-ps-title', {
      ...baseConfig(printFolder),
      title: {
        ...baseConfig(printFolder).title,
        existingStrategy: 'regenerate',
      },
    })
    expect(
      (firstRun.items ?? []).filter(
        (item) => item.step_key === 'photoshop' && item.status === 'completed',
      ),
    ).toHaveLength(1)
    expect(
      (firstRun.items ?? []).filter(
        (item) => item.step_key === 'title' && item.status === 'completed',
      ),
    ).toHaveLength(1)
    updateRunStatusForTest('run-resume-ps-title', 'interrupted')
    mocks.runBatch.mockClear()
    mocks.createTitleProcessingSession.mockClear()

    const resumed = await service.resumeRun('run-resume-ps-title')

    expect(resumed?.run.status).toBe('completed')
    expect(mocks.runBatch).not.toHaveBeenCalled()
    expect(mocks.createTitleProcessingSession).not.toHaveBeenCalled()
    expect(
      (resumed?.items ?? []).filter(
        (item) => item.step_key === 'photoshop' && item.status === 'completed',
      ),
    ).toHaveLength(1)
    expect(
      (resumed?.items ?? []).filter(
        (item) => item.step_key === 'title' && item.status === 'completed',
      ),
    ).toHaveLength(1)
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
      source: existingPrintSource(printFolder, 'detection'),
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

  it('routes txt2img comfyui sources to the ComfyUI batch runner', async () => {
    const service = new PipelineService()
    const result = await service.runPipeline('run-txt2img-comfyui', {
      ...baseConfig('/unused'),
      source: {
        mode: 'txt2img',
        provider: 'comfyui-chenyu',
        prompt: { mode: 'manual', prompts: ['flower print'] },
        comfyui: {
          workflowId: 'wf-txt2img',
          instanceUuid: 'instance-a',
          width: 1024,
          height: 1024,
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
    expect(mocks.runComfyuiTxt2imgBatch).toHaveBeenCalledWith(
      expect.objectContaining({
        prompts: ['flower print'],
        workflowId: 'wf-txt2img',
        instanceUuid: 'instance-a',
        width: 1024,
        height: 1024,
      }),
      expect.anything(),
    )
    expect(mocks.runTxt2imgBatch).not.toHaveBeenCalled()
  })

  it('routes img2img comfyui sources to the ComfyUI batch runner with batch size', async () => {
    const sourceFolder = join(mocks.workbenchRoot, 'external-img2img-source')
    await createPrint(join(sourceFolder, 'a.png'))
    await createPrint(join(sourceFolder, 'b.png'))

    const service = new PipelineService()
    const result = await service.runPipeline('run-img2img-comfyui', {
      ...baseConfig('/unused'),
      source: {
        mode: 'img2img',
        provider: 'comfyui-chenyu',
        sourceFolder,
        comfyui: {
          workflowId: 'wf-img2img',
          instanceUuid: 'instance-b',
          width: 768,
          height: 768,
          batchSize: 3,
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
    expect(mocks.runComfyuiImg2imgBatch).toHaveBeenCalledTimes(2)
    expect(mocks.runComfyuiImg2imgBatch.mock.calls).toEqual([
      [
        expect.objectContaining({
          sourceImagePaths: [join(sourceFolder, 'a.png')],
          workflowId: 'wf-img2img',
          taskId: 'run-img2img-comfyui-img2img-1',
          outputTaskName: '完整任务测试',
          filenameStartIndex: 0,
          instanceUuid: 'instance-b',
          width: 768,
          height: 768,
          batchSize: 3,
        }),
        expect.objectContaining({
          onImageComplete: expect.any(Function),
        }),
      ],
      [
        expect.objectContaining({
          sourceImagePaths: [join(sourceFolder, 'b.png')],
          workflowId: 'wf-img2img',
          taskId: 'run-img2img-comfyui-img2img-2',
          outputTaskName: '完整任务测试',
          filenameStartIndex: 3,
          instanceUuid: 'instance-b',
          width: 768,
          height: 768,
          batchSize: 3,
        }),
        expect.objectContaining({
          onImageComplete: expect.any(Function),
        }),
      ],
    ])
    expect(mocks.runTxt2imgBatch).not.toHaveBeenCalled()
  })

  it('passes AI prompt settings to the ComfyUI img2img runner', async () => {
    const sourceFolder = join(mocks.workbenchRoot, 'external-img2img-ai-source')
    await createPrint(join(sourceFolder, 'a.png'))

    const service = new PipelineService()
    await service.runPipeline('run-img2img-comfyui-ai', {
      ...baseConfig('/unused'),
      printMode: 'full',
      source: {
        mode: 'img2img',
        provider: 'comfyui-chenyu',
        sourceFolder,
        prompt: {
          mode: 'ai',
          requirement: 'make a floral pattern',
          model: 'qwen3-vl-flash',
          modeInstruction: 'Use both layout and style from the reference image.',
          skillId: 'img2img-full-reference',
          skillVersion: '1.0.0',
        },
        comfyui: {
          workflowId: 'wf-img2img',
          instanceUuid: 'instance-b',
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

    expect(mocks.runComfyuiImg2imgBatch).toHaveBeenCalledWith(
      expect.objectContaining({
        promptMode: 'ai',
        printMode: 'full',
        promptSkillId: 'img2img-full-reference',
        promptSkillVersion: '1.0.0',
        promptModel: 'qwen3-vl-flash',
        modeInstruction: 'Use both layout and style from the reference image.',
        requirement: 'make a floral pattern',
      }),
      expect.anything(),
    )
  })

  it('allows workflow prompt mode for complete-task ComfyUI img2img', async () => {
    const sourceFolder = join(mocks.workbenchRoot, 'external-img2img-workflow-source')
    await createPrint(join(sourceFolder, 'a.png'))

    const service = new PipelineService()
    const result = await service.runPipeline('run-img2img-comfyui-workflow', {
      ...baseConfig('/unused'),
      source: {
        mode: 'img2img',
        provider: 'comfyui-chenyu',
        sourceFolder,
        prompt: { mode: 'workflow' },
        comfyui: {
          workflowId: 'wf-img2img',
          instanceUuid: 'instance-b',
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
    const input = mocks.runComfyuiImg2imgBatch.mock.calls[0]?.[0] as
      | Record<string, unknown>
      | undefined
    expect(input).toMatchObject({ promptMode: 'workflow' })
    expect(input).not.toHaveProperty('promptSkillId')
    expect(input).not.toHaveProperty('promptModel')
  })

  it('emits staged result sections and runtime logs for a complete task', async () => {
    const printFolder = join(mocks.workbenchRoot, WORKBENCH_DIRECTORIES.generation, 'ready')
    await createPrint(join(printFolder, 'existing.png'))
    mocks.runDetectionBatch.mockResolvedValueOnce({
      taskId: 'run-result-sections-detection',
      total: 1,
      succeeded: 1,
      failed: 0,
      skipped: 0,
      results: [
        {
          imagePath: join(printFolder, 'existing.png'),
          thumbnailUrl: '',
          artifactId: 'art-existing',
          printId: 'pri-existing',
          status: 'success' as const,
          riskScore: 10,
          riskLevel: 'pass' as const,
          reason: '低风险',
          outputPath: join(mocks.workbenchRoot, 'existing-output.png'),
          cached: false,
        },
      ],
    })

    const service = new PipelineService()
    await service.runPipeline('run-result-sections', {
      ...baseConfig(printFolder),
      source: existingPrintSource(printFolder, 'detection'),
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
        await dependencies?.onImageComplete?.({
          taskId: input.taskId ?? 'run-loading-slots-txt2img',
          capability: 'txt2img',
          path: completedImages[0]?.localPath ?? '',
          printId: 'pri-loading-42',
          artifactId: 'art-loading-42',
          sourceArtifactIds: [],
        })
        dependencies?.emitProgress?.({
          task_id: input.taskId ?? 'run-loading-slots-txt2img',
          capability: 'txt2img',
          processed: 1,
          total: 100,
          succeeded: 1,
          failed: 0,
          images: completedImages.slice(0, 1),
        })
        await dependencies?.onImageComplete?.({
          taskId: input.taskId ?? 'run-loading-slots-txt2img',
          capability: 'txt2img',
          path: completedImages[1]?.localPath ?? '',
          printId: 'pri-loading-7',
          artifactId: 'art-loading-7',
          sourceArtifactIds: [],
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
    mocks.runComfyuiMattingBatch.mockImplementation(async (input) => {
      const sourcePath = input.sourceImagePaths[0] ?? ''
      const outputName = sourcePath.endsWith('source-a.png') ? 'matted-1.png' : 'matted-2.png'
      return mockMattingResult({
        taskId: input.taskId,
        sourcePath,
        outputPath: join(dirname(sourcePath), outputName),
      })
    })

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
    expect(mocks.runComfyuiMattingBatch).toHaveBeenCalledTimes(2)
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

  it('streams txt2img outputs into matting without waiting for the whole source batch', async () => {
    const sourceStarted = createDeferred<void>()
    const finishSource = createDeferred<GenerationRunResult>()
    const mattingStarted = createDeferred<void>()
    const finishMatting = createDeferred<GenerationRunResult>()

    mocks.runTxt2imgBatch.mockImplementationOnce(
      async (input: Txt2imgMockInput, dependencies?: GenerationBatchDependencies) => {
        sourceStarted.resolve()
        await dependencies?.onImageComplete?.({
          taskId: input.taskId ?? 'run-stream-source-txt2img',
          capability: 'txt2img',
          path: join(mocks.workbenchRoot, 'stream-source-1.png'),
          printId: 'pri-stream-source-1',
          artifactId: 'art-stream-source-1',
          prompt: 'p1',
          sourceArtifactIds: [],
        })
        return finishSource.promise
      },
    )
    mocks.runComfyuiMattingBatch.mockImplementationOnce(
      async (input: { sourceImagePaths: string[]; taskId: string }) => {
        mattingStarted.resolve()
        expect(input.sourceImagePaths).toEqual([join(mocks.workbenchRoot, 'stream-source-1.png')])
        return finishMatting.promise
      },
    )

    const service = new PipelineService()
    const runPromise = service.runPipeline('run-stream-source-matting', {
      ...baseConfig('/unused'),
      source: {
        mode: 'txt2img',
        provider: 'grsai',
        prompt: { mode: 'manual', prompts: ['p1', 'p2'] },
        grsai: {
          model: 'gpt-image-2',
          aspectRatio: '1024x1024',
        },
      },
      matting: {
        enabled: true,
        mode: 'comfyui',
        workflowId: 'matting-workflow',
      },
      detection: {
        enabled: false,
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

    await sourceStarted.promise
    await mattingStarted.promise
    expect(mocks.runComfyuiMattingBatch).toHaveBeenCalledTimes(1)

    finishMatting.resolve({
      taskId: 'run-stream-source-matting-matting-pri-stream-source-1',
      total: 1,
      succeeded: 1,
      failed: 0,
      images: [
        {
          prompt: 'matted',
          url: 'file://stream-matted-1.png',
          localPath: join(mocks.workbenchRoot, 'stream-matted-1.png'),
          sourcePath: join(mocks.workbenchRoot, 'stream-source-1.png'),
          artifactId: 'art-stream-matted-1',
          printId: 'pri-stream-matted-1',
        },
      ],
      failures: [],
    })
    finishSource.resolve({
      taskId: 'run-stream-source-matting-txt2img',
      total: 2,
      succeeded: 1,
      failed: 1,
      images: [
        {
          prompt: 'p1',
          url: 'file://stream-source-1.png',
          localPath: join(mocks.workbenchRoot, 'stream-source-1.png'),
          artifactId: 'art-stream-source-1',
          printId: 'pri-stream-source-1',
        },
      ],
      failures: [{ prompt: 'p2', error: 'second image failed' }],
    })

    const detail = await runPromise
    expect(detail.run.status).toBe('completed')
    expect(
      detail.items?.find(
        (item) => item.step_key === 'source' && item.item_key === 'pri-stream-source-1',
      ),
    ).toMatchObject({
      status: 'completed',
      output_path: join(mocks.workbenchRoot, 'stream-source-1.png'),
    })
    expect(
      detail.items?.find(
        (item) => item.step_key === 'matting' && item.item_key === 'pri-stream-source-1',
      ),
    ).toMatchObject({
      status: 'completed',
      output_path: join(mocks.workbenchRoot, 'stream-matted-1.png'),
    })
    expect(
      detail.result_sections?.find((section) => section.key === 'source_images')?.items[0]
        ?.local_path,
    ).toBe(join(mocks.workbenchRoot, 'stream-source-1.png'))
    expect(
      detail.result_sections?.find((section) => section.key === 'source_images')?.items[0]?.prompt,
    ).toBe('p1')
    expect(imageProcessingSection(detail)?.items[0]?.local_path).toBe(
      join(mocks.workbenchRoot, 'stream-matted-1.png'),
    )
    expect(imageProcessingSection(detail)?.items[0]?.prompt).toBe('p1')
  })

  it('serializes source and matting on the same ComfyUI instance instead of failing with a lock conflict', async () => {
    const sourceCalls: string[] = []
    const mattingCalls: string[] = []
    mocks.runComfyuiTxt2imgBatch.mockImplementationOnce(
      async (input, dependencies?: GenerationBatchDependencies) => {
        sourceCalls.push(input.taskId ?? 'txt2img')
        await dependencies?.onImageComplete?.({
          taskId: input.taskId ?? 'run-same-instance-txt2img',
          capability: 'txt2img',
          path: join(mocks.workbenchRoot, 'same-instance-source.png'),
          printId: 'pri-same-instance-source',
          artifactId: 'art-same-instance-source',
          sourceArtifactIds: [],
        })
        return {
          taskId: input.taskId ?? 'run-same-instance-txt2img',
          total: 1,
          succeeded: 1,
          failed: 0,
          images: [
            {
              prompt: input.prompts[0] ?? '',
              url: 'file://same-instance-source.png',
              localPath: join(mocks.workbenchRoot, 'same-instance-source.png'),
              artifactId: 'art-same-instance-source',
              printId: 'pri-same-instance-source',
            },
          ],
          failures: [],
        }
      },
    )
    mocks.runComfyuiMattingBatch.mockImplementationOnce(async (input) => {
      mattingCalls.push(input.taskId)
      return mockMattingResult({
        taskId: input.taskId,
        sourcePath: join(mocks.workbenchRoot, 'same-instance-source.png'),
        outputPath: join(mocks.workbenchRoot, 'same-instance-matted.png'),
        artifactId: 'art-same-instance-matted',
        printId: 'pri-same-instance-matted',
        prompt: 'matted',
      })
    })

    const service = new PipelineService()
    const detail = await service.runPipeline('run-same-instance-stream', {
      ...baseConfig('/unused'),
      source: {
        mode: 'txt2img',
        provider: 'comfyui-chenyu',
        prompt: { mode: 'manual', prompts: ['same instance flower'] },
        comfyui: {
          workflowId: 'wf-same-instance-source',
          instanceUuid: 'instance-same',
        },
      },
      matting: {
        enabled: true,
        mode: 'comfyui',
        workflowId: 'wf-same-instance-matting',
        instanceUuid: 'instance-same',
      },
      detection: {
        enabled: false,
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

    expect(detail.run.status).toBe('completed')
    expect(sourceCalls).toEqual(['run-same-instance-stream-txt2img-1'])
    expect(mattingCalls).toEqual(['run-same-instance-stream-matting-pri-same-instance-source'])
    expect(detail.items?.find((item) => item.step_key === 'matting')).toMatchObject({
      status: 'completed',
      output_path: join(mocks.workbenchRoot, 'same-instance-matted.png'),
    })
  })

  it('streams matting outputs into detection and splits passed and blocked items without blocking later prints', async () => {
    const sourceStarted = createDeferred<void>()
    const detectionCalls: string[] = []
    const firstDetectionFinished = createDeferred<void>()
    const secondDetectionGate = createDeferred<void>()

    mocks.runTxt2imgBatch.mockImplementationOnce(
      async (input: Txt2imgMockInput, dependencies?: GenerationBatchDependencies) => {
        sourceStarted.resolve()
        await dependencies?.onImageComplete?.({
          taskId: input.taskId ?? 'run-stream-detection-txt2img',
          capability: 'txt2img',
          path: join(mocks.workbenchRoot, 'stream-detect-source-1.png'),
          printId: 'pri-stream-detect-source-1',
          artifactId: 'art-stream-detect-source-1',
          sourceArtifactIds: [],
        })
        await dependencies?.onImageComplete?.({
          taskId: input.taskId ?? 'run-stream-detection-txt2img',
          capability: 'txt2img',
          path: join(mocks.workbenchRoot, 'stream-detect-source-2.png'),
          printId: 'pri-stream-detect-source-2',
          artifactId: 'art-stream-detect-source-2',
          sourceArtifactIds: [],
        })
        return {
          taskId: input.taskId ?? 'run-stream-detection-txt2img',
          total: 2,
          succeeded: 2,
          failed: 0,
          images: [
            {
              prompt: 'p1',
              url: 'file://stream-detect-source-1.png',
              localPath: join(mocks.workbenchRoot, 'stream-detect-source-1.png'),
              artifactId: 'art-stream-detect-source-1',
              printId: 'pri-stream-detect-source-1',
            },
            {
              prompt: 'p2',
              url: 'file://stream-detect-source-2.png',
              localPath: join(mocks.workbenchRoot, 'stream-detect-source-2.png'),
              artifactId: 'art-stream-detect-source-2',
              printId: 'pri-stream-detect-source-2',
            },
          ],
          failures: [],
        }
      },
    )
    mocks.runComfyuiMattingBatch.mockImplementation(async (input) => {
      const sourcePath = input.sourceImagePaths[0] ?? ''
      const suffix = sourcePath.endsWith('1.png') ? '1' : '2'
      return mockMattingResult({
        taskId: input.taskId,
        sourcePath,
        outputPath: join(mocks.workbenchRoot, `stream-detect-matted-${suffix}.png`),
        artifactId: `art-stream-detect-matted-${suffix}`,
        printId: `pri-stream-detect-matted-${suffix}`,
        prompt: `matted-${suffix}`,
      })
    })
    mocks.runDetectionBatch.mockImplementation(async (input) => {
      const imagePath = input.imagePaths[0] ?? ''
      detectionCalls.push(imagePath)
      if (imagePath.endsWith('matted-1.png')) {
        firstDetectionFinished.resolve()
        return {
          taskId: 'run-stream-detection-detection-1',
          total: 1,
          succeeded: 1,
          failed: 0,
          skipped: 0,
          results: [
            {
              imagePath,
              thumbnailUrl: '',
              artifactId: 'art-stream-detect-matted-1',
              printId: 'pri-stream-detect-matted-1',
              status: 'success' as const,
              riskScore: 88,
              riskLevel: 'block' as const,
              reason: '高风险',
              outputPath: join(mocks.workbenchRoot, 'detected-block-1.png'),
              cached: false,
            },
          ],
        }
      }
      await secondDetectionGate.promise
      return {
        taskId: 'run-stream-detection-detection-2',
        total: 1,
        succeeded: 1,
        failed: 0,
        skipped: 0,
        results: [
          {
            imagePath,
            thumbnailUrl: '',
            artifactId: 'art-stream-detect-matted-2',
            printId: 'pri-stream-detect-matted-2',
            status: 'success' as const,
            riskScore: 12,
            riskLevel: 'pass' as const,
            reason: '低风险',
            outputPath: join(mocks.workbenchRoot, 'detected-pass-2.png'),
            cached: false,
          },
        ],
      }
    })

    const service = new PipelineService()
    const runPromise = service.runPipeline('run-stream-matting-detection', {
      ...baseConfig('/unused'),
      source: {
        mode: 'txt2img',
        provider: 'grsai',
        prompt: { mode: 'manual', prompts: ['p1', 'p2'] },
        grsai: {
          model: 'gpt-image-2',
          aspectRatio: '1024x1024',
        },
      },
      matting: {
        enabled: true,
        mode: 'comfyui',
        workflowId: 'matting-workflow',
      },
      detection: {
        enabled: true,
        allowReview: false,
        skillId: 'infringement-detection',
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

    await sourceStarted.promise
    secondDetectionGate.resolve()
    const detail = await runPromise

    expect(detail.run.status).toBe('completed')
    expect(mocks.runComfyuiMattingBatch).toHaveBeenCalledTimes(2)
    expect(detectionCalls).toEqual([
      join(mocks.workbenchRoot, 'stream-detect-matted-1.png'),
      join(mocks.workbenchRoot, 'stream-detect-matted-2.png'),
    ])
    expect(mocks.runDetectionBatch.mock.calls.map((call) => call[0]?.taskId)).toEqual([
      '完整任务测试',
      '完整任务测试',
    ])
    expect(
      detail.result_sections?.find((section) => section.key === 'detection_blocked'),
    ).toMatchObject({
      completed: 1,
      items: [expect.objectContaining({ print_id: 'pri-stream-detect-matted-1' })],
    })
    expect(
      detail.result_sections?.find((section) => section.key === 'detection_passed'),
    ).toMatchObject({
      completed: 1,
      items: [expect.objectContaining({ print_id: 'pri-stream-detect-matted-2' })],
    })
    expect(
      detail.items?.find(
        (item) => item.step_key === 'detection' && item.item_key === 'pri-stream-detect-source-1',
      ),
    ).toMatchObject({ status: 'filtered' })
    expect(
      detail.items?.find(
        (item) => item.step_key === 'detection' && item.item_key === 'pri-stream-detect-source-2',
      ),
    ).toMatchObject({
      status: 'completed',
      output_path: join(mocks.workbenchRoot, 'detected-pass-2.png'),
    })
  })

  it('uses one complete-task folder for streaming ComfyUI img2img outputs', async () => {
    const sourceFolder = join(mocks.workbenchRoot, 'img2img-task-folder-source')
    await createPrint(join(sourceFolder, 'a.png'))
    await createPrint(join(sourceFolder, 'b.png'))

    const service = new PipelineService()
    const detail = await service.runPipeline('run-img2img-task-folder', {
      ...baseConfig('/unused'),
      name: '夏季印花任务',
      source: {
        mode: 'img2img',
        provider: 'comfyui-chenyu',
        sourceFolder,
        comfyui: {
          workflowId: 'wf-img2img',
          batchSize: 2,
        },
      },
      matting: { ...baseConfig('/unused').matting, enabled: false },
      detection: { enabled: false },
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

    expect(detail.run.status).toBe('completed')
    expect(
      detail.result_sections
        ?.find((section) => section.key === 'image_processing')
        ?.items.map((item) => item.local_path),
    ).toEqual([
      mockGenerationOutputPath('图生图', '夏季印花任务', 0),
      mockGenerationOutputPath('图生图', '夏季印花任务', 1),
      mockGenerationOutputPath('图生图', '夏季印花任务', 2),
      mockGenerationOutputPath('图生图', '夏季印花任务', 3),
    ])
  })

  it('streams detection outputs into Photoshop with arrival-order waiting names and per-template failure isolation', async () => {
    const sourceStarted = createDeferred<void>()
    const firstPhotoshopEntered = createDeferred<void>()
    const releaseFirstPhotoshop = createDeferred<void>()
    const runBatchCalls: string[] = []

    mocks.runTxt2imgBatch.mockImplementationOnce(
      async (input: Txt2imgMockInput, dependencies?: GenerationBatchDependencies) => {
        sourceStarted.resolve()
        await createPrint(join(mocks.workbenchRoot, 'stream-ps-source-2.png'))
        await dependencies?.onImageComplete?.({
          taskId: input.taskId ?? 'run-stream-photoshop-txt2img',
          capability: 'txt2img',
          path: join(mocks.workbenchRoot, 'stream-ps-source-2.png'),
          printId: 'pri-stream-ps-source-2',
          artifactId: 'art-stream-ps-source-2',
          sourceArtifactIds: [],
        })
        await createPrint(join(mocks.workbenchRoot, 'stream-ps-source-1.png'))
        await dependencies?.onImageComplete?.({
          taskId: input.taskId ?? 'run-stream-photoshop-txt2img',
          capability: 'txt2img',
          path: join(mocks.workbenchRoot, 'stream-ps-source-1.png'),
          printId: 'pri-stream-ps-source-1',
          artifactId: 'art-stream-ps-source-1',
          sourceArtifactIds: [],
        })
        return {
          taskId: input.taskId ?? 'run-stream-photoshop-txt2img',
          total: 2,
          succeeded: 2,
          failed: 0,
          images: [
            {
              prompt: 'p2',
              url: 'file://stream-ps-source-2.png',
              localPath: join(mocks.workbenchRoot, 'stream-ps-source-2.png'),
              artifactId: 'art-stream-ps-source-2',
              printId: 'pri-stream-ps-source-2',
            },
            {
              prompt: 'p1',
              url: 'file://stream-ps-source-1.png',
              localPath: join(mocks.workbenchRoot, 'stream-ps-source-1.png'),
              artifactId: 'art-stream-ps-source-1',
              printId: 'pri-stream-ps-source-1',
            },
          ],
          failures: [],
        }
      },
    )
    mocks.runComfyuiMattingBatch.mockImplementation(async (input) => {
      const sourcePath = input.sourceImagePaths[0] ?? ''
      return mockMattingResult({
        taskId: input.taskId,
        sourcePath,
        outputPath: sourcePath,
        artifactId: `art-${basename(sourcePath, '.png')}`,
        printId: `pri-${basename(sourcePath, '.png')}`,
        prompt: 'matted',
      })
    })
    mocks.runDetectionBatch.mockImplementation(async (input) => ({
      taskId: `detect-${basename(input.imagePaths[0] ?? '', '.png')}`,
      total: 1,
      succeeded: 1,
      failed: 0,
      skipped: 0,
      results: [
        {
          imagePath: input.imagePaths[0] ?? '',
          thumbnailUrl: '',
          artifactId: `art-detected-${basename(input.imagePaths[0] ?? '', '.png')}`,
          printId: `pri-detected-${basename(input.imagePaths[0] ?? '', '.png')}`,
          status: 'success' as const,
          riskScore: 12,
          riskLevel: 'pass' as const,
          reason: '低风险',
          outputPath: input.imagePaths[0] ?? '',
          cached: false,
        },
      ],
    }))
    mocks.runBatch.mockImplementation(
      async (
        prints: PhotoshopPrintAsset[],
        templates: unknown,
        config: {
          taskId: string
          outputRoot: string
          outputLayout: PhotoshopOutputLayout
        },
      ) => {
        const templatePath = Array.isArray(templates) ? String(templates[0] ?? '') : ''
        const printId = prints[0]?.id ?? 'print'
        runBatchCalls.push(`${printId}:${windowsBaseName(templatePath).replace(/\.psd$/i, '')}`)
        if (runBatchCalls.length === 1) {
          firstPhotoshopEntered.resolve()
          await releaseFirstPhotoshop.promise
        }
        if (
          windowsBaseName(templatePath).replace(/\.psd$/i, '') === 'mug' &&
          printId === 'GYX-0002'
        ) {
          throw new Error('mug failed')
        }
        const templateName = windowsBaseName(templatePath).replace(/\.psd$/i, '')
        const outputPath = join(config.outputRoot, templateName, printId, '01.jpg')
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
              template_id: `tpl-${templateName}`,
              template_name: templateName,
              groups_total: 1,
              groups_completed: 1,
              outputs: [outputPath],
            },
          ],
          result_groups: [
            {
              template_id: `tpl-${templateName}`,
              template_name: templateName,
              group_index: 0,
              sku_folder: printId,
              print_ids: [printId],
              outputs: [outputPath],
            },
          ],
        }
      },
    )

    const service = new PipelineService()
    const runPromise = service.runPipeline('run-stream-photoshop', {
      ...baseConfig('/unused'),
      printSkuCode: 'GYX',
      source: {
        mode: 'txt2img',
        provider: 'grsai',
        prompt: { mode: 'manual', prompts: ['p2', 'p1'] },
        grsai: {
          model: 'gpt-image-2',
          aspectRatio: '1024x1024',
        },
      },
      matting: {
        enabled: true,
        mode: 'comfyui',
        workflowId: 'matting-workflow',
      },
      detection: {
        enabled: true,
        allowReview: false,
        skillId: 'infringement-detection',
        model: 'qwen3-vl-flash',
      },
      photoshop: {
        ...baseConfig('/unused').photoshop,
        enabled: true,
        templates: ['C:\\templates\\mug.psd', 'C:\\templates\\shirt.psd'],
      },
      title: {
        ...baseConfig('/unused').title,
        enabled: false,
      },
    })

    await sourceStarted.promise
    await vi.waitUntil(() => mocks.runBatch.mock.calls.length > 0)
    await firstPhotoshopEntered.promise
    releaseFirstPhotoshop.resolve()

    const detail = await runPromise

    expect(detail.run.status).toBe('completed')
    expect(runBatchCalls).toEqual([
      'GYX-0001:mug',
      'GYX-0001:shirt',
      'GYX-0002:mug',
      'GYX-0002:shirt',
    ])
    await expect(
      readFile(
        join(
          mocks.workbenchRoot,
          WORKBENCH_DIRECTORIES.generation,
          '等待套版',
          'run-stream-photoshop',
          'GYX-0001.png',
        ),
        'utf8',
      ),
    ).resolves.toBe('image')
    await expect(
      readFile(
        join(
          mocks.workbenchRoot,
          WORKBENCH_DIRECTORIES.generation,
          '等待套版',
          'run-stream-photoshop',
          'GYX-0002.png',
        ),
        'utf8',
      ),
    ).resolves.toBe('image')
    expect(
      detail.result_sections?.find((section) => section.key === 'print_products'),
    ).toMatchObject({
      completed: 3,
      items: [
        expect.objectContaining({
          local_path: join(
            mocks.workbenchRoot,
            WORKBENCH_DIRECTORIES.listing,
            'mug',
            'GYX-0001',
            '01.jpg',
          ),
        }),
        expect.objectContaining({
          local_path: join(
            mocks.workbenchRoot,
            WORKBENCH_DIRECTORIES.listing,
            'shirt',
            'GYX-0001',
            '01.jpg',
          ),
        }),
        expect.objectContaining({
          local_path: join(
            mocks.workbenchRoot,
            WORKBENCH_DIRECTORIES.listing,
            'shirt',
            'GYX-0002',
            '01.jpg',
          ),
        }),
      ],
    })
    expect(
      detail.items?.find(
        (item) => item.step_key === 'photoshop' && item.item_key.includes('pri-stream-ps-source-2'),
      ),
    ).toMatchObject({
      status: 'completed',
    })
    expect(
      detail.items?.find(
        (item) =>
          item.step_key === 'photoshop' &&
          item.item_key.includes('pri-stream-ps-source-1') &&
          item.status === 'failed',
      ),
    ).toMatchObject({
      error_message: 'mug failed',
    })
  })

  it('streams Photoshop outputs into title generation without waiting for the full batch', async () => {
    const sourceStarted = createDeferred<void>()
    const firstTitleStarted = createDeferred<void>()
    const releaseFirstTitle = createDeferred<void>()
    const titleCalls: string[] = []

    mocks.runTxt2imgBatch.mockImplementationOnce(
      async (input: Txt2imgMockInput, dependencies?: GenerationBatchDependencies) => {
        sourceStarted.resolve()
        await createPrint(join(mocks.workbenchRoot, 'stream-title-source-2.png'))
        await dependencies?.onImageComplete?.({
          taskId: input.taskId ?? 'run-stream-title-txt2img',
          capability: 'txt2img',
          path: join(mocks.workbenchRoot, 'stream-title-source-2.png'),
          printId: 'pri-stream-title-source-2',
          artifactId: 'art-stream-title-source-2',
          sourceArtifactIds: [],
        })
        await createPrint(join(mocks.workbenchRoot, 'stream-title-source-1.png'))
        await dependencies?.onImageComplete?.({
          taskId: input.taskId ?? 'run-stream-title-txt2img',
          capability: 'txt2img',
          path: join(mocks.workbenchRoot, 'stream-title-source-1.png'),
          printId: 'pri-stream-title-source-1',
          artifactId: 'art-stream-title-source-1',
          sourceArtifactIds: [],
        })
        return {
          taskId: input.taskId ?? 'run-stream-title-txt2img',
          total: 2,
          succeeded: 2,
          failed: 0,
          images: [
            {
              prompt: 'p2',
              url: 'file://stream-title-source-2.png',
              localPath: join(mocks.workbenchRoot, 'stream-title-source-2.png'),
              artifactId: 'art-stream-title-source-2',
              printId: 'pri-stream-title-source-2',
            },
            {
              prompt: 'p1',
              url: 'file://stream-title-source-1.png',
              localPath: join(mocks.workbenchRoot, 'stream-title-source-1.png'),
              artifactId: 'art-stream-title-source-1',
              printId: 'pri-stream-title-source-1',
            },
          ],
          failures: [],
        }
      },
    )
    mocks.runComfyuiMattingBatch.mockImplementation(async (input) => {
      const sourcePath = input.sourceImagePaths[0] ?? ''
      return mockMattingResult({
        taskId: input.taskId,
        sourcePath,
        outputPath: sourcePath,
        artifactId: `art-${basename(sourcePath, '.png')}`,
        printId: `pri-${basename(sourcePath, '.png')}`,
        prompt: 'matted',
      })
    })
    mocks.runDetectionBatch.mockImplementation(async (input) => ({
      taskId: `detect-${basename(input.imagePaths[0] ?? '', '.png')}`,
      total: 1,
      succeeded: 1,
      failed: 0,
      skipped: 0,
      results: [
        {
          imagePath: input.imagePaths[0] ?? '',
          thumbnailUrl: '',
          artifactId: `art-detected-${basename(input.imagePaths[0] ?? '', '.png')}`,
          printId: `pri-detected-${basename(input.imagePaths[0] ?? '', '.png')}`,
          status: 'success' as const,
          riskScore: 8,
          riskLevel: 'pass' as const,
          reason: '低风险',
          outputPath: input.imagePaths[0] ?? '',
          cached: false,
        },
      ],
    }))
    mocks.runBatch.mockImplementation(
      async (
        prints: PhotoshopPrintAsset[],
        templates: unknown,
        config: {
          taskId: string
          outputRoot: string
          outputLayout: PhotoshopOutputLayout
        },
      ) => {
        const templateName = windowsBaseName(
          String(Array.isArray(templates) ? templates[0] : 'shirt'),
        ).replace(/\.psd$/i, '')
        const printId = prints[0]?.id ?? 'print'
        const outputPath = join(config.outputRoot, templateName, printId, '01.jpg')
        await createTitleProductImage(outputPath)
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
              template_id: `tpl-${templateName}`,
              template_name: templateName,
              groups_total: 1,
              groups_completed: 1,
              outputs: [outputPath],
            },
          ],
          result_groups: [
            {
              template_id: `tpl-${templateName}`,
              template_name: templateName,
              group_index: 0,
              sku_folder: printId,
              print_ids: [printId],
              outputs: [outputPath],
            },
          ],
        }
      },
    )
    const service = new PipelineService()
    mocks.createTitleProcessingSession.mockResolvedValueOnce({
      taskId: 'run-stream-title-title-stream',
      model: 'qwen3.6-flash',
      skill: {
        id: 'title-temu-en',
        module: 'title',
        category: null,
        platform: 'temu',
        language: 'en',
        version: '1',
        enabled: true,
        recommendedModel: 'qwen3.6-flash',
        notes: null,
        systemPrompt: 'prompt',
        variables: [],
      },
      workbenchRoot: mocks.workbenchRoot,
      appendDiagnosticLog: vi.fn(async () => undefined),
      generateSku: vi.fn(async ({ skuCode }: { skuCode: string }) => {
        titleCalls.push(skuCode)
        if (titleCalls.length === 1) {
          firstTitleStarted.resolve()
          await releaseFirstTitle.promise
        }
        return {
          skuCode,
          status: 'success' as const,
          baseTitle: `Base ${skuCode}`,
          imagePath: join(
            mocks.workbenchRoot,
            WORKBENCH_DIRECTORIES.listing,
            'shirt',
            skuCode,
            '01.jpg',
          ),
        }
      }),
      close: vi.fn(async () => undefined),
    })

    const runPromise = service.runPipeline('run-stream-title', {
      ...baseConfig('/unused'),
      printSkuCode: 'GYX',
      source: {
        mode: 'txt2img',
        provider: 'grsai',
        prompt: { mode: 'manual', prompts: ['p2', 'p1'] },
        grsai: {
          model: 'gpt-image-2',
          aspectRatio: '1024x1024',
        },
      },
      matting: {
        enabled: true,
        mode: 'comfyui',
        workflowId: 'matting-workflow',
      },
      detection: {
        enabled: true,
        allowReview: false,
        skillId: 'infringement-detection',
        model: 'qwen3-vl-flash',
      },
      photoshop: {
        ...baseConfig('/unused').photoshop,
        enabled: true,
        templates: ['C:\\templates\\shirt.psd'],
      },
      title: {
        ...baseConfig('/unused').title,
        enabled: true,
      },
    })

    await sourceStarted.promise
    await firstTitleStarted.promise
    expect(titleCalls).toEqual(['GYX-0001'])
    releaseFirstTitle.resolve()

    const detail = await runPromise

    expect(detail.run.status).toBe('completed')
    expect(titleCalls).toEqual(['GYX-0001', 'GYX-0002'])
    expect(detail.steps.find((step) => step.step_key === 'title')).toMatchObject({
      status: 'completed',
      output_count: 2,
    })
    expect(
      detail.items?.find(
        (item) => item.step_key === 'title' && item.item_key.includes('pri-stream-title-source-2'),
      ),
    ).toMatchObject({
      status: 'completed',
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
    mocks.runTxt2imgBatch.mockImplementationOnce(
      async (_input: Txt2imgMockInput, dependencies?: GenerationBatchDependencies) => {
        for (const image of generatedImages) {
          if (!image.localPath || !image.printId || !image.artifactId) {
            throw new Error('generatedImages fixture is incomplete')
          }
          await dependencies?.onImageComplete?.({
            taskId: 'run-img2img-detection-img2img',
            capability: 'img2img',
            path: image.localPath,
            printId: image.printId,
            artifactId: image.artifactId,
            sourceArtifactIds: [],
          })
        }
        return {
          taskId: 'run-img2img-detection-img2img',
          total: 2,
          succeeded: 2,
          failed: 0,
          images: generatedImages,
          failures: [],
        }
      },
    )
    mocks.runDetectionBatch.mockImplementation(
      async (input: {
        imagePaths: string[]
        imageInputs?: Array<{ path: string; artifactId?: string; printId?: string }>
      }) => {
        expect(input.imagePaths).toHaveLength(1)
        expect(input.imageInputs).toHaveLength(1)
        const imagePath = input.imagePaths[0] ?? ''
        const inputItem = input.imageInputs?.[0]
        if (imagePath.endsWith('img2img-pass.png')) {
          expect(inputItem).toMatchObject({
            path: generatedImages[0]?.localPath,
            artifactId: 'art-img2img-pass',
            printId: 'pri-img2img-pass',
          })
          return {
            taskId: 'run-img2img-detection-detection-pass',
            total: 1,
            succeeded: 1,
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
            ],
          }
        }
        expect(inputItem).toMatchObject({
          path: generatedImages[1]?.localPath,
          artifactId: 'art-img2img-block',
          printId: 'pri-img2img-block',
        })
        return {
          taskId: 'run-img2img-detection-detection-block',
          total: 1,
          succeeded: 1,
          failed: 0,
          skipped: 0,
          results: [
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
      },
    )

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
    mocks.runDetectionBatch.mockImplementation(async (input) => {
      const imagePath = input.imagePaths[0] ?? ''
      if (imagePath.endsWith('pass.png')) {
        return {
          taskId: 'run-detection-sections-detection-pass',
          total: 1,
          succeeded: 1,
          failed: 0,
          skipped: 0,
          results: [
            {
              imagePath,
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
          ],
        }
      }
      if (imagePath.endsWith('review.png')) {
        return {
          taskId: 'run-detection-sections-detection-review',
          total: 1,
          succeeded: 1,
          failed: 0,
          skipped: 0,
          results: [
            {
              imagePath,
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
          ],
        }
      }
      return {
        taskId: 'run-detection-sections-detection-block',
        total: 1,
        succeeded: 1,
        failed: 0,
        skipped: 0,
        results: [
          {
            imagePath,
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
      }
    })

    const service = new PipelineService()
    await service.runPipeline('run-detection-sections', {
      ...baseConfig(printFolder),
      source: existingPrintSource(printFolder, 'detection'),
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
      items: expect.arrayContaining([
        expect.objectContaining({ print_id: 'pri-review' }),
        expect.objectContaining({ print_id: 'pri-block' }),
      ]),
    })
  })

  it('accepts ComfyUI txt2img sources at the IPC schema boundary', async () => {
    registerPipelineIpc()
    const handler = mocks.ipcHandlers.get('pipeline:run')
    if (!handler) {
      throw new Error('pipeline:run handler was not registered')
    }

    const runId = handler(
      {},
      {
        ...baseConfig('/prints'),
        source: {
          mode: 'txt2img',
          provider: 'comfyui-chenyu',
          prompt: { mode: 'manual', prompts: ['flower'] },
          comfyui: { workflowId: 'wf' },
        },
        photoshop: {
          ...baseConfig('/prints').photoshop,
          enabled: false,
          templates: [],
        },
        title: {
          ...baseConfig('/prints').title,
          enabled: false,
        },
      },
    )

    expect(runId).toEqual(expect.any(String))
    await vi.waitUntil(
      () =>
        pipelineService.getActiveRunCount() === 0 &&
        mocks.sentEvents.some((event) => {
          const payload = event.payload as { result?: { run?: { id?: string } } }
          return event.channel === 'pipeline:completed' && payload.result?.run?.id === runId
        }),
    )
  })

  it('rejects print sku codes that are empty after filename sanitization at the IPC schema boundary', () => {
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
          printSkuCode: '\u0001 . ',
        },
      ),
    ).toThrow('完整任务参数无效')
  })

  it('rejects empty resume run ids at the IPC schema boundary', () => {
    registerPipelineIpc()
    const handler = mocks.ipcHandlers.get('pipeline:resume')
    if (!handler) {
      throw new Error('pipeline:resume handler was not registered')
    }

    expect(() => handler({}, { run_id: '' })).toThrow('完整任务 ID 无效')
  })
})
