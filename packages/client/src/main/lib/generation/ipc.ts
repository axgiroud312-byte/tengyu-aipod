import { randomUUID } from 'node:crypto'
import { ipcMain } from 'electron'
import { readAppConfig } from '../../onboarding'
import { type ComfyuiWorkflowSummary, comfyuiWorkflowCacheManager } from '../comfyui-workflow-cache'
import {
  type DiagnosticLogWriter,
  createOptionalDiagnosticLogWriter,
  errorForDiagnosticLog,
} from '../diagnostic-log-service'
import { parsePrompts, promptGeneratorService } from '../prompt-generator-service'
import {
  getChenyuWorkflowInfo,
  listChenyuWorkflowMarket,
  runChenyuWorkflow,
} from './capabilities/chenyu-workflow'
import { runComfyuiExtract, runExtract } from './capabilities/extract'
import { runComfyuiImg2img } from './capabilities/img2img'
import {
  runComfyuiExtractMatting,
  runComfyuiMatting,
  runMixedMatting,
} from './capabilities/matting'
import { runComfyuiTxt2img, runTxt2img } from './capabilities/txt2img'
import {
  type GenerationServiceDependencies,
  appErrorMessage,
  clampInt,
  createGenerationDebugLogger,
  promptGenerationErrorDetails,
  promptPreview,
  promptSkillCategory,
} from './runtime'
import {
  chenyuWorkflowInfoInputSchema,
  chenyuWorkflowMarketListInputSchema,
  chenyuWorkflowRunInputSchema,
  comfyuiExtractMattingRunInputSchema,
  comfyuiExtractRunInputSchema,
  comfyuiImg2imgRunInputSchema,
  comfyuiMattingRunInputSchema,
  comfyuiTxt2imgRunInputSchema,
  extractRunInputSchema,
  generationCancelInputSchema,
  generationPromptInputSchema,
  manualPromptsTextInputSchema,
  mixedMattingRunInputSchema,
  parseGenerationIpcInput,
  resolveImg2imgReferencesInputSchema,
  scanGenerationImageFolderInputSchema,
  txt2imgRunInputSchema,
} from './schemas'
import {
  chooseGenerationImageFolder,
  listExtractSources,
  listImg2imgSources,
  resolveImg2imgReferences,
  scanGenerationImageFolder,
} from './sources'
import { requestGenerationTaskCancel } from './task-registry'
import type { GenerationPromptInput, Txt2imgPromptDraft } from './types'

export function requestGenerationCancel(taskId: string) {
  if (!requestGenerationTaskCancel(taskId)) {
    return false
  }
  createGenerationDebugLogger({}, { taskId })('任务已请求取消', 'warn', {
    operation: 'cancel',
  })
  return true
}

export async function listComfyuiImg2imgWorkflows(
  dependencies: {
    workflowCache?: Pick<typeof comfyuiWorkflowCacheManager, 'listWorkflows'>
  } = {},
): Promise<ComfyuiWorkflowSummary[]> {
  const workflowCache = dependencies.workflowCache ?? comfyuiWorkflowCacheManager
  const workflows = await workflowCache.listWorkflows('img2img')
  return workflows.filter((workflow) => workflow.capability === 'img2img')
}

export async function listComfyuiTxt2imgWorkflows(
  dependencies: {
    workflowCache?: Pick<typeof comfyuiWorkflowCacheManager, 'listWorkflows'>
  } = {},
): Promise<ComfyuiWorkflowSummary[]> {
  const workflowCache = dependencies.workflowCache ?? comfyuiWorkflowCacheManager
  const workflows = await workflowCache.listWorkflows('txt2img')
  return workflows.filter((workflow) => workflow.capability === 'txt2img')
}

export async function listComfyuiExtractWorkflows(
  dependencies: {
    workflowCache?: Pick<typeof comfyuiWorkflowCacheManager, 'listWorkflows'>
  } = {},
): Promise<ComfyuiWorkflowSummary[]> {
  const workflowCache = dependencies.workflowCache ?? comfyuiWorkflowCacheManager
  const workflows = await workflowCache.listWorkflows('extract')
  return workflows.filter((workflow) => workflow.capability === 'extract')
}

export async function listComfyuiMattingWorkflows(
  dependencies: {
    workflowCache?: Pick<typeof comfyuiWorkflowCacheManager, 'listWorkflows'>
  } = {},
): Promise<ComfyuiWorkflowSummary[]> {
  const workflowCache = dependencies.workflowCache ?? comfyuiWorkflowCacheManager
  const workflows = await workflowCache.listWorkflows('matting')
  return workflows.filter((workflow) => workflow.capability === 'matting')
}

