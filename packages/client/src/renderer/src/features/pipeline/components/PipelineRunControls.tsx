import { Button } from '@/components/ui/button'
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
    <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-4">
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <Button
          disabled={!running || !currentRunId || cancelLoading}
          onClick={onCancel}
          variant="outline"
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
    </div>
  )
}
