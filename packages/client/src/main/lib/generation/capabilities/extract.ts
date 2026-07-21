import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { AppErrorClass, WORKBENCH_DIRECTORIES } from '@tengyu-aipod/shared'
import { readAppConfig } from '../../../onboarding'
import { errorForDiagnosticLog } from '../../diagnostic-log-service'
import { GenerationConcurrencyController } from '../../generation-concurrency'
import { normalizeGenerationLocalConfig } from '../../generation-local-config'
import { type GenerateRequest, GrsaiAdapter } from '../../grsai-adapter'
import { getSecret } from '../../keychain'
import { skillCacheManager } from '../../skill-cache'
import { generationFailureFromError } from '../failures'
import {
  type GenerationDatabase,
  type GenerationServiceDependencies,
  assertInsideFolder,
  assertLocalComfyuiWorkflowExists,
  clampInt,
  comfyuiRunOptions,
  comfyuiSizePx,
  comfyuiVisibleOutputStartIndex,
  createComfyuiAdapterForRun,
  createGenerationDebugLogger,
  createGenerationDiagnostics,
  createGenerationProgressEmitter,
  defaultDownloadImage,
  emitComfyuiRequestLog,
  emitExtractProgress,
  emitImageComplete,
  fileUrl,
  finishGenerationResultWithDiagnostics,
  generationImageIdentity,
  generationOutputTaskName,
  generationTargetPath,
  generationTaskId,
  generationTaskOutputFolder,
  imageIdentity,
  imageReference,
  localPathFromGeneratedImage,
  newPrintId,
  normalizeModel,
  observeGenerationError,
  openWorkbenchDatabase,
  readWorkbenchRoot,
  registerExtractArtifact,
  registerSourceArtifact,
  runWithComfyuiInstanceLock,
  submitGenerationTask,
} from '../runtime'
import { isGenerationCancelled } from '../task-registry'
import type { ComfyuiExtractRunInput, ExtractRunInput, GenerationRunResult } from '../types'

export async function runExtract(
  input: ExtractRunInput,
  dependencies: GenerationServiceDependencies = {},
) {
  const sourceImagePaths = Array.from(
    new Set(input.sourceImagePaths.map((imagePath) => imagePath.trim()).filter(Boolean)),
  )
  if (sourceImagePaths.length === 0) {
    throw new AppErrorClass('HTTP_4XX', '请先选择至少一张源图', false)
  }
  if (!input.skillId.trim()) {
    throw new AppErrorClass('HTTP_4XX', '请选择提取 Skill', false)
  }

  const apiKey = await (dependencies.getSecret ?? getSecret)('grsai')
  if (!apiKey) {
    throw new AppErrorClass('HTTP_4XX', '缺少 Grsai API Key', false, { provider: 'grsai' })
  }

  const taskId = generationTaskId(input.taskId, 'extract')
  createGenerationDebugLogger({}, { taskId, capability: 'extract' })('任务已提交', 'info', {
    operation: 'submit',
    provider: 'grsai',
    sourceCount: sourceImagePaths.length,
    model: input.model,
    concurrency: input.concurrency,
  })
  submitGenerationTask(taskId, () =>
    runExtractBatch(
      { ...input, taskId, sourceImagePaths },
      {
        ...dependencies,
        getSecret: async () => apiKey,
      },
    ),
  )
  return taskId
}

export async function runComfyuiExtract(
  input: ComfyuiExtractRunInput,
  dependencies: GenerationServiceDependencies = {},
) {
  const sourceImagePaths = Array.from(
    new Set(input.sourceImagePaths.map((imagePath) => imagePath.trim()).filter(Boolean)),
  )
  if (sourceImagePaths.length === 0) {
    throw new AppErrorClass('HTTP_4XX', '请先选择至少一张源图', false)
  }
  if (!input.workflowId.trim()) {
    throw new AppErrorClass('HTTP_4XX', '请选择 ComfyUI 提取工作流', false)
  }
  await assertLocalComfyuiWorkflowExists(dependencies, {
    workflowId: input.workflowId,
    capability: 'extract',
    workflowVersion: input.workflowVersion,
  })

  const apiKey = await (dependencies.getSecret ?? getSecret)('chenyu')
  if (!apiKey) {
    throw new AppErrorClass('HTTP_4XX', '缺少晨羽智云 API Key', false, {
      provider: 'comfyui-chenyu',
    })
  }

  const taskId = generationTaskId(input.taskId, 'extract')
  createGenerationDebugLogger({}, { taskId, capability: 'extract' })('任务已提交', 'info', {
    operation: 'submit',
    provider: 'comfyui-chenyu',
    sourceCount: sourceImagePaths.length,
    workflowId: input.workflowId,
    workflowName: input.workflowName ?? null,
    workflowVersion: input.workflowVersion ?? null,
    width: input.width ?? 1024,
    height: input.height ?? 1024,
  })
  submitGenerationTask(taskId, () =>
    runComfyuiExtractBatch(
      { ...input, taskId, sourceImagePaths },
      {
        ...dependencies,
        getSecret: async () => apiKey,
      },
    ),
  )
  return taskId
}

