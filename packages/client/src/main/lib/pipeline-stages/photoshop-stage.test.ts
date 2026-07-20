import {
  AppErrorClass,
  type PhotoshopBatchResult,
  type PipelineRunConfig,
} from '@tengyu-aipod/shared'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { runBatch as runPhotoshopBatch } from '../../photoshop/multi-batch'
import type { PipelinePrintStreamItem, PipelineStageRuntimeContext } from '../pipeline-stage-types'
import { type SqliteDatabase, openSqliteDatabase } from '../sqlite'
import { createPhotoshopStage } from './photoshop-stage'

const fsMocks = vi.hoisted(() => ({
  copyFile: vi.fn(async () => undefined),
  mkdir: vi.fn(async () => undefined),
  stat: vi.fn(),
  writeFile: vi.fn(async () => undefined),
}))

const storeMocks = vi.hoisted(() => ({
  updatePipelineStepCompletedWithInput: vi.fn(),
  updatePipelineStepOutputCount: vi.fn(),
  upsertPipelineStepRunning: vi.fn(),
}))

const tempFileMocks = vi.hoisted(() => ({
  cleanupTask: vi.fn(async () => undefined),
  createTaskDir: vi.fn(async () => 'C:\\temp\\photoshop-task'),
}))

vi.mock('node:fs/promises', async (importOriginal) => ({
  ...(await importOriginal<typeof import('node:fs/promises')>()),
  copyFile: fsMocks.copyFile,
  mkdir: fsMocks.mkdir,
  stat: fsMocks.stat,
  writeFile: fsMocks.writeFile,
}))

vi.mock('../pipeline/store', () => storeMocks)

vi.mock('../temp-file-manager', () => ({
  tempFileManager: tempFileMocks,
}))

const databases: SqliteDatabase[] = []

function pipelineConfig(): PipelineRunConfig {
  return {
    name: 'Photoshop stage test',
    printSkuCode: 'PRINT',
    filenameSeparator: '-',
    printMode: 'local',
    source: {
      mode: 'existing_prints',
      printFolder: 'C:\\workbench\\02-印花工作区\\ready',
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
      outputRoot: 'C:\\workbench\\04-上架工作区',
      replaceRange: 'top',
    },
    title: {
      enabled: false,
      platform: 'temu',
      language: 'en',
      model: 'qwen3.6-flash',
    },
  }
}

function sourceItems(count = 2): PipelinePrintStreamItem[] {
  return Array.from({ length: count }, (_, index) => ({
    itemKey: `print-${index + 1}`,
    path: `C:\\source\\print-${index + 1}.png`,
    printId: `pri-${index + 1}`,
    sourceArtifactIds: [],
  }))
}

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((innerResolve, innerReject) => {
    resolve = innerResolve
    reject = innerReject
  })
  return { promise, reject, resolve }
}

function batchResult(groups: PhotoshopBatchResult['result_groups']): PhotoshopBatchResult {
  const outputs = groups.flatMap((group) => group.outputs)
  return {
    ok: true,
    task_id: 'photoshop-task',
    output_layout: 'template_first',
    templates_total: 1,
    groups_total: groups.length,
    groups_completed: groups.length,
    outputs,
    templates: [
      {
        template_id: 'template-1',
        template_name: 'shirt',
        groups_total: groups.length,
        groups_completed: groups.length,
        outputs,
      },
    ],
    result_groups: groups,
  }
}

function createHarness(
  replaceRange: 'top' | 'topmost' = 'top',
  templates = ['C:\\templates\\shirt.psd'],
  beforeMutexOperation?: () => Promise<void>,
) {
  const db = openSqliteDatabase(':memory:')
  databases.push(db)
  const runBatch = vi.fn<typeof runPhotoshopBatch>()
  const upsertPipelineItem = vi.fn()
  const config = pipelineConfig()
  config.photoshop.replaceRange = replaceRange
  config.photoshop.templates = templates
  const emitRunningProgress = vi.fn()
  const assertNotCancelled = vi.fn()
  const setCurrentCancel = vi.fn()
  const context: PipelineStageRuntimeContext = {
    runId: 'run-photoshop-stage',
    taskName: 'Photoshop stage test',
    config,
    stepKey: 'photoshop',
    isCancelled: () => false,
  }
  const stage = createPhotoshopStage({
    db,
    stats: {
      sourceImages: 0,
      prints: 0,
      detectionPass: 0,
      detectionReview: 0,
      detectionBlock: 0,
      photoshopGroups: 0,
      titleSucceeded: 0,
      titleFailed: 0,
    },
    workbenchRoot: 'C:\\workbench',
    photoshopMutex: {
      runExclusive: async <T>(operation: () => Promise<T>) => {
        await beforeMutexOperation?.()
        return operation()
      },
    },
    runBatch,
    upsertPipelineItem,
    updateResultSection: vi.fn(),
    appendLog: vi.fn(),
    emitRunningProgress,
    setCurrentCancel,
    assertNotCancelled,
  })(context)
  return {
    assertNotCancelled,
    context,
    emitRunningProgress,
    runBatch,
    setCurrentCancel,
    stage,
    upsertPipelineItem,
  }
}

