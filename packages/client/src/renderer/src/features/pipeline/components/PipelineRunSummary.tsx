import { Badge } from '@/components/ui/badge'
import type {
  PipelineRunSummary as PipelineRunSummaryModel,
  PipelineRunSummaryStageState,
} from '../pipeline-run-summary'

const stageStateLabels: Record<PipelineRunSummaryStageState, string> = {
  enabled: '执行',
  skipped: '跳过',
  'locked-enabled': '锁定执行',
  'locked-skipped': '锁定跳过',
}

function SummaryValues({
  items,
  emptyLabel,
}: {
  items: Array<{ label: string; value: string }>
  emptyLabel: string
}) {
  if (items.length === 0) {
    return <p className="text-sm text-muted-foreground">{emptyLabel}</p>
  }
  return (
    <dl className="space-y-2">
      {items.map((item) => (
        <div className="grid grid-cols-[96px_minmax(0,1fr)] gap-3 text-sm" key={item.label}>
          <dt className="text-muted-foreground">{item.label}</dt>
          <dd className="min-w-0 break-words font-medium">{item.value}</dd>
        </div>
      ))}
    </dl>
  )
}

export function PipelineRunSummary({ summary }: { summary: PipelineRunSummaryModel }) {
  return (
    <section aria-label="本次执行摘要" className="border-t pt-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold">本次执行摘要</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {summary.source.label} · {summary.source.detail}
          </p>
        </div>
        <Badge variant="outline">启动前检查</Badge>
      </div>

      <div className="mt-4 grid gap-px overflow-hidden rounded-md border bg-border sm:grid-cols-5">
        {summary.stages.map((stage) => (
          <div className="min-w-0 bg-background p-3" key={stage.key}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-sm font-medium">{stage.label}</span>
              <Badge variant={stage.state.includes('enabled') ? 'default' : 'secondary'}>
                {stageStateLabels[stage.state]}
              </Badge>
            </div>
            <p className="mt-2 text-xs leading-5 text-muted-foreground">{stage.detail}</p>
          </div>
        ))}
      </div>

      <div className="mt-4 grid gap-5 lg:grid-cols-3">
        <div>
          <h3 className="mb-2 text-sm font-medium">本次变量</h3>
          <SummaryValues emptyLabel="没有额外的本次变量" items={summary.taskVariables} />
        </div>
        <div>
          <h3 className="mb-2 text-sm font-medium">关键资源</h3>
          <SummaryValues emptyLabel="本次不需要额外资源" items={summary.resources} />
        </div>
        <div>
          <h3 className="mb-2 text-sm font-medium">预计产出</h3>
          <p className="text-sm leading-6 text-muted-foreground">{summary.expectedOutput}</p>
        </div>
      </div>
    </section>
  )
}