export async function runExtractBatch(
  input: ExtractRunInput,
  dependencies: GenerationServiceDependencies = {},
) {
  const sourceImagePaths = Array.from(
    new Set(input.sourceImagePaths.map((imagePath) => imagePath.trim()).filter(Boolean)),
  )
  if (sourceImagePaths.length === 0) {
    throw new AppErrorClass('HTTP_4XX', '请先选择至少一张源图', false)
  }
  if (!input.skillId.trim()) {
    throw new AppErrorClass('HTTP_4XX', '请选择提取 Skill', false)
  }

  const apiKey = await (dependencies.getSecret ?? getSecret)('grsai')
  if (!apiKey) {
    throw new AppErrorClass('HTTP_4XX', '缺少 Grsai API Key', false, { provider: 'grsai' })
  }

  const taskId = generationTaskId(input.taskId, 'extract')
  const result: GenerationRunResult = {
    taskId,
    total: sourceImagePaths.length,
    succeeded: 0,
    failed: 0,
    images: [],
    failures: [],
  }
  let db: GenerationDatabase | null = null
  let diagnostics: Awaited<ReturnType<typeof createGenerationDiagnostics>> | null = null
  const emit = createGenerationProgressEmitter(dependencies)
  let outputIndex = input.filenameStartIndex ?? 0
  let fatalFailureObserved = false

  try {
    const settings = normalizeGenerationLocalConfig((await readAppConfig()).generation)
    const concurrency = clampInt(input.concurrency, 1, 20, settings.grsai_concurrency)
    const model = normalizeModel(input.model)
    const controller = new GenerationConcurrencyController({ workers: concurrency })
    const skillCache = dependencies.skillCache ?? skillCacheManager
    const downloadImage = dependencies.downloadImage ?? defaultDownloadImage
    const workbenchRoot = await readWorkbenchRoot(dependencies.readConfig)
    diagnostics = await createGenerationDiagnostics(workbenchRoot, taskId, {
      provider: 'grsai',
      capability: 'extract',
      sourceCount: sourceImagePaths.length,
      model,
      aspectRatio: input.aspectRatio,
      skillId: input.skillId,
      skillVersion: input.skillVersion ?? null,
    })
    if (diagnostics) {
      result.diagnosticsLogPath = diagnostics.path
    }
    const adapter =
      dependencies.createGrsaiAdapter?.(apiKey) ??
      new GrsaiAdapter(apiKey, settings.grsai_node, {
        retries: settings.grsai_retries,
        ...(diagnostics ? { diagnostics } : {}),
      })
    const sourceFolder = join(workbenchRoot, WORKBENCH_DIRECTORIES.collection)
    const outputFolder = generationTaskOutputFolder(
      workbenchRoot,
      'extract',
      generationOutputTaskName(input, taskId),
    )
    db = (dependencies.openDatabase ?? openWorkbenchDatabase)(workbenchRoot)
    const activeDb = db
    await mkdir(outputFolder, { recursive: true })
    const skill = await skillCache.getSkill(input.skillId.trim(), input.skillVersion)

    await Promise.all(
      sourceImagePaths.map((sourceImagePath, sourceIndex) =>
        controller.run(`${taskId}-${sourceIndex}`, async () => {
          if (fatalFailureObserved || isGenerationCancelled(taskId)) {
            return
          }
          assertInsideFolder(sourceImagePath, sourceFolder)
          const sourceIdentity = await imageIdentity(sourceImagePath)
          registerSourceArtifact(activeDb, {
            identity: sourceIdentity,
            imagePath: sourceImagePath,
            taskId,
            createdAt: Date.now(),
          })
          const reference = await imageReference(sourceImagePath)
          const prompt =
            skill.systemPrompt.trim() || 'Extract the print from the source product image.'
          emitExtractProgress(result, sourceImagePaths.length, taskId, emit, prompt)
          try {
            if (isGenerationCancelled(taskId)) {
              return
            }
            const response = await adapter.generate({
              capability: 'extract',
              prompt,
              reference_images: [reference],
              output: {
                aspect_ratio: input.aspectRatio,
                format: 'png',
              },
              model,
            } satisfies GenerateRequest)
            if (response.status !== 'succeeded') {
              throw response.error ?? new AppErrorClass('GRSAI_FAILED', 'Grsai 提取失败', true)
            }

            if (response.images.length === 0) {
              throw new AppErrorClass('GRSAI_FAILED', 'Grsai 未返回结果图', true)
            }

            controller.onResponse(200)
            for (const [responseIndex, image] of response.images.entries()) {
              const printId = newPrintId()
              const currentOutputIndex = outputIndex
              outputIndex += 1
              const targetPath = await generationTargetPath(
                outputFolder,
                printId,
                '.png',
                input,
                currentOutputIndex,
              )
              const imageBuffer = image.local_path
                ? await readFile(image.local_path)
                : await downloadImage(image.url)
              await writeFile(targetPath, imageBuffer)
              const artifact = await registerExtractArtifact(activeDb, {
                taskId,
                printId,
                targetPath,
                sourceArtifactId: sourceIdentity.artifactId,
                prompt,
                model,
                skill,
                params: {
                  aspectRatio: input.aspectRatio,
                  variables: input.variables ?? {},
                },
                createdAt: Date.now(),
              })
              result.succeeded += 1
              result.images.push({
                prompt,
                url: fileUrl(targetPath),
                localPath: targetPath,
                sourcePath: sourceImagePath,
                artifactId: artifact.artifactId,
                printId: artifact.printId,
              })
              await emitImageComplete(dependencies, {
                taskId,
                capability: 'extract',
                path: targetPath,
                printId: artifact.printId,
                artifactId: artifact.artifactId,
                prompt,
                sourcePath: sourceImagePath,
                sourceArtifactIds: [sourceIdentity.artifactId],
                inputIndex: sourceIndex,
                outputIndex: responseIndex,
              })
            }
          } catch (error) {
            observeGenerationError(controller, error)
            await diagnostics
              ?.append({
                type: 'error',
                provider: 'grsai',
                operation: 'extract',
                itemKey: basename(sourceImagePath),
                error: errorForDiagnosticLog(error),
              })
              .catch(() => null)
            result.failed += 1
            const failure = generationFailureFromError(
              { prompt, sourcePath: sourceImagePath },
              error,
            )
            result.failures.push(failure)
            fatalFailureObserved ||= failure.fatal === true
          } finally {
            emitExtractProgress(result, sourceImagePaths.length, taskId, emit, prompt)
          }
        }),
      ),
    )
    return await finishGenerationResultWithDiagnostics(diagnostics, result, 'grsai', 'extract')
  } catch (error) {
    await diagnostics
      ?.append({
        type: 'task_failed',
        provider: 'grsai',
        operation: 'extract',
        error: errorForDiagnosticLog(error),
      })
      .catch(() => null)
    throw error
  } finally {
    db?.close()
  }
}

