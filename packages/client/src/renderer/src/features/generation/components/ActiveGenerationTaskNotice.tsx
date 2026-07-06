import { Button } from '@/components/ui/button'
import { Square } from 'lucide-react'
import type { ActiveGenerationTask } from '../lib/format'
import { taskProgressLabel } from '../lib/format'

export function ActiveGenerationTaskNotice({
  tasks,
  onCancelAll,
}: {
  tasks: ActiveGenerationTask[]
  onCancelAll: () => void
}) {
  if (tasks.length === 0) {
    return null
  }
  return (
    <div className="rounded-md border border-amber-200 bg-amber-50 p-4 text-amber-900">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold">后台仍有生图任务运行</h3>
          <p className="mt-1 text-sm leading-6">
            切换入口或实现方式不会自动停止旧任务；需要停止时请在这里统一取消。
          </p>
        </div>
        <Button onClick={onCancelAll} type="button" variant="secondary">
          <Square className="mr-2 h-4 w-4" />
          取消全部后台任务
        </Button>
      </div>
      <div className="mt-3 space-y-2">
        {tasks.map((task) => (
          <div className="rounded-md bg-white/70 px-3 py-2 text-sm" key={task.taskId}>
            <div className="font-medium">{task.taskId}</div>
            <div className="mt-1 text-xs text-amber-800">
              {taskProgressLabel(task)}
              {task.cancelRequested ? ' · 已请求取消，等待当前项结束' : ''}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