async function consumeStage(
  stage: ReturnType<ReturnType<typeof createPhotoshopStage>>,
  context: PipelineStageRuntimeContext,
  items = sourceItems(),
) {
  async function* source() {
    yield* items
  }
  const outputs: PipelinePrintStreamItem[] = []
  for await (const item of stage(source(), context)) {
    outputs.push(item)
  }
  return outputs
}

describe('photoshop stage fatal error boundaries', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    fsMocks.copyFile.mockResolvedValue(undefined)
    fsMocks.mkdir.mockResolvedValue(undefined)
    fsMocks.stat.mockRejectedValue(Object.assign(new Error('not found'), { code: 'ENOENT' }))
    fsMocks.writeFile.mockResolvedValue(undefined)
    tempFileMocks.cleanupTask.mockResolvedValue(undefined)
    tempFileMocks.createTaskDir.mockResolvedValue('C:\\temp\\photoshop-task')
  })

  afterEach(() => {
    for (const db of databases.splice(0)) {
      db.close()
    }
  })

  it.each([
    ['PS_COM_FAILED', 'Photoshop COM connection failed'],
    ['PS_NOT_RUNNING', 'Photoshop is not running'],
  ] as const)('stops after one %s failure', async (code, message) => {
    const harness = createHarness()
    const fatalError = new AppErrorClass(code, message, true)
    harness.runBatch.mockRejectedValue(fatalError)

    await expect(consumeStage(harness.stage, harness.context)).rejects.toBe(fatalError)
    expect(harness.runBatch).toHaveBeenCalledTimes(1)
    expect(storeMocks.updatePipelineStepCompletedWithInput).not.toHaveBeenCalled()
  })

  it('stops after a Photoshop mutex timeout instead of waiting once per template', async () => {
    const timeoutError = new AppErrorClass(
      'PS_COM_FAILED',
      'Photoshop 无响应,请检查 PS 后重试',
      true,
      { kind: 'photoshop_mutex_timeout', timeout_ms: 600_000 },
    )
    const harness = createHarness(
      'top',
      ['C:\\templates\\shirt.psd', 'C:\\templates\\hoodie.psd'],
      async () => {
        throw timeoutError
      },
    )

    await expect(consumeStage(harness.stage, harness.context, sourceItems(1))).rejects.toBe(
      timeoutError,
    )
    expect(harness.runBatch).not.toHaveBeenCalled()
    expect(tempFileMocks.createTaskDir).toHaveBeenCalledTimes(1)
    expect(storeMocks.updatePipelineStepCompletedWithInput).not.toHaveBeenCalled()
  })

  it('uses between-group cancellation so the active Photoshop SKU can finish', async () => {
    const harness = createHarness()
    harness.runBatch.mockImplementationOnce(async (prints, _templates, config) => {
      const skuCode = prints[0]?.id ?? 'missing'
      expect(config.cancellationMode).toBe('between_groups')
      return batchResult([
        {
          template_id: 'template-1',
          template_name: 'shirt',
          group_index: 0,
          sku_folder: skuCode,
          print_ids: [skuCode],
          outputs: ['C:\\output\\shirt\\PRINT-0001\\01.jpg'],
          status: 'completed',
        },
      ])
    })

    await expect(
      consumeStage(harness.stage, harness.context, sourceItems(1)),
    ).resolves.toHaveLength(1)
  })

  it('keeps unstarted Photoshop groups pending for cancelled run finalization', async () => {
    const harness = createHarness('topmost')
    harness.runBatch.mockImplementationOnce(async (prints) => {
      const skuCode = prints[0]?.id ?? 'missing'
      return {
        ...batchResult([
          {
            template_id: 'template-1',
            template_name: 'shirt',
            group_index: 0,
            sku_folder: skuCode,
            print_ids: [skuCode],
            outputs: ['C:\\output\\shirt\\PRINT-0001\\01.jpg'],
            status: 'completed',
          },
        ]),
        ok: false,
        cancelled: true,
        groups_total: 2,
        groups_completed: 1,
      }
    })

    await expect(consumeStage(harness.stage, harness.context)).resolves.toHaveLength(1)
    const secondItemStatuses = harness.upsertPipelineItem.mock.calls
      .map(([input]) => input)
      .filter((input) => input.itemKey.startsWith('print-2:'))
      .map((input) => input.status)
    expect(secondItemStatuses).toEqual(['running'])
    expect(storeMocks.updatePipelineStepCompletedWithInput).not.toHaveBeenCalled()
    expect(harness.emitRunningProgress).not.toHaveBeenCalledWith(
      harness.context.runId,
      'PS 套版完成',
    )
    expect(tempFileMocks.cleanupTask).toHaveBeenCalledOnce()
  })

  it('does not start another template after a Photoshop batch reports cancellation', async () => {
    const harness = createHarness('topmost', [
      'C:\\templates\\shirt.psd',
      'C:\\templates\\hoodie.psd',
    ])
    harness.runBatch.mockImplementation(async (prints) => {
      const groups = prints.map((print, index) => ({
        template_id: 'template-1',
        template_name: 'shirt',
        group_index: index,
        sku_folder: print.id,
        print_ids: [print.id],
        outputs: [`C:\\output\\shirt\\${print.id}\\01.jpg`],
        status: 'completed' as const,
      }))
      if (harness.runBatch.mock.calls.length === 1) {
        return {
          ...batchResult(groups.slice(0, 1)),
          ok: false,
          cancelled: true,
          groups_total: prints.length,
          groups_completed: 1,
        }
      }
      return batchResult(groups)
    })

    await expect(consumeStage(harness.stage, harness.context)).resolves.toHaveLength(1)
    expect(harness.runBatch).toHaveBeenCalledTimes(1)
    expect(
      harness.upsertPipelineItem.mock.calls
        .map(([input]) => input.status)
        .filter((status) => status === 'failed'),
    ).toEqual([])
    expect(storeMocks.updatePipelineStepCompletedWithInput).not.toHaveBeenCalled()
  })

  it('stops before the next template when cancellation arrives after a completed batch', async () => {
    const harness = createHarness('topmost', [
      'C:\\templates\\shirt.psd',
      'C:\\templates\\hoodie.psd',
    ])
    let cancelled = false
    harness.context.isCancelled = () => cancelled
    harness.runBatch.mockImplementation(async (prints) => {
      const result = batchResult(
        prints.map((print, index) => ({
          template_id: 'template-1',
          template_name: 'shirt',
          group_index: index,
          sku_folder: print.id,
          print_ids: [print.id],
          outputs: [`C:\\output\\shirt\\${print.id}\\01.jpg`],
          status: 'completed' as const,
        })),
      )
      cancelled = true
      return result
    })

    await expect(consumeStage(harness.stage, harness.context)).resolves.toHaveLength(2)
    expect(harness.runBatch).toHaveBeenCalledTimes(1)
    expect(storeMocks.updatePipelineStepCompletedWithInput).not.toHaveBeenCalled()
  })

  it('keeps a missing group pending when late cancellation lacks a cancelled batch flag', async () => {
    const harness = createHarness('topmost')
    let cancelled = false
    harness.context.isCancelled = () => cancelled
    harness.runBatch.mockImplementationOnce(async (prints) => {
      const firstPrint = prints[0]
      if (!firstPrint) {
        throw new Error('missing first Photoshop print')
      }
      cancelled = true
      return batchResult([
        {
          template_id: 'template-1',
          template_name: 'shirt',
          group_index: 0,
          sku_folder: firstPrint.id,
          print_ids: [firstPrint.id],
          outputs: [`C:\\output\\shirt\\${firstPrint.id}\\01.jpg`],
          status: 'completed',
        },
      ])
    })

    await expect(consumeStage(harness.stage, harness.context)).resolves.toHaveLength(1)
    const secondItemStatuses = harness.upsertPipelineItem.mock.calls
      .map(([input]) => input)
      .filter((input) => input.itemKey.startsWith('print-2:'))
      .map((input) => input.status)
    expect(secondItemStatuses).toEqual(['running'])
    expect(storeMocks.updatePipelineStepCompletedWithInput).not.toHaveBeenCalled()
  })

  it('does not fail queued items when cancellation wins while waiting for the Photoshop mutex', async () => {
    const mutexEntered = createDeferred<void>()
    const releaseMutex = createDeferred<void>()
    const harness = createHarness('topmost', undefined, async () => {
      mutexEntered.resolve()
      await releaseMutex.promise
    })
    let cancelled = false
    harness.context.isCancelled = () => cancelled
    harness.assertNotCancelled.mockImplementation(() => {
      if (cancelled) {
        throw new AppErrorClass('HTTP_4XX', '完整任务已取消', false)
      }
    })

    const resultPromise = consumeStage(harness.stage, harness.context)
    await mutexEntered.promise
    cancelled = true
    releaseMutex.resolve()

    await expect(resultPromise).resolves.toEqual([])
    expect(harness.runBatch).not.toHaveBeenCalled()
    expect(
      harness.upsertPipelineItem.mock.calls
        .map(([input]) => input.status)
        .filter((status) => status === 'failed'),
    ).toEqual([])
    expect(storeMocks.updatePipelineStepCompletedWithInput).not.toHaveBeenCalled()
    expect(tempFileMocks.cleanupTask).toHaveBeenCalledOnce()
  })

  it('finishes immediately when cancelled before the Photoshop mutex callback starts', async () => {
    const mutexEntered = createDeferred<void>()
    const mutexWait = createDeferred<void>()
    const harness = createHarness('topmost', undefined, async () => {
      mutexEntered.resolve()
      await mutexWait.promise
    })
    let cancelled = false
    harness.context.isCancelled = () => cancelled

    const resultPromise = consumeStage(harness.stage, harness.context)
    await mutexEntered.promise
    const cancel = harness.setCurrentCancel.mock.calls.at(-1)?.[0]
    expect(cancel).toBeTypeOf('function')

    cancelled = true
    await cancel?.()

    const outcome = await Promise.race([
      resultPromise.then((value) => ({ status: 'resolved' as const, value })),
      new Promise<{ status: 'timed-out' }>((resolve) => {
        setTimeout(() => resolve({ status: 'timed-out' }), 100)
      }),
    ])
    expect(outcome).toEqual({ status: 'resolved', value: [] })

    mutexWait.reject(new Error('Photoshop mutex wait timed out'))
    await new Promise<void>((resolve) => setImmediate(resolve))

    expect(harness.runBatch).not.toHaveBeenCalled()
    expect(
      harness.upsertPipelineItem.mock.calls
        .map(([input]) => input.status)
        .filter((status) => status === 'failed'),
    ).toEqual([])
    expect(storeMocks.updatePipelineStepCompletedWithInput).not.toHaveBeenCalled()
    expect(tempFileMocks.cleanupTask).toHaveBeenCalledOnce()
  })

  it('finishes immediately when cancellation predates the Photoshop mutex handler', async () => {
    const createTaskDirEntered = createDeferred<void>()
    const taskDir = createDeferred<string>()
    tempFileMocks.createTaskDir.mockImplementationOnce(async () => {
      createTaskDirEntered.resolve()
      return taskDir.promise
    })
    const mutexWait = createDeferred<void>()
    const beforeMutexOperation = vi.fn(async () => {
      await mutexWait.promise
    })
    const harness = createHarness('topmost', undefined, beforeMutexOperation)
    let cancelled = false
    harness.context.isCancelled = () => cancelled
    harness.assertNotCancelled.mockImplementation(() => {
      if (cancelled) {
        throw new AppErrorClass('HTTP_4XX', '完整任务已取消', false)
      }
    })

    const resultPromise = consumeStage(harness.stage, harness.context, sourceItems(1))
    await createTaskDirEntered.promise
    expect(harness.setCurrentCancel).not.toHaveBeenCalled()

    cancelled = true
    taskDir.resolve('C:\\temp\\photoshop-task')

    const outcome = await Promise.race([
      resultPromise.then((value) => ({ status: 'resolved' as const, value })),
      new Promise<{ status: 'timed-out' }>((resolve) => {
        setTimeout(() => resolve({ status: 'timed-out' }), 100)
      }),
    ])
    mutexWait.resolve()
    await resultPromise

    expect(outcome).toEqual({ status: 'resolved', value: [] })
    expect(beforeMutexOperation).not.toHaveBeenCalled()
    expect(harness.runBatch).not.toHaveBeenCalled()
    expect(
      harness.upsertPipelineItem.mock.calls
        .map(([input]) => input.status)
        .filter((status) => status === 'failed'),
    ).toEqual([])
    expect(storeMocks.updatePipelineStepCompletedWithInput).not.toHaveBeenCalled()
    expect(tempFileMocks.cleanupTask).toHaveBeenCalledOnce()
  })

  it('stops after the first waiting-folder EACCES failure', async () => {
    const harness = createHarness()
    const permissionError = Object.assign(new Error('permission denied'), {
      code: 'EACCES',
      path: 'C:\\workbench\\02-印花工作区\\等待套版',
      syscall: 'mkdir',
    })
    fsMocks.mkdir.mockRejectedValue(permissionError)

    await expect(consumeStage(harness.stage, harness.context)).rejects.toBe(permissionError)
    expect(fsMocks.mkdir).toHaveBeenCalledTimes(1)
    expect(harness.runBatch).not.toHaveBeenCalled()
    expect(storeMocks.updatePipelineStepCompletedWithInput).not.toHaveBeenCalled()
  })

  it('treats an unscoped JSX batch failure as fatal', async () => {
    const harness = createHarness()
    const fatalError = new AppErrorClass(
      'JSX_EXEC_FAILED',
      'Photoshop template batch failed',
      false,
      { template_path: 'C:\\templates\\shirt.psd' },
    )
    harness.runBatch.mockRejectedValue(fatalError)

    await expect(consumeStage(harness.stage, harness.context)).rejects.toBe(fatalError)
    expect(harness.runBatch).toHaveBeenCalledTimes(1)
  })

  it('keeps an explicitly item-scoped JSX failure isolated', async () => {
    const harness = createHarness()
    harness.runBatch
      .mockRejectedValueOnce(
        new AppErrorClass('JSX_EXEC_FAILED', 'First SKU failed', false, { group_index: 0 }),
      )
      .mockImplementationOnce(async (prints) => {
        const skuCode = prints[0]?.id ?? 'missing'
        return batchResult([
          {
            template_id: 'template-1',
            template_name: 'shirt',
            group_index: 0,
            sku_folder: skuCode,
            print_ids: [skuCode],
            outputs: ['C:\\output\\shirt\\PRINT-0002\\01.jpg'],
            status: 'completed',
          },
        ])
      })

    await expect(consumeStage(harness.stage, harness.context)).resolves.toHaveLength(1)
    expect(harness.runBatch).toHaveBeenCalledTimes(2)
    expect(storeMocks.updatePipelineStepCompletedWithInput).toHaveBeenCalledOnce()
  })

  it('keeps a structured SKU error isolated and preserves its message', async () => {
    const harness = createHarness()
    harness.runBatch.mockImplementationOnce(async (prints) => {
      const skuCode = prints[0]?.id ?? 'missing'
      return batchResult([
        {
          template_id: 'template-1',
          template_name: 'shirt',
          group_index: 0,
          sku_folder: skuCode,
          print_ids: [skuCode],
          outputs: [],
          status: 'failed',
          error: 'Smart object replacement failed for this SKU',
        },
      ])
    })

    await expect(consumeStage(harness.stage, harness.context, sourceItems(1))).resolves.toEqual([])
    expect(harness.upsertPipelineItem).toHaveBeenLastCalledWith(
      expect.objectContaining({
        status: 'failed',
        errorMessage: 'Smart object replacement failed for this SKU',
      }),
    )
    expect(storeMocks.updatePipelineStepCompletedWithInput).toHaveBeenCalledOnce()
  })

  it('keeps a genuinely missing SKU result isolated', async () => {
    const harness = createHarness()
    harness.runBatch.mockResolvedValue(batchResult([]))

    await expect(consumeStage(harness.stage, harness.context, sourceItems(1))).resolves.toEqual([])
    expect(harness.upsertPipelineItem).toHaveBeenLastCalledWith(
      expect.objectContaining({
        status: 'failed',
        errorMessage: 'PS 套版未返回输出结果',
      }),
    )
    expect(storeMocks.updatePipelineStepCompletedWithInput).toHaveBeenCalledOnce()
  })
})
