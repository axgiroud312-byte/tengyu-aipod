import { readFile, rm, writeFile } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { AppErrorClass } from '@tengyu-aipod/shared'
import { readAppConfig } from '../../../onboarding'
import { errorForDiagnosticLog } from '../../diagnostic-log-service'
import { normalizeGenerationLocalConfig } from '../../generation-local-config'
import { type GenerateRequest, GrsaiAdapter } from '../../grsai-adapter'
import { getSecret } from '../../keychain'
import { skillCacheManager } from '../../skill-cache'
import { generationFailureFromError } from '../failures'
import {
  type GenerationServiceDependencies,
  assertLocalComfyuiWorkflowExists,
  clampInt,
  comfyuiInstanceLocks,
  comfyuiRunOptions,
  comfyuiSizePx,
  comfyuiSourceArtifactIds,
  createComfyuiAdapterForRun,
  createGenerationDebugLogger,
  createGenerationDiagnostics,
  createGenerationProgressEmitter,
  defaultDownloadImage,
  emitComfyuiRequestLog,
  emitImageComplete,
  finishGenerationResultWithDiagnostics,
  generationImageIdentity,
  generationTaskId,
  imageIdentity,
  imageReference,
  localPathFromGeneratedImage,
  normalizeModel,
  openWorkbenchDatabase,
  readReferenceForArtifact,
  readWorkbenchRoot,
  registerSourceArtifact,
  requestedComfyuiSourceCount,
  safeBaseName,
  submitGenerationTask,
  tempFileManager,
  timestampSlug,
  workflowLogDetails,
} from '../runtime'
import { isGenerationCancelled } from '../task-registry'
import type {
  ComfyuiExtractMattingRunInput,
  ComfyuiMattingRunInput,
  GenerationProgress,
  GenerationRunResult,
  MixedMattingRunInput,
} from '../types'

const DEFAULT_GENERATION_MODEL = 'gpt-image-2'

function comfyuiOptionalSizePx(input: {
  width?: number | undefined
  height?: number | undefined
}) {
  if (input.width === undefined && input.height === undefined) {
    return undefined
  }
  return {
    width: clampInt(input.width ?? 1024, 256, 4096, 1024),
    height: clampInt(input.height ?? 1024, 256, 4096, 1024),
  }
}

async function resolveMixedMattingMaskSkill(
  input: MixedMattingRunInput,
  skillCache: Pick<typeof skillCacheManager, 'getSkill' | 'listSkills'>,
) {
  const skillId = input.maskSkillId?.trim()
  if (skillId) {
    return skillCache.getSkill(skillId, input.maskSkillVersion)
  }

  const summaries = await skillCache.listSkills({
    module: 'generation',
    category: 'matting-mask',
  })
  const first = summaries[0]
  if (!first) {
    throw new AppErrorClass('HTTP_4XX', '没有可用的黑白图 Skill', false, {
      provider: 'grsai',
      category: 'matting-mask',
    })
  }

  return skillCache.getSkill(first.id, first.version)
}

function extractMattingTaskId(inputTaskId: string | undefined) {
  const custom = inputTaskId?.trim()
  return safeBaseName(custom || `提取后抠图-${timestampSlug()}`)
}

function emitMattingProgress(
  result: GenerationRunResult,
  taskId: string,
  total: number,
  emit: (progress: GenerationProgress) => void,
) {
  emit({
    task_id: taskId,
    capability: 'matting',
    processed: result.succeeded + result.failed,
    total,
    succeeded: result.succeeded,
    failed: result.failed,
    images: result.images,
  })
}

