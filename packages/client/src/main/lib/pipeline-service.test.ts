import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import {
  type PhotoshopPrintAsset,
  type PipelineRunConfig,
  WORKBENCH_DIRECTORIES,
} from '@tengyu-aipod/shared'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PipelineService, registerPipelineIpc } from './pipeline-service'

const originalPlatform = Object.getOwnPropertyDescriptor(process, 'platform')

const mocks = vi.hoisted(() => ({
  workbenchRoot: '',
  ipcHandlers: new Map<string, (...args: unknown[]) => unknown>(),
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
    async (input: { batchDir: string; taskId: string; titleFileName?: string }) => ({
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
  runTxt2imgBatch: vi.fn(async () => ({
    taskId: 'txt2img-task',
    capability: 'img2img' as const,
    total: 1,
    succeeded: 1,
    failed: 0,
    images: [
      {
        prompt: 'new print',
        url: 'file://generated.png',
        localPath: join(mocks.workbenchRoot, 'generated.png'),
      },
    ],
  })),
}))

vi.mock('electron', () => ({
  BrowserWindow: {
    getAllWindows: () => [],
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
  },
}))

vi.mock('./detection-service', () => ({
  detectionService: {
    runDetectionBatch: vi.fn(),
    cancelTask: vi.fn(),
  },
}))

vi.mock('./generation-service', () => ({
  generateTxt2imgPrompts: vi.fn(),
  runComfyuiExtractBatch: vi.fn(),
  runComfyuiMattingBatch: vi.fn(),
  runExtractBatch: vi.fn(),
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

function baseConfig(printFolder: string): PipelineRunConfig {
  return {
    name: '完整任务测试',
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
    mocks.runTxt2imgBatch.mockClear()
  })

  afterEach(async () => {
    if (originalPlatform) {
      Object.defineProperty(process, 'platform', originalPlatform)
    }
    await rm(mocks.workbenchRoot, { recursive: true, force: true })
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
