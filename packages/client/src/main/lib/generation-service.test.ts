import { mkdir, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import type { Skill } from '@tengyu-aipod/shared'
import type Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { listExtractSources, runExtractBatch } from './generation-service'

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
      return { run: vi.fn() }
    }),
    close: vi.fn(),
  }

  return {
    artifacts,
    db,
    openDatabase: () => db as unknown as TestDatabase,
  }
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
        skillCache: { getSkill: vi.fn().mockResolvedValue(extractSkill()) },
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
