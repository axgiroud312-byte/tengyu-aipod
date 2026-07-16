import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import type {
  PhotoshopBatchOutputGroup,
  PhotoshopBatchResult,
  PhotoshopBatchTemplateResult,
  PhotoshopClipMode,
  PhotoshopExportFormat,
  PhotoshopInnerFitMode,
  PhotoshopJobResult,
  PhotoshopOutputLayout,
  PhotoshopPrintAsset,
  PhotoshopProgressInfo,
  PhotoshopProgressLogEntry,
  PhotoshopSmartObjectReplaceMode,
  PhotoshopTaskGroup,
  PsdTemplate,
} from '@tengyu-aipod/shared'
import {
  type GroupPhotoshopTasksOptions,
  groupTasks,
  sanitizeTemplateName,
} from '@tengyu-aipod/shared'
import pino from 'pino'
import { getWorkbenchRoot } from '../lib/workbench-config'
import { type PhotoshopExecutionEngine, photoshopExecutionEngine } from './execution-engine'
import { type PsdScanner, deriveClipAreas, psdScanner } from './psd-scanner'

export interface PhotoshopBatchConfig {
  taskId: string
  outputRoot: string
  replaceRange?: GroupPhotoshopTasksOptions['replaceRange']
  smartObjectReplaceMode?: PhotoshopSmartObjectReplaceMode
  smartObjectInnerFitMode?: PhotoshopInnerFitMode
  format?: PhotoshopExportFormat
  jpgQuality?: number
  clipMode?: PhotoshopClipMode
  skipCompleted?: boolean
  maxRetries?: number
  outputLayout?: PhotoshopOutputLayout
  cancelFilePath?: string
}

interface PhotoshopMultiBatchOptions {
  scanner?: Pick<PsdScanner, 'scanPsd'>
  engine?: PhotoshopBatchEngine
  onProgress?: (progress: PhotoshopProgressInfo) => void | Promise<void>
  onLog?: (entry: PhotoshopProgressLogEntry) => void | Promise<void>
  progressLogger?: Pick<PhotoshopProgressLogger, 'write'> | null
}

export interface PhotoshopTemplateBatchRunResult {
  ok: boolean
  outputs: string[]
  groups: Array<{
    group_index: number
    sku_folder: string
    outputs: string[]
    skipped?: boolean
  }>
  cancelled?: boolean
}

interface PhotoshopBatchEngine {
  runJob(
    job: PhotoshopTaskGroup['job'],
    maxRetries?: number,
    options?: { skipCompleted?: boolean },
  ): Promise<PhotoshopJobResult>
  runTemplateBatch?(
    template: PsdTemplate,
    groups: PhotoshopTaskGroup[],
    maxRetries: number,
    options: {
      skipCompleted?: boolean
      cancelFilePath?: string
      onLog?: (entry: PhotoshopProgressLogEntry) => void | Promise<void>
    },
  ): Promise<PhotoshopTemplateBatchRunResult>
}

export class PhotoshopProgressLogger {
  private constructor(
    private readonly logger: pino.Logger,
    readonly logPath: string,
  ) {}

  static async create(taskId: string): Promise<PhotoshopProgressLogger> {
    const logsDir = join(await getWorkbenchRoot(), '.workbench', 'logs')
    await mkdir(logsDir, { recursive: true })
    const logPath = join(logsDir, `photoshop-${taskId}.log`)
    return new PhotoshopProgressLogger(
      pino(
        {
          timestamp: () => `,"ts":${Date.now()}`,
          formatters: {
            level: (label) => ({ level: label }),
          },
        },
        pino.destination(logPath),
      ),
      logPath,
    )
  }

  write(entry: PhotoshopProgressLogEntry): void {
    const { level, ...fields } = entry
    this.logger[level](fields)
  }
}

export class PhotoshopMultiBatchRunner {
  private readonly scanner: Pick<PsdScanner, 'scanPsd'>
  private readonly engine: PhotoshopBatchEngine
  private readonly onProgress:
    | ((progress: PhotoshopProgressInfo) => void | Promise<void>)
    | undefined
  private readonly onLog: ((entry: PhotoshopProgressLogEntry) => void | Promise<void>) | undefined
  private readonly progressLogger: Pick<PhotoshopProgressLogger, 'write'> | null | undefined

