import { mkdir, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import type { Skill } from '@tengyu-aipod/shared'
import type Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  listComfyuiExtractWorkflows,
  listComfyuiImg2imgWorkflows,
  listComfyuiMattingWorkflows,
  listComfyuiMixedMattingWorkflows,
  listExtractSources,
  listImg2imgSources,
  runComfyuiExtractBatch,
  runComfyuiImg2imgBatch,
  runComfyuiMattingBatch,
  runExtractBatch,
  runMixedMattingBatch,
} from './generation-service'

type TestDatabase = Pick<Database.Database, 'exec' | 'prepare' | 'close'>

let tempRoot = ''
let workbenchRoot = ''

vi.mock('electron', () => ({
  BrowserWindow: {
    getAllWindows: () => [],
  },
  ipcMain: {
    handle: vi.fn(),
  },
}))

vi.mock('../onboarding', () => ({
  readAppConfig: () => ({ workbench_root: workbenchRoot }),
}))

function extractSkill(overrides: Partial<Skill> = {}): Skill {
  return {
    id: 'extract-prompt-v3',
    module: 'generation',
    category: 'extract',
    platform: null,
    language: null,
    version: '3.0.1',
    enabled: true,
    recommendedModel: 'qwen3-vl-plus',
    notes: null,
    systemPrompt: 'Extract print prompts.',
    variables: [
      {
        key: 'printAreaPreference',
        label: '印花区域偏好',
        type: 'select',
        default: 'auto',
        options: [{ value: 'auto', label: '自动识别' }],
      },
      {
        key: 'allowMultiplePrints',
        label: '允许多印花',
        type: 'checkbox',
        default: true,
      },
    ],
    ...overrides,
  }
}

function createFakeDb() {
  const artifacts: unknown[][] = []
  const rowsBySql = new Map<string, unknown[]>()
  const db = {
    exec: vi.fn(),
    prepare: vi.fn((sql: string) => {
      if (sql.includes('INSERT INTO artifacts')) {
        return {
          run: (...values: unknown[]) => {
            artifacts.push(values)
          },
        }
      }
      if (sql.includes('FROM artifacts')) {
        return {
          all: () => rowsBySql.get('artifacts') ?? [],
          get: (id?: string) =>
            (rowsBySql.get('artifacts') ?? []).find((row) => {
              return typeof row === 'object' && row !== null && 'id' in row && row.id === id
            }),
        }
      }
      if (sql.includes('FROM comfyui_instances')) {
        return { get: () => ({ comfyui_url: 'https://comfy.example' }) }
      }
      return { run: vi.fn() }
    }),
    close: vi.fn(),
  }

  return {
    artifacts,
    rowsBySql,
    db,
    openDatabase: () => db as unknown as TestDatabase,
  }
}

function createDbWithoutComfyuiInstance() {
  const fakeDb = createFakeDb()
  fakeDb.db.prepare = vi.fn((sql: string) => {
    if (sql.includes('INSERT INTO artifacts')) {
      return {
        run: (...values: unknown[]) => {
          fakeDb.artifacts.push(values)
        },
      }
    }
    if (sql.includes('FROM artifacts')) {
      return {
        all: () => fakeDb.rowsBySql.get('artifacts') ?? [],
        get: (id?: string) =>
          (fakeDb.rowsBySql.get('artifacts') ?? []).find((row) => {
            return typeof row === 'object' && row !== null && 'id' in row && row.id === id
          }),
      }
    }
    if (sql.includes('FROM comfyui_instances')) {
      throw new Error('no such table: comfyui_instances')
    }
    return { run: vi.fn() }
  })
  return fakeDb
}

async function createImage(path: string, content: string) {
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, content)
}

beforeEach(async () => {
  const { mkdtemp } = await import('node:fs/promises')
  tempRoot = await mkdtemp(join(tmpdir(), 'tengyu-generation-service-'))
  workbenchRoot = join(tempRoot, 'workbench')
  await mkdir(join(workbenchRoot, '01-采集'), { recursive: true })
})

afterEach(async () => {
  await rm(tempRoot, { recursive: true, force: true })
})

