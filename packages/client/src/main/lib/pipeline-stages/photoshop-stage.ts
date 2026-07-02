import { copyFile, mkdir, writeFile } from 'node:fs/promises'
import { basename, dirname, extname, join } from 'node:path'
import {
  AppErrorClass,
  type PhotoshopBatchResult,
  type PipelinePhotoshopConfig,
  type PipelineResultGroup,
  type PipelineResultImage,
  type PipelineResultSection,
  WORKBENCH_DIRECTORIES,
} from '@tengyu-aipod/shared'
import type { PipelineRunStats, PipelineRuntimeLogEntry } from '@tengyu-aipod/shared'
import type { runBatch as runPhotoshopBatch } from '../../photoshop/multi-batch'
import type {
  PipelinePrintStageFactory,
  PipelinePrintStreamItem,
  PipelineStageRuntimeContext,
} from '../pipeline-stage-types'
import type { SqliteDatabase } from '../sqlite'
import { tempFileManager } from '../temp-file-manager'
import {
  assertTargetDoesNotExist,
  nextVisibleImageName,
  normalizedVisibleImageNaming,
} from '../user-visible-filename'

const WAITING_PHOTOSHOP_PRINT_FOLDER = '等待套版'

type PromiseMutexLike = {
  runExclusive<T>(fn: () => Promise<T>): Promise<T>
}

type PhotoshopStageDependencies = {
  db: Pick<SqliteDatabase, 'prepare'>
  stats: PipelineRunStats
  workbenchRoot: string
  photoshopMutex: PromiseMutexLike
  runBatch: typeof runPhotoshopBatch
  upsertPipelineItem: (input: {
    runId: string
    itemKey: string
    stepKey: 'photoshop'
    status: 'running' | 'completed' | 'failed'
    sourcePath?: string | undefined
    outputPath?: string | undefined
    artifactId?: string | undefined
    printId?: string | undefined
    sourceArtifactIds?: string[] | undefined
    errorMessage?: string | undefined
    completed?: boolean | undefined
  }) => void
  updateResultSection: (runId: string, section: PipelineResultSection) => void
  appendLog: (runId: string, input: Omit<PipelineRuntimeLogEntry, 'id' | 'created_at'>) => void
  emitRunningProgress: (runId: string, message: string) => void
  setCurrentCancel: (cancel: (() => void | Promise<void>) | null) => void
  assertNotCancelled: () => void
}

type PhotoshopResultGroup = PhotoshopBatchResult['result_groups'][number]

