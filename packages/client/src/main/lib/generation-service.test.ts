import { mkdir, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import type { Skill } from '@tengyu-aipod/shared'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  type GenerationDebugLogEntry,
  generateTxt2imgPrompts,
  listComfyuiExtractWorkflows,
  listComfyuiImg2imgWorkflows,
  listComfyuiMattingWorkflows,
  listComfyuiMixedMattingWorkflows,
  listComfyuiTxt2imgWorkflows,
  listExtractSources,
  listImg2imgSources,
  resolveImg2imgReferences,
  runComfyuiExtractBatch,
  runComfyuiImg2imgBatch,
  runComfyuiMattingBatch,
  runComfyuiTxt2imgBatch,
  runExtractBatch,
  runMixedMattingBatch,
  runTxt2imgBatch,
  scanGenerationImageFolder,
} from './generation-service'
import { promptGeneratorService } from './prompt-generator-service'
import type { SqliteDatabase } from './sqlite'

type TestDatabase = Pick<SqliteDatabase, 'exec' | 'prepare' | 'close'>

let tempRoot = ''
let workbenchRoot = ''

vi.mock('electron', () => ({
  BrowserWindow: {
    getAllWindows: () => [],
  },
  dialog: {
    showOpenDialog: vi.fn(),
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
    recommendedModel: 'qwen3.6-flash',
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
            const rows = rowsBySql.get('artifacts') ?? []
            rowsBySql.set('artifacts', [
              {
                id: String(values[0]),
                print_id: String(values[2]),
                step: String(values[3]),
                file_path: String(values[6]),
              },
              ...rows.filter((row) => {
                return !(
                  typeof row === 'object' &&
                  row !== null &&
                  'id' in row &&
                  row.id === values[0]
                )
              }),
            ])
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
          const rows = fakeDb.rowsBySql.get('artifacts') ?? []
          fakeDb.rowsBySql.set('artifacts', [
            {
              id: String(values[0]),
              print_id: String(values[2]),
              step: String(values[3]),
              file_path: String(values[6]),
            },
            ...rows.filter((row) => {
              return !(
                typeof row === 'object' &&
                row !== null &&
                'id' in row &&
                row.id === values[0]
              )
            }),
          ])
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
  await mkdir(join(workbenchRoot, '01-采集工作区'), { recursive: true })
})

afterEach(async () => {
  await rm(tempRoot, { recursive: true, force: true })
  vi.restoreAllMocks()
})

describe('generation prompt service entrypoint', () => {
  it('allows 1000 prompt requests to reach the prompt generator', async () => {
    const generatePrompts = vi
      .spyOn(promptGeneratorService, 'generatePrompts')
      .mockResolvedValue(Array.from({ length: 1000 }, (_, index) => `Prompt ${index + 1}`))

    const result = await generateTxt2imgPrompts({
      capability: 'txt2img',
      skillId: 'txt2img-local-print',
      requirement: 'christmas teddy bear print',
      count: 1000,
      model: 'qwen3.6-flash',
    })

    expect(result).toHaveLength(1000)
    expect(generatePrompts).toHaveBeenCalledWith(
      expect.objectContaining({
        count: 1000,
        variables: expect.objectContaining({ count: 1000 }),
        userMessage: expect.stringContaining('1000'),
      }),
    )
  })
})

describe('generation Grsai paid image service', () => {
  it('saves txt2img outputs under the task folder and stores artifacts', async () => {
    const fakeDb = createFakeDb()
    const generate = vi.fn().mockResolvedValue({
      status: 'succeeded',
      images: [{ url: 'https://example.test/txt-result.png' }],
    })
    const downloadImage = vi.fn().mockResolvedValue(Buffer.from('txt-result-image'))
    const debugLogs: GenerationDebugLogEntry[] = []

    const result = await runTxt2imgBatch(
      {
        prompts: ['centered y2k star print'],
        model: 'gpt-image-2',
        aspectRatio: '1024x1024',
        concurrency: 1,
        taskId: 'txt-task',
      },
      {
        readConfig: async () => ({ workbench_root: workbenchRoot }),
        getSecret: async () => 'sk-grsai',
        openDatabase: fakeDb.openDatabase,
        createGrsaiAdapter: () => ({ generate }),
        downloadImage,
        emitDebugLog: (entry) => debugLogs.push(entry),
      },
    )

    expect(result).toMatchObject({ taskId: 'txt-task', total: 1, succeeded: 1, failed: 0 })
    expect(result.images[0]?.localPath).toContain(join('02-印花工作区', '文生图', 'txt-task'))
    expect(result.images[0]?.url).toMatch(/^file:/)
    await expect(stat(result.images[0]?.localPath ?? '')).resolves.toBeTruthy()
    expect(downloadImage).toHaveBeenCalledWith('https://example.test/txt-result.png')
    expect(fakeDb.artifacts).toHaveLength(1)
    expect(fakeDb.artifacts[0]?.[1]).toBe('txt-task')
    expect(fakeDb.artifacts[0]?.[3]).toBe('txt2img')
    expect(fakeDb.artifacts[0]?.[4]).toBe('grsai')
    expect(fakeDb.artifacts[0]?.[10]).toBe('centered y2k star print')
    expect(debugLogs).toContainEqual(
      expect.objectContaining({
        level: 'debug',
        message: '正在处理提示词',
        capability: 'txt2img',
        taskId: 'txt-task',
        details: expect.objectContaining({
          operation: 'progress',
          prompt: 'centered y2k star print',
        }),
      }),
    )
  })

  it('saves img2img outputs under the task folder with reference images', async () => {
    const fakeDb = createFakeDb()
    const referenceImage = {
      base64: Buffer.from('reference-image').toString('base64'),
      mime_type: 'image/png',
    }
    const generate = vi.fn().mockResolvedValue({
      status: 'succeeded',
      images: [{ url: 'https://example.test/img-result.png' }],
    })

    const result = await runTxt2imgBatch(
      {
        capability: 'img2img',
        prompts: ['make a y2k variation'],
        model: 'gpt-image-2',
        aspectRatio: '1536x1024',
        referenceImages: [referenceImage],
        concurrency: 1,
        taskId: 'img-task',
      },
      {
        readConfig: async () => ({ workbench_root: workbenchRoot }),
        getSecret: async () => 'sk-grsai',
        openDatabase: fakeDb.openDatabase,
        createGrsaiAdapter: () => ({ generate }),
        downloadImage: vi.fn().mockResolvedValue(Buffer.from('img-result-image')),
      },
    )

    expect(result).toMatchObject({ taskId: 'img-task', total: 1, succeeded: 1, failed: 0 })
    expect(result.images[0]?.localPath).toContain(join('02-印花工作区', '图生图', 'img-task'))
    await expect(stat(result.images[0]?.localPath ?? '')).resolves.toBeTruthy()
    expect(generate).toHaveBeenCalledWith(
      expect.objectContaining({
        capability: 'img2img',
        reference_images: [referenceImage],
        output: expect.objectContaining({ aspect_ratio: '1536x1024' }),
      }),
    )
    expect(fakeDb.artifacts[0]?.[3]).toBe('img2img')
  })
})

describe('generation extract service', () => {
  it('lists collection images recursively for extract sources', async () => {
    await createImage(join(workbenchRoot, '01-采集工作区', 'sku-a', 'a.png'), 'image-a')
    await createImage(join(workbenchRoot, '01-采集工作区', 'sku-b', 'b.webp'), 'image-b')
    await writeFile(join(workbenchRoot, '01-采集工作区', 'note.txt'), 'ignore')

    const result = await listExtractSources({
      readConfig: async () => ({ workbench_root: workbenchRoot }),
    })

    expect(result.folder).toBe(join(workbenchRoot, '01-采集工作区'))
    expect(result.images.map((image) => image.relativePath)).toEqual([
      'sku-a/a.png',
      'sku-b/b.webp',
    ])
    expect(result.images[0]?.thumbnailUrl).toMatch(/^file:/)
  })

  it('scans arbitrary image folders recursively with natural ordering', async () => {
    const folder = join(tempRoot, 'external-images')
    await createImage(join(folder, '10.png'), 'image-10')
    await createImage(join(folder, '2.png'), 'image-2')
    await createImage(join(folder, 'nested', '1.webp'), 'image-1')
    await writeFile(join(folder, 'note.txt'), 'ignore')

    const result = await scanGenerationImageFolder({ folder })

    expect(result.map((image) => image.relativePath)).toEqual(['2.png', '10.png', 'nested/1.webp'])
    expect(result.every((image) => image.thumbnailUrl.startsWith('file:'))).toBe(true)
  })

  it('generates extract prompts with source image, calls Grsai extract, saves outputs, and stores artifacts', async () => {
    const sourcePath = join(workbenchRoot, '01-采集工作区', 'sku-a', 'source.png')
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
        llmModel: 'qwen3.6-flash',
        model: 'gpt-image-2',
        aspectRatio: '1024x1024',
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
    expect(result.images[0]?.localPath).toContain(join('02-印花工作区', '提取', 'extract-task'))
    await expect(stat(result.images[0]?.localPath ?? '')).resolves.toBeTruthy()
    expect(generatePrompts).toHaveBeenCalledWith(
      expect.objectContaining({
        refImages: [expect.objectContaining({ mime_type: 'image/png' })],
        count: 1,
        model: 'qwen3.6-flash',
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

describe('generation comfyui service', () => {
  it('lists only txt2img ComfyUI workflows', async () => {
    const result = await listComfyuiTxt2imgWorkflows({
      workflowCache: {
        listWorkflows: vi.fn().mockResolvedValue([
          {
            id: 'txt2img-v1',
            version: '1.0.0',
            name: 'Text To Print',
            capability: 'txt2img',
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

    expect(result.map((workflow) => workflow.id)).toEqual(['txt2img-v1'])
  })

  it('runs ComfyUI txt2img with workflow dimensions', async () => {
    const fakeDb = createFakeDb()
    const progress: unknown[] = []
    const generate = vi.fn().mockResolvedValue({
      status: 'succeeded',
      images: [{ url: 'file:///result.png', local_path: '/result.png' }],
    })

    const result = await runComfyuiTxt2imgBatch(
      {
        prompts: ['centered floral print'],
        workflowId: 'txt2img-v1',
        workflowVersion: '1.0.0',
        width: 1280,
        height: 1536,
        concurrency: 1,
        taskId: 'txt2img-comfy-task',
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
      taskId: 'txt2img-comfy-task',
      total: 1,
      succeeded: 1,
      failed: 0,
    })
    expect(generate).toHaveBeenCalledWith(
      expect.objectContaining({
        capability: 'txt2img',
        prompt: 'centered floral print',
        workflow_id: 'txt2img-v1',
        output: expect.objectContaining({
          size_px: { width: 1280, height: 1536 },
        }),
        options: expect.objectContaining({
          taskId: 'txt2img-comfy-task',
          width: 1280,
          height: 1536,
          workflowVersion: '1.0.0',
        }),
      }),
    )
    expect(progress).toContainEqual(
      expect.objectContaining({
        task_id: 'txt2img-comfy-task',
        capability: 'txt2img',
        processed: 1,
        images: [expect.objectContaining({ localPath: '/result.png' })],
      }),
    )
  })

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
    const sourcePath = join(workbenchRoot, '01-采集工作区', 'sku-a', 'source.png')
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
        prompt: 'extract print',
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

  it('uses the ComfyUI extract skill prompt when a skill is provided', async () => {
    const sourcePath = join(workbenchRoot, '01-采集工作区', 'sku-a', 'source.png')
    await createImage(sourcePath, 'source-image')
    const generate = vi.fn().mockResolvedValue({
      status: 'succeeded',
      images: [{ url: 'file:///result.png', local_path: '/result.png' }],
    })

    await runComfyuiExtractBatch(
      {
        sourceImagePaths: [sourcePath],
        workflowId: 'extract-v1',
        skillId: 'extract-comfyui-workflow',
        skillVersion: '1.0.0',
        prompt: 'manual prompt should not win',
        taskId: 'extract-comfy-skill-task',
      },
      {
        readConfig: async () => ({ workbench_root: workbenchRoot }),
        getSecret: async () => 'cy-key',
        openDatabase: createFakeDb().openDatabase,
        createComfyuiAdapter: () => ({ generate }),
        skillCache: {
          getSkill: vi.fn().mockResolvedValue(
            extractSkill({
              id: 'extract-comfyui-workflow',
              systemPrompt: 'backend comfyui extract prompt',
            }),
          ),
          listSkills: vi.fn(),
        },
      },
    )

    expect(generate).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: 'backend comfyui extract prompt',
      }),
    )
  })

  it('runs ComfyUI extract with arbitrary external source folders', async () => {
    const outsidePath = join(tempRoot, 'external-source', 'print.png')
    await createImage(outsidePath, 'print-image')
    const generate = vi.fn().mockResolvedValue({
      status: 'succeeded',
      images: [{ url: 'file:///result.png', local_path: '/result.png' }],
    })

    const result = await runComfyuiExtractBatch(
      {
        sourceImagePaths: [outsidePath],
        workflowId: 'extract-v1',
        width: 1200,
        height: 1400,
        taskId: 'extract-comfy-task',
      },
      {
        readConfig: async () => ({ workbench_root: workbenchRoot }),
        getSecret: async () => 'cy-key',
        openDatabase: createFakeDb().openDatabase,
        createComfyuiAdapter: () => ({ generate }),
      },
    )

    expect(result).toMatchObject({
      taskId: 'extract-comfy-task',
      total: 1,
      succeeded: 1,
      failed: 0,
    })
    expect(generate).toHaveBeenCalledWith(
      expect.objectContaining({
        output: expect.objectContaining({ size_px: { width: 1200, height: 1400 } }),
      }),
    )
  })

  it('returns a setup error when no ComfyUI instance is registered for extract', async () => {
    const sourcePath = join(workbenchRoot, '01-采集工作区', 'sku-a', 'source.png')
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
      message: '请先到设置页选择默认云机并开机',
    })
  })
})

describe('generation comfyui img2img service', () => {
  it('lists only registered print artifacts and filters raw collection paths', async () => {
    const printPath = join(workbenchRoot, '02-印花工作区', '提取', 'print.png')
    const rawPath = join(workbenchRoot, '01-采集工作区', 'sku-a', 'raw.png')
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
    expect(result.folders).toContain(join(workbenchRoot, '02-印花工作区', '提取'))
  })

  it('resolves img2img references for selected print artifacts', async () => {
    const printPath = join(workbenchRoot, '02-印花工作区', '提取', 'print.png')
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

    const result = await resolveImg2imgReferences(
      { artifactIds: ['print-artifact', 'print-artifact'] },
      {
        readConfig: async () => ({ workbench_root: workbenchRoot }),
        openDatabase: fakeDb.openDatabase,
      },
    )

    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({
      artifactId: 'print-artifact',
      printId: 'pri_print',
      reference: expect.objectContaining({
        mime_type: 'image/png',
        base64: expect.any(String),
      }),
    })
  })

  it('registers eligible generation folder images as img2img sources', async () => {
    const printPath = join(workbenchRoot, '02-印花工作区', '文生图', 'folder-print.png')
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
    const printPath = join(workbenchRoot, '02-印花工作区', '提取', 'print.png')
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

  it('registers arbitrary folder images before running ComfyUI img2img', async () => {
    const printPath = join(tempRoot, 'external-prints', 'print.png')
    await createImage(printPath, 'print-image')
    const fakeDb = createFakeDb()
    const generate = vi.fn().mockResolvedValue({
      status: 'succeeded',
      images: [{ url: 'file:///result.png', local_path: '/result.png' }],
    })

    const result = await runComfyuiImg2imgBatch(
      {
        sourceImagePaths: [printPath],
        workflowId: 'img2img-v1',
        width: 1600,
        height: 1200,
        taskId: 'img2img-folder-task',
      },
      {
        readConfig: async () => ({ workbench_root: workbenchRoot }),
        getSecret: async () => 'cy-key',
        openDatabase: fakeDb.openDatabase,
        createComfyuiAdapter: () => ({ generate }),
      },
    )

    const sourceArtifactId = String(fakeDb.artifacts[0]?.[0])
    expect(fakeDb.artifacts[0]?.[3]).toBe('manual-import')
    expect(fakeDb.artifacts[0]?.[6]).toBe(printPath)
    expect(result).toMatchObject({ taskId: 'img2img-folder-task', total: 1, succeeded: 1 })
    expect(generate).toHaveBeenCalledWith(
      expect.objectContaining({
        output: expect.objectContaining({ size_px: { width: 1600, height: 1200 } }),
        options: expect.objectContaining({
          sourceArtifactIds: [sourceArtifactId],
          width: 1600,
          height: 1200,
        }),
      }),
    )
  })

  it('runs every scanned folder image even when duplicate files share the same hash', async () => {
    const firstPath = join(tempRoot, 'external-duplicates', 'first.png')
    const secondPath = join(tempRoot, 'external-duplicates', 'second.png')
    await createImage(firstPath, 'same-image')
    await createImage(secondPath, 'same-image')
    const fakeDb = createFakeDb()
    const generate = vi.fn().mockResolvedValue({
      status: 'succeeded',
      images: [{ url: 'file:///result.png', local_path: '/result.png' }],
    })

    const result = await runComfyuiImg2imgBatch(
      {
        sourceImagePaths: [firstPath, secondPath],
        workflowId: 'img2img-v1',
        taskId: 'img2img-duplicate-folder-task',
      },
      {
        readConfig: async () => ({ workbench_root: workbenchRoot }),
        getSecret: async () => 'cy-key',
        openDatabase: fakeDb.openDatabase,
        createComfyuiAdapter: () => ({ generate }),
      },
    )

    expect(result).toMatchObject({
      taskId: 'img2img-duplicate-folder-task',
      total: 2,
      succeeded: 2,
      failed: 0,
    })
    expect(fakeDb.artifacts).toHaveLength(2)
    expect(fakeDb.artifacts[0]?.[0]).toBe(fakeDb.artifacts[1]?.[0])
    expect(generate).toHaveBeenCalledTimes(2)
  })

  it('returns a setup error when no ComfyUI instance is registered', async () => {
    const printPath = join(workbenchRoot, '02-印花工作区', '提取', 'print.png')
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
      message: '请先到设置页选择默认云机并开机',
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
    const printPath = join(workbenchRoot, '02-印花工作区', '提取', 'print.png')
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

  it('registers arbitrary folder images before running ComfyUI matting', async () => {
    const printPath = join(tempRoot, 'external-matting', 'print.png')
    await createImage(printPath, 'print-image')
    const fakeDb = createFakeDb()
    const generate = vi.fn().mockResolvedValue({
      status: 'succeeded',
      images: [{ url: 'file:///matting.png', local_path: '/matting.png' }],
    })

    const result = await runComfyuiMattingBatch(
      {
        sourceImagePaths: [printPath],
        workflowId: 'matting-v1',
        width: 1400,
        height: 1400,
        taskId: 'matting-folder-task',
      },
      {
        readConfig: async () => ({ workbench_root: workbenchRoot }),
        getSecret: async () => 'cy-key',
        openDatabase: fakeDb.openDatabase,
        createComfyuiAdapter: () => ({ generate }),
      },
    )

    const sourceArtifactId = String(fakeDb.artifacts[0]?.[0])
    expect(fakeDb.artifacts[0]?.[3]).toBe('manual-import')
    expect(fakeDb.artifacts[0]?.[6]).toBe(printPath)
    expect(result).toMatchObject({ taskId: 'matting-folder-task', total: 1, succeeded: 1 })
    expect(generate).toHaveBeenCalledWith(
      expect.objectContaining({
        output: expect.objectContaining({ size_px: { width: 1400, height: 1400 } }),
        options: expect.objectContaining({
          sourceArtifactIds: [sourceArtifactId],
          width: 1400,
          height: 1400,
        }),
      }),
    )
  })

  it('runs mixed matting through Grsai mask generation and ComfyUI compositing', async () => {
    const printPath = join(tempRoot, 'external-mixed', 'print.png')
    await createImage(printPath, 'print-image')
    const fakeDb = createFakeDb()
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
        recommendedModel: 'gpt-image-2',
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
        sourceImagePaths: [printPath],
        workflowId: 'matting-mixed-v1',
        workflowVersion: '1.0.0',
        width: 1500,
        height: 1300,
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

    const sourceArtifactId = String(fakeDb.artifacts[0]?.[0])
    expect(result).toMatchObject({ taskId: 'mixed-task', total: 1, succeeded: 1, failed: 0 })
    expect(fakeDb.artifacts[0]?.[3]).toBe('manual-import')
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
          sourceArtifactIds: [sourceArtifactId],
          width: 1500,
          height: 1300,
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
