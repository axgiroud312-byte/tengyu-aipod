import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import type { Skill, SkillSummary } from '@tengyu-aipod/shared'
import ExcelJS from 'exceljs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { BAILIAN_VISION_MODELS } from './generation-local-config'
import type { SqliteDatabase } from './sqlite'
import { TempFileManager } from './temp-file-manager'
import {
  type TitleBatchConfig,
  TitleService,
  assignTitleKeywordGroups,
  getNthImageFromSkuFolder,
  joinTitleWithKeywordGroup,
  normalizeTitleFileBaseName,
  normalizeTitleKeywordGroups,
  parseTitle,
  readExistingTitles,
  resolveTitleXlsxPath,
  scanSkuFolders,
  titleXlsxPath,
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
    platform: 'temu',
    language: 'en',
    version: '3.0.1',
    enabled: true,
    recommendedModel: 'qwen3.6-flash',
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

async function readJsonl(path: string) {
  return (await readFile(path, 'utf8'))
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Record<string, unknown>)
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
    await writeFile(join(batchDir, '标题.xlsx'), 'not a folder')

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
    expect(parseTitle('"Title: Vintage Floral Cotton T-Shirt"', 'en', 'temu')).toBe(
      'Vintage Floral Cotton T-Shirt',
    )
    expect(parseTitle('标题：复古花卉短袖 T 恤', 'zh', 'temu')).toBe('复古花卉短袖 T 恤')
    expect(parseTitle(`${'A'.repeat(80)} extra`, 'en', 'mercado')).toHaveLength(60)
  })

  it('normalizes title file names', () => {
    expect(normalizeTitleFileBaseName(' 英文标题.xlsx ')).toBe('英文标题')
    expect(normalizeTitleFileBaseName('../bad:name')).toBe('.._bad_name')
    expect(titleXlsxPath('/tmp/batch', '英文标题')).toBe(join('/tmp/batch', '英文标题.xlsx'))
  })

  it('normalizes and assigns keyword groups in natural sku order', () => {
    const groups = normalizeTitleKeywordGroups([
      { prefix: ' A ', suffix: '' },
      { prefix: '', suffix: '' },
      { suffix: ' C ' },
      { prefix: 'D', suffix: 'E' },
    ])
    expect(groups).toEqual([{ prefix: 'A' }, { suffix: 'C' }, { prefix: 'D', suffix: 'E' }])

    const skuCodes = Array.from({ length: 1000 }, (_, index) => `SKU${index + 1}`)
    const assignments = assignTitleKeywordGroups(skuCodes, [
      { prefix: 'G1' },
      { prefix: 'G2' },
      { prefix: 'G3' },
      { prefix: 'G4' },
      { prefix: 'G5' },
      { prefix: 'G6' },
    ])
    const groupSizes = [1, 2, 3, 4, 5, 6].map(
      (groupIndex) =>
        Array.from(assignments.values()).filter((item) => item.groupIndex === groupIndex).length,
    )
    expect(groupSizes).toEqual([167, 167, 167, 167, 166, 166])
    expect(assignments.get('SKU1')).toMatchObject({ groupIndex: 1 })
    expect(assignments.get('SKU168')).toMatchObject({ groupIndex: 2 })
    expect(assignments.get('SKU835')).toMatchObject({ groupIndex: 6 })
  })

  it('joins generated titles with assigned keyword group', () => {
    expect(
      joinTitleWithKeywordGroup(
        'Vintage Shirt',
        { groupIndex: 1, group: { prefix: 'Temu', suffix: 'Summer' } },
        ' - ',
      ),
    ).toBe('Temu - Vintage Shirt - Summer')
    expect(
      joinTitleWithKeywordGroup(
        'Vintage Shirt',
        { groupIndex: 1, group: { suffix: 'Summer' } },
        ' ',
      ),
    ).toBe('Vintage Shirt Summer')
    expect(joinTitleWithKeywordGroup(' Vintage Shirt ', undefined, ' - ')).toBe('Vintage Shirt')
  })

  it('reads and writes titles xlsx with generated titles overriding existing ones', async () => {
    const xlsxPath = join(tempRoot, 'titles.xlsx')
    await createWorkbook(xlsxPath, [
      ['SKU1', 'Old title'],
      ['SKU2', 'Keep title'],
    ])
    const existing = await readExistingTitles(xlsxPath)

    await writeTitlesXlsx(xlsxPath, new Map([['SKU1', 'New title']]), existing, tempRoot)

    await expect(readExistingTitles(xlsxPath)).resolves.toEqual(
      new Map([
        ['SKU1', 'New title'],
        ['SKU2', 'Keep title'],
      ]),
    )
  })

  it('preserves the existing workbook when a replacement write fails after partial output', async () => {
    const xlsxPath = join(tempRoot, 'titles.xlsx')
    await createWorkbook(xlsxPath, [['SKU1', 'Original title']])
    const originalContents = await readFile(xlsxPath)
    const xlsxPrototype = Object.getPrototypeOf(new ExcelJS.Workbook().xlsx) as {
      writeFile(path: string): Promise<void>
    }
    const ioError = Object.assign(new Error('disk I/O failed'), { code: 'EIO' })
    let temporaryPath = ''
    const writeFileSpy = vi
      .spyOn(xlsxPrototype, 'writeFile')
      .mockImplementationOnce(async (path: string) => {
        temporaryPath = path
        await writeFile(path, 'partial workbook')
        throw ioError
      })

    try {
      await expect(
        writeTitlesXlsx(
          xlsxPath,
          new Map([['SKU1', 'Replacement title']]),
          new Map([['SKU1', 'Original title']]),
          tempRoot,
        ),
      ).rejects.toBe(ioError)
      await expect(readFile(xlsxPath)).resolves.toEqual(originalContents)
      expect(temporaryPath).not.toBe(xlsxPath)
      expect(temporaryPath.startsWith(join(tempRoot, '.workbench', 'tmp', 'title-xlsx'))).toBe(true)
      await expect(stat(temporaryPath)).rejects.toMatchObject({ code: 'ENOENT' })
    } finally {
      writeFileSpy.mockRestore()
    }
  })

  it('falls back to legacy titles.xlsx when 标题.xlsx is missing', async () => {
    const batchDir = join(tempRoot, 'legacy-batch')
    await mkdir(batchDir, { recursive: true })
    const legacyPath = join(batchDir, 'titles.xlsx')
    await createWorkbook(legacyPath, [['SKU1', 'Legacy title']])

    await expect(resolveTitleXlsxPath(batchDir)).resolves.toBe(legacyPath)
    await expect(readExistingTitles(await resolveTitleXlsxPath(batchDir))).resolves.toEqual(
      new Map([['SKU1', 'Legacy title']]),
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
  it('uses the local Bailian vision model snapshot', async () => {
    const service = new TitleService()

    await expect(service.listModels()).resolves.toEqual(
      BAILIAN_VISION_MODELS.map((model) => ({
        key: model.id,
        label: model.label,
      })),
    )
  })

  it('runs a title batch with skip mode, retries empty responses, writes xlsx and registers skus', async () => {
    const batchDir = join(tempRoot, 'batch')
    await createSku(batchDir, 'SKU1', ['1.png'])
    await createSku(batchDir, 'SKU2', ['1.png'])
    await createWorkbook(join(batchDir, '标题.xlsx'), [['SKU2', 'Existing title']])
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
      platform: 'temu',
      language: 'en',
      model: 'qwen3.6-flash',
      imageIndex: 1,
      extraRequirement: '突出原创图案',
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
    expect(JSON.stringify(visionCompletion.mock.calls[0]?.[0])).toContain('平台：Temu (temu)')
    expect(JSON.stringify(visionCompletion.mock.calls[0]?.[0])).toContain('标题语言：英语 (en)')
    expect(JSON.stringify(visionCompletion.mock.calls[0]?.[0])).toContain('额外要求：突出原创图案')
    expect(preprocess).toHaveBeenCalledTimes(2)
    await expect(readExistingTitles(join(batchDir, '标题.xlsx'))).resolves.toEqual(
      new Map([
        ['SKU1', 'Generated SKU1'],
        ['SKU2', 'Existing title'],
      ]),
    )
    expect(registeredRows).toHaveLength(1)
    expect(registeredRows[0]).toEqual(
      expect.arrayContaining(['SKU1', 'batch', 'Generated SKU1', 'en', 'temu']),
    )
    expect(progress).toContainEqual(
      expect.objectContaining({ task_id: 'task-title', processed: 2, succeeded: 1, skipped: 1 }),
    )
    expect(result.diagnosticsLogPath).toContain(join('.workbench', 'logs', 'diagnostics', 'title'))
    const diagnosticEvents = await readJsonl(result.diagnosticsLogPath ?? '')
    expect(diagnosticEvents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'task_started' }),
        expect.objectContaining({ type: 'decision', operation: 'skip_existing_title' }),
        expect.objectContaining({ type: 'request', operation: 'title' }),
        expect.objectContaining({ type: 'response', operation: 'title' }),
        expect.objectContaining({ type: 'parse_failed', operation: 'title' }),
        expect.objectContaining({ type: 'parse_result', operation: 'title' }),
        expect.objectContaining({ type: 'task_completed' }),
      ]),
    )
    expect(JSON.stringify(diagnosticEvents)).not.toContain('cHJvY2Vzc2Vk')
    await expect(
      stat(join(workbenchRoot, '.workbench', 'tmp', 'title', 'task-title')),
    ).rejects.toThrow()
  })

  it('does not require skill or API key when every sku is skipped', async () => {
    const batchDir = join(tempRoot, 'skip-batch')
    await createSku(batchDir, 'SKU1', ['1.png'])
    await createWorkbook(join(batchDir, '标题.xlsx'), [['SKU1', 'Existing title']])
    const service = new TitleService()

    const result = await service.runTitleBatch(
      {
        batchDir,
        platform: 'temu',
        language: 'en',
        model: 'qwen3.6-flash',
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

  it('cancels a running title batch without starting later skus', async () => {
    const batchDir = join(tempRoot, 'cancel-title')
    await createSku(batchDir, 'SKU1', ['1.png'])
    await createSku(batchDir, 'SKU2', ['1.png'])
    await createSku(batchDir, 'SKU3', ['1.png'])
    const service = new TitleService()
    const visionCompletion = vi.fn().mockResolvedValue({ text: 'Generated SKU1' })
    const preprocess = vi.fn(async (options: { taskId: string }) => {
      service.cancelTask(options.taskId)
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

    const result = await service.runTitleBatch(
      {
        batchDir,
        platform: 'temu',
        language: 'en',
        model: 'qwen3.6-flash',
        concurrency: 1,
        taskId: 'cancel-title',
      },
      {
        skillCache: {
          listSkills: vi.fn().mockResolvedValue([summary()]),
          getSkill: vi.fn().mockResolvedValue(skill()),
        },
        createBailianAdapter: () => ({ visionCompletion }),
        preprocessPool: { process: preprocess, close: vi.fn() },
        readConfig: async () => ({ workbench_root: workbenchRoot }),
        getSecret: async () => 'sk-test',
        openDatabase: () =>
          ({
            exec: vi.fn(),
            prepare: vi.fn(() => ({ run: vi.fn() })),
            close: vi.fn(),
          }) as unknown as TestDatabase,
        tempFileManager: createTempFileManager(),
      },
    )

    expect(result).toMatchObject({
      total: 3,
      succeeded: 1,
      failed: 0,
      skipped: 0,
      cancelled: true,
    })
    expect(visionCompletion).toHaveBeenCalledTimes(1)
    await expect(readExistingTitles(result.xlsxPath)).resolves.toEqual(
      new Map([['SKU1', 'Generated SKU1']]),
    )
  })

  it('creates a processing session that generates one sku at a time', async () => {
    const batchDir = join(tempRoot, 'session-batch')
    const skuDir = await createSku(batchDir, 'SKU1', ['1.png'])
    const outputPath = join(workbenchRoot, '.workbench', 'tmp', 'title', 'session-title', 'p.jpg')
    const service = new TitleService()

    const session = await service.createProcessingSession(
      {
        batchDir,
        platform: 'temu',
        language: 'en',
        model: 'qwen3.6-flash',
        taskId: 'session-title',
      },
      {
        skillCache: {
          listSkills: vi.fn().mockResolvedValue([summary()]),
          getSkill: vi.fn().mockResolvedValue(skill()),
        },
        createBailianAdapter: () => ({
          visionCompletion: vi.fn().mockResolvedValue({ text: 'Vintage Shirt' }),
        }),
        preprocessPool: {
          process: vi.fn(async () => {
            await mkdir(dirname(outputPath), { recursive: true })
            await writeFile(outputPath, 'processed')
            return {
              outputPath,
              mimeType: 'image/jpeg',
              sizeBytes: 9,
              dataUrl: 'data:image/jpeg;base64,cHJvY2Vzc2Vk',
            }
          }),
          close: vi.fn(),
        },
        readConfig: async () => ({ workbench_root: workbenchRoot }),
        getSecret: async () => 'sk-test',
        tempFileManager: createTempFileManager(),
      },
    )

    await expect(
      session.generateSku({
        skuCode: 'SKU1',
        skuFolder: skuDir,
      }),
    ).resolves.toMatchObject({
      skuCode: 'SKU1',
      status: 'success',
      baseTitle: 'Vintage Shirt',
      imagePath: join(skuDir, '1.png'),
    })
    await session.close()
  })

  it('writes custom title xlsx and wraps generated titles with keyword groups', async () => {
    const batchDir = join(tempRoot, 'custom-title')
    await createSku(batchDir, 'SKU1', ['1.png'])
    const outputPath = join(workbenchRoot, '.workbench', 'tmp', 'title', 'custom-title', 'p.jpg')
    const service = new TitleService()

    const result = await service.runTitleBatch(
      {
        batchDir,
        titleFileName: '英文标题.xlsx',
        platform: 'temu',
        language: 'en',
        model: 'qwen3.6-flash',
        keywordGroups: [{ prefix: 'Temu', suffix: 'Summer' }],
        keywordGroupSeparator: ' - ',
        existingStrategy: 'skip',
        concurrency: 1,
        taskId: 'custom-title',
      },
      {
        skillCache: {
          listSkills: vi.fn().mockResolvedValue([summary()]),
          getSkill: vi.fn().mockResolvedValue(skill()),
        },
        createBailianAdapter: () => ({
          visionCompletion: vi.fn().mockResolvedValue({ text: 'Vintage Shirt' }),
        }),
        preprocessPool: {
          process: vi.fn(async () => {
            await mkdir(dirname(outputPath), { recursive: true })
            await writeFile(outputPath, 'processed')
            return {
              outputPath,
              mimeType: 'image/jpeg',
              sizeBytes: 9,
              dataUrl: 'data:image/jpeg;base64,cHJvY2Vzc2Vk',
            }
          }),
          close: vi.fn(),
        },
        readConfig: async () => ({ workbench_root: workbenchRoot }),
        getSecret: async () => 'sk-test',
        openDatabase: () =>
          ({
            exec: vi.fn(),
            prepare: vi.fn(() => ({ run: vi.fn() })),
            close: vi.fn(),
          }) as unknown as TestDatabase,
        tempFileManager: createTempFileManager(),
      },
    )

    expect(result.xlsxPath).toBe(join(batchDir, '英文标题.xlsx'))
    await expect(readExistingTitles(result.xlsxPath)).resolves.toEqual(
      new Map([['SKU1', 'Temu - Vintage Shirt - Summer']]),
    )
  })

  it('keeps keyword group assignment based on all skus when existing titles are skipped', async () => {
    const batchDir = join(tempRoot, 'skip-with-groups')
    await createSku(batchDir, 'SKU1', ['1.png'])
    await createSku(batchDir, 'SKU2', ['1.png'])
    await createSku(batchDir, 'SKU3', ['1.png'])
    await createSku(batchDir, 'SKU4', ['1.png'])
    await createWorkbook(join(batchDir, '标题.xlsx'), [['SKU1', 'Existing title']])
    const outputPath = join(
      workbenchRoot,
      '.workbench',
      'tmp',
      'title',
      'skip-with-groups',
      'p.jpg',
    )
    const service = new TitleService()

    const result = await service.runTitleBatch(
      {
        batchDir,
        platform: 'temu',
        language: 'en',
        model: 'qwen3.6-flash',
        keywordGroups: [{ prefix: 'Group1' }, { prefix: 'Group2' }],
        keywordGroupSeparator: ' ',
        existingStrategy: 'skip',
        concurrency: 1,
        taskId: 'skip-with-groups',
      },
      {
        skillCache: {
          listSkills: vi.fn().mockResolvedValue([summary()]),
          getSkill: vi.fn().mockResolvedValue(skill()),
        },
        createBailianAdapter: () => ({
          visionCompletion: vi.fn().mockResolvedValue({ text: 'Generated Title' }),
        }),
        preprocessPool: {
          process: vi.fn(async () => {
            await mkdir(dirname(outputPath), { recursive: true })
            await writeFile(outputPath, 'processed')
            return {
              outputPath,
              mimeType: 'image/jpeg',
              sizeBytes: 9,
              dataUrl: 'data:image/jpeg;base64,cHJvY2Vzc2Vk',
            }
          }),
          close: vi.fn(),
        },
        readConfig: async () => ({ workbench_root: workbenchRoot }),
        getSecret: async () => 'sk-test',
        openDatabase: () =>
          ({
            exec: vi.fn(),
            prepare: vi.fn(() => ({ run: vi.fn() })),
            close: vi.fn(),
          }) as unknown as TestDatabase,
        tempFileManager: createTempFileManager(),
      },
    )

    expect(result).toMatchObject({ succeeded: 3, skipped: 1 })
    await expect(readExistingTitles(result.xlsxPath)).resolves.toEqual(
      new Map([
        ['SKU1', 'Existing title'],
        ['SKU2', 'Group1 Generated Title'],
        ['SKU3', 'Group2 Generated Title'],
        ['SKU4', 'Group2 Generated Title'],
      ]),
    )
  })

  it('keeps keyword group assignment based on all skus when skuCodes filters a retry run', async () => {
    const batchDir = join(tempRoot, 'retry-with-groups')
    await createSku(batchDir, 'SKU1', ['1.png'])
    await createSku(batchDir, 'SKU2', ['1.png'])
    await createSku(batchDir, 'SKU3', ['1.png'])
    await createSku(batchDir, 'SKU4', ['1.png'])
    const outputPath = join(
      workbenchRoot,
      '.workbench',
      'tmp',
      'title',
      'retry-with-groups',
      'p.jpg',
    )
    const service = new TitleService()

    const result = await service.runTitleBatch(
      {
        batchDir,
        platform: 'temu',
        language: 'en',
        model: 'qwen3.6-flash',
        keywordGroups: [{ prefix: 'Group1' }, { prefix: 'Group2' }],
        keywordGroupSeparator: ' ',
        existingStrategy: 'regenerate',
        skuCodes: ['SKU3'],
        concurrency: 1,
        taskId: 'retry-with-groups',
      },
      {
        skillCache: {
          listSkills: vi.fn().mockResolvedValue([summary()]),
          getSkill: vi.fn().mockResolvedValue(skill()),
        },
        createBailianAdapter: () => ({
          visionCompletion: vi.fn().mockResolvedValue({ text: 'Generated Title' }),
        }),
        preprocessPool: {
          process: vi.fn(async () => {
            await mkdir(dirname(outputPath), { recursive: true })
            await writeFile(outputPath, 'processed')
            return {
              outputPath,
              mimeType: 'image/jpeg',
              sizeBytes: 9,
              dataUrl: 'data:image/jpeg;base64,cHJvY2Vzc2Vk',
            }
          }),
          close: vi.fn(),
        },
        readConfig: async () => ({ workbench_root: workbenchRoot }),
        getSecret: async () => 'sk-test',
        openDatabase: () =>
          ({
            exec: vi.fn(),
            prepare: vi.fn(() => ({ run: vi.fn() })),
            close: vi.fn(),
          }) as unknown as TestDatabase,
        tempFileManager: createTempFileManager(),
      },
    )

    expect(result).toMatchObject({ total: 1, succeeded: 1 })
    await expect(readExistingTitles(result.xlsxPath)).resolves.toEqual(
      new Map([['SKU3', 'Group2 Generated Title']]),
    )
  })
})
