import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { CheckCircle2, Loader2 } from 'lucide-react'

export function BitBrowserSettingsCard({
  baseUrl,
  saving,
  onBaseUrlChange,
  onSave,
}: {
  baseUrl: string
  saving: boolean
  onBaseUrlChange: (value: string) => void
  onSave: () => void
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>比特浏览器</CardTitle>
        <CardDescription>采集和上架模块连接的本地比特浏览器服务地址。</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <label className="block space-y-2 text-sm font-medium" htmlFor="bit-browser-base-url">
          <span>服务地址</span>
          <Input
            className="font-mono text-xs"
            id="bit-browser-base-url"
            onChange={(event) => onBaseUrlChange(event.target.value)}
            placeholder="127.0.0.1:54345"
            value={baseUrl}
          />
        </label>
        <Button disabled={saving} onClick={onSave} type="button">
          {saving ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <CheckCircle2 className="mr-2 h-4 w-4" />
          )}
          保存地址
        </Button>
      </CardContent>
    </Card>
  )
}