export async function runComfyuiExtractMatting(
  input: ComfyuiExtractMattingRunInput,
  dependencies: GenerationServiceDependencies = {},
) {
  const sourceImagePaths = Array.from(
    new Set(input.sourceImagePaths.map((imagePath) => imagePath.trim()).filter(Boolean)),
  )
  if (sourceImagePaths.length === 0) {
    throw new AppErrorClass('HTTP_4XX', '请先选择至少一张源图', false)
  }
  if (!input.extractWorkflowId.trim()) {
    throw new AppErrorClass('HTTP_4XX', '请选择 ComfyUI 提取工作流', false)
  }
  if (!input.mattingWorkflowId.trim()) {
    throw new AppErrorClass('HTTP_4XX', '请选择 ComfyUI 抠图工作流', false)
  }
  await assertLocalComfyuiWorkflowExists(dependencies, {
    workflowId: input.extractWorkflowId,
    capability: 'extract',
    workflowVersion: input.extractWorkflowVersion,
  })
  await assertLocalComfyuiWorkflowExists(dependencies, {
    workflowId: input.mattingWorkflowId,
    capability: 'matting',
    workflowVersion: input.mattingWorkflowVersion,
  })

  const apiKey = await (dependencies.getSecret ?? getSecret)('chenyu')
  if (!apiKey) {
    throw new AppErrorClass('HTTP_4XX', '缺少晨羽智云 API Key', false, {
      provider: 'comfyui-chenyu',
    })
  }

  const taskId = extractMattingTaskId(input.taskId)
  createGenerationDebugLogger({}, { taskId, capability: 'matting' })('任务已提交', 'info', {
    operation: 'submit',
    provider: 'comfyui-chenyu',
    sourceCount: sourceImagePaths.length,
    extractWorkflowId: input.extractWorkflowId,
    mattingWorkflowId: input.mattingWorkflowId,
    width: input.width ?? 1024,
    height: input.height ?? 1024,
  })
  submitGenerationTask(taskId, () =>
    runComfyuiExtractMattingBatch(
      { ...input, taskId, sourceImagePaths },
      {
        ...dependencies,
        getSecret: async () => apiKey,
      },
    ),
  )
  return taskId
}

export async function runComfyuiMatting(
  input: ComfyuiMattingRunInput,
  dependencies: GenerationServiceDependencies = {},
) {
  const sourceCount = requestedComfyuiSourceCount(input)
  if (sourceCount === 0) {
    throw new AppErrorClass('HTTP_4XX', '请先选择至少一个印花', false)
  }
  if (!input.workflowId.trim()) {
    throw new AppErrorClass('HTTP_4XX', '请选择 ComfyUI 抠图工作流', false)
  }
  await assertLocalComfyuiWorkflowExists(dependencies, {
    workflowId: input.workflowId,
    capability: 'matting',
    workflowVersion: input.workflowVersion,
  })

  const apiKey = await (dependencies.getSecret ?? getSecret)('chenyu')
  if (!apiKey) {
    throw new AppErrorClass('HTTP_4XX', '缺少晨羽智云 API Key', false, {
      provider: 'comfyui-chenyu',
    })
  }

  const taskId = generationTaskId(input.taskId, 'matting')
  createGenerationDebugLogger({}, { taskId, capability: 'matting' })('任务已提交', 'info', {
    operation: 'submit',
    provider: 'comfyui-chenyu',
    sourceCount,
    ...workflowLogDetails(input),
    width: input.width ?? 1024,
    height: input.height ?? 1024,
  })
  submitGenerationTask(taskId, () =>
    runComfyuiMattingBatch(
      { ...input, taskId },
      {
        ...dependencies,
        getSecret: async () => apiKey,
      },
    ),
  )
  return taskId
}

export async function runMixedMatting(
  input: MixedMattingRunInput,
  dependencies: GenerationServiceDependencies = {},
) {
  const sourceCount = requestedComfyuiSourceCount(input)
  if (sourceCount === 0) {
    throw new AppErrorClass('HTTP_4XX', '请先选择至少一个印花', false)
  }
  if (!input.workflowId.trim()) {
    throw new AppErrorClass('HTTP_4XX', '请选择 ComfyUI 混合抠图工作流', false)
  }
  await assertLocalComfyuiWorkflowExists(dependencies, {
    workflowId: input.workflowId,
    capability: 'matting-mixed',
    workflowVersion: input.workflowVersion,
  })
  const grsaiKey = await (dependencies.getSecret ?? getSecret)('grsai')
  if (!grsaiKey) {
    throw new AppErrorClass('HTTP_4XX', '缺少 Grsai API Key', false, { provider: 'grsai' })
  }
  const chenyuKey = await (dependencies.getSecret ?? getSecret)('chenyu')
  if (!chenyuKey) {
    throw new AppErrorClass('HTTP_4XX', '缺少晨羽智云 API Key', false, {
      provider: 'comfyui-chenyu',
    })
  }

  const taskId = generationTaskId(input.taskId, 'matting')
  createGenerationDebugLogger({}, { taskId, capability: 'matting' })('任务已提交', 'info', {
    operation: 'submit',
    provider: 'grsai+comfyui',
    sourceCount,
    ...workflowLogDetails(input),
    maskModel: input.maskModel ?? null,
    width: input.width ?? 1024,
    height: input.height ?? 1024,
  })
  submitGenerationTask(taskId, () =>
    runMixedMattingBatch(
      { ...input, taskId },
      {
        ...dependencies,
        getSecret: async (key: string) => {
          if (key === 'grsai') {
            return grsaiKey
          }
          if (key === 'chenyu') {
            return chenyuKey
          }
          return ''
        },
      },
    ),
  )
  return taskId
}

