import { Badge } from '@/components/ui/badge'
import type { PipelineRailViewModel } from '../pipeline-progress-view-model'
import type { PipelineConfigStage } from '../types'

export function PipelineRail({
  view,
  selectedStage,
  onSelectStage,
}: {
  view: PipelineRailViewModel
  selectedStage: PipelineConfigStage | null
  onSelectStage: (stage: PipelineConfigStage) => void
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
        <Badge variant="outline">{view.mode === 'running' ? '运行中' : '进度'}</Badge>
      </div>
      <div className="grid gap-3 md:grid-cols-5">
        {view.stages.map((stage) => (
          <button
            className={`rounded-md border bg-background px-3 py-3 text-left transition ${
              stage.enabled ? 'hover:border-primary/50' : 'opacity-60'
            } ${stage.active ? 'border-primary shadow-sm' : ''}`}
            key={stage.key}
            onClick={() => onSelectStage(stage.key)}
            type="button"
          >
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm font-medium">{stage.label}</span>
              {stage.issues > 0 ? <Badge variant="destructive">{stage.issues}</Badge> : null}
            </div>
            <p className="mt-2 text-xs text-muted-foreground">
              {stage.counts.done}/{stage.counts.total}
              {stage.counts.failed ? ` · 失败 ${stage.counts.failed}` : ''}
              {stage.counts.blocked ? ` · 拦截 ${stage.counts.blocked}` : ''}
            </p>
            {selectedStage === stage.key ? (
              <div className="mt-2 h-1 rounded-full bg-primary" />
            ) : null}
          </button>
        ))}
      </div>
    </div>
  )
}