describe('generation extract service', () => {
  it('lists collection images recursively for extract sources', async () => {
    await createImage(join(workbenchRoot, '01-采集', 'sku-a', 'a.png'), 'image-a')
    await createImage(join(workbenchRoot, '01-采集', 'sku-b', 'b.webp'), 'image-b')
    await writeFile(join(workbenchRoot, '01-采集', 'note.txt'), 'ignore')

    const result = await listExtractSources({
      readConfig: async () => ({ workbench_root: workbenchRoot }),
    })

    expect(result.folder).toBe(join(workbenchRoot, '01-采集'))
    expect(result.images.map((image) => image.relativePath)).toEqual([
      'sku-a/a.png',
      'sku-b/b.webp',
    ])
    expect(result.images[0]?.thumbnailUrl).toMatch(/^file:/)
  })

  it('generates extract prompts with source image, calls Grsai extract, saves outputs, and stores artifacts', async () => {
    const sourcePath = join(workbenchRoot, '01-采集', 'sku-a', 'source.png')
    await createImage(sourcePath, 'source-image')
    const fakeDb = createFakeDb()
    const progress: unknown[] = []
    const generatePrompts = vi.fn().mockResolvedValue(['centered white background print'])
    const generate = vi.fn().mockResolvedValue({
      status: 'succeeded',
      images: [{ url: 'https://example.test/result.png' }],
    })
    const downloadImage = vi.fn().mockResolvedValue(Buffer.from('result-image'))

    const result = await runExtractBatch(
      {
        sourceImagePaths: [sourcePath],
        skillId: 'extract-prompt-v3',
        variables: {
          printAreaPreference: 'auto',
          allowMultiplePrints: true,
        },
        promptCount: 1,
        llmModel: 'qwen3-vl-plus',
        model: 'nano-banana-2',
        aspectRatio: '1:1',
        imageSize: '1K',
        concurrency: 1,
        taskId: 'extract-task',
      },
      {
        readConfig: async () => ({ workbench_root: workbenchRoot }),
        getSecret: async () => 'sk-grsai',
        openDatabase: fakeDb.openDatabase,
        skillCache: {
          getSkill: vi.fn().mockResolvedValue(extractSkill()),
          listSkills: vi.fn(),
        },
        promptGenerator: { generatePrompts },
        createGrsaiAdapter: () => ({ generate }),
        downloadImage,
        emitProgress: (item) => progress.push(item),
      },
    )

    expect(result).toMatchObject({ taskId: 'extract-task', total: 1, succeeded: 1, failed: 0 })
    expect(result.images[0]?.localPath).toContain(join('02-生图', '03-提取'))
    await expect(stat(result.images[0]?.localPath ?? '')).resolves.toBeTruthy()
    expect(generatePrompts).toHaveBeenCalledWith(
      expect.objectContaining({
        refImages: [expect.objectContaining({ mime_type: 'image/png' })],
        count: 1,
        model: 'qwen3-vl-plus',
      }),
    )
    expect(generate).toHaveBeenCalledWith(
      expect.objectContaining({
        capability: 'extract',
        prompt: 'centered white background print',
        reference_images: [expect.objectContaining({ mime_type: 'image/png' })],
      }),
    )
    expect(downloadImage).toHaveBeenCalledWith('https://example.test/result.png')
    expect(fakeDb.artifacts).toHaveLength(2)
    expect(fakeDb.artifacts[1]?.[3]).toBe('extract')
    expect(fakeDb.artifacts[1]?.[4]).toBe('grsai')
    expect(fakeDb.artifacts[1]?.[12]).toBe('centered white background print')
    expect(progress).toContainEqual(
      expect.objectContaining({ task_id: 'extract-task', capability: 'extract', processed: 1 }),
    )
  })
})

