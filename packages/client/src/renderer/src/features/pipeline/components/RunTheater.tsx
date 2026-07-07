import type { PipelineProgress, PipelineRunConfig } from '@tengyu-aipod/shared'
import type { PipelineRailViewModel } from '../pipeline-progress-view-model'
import type { PipelineConfigStage, PipelineValidationIssue } from '../types'
import { PipelineRail } from './PipelineRail'
import { PipelineItemsPanel, PipelineLogDialog, PipelineResultsPanel } from './PipelineResultPanels'

const STAGE_LABELS: Record<PipelineConfigStage, string> = {
  source: '任务起点',
  matting: '抠图',
  detection: '侵权检测',
  photoshop: 'PS 套版',
  title: '标题生成',
}

export function PipelineRunLogTail({ logs }: { logs: string[] }) {
  if (logs.length === 0) {
    return null
  }

  return (
    <div className="rounded-md border bg-muted/20 px-3 py-2">
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs font-medium text-muted-foreground">最近运行</p>
        <span className="text-xs tabular-nums text-muted-foreground">{logs.length}</span>
      </div>
      <div className="mt-2 space-y-1">
        {logs.map((log, index) => (
          <p className="truncate font-mono text-xs text-foreground" key={`${index}-${log}`}>
            {log}
          </p>
        ))}
      </div>
    </div>
  )
}

export function PipelineSelectedStageIssues({
  issues,
  selectedStage,
}: {
  issues: PipelineValidationIssue[]
  selectedStage: PipelineConfigStage | null
}) {
  if (issues.length === 0) {
    return null
  }

  if (!selectedStage) {
    return (
      <div className="rounded-md border border-dashed px-3 py-2 text-sm text-muted-foreground">
        还有 {issues.length} 项配置待补齐。选择导轨上带红点的阶段查看明细。
      </div>
    )
  }

  const stageIssues = issues.filter((issue) => issue.stage === selectedStage)
  if (stageIssues.length === 0) {
    return (
      <div className="rounded-md border border-dashed px-3 py-2 text-sm text-muted-foreground">
        {STAGE_LABELS[selectedStage]} 当前没有缺失配置。
      </div>
    )
  }

  return (
    <div className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-3 text-sm">
      <p className="font-medium text-destructive">
        {STAGE_LABELS[selectedStage]}缺少 {stageIssues.length} 项配置
      </p>
      <ul className="mt-2 list-disc space-y-1 pl-5 text-destructive">
        {stageIssues.map((issue) => (
          <li key={`${issue.stage}-${issue.field}-${issue.message}`}>{issue.message}</li>
        ))}
      </ul>
    </div>
  )
}

export function RunTheater({
  config,
  isLogOpen,
  message,
  onLogOpenChange,
  onSelectStage,
  progress,
  railView,
  selectedStage,
  validationIssues,
}: {
  config: PipelineRunConfig
  isLogOpen: boolean
  message: string
  onLogOpenChange: (open: boolean) => void
  onSelectStage: (stage: PipelineConfigStage) => void
  progress: PipelineProgress | null
  railView: PipelineRailViewModel
  selectedStage: PipelineConfigStage | null
  validationIssues: PipelineValidationIssue[]
}) {
  return (
    <div className="space-y-5">
      <PipelineRail onSelectStage={onSelectStage} selectedStage={selectedStage} view={railView} />
      <PipelineSelectedStageIssues issues={validationIssues} selectedStage={selectedStage} />
      <PipelineRunLogTail logs={railView.logTail} />
      <PipelineResultsPanel config={config} message={message} progress={progress} />
      <PipelineItemsPanel progress={progress} />
      <PipelineLogDialog
        logs={progress?.logs ?? []}
        onOpenChange={onLogOpenChange}
        open={isLogOpen}
      />
    </div>
  )
}