export async function runComfyuiExtractMattingBatch(
  input: ComfyuiExtractMattingRunInput,
  dependencies: GenerationServiceDependencies = {},
) {
  const sourceImagePaths = Array.from(
    new Set(input.sourceImagePaths.map((imagePath) => imagePath.trim()).filter(Boolean)),
  )
  if (sourceImagePaths.length === 0) {
    throw new AppErrorClass('HTTP_4XX', '请先选择至少一张源图', false)
  }
  if (!input.extractWorkflowId.trim()) {
    throw new AppErrorClass('HTTP_4XX', '请选择 ComfyUI 提取工作流', false)
  }
  if (!input.mattingWorkflowId.trim()) {
    throw new AppErrorClass('HTTP_4XX', '请选择 ComfyUI 抠图工作流', false)
  }

  const apiKey = await (dependencies.getSecret ?? getSecret)('chenyu')
  if (!apiKey) {
    throw new AppErrorClass('HTTP_4XX', '缺少晨羽智云 API Key', false, {
      provider: 'comfyui-chenyu',
    })
  }

  const taskId = extractMattingTaskId(input.taskId)
  return comfyuiInstanceLocks.run(input, taskId, async () => {
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
    const extractPrompt =
      skill?.systemPrompt.trim() ||
      input.prompt?.trim() ||
      'Extract the print from the source product image.'
    const mattingPrompt = 'Remove the background and output transparent PNG.'
    const sizePx = comfyuiSizePx(input)
    const workbenchRoot = await readWorkbenchRoot(dependencies.readConfig)
    const diagnostics = await createGenerationDiagnostics(workbenchRoot, taskId, {
      provider: 'comfyui-chenyu',
      capability: 'matting',
      operation: 'extract-matting',
      extractWorkflowId: input.extractWorkflowId,
      mattingWorkflowId: input.mattingWorkflowId,
      sourceCount: sourceImagePaths.length,
      width: sizePx.width,
      height: sizePx.height,
    })
    if (diagnostics) {
      result.diagnosticsLogPath = diagnostics.path
    }
    const db = (dependencies.openDatabase ?? openWorkbenchDatabase)(workbenchRoot)
    const tempFiles = dependencies.tempFiles ?? tempFileManager
    let createdTempDir = false

    try {
      const tempDir = await tempFiles.createTaskDir('matting', taskId)
      createdTempDir = true
      const adapter = await createComfyuiAdapterForRun(
        input,
        apiKey,
        workbenchRoot,
        db,
        dependencies,
        diagnostics,
      )
      const debug = createGenerationDebugLogger(dependencies, { taskId, capability: 'matting' })
      let outputIndex = input.filenameStartIndex ?? 0
      let fatalFailureObserved = false

      for (const [index, sourceImagePath] of sourceImagePaths.entries()) {
        if (fatalFailureObserved || isGenerationCancelled(taskId)) {
          break
        }
        emitMattingProgress(result, taskId, sourceImagePaths.length, emit)
        try {
          const sourceIdentity = await imageIdentity(sourceImagePath)
          registerSourceArtifact(db, {
            identity: sourceIdentity,
            imagePath: sourceImagePath,
            taskId,
            createdAt: Date.now(),
          })

          emitComfyuiRequestLog(debug, {
            workflowId: input.extractWorkflowId,
            workflowName: input.extractWorkflowName,
            workflowVersion: input.extractWorkflowVersion,
            prompt: extractPrompt,
            sourceImage: basename(sourceImagePath),
            sourceIndex: index + 1,
            total: sourceImagePaths.length,
            width: sizePx.width,
            height: sizePx.height,
          })
          const extractResponse = await adapter.generate({
            capability: 'extract',
            prompt: extractPrompt,
            workflow_id: input.extractWorkflowId.trim(),
            reference_images: [await imageReference(sourceImagePath)],
            output: { format: 'png', size_px: sizePx },
            options: {
              taskId: `${taskId}-extract-${index + 1}`,
              sourceArtifactIds: [sourceIdentity.artifactId],
              width: sizePx.width,
              height: sizePx.height,
              outputFolderOverride: join(tempDir, `extract-${index + 1}`),
              registerArtifact: false,
              maxOutputs: 1,
              ...(input.extractWorkflowVersion
                ? { workflowVersion: input.extractWorkflowVersion }
                : {}),
            },
          } satisfies GenerateRequest)
          if (extractResponse.status !== 'succeeded') {
            throw extractResponse.error ?? new AppErrorClass('HTTP_5XX', 'ComfyUI 提取失败', true)
          }
          const extractedImage = extractResponse.images[0]
          if (!extractedImage?.local_path) {
            throw new AppErrorClass('HTTP_5XX', 'ComfyUI 提取未返回本地图片', true)
          }
          const filenameIndex = outputIndex

          emitComfyuiRequestLog(debug, {
            workflowId: input.mattingWorkflowId,
            workflowName: input.mattingWorkflowName,
            workflowVersion: input.mattingWorkflowVersion,
            prompt: mattingPrompt,
            sourceImage: basename(extractedImage.local_path),
            sourceIndex: index + 1,
            total: sourceImagePaths.length,
            width: sizePx.width,
            height: sizePx.height,
          })
          const mattingResponse = await adapter.generate({
            capability: 'matting',
            prompt: mattingPrompt,
            workflow_id: input.mattingWorkflowId.trim(),
            reference_images: [await imageReference(extractedImage.local_path)],
            output: { format: 'png', size_px: sizePx },
            options: {
              taskId,
              sourceArtifactIds: [sourceIdentity.artifactId],
              printId: sourceIdentity.printId,
              width: sizePx.width,
              height: sizePx.height,
              maxOutputs: 1,
              ...comfyuiRunOptions(workbenchRoot, 'matting', taskId, input, filenameIndex),
              ...(input.mattingWorkflowVersion
                ? { workflowVersion: input.mattingWorkflowVersion }
                : {}),
            },
          } satisfies GenerateRequest)
          if (mattingResponse.status !== 'succeeded') {
            throw mattingResponse.error ?? new AppErrorClass('HTTP_5XX', 'ComfyUI 抠图失败', true)
          }
          const finalImage = mattingResponse.images[0]
          if (!finalImage) {
            throw new AppErrorClass('HTTP_5XX', 'ComfyUI 抠图未返回结果图', true)
          }
          outputIndex += 1
          const completedImage = {
            prompt: mattingPrompt,
            url: finalImage.url,
            ...(finalImage.local_path ? { localPath: finalImage.local_path } : {}),
            sourcePath: sourceImagePath,
            ...generationImageIdentity(finalImage, sourceIdentity),
          }
          result.succeeded += 1
          result.images.push(completedImage)
          await emitImageComplete(dependencies, {
            taskId,
            capability: 'matting',
            path: localPathFromGeneratedImage(finalImage),
            printId: completedImage.printId ?? sourceIdentity.printId,
            artifactId: completedImage.artifactId,
            prompt: completedImage.prompt,
            sourceArtifactIds: [sourceIdentity.artifactId],
            inputIndex: index,
            outputIndex: 0,
          })
        } catch (error) {
          await diagnostics
            ?.append({
              type: 'error',
              provider: 'comfyui-chenyu',
              operation: 'extract-matting',
              itemKey: basename(sourceImagePath),
              error: errorForDiagnosticLog(error),
            })
            .catch(() => null)
          result.failed += 1
          const failure = generationFailureFromError(
            { prompt: extractPrompt, sourcePath: sourceImagePath },
            error,
          )
          result.failures.push(failure)
          fatalFailureObserved ||= failure.fatal === true
        } finally {
          emitMattingProgress(result, taskId, sourceImagePaths.length, emit)
        }
      }

      return await finishGenerationResultWithDiagnostics(
        diagnostics,
        result,
        'comfyui-chenyu',
        'extract-matting',
      )
    } finally {
      db.close()
      if (createdTempDir) {
        await tempFiles.cleanupTask('matting', taskId)
      }
    }
  })
}

