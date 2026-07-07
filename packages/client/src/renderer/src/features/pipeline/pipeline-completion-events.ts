import type { PipelineTaskEvent } from '@tengyu-aipod/shared'

export function pipelineCompletedEventRunId(event: PipelineTaskEvent) {
  return event.ok ? event.result.run.id : event.run_id
}

export function shouldApplyPipelineCompletedEvent(
  currentRunId: string | null,
  event: PipelineTaskEvent,
) {
  if (!currentRunId) {
    return true
  }
  return pipelineCompletedEventRunId(event) === currentRunId
}