  constructor(options: PhotoshopMultiBatchOptions = {}) {
    this.scanner = options.scanner ?? psdScanner
    this.engine = options.engine ?? photoshopExecutionEngine
    this.onProgress = options.onProgress
    this.onLog = options.onLog
    this.progressLogger = options.progressLogger
  }

  async runBatch(
    prints: PhotoshopPrintAsset[],
    templatePaths: string[],
    config: PhotoshopBatchConfig,
  ): Promise<PhotoshopBatchResult> {
    const templateResults: PhotoshopBatchTemplateResult[] = []
    const resultGroups: PhotoshopBatchOutputGroup[] = []
    const allOutputs: string[] = []
    let groupsCompleted = 0
    let groupsTotal = 0
    let failed = 0
    let skipped = 0
    let verifiedOutputs = 0
    let cancelled = false
    const logger =
      this.progressLogger === undefined
        ? await PhotoshopProgressLogger.create(config.taskId)
        : this.progressLogger
    const outputLayout = config.outputLayout ?? 'template_first'
    const logPath =
      logger && 'logPath' in logger && typeof logger.logPath === 'string'
        ? logger.logPath
        : undefined
    const emitFailureLog = async (error: unknown, group?: number, startedAt?: number) => {
      const message = error instanceof Error ? error.message : String(error)
      const failureLog: PhotoshopProgressLogEntry = {
        ts: Date.now(),
        level: 'error',
        stage: 'group_complete',
        task_id: config.taskId,
        message,
        error: message,
        ...(group === undefined ? {} : { group }),
        ...(startedAt === undefined ? {} : { duration_ms: Date.now() - startedAt }),
      }
      logger?.write(failureLog)
      await this.emitLog(failureLog)
    }

    logger?.write({ ts: Date.now(), level: 'info', stage: 'task_start' })

    const preparedTemplates: Array<{
      templateIndex: number
      template: PsdTemplate
      templateName: string
      groups: PhotoshopTaskGroup[]
    }> = []

    for (let templateIndex = 0; templateIndex < templatePaths.length; templateIndex += 1) {
      const template = await this.scanner.scanPsd(templatePaths[templateIndex] ?? '')
      const templateName = sanitizeTemplateName(template.file_path)
      const groupOptions: GroupPhotoshopTasksOptions = {
        taskId: config.taskId,
        outputRoot: config.outputRoot,
        outputLayout,
      }
      if (config.replaceRange !== undefined) {
        groupOptions.replaceRange = config.replaceRange
      }
      if (config.smartObjectReplaceMode !== undefined) {
        groupOptions.smartObjectReplaceMode = config.smartObjectReplaceMode
      }
      if (config.smartObjectInnerFitMode !== undefined) {
        groupOptions.smartObjectInnerFitMode = config.smartObjectInnerFitMode
      }
      if (config.format !== undefined) {
        groupOptions.format = config.format
      }
      if (config.jpgQuality !== undefined) {
        groupOptions.jpgQuality = config.jpgQuality
      }
      const clipMode = config.clipMode ?? 'auto'
      groupOptions.clipMode = clipMode
      const templateWithClipAreas: PsdTemplate = {
        ...template,
        clip_areas: deriveClipAreas(
          {
            doc_size: template.doc_size,
            guides: template.guides,
            smart_objects: template.smart_objects,
            layers: template.layers,
          },
          clipMode,
        ),
      }
      const groups = groupTasks(prints, templateWithClipAreas, groupOptions)
      groupsTotal += groups.length
      preparedTemplates.push({
        templateIndex,
        template: templateWithClipAreas,
        templateName,
        groups,
      })
    }

    for (const { templateIndex, template, templateName, groups } of preparedTemplates) {
      const templateOutputs: string[] = []
      if (this.engine.runTemplateBatch) {
        const realtimeCompletedGroupIndexes = new Set<number>()
        await this.emitProgress({
          task_id: config.taskId,
          total_groups: groupsTotal,
          completed: groupsCompleted - skipped,
          failed,
          skipped,
          current_group: null,
          current_stage: 'template_start',
          verified_outputs: verifiedOutputs,
          template_index: templateIndex,
          template_total: templatePaths.length,
          template_name: templateName,
          group_total: groups.length,
          groups_completed: groupsCompleted,
        })
        logger?.write({
          ts: Date.now(),
          level: 'info',
          stage: 'template_start',
          template_name: templateName,
          message: `开始处理模板：${templateName}`,
        })
        let result: PhotoshopTemplateBatchRunResult
        try {
          result = await this.engine.runTemplateBatch(template, groups, config.maxRetries ?? 0, {
            skipCompleted: config.skipCompleted ?? true,
            ...(config.cancelFilePath ? { cancelFilePath: config.cancelFilePath } : {}),
            onLog: async (entry) => {
              logger?.write(entry)
              await this.emitLog(entry)
              if (
                entry.stage !== 'group_complete' ||
                entry.level !== 'info' ||
                entry.group === undefined ||
                realtimeCompletedGroupIndexes.has(entry.group)
              ) {
                return
              }
              const group = groups.find((item) => item.group_index === entry.group)
              if (!group) {
                return
              }
              realtimeCompletedGroupIndexes.add(entry.group)
              groupsCompleted += 1
              await this.emitProgress({
                task_id: config.taskId,
                total_groups: groupsTotal,
                completed: groupsCompleted - skipped,
                failed,
                skipped,
                current_group: group.group_index,
                current_stage: 'group_complete',
                verified_outputs: verifiedOutputs,
                template_index: templateIndex,
                template_total: templatePaths.length,
                template_name: templateName,
                group_index: group.group_index,
                group_total: groups.length,
                groups_completed: groupsCompleted,
                result_group: batchOutputGroup(
                  template,
                  group,
                  group.job.output_paths,
                  'completed',
                ),
              })
            },
          })
        } catch (error) {
          failed += 1
          await emitFailureLog(error)
          throw error
        }
        verifiedOutputs += result.outputs.length
        templateOutputs.push(...result.outputs)
        allOutputs.push(...result.outputs)
        for (const groupResult of result.groups) {
          const group = groups.find((item) => item.group_index === groupResult.group_index)
          if (!group) {
            continue
          }
          const alreadyEmitted = realtimeCompletedGroupIndexes.has(groupResult.group_index)
          if (!alreadyEmitted) {
            groupsCompleted += 1
          }
          if (groupResult.skipped) {
            skipped += 1
          }
          const groupOutputs = groupResult.outputs
          const resultGroup = batchOutputGroup(
            template,
            group,
            groupOutputs,
            groupResult.skipped ? 'skipped' : 'completed',
          )
          resultGroups.push(resultGroup)
          if (!alreadyEmitted) {
            await this.emitProgress({
              task_id: config.taskId,
              total_groups: groupsTotal,
              completed: groupsCompleted - skipped,
              failed,
              skipped,
              current_group: group.group_index,
              current_stage: 'group_complete',
              verified_outputs: verifiedOutputs,
              template_index: templateIndex,
              template_total: templatePaths.length,
              template_name: templateName,
              group_index: group.group_index,
              group_total: groups.length,
              groups_completed: groupsCompleted,
              result_group: resultGroup,
            })
          }
        }
        templateResults.push({
          template_id: template.id,
          template_name: templateName,
          groups_total: groups.length,
          groups_completed: result.groups.length,
          outputs: templateOutputs,
        })
        if (result.cancelled) {
          cancelled = true
          logger?.write({
            ts: Date.now(),
            level: 'warn',
            stage: 'cancelled',
            template_name: templateName,
            message: '用户取消任务，当前模板批处理已在组边界停止',
          })
          break
        }
        continue
      }

      for (const group of groups) {
        await this.emitProgress({
          task_id: config.taskId,
          total_groups: groupsTotal,
          completed: groupsCompleted - skipped,
          failed,
          skipped,
          current_group: group.group_index,
          current_stage: 'task_start',
          verified_outputs: verifiedOutputs,
          template_index: templateIndex,
          template_total: templatePaths.length,
          template_name: templateName,
          group_index: group.group_index,
          group_total: groups.length,
          groups_completed: groupsCompleted,
        })
        logger?.write({
          ts: Date.now(),
          level: 'info',
          stage: 'task_start',
          group: group.group_index,
          input: group.print_assets.map((asset) => asset.file_path).join(','),
        })

        const startedAt = Date.now()
        try {
          logger?.write({
            ts: Date.now(),
            level: 'debug',
            stage: 'jsx_generate',
            group: group.group_index,
          })
          logger?.write({
            ts: Date.now(),
            level: 'info',
            stage: 'jsx_exec',
            group: group.group_index,
          })
          const result = await this.engine.runJob(group.job, config.maxRetries ?? 0, {
            skipCompleted: config.skipCompleted ?? true,
          })
          groupsCompleted += 1
          if (result.skipped) {
            skipped += 1
          }
          verifiedOutputs += result.outputs.length
          templateOutputs.push(...result.outputs)
          allOutputs.push(...result.outputs)
          const resultGroup = batchOutputGroup(
            template,
            group,
            result.outputs,
            result.skipped ? 'skipped' : 'completed',
          )
          resultGroups.push(resultGroup)
          for (const output of result.outputs) {
            logger?.write({
              ts: Date.now(),
              level: 'info',
              stage: 'output_verify',
              group: group.group_index,
              output_file: output,
            })
          }
          logger?.write({
            ts: Date.now(),
            level: 'info',
            stage: 'group_complete',
            group: group.group_index,
            duration_ms: Date.now() - startedAt,
          })
          await this.emitProgress({
            task_id: config.taskId,
            total_groups: groupsTotal,
            completed: groupsCompleted - skipped,
            failed,
            skipped,
            current_group: group.group_index,
            current_stage: 'group_complete',
            verified_outputs: verifiedOutputs,
            template_index: templateIndex,
            template_total: templatePaths.length,
            template_name: templateName,
            group_index: group.group_index,
            group_total: groups.length,
            groups_completed: groupsCompleted,
            result_group: resultGroup,
          })
        } catch (error) {
          failed += 1
          await emitFailureLog(error, group.group_index, startedAt)
          throw error
        }
      }

      templateResults.push({
        template_id: template.id,
        template_name: templateName,
        groups_total: groups.length,
        groups_completed: groups.length,
        outputs: templateOutputs,
      })
    }

    await this.emitProgress({
      task_id: config.taskId,
      total_groups: groupsTotal,
      completed: groupsCompleted - skipped,
      failed,
      skipped,
      current_group: null,
      current_stage: cancelled ? 'cancelled' : 'task_complete',
      verified_outputs: verifiedOutputs,
      template_total: templatePaths.length,
      groups_completed: groupsCompleted,
    })

    return {
      ok: !cancelled,
      task_id: config.taskId,
      output_layout: outputLayout,
      ...(cancelled ? { cancelled: true } : {}),
      ...(logPath ? { log_path: logPath } : {}),
      templates_total: templatePaths.length,
      groups_total: groupsTotal,
      groups_completed: groupsCompleted,
      outputs: allOutputs,
      templates: templateResults,
      result_groups: resultGroups,
    }
  }

  private async emitProgress(progress: PhotoshopProgressInfo): Promise<void> {
    await this.onProgress?.(progress)
  }

  private async emitLog(entry: PhotoshopProgressLogEntry): Promise<void> {
    await this.onLog?.(entry)
  }
}

export async function runBatch(
  prints: PhotoshopPrintAsset[],
  templatePaths: string[],
  config: PhotoshopBatchConfig,
  options: PhotoshopMultiBatchOptions = {},
): Promise<PhotoshopBatchResult> {
  return new PhotoshopMultiBatchRunner(options).runBatch(prints, templatePaths, config)
}

export function createCompletedJobResult(outputs: string[]): PhotoshopJobResult {
  return { ok: true, outputs, attempts: 1 }
}

function batchOutputGroup(
  template: PsdTemplate,
  group: PhotoshopTaskGroup,
  outputs: string[],
  status: PhotoshopBatchOutputGroup['status'],
): PhotoshopBatchOutputGroup {
  return {
    template_id: template.id,
    template_name: group.template_name,
    group_index: group.group_index,
    sku_folder: group.sku_folder,
    print_ids: group.print_assets.map((asset) => asset.id),
    outputs,
    status,
  }
}
