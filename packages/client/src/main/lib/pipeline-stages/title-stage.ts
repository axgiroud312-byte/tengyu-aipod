import { basename, dirname } from 'node:path'
import {
  AppErrorClass,
  type PipelineRunStats,
  type PipelineRuntimeLogEntry,
} from '@tengyu-aipod/shared'
import type {
  PipelinePrintStageFactory,
  PipelinePrintStreamItem,
  PipelineStageRuntimeContext,
} from '../pipeline-stage-types'
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

function insertRunningStep(
  db: Pick<SqliteDatabase, 'prepare'>,
  runId: string,
  inputCount: number,
  outputCount: number,
) {
  db.prepare(
    `
      INSERT INTO pipeline_steps (
        id, run_id, step_key, module, label, status, input_count, output_count, output_json,
        error_json, started_at, completed_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?, NULL, ?)
      ON CONFLICT(run_id, step_key) DO UPDATE SET
        status = excluded.status,
        input_count = excluded.input_count,
        output_count = excluded.output_count,
        output_json = NULL,
        error_json = NULL,
        started_at = excluded.started_at,
        completed_at = NULL,
        updated_at = excluded.updated_at
    `,
  ).run(
    `${runId}:title`,
    runId,
    'title',
    'title',
    '标题生成',
    'running',
    inputCount,
    outputCount,
    Date.now(),
    Date.now(),
  )
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
    ) => {
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
          return
        }
        throw mapped
      }
    }

    let session: Awaited<ReturnType<typeof titleService.createProcessingSession>>

    return async function* titleStage(input: AsyncIterable<PipelinePrintStreamItem>) {
      session = await titleService.createProcessingSession({
        ...config,
        batchDir: context.config.photoshop.outputRoot ?? '',
        taskId: `${context.runId}-title-stream`,
      })

      let queued = 0
      let completed = 0
      let failed = 0
      let skipped = 0
      let keepFailedTemp = false

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
              dependencies.db
                .prepare(
                  `
                    UPDATE pipeline_steps
                    SET output_count = ?, updated_at = ?
                    WHERE run_id = ? AND step_key = 'title'
                  `,
                )
                .run(completed + skipped, Date.now(), context.runId)
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
            try {
              await flushBatchState(batchState, 'item', session)
            } catch (error) {
              batchState.generatedBaseTitles.delete(skuCode)
              throw error
            }

            completed += 1
            dependencies.stats.titleSucceeded = completed
            dependencies.upsertPipelineItem({
              runId: context.runId,
              itemKey: item.itemKey,
              stepKey: 'title',
              status: 'completed',
              sourcePath: item.path,
              outputPath: batchState.xlsxPath,
              artifactId: item.artifactId,
              printId: item.printId,
              sourceArtifactIds: item.sourceArtifactIds,
              completed: true,
            })
            dependencies.db
              .prepare(
                `
                  UPDATE pipeline_steps
                  SET output_count = ?, updated_at = ?
                  WHERE run_id = ? AND step_key = 'title'
                `,
              )
              .run(completed + skipped, Date.now(), context.runId)
            dependencies.emitRunningProgress(context.runId, '标题流处理中')
            yield item
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
          if (state.pendingFlush || state.generatedBaseTitles.size > 0) {
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

        dependencies.db
          .prepare(
            `
              UPDATE pipeline_steps
              SET status = 'completed',
                  input_count = ?,
                  output_count = ?,
                  output_json = ?,
                  completed_at = ?,
                  updated_at = ?
              WHERE run_id = ? AND step_key = 'title'
            `,
          )
          .run(
            queued,
            completed + skipped,
            JSON.stringify({
              succeeded: completed,
              failed,
              skipped,
              pendingFlushBatches: Array.from(batchStates.values()).filter(
                (state) => state.pendingFlush,
              ).length,
            }),
            Date.now(),
            Date.now(),
            context.runId,
          )
      } finally {
        await session.close({ keepFailedTemp: keepFailedTemp || failed > 0 })
      }
    }
  }
}
