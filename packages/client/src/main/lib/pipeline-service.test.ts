import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, extname, join } from 'node:path'
import {
  AppErrorClass,
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
import type {
  PipelinePrintStage,
  PipelinePrintStreamItem,
  PipelineStageRuntimeContext,
} from './pipeline-stage-types'
import { type TitleBatchResult, writeTitlesXlsx } from './title-service'
import { openWorkbenchDatabase, workbenchDatabasePath } from './workbench-db'

const originalPlatform = Object.getOwnPropertyDescriptor(process, 'platform')

type GenerationBatchDependencies = {
  emitProgress?: (progress: GenerationProgress) => void
  strictImageComplete?: boolean
  onImageComplete?: (payload: {
    taskId: string
    capability: 'txt2img' | 'img2img' | 'extract' | 'matting'
    path: string
    printId: string
    artifactId?: string
    prompt?: string
    sourcePath?: string
    sourceArtifactIds: string[]
    inputIndex?: number
    outputIndex?: number
  }) => void | Promise<void>
  onPromptResolved?: (payload: {
    taskId: string
    capability: 'img2img'
    inputIndex: number
    sourcePath: string
    sourceArtifactId: string
    prompt: string
  }) => void | Promise<void>
}

type Txt2imgMockInput = {
  capability?: 'txt2img' | 'img2img'
  prompts: string[]
  taskId?: string
  outputTaskName?: string
  filenameStartIndex?: number
  inputIndexes?: number[]
}

type ComfyuiMockInput = {
  sourceImagePaths?: string[]
  prompts?: string[]
  batchSize?: number
  taskId?: string
  outputTaskName?: string
  filenameStartIndex?: number
  inputIndexes?: number[]
  outputIndexes?: number[]
  resolvedPrompt?: string
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
  writeTitlesXlsx: vi.fn(),
  cancelTitleTask: vi.fn(),
  requestGenerationCancel: vi.fn(),
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
      for (const [index, image] of images.entries()) {
        await dependencies?.onImageComplete?.({
          taskId: input.taskId,
          capability: 'extract',
          path: image.localPath,
          printId: image.printId,
          artifactId: image.artifactId,
          ...(input.sourceImagePaths[index] ? { sourcePath: input.sourceImagePaths[index] } : {}),
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
  runComfyuiTxt2imgBatch: vi.fn(async (input: Txt2imgMockInput): Promise<GenerationRunResult> => {
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
    writeTitlesXlsx: (...args: Parameters<typeof actual.writeTitlesXlsx>) => {
      if (mocks.writeTitlesXlsx.getMockImplementation()) {
        return mocks.writeTitlesXlsx(...args)
      }
      return actual.writeTitlesXlsx(...args)
    },
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
  requestGenerationCancel: mocks.requestGenerationCancel,
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

function createPhotoshopBatchResultForTemplate(
  prints: PhotoshopPrintAsset[],
  templatePath: string,
  config: {
    taskId: string
    outputRoot: string
    outputLayout: PhotoshopOutputLayout
  },
) {
  const printId = prints[0]?.id ?? 'print'
  const templateName = basename(windowsBaseName(templatePath), extname(templatePath)) || 'template'
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

function requireString(value: string | null | undefined, message: string) {
  if (!value) {
    throw new Error(message)
  }
  return value
}

function requireStringArray(value: unknown, message: string) {
  if (!Array.isArray(value) || !value.every((item): item is string => typeof item === 'string')) {
    throw new Error(message)
  }
  return value
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

function rewriteRunConfigForTest(
  runId: string,
  rewrite: (config: PipelineRunConfig) => PipelineRunConfig,
) {
  const db = openWorkbenchDatabase(workbenchDatabasePath(mocks.workbenchRoot))
  try {
    const row = db.prepare('SELECT config_json FROM pipeline_runs WHERE id = ?').get(runId) as
      | { config_json?: unknown }
      | undefined
    if (typeof row?.config_json !== 'string') {
      throw new Error(`missing pipeline config for ${runId}`)
    }
    const config = JSON.parse(row.config_json) as PipelineRunConfig
    db.prepare('UPDATE pipeline_runs SET config_json = ? WHERE id = ?').run(
      JSON.stringify(rewrite(config)),
      runId,
    )
  } finally {
    db.close()
  }
}

function markSourceStepInterruptedForTest(runId: string) {
  const db = openWorkbenchDatabase(workbenchDatabasePath(mocks.workbenchRoot))
  try {
    db.prepare(
      "UPDATE pipeline_steps SET status = 'interrupted' WHERE run_id = ? AND step_key = 'source'",
    ).run(runId)
  } finally {
    db.close()
  }
}

type ResumeCapablePipelineService = PipelineService & {
  resumeRun(runId: string): Promise<Awaited<ReturnType<PipelineService['getRun']>>>
}

type PipelineServiceWithFlushHook = PipelineService & {
  flushRunUiState(runId: string, active: unknown): void
}

type PipelineServiceWithResumeStageHook = {
  createResumeAwareStage(
    db: ReturnType<typeof openWorkbenchDatabase>,
    stepKey: 'detection',
    stage: PipelinePrintStage,
    input: AsyncIterable<PipelinePrintStreamItem>,
    context: PipelineStageRuntimeContext,
    resumeState: unknown,
  ): AsyncIterable<PipelinePrintStreamItem>
}

describe('PipelineService', () => {
  beforeEach(async () => {
    setPlatform('win32')
    mocks.workbenchRoot = await mkdtemp(join(tmpdir(), 'tengyu-pipeline-service-'))
    mocks.ipcHandlers.clear()
    mocks.runBatch.mockClear()
    mocks.runTitleBatch.mockClear()
    mocks.writeTitlesXlsx.mockReset()
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
    mocks.requestGenerationCancel.mockReset()
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
    vi.useRealTimers()
    if (originalPlatform) {
      Object.defineProperty(process, 'platform', originalPlatform)
    }
    await rm(mocks.workbenchRoot, { recursive: true, force: true })
    collectionFolderLock.clearForTests()
    mocks.workbenchRoot = ''
  })

  it('rejects duplicate fire-and-forget starts for the same print sku', async () => {
    const printFolder = join(
      mocks.workbenchRoot,
      WORKBENCH_DIRECTORIES.generation,
      'duplicate-start',
    )
    await createPrint(join(printFolder, 'print.png'))
    const service = new PipelineService()
    const pendingRun = createDeferred<Awaited<ReturnType<PipelineService['getRun']>>>()
    vi.spyOn(service, 'runPipeline').mockReturnValue(
      pendingRun.promise as ReturnType<PipelineService['runPipeline']>,
    )

    const config = baseConfig(printFolder)
    const firstRunId = await service.startRun(config)

    expect(firstRunId).toEqual(expect.any(String))
    await expect(service.startRun(config)).rejects.toThrow('已有进行中完整任务')
  })

  it('rejects duplicate fire-and-forget resumes for the same run', () => {
    const service = new PipelineService() as ResumeCapablePipelineService
    const pendingResume = createDeferred<Awaited<ReturnType<PipelineService['getRun']>>>()
    vi.spyOn(service, 'resumeRun').mockReturnValue(
      pendingResume.promise as ReturnType<ResumeCapablePipelineService['resumeRun']>,
    )

    expect(service.startResume('run-duplicate-resume')).toBe('run-duplicate-resume')
    expect(() => service.startResume('run-duplicate-resume')).toThrow('正在运行')
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

  it('isolates Photoshop temp directory creation failures to the affected print', async () => {
    const printFolder = join(mocks.workbenchRoot, WORKBENCH_DIRECTORIES.generation, 'ready')
    await createPrint(join(printFolder, 'existing.png'))
    mocks.createTaskDir.mockRejectedValueOnce(new Error('temp directory denied'))

    const service = new PipelineService()
    const result = await service.runPipeline(
      'run-photoshop-temp-create-failed',
      baseConfig(printFolder),
    )

    expect(result.run.status).toBe('completed')
    expect(result.steps.find((step) => step.step_key === 'photoshop')).toMatchObject({
      status: 'completed',
      output_count: 0,
    })
    expect(result.logs?.find((entry) => entry.message === '单货号套版失败，已跳过')).toMatchObject({
      level: 'warn',
    })
    expect(mocks.runBatch).not.toHaveBeenCalled()
  })

  it('does not fail the pipeline when Photoshop temp cleanup fails', async () => {
    const printFolder = join(mocks.workbenchRoot, WORKBENCH_DIRECTORIES.generation, 'ready')
    await createPrint(join(printFolder, 'existing.png'))
    mocks.cleanupTask.mockRejectedValueOnce(new Error('temp cleanup denied'))

    const service = new PipelineService()
    const result = await service.runPipeline(
      'run-photoshop-temp-cleanup-failed',
      baseConfig(printFolder),
    )

    expect(result.run.status).toBe('completed')
    expect(result.steps.find((step) => step.step_key === 'photoshop')).toMatchObject({
      status: 'completed',
      output_count: 1,
    })
    expect(
      result.logs?.find((entry) => entry.message === 'PS 临时文件清理失败，已忽略'),
    ).toMatchObject({ level: 'warn' })
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
    expect(mocks.runBatch).toHaveBeenCalledOnce()
    expect(mocks.runBatch.mock.calls[0]?.[0]).toEqual([
      { id: 'GYX_0001', file_path: firstWaitingPrintPath },
      { id: 'GYX_0002', file_path: secondWaitingPrintPath },
    ])
  })

  it('micro-batches already queued topmost Photoshop prints into one template execution', async () => {
    const printFolder = join(mocks.workbenchRoot, WORKBENCH_DIRECTORIES.generation, 'queued')
    await createPrint(join(printFolder, 'existing-1.png'))
    await createPrint(join(printFolder, 'existing-2.png'))
    await createPrint(join(printFolder, 'existing-3.png'))
    const previousImplementation = mocks.runBatch.getMockImplementation()
    mocks.runBatch.mockImplementation(async (prints, _templates, config) => {
      const resultGroups = prints.map((print, groupIndex) => ({
        template_id: 'tpl-shirt',
        template_name: 'shirt',
        group_index: groupIndex,
        sku_folder: print.id,
        print_ids: [print.id],
        outputs: [join(config.outputRoot, 'shirt', print.id, '01.jpg')],
      }))
      return {
        ok: true,
        task_id: config.taskId,
        output_layout: config.outputLayout,
        templates_total: 1,
        groups_total: resultGroups.length,
        groups_completed: resultGroups.length,
        outputs: resultGroups.flatMap((group) => group.outputs),
        templates: [
          {
            template_id: 'tpl-shirt',
            template_name: 'shirt',
            groups_total: resultGroups.length,
            groups_completed: resultGroups.length,
            outputs: resultGroups.flatMap((group) => group.outputs),
          },
        ],
        result_groups: resultGroups,
      }
    })

    try {
      const service = new PipelineService()
      await service.runPipeline('run-photoshop-micro-batch', {
        ...baseConfig(printFolder),
        title: { ...baseConfig(printFolder).title, enabled: false },
      })

      expect(mocks.runBatch).toHaveBeenCalledTimes(1)
      expect(mocks.runBatch.mock.calls[0]?.[0]).toHaveLength(3)
    } finally {
      if (previousImplementation) {
        mocks.runBatch.mockImplementation(previousImplementation)
      }
    }
  })

  it('uses complete-task detection concurrency for already queued prints', async () => {
    const printFolder = join(mocks.workbenchRoot, WORKBENCH_DIRECTORIES.generation, 'detect-queued')
    await createPrint(join(printFolder, 'existing-1.png'))
    await createPrint(join(printFolder, 'existing-2.png'))
    await createPrint(join(printFolder, 'existing-3.png'))
    mocks.runDetectionBatch.mockImplementation(async (input) => ({
      taskId: input.taskId ?? 'detection-batch',
      total: input.imagePaths.length,
      succeeded: input.imagePaths.length,
      failed: 0,
      skipped: 0,
      results: input.imagePaths.map((imagePath: string, index: number) => ({
        imagePath,
        thumbnailUrl: '',
        artifactId: input.imageInputs?.[index]?.artifactId ?? `art-${index}`,
        printId: input.imageInputs?.[index]?.printId ?? `pri-${index}`,
        status: 'success' as const,
        riskScore: 5,
        riskLevel: 'pass' as const,
        reason: '低风险',
        outputPath: imagePath,
        cached: false,
      })),
    }))

    const service = new PipelineService()
    await service.runPipeline('run-detection-concurrency', {
      ...baseConfig(printFolder),
      source: existingPrintSource(printFolder, 'detection'),
      detection: {
        enabled: true,
        allowReview: true,
        skillId: 'infringement-detection',
        model: 'qwen3-vl-flash',
        concurrency: 3,
      },
      photoshop: { ...baseConfig(printFolder).photoshop, enabled: false },
      title: { ...baseConfig(printFolder).title, enabled: false },
    })

    expect(mocks.runDetectionBatch).toHaveBeenCalledOnce()
    expect(mocks.runDetectionBatch.mock.calls[0]?.[0]).toMatchObject({
      concurrency: 3,
      imagePaths: expect.arrayContaining([
        join(printFolder, 'existing-1.png'),
        join(printFolder, 'existing-2.png'),
        join(printFolder, 'existing-3.png'),
      ]),
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

  it('keeps later Photoshop callers blocked when an earlier waiter times out', async () => {
    vi.useFakeTimers()
    type PhotoshopMutexForTest = {
      runExclusive<T>(fn: () => Promise<T>): Promise<T>
    }
    const service = new PipelineService()
    const mutex = (service as unknown as { photoshopMutex: PhotoshopMutexForTest }).photoshopMutex
    const holderEntered = createDeferred<void>()
    const releaseHolder = createDeferred<void>()
    const holder = mutex.runExclusive(async () => {
      holderEntered.resolve()
      await releaseHolder.promise
      return 'holder-released'
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

      const thirdEntered = vi.fn()
      const third = mutex.runExclusive(async () => {
        thirdEntered()
        return 'third-entered'
      })
      await vi.advanceTimersByTimeAsync(1)
      expect(thirdEntered).not.toHaveBeenCalled()

      releaseHolder.resolve()
      await expect(holder).resolves.toBe('holder-released')
      await expect(third).resolves.toBe('third-entered')
      expect(thirdEntered).toHaveBeenCalledTimes(1)
    } finally {
      releaseHolder.resolve()
      await holder
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

  it('completes the title step and persists a pending write when the xlsx file stays locked', async () => {
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
    mocks.writeTitlesXlsx.mockRejectedValue(
      Object.assign(new Error('EPERM: locked'), { code: 'EPERM' }),
    )

    const service = new PipelineService()

    const result = await service.runPipeline('run-title-xlsx-locked', baseConfig(printFolder))
    expect(result.run.status).toBe('completed')
    const detail = await service.getRun('run-title-xlsx-locked')
    if (!detail) {
      throw new Error('missing run detail')
    }

    expect(detail.run.status).toBe('completed')
    const titleStep = detail.steps.find((step) => step.step_key === 'title')
    expect(titleStep).toMatchObject({
      status: 'completed',
      output_count: 1,
    })
    expect(JSON.parse(titleStep?.output_json ?? 'null')).toMatchObject({ pendingFlushBatches: 1 })
    expect((detail.items ?? []).find((item) => item.step_key === 'title')).toMatchObject({
      status: 'completed',
      output_path: expect.stringContaining('标题.xlsx'),
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

  it('completes the run when every streaming matting item fails and preserves failures', async () => {
    const printFolder = join(mocks.workbenchRoot, WORKBENCH_DIRECTORIES.generation, 'needs-matting')
    await createPrint(join(printFolder, 'first.png'))
    await createPrint(join(printFolder, 'second.png'))
    mocks.runComfyuiMattingBatch
      .mockResolvedValueOnce({
        taskId: 'run-all-matting-failed-matting-existing-print-1',
        total: 1,
        succeeded: 0,
        failed: 1,
        images: [],
        failures: [{ prompt: '', error: 'ComfyUI 工作流等待超时' }],
      })
      .mockResolvedValueOnce({
        taskId: 'run-all-matting-failed-matting-existing-print-2',
        total: 1,
        succeeded: 0,
        failed: 1,
        images: [],
        failures: [{ prompt: '', error: 'ComfyUI 工作流等待超时' }],
      })

    const service = new PipelineService()

    const result = await service.runPipeline('run-all-matting-failed', {
      ...baseConfig(printFolder),
      source: existingPrintSource(printFolder, 'matting'),
      matting: {
        enabled: true,
        mode: 'comfyui',
        workflowId: 'matting-workflow',
      },
      detection: {
        enabled: true,
        model: 'qwen3.6-flash',
        skillId: 'infringement-detection',
        skillVersion: '1.0.0',
        allowReview: true,
      },
    })

    const detail = await service.getRun('run-all-matting-failed')
    expect(result.run.status).toBe('completed')
    expect(detail?.run.status).toBe('completed')
    expect(detail?.steps.find((step) => step.step_key === 'matting')).toMatchObject({
      status: 'completed',
      input_count: 2,
      output_count: 0,
    })
    expect(
      detail?.items?.filter((item) => item.step_key === 'matting' && item.status === 'failed'),
    ).toHaveLength(2)
    expect(
      detail?.items?.find((item) => item.step_key === 'matting' && item.status === 'failed')
        ?.error_message,
    ).toBe('ComfyUI 工作流等待超时')
    expect(mocks.runDetectionBatch).not.toHaveBeenCalled()
    expect(mocks.runBatch).not.toHaveBeenCalled()
  })

  it('stops submitting ComfyUI source prompts after a fatal provider failure', async () => {
    mocks.runComfyuiTxt2imgBatch.mockResolvedValueOnce({
      taskId: 'run-fatal-source-txt2img-1',
      total: 1,
      succeeded: 0,
      failed: 1,
      images: [],
      failures: [
        {
          prompt: 'first prompt',
          error: '所选云机未运行',
          fatal: true,
          appErrorCode: 'CHENYU_INSTANCE_DOWN',
          retryable: false,
          errorDetails: { provider: 'comfyui-chenyu', status: 'stopped' },
        },
      ],
    })
    const service = new PipelineService()

    await expect(
      service.runPipeline('run-fatal-source', {
        ...baseConfig('/unused'),
        source: {
          mode: 'txt2img',
          provider: 'comfyui-chenyu',
          prompt: { mode: 'manual', prompts: ['first prompt', 'must not be submitted'] },
          comfyui: { workflowId: 'txt2img-workflow', instanceUuid: 'instance-source' },
        },
        matting: { ...baseConfig('/unused').matting, enabled: false },
        detection: { enabled: false },
        photoshop: {
          ...baseConfig('/unused').photoshop,
          enabled: false,
          templates: [],
        },
        title: { ...baseConfig('/unused').title, enabled: false },
      }),
    ).rejects.toMatchObject({
      code: 'CHENYU_INSTANCE_DOWN',
      message: '所选云机未运行',
    })

    expect(mocks.runComfyuiTxt2imgBatch).toHaveBeenCalledOnce()
    const detail = await service.getRun('run-fatal-source')
    expect(detail?.run).toMatchObject({ status: 'failed', error_summary: '所选云机未运行' })
    expect(detail?.steps.find((step) => step.step_key === 'source')?.status).toBe('failed')
  })

  it('stops submitting matting items after a fatal provider failure', async () => {
    const printFolder = join(mocks.workbenchRoot, WORKBENCH_DIRECTORIES.generation, 'fatal-matting')
    await createPrint(join(printFolder, 'first.png'))
    await createPrint(join(printFolder, 'second.png'))
    mocks.runComfyuiMattingBatch.mockResolvedValueOnce({
      taskId: 'run-fatal-matting-existing-print-1',
      total: 1,
      succeeded: 0,
      failed: 1,
      images: [],
      failures: [
        {
          prompt: '',
          error: '抠图云机未运行',
          fatal: true,
          appErrorCode: 'CHENYU_INSTANCE_DOWN',
          retryable: false,
          errorDetails: { provider: 'comfyui-chenyu', status: 'stopped' },
        },
      ],
    })
    const service = new PipelineService()

    await expect(
      service.runPipeline('run-fatal-matting', {
        ...baseConfig(printFolder),
        source: existingPrintSource(printFolder, 'matting'),
        matting: {
          enabled: true,
          mode: 'comfyui',
          workflowId: 'matting-workflow',
          instanceUuid: 'instance-matting',
        },
        detection: { enabled: false },
        photoshop: {
          ...baseConfig(printFolder).photoshop,
          enabled: false,
          templates: [],
        },
        title: { ...baseConfig(printFolder).title, enabled: false },
      }),
    ).rejects.toMatchObject({
      code: 'CHENYU_INSTANCE_DOWN',
      message: '抠图云机未运行',
    })

    expect(mocks.runComfyuiMattingBatch).toHaveBeenCalledOnce()
    const detail = await service.getRun('run-fatal-matting')
    expect(detail?.run).toMatchObject({ status: 'failed', error_summary: '抠图云机未运行' })
    expect(detail?.steps.find((step) => step.step_key === 'matting')?.status).toBe('failed')
  })

  it('treats a matting setup rejection as fatal before submitting the second item', async () => {
    const printFolder = join(
      mocks.workbenchRoot,
      WORKBENCH_DIRECTORIES.generation,
      'missing-matting-key',
    )
    await createPrint(join(printFolder, 'first.png'))
    await createPrint(join(printFolder, 'second.png'))
    mocks.runComfyuiMattingBatch.mockRejectedValueOnce(
      new AppErrorClass('HTTP_4XX', '缺少晨羽智云 API Key', false, {
        provider: 'comfyui-chenyu',
      }),
    )
    const service = new PipelineService()

    await expect(
      service.runPipeline('run-matting-setup-fatal', {
        ...baseConfig(printFolder),
        source: existingPrintSource(printFolder, 'matting'),
        matting: {
          enabled: true,
          mode: 'comfyui',
          workflowId: 'matting-workflow',
        },
        detection: { enabled: false },
        photoshop: {
          ...baseConfig(printFolder).photoshop,
          enabled: false,
          templates: [],
        },
        title: { ...baseConfig(printFolder).title, enabled: false },
      }),
    ).rejects.toMatchObject({
      code: 'HTTP_4XX',
      message: '缺少晨羽智云 API Key',
    })

    expect(mocks.runComfyuiMattingBatch).toHaveBeenCalledOnce()
    const detail = await service.getRun('run-matting-setup-fatal')
    expect(detail?.run).toMatchObject({
      status: 'failed',
      error_summary: '缺少晨羽智云 API Key',
    })
    expect(detail?.steps.find((step) => step.step_key === 'matting')?.status).toBe('failed')
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

  it('publishes completed result sections within the live refresh window', async () => {
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] })
    const finishSource = createDeferred<GenerationRunResult>()
    const firstImageEmitted = createDeferred<void>()
    const releaseSecondImage = createDeferred<void>()
    const secondImageEmitted = createDeferred<void>()
    const images: GenerationRunImage[] = [1, 2].map((index) => ({
      prompt: `prompt-${index}`,
      url: `file://live-result-${index}.png`,
      localPath: join(mocks.workbenchRoot, `live-result-${index}.png`),
      artifactId: `art-live-result-${index}`,
      printId: `pri-live-result-${index}`,
    }))
    mocks.runTxt2imgBatch.mockImplementationOnce(
      async (input: Txt2imgMockInput, dependencies?: GenerationBatchDependencies) => {
        for (const [index, image] of images.entries()) {
          await dependencies?.onImageComplete?.({
            taskId: input.taskId ?? 'run-live-result-refresh-txt2img',
            capability: 'txt2img',
            path: image.localPath ?? '',
            printId: image.printId ?? '',
            artifactId: image.artifactId ?? '',
            prompt: image.prompt ?? '',
            sourceArtifactIds: [],
          })
          if (index === 0) {
            firstImageEmitted.resolve()
            await releaseSecondImage.promise
          }
        }
        secondImageEmitted.resolve()
        return finishSource.promise
      },
    )

    const service = new PipelineService()
    const runPromise = service.runPipeline('run-live-result-refresh', {
      ...baseConfig('/unused'),
      source: {
        mode: 'txt2img',
        provider: 'grsai',
        prompt: { mode: 'manual', prompts: ['prompt-1', 'prompt-2'] },
        grsai: {
          model: 'gpt-image-2',
          aspectRatio: '1024x1024',
        },
      },
      matting: { ...baseConfig('/unused').matting, enabled: false },
      detection: { enabled: false },
      photoshop: {
        ...baseConfig('/unused').photoshop,
        enabled: false,
        templates: [],
      },
      title: { ...baseConfig('/unused').title, enabled: false },
    })

    await firstImageEmitted.promise
    const initialLiveSections = imageProcessingSections()
    await vi.advanceTimersByTimeAsync(49)
    expect(imageProcessingSections()).toHaveLength(initialLiveSections.length)
    await vi.advanceTimersByTimeAsync(1)
    const firstLiveSections = imageProcessingSections()
    const firstLiveSection = firstLiveSections.at(-1)
    releaseSecondImage.resolve()
    await secondImageEmitted.promise

    await vi.advanceTimersByTimeAsync(49)
    expect(imageProcessingSections()).toHaveLength(firstLiveSections.length)
    await vi.advanceTimersByTimeAsync(1)
    const refreshedLiveSections = imageProcessingSections()
    const secondLiveSection = refreshedLiveSections.at(-1)

    finishSource.resolve({
      taskId: 'run-live-result-refresh-txt2img',
      total: images.length,
      succeeded: images.length,
      failed: 0,
      images,
      failures: [],
    })
    await runPromise

    expect(firstLiveSection).toMatchObject({
      total: 2,
      completed: 1,
    })
    expect(firstLiveSection?.items).toHaveLength(2)
    expect(firstLiveSection?.items.filter((item) => item.status === 'success')).toHaveLength(1)
    expect(refreshedLiveSections).toHaveLength(firstLiveSections.length + 1)
    expect(secondLiveSection).toMatchObject({
      total: 2,
      completed: 2,
    })
    expect(secondLiveSection?.items).toHaveLength(2)
  })

  it('bounds progress snapshots for a large source batch without truncating the final snapshot', async () => {
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] })
    const printFolder = join(
      mocks.workbenchRoot,
      WORKBENCH_DIRECTORIES.generation,
      'large-progress-source',
    )
    await Promise.all(
      Array.from({ length: 120 }, (_item, index) =>
        createPrint(join(printFolder, `print-${String(index + 1).padStart(3, '0')}.png`)),
      ),
    )
    mocks.runComfyuiMattingBatch.mockImplementation(async (input) => {
      await new Promise<void>((resolve) => setImmediate(resolve))
      const sourcePath = input.sourceImagePaths[0] ?? ''
      return mockMattingResult({
        taskId: input.taskId,
        sourcePath,
        outputPath: join(mocks.workbenchRoot, `matted-${basename(sourcePath)}`),
      })
    })

    const service = new PipelineService()
    const detail = await service.runPipeline('run-large-progress-source', {
      ...baseConfig(printFolder),
      source: existingPrintSource(printFolder, 'matting'),
      matting: {
        enabled: true,
        mode: 'comfyui',
        workflowId: 'matting-workflow',
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

    const events = progressEvents()
    const fullSnapshots = events.filter((event) => event.items !== undefined)
    const finalProgress = events.at(-1)
    expect(events.length).toBeLessThanOrEqual(140)
    expect(fullSnapshots.length).toBeLessThan(20)
    expect(finalProgress).toMatchObject({
      run_id: 'run-large-progress-source',
      status: 'completed',
    })
    expect(finalProgress?.items).toHaveLength(240)
    expect(finalProgress?.steps.find((step) => step.step_key === 'source')).toMatchObject({
      status: 'completed',
      output_count: 120,
    })
    expect(
      finalProgress?.result_sections?.find((section) => section.key === 'image_processing'),
    ).toMatchObject({
      total: 120,
      completed: 120,
    })
    expect(detail.items).toHaveLength(240)
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
    expect(mocks.requestGenerationCancel).toHaveBeenCalledWith('run-soft-cancel-txt2img')
    expect(mocks.requestGenerationCancel).toHaveBeenCalledWith(
      'run-soft-cancel-matting-pri-soft-cancel-source-1',
    )
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

  it('resumes a source failure before Photoshop creates its waiting folder', async () => {
    const generatedPath = join(mocks.workbenchRoot, 'resume-before-photoshop.png')
    mocks.runTxt2imgBatch.mockRejectedValueOnce(new Error('generation provider unavailable'))
    const service = new PipelineService() as ResumeCapablePipelineService
    const config: PipelineRunConfig = {
      ...baseConfig('/unused'),
      source: {
        mode: 'txt2img',
        provider: 'grsai',
        prompt: { mode: 'manual', prompts: ['p1'] },
        grsai: {
          model: 'gpt-image-2',
          aspectRatio: '1:1',
        },
      },
      title: {
        ...baseConfig('/unused').title,
        enabled: false,
      },
    }
    await expect(service.runPipeline('run-resume-before-photoshop', config)).rejects.toThrow(
      'generation provider unavailable',
    )
    await expect(
      readdir(
        join(
          mocks.workbenchRoot,
          WORKBENCH_DIRECTORIES.generation,
          '等待套版',
          'run-resume-before-photoshop',
        ),
      ),
    ).rejects.toThrow()

    mocks.runTxt2imgBatch.mockImplementationOnce(
      async (input: Txt2imgMockInput, dependencies?: GenerationBatchDependencies) => {
        await createPrint(generatedPath)
        await dependencies?.onImageComplete?.({
          taskId: input.taskId ?? 'run-resume-before-photoshop',
          capability: 'txt2img',
          path: generatedPath,
          printId: 'pri-resume-before-photoshop',
          artifactId: 'art-resume-before-photoshop',
          prompt: input.prompts[0] ?? '',
          sourceArtifactIds: [],
          inputIndex: input.inputIndexes?.[0] ?? 0,
          outputIndex: 0,
        })
        return {
          taskId: input.taskId ?? 'run-resume-before-photoshop',
          total: 1,
          succeeded: 1,
          failed: 0,
          images: [],
          failures: [],
        }
      },
    )

    const resumed = await service.resumeRun('run-resume-before-photoshop')

    expect(resumed.run.status).toBe('completed')
    expect(mocks.runBatch).toHaveBeenCalledOnce()
  })

  it('rejects resume before starting when a completed stage output is missing', async () => {
    const printFolder = join(mocks.workbenchRoot, WORKBENCH_DIRECTORIES.generation, 'ready')
    const sourcePath = join(printFolder, 'source.png')
    const mattingPath = join(mocks.workbenchRoot, 'resume-missing-matting-output.png')
    await createPrint(sourcePath)
    mocks.runComfyuiMattingBatch.mockImplementationOnce(async (input) => {
      await createPrint(mattingPath)
      return mockMattingResult({
        taskId: input.taskId,
        sourcePath,
        outputPath: mattingPath,
        artifactId: 'art-resume-missing-matting',
        printId: 'pri-resume-missing-matting',
      })
    })

    const service = new PipelineService() as ResumeCapablePipelineService
    await service.runPipeline('run-resume-missing-matting-output', {
      ...baseConfig(printFolder),
      source: existingPrintSource(printFolder, 'matting'),
      matting: {
        enabled: true,
        mode: 'comfyui',
        workflowId: 'wf-matting',
        instanceUuid: 'instance-matting',
      },
      detection: { enabled: false },
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
    updateRunStatusForTest('run-resume-missing-matting-output', 'interrupted')
    await rm(mattingPath, { force: true })
    mocks.runComfyuiMattingBatch.mockClear()

    await expect(service.resumeRun('run-resume-missing-matting-output')).rejects.toThrow('无法续跑')
    expect(mocks.runComfyuiMattingBatch).not.toHaveBeenCalled()
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
          inputIndex: 0,
          outputIndex: 0,
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
          inputIndex: 1,
          outputIndex: 0,
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
      inputIndexes: [1],
    })
    expect(
      (resumed?.items ?? []).filter(
        (item) => item.step_key === 'source' && item.status === 'completed',
      ),
    ).toHaveLength(2)
  })

  it('streams the first pending resume item immediately and keeps historical step counts', async () => {
    const firstSourcePath = join(mocks.workbenchRoot, 'resume-stream-source-1.png')
    const secondSourcePath = join(mocks.workbenchRoot, 'resume-stream-source-2.png')
    const firstMattingPath = join(mocks.workbenchRoot, 'resume-stream-matted-1.png')
    const secondMattingPath = join(mocks.workbenchRoot, 'resume-stream-matted-2.png')
    const firstMattingCompleted = createDeferred<void>()
    const secondSourceStarted = createDeferred<void>()
    const interruptSecondSource = createDeferred<void>()

    mocks.runComfyuiTxt2imgBatch.mockImplementationOnce(
      async (input: Txt2imgMockInput, dependencies?: GenerationBatchDependencies) => {
        await createPrint(firstSourcePath)
        await dependencies?.onImageComplete?.({
          taskId: input.taskId ?? 'run-resume-stream-txt2img-1',
          capability: 'txt2img',
          path: firstSourcePath,
          printId: 'pri-resume-stream-source-1',
          artifactId: 'art-resume-stream-source-1',
          prompt: input.prompts[0] ?? '',
          sourceArtifactIds: [],
          inputIndex: 0,
          outputIndex: 0,
        })
        return {
          taskId: input.taskId ?? 'run-resume-stream-txt2img-1',
          total: 1,
          succeeded: 1,
          failed: 0,
          images: [],
          failures: [],
        }
      },
    )
    mocks.runComfyuiTxt2imgBatch.mockImplementationOnce(async () => {
      await firstMattingCompleted.promise
      secondSourceStarted.resolve()
      await interruptSecondSource.promise
      throw new Error('source process exited')
    })
    mocks.runComfyuiMattingBatch.mockImplementationOnce(async (input) => {
      await createPrint(firstMattingPath)
      firstMattingCompleted.resolve()
      return mockMattingResult({
        taskId: input.taskId,
        sourcePath: firstSourcePath,
        outputPath: firstMattingPath,
        artifactId: 'art-resume-stream-matted-1',
        printId: 'pri-resume-stream-matted-1',
      })
    })

    const service = new PipelineService() as ResumeCapablePipelineService
    const runPromise = service.runPipeline('run-resume-stream-pending', {
      ...baseConfig('/unused'),
      source: {
        mode: 'txt2img',
        provider: 'comfyui-chenyu',
        prompt: { mode: 'manual', prompts: ['p1', 'p2'] },
        comfyui: {
          workflowId: 'wf-txt2img',
          instanceUuid: 'source-instance',
        },
      },
      matting: {
        enabled: true,
        mode: 'comfyui',
        workflowId: 'wf-matting',
        instanceUuid: 'matting-instance',
      },
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

    await secondSourceStarted.promise
    await service.markActiveRunsInterrupted()
    interruptSecondSource.resolve()
    const interrupted = await runPromise
    expect(interrupted.run.status).toBe('interrupted')

    const resumedSourceEmitted = createDeferred<void>()
    const finishResumedSource = createDeferred<void>()
    const resumedMattingStarted = createDeferred<void>()
    mocks.runComfyuiTxt2imgBatch.mockClear()
    mocks.runComfyuiMattingBatch.mockClear()
    mocks.runComfyuiTxt2imgBatch.mockImplementationOnce(
      async (input: Txt2imgMockInput, dependencies?: GenerationBatchDependencies) => {
        await createPrint(secondSourcePath)
        await dependencies?.onImageComplete?.({
          taskId: input.taskId ?? 'run-resume-stream-txt2img-2',
          capability: 'txt2img',
          path: secondSourcePath,
          printId: 'pri-resume-stream-source-2',
          artifactId: 'art-resume-stream-source-2',
          prompt: input.prompts[0] ?? '',
          sourceArtifactIds: [],
          inputIndex: 1,
          outputIndex: 0,
        })
        resumedSourceEmitted.resolve()
        await finishResumedSource.promise
        return {
          taskId: input.taskId ?? 'run-resume-stream-txt2img-2',
          total: 1,
          succeeded: 1,
          failed: 0,
          images: [],
          failures: [],
        }
      },
    )
    mocks.runComfyuiMattingBatch.mockImplementationOnce(async (input) => {
      resumedMattingStarted.resolve()
      await createPrint(secondMattingPath)
      return mockMattingResult({
        taskId: input.taskId,
        sourcePath: secondSourcePath,
        outputPath: secondMattingPath,
        artifactId: 'art-resume-stream-matted-2',
        printId: 'pri-resume-stream-matted-2',
      })
    })

    const resumePromise = service.resumeRun('run-resume-stream-pending')
    await resumedSourceEmitted.promise
    const streamedBeforeSourceFinished = await Promise.race([
      resumedMattingStarted.promise.then(() => true),
      new Promise<false>((resolve) => setTimeout(() => resolve(false), 100)),
    ])
    finishResumedSource.resolve()
    const resumed = await resumePromise

    expect(streamedBeforeSourceFinished).toBe(true)
    expect(resumed?.run.status).toBe('completed')
    expect(resumed?.steps.find((step) => step.step_key === 'matting')).toMatchObject({
      status: 'completed',
      input_count: 2,
      output_count: 2,
    })
    const mattingSection = resumed?.result_sections?.find(
      (section) => section.key === 'image_processing',
    )
    expect(mattingSection?.items.map((item) => item.local_path)).toEqual(
      expect.arrayContaining([firstMattingPath, secondMattingPath]),
    )
    expect(mattingSection?.items).toHaveLength(2)
    expect(JSON.parse(resumed?.run.stats_json ?? '{}')).toMatchObject({ prints: 2 })
  })

  it('closes a resumed stage when its downstream consumer stops early', async () => {
    const upstreamRelease = createDeferred<void>()
    let stageClosed = false
    const item: PipelinePrintStreamItem = {
      itemKey: 'resume-cleanup-item',
      path: join(mocks.workbenchRoot, 'resume-cleanup-item.png'),
      sourceArtifactIds: [],
    }
    async function* upstream() {
      yield item
      await upstreamRelease.promise
    }
    const stage: PipelinePrintStage = async function* passthrough(input) {
      try {
        for await (const inputItem of input) {
          yield inputItem
        }
      } finally {
        stageClosed = true
      }
    }
    const config = {
      ...baseConfig('/unused'),
      photoshop: {
        ...baseConfig('/unused').photoshop,
        enabled: false,
        templates: [],
      },
      title: {
        ...baseConfig('/unused').title,
        enabled: false,
      },
    }
    const context: PipelineStageRuntimeContext = {
      runId: 'run-resume-stage-cleanup',
      taskName: 'resume cleanup',
      config,
      stepKey: 'detection',
      isCancelled: () => false,
    }
    const db = openWorkbenchDatabase(workbenchDatabasePath(mocks.workbenchRoot))
    try {
      const service = new PipelineService() as unknown as PipelineServiceWithResumeStageHook
      const output = service.createResumeAwareStage(db, 'detection', stage, upstream(), context, {
        config,
        itemsByStep: new Map(),
        itemByStepAndKey: new Map(),
        completedItemsByStep: new Map(),
        completedItemByStepAndKey: new Map(),
        filteredItemByStepAndKey: new Map(),
        completedSourceKeys: new Set(),
        completedSourceStep: null,
      })
      const iterator = output[Symbol.asyncIterator]()

      await expect(iterator.next()).resolves.toEqual({ value: item, done: false })
      await iterator.return?.()

      await vi.waitUntil(() => stageClosed, { timeout: 100 })
    } finally {
      upstreamRelease.resolve()
      db.close()
    }
  })

  it('resumes only the unfinished txt2img business key after out-of-order completions', async () => {
    const completedThirdPath = join(mocks.workbenchRoot, 'resume-key-txt2img-3.png')
    const completedFirstPath = join(mocks.workbenchRoot, 'resume-key-txt2img-1.png')
    const resumedSecondPath = join(mocks.workbenchRoot, 'resume-key-txt2img-2.png')
    mocks.runTxt2imgBatch.mockImplementationOnce(
      async (input: Txt2imgMockInput, dependencies?: GenerationBatchDependencies) => {
        await createPrint(completedThirdPath)
        await dependencies?.onImageComplete?.({
          taskId: input.taskId ?? 'run-resume-txt2img-keys',
          capability: 'txt2img',
          path: completedThirdPath,
          printId: 'pri-resume-key-3',
          artifactId: 'art-resume-key-3',
          prompt: 'p3',
          sourceArtifactIds: [],
          inputIndex: 2,
          outputIndex: 0,
        })
        await createPrint(completedFirstPath)
        await dependencies?.onImageComplete?.({
          taskId: input.taskId ?? 'run-resume-txt2img-keys',
          capability: 'txt2img',
          path: completedFirstPath,
          printId: 'pri-resume-key-1',
          artifactId: 'art-resume-key-1',
          prompt: 'p1',
          sourceArtifactIds: [],
          inputIndex: 0,
          outputIndex: 0,
        })
        throw new Error('txt2img worker exited')
      },
    )

    const service = new PipelineService() as ResumeCapablePipelineService
    const config: PipelineRunConfig = {
      ...baseConfig('/unused'),
      source: {
        mode: 'txt2img',
        provider: 'grsai',
        prompt: { mode: 'manual', prompts: ['p1', 'p2', 'p3'] },
        grsai: {
          model: 'gpt-image-2',
          aspectRatio: '1:1',
          concurrency: 3,
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
    }
    await expect(service.runPipeline('run-resume-txt2img-keys', config)).rejects.toThrow(
      'txt2img worker exited',
    )
    expect((await service.getRun('run-resume-txt2img-keys'))?.run.status).toBe('failed')

    mocks.runTxt2imgBatch.mockClear()
    mocks.runTxt2imgBatch.mockImplementationOnce(
      async (input: Txt2imgMockInput, dependencies?: GenerationBatchDependencies) => {
        await createPrint(resumedSecondPath)
        const inputIndex = input.inputIndexes?.[0] ?? 0
        await dependencies?.onImageComplete?.({
          taskId: input.taskId ?? 'run-resume-txt2img-keys',
          capability: 'txt2img',
          path: resumedSecondPath,
          printId: 'pri-resume-key-2',
          artifactId: 'art-resume-key-2',
          prompt: input.prompts[0] ?? '',
          sourceArtifactIds: [],
          inputIndex,
          outputIndex: 0,
        })
        return {
          taskId: input.taskId ?? 'run-resume-txt2img-keys',
          total: 1,
          succeeded: 1,
          failed: 0,
          images: [],
          failures: [],
        }
      },
    )

    const resumed = await service.resumeRun('run-resume-txt2img-keys')

    expect(mocks.runTxt2imgBatch).toHaveBeenCalledOnce()
    expect(mocks.runTxt2imgBatch.mock.calls[0]?.[0]).toMatchObject({
      prompts: ['p2'],
      inputIndexes: [1],
    })
    expect(
      (resumed.items ?? [])
        .filter((item) => item.step_key === 'source' && item.status === 'completed')
        .map((item) => item.item_key),
    ).toEqual(expect.arrayContaining(['txt2img-1-1', 'txt2img-2-1', 'txt2img-3-1']))
    expect(resumed.steps.find((step) => step.step_key === 'source')).toMatchObject({
      status: 'completed',
      input_count: 3,
      output_count: 3,
    })
  })

  it('rejects a partial legacy generation resume without stable source keys', async () => {
    const completedPath = join(mocks.workbenchRoot, 'resume-legacy-source.png')
    mocks.runTxt2imgBatch.mockImplementationOnce(
      async (input: Txt2imgMockInput, dependencies?: GenerationBatchDependencies) => {
        await createPrint(completedPath)
        await dependencies?.onImageComplete?.({
          taskId: input.taskId ?? 'run-resume-legacy-source',
          capability: 'txt2img',
          path: completedPath,
          printId: 'pri-legacy-source',
          artifactId: 'art-legacy-source',
          prompt: 'p2',
          sourceArtifactIds: [],
        })
        throw new Error('legacy generation worker exited')
      },
    )

    const service = new PipelineService() as ResumeCapablePipelineService
    await expect(
      service.runPipeline('run-resume-legacy-source', {
        ...baseConfig('/unused'),
        source: {
          mode: 'txt2img',
          provider: 'grsai',
          prompt: { mode: 'manual', prompts: ['p1', 'p2'] },
          grsai: { model: 'gpt-image-2', aspectRatio: '1:1' },
        },
        photoshop: {
          ...baseConfig('/unused').photoshop,
          enabled: false,
          templates: [],
        },
        title: { ...baseConfig('/unused').title, enabled: false },
      }),
    ).rejects.toThrow('legacy generation worker exited')
    mocks.runTxt2imgBatch.mockClear()

    await expect(service.resumeRun('run-resume-legacy-source')).rejects.toThrow('无法安全续跑')
    expect(mocks.runTxt2imgBatch).not.toHaveBeenCalled()
  })

  it('persists and reuses the AI prompt plan when resuming partial txt2img generation', async () => {
    const completedPath = join(mocks.workbenchRoot, 'resume-ai-prompt-source.png')
    const resumedPath = join(mocks.workbenchRoot, 'resume-ai-prompt-source-2.png')
    vi.mocked(generateTxt2imgPrompts).mockResolvedValueOnce([
      { id: '00000000-0000-4000-8000-000000000001', text: 'p1', selected: true },
      { id: '00000000-0000-4000-8000-000000000002', text: 'p2', selected: true },
    ])
    mocks.runTxt2imgBatch.mockImplementationOnce(
      async (input: Txt2imgMockInput, dependencies?: GenerationBatchDependencies) => {
        const persisted = await service.getRun('run-resume-ai-prompt-source')
        const persistedConfig = JSON.parse(persisted?.run.config_json ?? '{}') as PipelineRunConfig
        expect(persistedConfig.source.mode).toBe('txt2img')
        expect(
          persistedConfig.source.mode === 'txt2img'
            ? persistedConfig.source.prompt.prompts
            : undefined,
        ).toEqual(['p1', 'p2'])
        await createPrint(completedPath)
        await dependencies?.onImageComplete?.({
          taskId: input.taskId ?? 'run-resume-ai-prompt-source',
          capability: 'txt2img',
          path: completedPath,
          printId: 'pri-ai-prompt-source',
          artifactId: 'art-ai-prompt-source',
          prompt: 'p1',
          sourceArtifactIds: [],
          inputIndex: 0,
          outputIndex: 0,
        })
        throw new Error('AI generation worker exited')
      },
    )

    const service = new PipelineService() as ResumeCapablePipelineService
    await expect(
      service.runPipeline('run-resume-ai-prompt-source', {
        ...baseConfig('/unused'),
        source: {
          mode: 'txt2img',
          provider: 'grsai',
          prompt: {
            mode: 'ai',
            requirement: 'two floral prints',
            count: 2,
            skillId: 'txt2img-local-print',
            model: 'qwen3-vl-flash',
          },
          grsai: { model: 'gpt-image-2', aspectRatio: '1:1' },
        },
        photoshop: {
          ...baseConfig('/unused').photoshop,
          enabled: false,
          templates: [],
        },
        title: { ...baseConfig('/unused').title, enabled: false },
      }),
    ).rejects.toThrow('AI generation worker exited')
    vi.mocked(generateTxt2imgPrompts).mockReset()
    vi.mocked(generateTxt2imgPrompts).mockRejectedValue(
      new Error('prompt generator must not run while resuming a saved plan'),
    )
    mocks.runTxt2imgBatch.mockClear()
    mocks.runTxt2imgBatch.mockImplementationOnce(
      async (input: Txt2imgMockInput, dependencies?: GenerationBatchDependencies) => {
        expect(input.prompts).toEqual(['p2'])
        expect(input.inputIndexes).toEqual([1])
        await createPrint(resumedPath)
        await dependencies?.onImageComplete?.({
          taskId: input.taskId ?? 'run-resume-ai-prompt-source',
          capability: 'txt2img',
          path: resumedPath,
          printId: 'pri-ai-prompt-source-2',
          artifactId: 'art-ai-prompt-source-2',
          prompt: 'p2',
          sourceArtifactIds: [],
          inputIndex: 1,
          outputIndex: 0,
        })
        return {
          taskId: input.taskId ?? 'run-resume-ai-prompt-source',
          total: 1,
          succeeded: 1,
          failed: 0,
          images: [],
          failures: [],
        }
      },
    )

    const resumed = await service.resumeRun('run-resume-ai-prompt-source')

    expect(resumed.run.status).toBe('completed')
    expect(generateTxt2imgPrompts).not.toHaveBeenCalled()
    expect(mocks.runTxt2imgBatch).toHaveBeenCalledOnce()
  })

  it('persists and reuses the AI prompt plan when resuming partial Grsai img2img generation', async () => {
    const sourceFolder = join(
      mocks.workbenchRoot,
      WORKBENCH_DIRECTORIES.generation,
      'resume-grsai-img2img-ai',
    )
    const referencePath = join(sourceFolder, 'reference.png')
    const completedPath = join(mocks.workbenchRoot, 'resume-grsai-img2img-ai-1.png')
    const resumedPath = join(mocks.workbenchRoot, 'resume-grsai-img2img-ai-2.png')
    await createPrint(referencePath)
    vi.mocked(generateTxt2imgPrompts).mockResolvedValueOnce([
      { id: '00000000-0000-4000-8000-000000000011', text: 'img-p1', selected: true },
      { id: '00000000-0000-4000-8000-000000000012', text: 'img-p2', selected: true },
    ])
    mocks.runTxt2imgBatch.mockImplementationOnce(
      async (input: Txt2imgMockInput, dependencies?: GenerationBatchDependencies) => {
        expect(input.capability).toBe('img2img')
        const persisted = await service.getRun('run-resume-grsai-img2img-ai')
        const persistedConfig = JSON.parse(persisted?.run.config_json ?? '{}') as PipelineRunConfig
        expect(
          persistedConfig.source.mode === 'img2img' && persistedConfig.source.provider === 'grsai'
            ? persistedConfig.source.prompt.prompts
            : undefined,
        ).toEqual(['img-p1', 'img-p2'])
        await createPrint(completedPath)
        await dependencies?.onImageComplete?.({
          taskId: input.taskId ?? 'run-resume-grsai-img2img-ai',
          capability: 'img2img',
          path: completedPath,
          printId: 'pri-resume-grsai-img2img-ai-1',
          artifactId: 'art-resume-grsai-img2img-ai-1',
          prompt: 'img-p1',
          sourceArtifactIds: [],
          inputIndex: 0,
          outputIndex: 0,
        })
        throw new Error('Grsai img2img worker exited')
      },
    )

    const service = new PipelineService() as ResumeCapablePipelineService
    await expect(
      service.runPipeline('run-resume-grsai-img2img-ai', {
        ...baseConfig('/unused'),
        source: {
          mode: 'img2img',
          provider: 'grsai',
          sourceFolder,
          prompt: {
            mode: 'ai',
            requirement: 'two floral reference variations',
            count: 2,
            skillId: 'img2img-local-reference',
            model: 'qwen3-vl-flash',
          },
          sendReferenceImages: false,
          grsai: { model: 'gpt-image-2', aspectRatio: '1:1' },
        },
        photoshop: {
          ...baseConfig('/unused').photoshop,
          enabled: false,
          templates: [],
        },
        title: { ...baseConfig('/unused').title, enabled: false },
      }),
    ).rejects.toThrow('Grsai img2img worker exited')

    vi.mocked(generateTxt2imgPrompts).mockReset()
    vi.mocked(generateTxt2imgPrompts).mockRejectedValue(
      new Error('prompt generator must not run while resuming a saved img2img plan'),
    )
    mocks.runTxt2imgBatch.mockClear()
    mocks.runTxt2imgBatch.mockImplementationOnce(
      async (input: Txt2imgMockInput, dependencies?: GenerationBatchDependencies) => {
        expect(input.capability).toBe('img2img')
        expect(input.prompts).toEqual(['img-p2'])
        expect(input.inputIndexes).toEqual([1])
        await createPrint(resumedPath)
        await dependencies?.onImageComplete?.({
          taskId: input.taskId ?? 'run-resume-grsai-img2img-ai',
          capability: 'img2img',
          path: resumedPath,
          printId: 'pri-resume-grsai-img2img-ai-2',
          artifactId: 'art-resume-grsai-img2img-ai-2',
          prompt: 'img-p2',
          sourceArtifactIds: [],
          inputIndex: 1,
          outputIndex: 0,
        })
        return {
          taskId: input.taskId ?? 'run-resume-grsai-img2img-ai',
          total: 1,
          succeeded: 1,
          failed: 0,
          images: [],
          failures: [],
        }
      },
    )

    const resumed = await service.resumeRun('run-resume-grsai-img2img-ai')

    expect(resumed.run.status).toBe('completed')
    expect(generateTxt2imgPrompts).not.toHaveBeenCalled()
    expect(mocks.runTxt2imgBatch).toHaveBeenCalledOnce()
  })

  it('resumes only missing img2img output keys across multiple inputs', async () => {
    const sourceFolder = join(
      mocks.workbenchRoot,
      WORKBENCH_DIRECTORIES.generation,
      'resume-img2img-inputs',
    )
    const firstSourcePath = join(sourceFolder, 'a.png')
    const secondSourcePath = join(sourceFolder, 'b.png')
    const firstCompletedPath = join(mocks.workbenchRoot, 'resume-img2img-a-2.png')
    const secondCompletedPath = join(mocks.workbenchRoot, 'resume-img2img-b-1.png')
    await createPrint(firstSourcePath)
    await createPrint(secondSourcePath)

    mocks.runComfyuiImg2imgBatch.mockImplementationOnce(
      async (input: ComfyuiMockInput, dependencies?: GenerationBatchDependencies) => {
        await createPrint(firstCompletedPath)
        await dependencies?.onImageComplete?.({
          taskId: input.taskId ?? 'run-resume-img2img-keys-1',
          capability: 'img2img',
          path: firstCompletedPath,
          printId: 'pri-resume-img2img-a-2',
          artifactId: 'art-resume-img2img-a-2',
          sourcePath: firstSourcePath,
          sourceArtifactIds: [],
          inputIndex: 0,
          outputIndex: 1,
        })
        return {
          taskId: input.taskId ?? 'run-resume-img2img-keys-1',
          total: 2,
          succeeded: 1,
          failed: 1,
          images: [],
          failures: [{ prompt: '', sourcePath: firstSourcePath, error: 'missing output 1' }],
        }
      },
    )
    mocks.runComfyuiImg2imgBatch.mockImplementationOnce(
      async (input: ComfyuiMockInput, dependencies?: GenerationBatchDependencies) => {
        await createPrint(secondCompletedPath)
        await dependencies?.onImageComplete?.({
          taskId: input.taskId ?? 'run-resume-img2img-keys-2',
          capability: 'img2img',
          path: secondCompletedPath,
          printId: 'pri-resume-img2img-b-1',
          artifactId: 'art-resume-img2img-b-1',
          sourcePath: secondSourcePath,
          sourceArtifactIds: [],
          inputIndex: 1,
          outputIndex: 0,
        })
        throw new Error('img2img worker exited')
      },
    )

    const service = new PipelineService() as ResumeCapablePipelineService
    const config: PipelineRunConfig = {
      ...baseConfig('/unused'),
      source: {
        mode: 'img2img',
        provider: 'comfyui-chenyu',
        sourceFolder,
        prompt: { mode: 'workflow' },
        comfyui: {
          workflowId: 'wf-img2img',
          instanceUuid: 'instance-img2img',
          batchSize: 2,
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
    }
    await expect(service.runPipeline('run-resume-img2img-keys', config)).rejects.toThrow(
      'img2img worker exited',
    )

    mocks.runComfyuiImg2imgBatch.mockClear()
    const resumeMissingImg2imgOutput = async (
      input: ComfyuiMockInput,
      dependencies?: GenerationBatchDependencies,
    ) => {
      const sourcePath = input.sourceImagePaths?.[0] ?? ''
      const inputIndex = input.inputIndexes?.[0] ?? (sourcePath === firstSourcePath ? 0 : 1)
      const outputIndex = input.outputIndexes?.[0] ?? 0
      const outputPath = join(
        mocks.workbenchRoot,
        `resume-img2img-${inputIndex + 1}-${outputIndex + 1}.png`,
      )
      await createPrint(outputPath)
      await dependencies?.onImageComplete?.({
        taskId: input.taskId ?? `run-resume-img2img-keys-${inputIndex + 1}`,
        capability: 'img2img',
        path: outputPath,
        printId: `pri-resume-img2img-${inputIndex + 1}-${outputIndex + 1}`,
        artifactId: `art-resume-img2img-${inputIndex + 1}-${outputIndex + 1}`,
        sourcePath,
        sourceArtifactIds: [],
        inputIndex,
        outputIndex,
      })
      return {
        taskId: input.taskId ?? `run-resume-img2img-keys-${inputIndex + 1}`,
        total: 1,
        succeeded: 1,
        failed: 0,
        images: [],
        failures: [],
      }
    }
    mocks.runComfyuiImg2imgBatch.mockImplementationOnce(resumeMissingImg2imgOutput)
    mocks.runComfyuiImg2imgBatch.mockImplementationOnce(resumeMissingImg2imgOutput)

    const resumed = await service.resumeRun('run-resume-img2img-keys')

    expect(mocks.runComfyuiImg2imgBatch).toHaveBeenCalledTimes(2)
    expect(mocks.runComfyuiImg2imgBatch.mock.calls.map(([input]) => input)).toEqual([
      expect.objectContaining({
        sourceImagePaths: [firstSourcePath],
        batchSize: 1,
        inputIndexes: [0],
        outputIndexes: [0],
      }),
      expect.objectContaining({
        sourceImagePaths: [secondSourcePath],
        batchSize: 1,
        inputIndexes: [1],
        outputIndexes: [1],
      }),
    ])
    const resumedConfig = JSON.parse(resumed.run.config_json) as PipelineRunConfig
    const sourceManifest =
      resumedConfig.source.mode === 'img2img' && resumedConfig.source.provider === 'comfyui-chenyu'
        ? (resumedConfig.source.sourceManifest ?? [])
        : []
    expect(
      (resumed.items ?? [])
        .filter((item) => item.step_key === 'source' && item.status === 'completed')
        .map((item) => item.item_key),
    ).toEqual(
      expect.arrayContaining([
        `${sourceManifest[0]?.itemKey}-1`,
        `${sourceManifest[0]?.itemKey}-2`,
        `${sourceManifest[1]?.itemKey}-1`,
        `${sourceManifest[1]?.itemKey}-2`,
      ]),
    )
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

  it('resumes missing Photoshop templates with the existing waiting print copy', async () => {
    const printFolder = join(mocks.workbenchRoot, WORKBENCH_DIRECTORIES.generation, 'ready')
    await createPrint(join(printFolder, 'existing.png'))
    const templates = ['C:\\templates\\shirt.psd', 'C:\\templates\\mug.psd']
    let firstRunCalls = 0
    mocks.runBatch.mockImplementation(
      async (
        prints: PhotoshopPrintAsset[],
        templatePathsInput: unknown,
        config: {
          taskId: string
          outputRoot: string
          outputLayout: PhotoshopOutputLayout
        },
      ) => {
        firstRunCalls += 1
        const templatePaths = requireStringArray(templatePathsInput, 'missing Photoshop templates')
        const templatePath =
          templatePaths[0] ?? requireString(templates[0], 'missing first template')
        if (firstRunCalls === 2) {
          throw new Error('mug failed before resume')
        }
        const result = createPhotoshopBatchResultForTemplate(prints, templatePath, config)
        const outputPath = result.result_groups[0]?.outputs[0]
        if (outputPath) {
          await createTitleProductImage(outputPath)
        }
        return result
      },
    )

    const service = new PipelineService() as ResumeCapablePipelineService
    const firstRun = await service.runPipeline('run-resume-ps-partial', {
      ...baseConfig(printFolder),
      photoshop: {
        ...baseConfig(printFolder).photoshop,
        templates,
      },
      title: {
        ...baseConfig(printFolder).title,
        existingStrategy: 'regenerate',
      },
    })
    const completedPhotoshopItem = (firstRun.items ?? []).find(
      (item) => item.step_key === 'photoshop' && item.status === 'completed',
    )
    expect(completedPhotoshopItem?.source_path).toContain('TY-BASE-0001.png')
    expect(
      (firstRun.items ?? []).filter(
        (item) => item.step_key === 'photoshop' && item.status === 'completed',
      ),
    ).toHaveLength(1)
    expect(
      (firstRun.items ?? []).filter(
        (item) => item.step_key === 'photoshop' && item.status === 'failed',
      ),
    ).toHaveLength(1)

    updateRunStatusForTest('run-resume-ps-partial', 'interrupted')
    mocks.runBatch.mockClear()
    mocks.createTitleProcessingSession.mockClear()
    mocks.runBatch.mockImplementationOnce(
      async (
        prints: PhotoshopPrintAsset[],
        templatePathsInput: unknown,
        config: {
          taskId: string
          outputRoot: string
          outputLayout: PhotoshopOutputLayout
        },
      ) => {
        const templatePaths = requireStringArray(templatePathsInput, 'missing resumed templates')
        const resumedSourcePath = requireString(
          completedPhotoshopItem?.source_path,
          'missing completed Photoshop source path',
        )
        const resumedTemplate = requireString(templates[1], 'missing resumed template')
        expect(prints[0]?.file_path).toBe(resumedSourcePath)
        expect(templatePaths).toEqual([resumedTemplate])
        const result = createPhotoshopBatchResultForTemplate(prints, resumedTemplate, config)
        const outputPath = result.result_groups[0]?.outputs[0]
        if (outputPath) {
          await createTitleProductImage(outputPath)
        }
        return result
      },
    )

    const resumed = await service.resumeRun('run-resume-ps-partial')

    expect(resumed?.run.status).toBe('completed')
    expect(mocks.runBatch).toHaveBeenCalledTimes(1)
    expect(
      (resumed?.items ?? []).filter(
        (item) => item.step_key === 'photoshop' && item.status === 'completed',
      ),
    ).toHaveLength(2)
    expect(
      (resumed?.items ?? []).filter(
        (item) => item.step_key === 'photoshop' && item.status === 'failed',
      ),
    ).toHaveLength(0)
    expect(resumed?.steps.find((step) => step.step_key === 'photoshop')).toMatchObject({
      input_count: 1,
      output_count: 2,
    })
    const photoshopSection = resumed?.result_sections?.find(
      (section) => section.key === 'print_products',
    )
    expect(photoshopSection).toMatchObject({
      total: 2,
      completed: 2,
      failed: 0,
    })
    expect(photoshopSection?.groups).toHaveLength(2)
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

  it('consumes filtered detection items on resume without rerunning detection or sending them to Photoshop', async () => {
    const printFolder = join(mocks.workbenchRoot, WORKBENCH_DIRECTORIES.generation, 'ready')
    const printPath = join(printFolder, 'blocked.png')
    await createPrint(printPath)
    mocks.runDetectionBatch.mockResolvedValueOnce({
      taskId: 'run-resume-filtered-detection',
      total: 1,
      succeeded: 1,
      failed: 0,
      skipped: 0,
      results: [
        {
          imagePath: printPath,
          thumbnailUrl: '',
          artifactId: 'art-resume-filtered',
          printId: 'pri-resume-filtered',
          status: 'success' as const,
          riskScore: 99,
          riskLevel: 'block' as const,
          reason: 'blocked',
          outputPath: printPath,
          cached: false,
        },
      ],
    })

    const service = new PipelineService() as ResumeCapablePipelineService
    const firstRun = await service.runPipeline('run-resume-filtered', {
      ...baseConfig(printFolder),
      source: existingPrintSource(printFolder, 'detection'),
      detection: {
        enabled: true,
        skillId: 'infringement-v2',
        model: 'qwen3.6-flash',
        allowReview: false,
      },
      title: {
        ...baseConfig(printFolder).title,
        enabled: false,
      },
    })
    expect(firstRun.run.status).toBe('completed')
    expect(mocks.runBatch).not.toHaveBeenCalled()

    await mkdir(
      join(
        mocks.workbenchRoot,
        WORKBENCH_DIRECTORIES.generation,
        '等待套版',
        'run-resume-filtered',
      ),
      { recursive: true },
    )
    updateRunStatusForTest('run-resume-filtered', 'interrupted')
    mocks.runDetectionBatch.mockClear()
    mocks.runBatch.mockClear()

    const resumed = await service.resumeRun('run-resume-filtered')

    expect(resumed?.run.status).toBe('completed')
    expect(mocks.runDetectionBatch).not.toHaveBeenCalled()
    expect(mocks.runBatch).not.toHaveBeenCalled()
    expect(resumed?.steps.find((step) => step.step_key === 'detection')).toMatchObject({
      status: 'completed',
      input_count: 1,
      output_count: 0,
    })
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

  it('uses strict image completion callbacks for streaming Grsai source runs', async () => {
    const outputPath = join(mocks.workbenchRoot, 'strict-source.png')
    await createPrint(outputPath)
    mocks.runTxt2imgBatch.mockImplementationOnce(
      async (input: Txt2imgMockInput, dependencies?: GenerationBatchDependencies) => {
        expect(dependencies?.strictImageComplete).toBe(true)
        await dependencies?.onImageComplete?.({
          taskId: input.taskId ?? 'run-strict-source-txt2img',
          capability: 'txt2img',
          path: outputPath,
          printId: 'pri-strict-source',
          artifactId: 'art-strict-source',
          sourceArtifactIds: [],
        })
        return {
          taskId: input.taskId ?? 'run-strict-source-txt2img',
          total: 1,
          succeeded: 1,
          failed: 0,
          images: [
            {
              prompt: 'strict source',
              url: 'file://strict-source.png',
              localPath: outputPath,
              artifactId: 'art-strict-source',
              printId: 'pri-strict-source',
            },
          ],
          failures: [],
        }
      },
    )

    const service = new PipelineService()
    const result = await service.runPipeline('run-strict-source', {
      ...baseConfig('/unused'),
      source: {
        mode: 'txt2img',
        provider: 'grsai',
        prompt: { mode: 'manual', prompts: ['strict source'] },
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
    expect(
      result.items?.find(
        (item) => item.step_key === 'source' && item.item_key === 'pri-strict-source',
      ),
    ).toMatchObject({ status: 'completed' })
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

  it('creates expected loading slots, preserves success completion order, and hides failures', async () => {
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

  it('streams the first collection extract output into matting before the extract batch finishes', async () => {
    const sourceFolder = join(
      mocks.workbenchRoot,
      WORKBENCH_DIRECTORIES.collection,
      'temu-20260719-120000',
    )
    const firstSourcePath = join(sourceFolder, 'source-a.png')
    const secondSourcePath = join(sourceFolder, 'source-b.png')
    const firstExtractPath = join(sourceFolder, 'extracted-a.png')
    const secondExtractPath = join(sourceFolder, 'extracted-b.png')
    await createPrint(firstSourcePath)
    await createPrint(secondSourcePath)

    const firstExtractCompleted = createDeferred<void>()
    const finishExtractBatch = createDeferred<void>()
    const firstMattingStarted = createDeferred<void>()

    mocks.runExtractBatch.mockImplementationOnce(
      async (
        input: { sourceImagePaths: string[]; taskId: string },
        dependencies?: GenerationBatchDependencies,
      ) => {
        await createPrint(firstExtractPath)
        await dependencies?.onImageComplete?.({
          taskId: input.taskId,
          capability: 'extract',
          path: firstExtractPath,
          printId: 'pri-extracted-a',
          artifactId: 'art-extracted-a',
          sourcePath: firstSourcePath,
          sourceArtifactIds: [],
        })
        firstExtractCompleted.resolve()
        await finishExtractBatch.promise
        await dependencies?.onImageComplete?.({
          taskId: input.taskId,
          capability: 'extract',
          path: secondExtractPath,
          printId: 'pri-extracted-b',
          artifactId: 'art-extracted-b',
          sourcePath: secondSourcePath,
          sourceArtifactIds: [],
        })
        return {
          taskId: input.taskId,
          capability: 'extract' as const,
          total: 2,
          succeeded: 2,
          failed: 0,
          images: [
            {
              prompt: 'extract a',
              url: 'file://extracted-a.png',
              localPath: firstExtractPath,
              sourcePath: firstSourcePath,
              artifactId: 'art-extracted-a',
              printId: 'pri-extracted-a',
            },
            {
              prompt: 'extract b',
              url: 'file://extracted-b.png',
              localPath: secondExtractPath,
              sourcePath: secondSourcePath,
              artifactId: 'art-extracted-b',
              printId: 'pri-extracted-b',
            },
          ],
          failures: [],
        }
      },
    )
    mocks.runComfyuiMattingBatch.mockImplementation(async (input) => {
      const sourcePath = input.sourceImagePaths[0] ?? ''
      if (sourcePath === firstExtractPath) {
        firstMattingStarted.resolve()
      }
      return mockMattingResult({
        taskId: input.taskId,
        sourcePath,
        outputPath: join(sourceFolder, `matted-${basename(sourcePath)}`),
      })
    })

    const service = new PipelineService()
    const runPromise = service.runPipeline('run-stream-collection-extract', {
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

    await firstExtractCompleted.promise
    const streamedBeforeBatchFinished = await Promise.race([
      firstMattingStarted.promise.then(() => true),
      new Promise<false>((resolve) => setTimeout(() => resolve(false), 100)),
    ])
    finishExtractBatch.resolve()
    const detail = await runPromise

    expect(streamedBeforeBatchFinished).toBe(true)
    expect(detail.run.status).toBe('completed')
  })

  it('keeps collection source item keys stable when extract outputs complete out of order', async () => {
    const sourceFolder = join(
      mocks.workbenchRoot,
      WORKBENCH_DIRECTORIES.collection,
      'temu-20260719-130000',
    )
    const firstSourcePath = join(sourceFolder, 'source-a.png')
    const secondSourcePath = join(sourceFolder, 'source-b.png')
    const firstExtractPath = join(sourceFolder, 'extracted-a.png')
    const secondExtractPath = join(sourceFolder, 'extracted-b.png')
    await createPrint(firstSourcePath)
    await createPrint(secondSourcePath)

    mocks.runExtractBatch.mockImplementationOnce(
      async (
        input: { sourceImagePaths: string[]; taskId: string },
        dependencies?: GenerationBatchDependencies,
      ) => {
        await createPrint(firstExtractPath)
        await dependencies?.onImageComplete?.({
          taskId: input.taskId,
          capability: 'extract',
          path: secondExtractPath,
          printId: 'pri-extracted-b',
          artifactId: 'art-extracted-b',
          sourcePath: secondSourcePath,
          sourceArtifactIds: ['art-source-b'],
        })
        await dependencies?.onImageComplete?.({
          taskId: input.taskId,
          capability: 'extract',
          path: firstExtractPath,
          printId: 'pri-extracted-a',
          artifactId: 'art-extracted-a',
          sourcePath: firstSourcePath,
          sourceArtifactIds: ['art-source-a'],
        })
        return {
          taskId: input.taskId,
          capability: 'extract' as const,
          total: 2,
          succeeded: 2,
          failed: 0,
          images: [],
          failures: [],
        }
      },
    )

    const service = new PipelineService()
    await service.runPipeline('run-stable-collection-extract-keys', {
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

    const detail = await service.getRun('run-stable-collection-extract-keys')
    const extractItems = (detail?.items ?? []).filter((item) => item.step_key === 'extract')
    const persistedConfig = JSON.parse(detail?.run.config_json ?? '{}') as PipelineRunConfig
    const sourceManifest =
      persistedConfig.source.mode === 'collection'
        ? (persistedConfig.source.sourceManifest ?? [])
        : []
    const sourceKeyByPath = new Map(sourceManifest.map((item) => [item.path, item.itemKey]))
    expect(extractItems).toHaveLength(2)
    expect(extractItems).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          item_key: sourceKeyByPath.get(firstSourcePath),
          status: 'completed',
          source_path: firstSourcePath,
          output_path: firstExtractPath,
          print_id: 'pri-extracted-a',
        }),
        expect.objectContaining({
          item_key: sourceKeyByPath.get(secondSourcePath),
          status: 'completed',
          source_path: secondSourcePath,
          output_path: secondExtractPath,
          print_id: 'pri-extracted-b',
        }),
      ]),
    )
  })

  it('resumes collection extraction with only the unfinished source path', async () => {
    const sourceFolder = join(
      mocks.workbenchRoot,
      WORKBENCH_DIRECTORIES.collection,
      'temu-20260719-140000',
    )
    const firstSourcePath = join(sourceFolder, 'source-a.png')
    const secondSourcePath = join(sourceFolder, 'source-b.png')
    const extractFolder = join(
      mocks.workbenchRoot,
      WORKBENCH_DIRECTORIES.generation,
      '提取',
      'run-resume-collection-extract',
    )
    const firstExtractPath = join(extractFolder, 'extracted-a.png')
    const secondExtractPath = join(extractFolder, 'extracted-b.png')
    await createPrint(firstSourcePath)
    await createPrint(secondSourcePath)

    const firstExtractEmitted = createDeferred<void>()
    const interruptRelease = createDeferred<void>()
    mocks.runExtractBatch.mockImplementationOnce(
      async (
        input: { sourceImagePaths: string[]; taskId: string },
        dependencies?: GenerationBatchDependencies,
      ) => {
        await createPrint(firstExtractPath)
        await dependencies?.onImageComplete?.({
          taskId: input.taskId,
          capability: 'extract',
          path: firstExtractPath,
          printId: 'pri-resume-extract-a',
          artifactId: 'art-resume-extract-a',
          sourcePath: firstSourcePath,
          sourceArtifactIds: [],
        })
        firstExtractEmitted.resolve()
        await interruptRelease.promise
        return {
          taskId: input.taskId,
          capability: 'extract' as const,
          total: 2,
          succeeded: 1,
          failed: 0,
          images: [
            {
              prompt: 'extract a',
              url: 'file://extracted-a.png',
              localPath: firstExtractPath,
              sourcePath: firstSourcePath,
              artifactId: 'art-resume-extract-a',
              printId: 'pri-resume-extract-a',
            },
          ],
          failures: [],
        }
      },
    )
    mocks.runExtractBatch.mockImplementationOnce(
      async (
        input: { sourceImagePaths: string[]; taskId: string },
        dependencies?: GenerationBatchDependencies,
      ) => {
        expect(input.sourceImagePaths).toEqual([secondSourcePath])
        await createPrint(secondExtractPath)
        await dependencies?.onImageComplete?.({
          taskId: input.taskId,
          capability: 'extract',
          path: secondExtractPath,
          printId: 'pri-resume-extract-b',
          artifactId: 'art-resume-extract-b',
          sourcePath: secondSourcePath,
          sourceArtifactIds: [],
        })
        return {
          taskId: input.taskId,
          capability: 'extract' as const,
          total: 1,
          succeeded: 1,
          failed: 0,
          images: [
            {
              prompt: 'extract b',
              url: 'file://extracted-b.png',
              localPath: secondExtractPath,
              sourcePath: secondSourcePath,
              artifactId: 'art-resume-extract-b',
              printId: 'pri-resume-extract-b',
            },
          ],
          failures: [],
        }
      },
    )

    const config: PipelineRunConfig = {
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
    }

    const service = new PipelineService() as ResumeCapablePipelineService
    const firstRun = service.runPipeline('run-resume-collection-extract', config)
    await firstExtractEmitted.promise
    await service.markActiveRunsInterrupted()
    interruptRelease.resolve()
    const interrupted = await firstRun
    expect(interrupted.run.status).toBe('interrupted')
    const interruptedConfig = JSON.parse(interrupted.run.config_json) as {
      source: { sourceManifest?: Array<{ itemKey: string; path: string }> }
    }
    const sourceManifest = interruptedConfig.source.sourceManifest ?? []
    expect(sourceManifest.map((item) => item.path)).toEqual([firstSourcePath, secondSourcePath])
    expect(sourceManifest.map((item) => item.itemKey)).toEqual([
      expect.stringMatching(/^source-[0-9a-f]{32}$/),
      expect.stringMatching(/^source-[0-9a-f]{32}$/),
    ])

    await createPrint(join(sourceFolder, '000-new-source.png'))

    const resumed = await service.resumeRun('run-resume-collection-extract')
    expect(resumed.run.status).toBe('completed')
    const extractItems = (resumed.items ?? []).filter((item) => item.step_key === 'extract')
    expect(extractItems).toHaveLength(2)
    expect(extractItems).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          item_key: sourceManifest[0]?.itemKey,
          status: 'completed',
          source_path: firstSourcePath,
          output_path: firstExtractPath,
        }),
        expect.objectContaining({
          item_key: sourceManifest[1]?.itemKey,
          status: 'completed',
          source_path: secondSourcePath,
          output_path: secondExtractPath,
        }),
      ]),
    )
  })

  it('keeps the frozen existing-print manifest when the source directory order changes', async () => {
    const printFolder = join(
      mocks.workbenchRoot,
      WORKBENCH_DIRECTORIES.generation,
      'resume-existing-manifest',
    )
    const firstPath = join(printFolder, 'a.png')
    const secondPath = join(printFolder, 'b.png')
    await createPrint(firstPath)
    await createPrint(secondPath)
    mocks.runBatch.mockImplementation(async (prints, _templates, config) => {
      const result = createPhotoshopBatchResult(prints, config)
      await Promise.all(result.outputs.map((outputPath) => createTitleProductImage(outputPath)))
      return result
    })

    const service = new PipelineService() as ResumeCapablePipelineService
    const firstRun = await service.runPipeline('run-resume-existing-manifest', {
      ...baseConfig(printFolder),
      title: { ...baseConfig(printFolder).title, enabled: false },
    })
    const firstConfig = JSON.parse(firstRun.run.config_json) as PipelineRunConfig
    expect(
      firstConfig.source.mode === 'existing_prints'
        ? firstConfig.source.sourceManifest?.map((item) => item.path)
        : undefined,
    ).toEqual([firstPath, secondPath])

    updateRunStatusForTest('run-resume-existing-manifest', 'interrupted')
    await createPrint(join(printFolder, '000-new.png'))
    const resumed = await service.resumeRun('run-resume-existing-manifest')

    expect(resumed.run.status).toBe('completed')
    expect(
      (resumed.items ?? [])
        .filter((item) => item.step_key === 'source' && item.status === 'completed')
        .map((item) => item.output_path),
    ).toEqual(expect.arrayContaining([firstPath, secondPath]))
    expect(
      (resumed.items ?? []).filter(
        (item) => item.step_key === 'source' && item.status === 'completed',
      ),
    ).toHaveLength(2)
  })

  it('reuses completed legacy folder-source outputs but refuses an unsafe partial legacy run', async () => {
    const printFolder = join(
      mocks.workbenchRoot,
      WORKBENCH_DIRECTORIES.generation,
      'resume-legacy-existing-manifest',
    )
    await createPrint(join(printFolder, 'a.png'))
    await createPrint(join(printFolder, 'b.png'))
    mocks.runBatch.mockImplementation(async (prints, _templates, config) => {
      const result = createPhotoshopBatchResult(prints, config)
      await Promise.all(result.outputs.map((outputPath) => createTitleProductImage(outputPath)))
      return result
    })
    const runId = 'run-resume-legacy-existing-manifest'
    const service = new PipelineService() as ResumeCapablePipelineService
    await service.runPipeline(runId, {
      ...baseConfig(printFolder),
      title: { ...baseConfig(printFolder).title, enabled: false },
    })
    rewriteRunConfigForTest(runId, (config) => {
      if (config.source.mode !== 'existing_prints') {
        throw new Error('expected existing print source')
      }
      const { sourceManifest: _sourceManifest, ...legacySource } = config.source
      return { ...config, source: legacySource }
    })

    updateRunStatusForTest(runId, 'interrupted')
    await expect(service.resumeRun(runId)).resolves.toMatchObject({
      run: expect.objectContaining({ status: 'completed' }),
    })

    updateRunStatusForTest(runId, 'failed')
    markSourceStepInterruptedForTest(runId)
    await expect(service.resumeRun(runId)).rejects.toThrow('缺少冻结来源清单')
  })

  it('does not resubmit ComfyUI img2img when its frozen source directory order changes', async () => {
    const sourceFolder = join(
      mocks.workbenchRoot,
      WORKBENCH_DIRECTORIES.generation,
      'resume-comfyui-img2img-manifest',
    )
    const firstSourcePath = join(sourceFolder, 'a.png')
    const secondSourcePath = join(sourceFolder, 'b.png')
    await createPrint(firstSourcePath)
    await createPrint(secondSourcePath)
    const runManifestImg2img = async (
      input: ComfyuiMockInput,
      dependencies?: GenerationBatchDependencies,
    ) => {
      const inputIndex = input.inputIndexes?.[0] ?? 0
      const sourcePath = input.sourceImagePaths?.[0] ?? ''
      const outputPath = join(mocks.workbenchRoot, `manifest-img2img-${inputIndex + 1}.png`)
      await createPrint(outputPath)
      await dependencies?.onImageComplete?.({
        taskId: input.taskId ?? `run-manifest-img2img-${inputIndex + 1}`,
        capability: 'img2img',
        path: outputPath,
        printId: `pri-manifest-img2img-${inputIndex + 1}`,
        artifactId: `art-manifest-img2img-${inputIndex + 1}`,
        sourcePath,
        sourceArtifactIds: [],
        inputIndex,
        outputIndex: 0,
      })
      return {
        taskId: input.taskId ?? `run-manifest-img2img-${inputIndex + 1}`,
        total: 1,
        succeeded: 1,
        failed: 0,
        images: [],
        failures: [],
      }
    }
    mocks.runComfyuiImg2imgBatch.mockImplementationOnce(runManifestImg2img)
    mocks.runComfyuiImg2imgBatch.mockImplementationOnce(runManifestImg2img)

    const runId = 'run-resume-comfyui-img2img-manifest'
    const service = new PipelineService() as ResumeCapablePipelineService
    const firstRun = await service.runPipeline(runId, {
      ...baseConfig('/unused'),
      source: {
        mode: 'img2img',
        provider: 'comfyui-chenyu',
        sourceFolder,
        prompt: { mode: 'workflow' },
        comfyui: { workflowId: 'wf-img2img', instanceUuid: 'instance-img2img' },
      },
      photoshop: { ...baseConfig('/unused').photoshop, enabled: false, templates: [] },
      title: { ...baseConfig('/unused').title, enabled: false },
    })
    const firstConfig = JSON.parse(firstRun.run.config_json) as PipelineRunConfig
    expect(
      firstConfig.source.mode === 'img2img' && firstConfig.source.provider === 'comfyui-chenyu'
        ? firstConfig.source.sourceManifest?.map((item) => item.path)
        : undefined,
    ).toEqual([firstSourcePath, secondSourcePath])

    updateRunStatusForTest(runId, 'interrupted')
    await createPrint(join(sourceFolder, '000-new.png'))
    mocks.runComfyuiImg2imgBatch.mockClear()
    const resumed = await service.resumeRun(runId)

    expect(resumed.run.status).toBe('completed')
    expect(mocks.runComfyuiImg2imgBatch).not.toHaveBeenCalled()
    expect(
      (resumed.items ?? []).filter(
        (item) => item.step_key === 'source' && item.status === 'completed',
      ),
    ).toHaveLength(2)
  })

  it('persists and reuses each ComfyUI img2img AI prompt before resuming its source item', async () => {
    const sourceFolder = join(
      mocks.workbenchRoot,
      WORKBENCH_DIRECTORIES.generation,
      'resume-comfyui-source-prompt',
    )
    const sourcePath = join(sourceFolder, 'source.png')
    const outputPath = join(mocks.workbenchRoot, 'resume-comfyui-source-prompt.png')
    await createPrint(sourcePath)
    mocks.runComfyuiImg2imgBatch.mockImplementationOnce(
      async (input: ComfyuiMockInput, dependencies?: GenerationBatchDependencies) => {
        const inputIndex = input.inputIndexes?.[0] ?? 0
        await dependencies?.onPromptResolved?.({
          taskId: input.taskId ?? 'run-resume-comfyui-source-prompt',
          capability: 'img2img',
          inputIndex,
          sourcePath,
          sourceArtifactId: 'art-source-prompt',
          prompt: 'persisted source prompt',
        })
        const persisted = await service.getRun('run-resume-comfyui-source-prompt')
        const persistedConfig = JSON.parse(persisted?.run.config_json ?? '{}') as PipelineRunConfig
        if (
          persistedConfig.source.mode !== 'img2img' ||
          persistedConfig.source.provider !== 'comfyui-chenyu'
        ) {
          throw new Error('expected ComfyUI img2img source')
        }
        const sourceItemKey = persistedConfig.source.sourceManifest?.[0]?.itemKey ?? ''
        expect(persistedConfig.source.prompt?.resolvedPromptsBySourceKey?.[sourceItemKey]).toBe(
          'persisted source prompt',
        )
        throw new Error('ComfyUI img2img worker exited after prompt persistence')
      },
    )

    const service = new PipelineService() as ResumeCapablePipelineService
    await expect(
      service.runPipeline('run-resume-comfyui-source-prompt', {
        ...baseConfig('/unused'),
        source: {
          mode: 'img2img',
          provider: 'comfyui-chenyu',
          sourceFolder,
          prompt: {
            mode: 'ai',
            requirement: 'new floral print',
            skillId: 'img2img-local-reference',
            model: 'qwen3-vl-flash',
          },
          comfyui: { workflowId: 'wf-img2img', instanceUuid: 'instance-img2img' },
        },
        photoshop: { ...baseConfig('/unused').photoshop, enabled: false, templates: [] },
        title: { ...baseConfig('/unused').title, enabled: false },
      }),
    ).rejects.toThrow('worker exited after prompt persistence')

    mocks.runComfyuiImg2imgBatch.mockClear()
    mocks.runComfyuiImg2imgBatch.mockImplementationOnce(
      async (input: ComfyuiMockInput, dependencies?: GenerationBatchDependencies) => {
        expect(input.resolvedPrompt).toBe('persisted source prompt')
        const resolvedPrompt = input.resolvedPrompt
        if (!resolvedPrompt) {
          throw new Error('expected persisted source prompt')
        }
        await createPrint(outputPath)
        await dependencies?.onImageComplete?.({
          taskId: input.taskId ?? 'run-resume-comfyui-source-prompt',
          capability: 'img2img',
          path: outputPath,
          printId: 'pri-resume-comfyui-source-prompt',
          artifactId: 'art-resume-comfyui-source-prompt',
          prompt: resolvedPrompt,
          sourcePath,
          sourceArtifactIds: ['art-source-prompt'],
          inputIndex: input.inputIndexes?.[0] ?? 0,
          outputIndex: 0,
        })
        return {
          taskId: input.taskId ?? 'run-resume-comfyui-source-prompt',
          total: 1,
          succeeded: 1,
          failed: 0,
          images: [],
          failures: [],
        }
      },
    )

    const resumed = await service.resumeRun('run-resume-comfyui-source-prompt')

    expect(resumed.run.status).toBe('completed')
    expect(mocks.runComfyuiImg2imgBatch).toHaveBeenCalledOnce()
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

  it('stops after a fatal detection batch and waits for in-flight stage pumps to settle', async () => {
    const secondMattingStarted = createDeferred<void>()
    const finishSecondMatting = createDeferred<GenerationRunResult>()
    const firstSourcePath = join(mocks.workbenchRoot, 'fatal-detection-source-1.png')
    const secondSourcePath = join(mocks.workbenchRoot, 'fatal-detection-source-2.png')
    const firstMattedPath = join(mocks.workbenchRoot, 'fatal-detection-matted-1.png')
    const secondMattedPath = join(mocks.workbenchRoot, 'fatal-detection-matted-2.png')
    mocks.runTxt2imgBatch.mockImplementationOnce(
      async (input: Txt2imgMockInput, dependencies?: GenerationBatchDependencies) => {
        const outputs = [
          {
            path: firstSourcePath,
            printId: 'pri-fatal-detection-source-1',
            artifactId: 'art-fatal-detection-source-1',
          },
          {
            path: secondSourcePath,
            printId: 'pri-fatal-detection-source-2',
            artifactId: 'art-fatal-detection-source-2',
          },
        ]
        for (const output of outputs) {
          await dependencies?.onImageComplete?.({
            taskId: input.taskId ?? 'run-stage-pump-failure-txt2img',
            capability: 'txt2img',
            ...output,
            sourceArtifactIds: [],
          })
        }
        return {
          taskId: input.taskId ?? 'run-stage-pump-failure-txt2img',
          total: 2,
          succeeded: 2,
          failed: 0,
          images: outputs.map((output) => ({
            prompt: 'fatal detection',
            url: `file://${basename(output.path)}`,
            localPath: output.path,
            artifactId: output.artifactId,
            printId: output.printId,
          })),
          failures: [],
        }
      },
    )
    mocks.runComfyuiMattingBatch
      .mockImplementationOnce(async (input) => {
        await createPrint(firstMattedPath)
        return mockMattingResult({
          taskId: input.taskId,
          sourcePath: firstSourcePath,
          outputPath: firstMattedPath,
          artifactId: 'art-fatal-detection-matted-1',
          printId: 'pri-fatal-detection-matted-1',
        })
      })
      .mockImplementationOnce(async () => {
        secondMattingStarted.resolve()
        return finishSecondMatting.promise
      })
    mocks.runDetectionBatch.mockResolvedValueOnce({
      taskId: 'run-stage-pump-failure-detection-0-pri-fatal-detection-source-1',
      total: 1,
      succeeded: 0,
      failed: 1,
      skipped: 0,
      results: [
        {
          imagePath: firstMattedPath,
          thumbnailUrl: '',
          status: 'failed',
          errorCode: 'llm_failed',
          error: '阿里云百炼 API Key 无效，请在设置中更新后重试',
          fatal: true,
          appErrorCode: 'BAILIAN_QUOTA_EXCEEDED',
        },
      ],
    })

    const service = new PipelineService()
    const runPromise = service.runPipeline('run-stage-pump-failure', {
      ...baseConfig('/unused'),
      source: {
        mode: 'txt2img',
        provider: 'grsai',
        prompt: { mode: 'manual', prompts: ['first', 'second'] },
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
        skillId: 'infringement-detection',
        model: 'qwen3.6-flash',
        concurrency: 1,
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
    await secondMattingStarted.promise
    const settledBeforeMatting = await Promise.race([
      runPromise.then(
        () => true,
        () => true,
      ),
      new Promise<false>((resolve) => setTimeout(() => resolve(false), 100)),
    ])
    expect(settledBeforeMatting).toBe(false)
    expect(service.getActiveRunCount()).toBe(1)

    finishSecondMatting.resolve(
      mockMattingResult({
        taskId: 'run-stage-pump-failure-matting-pri-fatal-detection-source-2',
        sourcePath: secondSourcePath,
        outputPath: secondMattedPath,
        artifactId: 'art-fatal-detection-matted-2',
        printId: 'pri-fatal-detection-matted-2',
      }),
    )

    await expect(runPromise).rejects.toMatchObject({
      code: 'BAILIAN_QUOTA_EXCEEDED',
      message: '阿里云百炼 API Key 无效，请在设置中更新后重试',
    })
    expect(mocks.runDetectionBatch).toHaveBeenCalledTimes(1)
    await vi.waitUntil(() => service.getActiveRunCount() === 0)
    const detail = await service.getRun('run-stage-pump-failure')
    expect(detail?.run).toMatchObject({
      status: 'failed',
      error_summary: '阿里云百炼 API Key 无效，请在设置中更新后重试',
    })
    expect(detail?.steps.some((step) => step.status === 'running')).toBe(false)
    expect(detail?.items?.some((item) => item.status === 'running')).toBe(false)
  })

  it('signals the upstream source as soon as a downstream stage fails fatally', async () => {
    const firstSourceEmitted = createDeferred<void>()
    const finishFirstSource = createDeferred<{
      taskId: string
      total: number
      succeeded: number
      failed: number
      images: Array<{ prompt: string; url: string; localPath: string }>
      failures: never[]
    }>()
    const firstSourcePath = join(mocks.workbenchRoot, 'fatal-backpressure-source-1.png')
    mocks.runComfyuiTxt2imgBatch.mockImplementationOnce(
      async (input, dependencies?: GenerationBatchDependencies) => {
        await createPrint(firstSourcePath)
        await dependencies?.onImageComplete?.({
          taskId: input.taskId ?? 'run-fatal-backpressure-txt2img-1',
          capability: 'txt2img',
          path: firstSourcePath,
          printId: 'pri-fatal-backpressure-source-1',
          artifactId: 'art-fatal-backpressure-source-1',
          sourceArtifactIds: [],
        })
        firstSourceEmitted.resolve()
        return finishFirstSource.promise
      },
    )
    mocks.runDetectionBatch.mockResolvedValueOnce({
      taskId: 'run-fatal-backpressure-detection',
      total: 1,
      succeeded: 0,
      failed: 1,
      skipped: 0,
      results: [
        {
          imagePath: firstSourcePath,
          thumbnailUrl: '',
          status: 'failed',
          errorCode: 'llm_failed',
          error: '阿里云百炼 API Key 无效',
          fatal: true,
          appErrorCode: 'HTTP_4XX',
        },
      ],
    })

    const service = new PipelineService()
    const runPromise = service.runPipeline('run-fatal-backpressure', {
      ...baseConfig('/unused'),
      source: {
        mode: 'txt2img',
        provider: 'comfyui-chenyu',
        prompt: { mode: 'manual', prompts: ['first', 'second'] },
        comfyui: {
          workflowId: 'txt2img-workflow',
          instanceUuid: 'instance-source',
        },
      },
      matting: {
        enabled: false,
        mode: 'comfyui',
      },
      detection: {
        enabled: true,
        skillId: 'infringement-detection',
        model: 'qwen3.6-flash',
        concurrency: 1,
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
    void runPromise.catch(() => undefined)

    await firstSourceEmitted.promise
    await vi.waitUntil(() => mocks.runDetectionBatch.mock.calls.length === 1)
    const cancellationObserved = await Promise.race([
      vi
        .waitUntil(() =>
          mocks.requestGenerationCancel.mock.calls.some(
            ([taskId]) => taskId === 'run-fatal-backpressure-txt2img-1',
          ),
        )
        .then(() => true),
      new Promise<false>((resolve) => setTimeout(() => resolve(false), 100)),
    ])
    finishFirstSource.resolve({
      taskId: 'run-fatal-backpressure-txt2img-1',
      total: 1,
      succeeded: 1,
      failed: 0,
      images: [
        {
          prompt: 'first',
          url: `file://${basename(firstSourcePath)}`,
          localPath: firstSourcePath,
        },
      ],
      failures: [],
    })

    expect(cancellationObserved).toBe(true)
    await expect(runPromise).rejects.toThrow('阿里云百炼 API Key 无效')
    expect(mocks.runComfyuiTxt2imgBatch).toHaveBeenCalledTimes(1)
  })

  it('persists a late in-flight source completion without routing it until resume', async () => {
    const firstSourceEmitted = createDeferred<void>()
    const releaseLateSource = createDeferred<void>()
    const firstSourcePath = join(mocks.workbenchRoot, 'late-source-first.png')
    const lateSourcePath = join(mocks.workbenchRoot, 'late-source-second.png')

    mocks.runTxt2imgBatch.mockImplementationOnce(
      async (input: Txt2imgMockInput, dependencies?: GenerationBatchDependencies) => {
        await createPrint(firstSourcePath)
        await dependencies?.onImageComplete?.({
          taskId: input.taskId ?? 'run-late-source-txt2img',
          capability: 'txt2img',
          path: firstSourcePath,
          printId: 'pri-late-source-first',
          artifactId: 'art-late-source-first',
          prompt: 'first',
          sourceArtifactIds: [],
          inputIndex: 0,
          outputIndex: 0,
        })
        firstSourceEmitted.resolve()

        await releaseLateSource.promise
        await createPrint(lateSourcePath)
        await dependencies?.onImageComplete?.({
          taskId: input.taskId ?? 'run-late-source-txt2img',
          capability: 'txt2img',
          path: lateSourcePath,
          printId: 'pri-late-source-second',
          artifactId: 'art-late-source-second',
          prompt: 'second',
          sourceArtifactIds: [],
          inputIndex: 1,
          outputIndex: 0,
        })

        return {
          taskId: input.taskId ?? 'run-late-source-txt2img',
          total: 2,
          succeeded: 2,
          failed: 0,
          images: [
            {
              prompt: 'first',
              url: 'file://late-source-first.png',
              localPath: firstSourcePath,
              artifactId: 'art-late-source-first',
              printId: 'pri-late-source-first',
            },
            {
              prompt: 'second',
              url: 'file://late-source-second.png',
              localPath: lateSourcePath,
              artifactId: 'art-late-source-second',
              printId: 'pri-late-source-second',
            },
          ],
          failures: [],
        }
      },
    )
    mocks.runDetectionBatch.mockResolvedValueOnce({
      taskId: 'run-late-source-detection',
      total: 1,
      succeeded: 0,
      failed: 1,
      skipped: 0,
      results: [
        {
          imagePath: firstSourcePath,
          thumbnailUrl: '',
          status: 'failed',
          errorCode: 'llm_failed',
          error: '阿里云百炼 API Key 无效',
          fatal: true,
          appErrorCode: 'HTTP_4XX',
        },
      ],
    })

    const service = new PipelineService()
    const runPromise = service.runPipeline('run-late-source', {
      ...baseConfig('/unused'),
      source: {
        mode: 'txt2img',
        provider: 'grsai',
        prompt: { mode: 'manual', prompts: ['first', 'second'] },
        grsai: {
          model: 'gpt-image-2',
          aspectRatio: '1024x1024',
          concurrency: 2,
        },
      },
      matting: {
        enabled: false,
        mode: 'comfyui',
      },
      detection: {
        enabled: true,
        skillId: 'infringement-detection',
        model: 'qwen3.6-flash',
        concurrency: 1,
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
    void runPromise.catch(() => undefined)

    await firstSourceEmitted.promise
    await vi.waitUntil(() => mocks.runDetectionBatch.mock.calls.length === 1)
    await vi.waitUntil(() =>
      mocks.requestGenerationCancel.mock.calls.some(
        ([taskId]) => taskId === 'run-late-source-txt2img',
      ),
    )
    releaseLateSource.resolve()

    await expect(runPromise).rejects.toThrow('阿里云百炼 API Key 无效')
    expect(mocks.runDetectionBatch).toHaveBeenCalledOnce()
    expect(mocks.runDetectionBatch.mock.calls[0]?.[0]).toMatchObject({
      imagePaths: [firstSourcePath],
    })

    const failed = await service.getRun('run-late-source')
    expect(
      (failed?.items ?? [])
        .filter((item) => item.step_key === 'source' && item.status === 'completed')
        .map((item) => ({
          itemKey: item.item_key,
          outputPath: item.output_path,
        })),
    ).toEqual([
      { itemKey: 'txt2img-1-1', outputPath: firstSourcePath },
      { itemKey: 'txt2img-2-1', outputPath: lateSourcePath },
    ])

    mocks.runTxt2imgBatch.mockClear()
    mocks.runDetectionBatch.mockReset()
    mocks.runDetectionBatch.mockImplementation(
      async (input: { taskId?: string; imagePaths: string[] }) => ({
        taskId: input.taskId ?? 'run-late-source-resumed-detection',
        total: input.imagePaths.length,
        succeeded: input.imagePaths.length,
        failed: 0,
        skipped: 0,
        results: input.imagePaths.map((imagePath) => {
          const isLateSource = imagePath === lateSourcePath
          return {
            imagePath,
            thumbnailUrl: '',
            artifactId: isLateSource ? 'art-late-source-second' : 'art-late-source-first',
            printId: isLateSource ? 'pri-late-source-second' : 'pri-late-source-first',
            status: 'success' as const,
            riskScore: 0,
            riskLevel: 'pass' as const,
            reason: '低风险',
            outputPath: imagePath,
            cached: false,
          }
        }),
      }),
    )

    const resumed = await service.resumeRun('run-late-source')

    expect(resumed.run.status).toBe('completed')
    expect(mocks.runTxt2imgBatch).not.toHaveBeenCalled()
    expect(mocks.runDetectionBatch.mock.calls.flatMap((call) => call[0]?.imagePaths ?? [])).toEqual(
      expect.arrayContaining([firstSourcePath, lateSourcePath]),
    )
  })

  it('preserves the pipeline error when final state flushing also fails', async () => {
    mocks.runTxt2imgBatch.mockRejectedValueOnce(new Error('primary pipeline failure'))
    const service = new PipelineService()
    vi.spyOn(
      service as unknown as PipelineServiceWithFlushHook,
      'flushRunUiState',
    ).mockImplementation(() => {
      throw new Error('final state flush failure')
    })

    const runPromise = service.runPipeline('run-primary-error-preserved', {
      ...baseConfig('/unused'),
      source: {
        mode: 'txt2img',
        provider: 'grsai',
        prompt: { mode: 'manual', prompts: ['one'] },
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

    await expect(runPromise).rejects.toThrow('primary pipeline failure')
    await expect(service.getRun('run-primary-error-preserved')).resolves.toMatchObject({
      run: {
        status: 'failed',
        error_summary: 'primary pipeline failure',
      },
    })
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
      detectionCalls.push(...input.imagePaths)
      if (input.imagePaths.some((imagePath: string) => imagePath.endsWith('matted-1.png'))) {
        firstDetectionFinished.resolve()
      }
      if (input.imagePaths.some((imagePath: string) => imagePath.endsWith('matted-2.png'))) {
        await secondDetectionGate.promise
      }
      return {
        taskId: input.taskId ?? 'run-stream-detection-detection',
        total: input.imagePaths.length,
        succeeded: input.imagePaths.length,
        failed: 0,
        skipped: 0,
        results: input.imagePaths.map((imagePath: string) =>
          imagePath.endsWith('matted-1.png')
            ? {
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
              }
            : {
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
        ),
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
      expect.stringMatching(/^run-stream-matting-detection-detection-\d+-/),
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
    const templateNameOverrides: Array<string | undefined> = []

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
          templateNameOverride?: string
        },
      ) => {
        const templatePath = Array.isArray(templates) ? String(templates[0] ?? '') : ''
        const printId = prints[0]?.id ?? 'print'
        templateNameOverrides.push(config.templateNameOverride)
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
    expect(templateNameOverrides).toEqual(['mug', 'shirt', 'mug', 'shirt'])
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
        expect(input.imagePaths).toHaveLength(2)
        expect(input.imageInputs).toEqual([
          expect.objectContaining({
            path: generatedImages[0]?.localPath,
            artifactId: 'art-img2img-pass',
            printId: 'pri-img2img-pass',
          }),
          expect.objectContaining({
            path: generatedImages[1]?.localPath,
            artifactId: 'art-img2img-block',
            printId: 'pri-img2img-block',
          }),
        ])
        return {
          taskId: 'run-img2img-detection-detection-batch',
          total: input.imagePaths.length,
          succeeded: input.imagePaths.length,
          failed: 0,
          skipped: 0,
          results: input.imagePaths.map((imagePath: string) =>
            imagePath.endsWith('img2img-pass.png')
              ? {
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
                }
              : {
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
          ),
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
      const results = input.imagePaths.map((imagePath: string) => {
        if (imagePath.endsWith('pass.png')) {
          return {
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
          }
        }
        if (imagePath.endsWith('review.png')) {
          return {
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
          }
        }
        return {
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
        }
      })
      return {
        taskId: 'run-detection-sections-detection-batch',
        total: results.length,
        succeeded: results.length,
        failed: 0,
        skipped: 0,
        results,
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

    const runId = await handler(
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

  it('rejects invalid pipeline paths before returning an orphan run id at the IPC boundary', async () => {
    const outsideSource = join(mocks.workbenchRoot, 'outside-ipc-source')
    await createPrint(join(outsideSource, 'source.png'))
    registerPipelineIpc()
    const handler = mocks.ipcHandlers.get('pipeline:run')
    if (!handler) {
      throw new Error('pipeline:run handler was not registered')
    }

    await expect(
      handler(
        {},
        {
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
        },
      ),
    ).rejects.toThrow('完整任务采集来源目录')
    expect(pipelineService.getActiveRunCount()).toBe(0)
    expect(mocks.sentEvents.some((event) => event.channel === 'pipeline:completed')).toBe(false)
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

  it('rejects empty cancel run ids at the IPC schema boundary', () => {
    registerPipelineIpc()
    const handler = mocks.ipcHandlers.get('pipeline:cancel')
    if (!handler) {
      throw new Error('pipeline:cancel handler was not registered')
    }

    expect(() => handler({}, { run_id: '' })).toThrow('完整任务 ID 无效')
  })

  it('rejects empty get-run ids at the IPC schema boundary', () => {
    registerPipelineIpc()
    const handler = mocks.ipcHandlers.get('pipeline:get-run')
    if (!handler) {
      throw new Error('pipeline:get-run handler was not registered')
    }

    expect(() => handler({}, { run_id: '' })).toThrow('完整任务 ID 无效')
  })
})
