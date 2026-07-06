import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { AppErrorClass } from '@tengyu-aipod/shared'
import { readAppConfig } from '../../../onboarding'
import {
  type DiagnosticLogWriter,
  createOptionalDiagnosticLogWriter,
  errorForDiagnosticLog,
} from '../../diagnostic-log-service'
import { GenerationConcurrencyController } from '../../generation-concurrency'
import { normalizeGenerationLocalConfig } from '../../generation-local-config'
import { type GenerateRequest, GrsaiAdapter } from '../../grsai-adapter'
import { getSecret } from '../../keychain'
import { visibleImageNamingEnabled } from '../../user-visible-filename'
import {
  type GenerationServiceDependencies,
  appErrorMessage,
  assertLocalComfyuiWorkflowExists,
  clampInt,
  comfyuiInstanceLocks,
  comfyuiRunOptions,
  createComfyuiAdapterForRun,
  createGenerationDebugLogger,
  createGenerationDiagnostics,
  createGenerationProgressEmitter,
  defaultDownloadImage,
  emitComfyuiRequestLog,
  emitImageComplete,
  emitTxt2imgProgress,
  fileUrl,
  finishGenerationResultWithDiagnostics,
  generatedImageExtension,
  generationImageIdentity,
  generationOutputTaskName,
  generationTargetPath,
  generationTaskId,
  generationTaskOutputFolder,
  localPathFromGeneratedImage,
  newPrintId,
  normalizeModel,
  observeGenerationError,
  openWorkbenchDatabase,
  readWorkbenchRoot,
  registerGeneratedArtifact,
  submitGenerationTask,
  workflowLogDetails,
} from '../runtime'
import { isGenerationCancelled, markGenerationResultCancelled } from '../task-registry'
import type { ComfyuiTxt2imgRunInput, GenerationRunResult, Txt2imgRunInput } from '../types'

export async function runTxt2img(input: Txt2imgRunInput) {
  const prompts = input.prompts.map((prompt) => prompt.trim()).filter(Boolean)
  if (prompts.length === 0) {
    throw new AppErrorClass('HTTP_4XX', '请先准备至少一条提示词', false)
  }

  const apiKey = await getSecret('grsai')
  if (!apiKey) {
    throw new AppErrorClass('HTTP_4XX', '缺少 Grsai API Key', false, { provider: 'grsai' })
  }

  const taskId = generationTaskId(input.taskId, input.capability ?? 'txt2img')
  createGenerationDebugLogger({}, { taskId, capability: input.capability ?? 'txt2img' })(
    '任务已提交',
    'info',
    {
      operation: 'submit',
      provider: 'grsai',
      total: prompts.length,
      model: input.model,
      aspectRatio: input.aspectRatio,
      concurrency: input.concurrency,
      referenceImageCount: input.referenceImages?.length ?? 0,
    },
  )
  submitGenerationTask(taskId, () => runTxt2imgTask(taskId, prompts, input, apiKey))
  return taskId
}

export async function runTxt2imgBatch(
  input: Txt2imgRunInput,
  dependencies: GenerationServiceDependencies = {},
) {
  const prompts = input.prompts.map((prompt) => prompt.trim()).filter(Boolean)
  if (prompts.length === 0) {
    throw new AppErrorClass('HTTP_4XX', '请先准备至少一条提示词', false)
  }

  const apiKey = await (dependencies.getSecret ?? getSecret)('grsai')
  if (!apiKey) {
    throw new AppErrorClass('HTTP_4XX', '缺少 Grsai API Key', false, { provider: 'grsai' })
  }

  return runTxt2imgTask(
    generationTaskId(input.taskId, input.capability ?? 'txt2img'),
    prompts,
    input,
    apiKey,
    dependencies,
  )
}

