import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Loader2, PlugZap, RotateCcw, Settings2, Trash2 } from 'lucide-react'
import { type ChenyuConfig, type ChenyuInstance, type InstanceAction, fieldIds } from '../types'

export function AdvancedSettings({
  busyInstance,
  config,
  destroyingInstanceUuid,
  discovering,
  instances,
  onDestroy,
  onDiscoverPod,
  onRestart,
  onTagsTextChange,
  onUpdateConfig,
  tagsText,
}: {
  busyInstance: { uuid: string; action: InstanceAction } | null
  config: ChenyuConfig
  destroyingInstanceUuid: string | null
  discovering: boolean
  instances: ChenyuInstance[]
  onDestroy: (instance: ChenyuInstance) => void
  onDiscoverPod: () => void
  onRestart: (instance: ChenyuInstance) => void
  onTagsTextChange: (value: string) => void
  onUpdateConfig: (patch: Partial<ChenyuConfig>) => void
  tagsText: string
}) {
  return (
    <Card>
      <CardContent className="pt-2">
        <Accordion collapsible type="single">
          <AccordionItem className="border-0" value="advanced">
            <AccordionTrigger>
              <div className="flex items-center gap-2">
                <Settings2 className="h-4 w-4 text-muted-foreground" />
                高级设置
              </div>
            </AccordionTrigger>
            <AccordionContent className="space-y-5">
              <div className="space-y-4 rounded-md border bg-muted/20 p-4">
                <label
                  className="block space-y-2 text-sm font-medium"
                  htmlFor={fieldIds.podKeyword}
                >
                  <span>POD 名称关键词</span>
                  <div className="flex gap-2">
                    <Input
                      id={fieldIds.podKeyword}
                      onChange={(event) =>
                        onUpdateConfig({ pod_search_keyword: event.target.value })
                      }
                      value={config.pod_search_keyword ?? ''}
                    />
                    <Button
                      aria-label="自动发现 POD"
                      disabled={discovering}
                      onClick={onDiscoverPod}
                      title="自动发现 POD"
                      type="button"
                      variant="secondary"
                    >
                      {discovering ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <PlugZap className="h-4 w-4" />
                      )}
                    </Button>
                  </div>
                </label>
                <label className="block space-y-2 text-sm font-medium" htmlFor={fieldIds.podUuid}>
                  <span>手动 POD UUID</span>
                  <Input
                    id={fieldIds.podUuid}
                    onChange={(event) => onUpdateConfig({ pod_uuid: event.target.value })}
                    placeholder="自动获取失败时手动填写"
                    value={config.pod_uuid ?? ''}
                  />
                </label>
                <label className="block space-y-2 text-sm font-medium" htmlFor={fieldIds.podTags}>
                  <span>手动版本列表</span>
                  <textarea
                    className="min-h-20 w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-primary"
                    id={fieldIds.podTags}
                    onChange={(event) => onTagsTextChange(event.target.value)}
                    placeholder={'4.64\n4.633'}
                    value={tagsText}
                  />
                </label>
                <label className="block space-y-2 text-sm font-medium" htmlFor={fieldIds.shutdown}>
                  <span>定时关机分钟</span>
                  <Input
                    id={fieldIds.shutdown}
                    min={0}
                    onChange={(event) => {
                      const value = Number(event.target.value)
                      onUpdateConfig({
                        auto_shutdown_minutes:
                          Number.isFinite(value) && value > 0 ? Math.floor(value) : null,
                      })
                    }}
                    placeholder="留空表示关闭"
                    type="number"
                    value={config.auto_shutdown_minutes ?? ''}
                  />
                </label>
              </div>

              {instances.length ? (
                <div className="space-y-2 rounded-md border bg-muted/20 p-4">
                  <p className="text-sm font-medium">高级实例操作</p>
                  <div className="space-y-2">
                    {instances.map((instance) => {
                      const busy = busyInstance?.uuid === instance.instanceUuid
                      return (
                        <div
                          className="flex items-center justify-between gap-3 rounded-md border bg-background px-3 py-2"
                          key={instance.instanceUuid}
                        >
                          <p className="min-w-0 truncate font-mono text-xs">
                            {instance.instanceUuid}
                          </p>
                          <div className="flex shrink-0 gap-2">
                            <Button
                              className="h-8 px-2"
                              disabled={busy}
                              onClick={() => onRestart(instance)}
                              type="button"
                              variant="outline"
                            >
                              {busy && busyInstance?.action === 'restart' ? (
                                <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
                              ) : (
                                <RotateCcw className="mr-1 h-3.5 w-3.5" />
                              )}
                              重启
                            </Button>
                            <Button
                              className="h-8 px-2"
                              disabled={busy || destroyingInstanceUuid === instance.instanceUuid}
                              onClick={() => onDestroy(instance)}
                              type="button"
                              variant="outline"
                            >
                              <Trash2 className="mr-1 h-3.5 w-3.5" />
                              销毁
                            </Button>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>
              ) : null}
            </AccordionContent>
          </AccordionItem>
        </Accordion>
      </CardContent>
    </Card>
  )
}
