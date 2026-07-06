import { AppErrorClass, type GenerationCapability } from '@tengyu-aipod/shared'
import {
  ChenyuCloudClient,
  type ChenyuWorkflowMarketParams,
  chenyuStatusName,
} from '../../chenyu-cloud-client'
import {
  type ChenyuRunImageWorkflowInput,
  type ChenyuRunImageWorkflowResult,
  ChenyuWorkflowRunner,
} from '../../chenyu-workflow-runner'
import { errorForDiagnosticLog } from '../../diagnostic-log-service'
import { getSecret } from '../../keychain'
import { openWorkbenchDatabase } from '../runtime'
import {
  type GenerationServiceDependencies,
  createGenerationDebugLogger,
  createGenerationDiagnostics,
  createGenerationProgressEmitter,
  generationTaskId,
  readWorkbenchRoot,
  submitGenerationTask,
} from '../runtime'
import { isGenerationCancelled, markGenerationResultCancelled } from '../task-registry'
import type {
  ChenyuWorkflowMarketListInput,
  ChenyuWorkflowRunInput,
  GenerationRunResult,
} from '../types'

function chenyuWorkflowMarketParams(
  input: ChenyuWorkflowMarketListInput,
): ChenyuWorkflowMarketParams {
  return {
    ...(input.keyword !== undefined ? { keyword: input.keyword } : {}),
    ...(input.tag !== undefined ? { tag: input.tag } : {}),
    ...(input.sort !== undefined ? { sort: input.sort } : {}),
    ...(input.page !== undefined ? { page: input.page } : {}),
    ...(input.page_size !== undefined ? { page_size: input.page_size } : {}),
  }
}

export async function listChenyuWorkflowMarket(
  input: ChenyuWorkflowMarketListInput = {},
  dependencies: GenerationServiceDependencies = {},
) {
  const apiKey = await (dependencies.getSecret ?? getSecret)('chenyu')
  if (!apiKey) {
    throw new AppErrorClass('HTTP_4XX', '缺少晨羽智云 API Key', false, {
      provider: 'comfyui-chenyu-workflow',
    })
  }
  const runner =
    dependencies.createChenyuWorkflowRunner?.({ apiKey, workbenchRoot: '' }) ??
    new ChenyuWorkflowRunner({
      chenyu: new ChenyuCloudClient(apiKey),
      workbenchRoot: '',
      openDatabase: dependencies.openDatabase ?? openWorkbenchDatabase,
    })
  return runner.listWorkflows(chenyuWorkflowMarketParams(input))
}

export async function getChenyuWorkflowInfo(
  workflowId: string,
  dependencies: GenerationServiceDependencies = {},
) {
  if (!workflowId.trim()) {
    throw new AppErrorClass('HTTP_4XX', '请选择晨羽工作流', false, {
      provider: 'comfyui-chenyu-workflow',
    })
  }
  const apiKey = await (dependencies.getSecret ?? getSecret)('chenyu')
  if (!apiKey) {
    throw new AppErrorClass('HTTP_4XX', '缺少晨羽智云 API Key', false, {
      provider: 'comfyui-chenyu-workflow',
    })
  }
  const runner =
    dependencies.createChenyuWorkflowRunner?.({ apiKey, workbenchRoot: '' }) ??
    new ChenyuWorkflowRunner({
      chenyu: new ChenyuCloudClient(apiKey),
      workbenchRoot: '',
      openDatabase: dependencies.openDatabase ?? openWorkbenchDatabase,
    })
  return runner.getWorkflowInfo(workflowId)
}

export async function runChenyuWorkflow(
  input: ChenyuWorkflowRunInput,
  dependencies: GenerationServiceDependencies = {},
) {
  if (!input.workflowId.trim()) {
    throw new AppErrorClass('HTTP_4XX', '请选择晨羽工作流', false, {
      provider: 'comfyui-chenyu-workflow',
    })
  }
  const workbenchRoot = await readWorkbenchRoot(dependencies.readConfig)
  const apiKey = await (dependencies.getSecret ?? getSecret)('chenyu')
  if (!apiKey) {
    throw new AppErrorClass('HTTP_4XX', '缺少晨羽智云 API Key', false, {
      provider: 'comfyui-chenyu-workflow',
    })
  }

  const taskId = generationTaskId(input.taskId, input.capability)
  createGenerationDebugLogger({}, { taskId, capability: input.capability })('任务已提交', 'info', {
    operation: 'submit',
    provider: 'comfyui-chenyu-workflow',
    workflowId: input.workflowId,
    revisionId: input.revisionId ?? null,
  })
  submitGenerationTask(taskId, () =>
    runChenyuWorkflowTask(
      {
        workflowId: input.workflowId,
        capability: input.capability,
        ...(input.revisionId ? { revisionId: input.revisionId } : {}),
        ...(input.inputs ? { inputs: input.inputs } : {}),
        ...(input.prompt ? { prompt: input.prompt } : {}),
        ...(input.acceptExternalCostRisk !== undefined
          ? { acceptExternalCostRisk: input.acceptExternalCostRisk }
          : {}),
        taskId,
      },
      {
        ...dependencies,
        getSecret: async () => apiKey,
      },
      workbenchRoot,
      apiKey,
    ),
  )
  return taskId
}