describe('generation comfyui extract service', () => {
  it('lists only extract ComfyUI workflows', async () => {
    const result = await listComfyuiExtractWorkflows({
      workflowCache: {
        listWorkflows: vi.fn().mockResolvedValue([
          {
            id: 'extract-v1',
            version: '1.0.0',
            name: 'Extract',
            capability: 'extract',
            requiredModels: [],
          },
          {
            id: 'img2img-v1',
            version: '1.0.0',
            name: 'Image Variation',
            capability: 'img2img',
            requiredModels: [],
          },
        ]),
      },
    })

    expect(result.map((workflow) => workflow.id)).toEqual(['extract-v1'])
  })

  it('runs ComfyUI extract with collection source lineage', async () => {
    const sourcePath = join(workbenchRoot, '01-采集', 'sku-a', 'source.png')
    await createImage(sourcePath, 'source-image')
    const fakeDb = createFakeDb()
    const progress: unknown[] = []
    const generate = vi.fn().mockResolvedValue({
      status: 'succeeded',
      images: [{ url: 'file:///result.png', local_path: '/result.png' }],
    })

    const result = await runComfyuiExtractBatch(
      {
        sourceImagePaths: [sourcePath],
        workflowId: 'extract-v1',
        workflowVersion: '1.0.0',
        prompt: 'extract print',
        taskId: 'extract-comfy-task',
      },
      {
        readConfig: async () => ({ workbench_root: workbenchRoot }),
        getSecret: async () => 'cy-key',
        openDatabase: fakeDb.openDatabase,
        createComfyuiAdapter: () => ({ generate }),
        emitProgress: (item) => progress.push(item),
      },
    )

    expect(result).toMatchObject({
      taskId: 'extract-comfy-task',
      total: 1,
      succeeded: 1,
      failed: 0,
    })
    expect(fakeDb.artifacts).toHaveLength(1)
    const sourceArtifactId = fakeDb.artifacts[0]?.[0]
    expect(fakeDb.artifacts[0]?.[3]).toBe('manual-import')
    expect(fakeDb.artifacts[0]?.[6]).toBe(sourcePath)
    expect(generate).toHaveBeenCalledWith(
      expect.objectContaining({
        capability: 'extract',
        workflow_id: 'extract-v1',
        reference_images: [expect.objectContaining({ mime_type: 'image/png' })],
        options: expect.objectContaining({
          taskId: 'extract-comfy-task',
          sourceArtifactIds: [sourceArtifactId],
          workflowVersion: '1.0.0',
        }),
      }),
    )
    expect(progress).toContainEqual(
      expect.objectContaining({
        task_id: 'extract-comfy-task',
        capability: 'extract',
        processed: 1,
      }),
    )
  })

  it('rejects ComfyUI extract sources outside collection folder', async () => {
    const outsidePath = join(workbenchRoot, '02-生图', '03-提取', 'print.png')
    await createImage(outsidePath, 'print-image')

    const result = await runComfyuiExtractBatch(
      {
        sourceImagePaths: [outsidePath],
        workflowId: 'extract-v1',
        prompt: 'extract print',
        taskId: 'extract-comfy-task',
      },
      {
        readConfig: async () => ({ workbench_root: workbenchRoot }),
        getSecret: async () => 'cy-key',
        openDatabase: createFakeDb().openDatabase,
        createComfyuiAdapter: () => ({ generate: vi.fn() }),
      },
    )

    expect(result).toMatchObject({
      taskId: 'extract-comfy-task',
      total: 1,
      succeeded: 0,
      failed: 1,
    })
    expect(result.failures[0]?.error).toBe('提取只能选择 01-采集 目录下的源图')
  })

  it('returns a setup error when no ComfyUI instance is registered for extract', async () => {
    const sourcePath = join(workbenchRoot, '01-采集', 'sku-a', 'source.png')
    await createImage(sourcePath, 'source-image')

    await expect(
      runComfyuiExtractBatch(
        {
          sourceImagePaths: [sourcePath],
          workflowId: 'extract-v1',
          prompt: 'extract print',
          taskId: 'extract-comfy-task',
        },
        {
          readConfig: async () => ({ workbench_root: workbenchRoot }),
          getSecret: async () => 'cy-key',
          openDatabase: createDbWithoutComfyuiInstance().openDatabase,
        },
      ),
    ).rejects.toMatchObject({
      code: 'CHENYU_INSTANCE_DOWN',
      message: '请先创建并启动 ComfyUI 实例',
    })
  })
})