export async function runComfyuiTxt2img(
  input: ComfyuiTxt2imgRunInput,
  dependencies: GenerationServiceDependencies = {},
) {
  const prompts = input.prompts.map((prompt) => prompt.trim()).filter(Boolean)
  if (prompts.length === 0) {
    throw new AppErrorClass('HTTP_4XX', '请先准备至少一条提示词', false)
  }
  if (!input.workflowId.trim()) {
    throw new AppErrorClass('HTTP_4XX', '请选择 ComfyUI 文生图工作流', false)
  }
  await assertLocalComfyuiWorkflowExists(dependencies, {
    workflowId: input.workflowId,
    capability: 'txt2img',
    workflowVersion: input.workflowVersion,
  })

  const apiKey = await (dependencies.getSecret ?? getSecret)('chenyu')
  if (!apiKey) {
    throw new AppErrorClass('HTTP_4XX', '缺少晨羽智云 API Key', false, {
      provider: 'comfyui-chenyu',
    })
  }

  const taskId = generationTaskId(input.taskId, 'txt2img')
  createGenerationDebugLogger({}, { taskId, capability: 'txt2img' })('任务已提交', 'info', {
    operation: 'submit',
    provider: 'comfyui-chenyu',
    total: prompts.length,
    ...workflowLogDetails(input),
    width: input.width ?? 1024,
    height: input.height ?? 1024,
    concurrency: input.concurrency ?? 1,
  })
  submitGenerationTask(taskId, () =>
    runComfyuiTxt2imgBatch(
      { ...input, taskId, prompts },
      {
        ...dependencies,
        getSecret: async () => apiKey,
      },
    ),
  )
  return taskId
}

