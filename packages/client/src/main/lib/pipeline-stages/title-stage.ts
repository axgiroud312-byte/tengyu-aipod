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
  appErrorMessage,
  assignTitleKeywordGroups,
  joinTitleWithKeywordGroup,
  normalizeTitleKeywordGroups,
  readExistingTitles,
  registerSkuTitle,
  resolveTitleXlsxPath,
  scanSkuFolders,
  titleService,
  toXlsxWriteError,
  writeTitlesXlsx,
} from '../title-service'

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
  generatedBaseTitles: Map<string, string>
  pendingFlush: boolean
  warnedLocked: boolean
}

type PendingTitleItem = {
  item: PipelinePrintStreamItem
  batchState: BatchState
}

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

export function createTitleStage(dependencies: TitleStageDependencies): PipelinePrintStageFactory {
  return (context: PipelineStageRuntimeContext) => {
    const config = context.config.title
    if (context.config.photoshop.enabled === false || config.enabled === false) {
      throw new AppErrorClass('HTTP_5XX', '未启用标题生成却创建了 Title stage', true)
    }

    const keywordGroups = normalizeTitleKeywordGroups(config.keywordGroups)
    const batchStates = new Map<string, BatchState>()

    const getBatchState = async (batchDir: string) => {
      const existing = batchStates.get(batchDir)
      if (existing) {
        return existing
      }
      const xlsxPath = await resolveTitleXlsxPath(batchDir, config.titleFileName)
      const state: BatchState = {
        batchDir,
        xlsxPath,
        existingTitles: await readExistingTitles(xlsxPath),
        generatedBaseTitles: new Map(),
        pendingFlush: false,
        warnedLocked: false,
      }
      batchStates.set(batchDir, state)
      return state
    }

    const buildGeneratedTitles = async (state: BatchState) => {
      const skuFolders = await scanSkuFolders(state.batchDir)
      const assignments = assignTitleKeywordGroups(
        skuFolders.map((folder) => folder.skuCode),
        keywordGroups,
      )
      const generatedTitles = new Map<string, string>()
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

    const registerGeneratedTitles = async (
      state: BatchState,
      generatedTitles: Map<string, string>,
    ) => {
      if (generatedTitles.size === 0 || process.env.TENGYU_SKIP_TITLE_DB_REGISTER === '1') {
        return
      }
      const generatedAt = Date.now()
      for (const [skuCode, title] of generatedTitles) {
        await registerSkuTitle(dependencies.db, {
          batchDir: state.batchDir,
          skuCode,
          title,
          language: config.language,
          platform: config.platform,
          skill: session.skill,
          model: session.model,
          generatedAt,
        })
      }
    }

    const flushBatchState = async (
      state: BatchState,
      reason: 'item' | 'final',
      session: Awaited<ReturnType<typeof titleService.createProcessingSession>>,
    ): Promise<boolean> => {
      const generatedTitles = await buildGeneratedTitles(state)
      try {
        await writeTitlesXlsx(state.xlsxPath, generatedTitles, state.existingTitles)
        await registerGeneratedTitles(state, generatedTitles)
        state.pendingFlush = false
        state.warnedLocked = false
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
          if (reason === 'final') {
            throw mapped
          }
          return false
        }
        throw mapped
      }
      return true
    }

    let session: Awaited<ReturnType<typeof titleService.createProcessingSession>>

    return async function* titleStage(input: AsyncIterable<PipelinePrintStreamItem>) {
      session = await titleService.createProcessingSession({
        ...config,
        batchDir:
          context.config.photoshop.outputRoot ??
          join(dependencies.workbenchRoot, WORKBENCH_DIRECTORIES.listing),
        taskId: `${context.runId}-title-stream`,
      })

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

      try {
        for await (const item of input) {
          dependencies.assertNotCancelled()
          queued += 1
          insertRunningStep(dependencies.db, context.runId, queued, completed + skipped)
          dependencies.emitRunningProgress(context.runId, '标题流处理中')

          const batchDir = batchDirFromProductImage(item.path)
          const skuCode = skuCodeFromProductImage(item.path)
          const batchState = await getBatchState(batchDir)

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

            dependencies.setCurrentCancel(() => {
              titleService.cancelTask(session.taskId)
            })
            const result = await session.generateSku({
              skuCode,
              skuFolder: dirname(item.path),
            })
            dependencies.setCurrentCancel(null)

            if (result.status === 'failed') {
              throw new AppErrorClass('HTTP_4XX', result.error, false)
            }

            batchState.generatedBaseTitles.set(skuCode, result.baseTitle)
            pendingTitleItems.push({ item, batchState })
            try {
              const flushed = await flushBatchState(batchState, 'item', session)
              if (!flushed) {
                continue
              }
            } catch (error) {
              batchState.generatedBaseTitles.delete(skuCode)
              const pendingIndex = pendingTitleItems.findIndex(
                (pending) =>
                  pending.item.itemKey === item.itemKey && pending.batchState === batchState,
              )
              if (pendingIndex !== -1) {
                pendingTitleItems.splice(pendingIndex, 1)
              }
              throw error
            }

            yield* completePendingItemsForState(batchState)
          } catch (error) {
            failed += 1
            keepFailedTemp = true
            dependencies.stats.titleFailed = failed
            dependencies.setCurrentCancel(null)
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

        for (const state of batchStates.values()) {
          const hasPendingItems = pendingTitleItems.some((pending) => pending.batchState === state)
          if (hasPendingItems) {
            try {
              await flushBatchState(state, 'final', session)
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

          if (state.generatedBaseTitles.size > 0) {
            await flushBatchState(state, 'final', session).catch((error) => {
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
        await session.close({ keepFailedTemp: keepFailedTemp || failed > 0 })
      }
    }
  }
}