describe('generation comfyui img2img service', () => {
  it('lists only registered print artifacts and filters raw collection paths', async () => {
    const printPath = join(workbenchRoot, '02-生图', '03-提取', 'print.png')
    const rawPath = join(workbenchRoot, '01-采集', 'sku-a', 'raw.png')
    await createImage(printPath, 'print-image')
    await createImage(rawPath, 'raw-image')
    const fakeDb = createFakeDb()
    fakeDb.rowsBySql.set('artifacts', [
      {
        id: 'print-artifact',
        print_id: 'pri_print',
        step: 'extract',
        file_path: printPath,
      },
      {
        id: 'raw-artifact',
        print_id: 'pri_raw',
        step: 'manual-import',
        file_path: rawPath,
      },
    ])

    const result = await listImg2imgSources({
      readConfig: async () => ({ workbench_root: workbenchRoot }),
      openDatabase: fakeDb.openDatabase,
    })

    expect(result.images.map((image) => image.artifactId)).toEqual(['print-artifact'])
    expect(result.folders).toContain(join(workbenchRoot, '02-生图', '03-提取'))
  })

  it('registers eligible generation folder images as img2img sources', async () => {
    const printPath = join(workbenchRoot, '02-生图', '01-文生图', 'folder-print.png')
    await createImage(printPath, 'folder-print-image')
    const fakeDb = createFakeDb()

    await listImg2imgSources({
      readConfig: async () => ({ workbench_root: workbenchRoot }),
      openDatabase: fakeDb.openDatabase,
    })

    expect(fakeDb.artifacts).toHaveLength(1)
    expect(fakeDb.artifacts[0]?.[3]).toBe('txt2img')
    expect(fakeDb.artifacts[0]?.[6]).toBe(printPath)
  })

  it('lists only img2img ComfyUI workflows', async () => {
    const result = await listComfyuiImg2imgWorkflows({
      workflowCache: {
        listWorkflows: vi.fn().mockResolvedValue([
          {
            id: 'img2img-v1',
            version: '1.0.0',
            name: 'Image Variation',
            capability: 'img2img',
            requiredModels: [],
          },
          {
            id: 'extract-v1',
            version: '1.0.0',
            name: 'Extract',
            capability: 'extract',
            requiredModels: [],
          },
        ]),
      },
    })

    expect(result.map((workflow) => workflow.id)).toEqual(['img2img-v1'])
  })

  it('runs ComfyUI img2img with selected print artifact lineage', async () => {
    const printPath = join(workbenchRoot, '02-生图', '03-提取', 'print.png')
    await createImage(printPath, 'print-image')
    const fakeDb = createFakeDb()
    fakeDb.rowsBySql.set('artifacts', [
      {
        id: 'print-artifact',
        print_id: 'pri_print',
        step: 'extract',
        file_path: printPath,
      },
    ])
    const generate = vi.fn().mockResolvedValue({
      status: 'succeeded',
      images: [{ url: 'file:///result.png', local_path: '/result.png' }],
    })

    const result = await runComfyuiImg2imgBatch(
      {
        sourceArtifactIds: ['print-artifact'],
        workflowId: 'img2img-v1',
        prompt: 'make a new floral print',
        taskId: 'img2img-task',
      },
      {
        readConfig: async () => ({ workbench_root: workbenchRoot }),
        getSecret: async () => 'cy-key',
        openDatabase: fakeDb.openDatabase,
        createComfyuiAdapter: () => ({ generate }),
      },
    )

    expect(result).toMatchObject({ taskId: 'img2img-task', total: 1, succeeded: 1, failed: 0 })
    expect(generate).toHaveBeenCalledWith(
      expect.objectContaining({
        capability: 'img2img',
        workflow_id: 'img2img-v1',
        reference_images: [expect.objectContaining({ mime_type: 'image/png' })],
        options: expect.objectContaining({
          taskId: 'img2img-task',
          sourceArtifactIds: ['print-artifact'],
          printId: 'pri_print',
        }),
      }),
    )
  })

  it('returns a setup error when no ComfyUI instance is registered', async () => {
    const printPath = join(workbenchRoot, '02-生图', '03-提取', 'print.png')
    await createImage(printPath, 'print-image')
    const fakeDb = createDbWithoutComfyuiInstance()
    fakeDb.rowsBySql.set('artifacts', [
      {
        id: 'print-artifact',
        print_id: 'pri_print',
        step: 'extract',
        file_path: printPath,
      },
    ])

    await expect(
      runComfyuiImg2imgBatch(
        {
          sourceArtifactIds: ['print-artifact'],
          workflowId: 'img2img-v1',
          prompt: 'make a new floral print',
          taskId: 'img2img-task',
        },
        {
          readConfig: async () => ({ workbench_root: workbenchRoot }),
          getSecret: async () => 'cy-key',
          openDatabase: fakeDb.openDatabase,
        },
      ),
    ).rejects.toMatchObject({
      code: 'CHENYU_INSTANCE_DOWN',
      message: '请先创建并启动 ComfyUI 实例',
    })
  })
})

