import { mkdir, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { type Skill, type SkillSummary, listVisionModels } from '@tengyu-aipod/shared'
import ExcelJS from 'exceljs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SqliteDatabase } from './sqlite'
import { TempFileManager } from './temp-file-manager'
import {
  type TitleBatchConfig,
  TitleService,
  getNthImageFromSkuFolder,
  parseTitle,
  readExistingTitles,
  scanSkuFolders,
  toXlsxWriteError,
  writeTitlesXlsx,
} from './title-service'

type TestDatabase = Pick<SqliteDatabase, 'exec' | 'prepare' | 'close'>

let workbenchRoot = ''
let tempRoot = ''

const electronAppGetPath = vi.hoisted(() => vi.fn())

function createTempFileManager() {
  return new TempFileManager({ rootDir: join(workbenchRoot, '.workbench', 'tmp') })
}

vi.mock('electron', () => ({
  app: {
    getPath: electronAppGetPath,
  },
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

function summary(overrides: Partial<SkillSummary> = {}): SkillSummary {
  return {
    id: 'title-temu-en',
    module: 'title',
    category: null,
    platform: 'temu_pop',
    language: 'en',
    version: '3.0.1',
    enabled: true,
    recommendedModel: 'qwen3-vl-plus',
    notes: null,
    ...overrides,
  }
}

function skill(overrides: Partial<Skill> = {}): Skill {
  return {
    ...summary(),
    systemPrompt: 'Write a marketplace title. Output only the title.',
    variables: [],
    ...overrides,
  }
}

async function createWorkbook(path: string, rows: Array<[string, string]>) {
  const workbook = new ExcelJS.Workbook()
  const sheet = workbook.addWorksheet('Titles')
  sheet.addRow(['货号', '标题'])
  for (const row of rows) {
    sheet.addRow(row)
  }
  await workbook.xlsx.writeFile(path)
}

async function createSku(batchDir: string, skuCode: string, files: string[]) {
  const skuDir = join(batchDir, skuCode)
  await mkdir(skuDir, { recursive: true })
  for (const file of files) {
    await writeFile(join(skuDir, file), 'image')
  }
  return skuDir
}

beforeEach(async () => {
  const { mkdtemp } = await import('node:fs/promises')
  tempRoot = await mkdtemp(join(tmpdir(), 'tengyu-title-service-'))
  workbenchRoot = join(tempRoot, 'workbench')
  electronAppGetPath.mockImplementation(() => tempRoot)
  await mkdir(workbenchRoot, { recursive: true })
  await writeFile(
    join(tempRoot, 'app-config.json'),
    JSON.stringify({ workbench_root: workbenchRoot }),
    'utf8',
  )
})

afterEach(async () => {
  await rm(tempRoot, { recursive: true, force: true })
})

describe('title service utilities', () => {
  it('scans sku folders with natural ordering', async () => {
    const batchDir = join(tempRoot, 'batch')
    await mkdir(join(batchDir, 'SKU10'), { recursive: true })
    await mkdir(join(batchDir, 'SKU2'), { recursive: true })
    await mkdir(join(batchDir, 'SKU1'), { recursive: true })
    await writeFile(join(batchDir, 'titles.xlsx'), 'not a folder')

    await expect(scanSkuFolders(batchDir)).resolves.toMatchObject([
      { skuCode: 'SKU1' },
      { skuCode: 'SKU2' },
      { skuCode: 'SKU10' },
    ])
  })

  it('selects the nth naturally sorted image and falls back to the last image', async () => {
    const skuDir = await createSku(join(tempRoot, 'batch'), 'SKU1', [
      '2.png',
      '10.jpg',
      '1.webp',
      'note.txt',
    ])

    await expect(getNthImageFromSkuFolder(skuDir, 2)).resolves.toMatchObject({
      imagePath: join(skuDir, '2.png'),
    })
    await expect(getNthImageFromSkuFolder(skuDir, 99)).resolves.toMatchObject({
      imagePath: join(skuDir, '10.jpg'),
      warning: expect.stringContaining('只有 3 张图'),
    })
    await expect(getNthImageFromSkuFolder(skuDir, 0)).resolves.toMatchObject({
      imagePath: join(skuDir, '1.webp'),
    })
  })

  it('parses common LLM title wrappers and truncates platform length', () => {
    expect(parseTitle('"Title: Vintage Floral Cotton T-Shirt"', 'en', 'temu_pop')).toBe(
      'Vintage Floral Cotton T-Shirt',
    )
    expect(parseTitle('标题：复古花卉短袖 T 恤', 'zh', 'temu_pop')).toBe('复古花卉短袖 T 恤')
    expect(parseTitle(`${'A'.repeat(80)} extra`, 'en', 'mercado')).toHaveLength(60)
  })

  it('reads and writes titles xlsx with generated titles overriding existing ones', async () => {
    const xlsxPath = join(tempRoot, 'titles.xlsx')
    await createWorkbook(xlsxPath, [
      ['SKU1', 'Old title'],
      ['SKU2', 'Keep title'],
    ])
    const existing = await readExistingTitles(xlsxPath)

    await writeTitlesXlsx(xlsxPath, new Map([['SKU1', 'New title']]), existing)

    await expect(readExistingTitles(xlsxPath)).resolves.toEqual(
      new Map([
        ['SKU1', 'New title'],
        ['SKU2', 'Keep title'],
      ]),
    )
  })

  it('maps locked xlsx write failures to XLSX_LOCKED', () => {
    const error = Object.assign(new Error('EPERM: locked'), { code: 'EPERM' })

    expect(toXlsxWriteError(error)).toMatchObject({
      code: 'XLSX_LOCKED',
      retryable: false,
    })
  })
})

describe('TitleService', () => {
  it('uses the shared vision model list', () => {
    const service = new TitleService()

    expect(service.listModels()).toEqual(listVisionModels())
  })

  it('runs a title batch with skip mode, retries empty responses, writes xlsx and registers skus', async () => {
    const batchDir = join(tempRoot, 'batch')
    await createSku(batchDir, 'SKU1', ['1.png'])
    await createSku(batchDir, 'SKU2', ['1.png'])
    await createWorkbook(join(batchDir, 'titles.xlsx'), [['SKU2', 'Existing title']])
    const progress: unknown[] = []
    const visionCompletion = vi
      .fn()
      .mockResolvedValueOnce({ text: '' })
      .mockResolvedValueOnce({ text: 'Title: Generated SKU1' })
    const preprocess = vi.fn(async (options: { taskId: string }) => {
      const outputPath = join(workbenchRoot, '.workbench', 'tmp', 'title', options.taskId, 'p.jpg')
      await mkdir(dirname(outputPath), { recursive: true })
      await writeFile(outputPath, 'processed')
      return {
        outputPath,
        mimeType: 'image/jpeg',
        sizeBytes: 9,
        dataUrl: 'data:image/jpeg;base64,cHJvY2Vzc2Vk',
      }
    })
    const registeredRows: unknown[][] = []
    const fakeDb = {
      exec: vi.fn(),
      prepare: vi.fn(() => ({
        run: (...values: unknown[]) => registeredRows.push(values),
      })),
      close: vi.fn(),
    }
    const service = new TitleService()
    const config = {
      batchDir,
      platform: 'temu_pop',
      language: 'en',
      model: 'qwen3-vl-plus',
      imageIndex: 1,
      existingStrategy: 'skip',
      maxRetries: 1,
      concurrency: 1,
      taskId: 'task-title',
    } satisfies TitleBatchConfig

    const result = await service.runTitleBatch(config, {
      skillCache: {
        listSkills: vi.fn().mockResolvedValue([summary()]),
        getSkill: vi.fn().mockResolvedValue(skill()),
      },
      createBailianAdapter: () => ({ visionCompletion }),
      preprocessPool: { process: preprocess, close: vi.fn() },
      readConfig: async () => ({ workbench_root: workbenchRoot }),
      getSecret: async () => 'sk-test',
      openDatabase: () => fakeDb as unknown as TestDatabase,
      tempFileManager: createTempFileManager(),
      emitProgress: (item) => progress.push(item),
    })

    expect(result).toMatchObject({
      succeeded: 1,
      failed: 0,
      skipped: 1,
    })
    expect(visionCompletion).toHaveBeenCalledTimes(2)
    expect(preprocess).toHaveBeenCalledTimes(2)
    await expect(readExistingTitles(join(batchDir, 'titles.xlsx'))).resolves.toEqual(
      new Map([
        ['SKU1', 'Generated SKU1'],
        ['SKU2', 'Existing title'],
      ]),
    )
    expect(registeredRows).toHaveLength(1)
    expect(registeredRows[0]).toEqual(
      expect.arrayContaining(['SKU1', 'batch', 'Generated SKU1', 'en', 'temu_pop']),
    )
    expect(progress).toContainEqual(
      expect.objectContaining({ task_id: 'task-title', processed: 2, succeeded: 1, skipped: 1 }),
    )
    await expect(
      stat(join(workbenchRoot, '.workbench', 'tmp', 'title', 'task-title')),
    ).rejects.toThrow()
  })

  it('does not require skill or API key when every sku is skipped', async () => {
    const batchDir = join(tempRoot, 'skip-batch')
    await createSku(batchDir, 'SKU1', ['1.png'])
    await createWorkbook(join(batchDir, 'titles.xlsx'), [['SKU1', 'Existing title']])
    const service = new TitleService()

    const result = await service.runTitleBatch(
      {
        batchDir,
        platform: 'temu_pop',
        language: 'en',
        model: 'qwen3-vl-plus',
        existingStrategy: 'skip',
        taskId: 'skip-all',
      },
      {
        skillCache: {
          listSkills: vi.fn().mockRejectedValue(new Error('should not fetch')),
          getSkill: vi.fn().mockRejectedValue(new Error('should not fetch')),
        },
        preprocessPool: { process: vi.fn(), close: vi.fn() },
        readConfig: async () => ({ workbench_root: workbenchRoot }),
        getSecret: async () => null,
        tempFileManager: createTempFileManager(),
      },
    )

    expect(result).toMatchObject({ succeeded: 0, failed: 0, skipped: 1 })
  })
})
