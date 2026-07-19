import { mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { AppErrorClass, type Skill } from '@tengyu-aipod/shared'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { type ChenyuInstanceInfo, ChenyuInstanceStatus } from './chenyu-cloud-client'
import {
  type GenerationDebugLogEntry,
  type GenerationImageCompletePayload,
  comfyuiInstanceLocks,
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
  runComfyuiExtractMattingBatch,
  runComfyuiImg2img,
  runComfyuiImg2imgBatch,
  runComfyuiMattingBatch,
  runComfyuiTxt2imgBatch,
  runExtractBatch,
  runMixedMattingBatch,
  runTxt2imgBatch,
  scanGenerationImageFolder,
} from './generation-service'
import { emitImageComplete } from './generation/runtime'
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

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((innerResolve, innerReject) => {
    resolve = innerResolve
    reject = innerReject
  })
  return { promise, resolve, reject }
}

async function flushAsyncWork() {
  await new Promise((resolve) => setTimeout(resolve, 0))
}

async function readJsonl(path: string) {
  const text = await readFile(path, 'utf8')
  return text
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Record<string, unknown>)
}

async function waitForCondition(condition: () => boolean, maxAttempts = 50) {
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    if (condition()) {
      return
    }
    await flushAsyncWork()
  }
  throw new Error('Condition not met in time')
}

function runningChenyuInstance(instanceUuid: string, comfyuiUrl: string): ChenyuInstanceInfo {
  return {
    instance_uuid: instanceUuid,
    status: ChenyuInstanceStatus.Running,
    server_map: [{ title: 'ComfyUI', url: comfyuiUrl }],
  }
}

function runningChenyuInstanceWithoutComfyuiUrl(instanceUuid: string): ChenyuInstanceInfo {
  return {
    instance_uuid: instanceUuid,
    status: ChenyuInstanceStatus.Running,
    server_map: [],
    server_url: [],
  }
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
      skillVersion: '2.1.0',
      requirement: 'christmas teddy bear print',
      count: 1000,
      model: 'qwen3.6-flash',
    })

    expect(result).toHaveLength(1000)
    expect(generatePrompts).toHaveBeenCalledWith(
      expect.objectContaining({
        skillId: 'txt2img-local-print',
        skillVersion: '2.1.0',
        count: 1000,
        variables: expect.objectContaining({ count: 1000 }),
        userMessage: expect.stringContaining('1000'),
      }),
    )
  })

  it('writes raw LLM prompt responses to the unified diagnostics jsonl without trimming', async () => {
    const formattedRawText = '  {\n  "prompts": ["Prompt B"]\n}\n'
    vi.spyOn(promptGeneratorService, 'generatePrompts').mockImplementation(async (input) => {
      await input.diagnostics?.append({
        type: 'response',
        provider: 'aliyun-bailian',
        operation: 'prompt_generation',
        data: {
          chunkIndex: 1,
          chunkTotal: 2,
          expected: 1,
          raw: { text: '' },
        },
      })
      await input.onRawResponse?.({
        text: '',
        model: 'qwen3.6-flash',
        finishReason: null,
        expected: 1,
        chunkIndex: 1,
        chunkTotal: 2,
      })
      await input.diagnostics?.append({
        type: 'response',
        provider: 'aliyun-bailian',
        operation: 'prompt_generation',
        data: {
          chunkIndex: 2,
          chunkTotal: 2,
          expected: 1,
          raw: { text: formattedRawText },
        },
      })
      await input.onRawResponse?.({
        text: formattedRawText,
        model: 'qwen3.6-flash',
        finishReason: 'stop',
        expected: 1,
        chunkIndex: 2,
        chunkTotal: 2,
      })
      return ['', 'Prompt B']
    })

    const result = await generateTxt2imgPrompts({
      capability: 'txt2img',
      skillId: 'txt2img-local-print',
      skillVersion: '2.1.0',
      requirement: 'debug empty prompt',
      count: 2,
      model: 'qwen3.6-flash',
    })

    expect(result.map((draft) => draft.text)).toEqual(['', 'Prompt B'])

    const logDir = join(workbenchRoot, '.workbench', 'logs', 'diagnostics', 'generation')
    const files = await readdir(logDir)
    expect(files).toHaveLength(1)
    const lines = (await readFile(join(logDir, files[0] ?? ''), 'utf8'))
      .trimEnd()
      .split('\n')
      .map((line) => JSON.parse(line) as Record<string, unknown>)

    expect(lines[0]).toMatchObject({
      type: 'task_started',
      data: {
        operation: 'prompt_generation',
        count: 2,
        model: 'qwen3.6-flash',
        skillId: 'txt2img-local-print',
      },
    })
    expect(lines[1]).toMatchObject({
      type: 'response',
      data: {
        chunkIndex: 1,
        chunkTotal: 2,
        expected: 1,
        raw: { text: '' },
      },
    })
    expect(lines[2]).toMatchObject({
      type: 'response',
      data: {
        chunkIndex: 2,
        chunkTotal: 2,
        expected: 1,
        raw: { text: formattedRawText },
      },
    })
  })

  it('keeps prompt generation working when no workbench root is available for raw logs', async () => {
    workbenchRoot = ''
    vi.spyOn(promptGeneratorService, 'generatePrompts').mockImplementation(async (input) => {
      await input.onRawResponse?.({
        text: '',
        model: 'qwen3.6-flash',
        finishReason: null,
        expected: 1,
        chunkIndex: 1,
        chunkTotal: 1,
      })
      return ['Prompt A']
    })

    await expect(
      generateTxt2imgPrompts({
        capability: 'txt2img',
        requirement: 'debug without workbench',
        count: 1,
      }),
    ).resolves.toEqual([expect.objectContaining({ text: 'Prompt A' })])
  })

  it('falls back to the current combination category when no skill id is selected', async () => {
    const generatePrompts = vi
      .spyOn(promptGeneratorService, 'generatePrompts')
      .mockResolvedValue(['Prompt 1'])

    await generateTxt2imgPrompts({
      capability: 'img2img',
      printMode: 'full',
      requirement: 'floral repeat pattern',
      count: 1,
      model: 'qwen3.6-flash',
    })

    expect(generatePrompts).toHaveBeenCalledWith(
      expect.objectContaining({
        category: 'img2img-full-reference',
        count: 1,
      }),
    )
  })
})

