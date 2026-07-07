import { Button } from '@/components/ui/button'
import { Play, RefreshCw, Settings2, Square } from 'lucide-react'

export function PipelineRunControls({
  canStart,
  cancelLoading,
  currentRunId,
  launchDisabledReason,
  logCount,
  message,
  onCancel,
  onOpenLog,
  onRefresh,
  onStart,
  running,
}: {
  canStart: boolean
  cancelLoading: boolean
  currentRunId: string | null
  launchDisabledReason?: string
  logCount: number
  message: string
  onCancel: () => void
  onOpenLog: () => void
  onRefresh: () => void
  onStart: () => void
  running: boolean
}) {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <Button disabled={!canStart} onClick={onStart} title={launchDisabledReason}>
        <Play className="mr-2 h-4 w-4" />
        启动完整任务
      </Button>
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
  )
}
