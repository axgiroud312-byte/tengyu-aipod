import type {
  PhotoshopBatchResult,
  PhotoshopBatchTemplateResult,
  PhotoshopClipMode,
  PhotoshopExportFormat,
  PhotoshopJobResult,
  PhotoshopPrintAsset,
  PsdTemplate,
} from '@tengyu-aipod/shared'
import {
  type GroupPhotoshopTasksOptions,
  groupTasks,
  sanitizeTemplateName,
} from '@tengyu-aipod/shared'
import { type PhotoshopExecutionEngine, photoshopExecutionEngine } from './execution-engine'
import { type PsdScanner, deriveClipAreas, psdScanner } from './psd-scanner'

export interface PhotoshopBatchConfig {
  taskId: string
  outputRoot: string
  replaceRange?: GroupPhotoshopTasksOptions['replaceRange']
  format?: PhotoshopExportFormat
  jpgQuality?: number
  clipMode?: PhotoshopClipMode
  maxRetries?: number
}

export interface PhotoshopBatchProgress {
  template_index: number
  template_total: number
  template_name: string
  group_index: number
  group_total: number
  groups_completed: number
}

interface PhotoshopMultiBatchOptions {
  scanner?: Pick<PsdScanner, 'scanPsd'>
  engine?: Pick<PhotoshopExecutionEngine, 'runJob'>
  onProgress?: (progress: PhotoshopBatchProgress) => void | Promise<void>
}

export class PhotoshopMultiBatchRunner {
  private readonly scanner: Pick<PsdScanner, 'scanPsd'>
  private readonly engine: Pick<PhotoshopExecutionEngine, 'runJob'>
  private readonly onProgress:
    | ((progress: PhotoshopBatchProgress) => void | Promise<void>)
    | undefined

  constructor(options: PhotoshopMultiBatchOptions = {}) {
    this.scanner = options.scanner ?? psdScanner
    this.engine = options.engine ?? photoshopExecutionEngine
    this.onProgress = options.onProgress
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
          template_index: templateIndex,
          template_total: templatePaths.length,
          template_name: templateName,
          group_index: group.group_index,
          group_total: groups.length,
          groups_completed: groupsCompleted,
        })

        const result = await this.engine.runJob(group.job, config.maxRetries ?? 0)
        groupsCompleted += 1
        templateOutputs.push(...result.outputs)
        allOutputs.push(...result.outputs)
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

  private async emitProgress(progress: PhotoshopBatchProgress): Promise<void> {
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