export async function runComfyuiMattingBatch(
  input: ComfyuiMattingRunInput,
  dependencies: GenerationServiceDependencies = {},
) {
  if (requestedComfyuiSourceCount(input) === 0) {
    throw new AppErrorClass('HTTP_4XX', '请先选择至少一个印花', false)
  }
  if (!input.workflowId.trim()) {
    throw new AppErrorClass('HTTP_4XX', '请选择 ComfyUI 抠图工作流', false)
  }

  const apiKey = await (dependencies.getSecret ?? getSecret)('chenyu')
  if (!apiKey) {
    throw new AppErrorClass('HTTP_4XX', '缺少晨羽智云 API Key', false, {
      provider: 'comfyui-chenyu',
    })
  }

  const taskId = generationTaskId(input.taskId, 'matting')
  return comfyuiInstanceLocks.run(input, taskId, async () => {
    const emit = createGenerationProgressEmitter(dependencies)
    const workbenchRoot = await readWorkbenchRoot(dependencies.readConfig)
    const diagnostics = await createGenerationDiagnostics(workbenchRoot, taskId, {
      provider: 'comfyui-chenyu',
      capability: 'matting',
      workflowId: input.workflowId,
      sourceCount: requestedComfyuiSourceCount(input),
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
        total: sourceArtifactIds.length,
        succeeded: 0,
        failed: 0,
        images: [],
        failures: [],
        ...(diagnostics ? { diagnosticsLogPath: diagnostics.path } : {}),
      }
      const sizePx = comfyuiOptionalSizePx(input)
      const adapter = await createComfyuiAdapterForRun(
        input,
        apiKey,
        workbenchRoot,
        db,
        dependencies,
        diagnostics,
      )
      const debug = createGenerationDebugLogger(dependencies, { taskId, capability: 'matting' })
      let outputIndex = input.filenameStartIndex ?? 0
      let fatalFailureObserved = false

      for (const [index, artifactId] of sourceArtifactIds.entries()) {
        if (fatalFailureObserved || isGenerationCancelled(taskId)) {
          break
        }
        emitMattingProgress(result, taskId, sourceArtifactIds.length, emit)
        try {
          const source = await readReferenceForArtifact(db, workbenchRoot, artifactId)
          const prompt = input.prompt?.trim() || 'Remove the background and output transparent PNG.'
          const filenameIndex = outputIndex
          emitComfyuiRequestLog(debug, {
            ...input,
            prompt,
            sourceImage: basename(source.imagePath),
            sourceIndex: index + 1,
            total: sourceArtifactIds.length,
            ...(sizePx ? { width: sizePx.width, height: sizePx.height } : {}),
          })
          const response = await adapter.generate({
            capability: 'matting',
            prompt,
            workflow_id: input.workflowId.trim(),
            reference_images: [source.reference],
            output: { format: 'png', ...(sizePx ? { size_px: sizePx } : {}) },
            options: {
              taskId,
              sourceArtifactIds: [artifactId],
              printId: source.printId,
              ...(sizePx ? { width: sizePx.width, height: sizePx.height } : {}),
              ...comfyuiRunOptions(workbenchRoot, 'matting', taskId, input, filenameIndex),
              ...(input.workflowVersion ? { workflowVersion: input.workflowVersion } : {}),
            },
          } satisfies GenerateRequest)
          if (response.status !== 'succeeded') {
            throw response.error ?? new AppErrorClass('HTTP_5XX', 'ComfyUI 抠图失败', true)
          }
          outputIndex += response.images.length
          for (const [responseIndex, image] of response.images.entries()) {
            const completedImage = {
              prompt,
              url: image.url,
              ...(image.local_path ? { localPath: image.local_path } : {}),
              sourcePath: source.imagePath,
              ...generationImageIdentity(image, { artifactId, printId: source.printId }),
            }
            result.succeeded += 1
            result.images.push(completedImage)
            await emitImageComplete(dependencies, {
              taskId,
              capability: 'matting',
              path: localPathFromGeneratedImage(image),
              printId: completedImage.printId ?? source.printId,
              artifactId: completedImage.artifactId,
              prompt: completedImage.prompt,
              sourceArtifactIds: [artifactId],
              inputIndex: index,
              outputIndex: responseIndex,
            })
          }
        } catch (error) {
          await diagnostics
            ?.append({
              type: 'error',
              provider: 'comfyui-chenyu',
              operation: 'matting',
              itemKey: artifactId,
              error: errorForDiagnosticLog(error),
            })
            .catch(() => null)
          result.failed += 1
          const failure = generationFailureFromError(
            { prompt: input.prompt?.trim() ?? '', sourcePath: artifactId },
            error,
          )
          result.failures.push(failure)
          fatalFailureObserved ||= failure.fatal === true
        } finally {
          emitMattingProgress(result, taskId, sourceArtifactIds.length, emit)
        }
      }

      return await finishGenerationResultWithDiagnostics(
        diagnostics,
        result,
        'comfyui-chenyu',
        'matting',
      )
    } finally {
      db.close()
    }
  })
}