async function runTxt2imgTask(
  taskId: string,
  prompts: string[],
  input: Txt2imgRunInput,
  apiKey: string,
  dependencies: GenerationServiceDependencies = {},
) {
  const capability = input.capability ?? 'txt2img'
  const workbenchConfig = await (dependencies.readConfig ?? readAppConfig)()
  if (!workbenchConfig.workbench_root) {
    throw new AppErrorClass('HTTP_4XX', '请先在设置里选择工作区', false)
  }
  const workbenchRoot = workbenchConfig.workbench_root
  const settings = normalizeGenerationLocalConfig(workbenchConfig.generation)
  const diagnostics = await createOptionalDiagnosticLogWriter({
    module: 'generation',
    taskId,
    workbenchRoot,
    meta: {
      provider: 'grsai',
      capability,
      promptCount: prompts.length,
      model: input.model,
      aspectRatio: input.aspectRatio,
      imageSize: input.imageSize ?? null,
      referenceImageCount: input.referenceImages?.length ?? 0,
    },
  })
  const controller = new GenerationConcurrencyController({
    workers: clampInt(input.concurrency, 1, 20, settings.grsai_concurrency),
  })
  const adapter =
    dependencies.createGrsaiAdapter?.(apiKey) ??
    new GrsaiAdapter(apiKey, settings.grsai_node, {
      retries: settings.grsai_retries,
      ...(diagnostics ? { diagnostics } : {}),
    })
  const downloadImage = dependencies.downloadImage ?? defaultDownloadImage
  const model = normalizeModel(input.model)
  const outputFolder = generationTaskOutputFolder(
    workbenchRoot,
    capability,
    generationOutputTaskName(input, taskId),
  )
  const db = (dependencies.openDatabase ?? openWorkbenchDatabase)(workbenchRoot)
  const emit = createGenerationProgressEmitter(dependencies)
  const result: GenerationRunResult = {
    taskId,
    total: prompts.length,
    succeeded: 0,
    failed: 0,
    images: [],
    failures: [],
    ...(diagnostics ? { diagnosticsLogPath: diagnostics.path } : {}),
  }
  let outputIndex = input.filenameStartIndex ?? 0

  try {
    await mkdir(outputFolder, { recursive: true })
    await Promise.all(
      prompts.map((prompt, index) =>
        controller.run(`${taskId}-${index}`, async () => {
          if (isGenerationCancelled(taskId)) {
            return
          }
          emit({
            task_id: taskId,
            capability,
            processed: result.succeeded + result.failed,
            total: prompts.length,
            succeeded: result.succeeded,
            failed: result.failed,
            current_prompt: prompt,
            images: result.images,
          })

          try {
            if (isGenerationCancelled(taskId)) {
              return
            }
            const response = await adapter.generate({
              capability,
              prompt,
              ...(input.referenceImages?.length ? { reference_images: input.referenceImages } : {}),
              output: {
                aspect_ratio: input.aspectRatio,
                ...(input.imageSize ? { image_size_label: input.imageSize } : {}),
              },
              model,
            } satisfies GenerateRequest)
            if (response.status !== 'succeeded') {
              throw response.error ?? new AppErrorClass('GRSAI_FAILED', 'Grsai 生成失败', true)
            }
            if (response.images.length === 0) {
              throw new AppErrorClass('GRSAI_FAILED', 'Grsai 未返回结果图', true)
            }
            controller.onResponse(200)
            for (const image of response.images) {
              const printId = newPrintId()
              const currentOutputIndex = outputIndex
              outputIndex += 1
              const targetPath = await generationTargetPath(
                outputFolder,
                printId,
                generatedImageExtension(image),
                input,
                currentOutputIndex,
              )
              const imageBuffer = image.local_path
                ? await readFile(image.local_path)
                : await downloadImage(image.url)
              await writeFile(targetPath, imageBuffer)
              const artifact = await registerGeneratedArtifact(db, {
                taskId,
                printId,
                targetPath,
                capability,
                prompt,
                model,
                params: {
                  aspectRatio: input.aspectRatio,
                  imageSize: input.imageSize ?? null,
                  referenceImageCount: input.referenceImages?.length ?? 0,
                },
                createdAt: Date.now(),
              })
              result.succeeded += 1
              result.images.push({
                prompt,
                url: fileUrl(targetPath),
                localPath: targetPath,
                artifactId: artifact.artifactId,
                printId: artifact.printId,
              })
              await emitImageComplete(dependencies, {
                taskId,
                capability,
                path: targetPath,
                printId: artifact.printId,
                artifactId: artifact.artifactId,
                prompt,
                sourceArtifactIds: [],
              })
            }
          } catch (error) {
            observeGenerationError(controller, error)
            await diagnostics?.append({
              type: 'error',
              provider: 'grsai',
              operation: capability,
              itemKey: `prompt-${index + 1}`,
              error: errorForDiagnosticLog(error),
            })
            result.failed += 1
            result.failures.push({ prompt, error: appErrorMessage(error) })
          } finally {
            emit({
              task_id: taskId,
              capability,
              processed: result.succeeded + result.failed,
              total: prompts.length,
              succeeded: result.succeeded,
              failed: result.failed,
              current_prompt: prompt,
              images: result.images,
            })
          }
        }),
      ),
    )
    const finalResult = markGenerationResultCancelled(result)
    await diagnostics?.append({
      type: 'task_completed',
      provider: 'grsai',
      operation: capability,
      data: {
        total: finalResult.total,
        succeeded: finalResult.succeeded,
        failed: finalResult.failed,
        cancelled: finalResult.cancelled ?? false,
      },
    })
    return finalResult
  } finally {
    db.close()
  }
}

