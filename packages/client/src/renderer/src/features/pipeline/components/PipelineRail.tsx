import { Badge } from '@/components/ui/badge'
import { Switch } from '@/components/ui/switch'
import { cn } from '@/lib/utils'
import type { PipelineRailViewModel } from '../pipeline-progress-view-model'
import type { PipelineConfigStage } from '../types'

function railModeLabel(mode: PipelineRailViewModel['mode']) {
  if (mode === 'config') {
    return '配置'
  }
  if (mode === 'running') {
    return '运行中'
  }
  return '战报'
}

function stageStatusLabel(status: PipelineRailViewModel['stages'][number]['status']) {
  const labels: Record<PipelineRailViewModel['stages'][number]['status'], string> = {
    active: '运行',
    cancelled: '已取消',
    completed: '完成',
    config: '待配置',
    failed: '失败',
    interrupted: '已中断',
    locked: '锁定',
    pending: '待运行',
    skipped: '跳过',
  }
  return labels[status]
}

function formatDuration(durationMs: number) {
  const totalSeconds = Math.max(0, Math.round(durationMs / 1000))
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  if (minutes === 0) {
    return `${seconds}秒`
  }
  return `${minutes}分${String(seconds).padStart(2, '0')}秒`
}

function isOptionalStage(
  stage: PipelineConfigStage,
): stage is Exclude<PipelineConfigStage, 'source'> {
  return stage !== 'source'
}

function PipelineStageSwitch({
  stage,
  label,
  enabled,
  locked,
  onToggle,
}: {
  stage: Exclude<PipelineConfigStage, 'source'>
  label: string
  enabled: boolean
  locked: boolean
  onToggle: (stage: Exclude<PipelineConfigStage, 'source'>, enabled: boolean) => void
}) {
  return (
    <Switch
      aria-label={stage === 'photoshop' ? '启用 PS 套版' : `启用${label}`}
      checked={enabled}
      className="absolute right-3 top-3"
      disabled={locked}
      onCheckedChange={(checked) => onToggle(stage, checked)}
    />
  )
}

export function PipelineRail({
  view,
  selectedStage,
  onSelectStage,
  onToggleStage,
}: {
  view: PipelineRailViewModel
  selectedStage: PipelineConfigStage | null
  onSelectStage: (stage: PipelineConfigStage) => void
  onToggleStage?: (stage: Exclude<PipelineConfigStage, 'source'>, enabled: boolean) => void
}) {
  return (
    <div className="rounded-md border bg-card p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">{view.summary.status}</p>
          {view.summary.warning ? (
            <p className="mt-1 text-xs text-amber-700">{view.summary.warning}</p>
          ) : null}
        </div>
        <Badge variant="outline">{railModeLabel(view.mode)}</Badge>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-5">
        {view.stages.map((stage) => (
          <fieldset
            aria-label={`${stage.label}阶段`}
            className={cn(
              'relative min-h-[116px] min-w-0 rounded-md border bg-background transition',
              stage.enabled ? 'hover:border-primary/50' : 'opacity-60',
              stage.active ? 'border-primary bg-primary/5 shadow-sm' : null,
              stage.status === 'failed' ? 'border-destructive/60 bg-destructive/5' : null,
              selectedStage === stage.key ? 'ring-2 ring-ring/30' : null,
            )}
            key={stage.key}
          >
            <button
              aria-label={stage.key === 'photoshop' ? '编辑 PS 套版' : `编辑${stage.label}`}
              aria-pressed={selectedStage === stage.key}
              className="h-full min-h-[114px] w-full overflow-hidden px-3 py-3 text-left"
              onClick={() => onSelectStage(stage.key)}
              type="button"
            >
              <div className="flex items-center justify-between gap-2 pr-10">
                <span className="whitespace-nowrap text-sm font-medium">{stage.label}</span>
                <Badge
                  className="shrink-0 whitespace-nowrap"
                  variant={stage.active ? 'default' : 'outline'}
                >
                  {stage.issues > 0 ? `待配置 ${stage.issues}` : stageStatusLabel(stage.status)}
                </Badge>
              </div>
              {stage.locked ? (
                <p className="mt-2 line-clamp-2 text-xs text-muted-foreground">
                  {stage.locked.reason}
                </p>
              ) : null}
              {view.mode !== 'config' ? (
                <div className="mt-3 flex flex-wrap gap-1.5 text-xs">
                  <span className="rounded-sm bg-muted px-2 py-0.5 text-muted-foreground">
                    完成 {stage.counts.done}/{stage.counts.total}
                  </span>
                  {stage.counts.failed ? (
                    <span className="rounded-sm bg-destructive/10 px-2 py-0.5 text-destructive">
                      失败 {stage.counts.failed}
                    </span>
                  ) : null}
                  {stage.counts.blocked ? (
                    <span className="rounded-sm bg-amber-100 px-2 py-0.5 text-amber-800">
                      拦截 {stage.counts.blocked}
                    </span>
                  ) : null}
                  {stage.durationMs !== null ? (
                    <span className="rounded-sm bg-muted px-2 py-0.5 text-muted-foreground">
                      耗时 {formatDuration(stage.durationMs)}
                    </span>
                  ) : null}
                </div>
              ) : (
                <p className="mt-3 text-xs text-muted-foreground">
                  {stage.enabled ? '本次执行' : '本次跳过'}
                </p>
              )}
              {selectedStage === stage.key ? (
                <div className="mt-2 h-1 rounded-full bg-primary" />
              ) : null}
            </button>
            {view.mode === 'config' && isOptionalStage(stage.key) && onToggleStage ? (
              <PipelineStageSwitch
                enabled={stage.enabled}
                label={stage.label}
                locked={Boolean(stage.locked)}
                onToggle={onToggleStage}
                stage={stage.key}
              />
            ) : null}
          </fieldset>
        ))}
      </div>
    </div>
  )
}
