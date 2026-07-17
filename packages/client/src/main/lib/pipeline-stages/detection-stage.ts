import {
  AppErrorClass,
  type PipelineDetectionConfig,
  type PipelineResultImage,
  type PipelineResultSection,
  type PipelineRunStats,
  type PipelineRuntimeLogEntry,
} from '@tengyu-aipod/shared'
import { type DetectionImageResult, detectionService } from '../detection-service'
import { shouldPipelineDetectionAllow } from '../pipeline-policy'
import type {
  PipelinePrintStageFactory,
  PipelinePrintStreamItem,
  PipelineStageRuntimeContext,
} from '../pipeline-stage-types'
import * as pipelineStore from '../pipeline/store'
import type { SqliteDatabase } from '../sqlite'
import { readyMicroBatches } from './ready-micro-batches'

type DetectionStageDependencies = {
  db: Pick<SqliteDatabase, 'prepare'>
  stats: PipelineRunStats
  upsertPipelineItem: (input: {
    runId: string
    itemKey: string
    stepKey: 'detection'
    status: 'running' | 'completed' | 'failed' | 'filtered'
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

function resultSection(input: {
  key: 'detection_passed' | 'detection_blocked'
  title: string
  items: PipelineResultImage[]
}): PipelineResultSection {
  return {
    key: input.key,
    title: input.title,
    items: input.items,
    total: input.items.length,
    completed: input.items.length,
    failed: 0,
    collapsible: true,
    default_collapsed: false,
    paginated: true,
  }
}

function resultImageFromDetection(
  item: Exclude<DetectionImageResult, { status: 'failed' }>,
  allowed: boolean,
  index: number,
): PipelineResultImage {
  return {
    id: `detection-${item.artifactId}-${index + 1}`,
    status: 'success',
    step_key: 'detection',
    label: item.printId || item.artifactId || `检测 ${index + 1}`,
    local_path: item.outputPath,
    source_path: item.imagePath,
    artifact_id: item.artifactId,
    print_id: item.printId,
    risk_score: item.riskScore,
    risk_level: item.riskLevel,
    reason: item.reason,
    allowed,
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
    stepKey: 'detection',
    module: 'detection',
    label: '侵权检测',
    inputCount,
    outputCount,
  })
}

function safeTaskSegment(value: string) {
  return value.replace(/[\\/:*?"<>|]/g, '_').trim() || 'item'
}

export function createDetectionStage(
  dependencies: DetectionStageDependencies,
): PipelinePrintStageFactory {
  return (context: PipelineStageRuntimeContext) => {
    const config: PipelineDetectionConfig = context.config.detection
    const skillId = config.skillId
    const model = config.model
    if (!skillId || !model) {
      throw new AppErrorClass('HTTP_4XX', '侵权检测需要选择 Skill 和模型', false)
    }

    const allowReview = config.allowReview ?? true
    const passed: PipelineResultImage[] = []
    const blocked: PipelineResultImage[] = []

    const refreshSections = () => {
      dependencies.updateResultSection(
        context.runId,
        resultSection({
          key: 'detection_passed',
          title: '侵权检测通过',
          items: passed,
        }),
      )
      dependencies.updateResultSection(
        context.runId,
        resultSection({
          key: 'detection_blocked',
          title: '侵权检测未通过',
          items: blocked,
        }),
      )
    }

    return async function* detectionStage(input: AsyncIterable<PipelinePrintStreamItem>) {
      let queued = 0
      let pass = 0
      let review = 0
      let block = 0
      let failed = 0

      insertRunningStep(dependencies.db, context.runId, 0, 0)
      dependencies.appendLog(context.runId, {
        level: 'info',
        step_key: 'detection',
        message: '侵权检测配置',
        details: {
          model: config.model,
          skillId: config.skillId,
          skillVersion: config.skillVersion,
          allowReview,
        },
      })

      const concurrency = Math.max(1, Math.min(20, Math.floor(config.concurrency ?? 20)))
      let batchIndex = 0
      const markFailed = (
        item: PipelinePrintStreamItem,
        error: string,
        errorCode?: string | undefined,
      ) => {
        failed += 1
        dependencies.upsertPipelineItem({
          runId: context.runId,
          itemKey: item.itemKey,
          stepKey: 'detection',
          status: 'failed',
          sourcePath: item.path,
          artifactId: item.artifactId,
          printId: item.printId,
          sourceArtifactIds: item.sourceArtifactIds,
          errorMessage: error,
          completed: true,
        })
        dependencies.appendLog(context.runId, {
          level: 'warn',
          step_key: 'detection',
          message: '单张侵权检测失败，已跳过',
          details: {
            itemKey: item.itemKey,
            error,
            ...(errorCode ? { errorCode } : {}),
          },
        })
      }

      for await (const items of readyMicroBatches(input, concurrency)) {
        dependencies.assertNotCancelled()
        const indexedItems = items.map((item) => {
          const displayIndex = queued
          queued += 1
          insertRunningStep(dependencies.db, context.runId, queued, pass + review)
          dependencies.upsertPipelineItem({
            runId: context.runId,
            itemKey: item.itemKey,
            stepKey: 'detection',
            status: 'running',
            sourcePath: item.path,
            artifactId: item.artifactId,
            printId: item.printId,
            sourceArtifactIds: item.sourceArtifactIds,
          })
          return { displayIndex, item }
        })
        dependencies.emitRunningProgress(context.runId, '侵权检测流处理中')

        const taskId = `${context.runId}-detection-${batchIndex}-${safeTaskSegment(items[0]?.itemKey ?? 'batch')}`
        batchIndex += 1
        dependencies.setCurrentCancel(() => {
          detectionService.cancelTask(taskId)
        })

        let batchResult: Awaited<ReturnType<typeof detectionService.runDetectionBatch>> | null =
          null
        try {
          batchResult = await detectionService.runDetectionBatch({
            imagePaths: items.map((item) => item.path),
            imageInputs: items.map((item) => ({
              path: item.path,
              ...(item.artifactId ? { artifactId: item.artifactId } : {}),
              ...(item.printId ? { printId: item.printId } : {}),
            })),
            skillId,
            model,
            taskId,
            concurrency,
            ...(config.skillVersion ? { skillVersion: config.skillVersion } : {}),
            ...(config.variables ? { variables: config.variables } : {}),
            ...(config.threshold ? { threshold: config.threshold } : {}),
            ...(config.preprocess ? { preprocess: config.preprocess } : {}),
            ...(config.maxRetries !== undefined ? { maxRetries: config.maxRetries } : {}),
          })
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error)
          for (const { item } of indexedItems) {
            markFailed(item, message)
          }
        } finally {
          dependencies.setCurrentCancel(null)
        }

        if (batchResult) {
          const remainingResults = [...batchResult.results]
          for (const { displayIndex, item } of indexedItems) {
            const resultIndex = remainingResults.findIndex(
              (detectionItem) => detectionItem.imagePath === item.path,
            )
            const detectionItem =
              resultIndex >= 0 ? remainingResults.splice(resultIndex, 1)[0] : null
            if (!detectionItem) {
              markFailed(item, '侵权检测未返回结果')
              continue
            }
            if (detectionItem.status === 'failed') {
              markFailed(item, detectionItem.error, detectionItem.errorCode)
              continue
            }

            const allowed = shouldPipelineDetectionAllow(detectionItem.riskLevel, allowReview)
            const image = {
              ...resultImageFromDetection(detectionItem, allowed, displayIndex),
              ...(item.prompt ? { prompt: item.prompt } : {}),
            }
            if (allowed) {
              if (detectionItem.riskLevel === 'review') {
                review += 1
              } else {
                pass += 1
              }
              passed.push(image)
              dependencies.stats.prints = pass + review
              dependencies.upsertPipelineItem({
                runId: context.runId,
                itemKey: item.itemKey,
                stepKey: 'detection',
                status: 'completed',
                sourcePath: item.path,
                outputPath: detectionItem.outputPath,
                artifactId: detectionItem.artifactId,
                printId: detectionItem.printId,
                sourceArtifactIds: item.sourceArtifactIds,
                completed: true,
              })
              refreshSections()
              yield {
                itemKey: item.itemKey,
                path: detectionItem.outputPath,
                artifactId: detectionItem.artifactId,
                printId: detectionItem.printId,
                prompt: item.prompt,
                sourceArtifactIds: item.sourceArtifactIds,
              } satisfies PipelinePrintStreamItem
              continue
            }

            block += 1
            blocked.push(image)
            dependencies.upsertPipelineItem({
              runId: context.runId,
              itemKey: item.itemKey,
              stepKey: 'detection',
              status: 'filtered',
              sourcePath: item.path,
              outputPath: detectionItem.outputPath,
              artifactId: detectionItem.artifactId,
              printId: detectionItem.printId,
              sourceArtifactIds: item.sourceArtifactIds,
              completed: true,
            })
            refreshSections()
          }
        }

        dependencies.stats.detectionPass = pass
        dependencies.stats.detectionReview = review
        dependencies.stats.detectionBlock = block
        dependencies.emitRunningProgress(context.runId, '侵权检测流处理中')
      }

      refreshSections()
      if (queued > 0 && pass + review === 0 && block > 0 && failed === 0) {
        dependencies.appendLog(context.runId, {
          level: 'warn',
          step_key: 'detection',
          message: '侵权检测全部拦截，本次没有可继续的印花',
          details: { total: queued, block },
        })
      }
      pipelineStore.updatePipelineStepCompletedWithInput(dependencies.db, {
        runId: context.runId,
        stepKey: 'detection',
        inputCount: queued,
        outputCount: pass + review,
        outputJson: {
          total: queued,
          pass,
          review,
          block,
          failed,
          passed,
          blocked,
        },
      })
      dependencies.emitRunningProgress(context.runId, '侵权检测完成')
    }
  }
}
