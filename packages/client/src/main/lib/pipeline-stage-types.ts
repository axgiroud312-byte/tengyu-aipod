import type { PipelineRunConfig, PipelineStepKey } from '@tengyu-aipod/shared'

// 完整任务流式 stage 契约：
// - 上游按实际完成顺序持续吐 item，下游逐张消费，不等整批。
// - itemKey 是本次 run 内的稳定键；成功项通常复用 printId，失败项可用合成键。
// - stage 只在“启动不了/用户取消”这类致命情况抛错；单张失败要在 stage 内记状态并继续。
// #9 / #10 / #11 只需要新增 stage 文件并在注册表加一行，不改核心编排。
export type PipelineStreamItem = {
  itemKey: string
  path: string
  artifactId?: string | undefined
  printId?: string | undefined
  sourceArtifactIds: string[]
}

export type PipelineStageRuntimeContext = {
  runId: string
  config: PipelineRunConfig
  stepKey: PipelineStepKey
  isCancelled: () => boolean
}

export type PipelinePrintStage<
  TInput = PipelineStreamItem,
  TOutput = PipelineStreamItem,
> = (input: AsyncIterable<TInput>, context: PipelineStageRuntimeContext) => AsyncIterable<TOutput>

export type PipelinePrintStageFactory<
  TInput = PipelineStreamItem,
  TOutput = PipelineStreamItem,
> = (context: PipelineStageRuntimeContext) => PipelinePrintStage<TInput, TOutput>

export type PipelinePrintStageRegistration<
  TInput = PipelineStreamItem,
  TOutput = PipelineStreamItem,
> = {
  stepKey: PipelineStepKey
  create: PipelinePrintStageFactory<TInput, TOutput>
}

export type PipelinePrintStreamItem = PipelineStreamItem
