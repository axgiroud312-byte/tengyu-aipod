import { join } from 'node:path'
import {
  AppErrorClass,
  type GenerationCapability,
  WORKBENCH_DIRECTORIES,
} from '@tengyu-aipod/shared'
import { BrowserWindow } from 'electron'
import { readAppConfig } from '../../onboarding'
import type { ChenyuInstanceInfo } from '../chenyu-cloud-client'
import type { ChenyuWorkflowRunner } from '../chenyu-workflow-runner'
import type { ComfyuiChenyuAdapter } from '../comfyui-chenyu-adapter'
import type { ComfyuiInstanceSummary } from '../comfyui-instance-manager'
import type {
  ComfyuiWorkflowCategory,
  comfyuiWorkflowCacheManager,
} from '../comfyui-workflow-cache'
import {
  type DiagnosticLogWriter,
  createOptionalDiagnosticLogWriter,
} from '../diagnostic-log-service'
import type { GrsaiAdapter } from '../grsai-adapter'
import type { getSecret } from '../keychain'
import type { promptGeneratorService } from '../prompt-generator-service'
import type { skillCacheManager } from '../skill-cache'
import type { SqliteDatabase } from '../sqlite'
import { type TempFileManager, tempFileManager } from '../temp-file-manager'
import {
  openWorkbenchDatabase as openWorkbenchDatabaseFile,
  workbenchDatabasePath,
} from '../workbench-db'
import {
  beginGenerationTask,
  finishGenerationTask,
  markGenerationResultCancelled,
} from './task-registry'
import type {
  GenerationDebugLogDetails,
  GenerationDebugLogEntry,
  GenerationDebugLogLevel,
  GenerationImageCompletePayload,
  GenerationProgress,
  GenerationRunResult,
  GenerationTaskEvent,
} from './types'

export type GenerationDatabase = Pick<SqliteDatabase, 'exec' | 'prepare' | 'close'>

export type GenerationDebugLogContext = {
  taskId?: string | undefined
  capability?: GenerationCapability | undefined
}

export type GenerationServiceDependencies = {
  readConfig?: typeof readAppConfig
  getSecret?: typeof getSecret
  openDatabase?: (workbenchRoot: string) => GenerationDatabase
  skillCache?: Pick<typeof skillCacheManager, 'getSkill' | 'listSkills'>
  workflowCache?: Pick<typeof comfyuiWorkflowCacheManager, 'listWorkflows' | 'get'>
  promptGenerator?: Pick<typeof promptGeneratorService, 'generatePrompts'>
  createGrsaiAdapter?: (apiKey: string) => Pick<GrsaiAdapter, 'generate'>
  createComfyuiAdapter?: (input: {
    apiKey: string
    workbenchRoot: string
    instance?: ComfyuiInstanceSummary
    diagnostics?: DiagnosticLogWriter
  }) => Pick<ComfyuiChenyuAdapter, 'generate'>
  getChenyuInstanceInfo?: (input: {
    apiKey: string
    instanceUuid: string
  }) => Promise<ChenyuInstanceInfo>
  createChenyuWorkflowRunner?: (input: {
    apiKey: string
    workbenchRoot: string
    diagnostics?: DiagnosticLogWriter
  }) => Pick<ChenyuWorkflowRunner, 'listWorkflows' | 'getWorkflowInfo' | 'runImageWorkflow'>
  downloadImage?: (url: string) => Promise<Buffer>
  emitProgress?: (progress: GenerationProgress) => void
  emitDebugLog?: (entry: GenerationDebugLogEntry) => void
  onImageComplete?: (image: GenerationImageCompletePayload) => void | Promise<void>
  tempFiles?: Pick<TempFileManager, 'createTaskDir' | 'cleanupTask'>
}

export const GENERATION_CAPABILITY_FOLDERS = {
  txt2img: '文生图',
  img2img: '图生图',
  extract: '提取',
  matting: '抠图',
} satisfies Record<GenerationCapability, string>

