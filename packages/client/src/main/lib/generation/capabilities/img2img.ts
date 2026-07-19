import { basename } from 'node:path'
import { AppErrorClass } from '@tengyu-aipod/shared'
import { type DiagnosticLogWriter, errorForDiagnosticLog } from '../../diagnostic-log-service'
import type { GenerateRequest } from '../../grsai-adapter'
import { getSecret } from '../../keychain'
import { promptGeneratorService } from '../../prompt-generator-service'
import { generationFailureFromError } from '../failures'
import {
  type GenerationServiceDependencies,
  appErrorMessage,
  assertLocalComfyuiWorkflowExists,
  comfyuiImg2imgBatchSize,
  comfyuiImg2imgPromptMode,
  comfyuiInstanceLocks,
  comfyuiRunOptions,
  comfyuiSizePx,
  comfyuiSourceArtifactIds,
  createComfyuiAdapterForRun,
  createGenerationDebugLogger,
  createGenerationDiagnostics,
  createGenerationProgressEmitter,
  emitComfyuiRequestLog,
  emitImageComplete,
  emitImg2imgProgress,
  emitPromptResolved,
  finishGenerationResultWithDiagnostics,
  generationImageIdentity,
  generationTaskId,
  localPathFromGeneratedImage,
  openWorkbenchDatabase,
  promptGenerationErrorDetails,
  promptGeneratorDependencies,
  promptPreview,
  promptSkillCategory,
  readReferenceForArtifact,
  readWorkbenchRoot,
  requestedComfyuiSourceCount,
  submitGenerationTask,
  workflowLogDetails,
} from '../runtime'
import { isGenerationCancelled } from '../task-registry'
import type { ComfyuiImg2imgRunInput, GenerationRunResult, Img2imgReferencePayload } from '../types'

type Img2imgReference = Img2imgReferencePayload