export async function runComfyuiExtractBatch(
  input: ComfyuiExtractRunInput,
  dependencies: GenerationServiceDependencies = {},
) {
  const sourceImagePaths = Array.from(
    new Set(input.sourceImagePaths.map((imagePath) => imagePath.trim()).filter(Boolean)),
  )
  if (sourceImagePaths.length === 0) {
    throw new AppErrorClass('HTTP_4XX', '请先选择至少一张源图', false)
  }
  if (!input.workflowId.trim()) {
    throw new AppErrorClass('HTTP_4XX', '请选择 ComfyUI 提取工作流', false)
  }

  const apiKey = await (dependencies.getSecret ?? getSecret)('chenyu')
  if (!apiKey) {
    throw new AppErrorClass('HTTP_4XX', '缺少晨羽智云 API Key', false, {
      provider: 'comfyui-chenyu',
    })
  }

  const taskId = generationTaskId(input.taskId, 'extract')
  return runWithComfyuiInstanceLock(input, taskId, dependencies, async () => {
    const result: GenerationRunResult = {
      taskId,
      total: sourceImagePaths.length,
      succeeded: 0,
      failed: 0,
      images: [],
      failures: [],
    }
    const emit = createGenerationProgressEmitter(dependencies)
    const skillId = input.skillId?.trim()
    const skill = skillId
      ? await (dependencies.skillCache ?? skillCacheManager).getSkill(skillId, input.skillVersion)
      : null
    const prompt =
      skill?.systemPrompt.trim() ||
      input.prompt?.trim() ||
      'Extract the print from the source product image.'
    const sizePx = comfyuiSizePx(input)
    const workbenchRoot = await readWorkbenchRoot(dependencies.readConfig)
    const diagnostics = await createGenerationDiagnostics(workbenchRoot, taskId, {
      provider: 'comfyui-chenyu',
      capability: 'extract',
      workflowId: input.workflowId,
      workflowName: input.workflowName ?? null,
      sourceCount: sourceImagePaths.length,
      width: sizePx.width,
      height: sizePx.height,
    })
    if (diagnostics) {
      result.diagnosticsLogPath = diagnostics.path
    }
    const db = (dependencies.openDatabase ?? openWorkbenchDatabase)(workbenchRoot)

    try {
      const adapter = await createComfyuiAdapterForRun(
        input,
        apiKey,
        workbenchRoot,
        db,
        dependencies,
        diagnostics,
      )
      const debug = createGenerationDebugLogger(dependencies, { taskId, capability: 'extract' })
      let outputIndex = await comfyuiVisibleOutputStartIndex(
        workbenchRoot,
        'extract',
        taskId,
        input,
      )
      let fatalFailureObserved = false

      for (const [index, sourceImagePath] of sourceImagePaths.entries()) {
        if (fatalFailureObserved || isGenerationCancelled(taskId)) {
          break
        }
        emitExtractProgress(result, sourceImagePaths.length, taskId, emit, prompt)
        try {
          const sourceIdentity = await imageIdentity(sourceImagePath)
          registerSourceArtifact(db, {
            identity: sourceIdentity,
            imagePath: sourceImagePath,
            taskId,
            createdAt: Date.now(),
          })
          const filenameIndex = outputIndex
          emitComfyuiRequestLog(debug, {
            ...input,
            prompt,
            sourceImage: basename(sourceImagePath),
            sourceIndex: index + 1,
            total: sourceImagePaths.length,
            width: sizePx.width,
            height: sizePx.height,
          })
          const response = await adapter.generate({
            capability: 'extract',
            prompt,
            workflow_id: input.workflowId.trim(),
            reference_images: [await imageReference(sourceImagePath)],
            output: { format: 'png', size_px: sizePx },
            options: {
              taskId,
              sourceArtifactIds: [sourceIdentity.artifactId],
              width: sizePx.width,
              height: sizePx.height,
              ...comfyuiRunOptions(workbenchRoot, 'extract', taskId, input, filenameIndex),
              ...(input.workflowVersion ? { workflowVersion: input.workflowVersion } : {}),
            },
          } satisfies GenerateRequest)
          if (response.status !== 'succeeded') {
            throw response.error ?? new AppErrorClass('HTTP_5XX', 'ComfyUI 提取失败', true)
          }
          outputIndex += response.images.length
          for (const [responseIndex, image] of response.images.entries()) {
            const completedImage = {
              prompt,
              url: image.url,
              ...(image.local_path ? { localPath: image.local_path } : {}),
              sourcePath: sourceImagePath,
              ...generationImageIdentity(image, sourceIdentity),
            }
            result.succeeded += 1
            result.images.push(completedImage)
            await emitImageComplete(dependencies, {
              taskId,
              capability: 'extract',
              path: localPathFromGeneratedImage(image),
              printId: completedImage.printId ?? sourceIdentity.printId,
              artifactId: completedImage.artifactId,
              prompt: completedImage.prompt,
              sourcePath: sourceImagePath,
              sourceArtifactIds: [sourceIdentity.artifactId],
              inputIndex: index,
              outputIndex: responseIndex,
            })
          }
        } catch (error) {
          await diagnostics
            ?.append({
              type: 'error',
              provider: 'comfyui-chenyu',
              operation: 'extract',
              itemKey: basename(sourceImagePath),
              error: errorForDiagnosticLog(error),
            })
            .catch(() => null)
          result.failed += 1
          const failure = generationFailureFromError({ prompt, sourcePath: sourceImagePath }, error)
          result.failures.push(failure)
          fatalFailureObserved ||= failure.fatal === true
        } finally {
          emitExtractProgress(result, sourceImagePaths.length, taskId, emit, prompt)
        }
      }

      return await finishGenerationResultWithDiagnostics(
        diagnostics,
        result,
        'comfyui-chenyu',
        'extract',
      )
    } finally {
      db.close()
    }
  })
}