describe('generation Grsai paid image service', () => {
  it('rethrows onImageComplete failures when strict image completion is enabled', async () => {
    const payload: GenerationImageCompletePayload = {
      taskId: 'strict-callback-task',
      capability: 'txt2img',
      path: join(workbenchRoot, 'strict.png'),
      printId: 'pri-strict',
      artifactId: 'art-strict',
      sourceArtifactIds: [],
    }
    const callbackError = new Error('pipeline item persistence failed')

    await expect(
      emitImageComplete(
        {
          strictImageComplete: true,
          onImageComplete: async () => {
            throw callbackError
          },
        },
        payload,
      ),
    ).rejects.toThrow('pipeline item persistence failed')
  })

  it('stops queued generation after a strict completion callback cannot persist an item', async () => {
    const generate = vi.fn().mockResolvedValue({
      status: 'succeeded',
      images: [{ url: 'https://example.test/strict-callback.png' }],
    })
    const result = await runTxt2imgBatch(
      {
        prompts: ['first callback fails', 'must not be submitted'],
        model: 'gpt-image-2',
        aspectRatio: '1024x1024',
        concurrency: 1,
        taskId: 'txt-strict-callback-fatal',
      },
      {
        readConfig: async () => ({ workbench_root: workbenchRoot }),
        getSecret: async () => 'sk-grsai',
        openDatabase: createFakeDb().openDatabase,
        createGrsaiAdapter: () => ({ generate }),
        downloadImage: vi.fn().mockResolvedValue(Buffer.from('strict-callback-image')),
        strictImageComplete: true,
        onImageComplete: async () => {
          throw new Error('pipeline item persistence failed')
        },
      },
    )

    expect(result.total).toBe(2)
    expect(result.failed).toBe(1)
    expect(result.failures).toEqual([
      expect.objectContaining({
        error: 'pipeline item persistence failed',
        fatal: true,
        appErrorCode: 'HTTP_5XX',
        retryable: true,
        errorDetails: expect.objectContaining({ kind: 'generation_callback_fatal' }),
      }),
    ])
    expect(generate).toHaveBeenCalledOnce()
  })

  it('calls onImageComplete in completion order before the Grsai batch resolves', async () => {
    const fakeDb = createFakeDb()
    const first = createDeferred<{
      status: 'succeeded'
      images: Array<{ url: string }>
    }>()
    const second = createDeferred<{
      status: 'succeeded'
      images: Array<{ url: string }>
    }>()
    const generate = vi.fn().mockImplementation(async (input: { prompt: string }) => {
      return input.prompt === 'first prompt' ? first.promise : second.promise
    })
    const completions: GenerationImageCompletePayload[] = []
    let resolved = false

    const runPromise = runTxt2imgBatch(
      {
        prompts: ['first prompt', 'second prompt'],
        model: 'gpt-image-2',
        aspectRatio: '1024x1024',
        concurrency: 2,
        taskId: 'txt-callback-order-task',
      },
      {
        readConfig: async () => ({ workbench_root: workbenchRoot }),
        getSecret: async () => 'sk-grsai',
        openDatabase: fakeDb.openDatabase,
        createGrsaiAdapter: () => ({ generate }),
        downloadImage: vi.fn().mockResolvedValue(Buffer.from('txt-result-image')),
        onImageComplete: async (payload) => {
          expect(resolved).toBe(false)
          completions.push(payload)
        },
      },
    )
    const trackedRunPromise = runPromise.then((value) => {
      resolved = true
      return value
    })

    await waitForCondition(() => generate.mock.calls.length === 2)
    second.resolve({
      status: 'succeeded',
      images: [{ url: 'https://example.test/second.png' }],
    })
    await waitForCondition(() => completions.length === 1)

    expect(completions).toHaveLength(1)
    expect(completions[0]).toMatchObject({
      taskId: 'txt-callback-order-task',
      capability: 'txt2img',
      sourceArtifactIds: [],
    })

    first.resolve({
      status: 'succeeded',
      images: [{ url: 'https://example.test/first.png' }],
    })

    const result = await trackedRunPromise

    expect(completions).toHaveLength(2)
    expect(completions.map((item) => item.path)).toEqual(
      result.images.map((image) => image.localPath ?? ''),
    )
    expect(completions.map((item) => item.printId)).toEqual(
      result.images.map((image) => image.printId ?? ''),
    )
    expect(completions.every((item) => item.printId.startsWith('pri_'))).toBe(true)
  })

  it('saves txt2img outputs under the task folder and stores artifacts', async () => {
    const fakeDb = createFakeDb()
    const generate = vi.fn().mockResolvedValue({
      status: 'succeeded',
      images: [{ url: 'https://example.test/txt-result.png' }],
    })
    const downloadImage = vi.fn().mockResolvedValue(Buffer.from('txt-result-image'))
    const debugLogs: GenerationDebugLogEntry[] = []
    const progress: unknown[] = []
    const completions: Array<Record<string, unknown>> = []

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
        emitProgress: (item) => progress.push(item),
        onImageComplete: async (payload) => {
          completions.push(payload)
        },
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
    expect(progress).toContainEqual(
      expect.objectContaining({
        task_id: 'txt-task',
        capability: 'txt2img',
        processed: 1,
        images: [expect.objectContaining({ localPath: result.images[0]?.localPath })],
      }),
    )
    expect(completions).toEqual([
      expect.objectContaining({
        taskId: 'txt-task',
        capability: 'txt2img',
        path: result.images[0]?.localPath,
        printId: result.images[0]?.printId,
        artifactId: result.images[0]?.artifactId,
        sourceArtifactIds: [],
      }),
    ])
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
    const progress: unknown[] = []
    const completions: Array<Record<string, unknown>> = []

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
        emitProgress: (item) => progress.push(item),
        onImageComplete: async (payload) => {
          completions.push(payload)
        },
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
    expect(progress).toContainEqual(
      expect.objectContaining({
        task_id: 'img-task',
        capability: 'img2img',
        processed: 1,
        images: [expect.objectContaining({ localPath: result.images[0]?.localPath })],
      }),
    )
    expect(completions).toEqual([
      expect.objectContaining({
        taskId: 'img-task',
        capability: 'img2img',
        path: result.images[0]?.localPath,
        printId: result.images[0]?.printId,
        artifactId: result.images[0]?.artifactId,
        sourceArtifactIds: [],
      }),
    ])
  })

  it('uses user visible filenames without changing generated print ids', async () => {
    const fakeDb = createFakeDb()
    const generate = vi
      .fn()
      .mockResolvedValueOnce({
        status: 'succeeded',
        images: [{ url: 'https://example.test/first.png' }],
      })
      .mockResolvedValueOnce({
        status: 'succeeded',
        images: [{ url: 'https://example.test/second.png' }],
      })
    const input = {
      prompts: ['first print', 'second print'],
      model: 'gpt-image-2',
      aspectRatio: '1024x1024',
      concurrency: 1,
      taskId: 'named-task',
      filenamePrefix: 'gyx<k:j',
      filenameSeparator: '-',
    }

    const result = await runTxt2imgBatch(input, {
      readConfig: async () => ({ workbench_root: workbenchRoot }),
      getSecret: async () => 'sk-grsai',
      openDatabase: fakeDb.openDatabase,
      createGrsaiAdapter: () => ({ generate }),
      downloadImage: vi.fn().mockResolvedValue(Buffer.from('named-image')),
    })

    expect(result.images.map((image) => image.localPath?.split(/[\\/]/).pop())).toEqual([
      'gyx_k_j-0001.png',
      'gyx_k_j-0002.png',
    ])
    expect(result.images.map((image) => image.printId)).toEqual([
      expect.stringMatching(/^pri_/),
      expect.stringMatching(/^pri_/),
    ])
    expect(result.images[0]?.printId).not.toBe('gyx_k_j-0001')
    expect(fakeDb.artifacts.map((row) => row[2])).toEqual([
      expect.stringMatching(/^pri_/),
      expect.stringMatching(/^pri_/),
    ])
  })

  it('keeps retryable Grsai job failures item-scoped', async () => {
    const generate = vi
      .fn()
      .mockRejectedValueOnce(
        new AppErrorClass('GRSAI_FAILED', 'Grsai generation job failed', true, {
          kind: 'failed',
          provider: 'grsai',
        }),
      )
      .mockResolvedValueOnce({
        status: 'succeeded',
        images: [{ url: 'https://example.test/second-item.png' }],
      })
    const result = await runTxt2imgBatch(
      {
        prompts: ['item-scoped failure', 'second item succeeds'],
        model: 'gpt-image-2',
        aspectRatio: '1024x1024',
        concurrency: 1,
        taskId: 'txt-grsai-item-failure',
      },
      {
        readConfig: async () => ({ workbench_root: workbenchRoot }),
        getSecret: async () => 'sk-grsai',
        openDatabase: createFakeDb().openDatabase,
        createGrsaiAdapter: () => ({ generate }),
        downloadImage: vi.fn().mockResolvedValue(Buffer.from('second-item-image')),
      },
    )

    expect(result.failures).toEqual([
      expect.objectContaining({
        error: 'Grsai generation job failed',
        appErrorCode: 'GRSAI_FAILED',
        retryable: true,
      }),
    ])
    expect(result.failures[0]).not.toHaveProperty('fatal', true)
    expect(result).toMatchObject({ total: 2, succeeded: 1, failed: 1 })
    expect(result.images).toHaveLength(1)
    expect(generate).toHaveBeenCalledTimes(2)
  })

  it('marks exhausted provider rate limits as fatal while preserving retryability', async () => {
    const generate = vi.fn().mockRejectedValue(
      new AppErrorClass('HTTP_429', 'Grsai rate limit exhausted', true, {
        kind: 'network',
        provider: 'grsai',
        status: 429,
      }),
    )
    const result = await runTxt2imgBatch(
      {
        prompts: ['provider-scoped failure', 'must not be submitted'],
        model: 'gpt-image-2',
        aspectRatio: '1024x1024',
        concurrency: 1,
        taskId: 'txt-grsai-provider-failure',
      },
      {
        readConfig: async () => ({ workbench_root: workbenchRoot }),
        getSecret: async () => 'sk-grsai',
        openDatabase: createFakeDb().openDatabase,
        createGrsaiAdapter: () => ({ generate }),
      },
    )

    expect(result.failures).toEqual([
      expect.objectContaining({
        error: 'Grsai rate limit exhausted',
        fatal: true,
        appErrorCode: 'HTTP_429',
        retryable: true,
        errorDetails: expect.objectContaining({
          kind: 'network',
          provider: 'grsai',
          status: 429,
        }),
      }),
    ])
    expect(result).toMatchObject({ total: 2, succeeded: 0, failed: 1 })
    expect(generate).toHaveBeenCalledOnce()
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
    const generatePrompts = vi.fn()
    const generate = vi.fn().mockResolvedValue({
      status: 'succeeded',
      images: [{ url: 'https://example.test/result.png' }],
    })
    const downloadImage = vi.fn().mockResolvedValue(Buffer.from('result-image'))
    const completions: Array<Record<string, unknown>> = []

    const result = await runExtractBatch(
      {
        sourceImagePaths: [sourcePath],
        skillId: 'extract-prompt-v3',
        variables: {
          printAreaPreference: 'auto',
          allowMultiplePrints: true,
        },
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
        onImageComplete: async (payload) => {
          completions.push(payload)
        },
      },
    )

    expect(result).toMatchObject({ taskId: 'extract-task', total: 1, succeeded: 1, failed: 0 })
    expect(result.images[0]?.localPath).toContain(join('02-印花工作区', '提取', 'extract-task'))
    await expect(stat(result.images[0]?.localPath ?? '')).resolves.toBeTruthy()
    expect(generatePrompts).not.toHaveBeenCalled()
    expect(generate).toHaveBeenCalledWith(
      expect.objectContaining({
        capability: 'extract',
        prompt: 'Extract print prompts.',
        reference_images: [expect.objectContaining({ mime_type: 'image/png' })],
      }),
    )
    expect(downloadImage).toHaveBeenCalledWith('https://example.test/result.png')
    expect(fakeDb.artifacts).toHaveLength(2)
    expect(fakeDb.artifacts[1]?.[3]).toBe('extract')
    expect(fakeDb.artifacts[1]?.[4]).toBe('grsai')
    expect(fakeDb.artifacts[1]?.[12]).toBe('Extract print prompts.')
    expect(progress).toContainEqual(
      expect.objectContaining({ task_id: 'extract-task', capability: 'extract', processed: 1 }),
    )
    expect(completions).toEqual([
      expect.objectContaining({
        taskId: 'extract-task',
        capability: 'extract',
        path: result.images[0]?.localPath,
        printId: result.images[0]?.printId,
        artifactId: result.images[0]?.artifactId,
        sourceArtifactIds: [String(fakeDb.artifacts[0]?.[0])],
      }),
    ])
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
    const completions: Array<Record<string, unknown>> = []
    const generate = vi.fn().mockResolvedValue({
      status: 'succeeded',
      images: [
        {
          url: 'file:///result.png',
          local_path: '/result.png',
          artifact_id: 'art-comfy-txt',
          print_id: 'pri_comfy_txt',
        },
      ],
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
        onImageComplete: async (payload) => {
          completions.push(payload)
        },
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
    expect(completions).toEqual([
      expect.objectContaining({
        taskId: 'txt2img-comfy-task',
        capability: 'txt2img',
        path: '/result.png',
        printId: 'pri_comfy_txt',
        artifactId: 'art-comfy-txt',
        sourceArtifactIds: [],
      }),
    ])
  })

  it('marks a stopped ComfyUI instance as a fatal provider failure', async () => {
    const generate = vi.fn().mockRejectedValue(
      new AppErrorClass('CHENYU_INSTANCE_DOWN', 'default instance stopped', false, {
        provider: 'comfyui-chenyu',
        status: 'stopped',
      }),
    )
    const result = await runComfyuiTxt2imgBatch(
      {
        prompts: ['should not be retried for every prompt', 'must not be submitted'],
        workflowId: 'txt2img-v1',
        taskId: 'txt2img-comfy-instance-down',
        concurrency: 1,
      },
      {
        readConfig: async () => ({ workbench_root: workbenchRoot }),
        getSecret: async () => 'cy-key',
        openDatabase: createFakeDb().openDatabase,
        createComfyuiAdapter: () => ({ generate }),
      },
    )

    expect(result.failures).toEqual([
      expect.objectContaining({
        error: 'default instance stopped',
        fatal: true,
        appErrorCode: 'CHENYU_INSTANCE_DOWN',
        retryable: false,
        errorDetails: expect.objectContaining({
          provider: 'comfyui-chenyu',
          status: 'stopped',
        }),
      }),
    ])
    expect(result).toMatchObject({ total: 2, succeeded: 0, failed: 1 })
    expect(generate).toHaveBeenCalledOnce()
  })

  it('advances ComfyUI txt2img visible filename indexes by actual output count', async () => {
    const fakeDb = createFakeDb()
    const generate = vi
      .fn()
      .mockResolvedValueOnce({
        status: 'succeeded',
        images: [
          { url: 'file:///first-1.png', local_path: '/first-1.png' },
          { url: 'file:///first-2.png', local_path: '/first-2.png' },
        ],
      })
      .mockResolvedValueOnce({
        status: 'succeeded',
        images: [{ url: 'file:///second-1.png', local_path: '/second-1.png' }],
      })

    const result = await runComfyuiTxt2imgBatch(
      {
        prompts: ['first prompt', 'second prompt'],
        workflowId: 'txt2img-v1',
        taskId: 'txt2img-comfy-visible-index',
        concurrency: 2,
        filenamePrefix: 'gyx',
        filenameSeparator: '-',
      },
      {
        readConfig: async () => ({ workbench_root: workbenchRoot }),
        getSecret: async () => 'cy-key',
        openDatabase: fakeDb.openDatabase,
        createComfyuiAdapter: () => ({ generate }),
      },
    )

    expect(result).toMatchObject({
      taskId: 'txt2img-comfy-visible-index',
      succeeded: 3,
      failed: 0,
    })
    expect(generate).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        options: expect.objectContaining({ filenameIndex: 0 }),
      }),
    )
    expect(generate).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        options: expect.objectContaining({ filenameIndex: 2 }),
      }),
    )
  })

  it('passes the selected running instance to the ComfyUI adapter without reading the default instance', async () => {
    const fakeDb = createDbWithoutComfyuiInstance()
    const adapterInputs: unknown[] = []
    const getChenyuInstanceInfo = vi
      .fn()
      .mockResolvedValue(runningChenyuInstance('inst-selected', 'https://selected-comfy.example'))
    const generate = vi.fn().mockResolvedValue({
      status: 'succeeded',
      images: [{ url: 'file:///selected-instance-result.png', local_path: '/result.png' }],
    })

    const result = await runComfyuiTxt2imgBatch(
      {
        prompts: ['selected cloud instance print'],
        workflowId: 'txt2img-v1',
        taskId: 'txt2img-selected-instance',
        instanceUuid: 'inst-selected',
      },
      {
        readConfig: async () => ({ workbench_root: workbenchRoot }),
        getSecret: async () => 'cy-key',
        openDatabase: fakeDb.openDatabase,
        getChenyuInstanceInfo,
        createComfyuiAdapter: (adapterInput) => {
          adapterInputs.push(adapterInput)
          return { generate }
        },
      },
    )

    expect(result).toMatchObject({ taskId: 'txt2img-selected-instance', succeeded: 1, failed: 0 })
    expect(getChenyuInstanceInfo).toHaveBeenCalledWith({
      apiKey: 'cy-key',
      instanceUuid: 'inst-selected',
    })
    expect(adapterInputs[0]).toEqual(
      expect.objectContaining({
        apiKey: 'cy-key',
        workbenchRoot,
        instance: expect.objectContaining({
          instanceUuid: 'inst-selected',
          comfyuiUrl: 'https://selected-comfy.example',
          status: 'running',
        }),
      }),
    )
  })

  it('uses the saved default ComfyUI URL when the selected current instance has no remote URL', async () => {
    const fakeDb = createFakeDb()
    const adapterInputs: unknown[] = []
    const getChenyuInstanceInfo = vi
      .fn()
      .mockResolvedValue(runningChenyuInstanceWithoutComfyuiUrl('inst-current'))
    const generate = vi.fn().mockResolvedValue({
      status: 'succeeded',
      images: [{ url: 'file:///saved-current-result.png', local_path: '/result.png' }],
    })

    const result = await runComfyuiTxt2imgBatch(
      {
        prompts: ['saved current cloud instance print'],
        workflowId: 'txt2img-v1',
        taskId: 'txt2img-saved-current-instance',
        instanceUuid: 'inst-current',
      },
      {
        readConfig: async () => ({ workbench_root: workbenchRoot }),
        getSecret: async () => 'cy-key',
        openDatabase: fakeDb.openDatabase,
        getChenyuInstanceInfo,
        createComfyuiAdapter: (adapterInput) => {
          adapterInputs.push(adapterInput)
          return { generate }
        },
      },
    )

    expect(result).toMatchObject({
      taskId: 'txt2img-saved-current-instance',
      succeeded: 1,
      failed: 0,
    })
    expect(adapterInputs[0]).toEqual(
      expect.objectContaining({
        instance: expect.objectContaining({
          instanceUuid: 'inst-current',
          comfyuiUrl: 'https://comfy.example',
          status: 'running',
        }),
      }),
    )
  })

  it('locks the selected ComfyUI instance while a task is running and releases it afterward', async () => {
    const running = createDeferred<string>()
    const firstRun = comfyuiInstanceLocks.run(
      { instanceUuid: 'inst-lock' },
      'task-a',
      () => running.promise,
    )

    await expect(
      comfyuiInstanceLocks.run({ instanceUuid: 'inst-lock' }, 'task-a', async () => 'second-ok'),
    ).rejects.toMatchObject({
      code: 'HTTP_4XX',
      message: '该云机正在执行其他任务，请换一台或稍后再试',
    })

    running.resolve('first-ok')
    await expect(firstRun).resolves.toBe('first-ok')
    await expect(
      comfyuiInstanceLocks.run({ instanceUuid: 'inst-lock' }, 'task-c', async () => 'third-ok'),
    ).resolves.toBe('third-ok')
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
    const debugLogs: GenerationDebugLogEntry[] = []
    const completions: Array<Record<string, unknown>> = []
    const generate = vi.fn().mockResolvedValue({
      status: 'succeeded',
      images: [
        {
          url: 'file:///result.png',
          local_path: '/result.png',
          artifact_id: 'art-extract-output',
          print_id: 'pri_extract_output',
        },
      ],
    })

    const result = await runComfyuiExtractBatch(
      {
        sourceImagePaths: [sourcePath],
        workflowId: 'extract-v1',
        workflowName: 'Extract Workflow',
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
        emitDebugLog: (entry) => debugLogs.push(entry),
        onImageComplete: async (payload) => {
          completions.push(payload)
        },
      },
    )

    expect(result).toMatchObject({
      taskId: 'extract-comfy-task',
      total: 1,
      succeeded: 1,
      failed: 0,
      images: [
        expect.objectContaining({
          artifactId: 'art-extract-output',
          printId: 'pri_extract_output',
        }),
      ],
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
    expect(debugLogs).toContainEqual(
      expect.objectContaining({
        level: 'debug',
        message: '发送 ComfyUI 请求',
        capability: 'extract',
        taskId: 'extract-comfy-task',
        details: expect.objectContaining({
          operation: 'request',
          provider: 'comfyui-chenyu',
          workflowId: 'extract-v1',
          workflowName: 'Extract Workflow',
          workflowVersion: '1.0.0',
          prompt: 'extract print',
          sourceImage: 'source.png',
          sourceIndex: 1,
          total: 1,
          width: 1024,
          height: 1024,
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
    expect(completions).toEqual([
      expect.objectContaining({
        taskId: 'extract-comfy-task',
        capability: 'extract',
        path: '/result.png',
        printId: 'pri_extract_output',
        artifactId: 'art-extract-output',
        sourceArtifactIds: [String(sourceArtifactId)],
      }),
    ])
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

  it('rejects missing ComfyUI img2img workflow before submitting a task', async () => {
    const getSecret = vi.fn()

    await expect(
      runComfyuiImg2img(
        {
          sourceArtifactIds: ['print-artifact'],
          workflowId: 'deleted-workflow',
          taskId: 'img2img-task',
        },
        {
          getSecret,
          workflowCache: {
            listWorkflows: vi.fn(),
            get: vi
              .fn()
              .mockRejectedValue(new Error('本地 ComfyUI Workflow 不存在，请先在设置页导入')),
          },
        },
      ),
    ).rejects.toThrow('本地 ComfyUI Workflow 不存在，请先在设置页导入')
    expect(getSecret).not.toHaveBeenCalled()
  })

  it('keeps Bailian secret lookup when async ComfyUI img2img uses AI prompt mode', async () => {
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
    vi.spyOn(promptGeneratorService, 'generatePrompts').mockImplementation(
      async (_input, dependencies) => {
        if (!dependencies) {
          throw new Error('missing prompt dependencies')
        }
        await expect(dependencies.getSecret?.('bailian')).resolves.toBe('bailian-key')
        return ['AI prompt']
      },
    )
    const generate = vi.fn().mockResolvedValue({
      status: 'succeeded',
      images: [{ url: 'file:///result.png', local_path: '/result.png' }],
    })
    const getSecret = vi.fn(async (key: string) =>
      key === 'chenyu' ? 'chenyu-key' : key === 'bailian' ? 'bailian-key' : null,
    )

    await runComfyuiImg2img(
      {
        sourceArtifactIds: ['print-artifact'],
        workflowId: 'img2img-v1',
        promptMode: 'ai',
        promptSkillId: 'img2img-local-reference',
        promptModel: 'qwen3-vl-flash',
        taskId: 'img2img-async-ai-task',
      },
      {
        readConfig: async () => ({ workbench_root: workbenchRoot }),
        getSecret,
        openDatabase: fakeDb.openDatabase,
        createComfyuiAdapter: () => ({ generate }),
        workflowCache: {
          listWorkflows: vi.fn().mockResolvedValue([
            {
              id: 'img2img-v1',
              version: '1.0.0',
              name: 'Image Variation',
              capability: 'img2img',
              requiredModels: [],
            },
          ]),
          get: vi.fn(),
        },
      },
    )

    await waitForCondition(() => generate.mock.calls.length > 0)
    expect(getSecret.mock.calls.map(([key]) => key)).toContain('chenyu')
    expect(getSecret.mock.calls.map(([key]) => key)).toContain('bailian')
    expect(generate).toHaveBeenCalledWith(expect.objectContaining({ prompt: 'AI prompt' }))
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
      images: [
        {
          url: 'file:///result.png',
          local_path: '/result.png',
          artifact_id: 'art-img2img-output',
          print_id: 'pri_img2img_output',
        },
      ],
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
        onImageComplete: vi.fn(),
      },
    )

    expect(result).toMatchObject({
      taskId: 'img2img-task',
      total: 1,
      succeeded: 1,
      failed: 0,
      images: [
        expect.objectContaining({
          artifactId: 'art-img2img-output',
          printId: 'pri_img2img_output',
        }),
      ],
    })
    const request = generate.mock.calls[0]?.[0] as { options?: Record<string, unknown> } | undefined
    expect(request?.options?.preserveWorkflowPrompt).toBeUndefined()
    expect(generate).toHaveBeenCalledWith(
      expect.objectContaining({
        capability: 'img2img',
        prompt: 'make a new floral print',
        workflow_id: 'img2img-v1',
        reference_images: [expect.objectContaining({ mime_type: 'image/png' })],
        options: expect.objectContaining({
          taskId: 'img2img-task',
          sourceArtifactIds: ['print-artifact'],
          printId: 'pri_print',
        }),
      }),
    )
    expect(generate.mock.calls.length > 0).toBe(true)
  })

  it('counts ComfyUI img2img batch outputs and missing images', async () => {
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
      images: [
        { url: 'file:///result-1.png', local_path: '/result-1.png' },
        { url: 'file:///result-2.png', local_path: '/result-2.png' },
      ],
    })

    const result = await runComfyuiImg2imgBatch(
      {
        sourceArtifactIds: ['print-artifact'],
        workflowId: 'img2img-v1',
        taskId: 'img2img-batch-task',
        batchSize: 4,
      },
      {
        readConfig: async () => ({ workbench_root: workbenchRoot }),
        getSecret: async () => 'cy-key',
        openDatabase: fakeDb.openDatabase,
        createComfyuiAdapter: () => ({ generate }),
      },
    )

    expect(result).toMatchObject({
      taskId: 'img2img-batch-task',
      total: 4,
      succeeded: 2,
      failed: 2,
    })
    expect(result.failures[0]?.error).toContain('只返回 2/4 张图片')
    expect(generate).toHaveBeenCalledWith(
      expect.objectContaining({
        options: expect.objectContaining({
          batchSize: 4,
          maxOutputs: 4,
        }),
      }),
    )
  })

  it('keeps workflow prompt mode from calling Bailian and preserving workflow prompts', async () => {
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
    const generatePrompts = vi.spyOn(promptGeneratorService, 'generatePrompts')
    const generate = vi.fn().mockResolvedValue({
      status: 'succeeded',
      images: [{ url: 'file:///result.png', local_path: '/result.png' }],
    })

    const result = await runComfyuiImg2imgBatch(
      {
        sourceArtifactIds: ['print-artifact'],
        workflowId: 'img2img-v1',
        promptMode: 'workflow',
        taskId: 'img2img-workflow-prompt-task',
      },
      {
        readConfig: async () => ({ workbench_root: workbenchRoot }),
        getSecret: async () => 'cy-key',
        openDatabase: fakeDb.openDatabase,
        createComfyuiAdapter: () => ({ generate }),
      },
    )

    expect(result).toMatchObject({ succeeded: 1, failed: 0 })
    expect(generatePrompts).not.toHaveBeenCalled()
    expect(result.images[0]?.prompt).toBe('工作流默认提示词')
    expect(generate).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: '',
        options: expect.objectContaining({
          preserveWorkflowPrompt: true,
          promptMode: 'workflow',
        }),
      }),
    )
  })

  it('uses one manual prompt for the whole ComfyUI img2img batch', async () => {
    const firstPath = join(tempRoot, 'manual-img2img', 'first.png')
    const secondPath = join(tempRoot, 'manual-img2img', 'second.png')
    await createImage(firstPath, 'first-image')
    await createImage(secondPath, 'second-image')
    const fakeDb = createFakeDb()
    const generatePrompts = vi.spyOn(promptGeneratorService, 'generatePrompts')
    const generate = vi.fn().mockResolvedValue({
      status: 'succeeded',
      images: [{ url: 'file:///result.png', local_path: '/result.png' }],
    })

    const result = await runComfyuiImg2imgBatch(
      {
        sourceImagePaths: [firstPath, secondPath],
        workflowId: 'img2img-v1',
        promptMode: 'manual',
        prompt: 'shared manual prompt',
        taskId: 'img2img-manual-prompt-task',
      },
      {
        readConfig: async () => ({ workbench_root: workbenchRoot }),
        getSecret: async () => 'cy-key',
        openDatabase: fakeDb.openDatabase,
        createComfyuiAdapter: () => ({ generate }),
      },
    )

    expect(result).toMatchObject({ total: 2, succeeded: 2, failed: 0 })
    expect(generatePrompts).not.toHaveBeenCalled()
    expect(generate).toHaveBeenCalledTimes(2)
    expect(generate.mock.calls.map((call) => call[0].prompt)).toEqual([
      'shared manual prompt',
      'shared manual prompt',
    ])
  })

  it('isolates ComfyUI img2img AI prompt failures per source image', async () => {
    const firstPath = join(tempRoot, 'ai-img2img', 'first.png')
    const secondPath = join(tempRoot, 'ai-img2img', 'second.png')
    await createImage(firstPath, 'first-image')
    await createImage(secondPath, 'second-image')
    const fakeDb = createFakeDb()
    const generatePrompts = vi
      .spyOn(promptGeneratorService, 'generatePrompts')
      .mockRejectedValueOnce(new Error('vision timeout'))
      .mockResolvedValueOnce(['second AI prompt'])
    const generate = vi.fn().mockResolvedValue({
      status: 'succeeded',
      images: [{ url: 'file:///second-result.png', local_path: '/second-result.png' }],
    })
    const debugLogs: GenerationDebugLogEntry[] = []

    const result = await runComfyuiImg2imgBatch(
      {
        sourceImagePaths: [firstPath, secondPath],
        workflowId: 'img2img-v1',
        promptMode: 'ai',
        promptSkillId: 'img2img-local-reference',
        promptSkillVersion: '1.0.0',
        promptModel: 'qwen3-vl-flash',
        printMode: 'local',
        modeInstruction: 'Use only the layout structure from the reference image.',
        requirement: 'new floral print',
        taskId: 'img2img-ai-prompt-task',
      },
      {
        readConfig: async () => ({ workbench_root: workbenchRoot }),
        getSecret: async (key) => (key === 'chenyu' ? 'cy-key' : 'bailian-key'),
        openDatabase: fakeDb.openDatabase,
        createComfyuiAdapter: () => ({ generate }),
        emitDebugLog: (entry) => debugLogs.push(entry),
      },
    )

    expect(result).toMatchObject({ total: 2, succeeded: 1, failed: 1 })
    expect(generatePrompts).toHaveBeenCalledTimes(2)
    expect(generate).toHaveBeenCalledTimes(1)
    expect(generate).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: 'second AI prompt',
        options: expect.not.objectContaining({ preserveWorkflowPrompt: true }),
      }),
    )
    expect(result.failures[0]).toMatchObject({
      error: expect.stringContaining('AI 写提示词失败'),
    })
    expect(result.failures[0]?.error).not.toContain('工作流默认')
    expect(debugLogs).toContainEqual(
      expect.objectContaining({
        message: '源图提示词生成完成',
        details: expect.objectContaining({
          prompt: 'second AI prompt',
          promptMode: 'ai',
        }),
      }),
    )
    const events = await readJsonl(result.diagnosticsLogPath ?? '')
    const text = JSON.stringify(events)
    expect(text).toContain('second AI prompt')
    expect(text).toContain('img2img-local-reference')
    expect(text).not.toContain(Buffer.from('first-image').toString('base64'))
    expect(text).not.toContain('bailian-key')
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
        prompt: '',
        output: expect.objectContaining({ size_px: { width: 1600, height: 1200 } }),
        options: expect.objectContaining({
          preserveWorkflowPrompt: true,
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
    expect(fakeDb.artifacts[0]?.[0]).not.toBe(fakeDb.artifacts[1]?.[0])
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
    const completions: Array<Record<string, unknown>> = []
    const generate = vi.fn().mockResolvedValue({
      status: 'succeeded',
      images: [
        {
          url: 'file:///matting.png',
          local_path: '/matting.png',
          artifact_id: 'art-matting-output',
          print_id: 'pri_matting_output',
        },
      ],
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
        onImageComplete: async (payload) => {
          completions.push(payload)
        },
      },
    )

    expect(result).toMatchObject({
      taskId: 'matting-task',
      total: 1,
      succeeded: 1,
      failed: 0,
      images: [
        expect.objectContaining({
          artifactId: 'art-matting-output',
          printId: 'pri_matting_output',
        }),
      ],
    })
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
    expect(completions).toEqual([
      expect.objectContaining({
        taskId: 'matting-task',
        capability: 'matting',
        path: '/matting.png',
        printId: 'pri_matting_output',
        artifactId: 'art-matting-output',
        sourceArtifactIds: ['print-artifact'],
      }),
    ])
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

  it('stops a matting batch after the first fatal provider failure', async () => {
    const firstPath = join(tempRoot, 'fatal-matting', 'first.png')
    const secondPath = join(tempRoot, 'fatal-matting', 'second.png')
    await createImage(firstPath, 'first-image')
    await createImage(secondPath, 'second-image')
    const generate = vi.fn().mockRejectedValue(
      new AppErrorClass('CHENYU_INSTANCE_DOWN', 'matting instance stopped', false, {
        provider: 'comfyui-chenyu',
        status: 'stopped',
      }),
    )

    const result = await runComfyuiMattingBatch(
      {
        sourceImagePaths: [firstPath, secondPath],
        workflowId: 'matting-v1',
        taskId: 'matting-fatal-provider-task',
      },
      {
        readConfig: async () => ({ workbench_root: workbenchRoot }),
        getSecret: async () => 'cy-key',
        openDatabase: createFakeDb().openDatabase,
        createComfyuiAdapter: () => ({ generate }),
      },
    )

    expect(result).toMatchObject({ total: 2, succeeded: 0, failed: 1 })
    expect(result.failures).toEqual([
      expect.objectContaining({
        fatal: true,
        appErrorCode: 'CHENYU_INSTANCE_DOWN',
        sourcePath: expect.any(String),
      }),
    ])
    expect(generate).toHaveBeenCalledOnce()
  })

  it('runs extract then matting on the same ComfyUI instance and cleans temporary extract outputs', async () => {
    const sourcePath = join(tempRoot, 'extract-matting-source', 'source.png')
    const extractedPath = join(tempRoot, 'extract-matting-temp-output', 'extracted.png')
    const finalPath = join(tempRoot, 'extract-matting-final', 'final.png')
    await createImage(sourcePath, 'source-image')
    await createImage(extractedPath, 'extracted-image')
    const fakeDb = createFakeDb()
    const tempDir = join(workbenchRoot, '.workbench', 'tmp', 'matting', 'extract-matting-task')
    const createTaskDir = vi.fn(async () => {
      await mkdir(tempDir, { recursive: true })
      return tempDir
    })
    const cleanupTask = vi.fn()
    const progress: unknown[] = []
    const completions: Array<Record<string, unknown>> = []
    const getChenyuInstanceInfo = vi
      .fn()
      .mockResolvedValue(
        runningChenyuInstance('inst-extract-matting', 'https://extract-matting-comfy.example'),
      )
    const generate = vi
      .fn()
      .mockResolvedValueOnce({
        status: 'succeeded',
        images: [{ url: 'file:///extracted.png', local_path: extractedPath }],
      })
      .mockResolvedValueOnce({
        status: 'succeeded',
        images: [
          {
            url: 'file:///final.png',
            local_path: finalPath,
            artifact_id: 'art-extract-matting-output',
            print_id: 'pri_extract_matting_output',
          },
        ],
      })

    const result = await runComfyuiExtractMattingBatch(
      {
        sourceImagePaths: [sourcePath],
        extractWorkflowId: 'extract-v1',
        extractWorkflowName: 'Extract Workflow',
        extractWorkflowVersion: '1.0.0',
        mattingWorkflowId: 'matting-v1',
        mattingWorkflowName: 'Matting Workflow',
        mattingWorkflowVersion: '2.0.0',
        skillId: 'extract-comfyui-workflow',
        skillVersion: '1.0.0',
        width: 1600,
        height: 1200,
        taskId: 'extract-matting-task',
        instanceUuid: 'inst-extract-matting',
      },
      {
        readConfig: async () => ({ workbench_root: workbenchRoot }),
        getSecret: async () => 'cy-key',
        openDatabase: fakeDb.openDatabase,
        getChenyuInstanceInfo,
        createComfyuiAdapter: () => ({ generate }),
        skillCache: {
          getSkill: vi.fn().mockResolvedValue(
            extractSkill({
              id: 'extract-comfyui-workflow',
              version: '1.0.0',
              systemPrompt: 'backend extract prompt',
            }),
          ),
          listSkills: vi.fn(),
        },
        tempFiles: { createTaskDir, cleanupTask },
        emitProgress: (item) => progress.push(item),
        onImageComplete: async (payload) => {
          completions.push(payload)
        },
      },
    )

    const sourceArtifactId = String(fakeDb.artifacts[0]?.[0])
    expect(result).toMatchObject({
      taskId: 'extract-matting-task',
      total: 1,
      succeeded: 1,
      failed: 0,
      images: [
        expect.objectContaining({
          localPath: finalPath,
          sourcePath,
          artifactId: 'art-extract-matting-output',
          printId: 'pri_extract_matting_output',
        }),
      ],
    })
    expect(fakeDb.artifacts).toHaveLength(1)
    expect(fakeDb.artifacts[0]?.[3]).toBe('manual-import')
    expect(generate).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        capability: 'extract',
        prompt: 'backend extract prompt',
        workflow_id: 'extract-v1',
        reference_images: [expect.objectContaining({ mime_type: 'image/png' })],
        output: expect.objectContaining({ size_px: { width: 1600, height: 1200 } }),
        options: expect.objectContaining({
          taskId: 'extract-matting-task-extract-1',
          sourceArtifactIds: [sourceArtifactId],
          outputFolderOverride: join(tempDir, 'extract-1'),
          registerArtifact: false,
          maxOutputs: 1,
          workflowVersion: '1.0.0',
        }),
      }),
    )
    expect(generate).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        capability: 'matting',
        prompt: 'Remove the background and output transparent PNG.',
        workflow_id: 'matting-v1',
        reference_images: [expect.objectContaining({ mime_type: 'image/png' })],
        output: expect.objectContaining({ size_px: { width: 1600, height: 1200 } }),
        options: expect.objectContaining({
          taskId: 'extract-matting-task',
          sourceArtifactIds: [sourceArtifactId],
          width: 1600,
          height: 1200,
          maxOutputs: 1,
          workflowVersion: '2.0.0',
        }),
      }),
    )
    expect(createTaskDir).toHaveBeenCalledWith('matting', 'extract-matting-task')
    expect(cleanupTask).toHaveBeenCalledWith('matting', 'extract-matting-task')
    expect(progress).toContainEqual(
      expect.objectContaining({ task_id: 'extract-matting-task', capability: 'matting' }),
    )
    expect(completions).toEqual([
      expect.objectContaining({
        taskId: 'extract-matting-task',
        capability: 'matting',
        path: finalPath,
        printId: 'pri_extract_matting_output',
        artifactId: 'art-extract-matting-output',
        sourceArtifactIds: [sourceArtifactId],
      }),
    ])
  })

  it('runs mixed matting through Grsai mask generation and ComfyUI compositing', async () => {
    const printPath = join(tempRoot, 'external-mixed', 'print.png')
    await createImage(printPath, 'print-image')
    const fakeDb = createFakeDb()
    const progress: unknown[] = []
    const completions: Array<Record<string, unknown>> = []
    const generateMask = vi.fn().mockResolvedValue({
      status: 'succeeded',
      images: [{ url: 'https://example.test/mask.png' }],
    })
    const generateComposite = vi.fn().mockResolvedValue({
      status: 'succeeded',
      images: [
        {
          url: 'file:///matting.png',
          local_path: '/matting.png',
          artifact_id: 'art-mixed-output',
          print_id: 'pri_mixed_output',
        },
      ],
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
        onImageComplete: async (payload) => {
          completions.push(payload)
        },
      },
    )

    const sourceArtifactId = String(fakeDb.artifacts[0]?.[0])
    expect(result).toMatchObject({
      taskId: 'mixed-task',
      total: 1,
      succeeded: 1,
      failed: 0,
      images: [
        expect.objectContaining({
          artifactId: 'art-mixed-output',
          printId: 'pri_mixed_output',
        }),
      ],
    })
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
    expect(completions).toEqual([
      expect.objectContaining({
        taskId: 'mixed-task',
        capability: 'matting',
        path: '/matting.png',
        printId: 'pri_mixed_output',
        artifactId: 'art-mixed-output',
        sourceArtifactIds: [sourceArtifactId],
      }),
    ])
  })
})