const GENERATION_TASK_PREFIX: Record<GenerationCapability, string> = {
  txt2img: '文生图',
  img2img: '图生图',
  extract: '提取',
  matting: '抠图',
}

let generationDebugLogSequence = 0

export function submitGenerationTask(taskId: string, run: () => Promise<GenerationRunResult>) {
  beginGenerationTask(taskId)
  void run()
    .then((result) => {
      emitCompleted({ ok: true, result: markGenerationResultCancelled(result) })
    })
    .catch((error) => {
      emitCompleted({ ok: false, taskId, error: appErrorMessage(error) })
    })
    .finally(() => {
      finishGenerationTask(taskId)
    })
}

export function openWorkbenchDatabase(workbenchRoot: string) {
  return openWorkbenchDatabaseFile(workbenchDatabasePath(workbenchRoot))
}

export function createGenerationDiagnostics(
  workbenchRoot: string,
  taskId: string,
  meta: Record<string, unknown>,
) {
  return createOptionalDiagnosticLogWriter({
    module: 'generation',
    taskId,
    workbenchRoot,
    meta,
  })
}

export async function finishGenerationResultWithDiagnostics(
  diagnostics: DiagnosticLogWriter | null,
  result: GenerationRunResult,
  provider: string,
  operation: string,
) {
  const finalResult = markGenerationResultCancelled(result)
  await diagnostics
    ?.append({
      type: 'task_completed',
      provider,
      operation,
      data: {
        total: finalResult.total,
        succeeded: finalResult.succeeded,
        failed: finalResult.failed,
        cancelled: finalResult.cancelled ?? false,
      },
    })
    .catch(() => null)
  return finalResult
}

export async function readWorkbenchRoot(readConfig: typeof readAppConfig = readAppConfig) {
  const workbenchConfig = await readConfig()
  if (!workbenchConfig.workbench_root) {
    throw new AppErrorClass('HTTP_4XX', '请先在设置里选择工作区', false)
  }
  return workbenchConfig.workbench_root
}