async function resolveComfyuiImg2imgPromptForSource(
  input: ComfyuiImg2imgRunInput,
  source: Img2imgReference,
  context: {
    sourceIndex: number
    total: number
    diagnostics: DiagnosticLogWriter | null
    dependencies: GenerationServiceDependencies
    debug: ReturnType<typeof createGenerationDebugLogger>
  },
) {
  const promptMode = comfyuiImg2imgPromptMode(input)
  if (promptMode === 'workflow') {
    return ''
  }
  if (promptMode === 'manual') {
    const prompt = input.prompt?.trim() ?? ''
    if (!prompt) {
      throw new AppErrorClass('HTTP_4XX', '请填写图生图提示词', false, {
        provider: 'comfyui-chenyu',
        promptMode,
      })
    }
    return prompt
  }
  if (input.resolvedPrompt !== undefined) {
    const prompt = input.resolvedPrompt.trim()
    if (!prompt) {
      throw new AppErrorClass('HTTP_4XX', '已保存的图生图提示词为空，无法安全续跑', false, {
        provider: 'comfyui-chenyu',
        promptMode,
        sourceIndex: context.sourceIndex,
        sourceArtifactId: source.artifactId,
      })
    }
    return prompt
  }

  const promptCategory = promptSkillCategory('img2img', input.printMode)
  const selectedSkillId = input.promptSkillId?.trim()
  const selectedSkillVersion = input.promptSkillVersion?.trim()
  context.debug('开始为源图生成提示词', 'info', {
    operation: 'prompt',
    provider: 'aliyun-bailian',
    promptMode,
    sourceIndex: context.sourceIndex,
    total: context.total,
    model: input.promptModel ?? null,
    skillId: selectedSkillId || undefined,
    skillVersion: selectedSkillVersion || undefined,
    skillCategory: selectedSkillId ? undefined : promptCategory,
    printMode: input.printMode ?? 'local',
    requirement: input.requirement ? promptPreview(input.requirement, 240) : undefined,
  })
  try {
    const prompts = await promptGeneratorService.generatePrompts(
      {
        ...(selectedSkillId
          ? {
              skillId: selectedSkillId,
              ...(selectedSkillVersion ? { skillVersion: selectedSkillVersion } : {}),
            }
          : { category: promptCategory }),
        variables: {
          printMode: input.printMode === 'full' ? '满印' : '局部',
          requirement: input.requirement ?? '',
          count: 1,
          modeInstruction: input.modeInstruction ?? '',
        },
        count: 1,
        refImages: [source.reference],
        userMessage:
          input.modeInstruction ?? '根据这张源图生成 1 条适合 ComfyUI 图生图的英文印花提示词。',
        responseFormat: 'json_object',
        ...(context.diagnostics ? { diagnostics: context.diagnostics } : {}),
        ...(input.promptModel ? { model: input.promptModel } : {}),
        onRawResponse: async (response) => {
          context.debug('百炼原始返回', 'debug', {
            operation: 'prompt',
            provider: 'aliyun-bailian',
            promptMode,
            sourceIndex: context.sourceIndex,
            expected: response.expected,
            rawResponsePreview: promptPreview(response.text, 800),
            responseModel: response.model,
            finishReason: response.finishReason,
          })
        },
      },
      {
        ...promptGeneratorDependencies(context.dependencies),
      },
    )
    const prompt = prompts[0]?.trim()
    if (!prompt) {
      throw new AppErrorClass('PROMPT_PARSE_FAILED', '百炼未返回可用提示词', true, {
        provider: 'aliyun-bailian',
        expected: 1,
        actual: prompts.length,
      })
    }
    context.debug('源图提示词生成完成', 'info', {
      operation: 'prompt',
      provider: 'aliyun-bailian',
      promptMode,
      sourceIndex: context.sourceIndex,
      prompt: promptPreview(prompt, 300),
    })
    await context.diagnostics
      ?.append({
        type: 'prompt_resolved',
        provider: 'aliyun-bailian',
        operation: 'comfyui_img2img_prompt',
        itemKey: source.artifactId,
        data: {
          sourceIndex: context.sourceIndex,
          sourceArtifactId: source.artifactId,
          sourcePath: source.imagePath,
          promptMode,
          prompt: promptPreview(prompt, 300),
          model: input.promptModel ?? null,
          skillId: selectedSkillId || null,
          skillVersion: selectedSkillVersion || null,
          skillCategory: selectedSkillId ? null : promptCategory,
        },
      })
      .catch(() => null)
    return prompt
  } catch (error) {
    const wrapped = new AppErrorClass(
      'COMFYUI_IMG2IMG_PROMPT_FAILED',
      `AI 写提示词失败：${appErrorMessage(error)}`,
      true,
      {
        provider: 'aliyun-bailian',
        sourceIndex: context.sourceIndex,
        sourceArtifactId: source.artifactId,
      },
      error,
    )
    await context.diagnostics
      ?.append({
        type: 'error',
        provider: 'aliyun-bailian',
        operation: 'comfyui_img2img_prompt',
        itemKey: source.artifactId,
        error: errorForDiagnosticLog(wrapped),
      })
      .catch(() => null)
    context.debug('源图提示词生成失败', 'error', {
      operation: 'prompt',
      provider: 'aliyun-bailian',
      promptMode,
      sourceIndex: context.sourceIndex,
      error: wrapped.message,
      ...promptGenerationErrorDetails(error),
    })
    throw wrapped
  }
}

export async function runComfyuiImg2img(
  input: ComfyuiImg2imgRunInput,
  dependencies: GenerationServiceDependencies = {},
) {
  const sourceCount = requestedComfyuiSourceCount(input)
  if (sourceCount === 0) {
    throw new AppErrorClass('HTTP_4XX', '请先选择至少一个印花', false)
  }
  if (!input.workflowId.trim()) {
    throw new AppErrorClass('HTTP_4XX', '请选择 ComfyUI 图生图工作流', false)
  }
  await assertLocalComfyuiWorkflowExists(dependencies, {
    workflowId: input.workflowId,
    capability: 'img2img',
    workflowVersion: input.workflowVersion,
  })

  const apiKey = await (dependencies.getSecret ?? getSecret)('chenyu')
  if (!apiKey) {
    throw new AppErrorClass('HTTP_4XX', '缺少晨羽智云 API Key', false, {
      provider: 'comfyui-chenyu',
    })
  }

  const taskId = generationTaskId(input.taskId, 'img2img')
  createGenerationDebugLogger({}, { taskId, capability: 'img2img' })('任务已提交', 'info', {
    operation: 'submit',
    provider: 'comfyui-chenyu',
    sourceCount,
    promptMode: comfyuiImg2imgPromptMode(input),
    ...workflowLogDetails(input),
    width: input.width ?? 1024,
    height: input.height ?? 1024,
  })
  submitGenerationTask(taskId, () =>
    runComfyuiImg2imgBatch(
      { ...input, taskId },
      {
        ...dependencies,
        getSecret: async (key) =>
          key === 'chenyu' ? apiKey : await (dependencies.getSecret ?? getSecret)(key),
      },
    ),
  )
  return taskId
}

