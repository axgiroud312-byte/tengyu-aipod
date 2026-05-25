import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import type {
  PhotoshopBatchResult,
  PhotoshopBatchTemplateResult,
  PhotoshopClipMode,
  PhotoshopExportFormat,
  PhotoshopJobResult,
  PhotoshopPrintAsset,
  PhotoshopProgressInfo,
  PhotoshopProgressLogEntry,
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
  format?: PhotoshopExportFormat
  jpgQuality?: number
  clipMode?: PhotoshopClipMode
  skipCompleted?: boolean
  maxRetries?: number
}

interface PhotoshopMultiBatchOptions {
  scanner?: Pick<PsdScanner, 'scanPsd'>
  engine?: Pick<PhotoshopExecutionEngine, 'runJob'>
  onProgress?: (progress: PhotoshopProgressInfo) => void | Promise<void>
  progressLogger?: Pick<PhotoshopProgressLogger, 'write'> | null
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
  private readonly engine: Pick<PhotoshopExecutionEngine, 'runJob'>
  private readonly onProgress:
    | ((progress: PhotoshopProgressInfo) => void | Promise<void>)
    | undefined
  private readonly progressLogger: Pick<PhotoshopProgressLogger, 'write'> | null | undefined

  constructor(options: PhotoshopMultiBatchOptions = {}) {
    this.scanner = options.scanner ?? psdScanner
    this.engine = options.engine ?? photoshopExecutionEngine
    this.onProgress = options.onProgress
    this.progressLogger = options.progressLogger
  }

  async runBatch(
    prints: PhotoshopPrintAsset[],
    templatePaths: string[],
    config: PhotoshopBatchConfig,
  ): Promise<PhotoshopBatchResult> {
    const templateResults: PhotoshopBatchTemplateResult[] = []
    const allOutputs: string[] = []
    let groupsCompleted = 0
    let groupsTotal = 0
    let failed = 0
    let skipped = 0
    let verifiedOutputs = 0
    const logger =
      this.progressLogger === undefined
        ? await PhotoshopProgressLogger.create(config.taskId)
        : this.progressLogger

    logger?.write({ ts: Date.now(), level: 'info', stage: 'task_start' })

    for (let templateIndex = 0; templateIndex < templatePaths.length; templateIndex += 1) {
      const template = await this.scanner.scanPsd(templatePaths[templateIndex] ?? '')
      const templateName = sanitizeTemplateName(template.file_path)
      const groupOptions: GroupPhotoshopTasksOptions = {
        taskId: config.taskId,
        outputRoot: config.outputRoot,
      }
      if (config.replaceRange !== undefined) {
        groupOptions.replaceRange = config.replaceRange
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

      const templateOutputs: string[] = []
      for (const group of groups) {
        await this.emitProgress({
          task_id: config.taskId,
          total_groups: groupsTotal,
          completed: groupsCompleted,
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
            completed: groupsCompleted,
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
          })
        } catch (error) {
          failed += 1
          logger?.write({
            ts: Date.now(),
            level: 'error',
            stage: 'group_complete',
            group: group.group_index,
            error: error instanceof Error ? error.message : String(error),
            duration_ms: Date.now() - startedAt,
          })
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

    return {
      ok: true,
      task_id: config.taskId,
      templates_total: templatePaths.length,
      groups_total: groupsTotal,
      groups_completed: groupsCompleted,
      outputs: allOutputs,
      templates: templateResults,
    }
  }

  private async emitProgress(progress: PhotoshopProgressInfo): Promise<void> {
    await this.onProgress?.(progress)
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
