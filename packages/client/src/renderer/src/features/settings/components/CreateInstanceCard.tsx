import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Cloud, Loader2, Server } from 'lucide-react'
import { type ChenyuConfig, type ChenyuGpu, type ChenyuPod, fieldIds } from '../types'

export function CreateInstanceCard({
  apiKeyConfigured,
  config,
  createOpen,
  creating,
  currentVersion,
  effectiveGpuName,
  effectiveGpuUuid,
  gpus,
  instanceTitle,
  pods,
  onCreate,
  onCreateOpenChange,
  onInstanceTitleChange,
  onSelectPod,
  onUpdateConfig,
}: {
  apiKeyConfigured: boolean
  config: ChenyuConfig
  createOpen: boolean
  creating: boolean
  currentVersion: string
  effectiveGpuName: string
  effectiveGpuUuid: string
  gpus: ChenyuGpu[]
  instanceTitle: string
  pods: ChenyuPod[]
  onCreate: () => void
  onCreateOpenChange: (open: boolean) => void
  onInstanceTitleChange: (title: string) => void
  onSelectPod: (podUuid: string) => void
  onUpdateConfig: (patch: Partial<ChenyuConfig>) => void
}) {
  const selectedPod = pods.find((pod) => pod.uuid === config.pod_uuid)

  return (
    <Card>
      <CardHeader>
        <CardTitle>创建云机</CardTitle>
        <CardDescription>使用杭州慎思 ComfyUI POD 创建并命名新的云机。</CardDescription>
      </CardHeader>
      <CardContent>
        <Accordion
          collapsible
          onValueChange={(value) => onCreateOpenChange(value === 'create')}
          type="single"
          value={createOpen ? 'create' : ''}
        >
          <AccordionItem className="rounded-md border px-4" value="create">
            <AccordionTrigger className="py-3">
              <div className="flex min-w-0 items-center gap-3">
                <Server className="h-4 w-4 shrink-0 text-primary" />
                <div className="min-w-0 text-left">
                  <p className="font-medium">创建晨羽云机</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {currentVersion || '未选版本'} · {effectiveGpuName || '未选 GPU'}
                  </p>
                </div>
              </div>
            </AccordionTrigger>
            <AccordionContent className="space-y-4">
              <label className="block space-y-2 text-sm font-medium" htmlFor={fieldIds.podUuid}>
                <span>POD</span>
                <select
                  className="h-10 w-full rounded-md border bg-background px-3 text-sm"
                  disabled={!pods.length}
                  id={fieldIds.podUuid}
                  onChange={(event) => onSelectPod(event.target.value)}
                  value={selectedPod?.uuid ?? ''}
                >
                  <option value="">
                    {pods.length ? '请选择 POD' : '未找到杭州慎思comfyui镜像'}
                  </option>
                  {pods.map((pod) => (
                    <option key={pod.uuid} value={pod.uuid}>
                      {pod.title}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block space-y-2 text-sm font-medium" htmlFor={fieldIds.podVersion}>
                <span>版本</span>
                {config.pod_tags?.length ? (
                  <select
                    className="h-10 w-full rounded-md border bg-background px-3 text-sm"
                    id={fieldIds.podVersion}
                    onChange={(event) => onUpdateConfig({ default_pod_tag: event.target.value })}
                    value={currentVersion}
                  >
                    {config.pod_tags.map((tag) => (
                      <option key={tag} value={tag}>
                        {tag}
                      </option>
                    ))}
                  </select>
                ) : (
                  <Input
                    id={fieldIds.podVersion}
                    onChange={(event) => onUpdateConfig({ default_pod_tag: event.target.value })}
                    placeholder="例如 4.64"
                    value={currentVersion}
                  />
                )}
              </label>
              <label
                className="block space-y-2 text-sm font-medium"
                htmlFor={fieldIds.instanceTitle}
              >
                <span>云机名称</span>
                <Input
                  id={fieldIds.instanceTitle}
                  maxLength={64}
                  onChange={(event) => onInstanceTitleChange(event.target.value)}
                  placeholder="例如：主力生图 4090"
                  value={instanceTitle}
                />
              </label>
              <label className="block space-y-2 text-sm font-medium" htmlFor={fieldIds.gpu}>
                <span>显卡</span>
                {gpus.length ? (
                  <select
                    className="h-10 w-full rounded-md border bg-background px-3 text-sm"
                    id={fieldIds.gpu}
                    onChange={(event) => {
                      const gpu = gpus.find((item) => item.gpu_uuid === event.target.value)
                      onUpdateConfig({
                        default_gpu_uuid: event.target.value,
                        default_gpu_name: gpu?.gpu_name,
                      })
                    }}
                    value={effectiveGpuUuid}
                  >
                    {gpus.map((gpu) => (
                      <option key={gpu.gpu_uuid} value={gpu.gpu_uuid}>
                        {gpu.gpu_name}
                      </option>
                    ))}
                  </select>
                ) : (
                  <Input
                    id={fieldIds.gpu}
                    onChange={(event) => onUpdateConfig({ default_gpu_uuid: event.target.value })}
                    placeholder="GPU UUID"
                    value={effectiveGpuUuid}
                  />
                )}
              </label>
              <Button
                className="w-full"
                disabled={
                  creating ||
                  !apiKeyConfigured ||
                  !selectedPod ||
                  !currentVersion.trim() ||
                  !effectiveGpuUuid.trim()
                }
                onClick={onCreate}
                type="button"
              >
                {creating ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Cloud className="mr-2 h-4 w-4" />
                )}
                创建实例
              </Button>
            </AccordionContent>
          </AccordionItem>
        </Accordion>
      </CardContent>
    </Card>
  )
}