export async function runMixedMattingBatch(
  input: MixedMattingRunInput,
  dependencies: GenerationServiceDependencies = {},
) {
  if (requestedComfyuiSourceCount(input) === 0) {
    throw new AppErrorClass('HTTP_4XX', '请先选择至少一个印花', false)
  }
  if (!input.workflowId.trim()) {
    throw new AppErrorClass('HTTP_4XX', '请选择 ComfyUI 混合抠图工作流', false)
  }
  const grsaiKey = await (dependencies.getSecret ?? getSecret)('grsai')
  if (!grsaiKey) {
    throw new AppErrorClass('HTTP_4XX', '缺少 Grsai API Key', false, { provider: 'grsai' })
  }
  const chenyuKey = await (dependencies.getSecret ?? getSecret)('chenyu')
  if (!chenyuKey) {
    throw new AppErrorClass('HTTP_4XX', '缺少晨羽智云 API Key', false, {
      provider: 'comfyui-chenyu',
    })
  }

  const taskId = generationTaskId(input.taskId, 'matting')
  return comfyuiInstanceLocks.run(input, taskId, async () => {
    const emit = createGenerationProgressEmitter(dependencies)
    const workbenchRoot = await readWorkbenchRoot(dependencies.readConfig)
    const diagnostics = await createGenerationDiagnostics(workbenchRoot, taskId, {
      provider: 'grsai+comfyui-mask',
      capability: 'matting',
      workflowId: input.workflowId,
      sourceCount: requestedComfyuiSourceCount(input),
    })
    const db = (dependencies.openDatabase ?? openWorkbenchDatabase)(workbenchRoot)
    const tempFiles = dependencies.tempFiles ?? tempFileManager
    let createdTempDir = false

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
        total: sourceArtifactIds.length,
        succeeded: 0,
        failed: 0,
        images: [],
        failures: [],
        ...(diagnostics ? { diagnosticsLogPath: diagnostics.path } : {}),
      }
      const sizePx = comfyuiOptionalSizePx(input)
      await tempFiles.createTaskDir('matting', taskId)
      createdTempDir = true
      const skill = await resolveMixedMattingMaskSkill(
        input,
        dependencies.skillCache ?? skillCacheManager,
      )
      const settings = normalizeGenerationLocalConfig((await readAppConfig()).generation)
      const grsai =
        dependencies.createGrsaiAdapter?.(grsaiKey) ??
        new GrsaiAdapter(grsaiKey, settings.grsai_node, {
          retries: settings.grsai_retries,
          ...(diagnostics ? { diagnostics } : {}),
        })
      const downloadImage = dependencies.downloadImage ?? defaultDownloadImage
      const comfyui = await createComfyuiAdapterForRun(
        input,
        chenyuKey,
        workbenchRoot,
        db,
        dependencies,
        diagnostics,
      )
      const debug = createGenerationDebugLogger(dependencies, { taskId, capability: 'matting' })
      let outputIndex = input.filenameStartIndex ?? 0
      let fatalFailureObserved = false

      for (const [index, artifactId] of sourceArtifactIds.entries()) {
        if (fatalFailureObserved || isGenerationCancelled(taskId)) {
          break
        }
        emitMattingProgress(result, taskId, sourceArtifactIds.length, emit)
        let maskPath: string | null = null
        try {
          const source = await readReferenceForArtifact(db, workbenchRoot, artifactId)
          maskPath = join(await tempFiles.createTaskDir('matting', taskId), 'mask.png')
          const maskModel = normalizeModel(input.maskModel ?? DEFAULT_GENERATION_MODEL)
          const maskResponse = await grsai.generate({
            capability: 'img2img',
            prompt: skill.systemPrompt,
            reference_images: [source.reference],
            output: {
              aspect_ratio: '1024x1024',
              format: 'png',
            },
            model: maskModel,
            options: {
              replyType: 'async',
              skillId: skill.id,
              skillVersion: skill.version,
            },
          } satisfies GenerateRequest)
          if (maskResponse.status !== 'succeeded') {
            throw (
              maskResponse.error ?? new AppErrorClass('GRSAI_FAILED', 'Grsai 黑白图生成失败', true)
            )
          }
          const maskImage = maskResponse.images[0]
          if (!maskImage) {
            throw new AppErrorClass('GRSAI_FAILED', 'Grsai 未返回黑白图', true)
          }
          const maskBuffer = maskImage.local_path
            ? await readFile(maskImage.local_path)
            : await downloadImage(maskImage.url)
          await writeFile(maskPath, maskBuffer)

          const prompt =
            input.prompt?.trim() ||
            'Convert the black and white mask to alpha and composite it with the original print.'
          const filenameIndex = outputIndex
          emitComfyuiRequestLog(debug, {
            ...input,
            prompt,
            sourceImage: basename(source.imagePath),
            sourceIndex: index + 1,
            total: sourceArtifactIds.length,
            ...(sizePx ? { width: sizePx.width, height: sizePx.height } : {}),
          })
          const response = await comfyui.generate({
            capability: 'matting',
            prompt,
            workflow_id: input.workflowId.trim(),
            reference_images: [source.reference, await imageReference(maskPath)],
            output: { format: 'png', ...(sizePx ? { size_px: sizePx } : {}) },
            options: {
              taskId,
              sourceArtifactIds: [artifactId],
              printId: source.printId,
              ...(sizePx ? { width: sizePx.width, height: sizePx.height } : {}),
              ...comfyuiRunOptions(workbenchRoot, 'matting', taskId, input, filenameIndex),
              workflowCategory: 'matting-mixed',
              artifactProvider: 'grsai+comfyui-mask',
              maskSkillId: skill.id,
              maskSkillVersion: skill.version,
              maskModel,
              imageSlotIndexes: {
                sourceImage: 0,
                originalImage: 0,
                image: 0,
                maskImage: 1,
                mask: 1,
                alpha: 1,
              },
              ...(input.workflowVersion ? { workflowVersion: input.workflowVersion } : {}),
            },
          } satisfies GenerateRequest)
          if (response.status !== 'succeeded') {
            throw response.error ?? new AppErrorClass('HTTP_5XX', 'ComfyUI 混合抠图失败', true)
          }
          outputIndex += response.images.length
          for (const [responseIndex, image] of response.images.entries()) {
            const completedImage = {
              prompt,
              url: image.url,
              ...(image.local_path ? { localPath: image.local_path } : {}),
              sourcePath: source.imagePath,
              ...generationImageIdentity(image, { artifactId, printId: source.printId }),
            }
            result.succeeded += 1
            result.images.push(completedImage)
            await emitImageComplete(dependencies, {
              taskId,
              capability: 'matting',
              path: localPathFromGeneratedImage(image),
              printId: completedImage.printId ?? source.printId,
              artifactId: completedImage.artifactId,
              prompt: completedImage.prompt,
              sourceArtifactIds: [artifactId],
              inputIndex: index,
              outputIndex: responseIndex,
            })
          }
        } catch (error) {
          await diagnostics
            ?.append({
              type: 'error',
              provider: 'grsai+comfyui-mask',
              operation: 'matting',
              itemKey: artifactId,
              error: errorForDiagnosticLog(error),
            })
            .catch(() => null)
          result.failed += 1
          const failure = generationFailureFromError(
            { prompt: input.prompt?.trim() ?? '', sourcePath: artifactId },
            error,
          )
          result.failures.push(failure)
          fatalFailureObserved ||= failure.fatal === true
        } finally {
          if (maskPath) {
            await rm(maskPath, { force: true })
          }
          emitMattingProgress(result, taskId, sourceArtifactIds.length, emit)
        }
      }

      return await finishGenerationResultWithDiagnostics(
        diagnostics,
        result,
        'grsai+comfyui-mask',
        'matting',
      )
    } finally {
      db.close()
      if (createdTempDir) {
        await tempFiles.cleanupTask('matting', taskId)
      }
    }
  })
}