export async function runComfyuiTxt2imgBatch(
  input: ComfyuiTxt2imgRunInput,
  dependencies: GenerationServiceDependencies = {},
) {
  const prompts = input.prompts.map((prompt) => prompt.trim()).filter(Boolean)
  if (prompts.length === 0) {
    throw new AppErrorClass('HTTP_4XX', '请先准备至少一条提示词', false)
  }
  if (!input.workflowId.trim()) {
    throw new AppErrorClass('HTTP_4XX', '请选择 ComfyUI 文生图工作流', false)
  }

  const apiKey = await (dependencies.getSecret ?? getSecret)('chenyu')
  if (!apiKey) {
    throw new AppErrorClass('HTTP_4XX', '缺少晨羽智云 API Key', false, {
      provider: 'comfyui-chenyu',
    })
  }

  const taskId = generationTaskId(input.taskId, 'txt2img')
  return comfyuiInstanceLocks.run(input, taskId, async () => {
    const result: GenerationRunResult = {
      taskId,
      total: prompts.length,
      succeeded: 0,
      failed: 0,
      images: [],
      failures: [],
    }
    const emit = createGenerationProgressEmitter(dependencies)
    const workbenchRoot = await readWorkbenchRoot(dependencies.readConfig)
    const diagnostics = await createGenerationDiagnostics(workbenchRoot, taskId, {
      provider: 'comfyui-chenyu',
      capability: 'txt2img',
      workflowId: input.workflowId,
      promptCount: prompts.length,
      width: input.width ?? 1024,
      height: input.height ?? 1024,
    })
    if (diagnostics) {
      result.diagnosticsLogPath = diagnostics.path
    }
    const db = (dependencies.openDatabase ?? openWorkbenchDatabase)(workbenchRoot)

    try {
      const useVisibleFilenames = visibleImageNamingEnabled({
        prefix: input.filenamePrefix,
        separator: input.filenameSeparator,
      })
      const concurrency = useVisibleFilenames ? 1 : clampInt(input.concurrency ?? 1, 1, 20, 1)
      const controller = new GenerationConcurrencyController({ workers: concurrency })
      const adapter = await createComfyuiAdapterForRun(
        input,
        apiKey,
        workbenchRoot,
        db,
        dependencies,
        diagnostics,
      )
      const debug = createGenerationDebugLogger(dependencies, { taskId, capability: 'txt2img' })
      const width = clampInt(input.width ?? 1024, 256, 4096, 1024)
      const height = clampInt(input.height ?? 1024, 256, 4096, 1024)
      let outputIndex = input.filenameStartIndex ?? 0

      await Promise.all(
        prompts.map((prompt, index) =>
          controller.run(`${taskId}-${index}`, async () => {
            if (isGenerationCancelled(taskId)) {
              return
            }
            emitTxt2imgProgress(result, taskId, prompts.length, emit, prompt)
            try {
              if (isGenerationCancelled(taskId)) {
                return
              }
              emitComfyuiRequestLog(debug, {
                ...input,
                prompt,
                sourceIndex: index + 1,
                total: prompts.length,
                width,
                height,
              })
              const response = await adapter.generate({
                capability: 'txt2img',
                prompt,
                workflow_id: input.workflowId.trim(),
                output: {
                  format: 'png',
                  size_px: { width, height },
                },
                options: {
                  taskId,
                  width,
                  height,
                  ...comfyuiRunOptions(workbenchRoot, 'txt2img', taskId, input, outputIndex),
                  ...(input.workflowVersion ? { workflowVersion: input.workflowVersion } : {}),
                },
              } satisfies GenerateRequest)
              if (response.status !== 'succeeded') {
                throw response.error ?? new AppErrorClass('HTTP_5XX', 'ComfyUI 文生图失败', true)
              }
              outputIndex += response.images.length
              for (const image of response.images) {
                const printId = image.print_id ?? newPrintId()
                const completedImage = {
                  prompt,
                  url: image.url,
                  ...(image.local_path ? { localPath: image.local_path } : {}),
                  ...generationImageIdentity(image, { printId }),
                }
                result.succeeded += 1
                result.images.push(completedImage)
                await emitImageComplete(dependencies, {
                  taskId,
                  capability: 'txt2img',
                  path: localPathFromGeneratedImage(image),
                  printId,
                  artifactId: completedImage.artifactId,
                  prompt: completedImage.prompt,
                  sourceArtifactIds: [],
                })
              }
            } catch (error) {
              await diagnostics
                ?.append({
                  type: 'error',
                  provider: 'comfyui-chenyu',
                  operation: 'txt2img',
                  itemKey: `prompt-${index + 1}`,
                  error: errorForDiagnosticLog(error),
                })
                .catch(() => null)
              result.failed += 1
              result.failures.push({ prompt, error: appErrorMessage(error) })
            } finally {
              emitTxt2imgProgress(result, taskId, prompts.length, emit, prompt)
            }
          }),
        ),
      )

      return await finishGenerationResultWithDiagnostics(
        diagnostics,
        result,
        'comfyui-chenyu',
        'txt2img',
      )
    } finally {
      db.close()
    }
  })
}
