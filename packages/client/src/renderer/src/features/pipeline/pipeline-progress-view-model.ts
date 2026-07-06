import type {
  PipelineItemRecord,
  PipelineProgress,
  PipelineResultSection,
  PipelineRunDetail,
  PipelineRunStats,
  PipelineStepKey,
  PipelineStepRecord,
} from '@tengyu-aipod/shared'
import type { PipelineConfigStage, PipelineValidationIssue } from './types'

export type RailMode = 'config' | 'running' | 'done'

export type RailStage = {
  key: PipelineConfigStage
  label: string
  enabled: boolean
  locked?: { on: boolean; reason: string }
  issues: number
  counts: { done: number; total: number; failed: number; blocked: number }
  active: boolean
  durationMs: number | null
}

export type PipelineRailViewModel = {
  mode: RailMode
  stages: RailStage[]
  logTail: string[]
  summary: { status: string; warning: string | null }
}

type StageEnabledMap = Record<PipelineConfigStage, boolean>

type BuildPipelineRailViewModelInput = {
  progress: PipelineProgress | PipelineRunDetail | null
  issues: PipelineValidationIssue[]
  enabled: StageEnabledMap
}

type ProgressSnapshot = {
  status: string
  message: string
  stats: PipelineRunStats | null
  steps: PipelineStepRecord[]
  items: PipelineItemRecord[]
  resultSections: PipelineResultSection[]
  logs: string[]
}

const STAGE_ORDER: PipelineConfigStage[] = ['source', 'matting', 'detection', 'photoshop', 'title']

const STAGE_LABELS: Record<PipelineConfigStage, string> = {
  source: '任务起点',
  matting: '抠图',
  detection: '侵权检测',
  photoshop: 'PS 套版',
  title: '标题',
}

const EMPTY_STATS: PipelineRunStats = {
  sourceImages: 0,
  prints: 0,
  detectionPass: 0,
  detectionReview: 0,
  detectionBlock: 0,
  photoshopGroups: 0,
  titleSucceeded: 0,
  titleFailed: 0,
}

function stepStage(stepKey: PipelineStepKey): PipelineConfigStage {
  if (stepKey === 'source' || stepKey === 'extract') {
    return 'source'
  }
  return stepKey
}

function parseStats(statsJson: string): PipelineRunStats {
  try {
    return { ...EMPTY_STATS, ...(JSON.parse(statsJson) as Partial<PipelineRunStats>) }
  } catch {
    return { ...EMPTY_STATS }
  }
}

function statusMessage(status: string, fallback: string | null) {
  if (fallback) {
    return fallback
  }
  if (status === 'running') {
    return '完整任务运行中'
  }
  if (status === 'completed') {
    return '完整任务已完成'
  }
  if (status === 'cancelled') {
    return '完整任务已取消，已完成产物已保留'
  }
  if (status === 'interrupted') {
    return '完整任务已中断，已完成产物已保留'
  }
  return '完整任务已结束'
}

function toSnapshot(
  progress: PipelineProgress | PipelineRunDetail | null,
): ProgressSnapshot | null {
  if (!progress) {
    return null
  }
  if ('run' in progress) {
    return {
      status: progress.run.status,
      message: statusMessage(progress.run.status, progress.run.error_summary),
      stats: parseStats(progress.run.stats_json),
      steps: progress.steps,
      items: progress.items ?? [],
      resultSections: progress.result_sections ?? [],
      logs: (progress.logs ?? []).map((entry) => entry.message),
    }
  }
  return {
    status: progress.status,
    message: progress.message,
    stats: progress.stats,
    steps: progress.steps,
    items: progress.items ?? [],
    resultSections: progress.result_sections ?? [],
    logs: (progress.logs ?? []).map((entry) => entry.message),
  }
}

function issueCountForStage(issues: PipelineValidationIssue[], stage: PipelineConfigStage) {
  return issues.filter((issue) => issue.stage === stage).length
}

function durationMsForSteps(steps: PipelineStepRecord[]) {
  const startedAt = steps
    .map((step) => step.started_at)
    .filter((value): value is number => typeof value === 'number')
  const completedAt = steps
    .map((step) => step.completed_at)
    .filter((value): value is number => typeof value === 'number')
  if (startedAt.length === 0 || completedAt.length === 0) {
    return null
  }
  return Math.max(0, Math.max(...completedAt) - Math.min(...startedAt))
}

function itemRiskLevel(item: PipelineItemRecord) {
  if ('risk_level' in item && typeof item.risk_level === 'string') {
    return item.risk_level
  }
  if ('riskLevel' in item && typeof item.riskLevel === 'string') {
    return item.riskLevel
  }
  return null
}

