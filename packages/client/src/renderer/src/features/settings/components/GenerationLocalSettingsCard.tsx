import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { CheckCircle2, Loader2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { GenerationConfig, GenerationSettingsSnapshot } from '../types'

export function GenerationLocalSettingsCard({
  bailianApiKey,
  config,
  grsaiApiKey,
  saving,
  settings,
  onBailianApiKeyChange,
  onConfigChange,
  onGrsaiApiKeyChange,
  onSave,
}: {
  bailianApiKey: string
  config: GenerationConfig
  grsaiApiKey: string
  saving: boolean
  settings: GenerationSettingsSnapshot | null
  onBailianApiKeyChange: (value: string) => void
  onConfigChange: (patch: Partial<GenerationConfig>) => void
  onGrsaiApiKeyChange: (value: string) => void
  onSave: () => void
}) {
  const [concurrencyDraft, setConcurrencyDraft] = useState(String(config.default_concurrency))
  const [retriesDraft, setRetriesDraft] = useState(String(config.grsai_retries))

  useEffect(() => {
    setConcurrencyDraft(String(config.default_concurrency))
  }, [config.default_concurrency])

  useEffect(() => {
    setRetriesDraft(String(config.grsai_retries))
  }, [config.grsai_retries])

  function updateNumberDraft(
    value: string,
    min: number,
    max: number,
    onValue: (value: number) => void,
  ) {
    if (!value.trim()) {
      return
    }
    const parsed = Number(value)
    if (!Number.isFinite(parsed)) {
      return
    }
    onValue(Math.max(min, Math.min(max, Math.floor(parsed))))
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>本地生图设置</CardTitle>
        <CardDescription>Grsai、百炼模型和密钥只保存在本机，不上传服务器。</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <label className="block space-y-2 text-sm font-medium" htmlFor="grsai-api-key">
          <span className="flex items-center justify-between gap-2">
            <span>Grsai API Key</span>
            <Badge variant={settings?.grsaiKeyConfigured ? 'default' : 'secondary'}>
              {settings?.grsaiKeyConfigured ? '已保存' : '未保存'}
            </Badge>
          </span>
          <Input
            id="grsai-api-key"
            onChange={(event) => onGrsaiApiKeyChange(event.target.value)}
            placeholder={
              settings?.grsaiKeyConfigured ? '已保存，留空则不修改' : '粘贴 Grsai API Key'
            }
            type="password"
            value={grsaiApiKey}
          />
        </label>

        <label className="block space-y-2 text-sm font-medium" htmlFor="bailian-api-key">
          <span className="flex items-center justify-between gap-2">
            <span>阿里云百炼 API Key</span>
            <Badge variant={settings?.bailianKeyConfigured ? 'default' : 'secondary'}>
              {settings?.bailianKeyConfigured ? '已保存' : '未保存'}
            </Badge>
          </span>
          <Input
            id="bailian-api-key"
            onChange={(event) => onBailianApiKeyChange(event.target.value)}
            placeholder={
              settings?.bailianKeyConfigured ? '已保存，留空则不修改' : '粘贴百炼 API Key'
            }
            type="password"
            value={bailianApiKey}
          />
        </label>

        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block space-y-2 text-sm font-medium" htmlFor="grsai-node">
            <span>Grsai 节点</span>
            <select
              className="h-10 w-full rounded-md border bg-background px-3 text-sm"
              id="grsai-node"
              onChange={(event) =>
                onConfigChange({ grsai_node: event.target.value === 'global' ? 'global' : 'cn' })
              }
              value={config.grsai_node}
            >
              <option value="cn">国内节点</option>
              <option value="global">全球节点</option>
            </select>
          </label>
          <label className="block space-y-2 text-sm font-medium" htmlFor="default-concurrency">
            <span>全局默认并发</span>
            <Input
              id="default-concurrency"
              max={20}
              min={1}
              onBlur={() => setConcurrencyDraft(String(config.default_concurrency))}
              onChange={(event) => {
                const value = event.target.value
                setConcurrencyDraft(value)
                updateNumberDraft(value, 1, 20, (nextValue) =>
                  onConfigChange({ default_concurrency: nextValue, grsai_concurrency: nextValue }),
                )
              }}
              type="number"
              value={concurrencyDraft}
            />
          </label>
          <label className="block space-y-2 text-sm font-medium" htmlFor="grsai-retries">
            <span>自动重试次数</span>
            <Input
              id="grsai-retries"
              max={10}
              min={0}
              onBlur={() => setRetriesDraft(String(config.grsai_retries))}
              onChange={(event) => {
                const value = event.target.value
                setRetriesDraft(value)
                updateNumberDraft(value, 0, 10, (nextValue) =>
                  onConfigChange({ grsai_retries: nextValue }),
                )
              }}
              type="number"
              value={retriesDraft}
            />
          </label>
          <label className="block space-y-2 text-sm font-medium" htmlFor="bailian-text-model">
            <span>百炼文本模型</span>
            <select
              className="h-10 w-full rounded-md border bg-background px-3 text-sm"
              id="bailian-text-model"
              onChange={(event) => onConfigChange({ bailian_text_model: event.target.value })}
              value={config.bailian_text_model}
            >
              {(settings?.bailianTextModels ?? []).map((model) => (
                <option key={model.id} value={model.id}>
                  {model.label}
                </option>
              ))}
            </select>
          </label>
          <label
            className="block space-y-2 text-sm font-medium sm:col-span-2"
            htmlFor="bailian-vision-model"
          >
            <span>百炼视觉模型</span>
            <select
              className="h-10 w-full rounded-md border bg-background px-3 text-sm"
              id="bailian-vision-model"
              onChange={(event) => onConfigChange({ bailian_vision_model: event.target.value })}
              value={config.bailian_vision_model}
            >
              {(settings?.bailianVisionModels ?? []).map((model) => (
                <option key={model.id} value={model.id}>
                  {model.label}
                </option>
              ))}
            </select>
          </label>
        </div>

        <Button className="w-full" disabled={saving} onClick={onSave} type="button">
          {saving ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <CheckCircle2 className="mr-2 h-4 w-4" />
          )}
          保存本地设置
        </Button>
      </CardContent>
    </Card>
  )
}
