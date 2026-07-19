import { mkdtemp, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { AppErrorClass, type PipelineRunConfig, type PipelineRunStats } from '@tengyu-aipod/shared'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PipelinePrintStreamItem, PipelineStageRuntimeContext } from '../pipeline-stage-types'
import { openSqliteDatabase } from '../sqlite'
import { listPendingTitleWrites, pendingTitleMap } from './title-pending-writes'
import { createTitleStage } from './title-stage'

const mocks = vi.hoisted(() => ({
  appendDiagnosticLog: vi.fn(async () => undefined),
  cancelTask: vi.fn(),
  closeSession: vi.fn(async () => undefined),
  createProcessingSession: vi.fn(),
  generateSku: vi.fn(),
  readExistingTitles: vi.fn(),
  registerSkuTitle: vi.fn(),
  registerSkuTitles: vi.fn(),
  resolveTitleXlsxPath: vi.fn(),
  scanSkuFolders: vi.fn(),
  writeTitlesXlsx: vi.fn(
    async (
      _xlsxPath: string,
      _generatedTitles: Map<string, string>,
      _existingTitles: Map<string, string>,
    ) => undefined,
  ),
}))

const storeMocks = vi.hoisted(() => ({
  updatePipelineStepCompletedWithInput: vi.fn(),
  updatePipelineStepFailed: vi.fn(),
  updatePipelineStepOutputCount: vi.fn(),
  upsertPipelineStepRunning: vi.fn(),
}))

const actualTitleFunctions = vi.hoisted(
  (): {
    readExistingTitles: ((xlsxPath: string) => Promise<Map<string, string>>) | null
    writeTitlesXlsx:
      | ((
          xlsxPath: string,
          generatedTitles: Map<string, string>,
          existingTitles: Map<string, string>,
        ) => Promise<void>)
      | null
  } => ({
    readExistingTitles: null,
    writeTitlesXlsx: null,
  }),
)

vi.mock('../pipeline/store', () => storeMocks)

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
  shell: {
    openPath: vi.fn(),
  },
}))

vi.mock('../title-service', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../title-service')>()
  actualTitleFunctions.readExistingTitles = actual.readExistingTitles
  actualTitleFunctions.writeTitlesXlsx = actual.writeTitlesXlsx
  return {
    appErrorMessage: (error: unknown) => (error instanceof Error ? error.message : String(error)),
    assignTitleKeywordGroups: (skuCodes: string[]) =>
      new Map(skuCodes.map((skuCode) => [skuCode, undefined])),
    joinTitleWithKeywordGroup: (baseTitle: string) => baseTitle,
    normalizeTitleKeywordGroups: () => [],
    readExistingTitles: mocks.readExistingTitles,
    registerSkuTitle: mocks.registerSkuTitle,
    registerSkuTitles: mocks.registerSkuTitles,
    resolveTitleXlsxPath: mocks.resolveTitleXlsxPath,
    scanSkuFolders: mocks.scanSkuFolders,
    titleService: {
      cancelTask: mocks.cancelTask,
      createProcessingSession: mocks.createProcessingSession,
    },
    toXlsxWriteError: (error: unknown) => error,
    writeTitlesXlsx: mocks.writeTitlesXlsx,
  }
})

const originalSkipTitleDbRegister = process.env.TENGYU_SKIP_TITLE_DB_REGISTER
const tempRoots: string[] = []

async function createTestWorkbenchRoot() {
  const root = await mkdtemp(join(tmpdir(), 'tengyu-title-stage-'))
  tempRoots.push(root)
  return root
}

function pipelineConfig(workbenchRoot: string): PipelineRunConfig {
  return {
    name: '标题微批次测试',
    printMode: 'local',
    source: {
      mode: 'existing_prints',
      printFolder: join(workbenchRoot, '02-印花工作区', 'ready'),
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
      outputRoot: join(workbenchRoot, '04-上架工作区'),
    },
    title: {
      enabled: true,
      platform: 'temu',
      language: 'en',
      model: 'qwen3.6-flash',
      existingStrategy: 'regenerate',
    },
  }
}

