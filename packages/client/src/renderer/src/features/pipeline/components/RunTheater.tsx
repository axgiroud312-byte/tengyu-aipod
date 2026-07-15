import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import type { PipelineProgress, PipelineRunConfig } from '@tengyu-aipod/shared'
import { CopyPlus, ScrollText, Square } from 'lucide-react'
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
  cancelLoading,
  config,
  isLogOpen,
  message,
  onLogOpenChange,
  onCancel,
  onCreateAnother,
  onSelectStage,
  progress,
  railView,
  selectedStage,
  showRail = true,
  validationIssues,
}: {
  cancelLoading: boolean
  config: PipelineRunConfig
  isLogOpen: boolean
  message: string
  onLogOpenChange: (open: boolean) => void
  onCancel: () => void
  onCreateAnother: () => void
  onSelectStage: (stage: PipelineConfigStage) => void
  progress: PipelineProgress | null
  railView: PipelineRailViewModel
  selectedStage: PipelineConfigStage | null
  showRail?: boolean
  validationIssues: PipelineValidationIssue[]
}) {
  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b pb-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-xl font-semibold">成果剧场</h1>
            <Badge variant={railView.mode === 'running' ? 'default' : 'secondary'}>
              {railView.mode === 'running' ? '运行中' : '完成战报'}
            </Badge>
          </div>
          <p className="mt-1 flex min-w-0 items-center gap-1 text-sm text-muted-foreground">
            <span className="truncate text-foreground">{config.name?.trim() || '未命名任务'}</span>
            <span aria-hidden="true">·</span>
            <span className="truncate">{railView.summary.status}</span>
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button onClick={() => onLogOpenChange(true)} type="button" variant="outline">
            <ScrollText className="mr-2 h-4 w-4" />
            全部日志
          </Button>
          {railView.mode === 'running' ? (
            <Button disabled={cancelLoading} onClick={onCancel} type="button" variant="outline">
              <Square className="mr-2 h-4 w-4" />
              停止任务
            </Button>
          ) : (
            <Button onClick={onCreateAnother} type="button">
              <CopyPlus className="mr-2 h-4 w-4" />
              按此方案再建任务
            </Button>
          )}
        </div>
      </header>
      {showRail ? (
        <>
          <PipelineRail
            onSelectStage={onSelectStage}
            selectedStage={selectedStage}
            view={railView}
          />
          <PipelineSelectedStageIssues issues={validationIssues} selectedStage={selectedStage} />
        </>
      ) : null}
      <PipelineResultsPanel config={config} message={message} progress={progress} />
      <PipelineRunLogTail logs={railView.logTail} />
      <PipelineItemsPanel progress={progress} />
      <PipelineLogDialog
        logs={progress?.logs ?? []}
        onOpenChange={onLogOpenChange}
        open={isLogOpen}
      />
    </div>
  )
}
