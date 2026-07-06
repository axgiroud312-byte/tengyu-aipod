const activeGenerationTasks = new Set<string>()
const cancelledGenerationTasks = new Set<string>()

export function requestGenerationTaskCancel(taskId: string) {
  if (!activeGenerationTasks.has(taskId)) {
    return false
  }
  cancelledGenerationTasks.add(taskId)
  return true
}

export function beginGenerationTask(taskId: string) {
  activeGenerationTasks.add(taskId)
  cancelledGenerationTasks.delete(taskId)
}

export function finishGenerationTask(taskId: string) {
  activeGenerationTasks.delete(taskId)
  cancelledGenerationTasks.delete(taskId)
}

export function isGenerationCancelled(taskId: string) {
  return cancelledGenerationTasks.has(taskId)
}

export function getActiveGenerationTaskCount() {
  return activeGenerationTasks.size
}

export function requestAllGenerationCancels() {
  for (const taskId of activeGenerationTasks) {
    cancelledGenerationTasks.add(taskId)
  }
  return activeGenerationTasks.size
}

export function markGenerationResultCancelled<
  T extends { taskId: string; cancelled?: boolean | undefined },
>(result: T): T {
  if (isGenerationCancelled(result.taskId)) {
    result.cancelled = true
  }
  return result
}
