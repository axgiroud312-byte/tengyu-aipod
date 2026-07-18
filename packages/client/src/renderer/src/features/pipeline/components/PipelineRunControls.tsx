import { Button } from '@/components/ui/button'
import { t } from '@/locale/t'
import { AlertCircle, ArrowRight, Play, RefreshCw, Settings2, Square } from 'lucide-react'

export function PipelineRunControls({
  canStart,
  cancelLoading,
  currentRunId,
  launchDisabledReason,
  launchDisabledStageLabel,
  logCount,
  message,
  onCancel,
  onOpenLog,
  onRefresh,
  onResolveLaunchBlock,
  onStart,
  running,
}: {
  canStart: boolean
  cancelLoading: boolean
  currentRunId: string | null
  launchDisabledReason?: string
  launchDisabledStageLabel?: string
  logCount: number
  message: string
  onCancel: () => void
  onOpenLog: () => void
  onRefresh: () => void
  onResolveLaunchBlock?: () => void
  onStart: () => void
  running: boolean
}) {
  return (
    <section
      aria-label={t('完整任务操作')}
      className="sticky bottom-0 z-20 -mx-6 -mb-6 flex flex-wrap items-center justify-between gap-3 border-t bg-card/95 px-6 py-4 shadow-[0_-12px_24px_-22px_rgb(15_23_42_/_0.35)] backdrop-blur supports-[backdrop-filter]:bg-card/90"
    >
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <Button
          aria-label={t('取消当前完整任务')}
          disabled={!running || !currentRunId || cancelLoading}
          onClick={onCancel}
          variant={running ? 'destructive' : 'outline'}
        >
          <Square className="mr-2 h-4 w-4" />
          取消
        </Button>
        <Button onClick={onRefresh} variant="ghost">
          <RefreshCw className="mr-2 h-4 w-4" />
          刷新选项
        </Button>
        <Button onClick={onOpenLog} variant="secondary">
          <Settings2 className="mr-2 h-4 w-4" />
          日志 {logCount}
        </Button>
        <span className="text-sm text-muted-foreground">{message}</span>
      </div>
      <div className="flex min-w-0 flex-wrap items-center justify-end gap-3">
        {launchDisabledReason ? (
          <div className="flex min-w-0 items-center gap-2 text-sm text-amber-700">
            <AlertCircle className="h-4 w-4 shrink-0" />
            <span className="min-w-0">{launchDisabledReason}</span>
            {onResolveLaunchBlock && launchDisabledStageLabel ? (
              <Button
                aria-label={`前往 ${launchDisabledStageLabel}配置`}
                className="h-8 shrink-0 px-2"
                onClick={onResolveLaunchBlock}
                type="button"
                variant="ghost"
              >
                前往配置
                <ArrowRight className="ml-1 h-4 w-4" />
              </Button>
            ) : null}
          </div>
        ) : null}
        <Button disabled={!canStart} onClick={onStart} title={launchDisabledReason}>
          <Play className="mr-2 h-4 w-4" />
          启动完整任务
        </Button>
      </div>
    </section>
  )
}