export async function runComfyuiImg2imgBatch(
  input: ComfyuiImg2imgRunInput,
  dependencies: GenerationServiceDependencies = {},
) {
  if (requestedComfyuiSourceCount(input) === 0) {
    throw new AppErrorClass('HTTP_4XX', '请先选择至少一个印花', false)
  }
  if (!input.workflowId.trim()) {
    throw new AppErrorClass('HTTP_4XX', '请选择 ComfyUI 图生图工作流', false)
  }

  const apiKey = await (dependencies.getSecret ?? getSecret)('chenyu')
  if (!apiKey) {
    throw new AppErrorClass('HTTP_4XX', '缺少晨羽智云 API Key', false, {
      provider: 'comfyui-chenyu',
    })
  }

  const taskId = generationTaskId(input.taskId, 'img2img')
  return comfyuiInstanceLocks.run(input, taskId, async () => {
    const emit = createGenerationProgressEmitter(dependencies)
    const workbenchRoot = await readWorkbenchRoot(dependencies.readConfig)
    const diagnostics = await createGenerationDiagnostics(workbenchRoot, taskId, {
      provider: 'comfyui-chenyu',
      capability: 'img2img',
      workflowId: input.workflowId,
      sourceCount: requestedComfyuiSourceCount(input),
      promptMode: comfyuiImg2imgPromptMode(input),
      promptModel: input.promptModel ?? null,
      promptSkillId: input.promptSkillId ?? null,
      promptSkillVersion: input.promptSkillVersion ?? null,
      width: input.width ?? 1024,
      height: input.height ?? 1024,
      batchSize: comfyuiImg2imgBatchSize(input),
    })
    const db = (dependencies.openDatabase ?? openWorkbenchDatabase)(workbenchRoot)

    try {
      const sourceArtifactIds = await comfyuiSourceArtifactIds(db, {
        taskId,
        ...(input.sourceArtifactIds !== undefined
          ? { sourceArtifactIds: input.sourceArtifactIds }
          : {}),
        ...(input.sourceImagePaths !== undefined
          ? { sourceImagePaths: input.sourceImagePaths }
          : {}),
      })
      const result: GenerationRunResult = {
        taskId,
        total: sourceArtifactIds.length * comfyuiImg2imgBatchSize(input),
        succeeded: 0,
        failed: 0,
        images: [],
        failures: [],
        ...(diagnostics ? { diagnosticsLogPath: diagnostics.path } : {}),
      }
      const sizePx = comfyuiSizePx(input)
      const batchSize = comfyuiImg2imgBatchSize(input)
      const adapter = await createComfyuiAdapterForRun(
        input,
        apiKey,
        workbenchRoot,
        db,
        dependencies,
        diagnostics,
      )
      const debug = createGenerationDebugLogger(dependencies, { taskId, capability: 'img2img' })
      let outputIndex = input.filenameStartIndex ?? 0
      const promptMode = comfyuiImg2imgPromptMode(input)
      let fatalFailureObserved = false

      for (const [index, artifactId] of sourceArtifactIds.entries()) {
        const inputIndex = input.inputIndexes?.[index] ?? index
        if (fatalFailureObserved || isGenerationCancelled(taskId)) {
          break
        }
        emitImg2imgProgress(result, taskId, result.total, emit)
        try {
          const source = await readReferenceForArtifact(db, workbenchRoot, artifactId)
          const prompt = await resolveComfyuiImg2imgPromptForSource(input, source, {
            sourceIndex: index + 1,
            total: sourceArtifactIds.length,
            diagnostics,
            dependencies,
            debug,
          })
          if (promptMode === 'ai' && input.resolvedPrompt === undefined) {
            await emitPromptResolved(dependencies, {
              taskId,
              capability: 'img2img',
              inputIndex,
              sourcePath: source.imagePath,
              sourceArtifactId: source.artifactId,
              prompt,
            })
          }
          const preserveWorkflowPrompt = promptMode === 'workflow'
          const filenameIndex = outputIndex
          emitComfyuiRequestLog(debug, {
            ...input,
            prompt,
            promptMode,
            sourceImage: basename(source.imagePath),
            sourceIndex: index + 1,
            total: sourceArtifactIds.length,
            width: sizePx.width,
            height: sizePx.height,
            batchSize,
          })
          const response = await adapter.generate({
            capability: 'img2img',
            prompt,
            workflow_id: input.workflowId.trim(),
            reference_images: [source.reference],
            output: { format: 'png', size_px: sizePx },
            options: {
              taskId,
              sourceArtifactIds: [artifactId],
              printId: source.printId,
              width: sizePx.width,
              height: sizePx.height,
              batchSize,
              maxOutputs: batchSize,
              ...comfyuiRunOptions(workbenchRoot, 'img2img', taskId, input, filenameIndex),
              ...(preserveWorkflowPrompt ? { preserveWorkflowPrompt: true } : {}),
              promptMode,
              ...(input.promptSkillId ? { promptSkillId: input.promptSkillId } : {}),
              ...(input.promptSkillVersion ? { promptSkillVersion: input.promptSkillVersion } : {}),
              ...(input.promptModel ? { promptModel: input.promptModel } : {}),
              ...(input.workflowVersion ? { workflowVersion: input.workflowVersion } : {}),
            },
          } satisfies GenerateRequest)
          if (response.status !== 'succeeded') {
            throw response.error ?? new AppErrorClass('HTTP_5XX', 'ComfyUI 图生图失败', true)
          }
          outputIndex += response.images.length
          for (const [responseIndex, image] of response.images.entries()) {
            const completedImage = {
              prompt: image.prompt ?? (preserveWorkflowPrompt ? '工作流默认提示词' : prompt),
              url: image.url,
              ...(image.local_path ? { localPath: image.local_path } : {}),
              ...generationImageIdentity(image, { artifactId, printId: source.printId }),
            }
            result.succeeded += 1
            result.images.push(completedImage)
            await emitImageComplete(dependencies, {
              taskId,
              capability: 'img2img',
              path: localPathFromGeneratedImage(image),
              printId: completedImage.printId ?? source.printId,
              artifactId: completedImage.artifactId,
              prompt: completedImage.prompt,
              sourceArtifactIds: [artifactId],
              inputIndex,
              outputIndex: input.outputIndexes?.[responseIndex] ?? responseIndex,
            })
          }
          if (response.images.length < batchSize) {
            const missing = batchSize - response.images.length
            result.failed += missing
            result.failures.push({
              prompt,
              error: `ComfyUI 本次只返回 ${response.images.length}/${batchSize} 张图片`,
              sourcePath: artifactId,
            })
          }
        } catch (error) {
          await diagnostics
            ?.append({
              type: 'error',
              provider: 'comfyui-chenyu',
              operation: 'img2img',
              itemKey: artifactId,
              error: errorForDiagnosticLog(error),
            })
            .catch(() => null)
          result.failed += batchSize
          const failure = generationFailureFromError(
            {
              prompt: promptMode === 'workflow' ? '工作流默认提示词' : (input.prompt?.trim() ?? ''),
              sourcePath: artifactId,
            },
            error,
          )
          result.failures.push(failure)
          fatalFailureObserved ||= failure.fatal === true
        } finally {
          emitImg2imgProgress(result, taskId, result.total, emit)
        }
      }

      return await finishGenerationResultWithDiagnostics(
        diagnostics,
        result,
        'comfyui-chenyu',
        'img2img',
      )
    } finally {
      db.close()
    }
  })
}