async function runChenyuWorkflowTask(
  input: ChenyuRunImageWorkflowInput,
  dependencies: GenerationServiceDependencies,
  workbenchRoot: string,
  apiKey: string,
): Promise<GenerationRunResult> {
  const emit = createGenerationProgressEmitter(dependencies)
  const taskId = generationTaskId(input.taskId, input.capability)
  const diagnostics = await createGenerationDiagnostics(workbenchRoot, taskId, {
    provider: 'comfyui-chenyu-workflow',
    capability: input.capability,
    workflowId: input.workflowId,
    revisionId: input.revisionId ?? null,
    hasInputs: Boolean(input.inputs),
  })
  emit({
    task_id: taskId,
    capability: input.capability,
    processed: 0,
    total: 1,
    succeeded: 0,
    failed: 0,
    ...(input.prompt ? { current_prompt: input.prompt } : {}),
  })
  if (isGenerationCancelled(taskId)) {
    const cancelledResult: GenerationRunResult = {
      taskId,
      total: 1,
      succeeded: 0,
      failed: 0,
      images: [],
      failures: [],
      cancelled: true,
      ...(diagnostics ? { diagnosticsLogPath: diagnostics.path } : {}),
    }
    await diagnostics?.append({
      type: 'task_completed',
      provider: 'comfyui-chenyu-workflow',
      operation: input.capability,
      data: {
        total: cancelledResult.total,
        succeeded: cancelledResult.succeeded,
        failed: cancelledResult.failed,
        cancelled: true,
      },
    })
    return cancelledResult
  }
  const runner =
    dependencies.createChenyuWorkflowRunner?.({
      apiKey,
      workbenchRoot,
      ...(diagnostics ? { diagnostics } : {}),
    }) ??
    new ChenyuWorkflowRunner({
      chenyu: new ChenyuCloudClient(apiKey),
      workbenchRoot,
      openDatabase: dependencies.openDatabase ?? openWorkbenchDatabase,
      ...(diagnostics ? { diagnostics } : {}),
    })
  try {
    await diagnostics?.append({
      type: 'request',
      provider: 'comfyui-chenyu-workflow',
      operation: 'runImageWorkflow',
      data: { input },
    })
    const response = await runner.runImageWorkflow(input)
    await diagnostics?.append({
      type: 'response',
      provider: 'comfyui-chenyu-workflow',
      operation: 'runImageWorkflow',
      data: { raw: response },
    })
    const result = chenyuWorkflowRunResult(input, response)
    if (diagnostics) {
      result.diagnosticsLogPath = diagnostics.path
    }
    const finalResult = markGenerationResultCancelled(result)
    await diagnostics?.append({
      type: 'task_completed',
      provider: 'comfyui-chenyu-workflow',
      operation: input.capability,
      data: {
        total: finalResult.total,
        succeeded: finalResult.succeeded,
        failed: finalResult.failed,
        cancelled: finalResult.cancelled ?? false,
      },
    })
    emit({
      task_id: finalResult.taskId,
      capability: input.capability,
      processed: 1,
      total: 1,
      succeeded: finalResult.succeeded,
      failed: finalResult.failed,
      images: finalResult.images,
      ...(input.prompt ? { current_prompt: input.prompt } : {}),
    })
    return finalResult
  } catch (error) {
    await diagnostics?.append({
      type: 'task_failed',
      provider: 'comfyui-chenyu-workflow',
      operation: input.capability,
      error: errorForDiagnosticLog(error),
    })
    throw error
  }
}

function chenyuWorkflowRunResult(
  input: ChenyuRunImageWorkflowInput,
  response: ChenyuRunImageWorkflowResult,
): GenerationRunResult {
  return {
    taskId: input.taskId ?? response.submit.run_order_id,
    total: 1,
    succeeded: response.images.length,
    failed: 0,
    images: response.images.map((image) => ({
      prompt: input.prompt ?? '',
      url: image.url,
      localPath: image.local_path,
      artifactId: image.artifact_id,
    })),
    failures: [],
  }
}