function safePathSegment(value: string) {
  return value.replace(/[\\/:*?"<>|]/g, '_').trim() || '完整任务'
}

function imageFileExtension(path: string) {
  const extension = extname(path).toLowerCase()
  return /\.(?:jpe?g|png|webp)$/i.test(extension) ? extension : '.png'
}

function outputRoot(workbenchRoot: string, config: PipelinePhotoshopConfig) {
  return config.outputRoot || join(workbenchRoot, WORKBENCH_DIRECTORIES.listing)
}

function buildResultImage(
  group: PhotoshopResultGroup,
  outputPath: string,
  prompt?: string | undefined,
): PipelineResultImage {
  return {
    id: `photoshop-${group.template_name}-${group.sku_folder}-${basename(outputPath)}`,
    status: 'success',
    step_key: 'photoshop',
    label: `${group.template_name} / ${group.sku_folder}`,
    local_path: outputPath,
    ...(prompt ? { prompt } : {}),
  }
}

function buildResultGroup(
  group: PhotoshopResultGroup,
  prompt?: string | undefined,
): PipelineResultGroup {
  const items = group.outputs.map((outputPath) => buildResultImage(group, outputPath, prompt))
  const coverPath = group.outputs[0]
  const folderPath = coverPath ? dirname(coverPath) : undefined
  return {
    id: `photoshop-group-${group.template_name}-${group.sku_folder}-${group.group_index}`,
    label: `${group.template_name} / ${group.sku_folder}`,
    subtitle: `${items.length} 张成品图`,
    kind: 'folder',
    ...(coverPath ? { cover_path: coverPath } : {}),
    ...(folderPath ? { folder_path: folderPath } : {}),
    template_batch: group.template_name,
    sku_code: group.sku_folder,
    items,
  }
}

function resultSection(input: {
  items: PipelineResultImage[]
  groups: PipelineResultGroup[]
  failed: number
}): PipelineResultSection {
  return {
    key: 'print_products',
    title: '套版成品',
    items: input.items,
    groups: input.groups,
    total: input.groups.length,
    completed: input.groups.length,
    failed: input.failed,
    collapsible: true,
    default_collapsed: false,
    paginated: true,
  }
}

function streamItemFromOutput(input: {
  itemKey: string
  path: string
  artifactId?: string | undefined
  printId?: string | undefined
  prompt?: string | undefined
  sourceArtifactIds: string[]
}): PipelinePrintStreamItem {
  return {
    itemKey: input.itemKey,
    path: input.path,
    sourceArtifactIds: input.sourceArtifactIds,
    ...(input.artifactId ? { artifactId: input.artifactId } : {}),
    ...(input.printId ? { printId: input.printId } : {}),
    ...(input.prompt ? { prompt: input.prompt } : {}),
  }
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
    `${runId}:photoshop`,
    runId,
    'photoshop',
    'photoshop',
    'PS 套版',
    'running',
    inputCount,
    outputCount,
    Date.now(),
    Date.now(),
  )
}

async function prepareWaitingPrint(input: {
  workbenchRoot: string
  runId: string
  sourcePath: string
  printSkuCode: string | undefined
  filenameSeparator: string | undefined
  sequence: number
}) {
  const naming = normalizedVisibleImageNaming({
    prefix: input.printSkuCode,
    separator: input.filenameSeparator ?? '-',
  })
  if (!naming) {
    throw new AppErrorClass('INVALID_INPUT', '印花货号清洗后为空', false, {
      printSkuCode: input.printSkuCode,
    })
  }
  const waitingFolder = join(
    input.workbenchRoot,
    WORKBENCH_DIRECTORIES.generation,
    WAITING_PHOTOSHOP_PRINT_FOLDER,
    safePathSegment(input.runId),
  )
  await mkdir(waitingFolder, { recursive: true })
  const filename = nextVisibleImageName({
    ...naming,
    index: input.sequence,
    ext: imageFileExtension(input.sourcePath),
  })
  if (!filename) {
    throw new AppErrorClass('INVALID_INPUT', '印花货号清洗后为空', false, {
      printSkuCode: input.printSkuCode,
    })
  }
  const targetPath = join(waitingFolder, filename)
  await assertTargetDoesNotExist(targetPath)
  await copyFile(input.sourcePath, targetPath)
  return {
    waitingFolder,
    path: targetPath,
    skuCode: basename(targetPath, extname(targetPath)),
  }
}

export function createPhotoshopStage(
  dependencies: PhotoshopStageDependencies,
): PipelinePrintStageFactory {
  return (context: PipelineStageRuntimeContext) => {
    const config = context.config.photoshop
    if (config.enabled === false) {
      throw new AppErrorClass('HTTP_5XX', '未启用 PS 套版却创建了 Photoshop stage', true)
    }
    if (config.templates.length === 0) {
      throw new AppErrorClass('HTTP_4XX', 'PS 套版需要至少一个模板', false)
    }

    const outputItems: PipelineResultImage[] = []
    const outputGroups: PipelineResultGroup[] = []
    const outputRootPath = outputRoot(dependencies.workbenchRoot, config)

    const refreshSection = (failed: number) => {
      dependencies.updateResultSection(
        context.runId,
        resultSection({ items: outputItems, groups: outputGroups, failed }),
      )
    }

    return async function* photoshopStage(input: AsyncIterable<PipelinePrintStreamItem>) {
      let queued = 0
      let completed = 0
      let failed = 0
      let nextSequence = 0
      let waitingFolderPath: string | null = null

      insertRunningStep(dependencies.db, context.runId, 0, 0)
      dependencies.appendLog(context.runId, {
        level: 'info',
        step_key: 'photoshop',
        message: 'PS 套版配置',
        details: {
          templates: config.templates,
          outputRoot: outputRootPath,
          replaceRange: config.replaceRange ?? 'auto',
          format: config.format ?? 'jpg',
          clipMode: config.clipMode ?? 'auto',
        },
      })

      for await (const item of input) {
        dependencies.assertNotCancelled()
        queued += 1
        insertRunningStep(dependencies.db, context.runId, queued, completed)
        dependencies.emitRunningProgress(context.runId, 'PS 套版流处理中')
        try {
          const prepared = await prepareWaitingPrint({
            workbenchRoot: dependencies.workbenchRoot,
            runId: context.runId,
            sourcePath: item.path,
            printSkuCode: context.config.printSkuCode,
            filenameSeparator: context.config.filenameSeparator,
            sequence: nextSequence,
          })
          nextSequence += 1
          waitingFolderPath = prepared.waitingFolder

          for (const templatePath of config.templates) {
            const stageItemKey = `${item.itemKey}:${safePathSegment(templatePath)}`
            const taskId = `${context.runId}-photoshop-${prepared.skuCode}-${safePathSegment(templatePath)}`
            const taskDir = await tempFileManager.createTaskDir('photoshop', taskId)
            const cancelFilePath = join(taskDir, 'cancel.flag')
            dependencies.upsertPipelineItem({
              runId: context.runId,
              itemKey: stageItemKey,
              stepKey: 'photoshop',
              status: 'running',
              sourcePath: prepared.path,
              artifactId: item.artifactId,
              printId: item.printId,
              sourceArtifactIds: item.sourceArtifactIds,
            })
            dependencies.setCurrentCancel(() =>
              writeFile(cancelFilePath, String(Date.now()), 'utf8'),
            )

            let keepTempOnFailure = true
            try {
              const result = await dependencies.photoshopMutex.runExclusive(async () => {
                dependencies.assertNotCancelled()
                return dependencies.runBatch(
                  [{ id: prepared.skuCode, file_path: prepared.path }],
                  [templatePath],
                  {
                    taskId,
                    outputRoot: outputRootPath,
                    outputLayout: 'template_first',
                    replaceRange: config.replaceRange ?? 'auto',
                    format: config.format ?? 'jpg',
                    clipMode: config.clipMode ?? 'auto',
                    skipCompleted: config.skipCompleted ?? true,
                    maxRetries: config.maxRetries ?? 1,
                    cancelFilePath,
                  },
                )
              })
              const group = result.result_groups[0]
              if (!group || group.outputs.length === 0) {
                throw new AppErrorClass('HTTP_5XX', 'PS 套版未返回输出结果', true, {
                  taskId,
                  templatePath,
                  skuCode: prepared.skuCode,
                })
              }

              const firstOutputPath = group.outputs[0]
              if (!firstOutputPath) {
                throw new AppErrorClass('HTTP_5XX', 'PS 套版未返回首张输出路径', true, {
                  taskId,
                  templatePath,
                  skuCode: prepared.skuCode,
                })
              }

              keepTempOnFailure = false
              completed += 1
              dependencies.stats.photoshopGroups = completed
              dependencies.upsertPipelineItem({
                runId: context.runId,
                itemKey: stageItemKey,
                stepKey: 'photoshop',
                status: 'completed',
                sourcePath: prepared.path,
                outputPath: firstOutputPath,
                artifactId: item.artifactId,
                printId: item.printId,
                sourceArtifactIds: item.sourceArtifactIds,
                completed: true,
              })
              const resultGroup = buildResultGroup(group, item.prompt)
              outputGroups.push(resultGroup)
              outputItems.push(...resultGroup.items)
              refreshSection(failed)
              dependencies.db
                .prepare(
                  `
                    UPDATE pipeline_steps
                    SET output_count = ?, updated_at = ?
                    WHERE run_id = ? AND step_key = 'photoshop'
                  `,
                )
                .run(completed, Date.now(), context.runId)
              dependencies.emitRunningProgress(context.runId, 'PS 套版流处理中')
              yield streamItemFromOutput({
                itemKey: stageItemKey,
                path: firstOutputPath,
                sourceArtifactIds: item.sourceArtifactIds,
                ...(item.artifactId ? { artifactId: item.artifactId } : {}),
                ...(item.printId ? { printId: item.printId } : {}),
                ...(item.prompt ? { prompt: item.prompt } : {}),
              })
            } catch (error) {
              failed += 1
              dependencies.upsertPipelineItem({
                runId: context.runId,
                itemKey: stageItemKey,
                stepKey: 'photoshop',
                status: 'failed',
                sourcePath: prepared.path,
                artifactId: item.artifactId,
                printId: item.printId,
                sourceArtifactIds: item.sourceArtifactIds,
                errorMessage: error instanceof Error ? error.message : String(error),
                completed: true,
              })
              dependencies.appendLog(context.runId, {
                level: 'warn',
                step_key: 'photoshop',
                message: '单货号套版失败，已跳过',
                details: {
                  itemKey: stageItemKey,
                  templatePath,
                  skuCode: prepared.skuCode,
                  error: error instanceof Error ? error.message : String(error),
                },
              })
            } finally {
              dependencies.setCurrentCancel(null)
              if (keepTempOnFailure) {
                await tempFileManager.cleanupTask('photoshop', taskId, { keepIfFailed: true })
              } else {
                await tempFileManager.cleanupTask('photoshop', taskId)
              }
            }
          }
        } catch (error) {
          failed += 1
          dependencies.upsertPipelineItem({
            runId: context.runId,
            itemKey: item.itemKey,
            stepKey: 'photoshop',
            status: 'failed',
            sourcePath: item.path,
            artifactId: item.artifactId,
            printId: item.printId,
            sourceArtifactIds: item.sourceArtifactIds,
            errorMessage: error instanceof Error ? error.message : String(error),
            completed: true,
          })
          dependencies.appendLog(context.runId, {
            level: 'warn',
            step_key: 'photoshop',
            message: '等待套版准备失败，已跳过当前印花',
            details: {
              itemKey: item.itemKey,
              error: error instanceof Error ? error.message : String(error),
            },
          })
        }
      }

      refreshSection(failed)
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
            WHERE run_id = ? AND step_key = 'photoshop'
          `,
        )
        .run(
          queued,
          completed,
          JSON.stringify({
            total: queued,
            groupsCompleted: completed,
            failed,
            waitingPrintFolder: waitingFolderPath,
            outputRoot: outputRootPath,
          }),
          Date.now(),
          Date.now(),
          context.runId,
        )
      dependencies.emitRunningProgress(context.runId, 'PS 套版完成')
    }
  }
}
