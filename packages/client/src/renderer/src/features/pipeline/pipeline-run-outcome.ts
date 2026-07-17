import type {
  PipelineProgress,
  PipelineResultSection,
  PipelineRunDetail,
  PipelineRunRecord,
  PipelineRunStats,
  PipelineRuntimeLogEntry,
} from '@tengyu-aipod/shared'

function parseJson(value: string | null): unknown {
  if (!value) {
    return null
  }
  try {
    return JSON.parse(value) as unknown
  } catch {
    return null
  }
}

function hasFailedResultSection(value: unknown) {
  return (
    Array.isArray(value) &&
    value.some(
      (section) =>
        typeof section === 'object' &&
        section !== null &&
        'failed' in section &&
        typeof section.failed === 'number' &&
        section.failed > 0,
    )
  )
}

function hasErrorLog(value: unknown) {
  return (
    Array.isArray(value) &&
    value.some(
      (entry) =>
        typeof entry === 'object' && entry !== null && 'level' in entry && entry.level === 'error',
    )
  )
}

function hasTitleFailure(value: unknown) {
  return (
    typeof value === 'object' &&
    value !== null &&
    'titleFailed' in value &&
    typeof value.titleFailed === 'number' &&
    value.titleFailed > 0
  )
}

function progressEvidenceHasException(input: {
  stats: PipelineRunStats
  resultSections: PipelineResultSection[]
  logs: PipelineRuntimeLogEntry[]
}) {
  return (
    input.stats.titleFailed > 0 ||
    hasFailedResultSection(input.resultSections) ||
    hasErrorLog(input.logs)
  )
}

export function completedPipelineRunHasException(run: PipelineRunRecord) {
  if (run.status !== 'completed') {
    return false
  }
  return (
    Boolean(run.error_summary) ||
    hasTitleFailure(parseJson(run.stats_json)) ||
    hasFailedResultSection(parseJson(run.result_sections_json)) ||
    hasErrorLog(parseJson(run.logs_json))
  )
}

export function pipelineProgressHasException(progress: PipelineProgress | PipelineRunDetail) {
  const status = 'run' in progress ? progress.run.status : progress.status
  if (status !== 'completed') {
    return false
  }
  const steps = progress.steps
  const items = progress.items ?? []
  if (steps.some((step) => step.status === 'failed')) {
    return true
  }
  if (items.some((item) => item.status === 'failed' || item.status === 'interrupted')) {
    return true
  }
  if ('run' in progress) {
    return (
      completedPipelineRunHasException(progress.run) ||
      hasFailedResultSection(progress.result_sections ?? []) ||
      hasErrorLog(progress.logs ?? [])
    )
  }
  return progressEvidenceHasException({
    stats: progress.stats,
    resultSections: progress.result_sections ?? [],
    logs: progress.logs ?? [],
  })
}
