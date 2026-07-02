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
import type { SqliteDatabase } from '../sqlite'

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
    `${runId}:detection`,
    runId,
    'detection',
    'detection',
    '侵权检测',
    'running',
    inputCount,
    outputCount,
    Date.now(),
    Date.now(),
  )
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

      for await (const item of input) {
        dependencies.assertNotCancelled()
        queued += 1
        insertRunningStep(dependencies.db, context.runId, queued, pass + review)
        dependencies.emitRunningProgress(context.runId, '侵权检测流处理中')
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

        const taskId = context.taskName
        dependencies.setCurrentCancel(() => {
          detectionService.cancelTask(taskId)
        })
        try {
          const result = await detectionService.runDetectionBatch({
            imagePaths: [item.path],
            imageInputs: [
              {
                path: item.path,
                ...(item.artifactId ? { artifactId: item.artifactId } : {}),
                ...(item.printId ? { printId: item.printId } : {}),
              },
            ],
            skillId,
            model,
            taskId,
            ...(config.skillVersion ? { skillVersion: config.skillVersion } : {}),
            ...(config.variables ? { variables: config.variables } : {}),
            ...(config.threshold ? { threshold: config.threshold } : {}),
            ...(config.preprocess ? { preprocess: config.preprocess } : {}),
            ...(config.concurrency !== undefined ? { concurrency: config.concurrency } : {}),
            ...(config.maxRetries !== undefined ? { maxRetries: config.maxRetries } : {}),
          })
          const detectionItem = result.results[0]
          if (!detectionItem) {
            throw new AppErrorClass('HTTP_5XX', '侵权检测未返回结果', true, {
              taskId,
              itemKey: item.itemKey,
            })
          }
          if (detectionItem.status === 'failed') {
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
              errorMessage: detectionItem.error,
              completed: true,
            })
            dependencies.appendLog(context.runId, {
              level: 'warn',
              step_key: 'detection',
              message: '单张侵权检测失败，已跳过',
              details: {
                itemKey: item.itemKey,
                error: detectionItem.error,
                errorCode: detectionItem.errorCode,
              },
            })
            continue
          }

          const allowed = shouldPipelineDetectionAllow(detectionItem.riskLevel, allowReview)
          const image = {
            ...resultImageFromDetection(detectionItem, allowed, queued - 1),
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
        } catch (error) {
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
            errorMessage: error instanceof Error ? error.message : String(error),
            completed: true,
          })
          dependencies.appendLog(context.runId, {
            level: 'warn',
            step_key: 'detection',
            message: '单张侵权检测失败，已跳过',
            details: {
              itemKey: item.itemKey,
              error: error instanceof Error ? error.message : String(error),
            },
          })
        } finally {
          dependencies.setCurrentCancel(null)
          dependencies.stats.detectionPass = pass
          dependencies.stats.detectionReview = review
          dependencies.stats.detectionBlock = block
          dependencies.emitRunningProgress(context.runId, '侵权检测流处理中')
        }
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
            WHERE run_id = ? AND step_key = 'detection'
          `,
        )
        .run(
          queued,
          pass + review,
          JSON.stringify({
            total: queued,
            pass,
            review,
            block,
            failed,
            passed,
            blocked,
          }),
          Date.now(),
          Date.now(),
          context.runId,
        )
      dependencies.emitRunningProgress(context.runId, '侵权检测完成')
    }
  }
}
