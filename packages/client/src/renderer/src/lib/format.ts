type ProcessedProgress = {
  processed: number
  total: number
}

type FinishedProgress = {
  finishedCount: number
  totalCount: number
}

type GroupProgress = {
  completed: number
  skipped: number
  total_groups: number
}

type ProgressPercentInput = ProcessedProgress | FinishedProgress | GroupProgress

export function progressPercent(progress: ProgressPercentInput | null | undefined) {
  if (!progress) {
    return 0
  }
  if ('total' in progress) {
    return progress.total === 0 ? 0 : Math.round((progress.processed / progress.total) * 100)
  }
  if ('totalCount' in progress) {
    return progress.totalCount === 0
      ? 0
      : Math.round((progress.finishedCount / progress.totalCount) * 100)
  }
  return progress.total_groups <= 0
    ? 0
    : Math.round(((progress.completed + progress.skipped) / progress.total_groups) * 100)
}