export async function listComfyuiMixedMattingWorkflows(
  dependencies: {
    workflowCache?: Pick<typeof comfyuiWorkflowCacheManager, 'listWorkflows'>
  } = {},
): Promise<ComfyuiWorkflowSummary[]> {
  const workflowCache = dependencies.workflowCache ?? comfyuiWorkflowCacheManager
  const workflows = await workflowCache.listWorkflows('matting-mixed')
  return workflows.filter((workflow) => workflow.capability === 'matting-mixed')
}

export async function generateTxt2imgPrompts(input: GenerationPromptInput) {
  const count = clampInt(input.count, 1, 1000, 5)
  const capability = input.capability ?? 'txt2img'
  const promptCategory = promptSkillCategory(capability, input.printMode)
  const selectedSkillId = input.skillId?.trim()
  const selectedSkillVersion = input.skillVersion?.trim()
  const debug = createGenerationDebugLogger({}, { capability })
  debug('开始生成提示词', 'info', {
    operation: 'prompt',
    count,
    model: input.model ?? null,
    skillId: selectedSkillId || undefined,
    skillVersion: selectedSkillVersion || undefined,
    skillCategory: selectedSkillId ? undefined : promptCategory,
    referenceImageCount: input.referenceImages?.length ?? 0,
    printMode: input.printMode ?? 'local',
    requirement: input.requirement ? promptPreview(input.requirement, 240) : undefined,
  })
  let diagnostics: DiagnosticLogWriter | null = null
  try {
    const workbenchConfig = await readAppConfig()
    diagnostics = await createOptionalDiagnosticLogWriter({
      module: 'generation',
      runId: `prompt_${Date.now()}`,
      workbenchRoot: workbenchConfig.workbench_root,
      meta: {
        operation: 'prompt_generation',
        capability,
        count,
        model: input.model ?? null,
        skillId: selectedSkillId || null,
        skillVersion: selectedSkillVersion || null,
        skillCategory: selectedSkillId ? null : promptCategory,
        printMode: input.printMode ?? 'local',
        referenceImageCount: input.referenceImages?.length ?? 0,
      },
    })
    if (diagnostics) {
      debug('诊断日志已创建', 'info', {
        operation: 'prompt',
        promptRunId: diagnostics.runId,
        savedPath: diagnostics.path,
      })
    } else {
      debug('未写入诊断日志：未设置工作区', 'warn', {
        operation: 'prompt',
      })
    }
  } catch (error) {
    debug('诊断日志创建失败', 'warn', {
      operation: 'prompt',
      error: appErrorMessage(error),
    })
  }
  try {
    const prompts = await promptGeneratorService.generatePrompts({
      ...(selectedSkillId
        ? {
            skillId: selectedSkillId,
            ...(selectedSkillVersion ? { skillVersion: selectedSkillVersion } : {}),
          }
        : { category: promptCategory }),
      variables: {
        printMode: input.printMode === 'full' ? '满印' : '局部',
        requirement: input.requirement,
        count,
        modeInstruction: input.modeInstruction ?? '',
      },
      count,
      ...(diagnostics ? { diagnostics } : {}),
      ...(input.model ? { model: input.model } : {}),
      ...(input.referenceImages?.length ? { refImages: input.referenceImages } : {}),
      userMessage:
        input.modeInstruction ??
        `生成 ${count} 条适合 Grsai ${capability === 'img2img' ? '图生图' : '文生图'}的英文印花提示词。`,
      responseFormat: 'json_object',
      onRawResponse: async (response) => {
        debug('百炼原始返回', 'debug', {
          operation: 'prompt',
          expected: response.expected,
          rawResponsePreview: promptPreview(response.text, 800),
          responseModel: response.model,
          finishReason: response.finishReason,
          chunkIndex: response.chunkIndex,
          chunkTotal: response.chunkTotal,
          savedPath: diagnostics?.path ?? null,
        })
      },
    })

    debug('提示词生成完成', 'info', {
      operation: 'prompt',
      count: prompts.length,
    })
    prompts.forEach((prompt, index) => {
      debug('百炼返回提示词', 'debug', {
        operation: 'prompt',
        promptIndex: index + 1,
        total: prompts.length,
        prompt: promptPreview(prompt, 300),
      })
    })
    return prompts.map((text) => ({
      id: randomUUID(),
      text,
      selected: true,
    })) satisfies Txt2imgPromptDraft[]
  } catch (error) {
    await diagnostics?.append({
      type: 'error',
      provider: 'aliyun-bailian',
      operation: 'prompt_generation',
      error: errorForDiagnosticLog(error),
    })
    debug('提示词生成失败', 'error', {
      operation: 'prompt',
      error: appErrorMessage(error),
      ...promptGenerationErrorDetails(error),
    })
    throw error
  }
}

export function parseManualPrompts(text: string) {
  return parsePrompts(text, 200)
}