function emptyStats(): PipelineRunStats {
  return {
    sourceImages: 0,
    prints: 0,
    detectionPass: 0,
    detectionReview: 0,
    detectionBlock: 0,
    photoshopGroups: 0,
    titleSucceeded: 0,
    titleFailed: 0,
  }
}

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  const promise = new Promise<T>((innerResolve) => {
    resolve = innerResolve
  })
  return { promise, resolve }
}

describe('title stage', () => {
  beforeEach(() => {
    process.env.TENGYU_SKIP_TITLE_DB_REGISTER = '0'
    vi.clearAllMocks()
    mocks.readExistingTitles.mockResolvedValue(new Map())
    mocks.writeTitlesXlsx.mockImplementation(async () => undefined)
    mocks.resolveTitleXlsxPath.mockImplementation(async (batchDir: string) =>
      join(batchDir, '标题.xlsx'),
    )
    mocks.generateSku.mockImplementation(async ({ skuCode }: { skuCode: string }) => ({
      skuCode,
      status: 'success' as const,
      baseTitle: `Base ${skuCode}`,
      imagePath: '',
    }))
    mocks.createProcessingSession.mockResolvedValue({
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
      workbenchRoot: 'C:\\workbench',
      appendDiagnosticLog: mocks.appendDiagnosticLog,
      generateSku: mocks.generateSku,
      close: mocks.closeSession,
    })
  })

  afterEach(async () => {
    if (originalSkipTitleDbRegister === undefined) {
      Reflect.deleteProperty(process.env, 'TENGYU_SKIP_TITLE_DB_REGISTER')
    } else {
      process.env.TENGYU_SKIP_TITLE_DB_REGISTER = originalSkipTitleDbRegister
    }
    await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
  })

  it('flushes and registers one template batch once instead of once per SKU', async () => {
    const workbenchRoot = await createTestWorkbenchRoot()
    const batchDir = join(workbenchRoot, '04-上架工作区', 'shirt')
    const skuCodes = ['SKU-001', 'SKU-002', 'SKU-003']
    const items: PipelinePrintStreamItem[] = skuCodes.map((skuCode) => ({
      itemKey: skuCode,
      path: join(batchDir, skuCode, '01.jpg'),
      printId: `pri-${skuCode}`,
      sourceArtifactIds: [],
    }))
    mocks.scanSkuFolders.mockResolvedValue(
      skuCodes.map((skuCode) => ({ skuCode, path: join(batchDir, skuCode) })),
    )

    const db = openSqliteDatabase(':memory:')
    const stats = emptyStats()
    const upsertPipelineItem = vi.fn()
    const context: PipelineStageRuntimeContext = {
      runId: 'run-title-batch',
      taskName: '标题微批次测试',
      config: pipelineConfig(workbenchRoot),
      stepKey: 'title',
      isCancelled: () => false,
    }
    const titleStage = createTitleStage({
      db,
      workbenchRoot,
      stats,
      upsertPipelineItem,
      appendLog: vi.fn(),
      emitRunningProgress: vi.fn(),
      setCurrentCancel: vi.fn(),
      assertNotCancelled: vi.fn(),
    })(context)
    async function* source() {
      yield* items
    }

    try {
      const outputs: PipelinePrintStreamItem[] = []
      for await (const item of titleStage(source(), context)) {
        outputs.push(item)
      }

      const expectedTitles = new Map(skuCodes.map((skuCode) => [skuCode, `Base ${skuCode}`]))
      expect(outputs).toEqual(items)
      expect(mocks.writeTitlesXlsx).toHaveBeenCalledTimes(1)
      expect(mocks.writeTitlesXlsx).toHaveBeenCalledWith(
        join(batchDir, '标题.xlsx'),
        expectedTitles,
        new Map(),
      )
      expect(mocks.registerSkuTitles).toHaveBeenCalledTimes(1)
      expect(mocks.registerSkuTitles).toHaveBeenCalledWith(
        db,
        expect.objectContaining({
          templateBatch: 'shirt',
          titles: expectedTitles,
        }),
      )
      expect(mocks.registerSkuTitle).not.toHaveBeenCalled()
      expect(stats.titleSucceeded).toBe(3)
      expect(upsertPipelineItem).toHaveBeenCalledTimes(6)
    } finally {
      db.close()
    }
  })

  it('preserves titles when two stage sessions write the same workbook', async () => {
    process.env.TENGYU_SKIP_TITLE_DB_REGISTER = '1'
    const actualReadExistingTitles = actualTitleFunctions.readExistingTitles
    const actualWriteTitlesXlsx = actualTitleFunctions.writeTitlesXlsx
    if (!actualReadExistingTitles || !actualWriteTitlesXlsx) {
      throw new Error('actual title xlsx functions are unavailable')
    }
    const workbenchRoot = await createTestWorkbenchRoot()
    const batchDir = join(workbenchRoot, '04-上架工作区', 'shirt')
    const xlsxPath = join(batchDir, '标题.xlsx')
    const firstItem: PipelinePrintStreamItem = {
      itemKey: 'SKU-A',
      path: join(batchDir, 'SKU-A', '01.jpg'),
      printId: 'pri-SKU-A',
      sourceArtifactIds: [],
    }
    const secondItem: PipelinePrintStreamItem = {
      itemKey: 'SKU-B',
      path: join(batchDir, 'SKU-B', '01.jpg'),
      printId: 'pri-SKU-B',
      sourceArtifactIds: [],
    }
    mocks.scanSkuFolders.mockResolvedValue([
      { skuCode: 'SKU-A', path: dirname(firstItem.path) },
      { skuCode: 'SKU-B', path: dirname(secondItem.path) },
    ])
    mocks.readExistingTitles.mockImplementation(actualReadExistingTitles)

    const bothSessionsGenerating = createDeferred<void>()
    let generationCalls = 0
    mocks.generateSku.mockImplementation(async ({ skuCode }: { skuCode: string }) => {
      generationCalls += 1
      if (generationCalls === 2) {
        bothSessionsGenerating.resolve()
      }
      await bothSessionsGenerating.promise
      return {
        skuCode,
        status: 'success' as const,
        baseTitle: `Base ${skuCode}`,
        imagePath: '',
      }
    })

    const bothWritesReady = createDeferred<void>()
    let writeCalls = 0
    mocks.writeTitlesXlsx.mockImplementation(async (path, generatedTitles, existingTitles) => {
      writeCalls += 1
      if (writeCalls === 2) {
        bothWritesReady.resolve()
      }
      await bothWritesReady.promise
      await actualWriteTitlesXlsx(path, generatedTitles, existingTitles)
    })

    const db = openSqliteDatabase(':memory:')
    const createStage = (runId: string) => {
      const context: PipelineStageRuntimeContext = {
        runId,
        taskName: '标题并发写入测试',
        config: pipelineConfig(workbenchRoot),
        stepKey: 'title',
        isCancelled: () => false,
      }
      return {
        context,
        stage: createTitleStage({
          db,
          workbenchRoot,
          stats: emptyStats(),
          upsertPipelineItem: vi.fn(),
          appendLog: vi.fn(),
          emitRunningProgress: vi.fn(),
          setCurrentCancel: vi.fn(),
          assertNotCancelled: vi.fn(),
        })(context),
      }
    }
    const consume = async (run: ReturnType<typeof createStage>, item: PipelinePrintStreamItem) => {
      async function* source() {
        yield item
      }
      for await (const _output of run.stage(source(), run.context)) {
        // Consume the stage so its final workbook flush completes.
      }
    }

    try {
      await Promise.all([
        consume(createStage('run-title-A'), firstItem),
        consume(createStage('run-title-B'), secondItem),
      ])

      await expect(actualReadExistingTitles(xlsxPath)).resolves.toEqual(
        new Map([
          ['SKU-A', 'Base SKU-A'],
          ['SKU-B', 'Base SKU-B'],
        ]),
      )
    } finally {
      bothWritesReady.resolve()
      bothSessionsGenerating.resolve()
      db.close()
    }
  })

  it('persists each generated title before waiting for the next SKU', async () => {
    const workbenchRoot = await mkdtemp(join(tmpdir(), 'tengyu-title-durable-'))
    const batchDir = join(workbenchRoot, '04-上架工作区', 'shirt')
    const item: PipelinePrintStreamItem = {
      itemKey: 'SKU-001',
      path: join(batchDir, 'SKU-001', '01.jpg'),
      printId: 'pri-SKU-001',
      sourceArtifactIds: [],
    }
    mocks.scanSkuFolders.mockResolvedValue([
      { skuCode: 'SKU-001', path: join(batchDir, 'SKU-001') },
    ])
    const sourceRequestedNext = createDeferred<void>()
    const releaseSource = createDeferred<void>()

    const db = openSqliteDatabase(':memory:')
    const context: PipelineStageRuntimeContext = {
      runId: 'run-title-durable',
      taskName: '标题持久化测试',
      config: pipelineConfig(workbenchRoot),
      stepKey: 'title',
      isCancelled: () => false,
    }
    const titleStage = createTitleStage({
      db,
      workbenchRoot,
      stats: emptyStats(),
      upsertPipelineItem: vi.fn(),
      appendLog: vi.fn(),
      emitRunningProgress: vi.fn(),
      setCurrentCancel: vi.fn(),
      assertNotCancelled: vi.fn(),
    })(context)
    async function* source() {
      yield item
      sourceRequestedNext.resolve()
      await releaseSource.promise
    }

    try {
      const iterator = titleStage(source(), context)[Symbol.asyncIterator]()
      const firstOutput = iterator.next()
      await sourceRequestedNext.promise
      const pendingBeforeFinalFlush = await listPendingTitleWrites(workbenchRoot)

      releaseSource.resolve()
      await expect(firstOutput).resolves.toEqual({ done: false, value: item })
      await expect(iterator.next()).resolves.toEqual({ done: true, value: undefined })

      expect(pendingBeforeFinalFlush).toHaveLength(1)
      const pendingRecord = pendingBeforeFinalFlush[0]
      if (!pendingRecord) {
        throw new Error('generated title sidecar is missing')
      }
      expect(pendingTitleMap(pendingRecord)).toEqual(new Map([['SKU-001', 'Base SKU-001']]))
    } finally {
      releaseSource.resolve()
      db.close()
      await rm(workbenchRoot, { recursive: true, force: true })
    }
  })

  it('flushes generated titles before an upstream cancellation escapes', async () => {
    const workbenchRoot = await createTestWorkbenchRoot()
    const batchDir = join(workbenchRoot, '04-上架工作区', 'shirt')
    const item: PipelinePrintStreamItem = {
      itemKey: 'SKU-001',
      path: join(batchDir, 'SKU-001', '01.jpg'),
      printId: 'pri-SKU-001',
      sourceArtifactIds: [],
    }
    mocks.scanSkuFolders.mockResolvedValue([
      { skuCode: 'SKU-001', path: join(batchDir, 'SKU-001') },
    ])

    const db = openSqliteDatabase(':memory:')
    const context: PipelineStageRuntimeContext = {
      runId: 'run-title-cancelled',
      taskName: '标题取消测试',
      config: pipelineConfig(workbenchRoot),
      stepKey: 'title',
      isCancelled: () => false,
    }
    const titleStage = createTitleStage({
      db,
      workbenchRoot,
      stats: emptyStats(),
      upsertPipelineItem: vi.fn(),
      appendLog: vi.fn(),
      emitRunningProgress: vi.fn(),
      setCurrentCancel: vi.fn(),
      assertNotCancelled: vi.fn(),
    })(context)
    async function* source() {
      yield item
      throw new Error('cancelled upstream')
    }

    try {
      const iterator = titleStage(source(), context)[Symbol.asyncIterator]()
      await expect(iterator.next()).resolves.toEqual({ done: false, value: item })
      await expect(iterator.next()).rejects.toThrow('cancelled upstream')
      expect(mocks.writeTitlesXlsx).toHaveBeenCalledTimes(1)
      expect(mocks.registerSkuTitles).toHaveBeenCalledTimes(1)
    } finally {
      db.close()
    }
  })

  it('does not create a title processing session when the input stream is empty', async () => {
    const workbenchRoot = await createTestWorkbenchRoot()
    const db = openSqliteDatabase(':memory:')
    const context: PipelineStageRuntimeContext = {
      runId: 'run-title-empty',
      taskName: '标题空输入测试',
      config: pipelineConfig(workbenchRoot),
      stepKey: 'title',
      isCancelled: () => false,
    }
    const titleStage = createTitleStage({
      db,
      workbenchRoot,
      stats: emptyStats(),
      upsertPipelineItem: vi.fn(),
      appendLog: vi.fn(),
      emitRunningProgress: vi.fn(),
      setCurrentCancel: vi.fn(),
      assertNotCancelled: vi.fn(),
    })(context)
    async function* source(): AsyncIterable<PipelinePrintStreamItem> {
      yield* []
    }

    try {
      const outputs: PipelinePrintStreamItem[] = []
      for await (const item of titleStage(source(), context)) {
        outputs.push(item)
      }

      expect(outputs).toEqual([])
      expect(mocks.createProcessingSession).not.toHaveBeenCalled()
      expect(storeMocks.updatePipelineStepCompletedWithInput).toHaveBeenCalledWith(
        db,
        expect.objectContaining({
          runId: context.runId,
          inputCount: 0,
          outputCount: 0,
        }),
      )
    } finally {
      db.close()
    }
  })

  it('fails the stage once when the title processing session cannot start', async () => {
    const workbenchRoot = await createTestWorkbenchRoot()
    const batchDir = join(workbenchRoot, '04-上架工作区', 'shirt')
    const items: PipelinePrintStreamItem[] = ['SKU-001', 'SKU-002'].map((skuCode) => ({
      itemKey: skuCode,
      path: join(batchDir, skuCode, '01.jpg'),
      printId: `pri-${skuCode}`,
      sourceArtifactIds: [],
    }))
    mocks.scanSkuFolders.mockResolvedValue(
      items.map((item) => ({ skuCode: item.itemKey, path: dirname(item.path) })),
    )
    mocks.createProcessingSession.mockRejectedValueOnce(
      new AppErrorClass('HTTP_4XX', '缺少阿里云百炼 API Key，请先在设置中填写', false),
    )

    const db = openSqliteDatabase(':memory:')
    const context: PipelineStageRuntimeContext = {
      runId: 'run-title-session-failure',
      taskName: '标题启动失败测试',
      config: pipelineConfig(workbenchRoot),
      stepKey: 'title',
      isCancelled: () => false,
    }
    const titleStage = createTitleStage({
      db,
      workbenchRoot,
      stats: emptyStats(),
      upsertPipelineItem: vi.fn(),
      appendLog: vi.fn(),
      emitRunningProgress: vi.fn(),
      setCurrentCancel: vi.fn(),
      assertNotCancelled: vi.fn(),
    })(context)
    async function* source() {
      yield* items
    }

    try {
      const consume = async () => {
        for await (const _item of titleStage(source(), context)) {
          // The stage must fail before yielding a title item.
        }
      }
      await expect(consume()).rejects.toThrow('缺少阿里云百炼 API Key')
      expect(mocks.createProcessingSession).toHaveBeenCalledTimes(1)
    } finally {
      db.close()
    }
  })

  it('stops after a fatal title provider error instead of repeating it for every SKU', async () => {
    const workbenchRoot = await createTestWorkbenchRoot()
    const batchDir = join(workbenchRoot, '04-上架工作区', 'shirt')
    const items: PipelinePrintStreamItem[] = ['SKU-001', 'SKU-002'].map((skuCode) => ({
      itemKey: skuCode,
      path: join(batchDir, skuCode, '01.jpg'),
      printId: `pri-${skuCode}`,
      sourceArtifactIds: [],
    }))
    mocks.scanSkuFolders.mockResolvedValue(
      items.map((item) => ({ skuCode: item.itemKey, path: dirname(item.path) })),
    )
    mocks.generateSku.mockResolvedValueOnce({
      skuCode: 'SKU-001',
      status: 'failed',
      error: '阿里云百炼 API Key 无效',
      fatal: true,
      appErrorCode: 'HTTP_4XX',
    })

    const db = openSqliteDatabase(':memory:')
    const context: PipelineStageRuntimeContext = {
      runId: 'run-title-provider-failure',
      taskName: '标题鉴权失败测试',
      config: pipelineConfig(workbenchRoot),
      stepKey: 'title',
      isCancelled: () => false,
    }
    const titleStage = createTitleStage({
      db,
      workbenchRoot,
      stats: emptyStats(),
      upsertPipelineItem: vi.fn(),
      appendLog: vi.fn(),
      emitRunningProgress: vi.fn(),
      setCurrentCancel: vi.fn(),
      assertNotCancelled: vi.fn(),
    })(context)
    async function* source() {
      yield* items
    }

    try {
      const consume = async () => {
        for await (const _item of titleStage(source(), context)) {
          // Fatal provider configuration errors stop the stage.
        }
      }
      await expect(consume()).rejects.toMatchObject({
        code: 'HTTP_4XX',
        message: '阿里云百炼 API Key 无效',
      })
      expect(mocks.generateSku).toHaveBeenCalledTimes(1)
    } finally {
      db.close()
    }
  })

  it('persists locked xlsx writes without failing and retries them on the next title stage', async () => {
    const workbenchRoot = await mkdtemp(join(tmpdir(), 'tengyu-title-pending-'))
    const batchDir = join(workbenchRoot, '04-上架工作区', 'shirt')
    const item: PipelinePrintStreamItem = {
      itemKey: 'SKU-001',
      path: join(batchDir, 'SKU-001', '01.jpg'),
      printId: 'pri-SKU-001',
      sourceArtifactIds: [],
    }
    mocks.scanSkuFolders.mockResolvedValue([
      { skuCode: 'SKU-001', path: join(batchDir, 'SKU-001') },
    ])
    mocks.writeTitlesXlsx.mockRejectedValueOnce(
      new AppErrorClass('XLSX_LOCKED', '标题文件被 Excel 占用，请关闭后重试', false),
    )

    const db = openSqliteDatabase(':memory:')
    const firstContext: PipelineStageRuntimeContext = {
      runId: 'run-title-locked',
      taskName: '标题占用测试',
      config: pipelineConfig(workbenchRoot),
      stepKey: 'title',
      isCancelled: () => false,
    }
    const createStage = (context: PipelineStageRuntimeContext) =>
      createTitleStage({
        db,
        workbenchRoot,
        stats: emptyStats(),
        upsertPipelineItem: vi.fn(),
        appendLog: vi.fn(),
        emitRunningProgress: vi.fn(),
        setCurrentCancel: vi.fn(),
        assertNotCancelled: vi.fn(),
      })(context)
    async function* firstSource() {
      yield item
    }
    async function* emptySource(): AsyncIterable<PipelinePrintStreamItem> {
      yield* []
    }

    try {
      const outputs: PipelinePrintStreamItem[] = []
      for await (const output of createStage(firstContext)(firstSource(), firstContext)) {
        outputs.push(output)
      }

      expect(outputs).toEqual([item])
      expect(mocks.registerSkuTitles).not.toHaveBeenCalled()
      expect(storeMocks.updatePipelineStepCompletedWithInput).toHaveBeenLastCalledWith(
        db,
        expect.objectContaining({
          runId: firstContext.runId,
          outputCount: 1,
          outputJson: expect.objectContaining({ pendingFlushBatches: 1 }),
        }),
      )

      const pendingDir = join(
        workbenchRoot,
        '.workbench',
        'pipeline-runs',
        firstContext.runId,
        'pending-title-writes',
      )
      await expect(readdir(pendingDir)).resolves.toHaveLength(1)

      const retryContext: PipelineStageRuntimeContext = {
        ...firstContext,
        runId: 'run-title-retry',
        taskName: '标题补写测试',
      }
      for await (const _output of createStage(retryContext)(emptySource(), retryContext)) {
        // Recovery does not emit pipeline items for the new run.
      }

      expect(mocks.createProcessingSession).toHaveBeenCalledTimes(1)
      expect(mocks.writeTitlesXlsx).toHaveBeenCalledTimes(2)
      expect(mocks.registerSkuTitles).toHaveBeenCalledWith(
        db,
        expect.objectContaining({
          templateBatch: 'shirt',
          titles: new Map([['SKU-001', 'Base SKU-001']]),
        }),
      )
      await expect(readdir(pendingDir)).resolves.toEqual([])
    } finally {
      db.close()
      await rm(workbenchRoot, { recursive: true, force: true })
    }
  })
})
