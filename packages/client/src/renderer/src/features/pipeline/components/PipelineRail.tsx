import { Badge } from '@/components/ui/badge'
import { Switch } from '@/components/ui/switch'
import { cn } from '@/lib/utils'
import { t } from '@/locale/t'
import { Check, LoaderCircle, LockKeyhole, Minus, X } from 'lucide-react'
import type { PipelineRailViewModel } from '../pipeline-progress-view-model'
import type { PipelineConfigStage } from '../types'

function railModeLabel(mode: PipelineRailViewModel['mode']) {
  if (mode === 'config') {
    return '配置'
  }
  if (mode === 'running') {
    return '运行中'
  }
  return t('运行摘要')
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

function StageStatusMarker({
  index,
  status,
}: {
  index: number
  status: PipelineRailViewModel['stages'][number]['status']
}) {
  const iconClassName = 'size-3.5'

  if (status === 'active') {
    return <LoaderCircle className={cn(iconClassName, 'animate-spin motion-reduce:animate-none')} />
  }
  if (status === 'completed') {
    return <Check className={iconClassName} />
  }
  if (status === 'failed' || status === 'interrupted' || status === 'cancelled') {
    return <X className={iconClassName} />
  }
  if (status === 'locked') {
    return <LockKeyhole className={iconClassName} />
  }
  if (status === 'skipped') {
    return <Minus className={iconClassName} />
  }
  return <span className="text-[11px] font-semibold tabular-nums">{index + 1}</span>
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
      <div className="overflow-x-auto pb-1">
        <ol aria-label={t('完整任务阶段')} className="grid min-w-[780px] grid-cols-5">
          {view.stages.map((stage, index) => (
            <li className="relative min-w-0 px-1" key={stage.key}>
              {index < view.stages.length - 1 ? (
                <span
                  aria-hidden="true"
                  className={cn(
                    'absolute left-1/2 top-[18px] h-px w-full bg-border',
                    stage.status === 'completed' ? 'bg-primary/50' : null,
                    stage.status === 'failed' ? 'bg-destructive/60' : null,
                  )}
                />
              ) : null}
              <button
                aria-label={stage.key === 'photoshop' ? '编辑 PS 套版' : `编辑${stage.label}`}
                aria-pressed={selectedStage === stage.key}
                className={cn(
                  'relative min-h-[128px] w-full rounded-md px-2 pb-3 pt-1 text-center transition-colors',
                  'hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40',
                  stage.enabled ? null : 'opacity-60',
                  stage.active ? 'bg-primary/5' : null,
                  stage.status === 'failed' ? 'bg-destructive/5' : null,
                  selectedStage === stage.key ? 'bg-muted ring-1 ring-border' : null,
                )}
                onClick={() => onSelectStage(stage.key)}
                type="button"
              >
                <span
                  className={cn(
                    'relative z-10 mx-auto flex size-7 items-center justify-center rounded-full border bg-card text-muted-foreground',
                    stage.active ? 'border-primary bg-primary text-primary-foreground' : null,
                    stage.status === 'completed'
                      ? 'border-primary/40 bg-primary/10 text-primary'
                      : null,
                    stage.status === 'failed'
                      ? 'border-destructive/40 bg-destructive/10 text-destructive'
                      : null,
                    stage.issues > 0
                      ? 'border-destructive/40 bg-destructive/10 text-destructive'
                      : null,
                  )}
                >
                  <StageStatusMarker index={index} status={stage.status} />
                </span>
                <span className="mt-2 block truncate text-sm font-medium">{stage.label}</span>
                <Badge
                  className={cn(
                    'mt-1 max-w-full whitespace-nowrap',
                    stage.issues > 0
                      ? 'border-destructive/30 bg-destructive/10 text-destructive'
                      : null,
                  )}
                  variant={stage.active && stage.issues === 0 ? 'default' : 'outline'}
                >
                  {stage.issues > 0 ? `待配置 ${stage.issues}` : stageStatusLabel(stage.status)}
                </Badge>
                {stage.locked ? (
                  <span className="mt-2 line-clamp-2 block text-xs text-muted-foreground">
                    {stage.locked.reason}
                  </span>
                ) : null}
                {view.mode !== 'config' ? (
                  <span className="mt-2 flex flex-wrap justify-center gap-1 text-xs">
                    <span className="rounded-sm bg-muted px-1.5 py-0.5 text-muted-foreground">
                      完成 {stage.counts.done}/{stage.counts.total}
                    </span>
                    {stage.counts.failed ? (
                      <span className="rounded-sm bg-destructive/10 px-1.5 py-0.5 text-destructive">
                        失败 {stage.counts.failed}
                      </span>
                    ) : null}
                    {stage.counts.blocked ? (
                      <span className="rounded-sm bg-amber-100 px-1.5 py-0.5 text-amber-800">
                        拦截 {stage.counts.blocked}
                      </span>
                    ) : null}
                    {stage.durationMs !== null ? (
                      <span className="rounded-sm bg-muted px-1.5 py-0.5 text-muted-foreground">
                        耗时 {formatDuration(stage.durationMs)}
                      </span>
                    ) : null}
                  </span>
                ) : (
                  <span className="mt-2 block text-xs text-muted-foreground">
                    {stage.enabled ? '本次执行' : '本次跳过'}
                  </span>
                )}
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
            </li>
          ))}
        </ol>
      </div>
    </div>
  )
}
