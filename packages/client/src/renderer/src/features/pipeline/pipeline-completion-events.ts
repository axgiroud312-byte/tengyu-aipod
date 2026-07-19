import type { PipelineProgress, PipelineTaskEvent } from '@tengyu-aipod/shared'

export function shouldApplyPipelineProgress(
  currentRunId: string | null,
  progress: Pick<PipelineProgress, 'run_id'>,
) {
  return Boolean(currentRunId && progress.run_id === currentRunId)
}

export function mergePipelineProgress(
  current: PipelineProgress | null,
  next: PipelineProgress,
): PipelineProgress {
  if (!current || current.run_id !== next.run_id) {
    return next
  }

  const merged: PipelineProgress = { ...current, ...next }
  if (next.items !== undefined) {
    merged.items = next.items
  } else if (current.items !== undefined) {
    merged.items = current.items
  }
  if (next.preview_images !== undefined) {
    merged.preview_images = next.preview_images
  } else if (current.preview_images !== undefined) {
    merged.preview_images = current.preview_images
  }
  if (next.result_sections !== undefined) {
    merged.result_sections = next.result_sections
  } else if (current.result_sections !== undefined) {
    merged.result_sections = current.result_sections
  }
  if (next.logs !== undefined) {
    merged.logs = next.logs
  } else if (current.logs !== undefined) {
    merged.logs = current.logs
  }
  return merged
}

export function pipelineCompletedEventRunId(event: PipelineTaskEvent) {
  return event.ok ? event.result.run.id : event.run_id
}

export function shouldApplyPipelineCompletedEvent(
  currentRunId: string | null,
  event: PipelineTaskEvent,
) {
  return Boolean(currentRunId && pipelineCompletedEventRunId(event) === currentRunId)
}