describe('generation comfyui matting service', () => {
  it('lists only matting ComfyUI workflows', async () => {
    const result = await listComfyuiMattingWorkflows({
      workflowCache: {
        listWorkflows: vi.fn().mockResolvedValue([
          {
            id: 'matting-v1',
            version: '1.0.0',
            name: 'BiRefNet',
            capability: 'matting',
            requiredModels: [],
          },
          {
            id: 'extract-v1',
            version: '1.0.0',
            name: 'Extract',
            capability: 'extract',
            requiredModels: [],
          },
        ]),
      },
    })

    expect(result.map((workflow) => workflow.id)).toEqual(['matting-v1'])
  })

  it('lists only mixed matting ComfyUI workflows', async () => {
    const result = await listComfyuiMixedMattingWorkflows({
      workflowCache: {
        listWorkflows: vi.fn().mockResolvedValue([
          {
            id: 'matting-mixed-v1',
            version: '1.0.0',
            name: 'Mask Composite',
            capability: 'matting-mixed',
            requiredModels: [],
          },
          {
            id: 'matting-v1',
            version: '1.0.0',
            name: 'BiRefNet',
            capability: 'matting',
            requiredModels: [],
          },
        ]),
      },
    })

    expect(result.map((workflow) => workflow.id)).toEqual(['matting-mixed-v1'])
  })

  it('runs ComfyUI matting with selected print source lineage', async () => {
    const printPath = join(workbenchRoot, '02-生图', '03-提取', 'print.png')
    await createImage(printPath, 'print-image')
    const fakeDb = createFakeDb()
    fakeDb.rowsBySql.set('artifacts', [
      {
        id: 'print-artifact',
        print_id: 'pri_print',
        step: 'extract',
        file_path: printPath,
      },
    ])
    const progress: unknown[] = []
    const generate = vi.fn().mockResolvedValue({
      status: 'succeeded',
      images: [{ url: 'file:///matting.png', local_path: '/matting.png' }],
    })

    const result = await runComfyuiMattingBatch(
      {
        sourceArtifactIds: ['print-artifact'],
        workflowId: 'matting-v1',
        workflowVersion: '1.0.0',
        prompt: 'remove background',
        taskId: 'matting-task',
      },
      {
        readConfig: async () => ({ workbench_root: workbenchRoot }),
        getSecret: async () => 'cy-key',
        openDatabase: fakeDb.openDatabase,
        createComfyuiAdapter: () => ({ generate }),
        emitProgress: (item) => progress.push(item),
      },
    )

    expect(result).toMatchObject({ taskId: 'matting-task', total: 1, succeeded: 1, failed: 0 })
    expect(generate).toHaveBeenCalledWith(
      expect.objectContaining({
        capability: 'matting',
        workflow_id: 'matting-v1',
        reference_images: [expect.objectContaining({ mime_type: 'image/png' })],
        options: expect.objectContaining({
          taskId: 'matting-task',
          sourceArtifactIds: ['print-artifact'],
          printId: 'pri_print',
          workflowVersion: '1.0.0',
        }),
      }),
    )
    expect(progress).toContainEqual(
      expect.objectContaining({ task_id: 'matting-task', capability: 'matting', processed: 1 }),
    )
  })

  it('filters raw collection images out of matting sources through artifact validation', async () => {
    const rawPath = join(workbenchRoot, '01-采集', 'sku-a', 'raw.png')
    await createImage(rawPath, 'raw-image')
    const fakeDb = createFakeDb()
    fakeDb.rowsBySql.set('artifacts', [
      {
        id: 'raw-artifact',
        print_id: 'pri_raw',
        step: 'manual-import',
        file_path: rawPath,
      },
    ])

    const result = await runComfyuiMattingBatch(
      {
        sourceArtifactIds: ['raw-artifact'],
        workflowId: 'matting-v1',
        prompt: 'remove background',
        taskId: 'matting-task',
      },
      {
        readConfig: async () => ({ workbench_root: workbenchRoot }),
        getSecret: async () => 'cy-key',
        openDatabase: fakeDb.openDatabase,
        createComfyuiAdapter: () => ({ generate: vi.fn() }),
      },
    )

    expect(result).toMatchObject({ taskId: 'matting-task', total: 1, succeeded: 0, failed: 1 })
    expect(result.failures[0]?.error).toBe('图生图不能直接选择 01-采集 原图，请先提取成印花')
  })

  it('runs mixed matting through Grsai mask generation and ComfyUI compositing', async () => {
    const printPath = join(workbenchRoot, '02-生图', '03-提取', 'print.png')
    await createImage(printPath, 'print-image')
    const fakeDb = createFakeDb()
    fakeDb.rowsBySql.set('artifacts', [
      {
        id: 'print-artifact',
        print_id: 'pri_print',
        step: 'extract',
        file_path: printPath,
      },
    ])
    const progress: unknown[] = []
    const generateMask = vi.fn().mockResolvedValue({
      status: 'succeeded',
      images: [{ url: 'https://example.test/mask.png' }],
    })
    const generateComposite = vi.fn().mockResolvedValue({
      status: 'succeeded',
      images: [{ url: 'file:///matting.png', local_path: '/matting.png' }],
    })
    const createTaskDir = vi.fn(async () => {
      const dir = join(workbenchRoot, '.workbench', 'tmp', 'matting', 'mixed-task')
      await mkdir(dir, { recursive: true })
      return dir
    })
    const cleanupTask = vi.fn()
    const downloadImage = vi.fn().mockResolvedValue(Buffer.from('mask-image'))
    const listSkills = vi.fn().mockResolvedValue([
      {
        id: 'matting-mask-v1',
        module: 'generation',
        category: 'matting-mask',
        platform: null,
        language: null,
        version: '1.0.0',
        enabled: true,
        recommendedModel: 'nano-banana-2',
        notes: null,
      },
    ])
    const getSkill = vi.fn().mockResolvedValue(
      extractSkill({
        id: 'matting-mask-v1',
        category: 'matting-mask',
        version: '1.0.0',
        systemPrompt: 'Make a white background black print mask.',
      }),
    )

    const result = await runMixedMattingBatch(
      {
        sourceArtifactIds: ['print-artifact'],
        workflowId: 'matting-mixed-v1',
        workflowVersion: '1.0.0',
        prompt: 'composite alpha',
        taskId: 'mixed-task',
      },
      {
        readConfig: async () => ({ workbench_root: workbenchRoot }),
        getSecret: async (key) => (key === 'grsai' ? 'sk-grsai' : 'cy-key'),
        openDatabase: fakeDb.openDatabase,
        skillCache: {
          getSkill,
          listSkills,
        },
        createGrsaiAdapter: () => ({ generate: generateMask }),
        createComfyuiAdapter: () => ({ generate: generateComposite }),
        downloadImage,
        emitProgress: (item) => progress.push(item),
        tempFiles: { createTaskDir, cleanupTask },
      },
    )

    expect(result).toMatchObject({ taskId: 'mixed-task', total: 1, succeeded: 1, failed: 0 })
    expect(listSkills).toHaveBeenCalledWith({ module: 'generation', category: 'matting-mask' })
    expect(getSkill).toHaveBeenCalledWith('matting-mask-v1', '1.0.0')
    expect(generateMask).toHaveBeenCalledWith(
      expect.objectContaining({
        capability: 'img2img',
        prompt: 'Make a white background black print mask.',
        reference_images: [expect.objectContaining({ mime_type: 'image/png' })],
        options: expect.objectContaining({
          replyType: 'async',
          skillId: 'matting-mask-v1',
          skillVersion: '1.0.0',
        }),
      }),
    )
    expect(downloadImage).toHaveBeenCalledWith('https://example.test/mask.png')
    expect(generateComposite).toHaveBeenCalledWith(
      expect.objectContaining({
        capability: 'matting',
        workflow_id: 'matting-mixed-v1',
        reference_images: [
          expect.objectContaining({ mime_type: 'image/png' }),
          expect.objectContaining({ mime_type: 'image/png' }),
        ],
        options: expect.objectContaining({
          taskId: 'mixed-task',
          sourceArtifactIds: ['print-artifact'],
          printId: 'pri_print',
          workflowCategory: 'matting-mixed',
          artifactProvider: 'grsai+comfyui-mask',
          maskSkillId: 'matting-mask-v1',
        }),
      }),
    )
    expect(cleanupTask).toHaveBeenCalledWith('matting', 'mixed-task')
    expect(progress).toContainEqual(
      expect.objectContaining({ task_id: 'mixed-task', capability: 'matting', processed: 1 }),
    )
  })
})