export function safeBaseName(value: string) {
  const safe = (value || 'print').replace(/[\\/:*?"<>|]/g, '_').trim()
  return safe || 'print'
}

export function timestampSlug(value = Date.now()) {
  const date = new Date(value)
  const pad = (input: number, length = 2) => String(input).padStart(length, '0')
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`
}

export function generationTaskId(
  inputTaskId: string | undefined,
  capability: GenerationCapability,
) {
  const custom = inputTaskId?.trim()
  return safeBaseName(custom || `${GENERATION_TASK_PREFIX[capability]}-${timestampSlug()}`)
}

export function generationTaskOutputFolder(
  workbenchRoot: string,
  capability: GenerationCapability,
  taskId: string,
) {
  return join(
    workbenchRoot,
    WORKBENCH_DIRECTORIES.generation,
    GENERATION_CAPABILITY_FOLDERS[capability],
    safeBaseName(taskId),
  )
}

export function appErrorMessage(error: unknown) {
  if (error instanceof AppErrorClass) {
    return error.message
  }
  if (error instanceof Error) {
    return error.message
  }
  return String(error)
}

export function emitProgress(progress: GenerationProgress) {
  for (const window of BrowserWindow.getAllWindows()) {
    window.webContents.send('generation:progress', progress)
  }
}

export function emitCompleted(event: GenerationTaskEvent) {
  for (const window of BrowserWindow.getAllWindows()) {
    window.webContents.send('generation:completed', event)
  }
  if (event.ok) {
    createGenerationDebugLogger(
      {},
      { taskId: event.result.taskId, capability: capabilityFromResult(event.result) },
    )('任务完成', event.result.failed > 0 ? 'warn' : 'info', {
      operation: 'completed',
      total: event.result.total,
      succeeded: event.result.succeeded,
      failed: event.result.failed,
      savedPath: event.result.images[0]?.localPath ?? null,
    })
    return
  }
  createGenerationDebugLogger({}, { taskId: event.taskId })('任务失败', 'error', {
    operation: 'completed',
    error: event.error,
  })
}

export function emitGenerationDebugLog(entry: GenerationDebugLogEntry) {
  for (const window of BrowserWindow.getAllWindows()) {
    window.webContents.send('generation:debug-log', entry)
  }
}

export function createGenerationDebugLogger(
  dependencies: Pick<GenerationServiceDependencies, 'emitDebugLog'> = {},
  baseContext: GenerationDebugLogContext = {},
) {
  const emit = dependencies.emitDebugLog ?? emitGenerationDebugLog
  return (
    message: string,
    level: GenerationDebugLogLevel = 'info',
    details?: GenerationDebugLogDetails,
    context: GenerationDebugLogContext = {},
  ) => {
    const nextContext = { ...baseContext, ...context }
    emit({
      id: `${Date.now()}-${++generationDebugLogSequence}`,
      timestamp: Date.now(),
      level,
      message,
      ...(nextContext.taskId ? { taskId: nextContext.taskId } : {}),
      ...(nextContext.capability ? { capability: nextContext.capability } : {}),
      ...(details ? { details: compactGenerationDebugDetails(details) } : {}),
    })
  }
}

export function createGenerationProgressEmitter(
  dependencies: Pick<GenerationServiceDependencies, 'emitProgress' | 'emitDebugLog'>,
) {
  const emit = dependencies.emitProgress ?? emitProgress
  const debug = createGenerationDebugLogger(dependencies)
  return (progress: GenerationProgress) => {
    emit(progress)
    debug(
      generationProgressMessage(progress),
      'debug',
      {
        operation: 'progress',
        processed: progress.processed,
        total: progress.total,
        succeeded: progress.succeeded,
        failed: progress.failed,
        prompt: progress.current_prompt ? promptPreview(progress.current_prompt) : undefined,
      },
      { taskId: progress.task_id, capability: progress.capability },
    )
  }
}

export async function emitImageComplete(
  dependencies: Pick<GenerationServiceDependencies, 'onImageComplete' | 'emitDebugLog'>,
  payload: GenerationImageCompletePayload,
) {
  if (!dependencies.onImageComplete) {
    return
  }
  try {
    await dependencies.onImageComplete(payload)
  } catch (error) {
    createGenerationDebugLogger(dependencies, {
      taskId: payload.taskId,
      capability: payload.capability,
    })('逐张完成回调失败', 'warn', {
      operation: 'onImageComplete',
      error: appErrorMessage(error),
      printId: payload.printId,
      artifactId: payload.artifactId ?? null,
      path: payload.path,
    })
  }
}

export function generationProgressMessage(progress: GenerationProgress) {
  if (progress.total > 0 && progress.processed >= progress.total) {
    return progress.failed > 0 ? '任务处理完成，有失败项' : '任务处理完成'
  }
  if (progress.current_prompt) {
    return '正在处理提示词'
  }
  if (progress.processed === 0) {
    return '任务开始处理'
  }
  return '任务进度更新'
}

export function capabilityFromResult(
  result: GenerationRunResult,
): GenerationCapability | undefined {
  const image = result.images[0]
  const capability = image?.localPath
    ? (Object.entries(GENERATION_CAPABILITY_FOLDERS).find(([, folder]) =>
        image.localPath?.includes(folder),
      )?.[0] as GenerationCapability | undefined)
    : undefined
  return capability
}

export function compactGenerationDebugDetails(details: GenerationDebugLogDetails) {
  return Object.fromEntries(
    Object.entries(details).filter((entry): entry is [string, string | number | boolean | null] => {
      return entry[1] !== undefined
    }),
  )
}

export function promptPreview(prompt: string, maxLength = 120) {
  const normalized = prompt.replace(/\s+/g, ' ').trim()
  if (normalized.length <= maxLength) {
    return normalized
  }
  return `${normalized.slice(0, maxLength)}...`
}

export { tempFileManager }
