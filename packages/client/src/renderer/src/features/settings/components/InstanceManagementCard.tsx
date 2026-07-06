import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Loader2, Power, PowerOff, RefreshCw } from 'lucide-react'
import { type ChenyuInstance, type InstanceAction, statusClassName, statusText } from '../types'

export function InstanceManagementCard({
  busyInstance,
  instances,
  refreshing,
  statusOverrides,
  urlDrafts,
  onRefresh,
  onSetDefault,
  onShutdown,
  onStartup,
  onUpdateUrl,
}: {
  busyInstance: { uuid: string; action: InstanceAction } | null
  instances: ChenyuInstance[]
  refreshing: boolean
  statusOverrides: Record<string, ChenyuInstance['statusName']>
  urlDrafts: Record<string, string>
  onRefresh: () => void
  onSetDefault: (instance: ChenyuInstance) => void
  onShutdown: (instance: ChenyuInstance) => void
  onStartup: (instance: ChenyuInstance) => void
  onUpdateUrl: (instanceUuid: string, value: string) => void
}) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-4 space-y-0">
        <div>
          <CardTitle>实例管理</CardTitle>
          <CardDescription>管理当前 API Key 下的云机，并选择 ComfyUI 默认云机。</CardDescription>
        </div>
        <Button disabled={refreshing} onClick={onRefresh} type="button" variant="outline">
          {refreshing ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <RefreshCw className="mr-2 h-4 w-4" />
          )}
          刷新
        </Button>
      </CardHeader>
      <CardContent>
        {instances.length === 0 ? (
          <div className="rounded-md border border-dashed bg-muted/30 px-4 py-10 text-center text-sm text-muted-foreground">
            暂无实例，或 API Key 尚未连接成功。
          </div>
        ) : (
          <div className="space-y-3">
            {instances.map((instance) => {
              const busy = busyInstance?.uuid === instance.instanceUuid
              const statusName = statusOverrides[instance.instanceUuid] ?? instance.statusName
              const urlDraft =
                urlDrafts[instance.instanceUuid] ??
                instance.comfyuiUrl ??
                instance.serverUrls[0] ??
                ''
              const canSetDefault = Boolean(instance.comfyuiUrl || urlDraft.trim())
              return (
                <div
                  className="rounded-md border bg-background px-4 py-4"
                  key={instance.instanceUuid}
                >
                  <div className="space-y-4">
                    <div className="min-w-0 flex-1 space-y-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-xs font-medium text-muted-foreground">实例 UUID</span>
                        {instance.isCurrent ? <Badge className="shrink-0">默认云机</Badge> : null}
                      </div>
                      <p className="break-all font-mono text-xs font-medium">
                        {instance.instanceUuid}
                      </p>
                      <div className="grid gap-3 md:grid-cols-[112px_minmax(0,1fr)] md:items-center">
                        <div className="space-y-1">
                          <p className="text-xs font-medium text-muted-foreground">状态</p>
                          <StatusBadge busy={busy} statusName={statusName} />
                        </div>
                        <div className="min-w-0 space-y-1">
                          <p className="text-xs font-medium text-muted-foreground">ComfyUI 地址</p>
                          {instance.comfyuiUrl ? (
                            <p className="break-all font-mono text-xs text-muted-foreground">
                              {instance.comfyuiUrl}
                            </p>
                          ) : (
                            <div className="space-y-1">
                              <Input
                                aria-label="ComfyUI 地址"
                                className="h-9 font-mono text-xs"
                                list={`chenyu-instance-urls-${instance.instanceUuid}`}
                                onChange={(event) =>
                                  onUpdateUrl(instance.instanceUuid, event.target.value)
                                }
                                placeholder="未识别，粘贴 ComfyUI 地址"
                                value={urlDraft}
                              />
                              {instance.serverUrls.length ? (
                                <datalist id={`chenyu-instance-urls-${instance.instanceUuid}`}>
                                  {instance.serverUrls.map((url) => (
                                    <option key={url} value={url} />
                                  ))}
                                </datalist>
                              ) : null}
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-2 border-t pt-3 sm:justify-end">
                      <Button
                        className="h-9 min-w-20 px-3"
                        disabled={busy || statusName === 'running'}
                        onClick={() => onStartup(instance)}
                        type="button"
                        variant="outline"
                      >
                        {busy && busyInstance?.action === 'startup' ? (
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        ) : (
                          <Power className="mr-2 h-4 w-4" />
                        )}
                        开机
                      </Button>
                      <Button
                        className="h-9 min-w-20 px-3"
                        disabled={busy || statusName === 'stopped'}
                        onClick={() => onShutdown(instance)}
                        type="button"
                        variant="outline"
                      >
                        {busy && busyInstance?.action === 'shutdown' ? (
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        ) : (
                          <PowerOff className="mr-2 h-4 w-4" />
                        )}
                        关机
                      </Button>
                      <Button
                        aria-label="设为默认云机"
                        className="h-9 min-w-32 px-3"
                        disabled={busy || instance.isCurrent || !canSetDefault}
                        onClick={() => onSetDefault(instance)}
                        title="设为默认云机"
                        type="button"
                        variant={instance.isCurrent ? 'secondary' : 'default'}
                      >
                        设为默认云机
                      </Button>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

function StatusBadge({
  busy,
  statusName,
}: {
  busy: boolean
  statusName: ChenyuInstance['statusName']
}) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-sm border px-2 py-1 text-xs font-medium ${statusClassName[statusName]}`}
    >
      {busy ||
      statusName === 'starting' ||
      statusName === 'initializing' ||
      statusName === 'shutting_down' ? (
        <Loader2 className="h-3 w-3 animate-spin" />
      ) : null}
      {statusText[statusName]}
    </span>
  )
}
