import { Button } from '@/components/ui/button'
import { Loader2, RefreshCw } from 'lucide-react'
import {
  type ComfyuiInstanceStatus,
  instanceComfyuiUrl,
  type useComfyuiInstanceSelection,
} from '../hooks/use-comfyui-instance-selection'

const comfyuiInstanceStatusText: Record<ComfyuiInstanceStatus, string> = {
  none: '未设置',
  starting: '开机中',
  running: '运行中',
  shutting_down: '关机中',
  stopped: '已关机',
}

const comfyuiInstanceStatusClassName: Record<ComfyuiInstanceStatus, string> = {
  none: 'border-slate-200 bg-slate-50 text-slate-700',
  starting: 'border-blue-200 bg-blue-50 text-blue-700',
  running: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  shutting_down: 'border-amber-200 bg-amber-50 text-amber-800',
  stopped: 'border-slate-200 bg-slate-50 text-slate-700',
}

function isBusyComfyuiStatus(status: ComfyuiInstanceStatus) {
  return status === 'starting' || status === 'shutting_down'
}

function ComfyuiInstanceStatusBadge({ status }: { status: ComfyuiInstanceStatus }) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-sm border px-2 py-1 text-xs font-medium ${comfyuiInstanceStatusClassName[status]}`}
    >
      {isBusyComfyuiStatus(status) ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
      {comfyuiInstanceStatusText[status]}
    </span>
  )
}

export function ComfyuiInstanceSelectorCard({
  selection,
}: {
  selection: ReturnType<typeof useComfyuiInstanceSelection>
}) {
  const status = selection.selectedInstance ? 'running' : 'none'
  return (
    <section aria-label="运行云机" className="rounded-md border bg-background p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h4 className="font-semibold">运行云机</h4>
          <p className="mt-1 text-sm text-muted-foreground">选择本次任务使用的 ComfyUI 实例</p>
        </div>
        <Button
          className="h-9 px-3"
          disabled={selection.loading}
          onClick={() => void selection.refreshInstances()}
          type="button"
          variant="secondary"
        >
          {selection.loading ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <RefreshCw className="mr-2 h-4 w-4" />
          )}
          刷新
        </Button>
      </div>
      <div className="mt-4">
        <ComfyuiInstanceStatusBadge status={status} />
      </div>
      <label className="mt-4 block space-y-2 text-sm font-medium">
        <span>云机</span>
        <select
          className="h-10 w-full rounded-md border bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-primary"
          disabled={selection.runningInstances.length === 0}
          onChange={(event) => selection.selectInstance(event.target.value)}
          value={selection.selectedInstanceUuid}
        >
          {selection.runningInstances.length === 0 ? (
            <option value="">暂无运行中云机</option>
          ) : null}
          {selection.runningInstances.map((instance) => (
            <option key={instance.instanceUuid} value={instance.instanceUuid}>
              {instance.title || instance.instanceUuid} {instance.isCurrent ? '· 默认' : ''}
            </option>
          ))}
        </select>
      </label>
      <dl className="mt-4 grid gap-3 text-sm">
        <div>
          <dt className="text-muted-foreground">实例 UUID</dt>
          <dd className="mt-1 break-all font-mono text-xs font-medium">
            {selection.selectedInstance?.instanceUuid ?? '未选择运行中云机'}
          </dd>
        </div>
        <div>
          <dt className="text-muted-foreground">ComfyUI 地址</dt>
          <dd className="mt-1 break-all font-mono text-xs font-medium">
            {selection.selectedInstance ? instanceComfyuiUrl(selection.selectedInstance) : '未配置'}
          </dd>
        </div>
      </dl>
      {selection.runningInstances.length === 0 ? (
        <div className="mt-3 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800">
          无运行中云机，请到设置页开机。
        </div>
      ) : null}
      {selection.error ? (
        <div className="mt-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
          {selection.error}
        </div>
      ) : null}
    </section>
  )
}
