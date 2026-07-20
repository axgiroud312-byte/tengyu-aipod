import { basename, dirname, join } from 'node:path'
import {
  AppErrorClass,
  type PipelineRunStats,
  type PipelineRuntimeLogEntry,
  WORKBENCH_DIRECTORIES,
} from '@tengyu-aipod/shared'
import type {
  PipelinePrintStageFactory,
  PipelinePrintStreamItem,
  PipelineStageRuntimeContext,
} from '../pipeline-stage-types'
import * as pipelineStore from '../pipeline/store'
import type { SqliteDatabase } from '../sqlite'
import {
  type TitleProcessingSession,
  appErrorMessage,
  assignTitleKeywordGroups,
  joinTitleWithKeywordGroup,
  normalizeTitleKeywordGroups,
  readExistingTitles,
  registerSkuTitles,
  resolveTitleXlsxPath,
  scanSkuFolders,
  titleService,
  toXlsxWriteError,
  writeTitlesXlsx,
} from '../title-service'
import { isPathInsideWorkbench } from '../workbench-path-guard'
import {
  type PendingTitleWriteRecord,
  listPendingTitleWrites,
  pendingTitleBatchName,
  pendingTitleMap,
  pendingTitleXlsxPathKey,
  removePendingTitleWrite,
  savePendingTitleWrite,
} from './title-pending-writes'

type TitleStageDependencies = {
  db: Pick<SqliteDatabase, 'exec' | 'prepare'>
  workbenchRoot: string
  stats: PipelineRunStats
  upsertPipelineItem: (input: {
    runId: string
    itemKey: string
    stepKey: 'title'
    status: 'running' | 'completed' | 'failed' | 'skipped'
    sourcePath?: string | undefined
    outputPath?: string | undefined
    artifactId?: string | undefined
    printId?: string | undefined
    sourceArtifactIds?: string[] | undefined
    errorMessage?: string | undefined
    completed?: boolean | undefined
  }) => void
  appendLog: (runId: string, input: Omit<PipelineRuntimeLogEntry, 'id' | 'created_at'>) => void
  emitRunningProgress: (runId: string, message: string) => void
  setCurrentCancel: (cancel: (() => void | Promise<void>) | null) => void
  assertNotCancelled: () => void
}

type BatchState = {
  batchDir: string
  xlsxPath: string
  existingTitles: Map<string, string>
  deferredTitles: Map<string, string>
  absorbedPendingWrites: PendingTitleWriteRecord[]
  skuCodes: Set<string>
  generatedBaseTitles: Map<string, string>
  lastFlushedTitles: Map<string, string>
  registeredTitles: Map<string, string>
  pendingFlush: boolean
  warnedLocked: boolean
}

type PendingTitleItem = {
  item: PipelinePrintStreamItem
  batchState: BatchState
}

const TITLE_FLUSH_BATCH_SIZE = 20

function insertRunningStep(
  db: Pick<SqliteDatabase, 'prepare'>,
  runId: string,
  inputCount: number,
  outputCount: number,
) {
  pipelineStore.upsertPipelineStepRunning(db, {
    runId,
    stepKey: 'title',
    module: 'title',
    label: '标题生成',
    inputCount,
    outputCount,
  })
}

function batchDirFromProductImage(path: string) {
  return dirname(dirname(path))
}

function skuCodeFromProductImage(path: string) {
  return basename(dirname(path))
}

function localErrorCode(error: unknown) {
  if (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    typeof error.code === 'string'
  ) {
    return error.code
  }
  return null
}