function sectionCompleted(sections: PipelineResultSection[], key: PipelineResultSection['key']) {
  return sections.find((section) => section.key === key)?.completed ?? 0
}

function sectionOutputCount(sections: PipelineResultSection[], key: PipelineResultSection['key']) {
  const section = sections.find((item) => item.key === key)
  if (!section) {
    return 0
  }
  return section.completed + section.items.length + (section.groups?.length ?? 0)
}

function countStage(input: {
  stage: PipelineConfigStage
  steps: PipelineStepRecord[]
  items: PipelineItemRecord[]
  sections: PipelineResultSection[]
  stats: PipelineRunStats | null
}) {
  const stageSteps = input.steps.filter((step) => stepStage(step.step_key) === input.stage)
  const stageItems = input.items.filter((item) => stepStage(item.step_key) === input.stage)
  const itemDone = stageItems.filter((item) => item.status === 'completed').length
  const itemFailed = stageItems.filter((item) => item.status === 'failed').length
  const stepOutputDone = stageSteps.reduce((sum, step) => sum + step.output_count, 0)
  const completedStepDone = stageSteps.filter((step) => step.status === 'completed').length
  const failedStepCount = stageSteps.filter((step) => step.status === 'failed').length
  const stepTotal = stageSteps.reduce(
    (max, step) => Math.max(max, step.input_count, step.output_count),
    0,
  )
  const blocked =
    input.stage === 'detection'
      ? Math.max(
          stageItems.filter((item) => itemRiskLevel(item) === 'block').length,
          sectionCompleted(input.sections, 'detection_blocked'),
          input.stats?.detectionBlock ?? 0,
        )
      : 0

  return {
    done: stageItems.length > 0 ? itemDone : Math.max(stepOutputDone, completedStepDone),
    total: Math.max(stageItems.length, stepTotal, blocked),
    failed: stageItems.length > 0 ? itemFailed : failedStepCount,
    blocked,
  }
}

function buildStage(input: {
  stage: PipelineConfigStage
  snapshot: ProgressSnapshot | null
  enabled: boolean
  issues: PipelineValidationIssue[]
}): RailStage {
  const stageSteps =
    input.snapshot?.steps.filter((step) => stepStage(step.step_key) === input.stage) ?? []
  return {
    key: input.stage,
    label: STAGE_LABELS[input.stage],
    enabled: input.enabled,
    issues: issueCountForStage(input.issues, input.stage),
    counts: input.snapshot
      ? countStage({
          stage: input.stage,
          steps: input.snapshot.steps,
          items: input.snapshot.items,
          sections: input.snapshot.resultSections,
          stats: input.snapshot.stats,
        })
      : { done: 0, total: 0, failed: 0, blocked: 0 },
    active: stageSteps.some((step) => step.status === 'running'),
    durationMs: durationMsForSteps(stageSteps),
  }
}

function railMode(snapshot: ProgressSnapshot | null): RailMode {
  if (!snapshot) {
    return 'config'
  }
  if (snapshot.status === 'running') {
    return 'running'
  }
  return 'done'
}

function summaryWarning(
  stages: RailStage[],
  enabled: StageEnabledMap,
  snapshot: ProgressSnapshot | null,
) {
  if (snapshot?.status !== 'completed' || !enabled.detection) {
    return null
  }
  const detection = stages.find((stage) => stage.key === 'detection')
  const photoshopOutput = Math.max(
    snapshot.stats?.photoshopGroups ?? 0,
    sectionOutputCount(snapshot.resultSections, 'print_products'),
  )
  const titleOutput = snapshot.stats?.titleSucceeded ?? 0
  const allDetectedPrintsBlocked =
    detection &&
    detection.counts.blocked > 0 &&
    detection.counts.blocked >= Math.max(detection.counts.total, detection.counts.done)
  const noDownstreamOutput =
    (!enabled.photoshop || photoshopOutput === 0) && (!enabled.title || titleOutput === 0)
  return allDetectedPrintsBlocked && noDownstreamOutput ? '本次没有可继续的印花' : null
}

export function buildPipelineRailViewModel(
  input: BuildPipelineRailViewModelInput,
): PipelineRailViewModel {
  const snapshot = toSnapshot(input.progress)
  const stages = STAGE_ORDER.map((stage) =>
    buildStage({
      stage,
      snapshot,
      enabled: input.enabled[stage],
      issues: input.issues,
    }),
  )
  const status = snapshot?.message ?? '等待配置完整任务'

  return {
    mode: railMode(snapshot),
    stages,
    logTail: snapshot?.logs.slice(-5) ?? [],
    summary: {
      status,
      warning: summaryWarning(stages, input.enabled, snapshot),
    },
  }
}
