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
import * as pipelineStore from '../pipeline/store'
import type { SqliteDatabase } from '../sqlite'
import { tempFileManager } from '../temp-file-manager'
import {
  assertTargetDoesNotExist,
  nextVisibleImageName,
  normalizedVisibleImageNaming,
} from '../user-visible-filename'
import { readyMicroBatches } from './ready-micro-batches'

const WAITING_PHOTOSHOP_PRINT_FOLDER = '等待套版'
const MAX_READY_PHOTOSHOP_BATCH_SIZE = 16

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
  pipelineStore.upsertPipelineStepRunning(db, {
    runId,
    stepKey: 'photoshop',
    module: 'photoshop',
    label: 'PS 套版',
    inputCount,
    outputCount,
  })
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
      let nextSequence = new Set(
        (context.resume?.getItems('photoshop') ?? [])
          .map((item) => item.source_path)
          .filter((path): path is string => Boolean(path)),
      ).size
      let waitingFolderPath: string | null = null
      const replaceRange = config.replaceRange ?? 'auto'
      const microBatchEnabled = replaceRange === 'auto' || replaceRange === 'topmost'

      insertRunningStep(dependencies.db, context.runId, 0, 0)
      dependencies.appendLog(context.runId, {
        level: 'info',
        step_key: 'photoshop',
        message: 'PS 套版配置',
        details: {
          templates: config.templates,
          outputRoot: outputRootPath,
          replaceRange,
          smartObjectReplaceMode: config.smartObjectReplaceMode ?? 'replaceContents',
          smartObjectInnerFitMode: config.smartObjectInnerFitMode ?? 'fill',
          format: config.format ?? 'jpg',
          clipMode: config.clipMode ?? 'auto',
        },
      })

      for await (const items of readyMicroBatches(
        input,
        microBatchEnabled ? MAX_READY_PHOTOSHOP_BATCH_SIZE : 1,
      )) {
        const preparedItems: Array<{
          item: PipelinePrintStreamItem
          prepared: Awaited<ReturnType<typeof prepareWaitingPrint>>
        }> = []

        for (const item of items) {
          dependencies.assertNotCancelled()
          queued += 1
          insertRunningStep(dependencies.db, context.runId, queued, completed)
          dependencies.emitRunningProgress(context.runId, 'PS 套版流处理中')
          try {
            const resumeItemForTemplate = (templatePath: string) =>
              context.resume?.getItem(
                'photoshop',
                `${item.itemKey}:${safePathSegment(templatePath)}`,
              ) ?? null
            const resumeWaitingPath =
              config.templates
                .map((templatePath) => resumeItemForTemplate(templatePath)?.source_path)
                .find((path): path is string => Boolean(path)) ?? null
            const prepared = resumeWaitingPath
              ? {
                  waitingFolder: dirname(resumeWaitingPath),
                  path: resumeWaitingPath,
                  skuCode: basename(resumeWaitingPath, extname(resumeWaitingPath)),
                }
              : await prepareWaitingPrint({
                  workbenchRoot: dependencies.workbenchRoot,
                  runId: context.runId,
                  sourcePath: item.path,
                  printSkuCode: context.config.printSkuCode,
                  filenameSeparator: context.config.filenameSeparator,
                  sequence: nextSequence,
                })
            if (!resumeWaitingPath) {
              nextSequence += 1
            }
            waitingFolderPath = prepared.waitingFolder
            preparedItems.push({ item, prepared })
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

        for (const templatePath of config.templates) {
          const pending = preparedItems.filter(({ item }) => {
            const stageItemKey = `${item.itemKey}:${safePathSegment(templatePath)}`
            return context.resume?.getItem('photoshop', stageItemKey)?.status !== 'completed'
          })
          if (pending.length === 0) {
            continue
          }

          const firstPrepared = pending[0]?.prepared
          if (!firstPrepared) {
            continue
          }
          const taskId = `${context.runId}-photoshop-${firstPrepared.skuCode}-${safePathSegment(templatePath)}`
          let taskDirCreated = false
          let keepTempOnFailure = false
          try {
            const taskDir = await tempFileManager.createTaskDir('photoshop', taskId)
            taskDirCreated = true
            const cancelFilePath = join(taskDir, 'cancel.flag')
            for (const { item, prepared } of pending) {
              dependencies.upsertPipelineItem({
                runId: context.runId,
                itemKey: `${item.itemKey}:${safePathSegment(templatePath)}`,
                stepKey: 'photoshop',
                status: 'running',
                sourcePath: prepared.path,
                artifactId: item.artifactId,
                printId: item.printId,
                sourceArtifactIds: item.sourceArtifactIds,
              })
            }
            dependencies.setCurrentCancel(() =>
              writeFile(cancelFilePath, String(Date.now()), 'utf8'),
            )
            const result = await dependencies.photoshopMutex.runExclusive(async () => {
              dependencies.assertNotCancelled()
              return dependencies.runBatch(
                pending.map(({ prepared }) => ({
                  id: prepared.skuCode,
                  file_path: prepared.path,
                })),
                [templatePath],
                {
                  taskId,
                  outputRoot: outputRootPath,
                  outputLayout: 'template_first',
                  replaceRange,
                  smartObjectReplaceMode: config.smartObjectReplaceMode ?? 'replaceContents',
                  smartObjectInnerFitMode: config.smartObjectInnerFitMode ?? 'fill',
                  format: config.format ?? 'jpg',
                  clipMode: config.clipMode ?? 'auto',
                  skipCompleted: config.skipCompleted ?? true,
                  maxRetries: config.maxRetries ?? 1,
                  cancelFilePath,
                },
              )
            })
            const groupsBySku = new Map(
              result.result_groups.map((group) => [group.sku_folder, group]),
            )

            for (const { item, prepared } of pending) {
              const stageItemKey = `${item.itemKey}:${safePathSegment(templatePath)}`
              const group = groupsBySku.get(prepared.skuCode)
              const firstOutputPath = group?.outputs[0]
              if (!group || !firstOutputPath) {
                keepTempOnFailure = true
                failed += 1
                const error = new AppErrorClass('HTTP_5XX', 'PS 套版未返回输出结果', true, {
                  taskId,
                  templatePath,
                  skuCode: prepared.skuCode,
                })
                dependencies.upsertPipelineItem({
                  runId: context.runId,
                  itemKey: stageItemKey,
                  stepKey: 'photoshop',
                  status: 'failed',
                  sourcePath: prepared.path,
                  artifactId: item.artifactId,
                  printId: item.printId,
                  sourceArtifactIds: item.sourceArtifactIds,
                  errorMessage: error.message,
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
                    error: error.message,
                  },
                })
                continue
              }

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
              pipelineStore.updatePipelineStepOutputCount(dependencies.db, {
                runId: context.runId,
                stepKey: 'photoshop',
                outputCount: completed,
              })
              dependencies.emitRunningProgress(context.runId, 'PS 套版流处理中')
              yield streamItemFromOutput({
                itemKey: stageItemKey,
                path: firstOutputPath,
                sourceArtifactIds: item.sourceArtifactIds,
                ...(item.artifactId ? { artifactId: item.artifactId } : {}),
                ...(item.printId ? { printId: item.printId } : {}),
                ...(item.prompt ? { prompt: item.prompt } : {}),
              })
            }
          } catch (error) {
            keepTempOnFailure = true
            for (const { item, prepared } of pending) {
              const stageItemKey = `${item.itemKey}:${safePathSegment(templatePath)}`
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
            }
          } finally {
            dependencies.setCurrentCancel(null)
            if (taskDirCreated) {
              try {
                if (keepTempOnFailure) {
                  await tempFileManager.cleanupTask('photoshop', taskId, { keepIfFailed: true })
                } else {
                  await tempFileManager.cleanupTask('photoshop', taskId)
                }
              } catch (error) {
                dependencies.appendLog(context.runId, {
                  level: 'warn',
                  step_key: 'photoshop',
                  message: 'PS 临时文件清理失败，已忽略',
                  details: {
                    taskId,
                    templatePath,
                    error: error instanceof Error ? error.message : String(error),
                  },
                })
              }
            }
          }
        }
      }

      refreshSection(failed)
      pipelineStore.updatePipelineStepCompletedWithInput(dependencies.db, {
        runId: context.runId,
        stepKey: 'photoshop',
        inputCount: queued,
        outputCount: completed,
        outputJson: {
          total: queued,
          groupsCompleted: completed,
          failed,
          waitingPrintFolder: waitingFolderPath,
          outputRoot: outputRootPath,
        },
      })
      dependencies.emitRunningProgress(context.runId, 'PS 套版完成')
    }
  }
}