export function createTitleStage(dependencies: TitleStageDependencies): PipelinePrintStageFactory {
  return (context: PipelineStageRuntimeContext) => {
    const config = context.config.title
    if (context.config.photoshop.enabled === false || config.enabled === false) {
      throw new AppErrorClass('HTTP_5XX', '未启用标题生成却创建了 Title stage', true)
    }

    const keywordGroups = normalizeTitleKeywordGroups(config.keywordGroups)
    const batchStates = new Map<string, BatchState>()
    const deferredPendingWritesByXlsxPath = new Map<string, PendingTitleWriteRecord[]>()

    const getBatchState = async (batchDir: string) => {
      const existing = batchStates.get(batchDir)
      if (existing) {
        return existing
      }
      const xlsxPath = await resolveTitleXlsxPath(batchDir, config.titleFileName)
      const absorbedPendingWrites = [
        ...(deferredPendingWritesByXlsxPath.get(pendingTitleXlsxPathKey(xlsxPath)) ?? []),
      ]
      const deferredTitles = new Map<string, string>()
      for (const pending of absorbedPendingWrites) {
        for (const [skuCode, title] of pendingTitleMap(pending)) {
          deferredTitles.set(skuCode, title)
        }
      }
      const skuCodes = new Set<string>()
      try {
        for (const folder of await scanSkuFolders(batchDir)) {
          skuCodes.add(folder.skuCode)
        }
      } catch (error) {
        if (
          !(
            typeof error === 'object' &&
            error !== null &&
            'code' in error &&
            error.code === 'ENOENT'
          )
        ) {
          throw error
        }
      }
      const state: BatchState = {
        batchDir,
        xlsxPath,
        existingTitles: await readExistingTitles(xlsxPath),
        deferredTitles,
        absorbedPendingWrites,
        skuCodes,
        generatedBaseTitles: new Map(),
        lastFlushedTitles: new Map(),
        registeredTitles: new Map(),
        pendingFlush: false,
        warnedLocked: false,
      }
      batchStates.set(batchDir, state)
      return state
    }

    const buildGeneratedTitles = async (state: BatchState) => {
      const assignments = assignTitleKeywordGroups(Array.from(state.skuCodes), keywordGroups)
      const generatedTitles = new Map(state.deferredTitles)
      for (const [skuCode, baseTitle] of state.generatedBaseTitles) {
        generatedTitles.set(
          skuCode,
          joinTitleWithKeywordGroup(
            baseTitle,
            assignments.get(skuCode),
            config.keywordGroupSeparator,
          ),
        )
      }
      return generatedTitles
    }

    const titlePersistenceError = (
      state: Pick<BatchState, 'batchDir' | 'xlsxPath'>,
      message: string,
      error: unknown,
    ) => {
      const filesystemCode = localErrorCode(error)
      return new AppErrorClass(
        error instanceof AppErrorClass
          ? error.code
          : filesystemCode
            ? 'WORKSPACE_IO_FAILED'
            : 'HTTP_5XX',
        message,
        error instanceof AppErrorClass ? error.retryable : !filesystemCode,
        {
          kind: 'title_persistence_fatal',
          batchDir: state.batchDir,
          xlsxPath: state.xlsxPath,
          cause: appErrorMessage(error),
          ...(filesystemCode ? { filesystemCode } : {}),
        },
        error,
      )
    }

    const persistPendingTitles = async (
      state: BatchState,
      generatedTitles: Map<string, string>,
      session: TitleProcessingSession,
    ) => {
      if (generatedTitles.size === 0) {
        return
      }
      try {
        await savePendingTitleWrite(dependencies.db, {
          runId: context.runId,
          batchDir: state.batchDir,
          xlsxPath: state.xlsxPath,
          titles: Object.fromEntries(generatedTitles),
          language: config.language,
          platform: config.platform,
          model: session.model,
          skill: {
            id: session.skill.id,
            version: session.skill.version,
          },
          generatedAt: Date.now(),
        })
      } catch (error) {
        throw titlePersistenceError(
          state,
          '标题暂存写入失败，已停止标题阶段以避免生成结果丢失',
          error,
        )
      }
    }

    const registerGeneratedTitles = async (
      state: BatchState,
      generatedTitles: Map<string, string>,
      session: TitleProcessingSession,
    ) => {
      if (generatedTitles.size === 0 || process.env.TENGYU_SKIP_TITLE_DB_REGISTER === '1') {
        return
      }
      const changedTitles = new Map(
        Array.from(generatedTitles.entries()).filter(
          ([skuCode, title]) => state.registeredTitles.get(skuCode) !== title,
        ),
      )
      if (changedTitles.size === 0) {
        return
      }
      const generatedAt = Date.now()
      registerSkuTitles(dependencies.db, {
        templateBatch: basename(state.batchDir),
        titles: changedTitles,
        language: config.language,
        platform: config.platform,
        skill: session.skill,
        model: session.model,
        generatedAt,
      })
      for (const [skuCode, title] of changedTitles) {
        state.registeredTitles.set(skuCode, title)
      }
    }

    const flushBatchState = async (
      state: BatchState,
      reason: 'batch' | 'final',
      session: TitleProcessingSession,
    ): Promise<boolean> => {
      const generatedTitles = await buildGeneratedTitles(state)
      try {
        await writeTitlesXlsx(
          state.xlsxPath,
          generatedTitles,
          state.existingTitles,
          dependencies.workbenchRoot,
        )
        await registerGeneratedTitles(state, generatedTitles, session)
        for (const pending of state.absorbedPendingWrites) {
          await removePendingTitleWrite(dependencies.db, pending)
        }
        state.absorbedPendingWrites = []
        state.lastFlushedTitles = new Map(generatedTitles)
        state.pendingFlush = false
        state.warnedLocked = false
        await removePendingTitleWrite(dependencies.db, {
          runId: context.runId,
          batchDir: state.batchDir,
        }).catch((error) => {
          dependencies.appendLog(context.runId, {
            level: 'warn',
            step_key: 'title',
            message: '标题已写入，但待补写记录清理失败',
            details: {
              batchDir: state.batchDir,
              error: appErrorMessage(error),
            },
          })
        })
        if (reason === 'final') {
          await session.appendDiagnosticLog({
            type: 'decision',
            operation: 'flush_titles_xlsx',
            data: {
              batchDir: state.batchDir,
              xlsxPath: state.xlsxPath,
              generatedCount: generatedTitles.size,
              reason,
            },
          })
        }
      } catch (error) {
        const mapped = toXlsxWriteError(error)
        if (mapped instanceof AppErrorClass && mapped.code === 'XLSX_LOCKED') {
          state.pendingFlush = true
          await persistPendingTitles(state, generatedTitles, session)
          if (!state.warnedLocked) {
            state.warnedLocked = true
            dependencies.appendLog(context.runId, {
              level: 'warn',
              step_key: 'title',
              message: '标题文件被占用，已暂存待补写',
              details: {
                batchDir: state.batchDir,
                xlsxPath: state.xlsxPath,
                pendingCount: state.generatedBaseTitles.size,
              },
            })
          }
          await session.appendDiagnosticLog({
            type: 'decision',
            operation: 'defer_xlsx_write',
            data: {
              batchDir: state.batchDir,
              xlsxPath: state.xlsxPath,
              generatedCount: generatedTitles.size,
              reason,
            },
          })
          return false
        }
        await persistPendingTitles(state, generatedTitles, session)
        throw titlePersistenceError(state, '标题文件写入失败，已保留暂存结果', mapped)
      }
      return true
    }

    const retryPendingWrites = async () => {
      const pendingWrites = await listPendingTitleWrites(dependencies.db)
      for (const pending of pendingWrites) {
        if (
          !(await isPathInsideWorkbench(dependencies.workbenchRoot, pending.xlsxPath, 'listing'))
        ) {
          dependencies.appendLog(context.runId, {
            level: 'warn',
            step_key: 'title',
            message: '待补写标题路径不在工作区，已保留暂存记录',
            details: { batchDir: pending.batchDir, xlsxPath: pending.xlsxPath },
          })
          continue
        }

        try {
          const titles = pendingTitleMap(pending)
          const existingTitles = await readExistingTitles(pending.xlsxPath)
          await writeTitlesXlsx(
            pending.xlsxPath,
            titles,
            existingTitles,
            dependencies.workbenchRoot,
          )
          if (process.env.TENGYU_SKIP_TITLE_DB_REGISTER !== '1') {
            registerSkuTitles(dependencies.db, {
              templateBatch: pendingTitleBatchName(pending),
              titles,
              language: pending.language,
              platform: pending.platform,
              skill: pending.skill,
              model: pending.model,
              generatedAt: pending.generatedAt,
            })
          }
          await removePendingTitleWrite(dependencies.db, pending)
          dependencies.appendLog(context.runId, {
            level: 'info',
            step_key: 'title',
            message: '标题待补写已完成',
            details: {
              batchDir: pending.batchDir,
              xlsxPath: pending.xlsxPath,
              recoveredCount: titles.size,
            },
          })
        } catch (error) {
          const mapped = toXlsxWriteError(error)
          if (!(mapped instanceof AppErrorClass && mapped.code === 'XLSX_LOCKED')) {
            throw titlePersistenceError(pending, '标题待补写失败，已保留暂存结果', mapped)
          }
          const xlsxPathKey = pendingTitleXlsxPathKey(pending.xlsxPath)
          const deferredPendingWrites = deferredPendingWritesByXlsxPath.get(xlsxPathKey) ?? []
          deferredPendingWrites.push(pending)
          deferredPendingWritesByXlsxPath.set(xlsxPathKey, deferredPendingWrites)
          dependencies.appendLog(context.runId, {
            level: 'warn',
            step_key: 'title',
            message: '标题待补写仍未完成，已保留暂存记录',
            details: {
              batchDir: pending.batchDir,
              xlsxPath: pending.xlsxPath,
              error: appErrorMessage(mapped),
            },
          })
        }
      }
    }

    return async function* titleStage(input: AsyncIterable<PipelinePrintStreamItem>) {
      const sessionState: { current: TitleProcessingSession | null } = { current: null }
      const ensureSession = async () => {
        if (!sessionState.current) {
          sessionState.current = await titleService.createProcessingSession({
            ...config,
            batchDir:
              context.config.photoshop.outputRoot ??
              join(dependencies.workbenchRoot, WORKBENCH_DIRECTORIES.listing),
            taskId: `${context.runId}-title-stream`,
          })
        }
        return sessionState.current
      }

      let queued = 0
      let completed = 0
      let failed = 0
      let skipped = 0
      let keepFailedTemp = false
      const pendingTitleItems: PendingTitleItem[] = []

      const completePendingItemsForState = function* (state: BatchState) {
        for (let index = 0; index < pendingTitleItems.length; ) {
          const pending = pendingTitleItems[index]
          if (!pending) {
            break
          }
          if (pending.batchState !== state) {
            index += 1
            continue
          }
          pendingTitleItems.splice(index, 1)
          completed += 1
          dependencies.stats.titleSucceeded = completed
          dependencies.upsertPipelineItem({
            runId: context.runId,
            itemKey: pending.item.itemKey,
            stepKey: 'title',
            status: 'completed',
            sourcePath: pending.item.path,
            outputPath: state.xlsxPath,
            artifactId: pending.item.artifactId,
            printId: pending.item.printId,
            sourceArtifactIds: pending.item.sourceArtifactIds,
            completed: true,
          })
          pipelineStore.updatePipelineStepOutputCount(dependencies.db, {
            runId: context.runId,
            stepKey: 'title',
            outputCount: completed + skipped,
          })
          dependencies.emitRunningProgress(context.runId, '标题流处理中')
          yield pending.item
        }
      }

      const failPendingItemsForState = (state: BatchState, error: unknown) => {
        for (let index = 0; index < pendingTitleItems.length; ) {
          const pending = pendingTitleItems[index]
          if (!pending) {
            break
          }
          if (pending.batchState !== state) {
            index += 1
            continue
          }
          pendingTitleItems.splice(index, 1)
          failed += 1
          keepFailedTemp = true
          dependencies.stats.titleFailed = failed
          dependencies.upsertPipelineItem({
            runId: context.runId,
            itemKey: pending.item.itemKey,
            stepKey: 'title',
            status: 'failed',
            sourcePath: pending.item.path,
            outputPath: state.xlsxPath,
            artifactId: pending.item.artifactId,
            printId: pending.item.printId,
            sourceArtifactIds: pending.item.sourceArtifactIds,
            errorMessage: appErrorMessage(error),
            completed: true,
          })
        }
      }

      const pendingCountForState = (state: BatchState) =>
        pendingTitleItems.filter((pending) => pending.batchState === state).length

      const hasUnflushedChanges = async (state: BatchState) => {
        const generatedTitles = await buildGeneratedTitles(state)
        if (generatedTitles.size !== state.lastFlushedTitles.size) {
          return true
        }
        return Array.from(generatedTitles.entries()).some(
          ([skuCode, title]) => state.lastFlushedTitles.get(skuCode) !== title,
        )
      }

      insertRunningStep(dependencies.db, context.runId, 0, 0)
      dependencies.appendLog(context.runId, {
        level: 'info',
        step_key: 'title',
        message: '标题生成配置',
        details: {
          platform: config.platform,
          language: config.language,
          model: config.model,
          imageIndex: config.imageIndex ?? 1,
          titleFileName: config.titleFileName ?? '标题',
          existingStrategy: config.existingStrategy ?? 'skip',
        },
      })
      await retryPendingWrites()

      let streamFailed = false
      let streamError: unknown
      try {
        try {
          for await (const item of input) {
            dependencies.assertNotCancelled()
            queued += 1
            insertRunningStep(dependencies.db, context.runId, queued, completed + skipped)
            dependencies.emitRunningProgress(context.runId, '标题流处理中')

            const batchDir = batchDirFromProductImage(item.path)
            const skuCode = skuCodeFromProductImage(item.path)
            const batchState = await getBatchState(batchDir)
            batchState.skuCodes.add(skuCode)

            dependencies.upsertPipelineItem({
              runId: context.runId,
              itemKey: item.itemKey,
              stepKey: 'title',
              status: 'running',
              sourcePath: item.path,
              artifactId: item.artifactId,
              printId: item.printId,
              sourceArtifactIds: item.sourceArtifactIds,
            })

            try {
              if (
                (config.existingStrategy ?? 'skip') === 'skip' &&
                batchState.existingTitles.has(skuCode)
              ) {
                skipped += 1
                dependencies.upsertPipelineItem({
                  runId: context.runId,
                  itemKey: item.itemKey,
                  stepKey: 'title',
                  status: 'skipped',
                  sourcePath: item.path,
                  outputPath: batchState.xlsxPath,
                  artifactId: item.artifactId,
                  printId: item.printId,
                  sourceArtifactIds: item.sourceArtifactIds,
                  completed: true,
                })
                pipelineStore.updatePipelineStepOutputCount(dependencies.db, {
                  runId: context.runId,
                  stepKey: 'title',
                  outputCount: completed + skipped,
                })
                yield item
                continue
              }

              const activeSession = await ensureSession()
              dependencies.setCurrentCancel(() => {
                titleService.cancelTask(activeSession.taskId)
              })
              const result = await activeSession.generateSku({
                skuCode,
                skuFolder: dirname(item.path),
              })
              dependencies.setCurrentCancel(null)

              if (result.status === 'failed') {
                if (result.fatal) {
                  throw new AppErrorClass(
                    result.appErrorCode ?? 'HTTP_4XX',
                    result.error,
                    result.retryable ?? false,
                    {
                      ...result.errorDetails,
                      kind: 'title_provider_fatal',
                    },
                  )
                }
                throw new AppErrorClass('HTTP_4XX', result.error, false)
              }

              batchState.generatedBaseTitles.set(skuCode, result.baseTitle)
              try {
                await persistPendingTitles(
                  batchState,
                  await buildGeneratedTitles(batchState),
                  activeSession,
                )
              } catch (error) {
                batchState.generatedBaseTitles.delete(skuCode)
                throw error
              }
              pendingTitleItems.push({ item, batchState })
              const pendingCount = pendingCountForState(batchState)
              if (
                pendingCount < TITLE_FLUSH_BATCH_SIZE ||
                pendingCount % TITLE_FLUSH_BATCH_SIZE !== 0
              ) {
                continue
              }

              const flushed = await flushBatchState(batchState, 'batch', activeSession)
              if (!flushed) {
                continue
              }

              yield* completePendingItemsForState(batchState)
            } catch (error) {
              dependencies.setCurrentCancel(null)
              if (
                !sessionState.current ||
                (error instanceof AppErrorClass &&
                  (error.details?.kind === 'title_provider_fatal' ||
                    error.details?.kind === 'title_persistence_fatal'))
              ) {
                throw error
              }
              failed += 1
              keepFailedTemp = true
              dependencies.stats.titleFailed = failed
              dependencies.upsertPipelineItem({
                runId: context.runId,
                itemKey: item.itemKey,
                stepKey: 'title',
                status: 'failed',
                sourcePath: item.path,
                outputPath: batchState.xlsxPath,
                artifactId: item.artifactId,
                printId: item.printId,
                sourceArtifactIds: item.sourceArtifactIds,
                errorMessage: appErrorMessage(error),
                completed: true,
              })
              dependencies.appendLog(context.runId, {
                level: 'warn',
                step_key: 'title',
                message: '单货号标题生成失败，已跳过',
                details: {
                  itemKey: item.itemKey,
                  skuCode,
                  batchDir,
                  error: appErrorMessage(error),
                },
              })
            }
          }
        } catch (error) {
          streamFailed = true
          streamError = error
        }

        for (const state of batchStates.values()) {
          const hasPendingItems = pendingTitleItems.some((pending) => pending.batchState === state)
          if (hasPendingItems) {
            try {
              if (!sessionState.current) {
                throw new AppErrorClass('HTTP_5XX', '标题会话未初始化，无法写入生成结果', true)
              }
              await flushBatchState(state, 'final', sessionState.current)
              yield* completePendingItemsForState(state)
            } catch (error) {
              failPendingItemsForState(state, error)
              pipelineStore.updatePipelineStepFailed(dependencies.db, {
                runId: context.runId,
                stepKey: 'title',
                status: 'failed',
                errorJson: { message: appErrorMessage(error) },
              })
              dependencies.appendLog(context.runId, {
                level: 'warn',
                step_key: 'title',
                message: '标题补写失败，已保留已生成结果',
                details: {
                  batchDir: state.batchDir,
                  error: appErrorMessage(error),
                },
              })
              throw error
            }
            continue
          }

          if (state.generatedBaseTitles.size > 0 && (await hasUnflushedChanges(state))) {
            if (!sessionState.current) {
              throw new AppErrorClass('HTTP_5XX', '标题会话未初始化，无法补写生成结果', true)
            }
            await flushBatchState(state, 'final', sessionState.current).catch((error) => {
              dependencies.appendLog(context.runId, {
                level: 'warn',
                step_key: 'title',
                message: '标题补写失败，已保留已生成结果',
                details: {
                  batchDir: state.batchDir,
                  error: appErrorMessage(error),
                },
              })
            })
          }
        }

        if (streamFailed) {
          throw streamError
        }

        pipelineStore.updatePipelineStepCompletedWithInput(dependencies.db, {
          runId: context.runId,
          stepKey: 'title',
          inputCount: queued,
          outputCount: completed + skipped,
          outputJson: {
            succeeded: completed,
            failed,
            skipped,
            pendingFlushBatches: Array.from(batchStates.values()).filter(
              (state) => state.pendingFlush,
            ).length,
          },
        })
      } finally {
        if (sessionState.current) {
          await sessionState.current.close({ keepFailedTemp: keepFailedTemp || failed > 0 })
        }
      }
    }
  }
}