export function registerGenerationIpc() {
  ipcMain.handle('generation:generate-prompts', (_event, input: unknown) =>
    generateTxt2imgPrompts(
      parseGenerationIpcInput(generationPromptInputSchema, input, '生图提示词参数不正确'),
    ),
  )
  ipcMain.handle('generation:choose-image-folder', () => chooseGenerationImageFolder())
  ipcMain.handle('generation:scan-image-folder', (_event, input: unknown) =>
    scanGenerationImageFolder(
      parseGenerationIpcInput(scanGenerationImageFolderInputSchema, input, '图片文件夹参数不正确'),
    ),
  )
  ipcMain.handle('generation:list-extract-sources', () => listExtractSources())
  ipcMain.handle('generation:list-img2img-sources', () => listImg2imgSources())
  ipcMain.handle('generation:resolve-img2img-references', (_event, input: unknown) =>
    resolveImg2imgReferences(
      parseGenerationIpcInput(resolveImg2imgReferencesInputSchema, input, '图生图参考图参数不正确'),
    ),
  )
  ipcMain.handle('generation:list-comfyui-txt2img-workflows', () => listComfyuiTxt2imgWorkflows())
  ipcMain.handle('generation:list-comfyui-img2img-workflows', () => listComfyuiImg2imgWorkflows())
  ipcMain.handle('generation:list-comfyui-extract-workflows', () => listComfyuiExtractWorkflows())
  ipcMain.handle('generation:list-comfyui-matting-workflows', () => listComfyuiMattingWorkflows())
  ipcMain.handle('generation:list-comfyui-mixed-matting-workflows', () =>
    listComfyuiMixedMattingWorkflows(),
  )
  ipcMain.handle('generation:list-chenyu-workflows', (_event, input: unknown) =>
    listChenyuWorkflowMarket(
      parseGenerationIpcInput(
        chenyuWorkflowMarketListInputSchema,
        input,
        '晨羽工作流查询参数不正确',
      ) ?? {},
    ),
  )
  ipcMain.handle('generation:get-chenyu-workflow', (_event, input: unknown) =>
    getChenyuWorkflowInfo(
      parseGenerationIpcInput(chenyuWorkflowInfoInputSchema, input, '晨羽工作流详情参数不正确')
        .workflowId,
    ),
  )
  ipcMain.handle('generation:parse-manual-prompts', (_event, text: unknown) =>
    parseManualPrompts(
      parseGenerationIpcInput(manualPromptsTextInputSchema, text, '手动提示词文本参数不正确'),
    ),
  )
  ipcMain.handle('generation:run-txt2img', (_event, input: unknown) =>
    runTxt2img(parseGenerationIpcInput(txt2imgRunInputSchema, input, '文生图任务参数不正确')),
  )
  ipcMain.handle('generation:run-comfyui-txt2img', (_event, input: unknown) =>
    runComfyuiTxt2img(
      parseGenerationIpcInput(comfyuiTxt2imgRunInputSchema, input, 'ComfyUI 文生图任务参数不正确'),
    ),
  )
  ipcMain.handle('generation:run-extract', (_event, input: unknown) =>
    runExtract(parseGenerationIpcInput(extractRunInputSchema, input, '提取任务参数不正确')),
  )
  ipcMain.handle('generation:run-comfyui-extract', (_event, input: unknown) =>
    runComfyuiExtract(
      parseGenerationIpcInput(comfyuiExtractRunInputSchema, input, 'ComfyUI 提取任务参数不正确'),
    ),
  )
  ipcMain.handle('generation:run-comfyui-extract-matting', (_event, input: unknown) =>
    runComfyuiExtractMatting(
      parseGenerationIpcInput(
        comfyuiExtractMattingRunInputSchema,
        input,
        'ComfyUI 提取抠图任务参数不正确',
      ),
    ),
  )
  ipcMain.handle('generation:run-comfyui-matting', (_event, input: unknown) =>
    runComfyuiMatting(
      parseGenerationIpcInput(comfyuiMattingRunInputSchema, input, 'ComfyUI 抠图任务参数不正确'),
    ),
  )
  ipcMain.handle('generation:run-mixed-matting', (_event, input: unknown) =>
    runMixedMatting(
      parseGenerationIpcInput(mixedMattingRunInputSchema, input, '混合抠图任务参数不正确'),
    ),
  )
  ipcMain.handle('generation:run-comfyui-img2img', (_event, input: unknown) =>
    runComfyuiImg2img(
      parseGenerationIpcInput(comfyuiImg2imgRunInputSchema, input, 'ComfyUI 图生图任务参数不正确'),
    ),
  )
  ipcMain.handle('generation:run-chenyu-workflow', (_event, input: unknown) =>
    runChenyuWorkflow(
      parseGenerationIpcInput(chenyuWorkflowRunInputSchema, input, '晨羽工作流运行参数不正确'),
    ),
  )
  ipcMain.handle('generation:cancel', (_event, input: unknown) => ({
    ok: requestGenerationCancel(
      parseGenerationIpcInput(generationCancelInputSchema, input, '生图取消参数不正确').task_id,
    ),
  }))
}
