import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Loader2 } from 'lucide-react'
import { type ConnectionStatus, connectionClassName, connectionText, fieldIds } from '../types'

export function ConnectionCard({
  apiKey,
  apiKeyConfigured,
  connectionError,
  connectionStatus,
  onApiKeyChange,
}: {
  apiKey: string
  apiKeyConfigured: boolean
  connectionError: string | null
  connectionStatus: ConnectionStatus
  onApiKeyChange: (value: string) => void
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>连接信息</CardTitle>
        <CardDescription>只保存晨羽 API Key，并检测当前连接是否可用。</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <label className="block space-y-2 text-sm font-medium" htmlFor={fieldIds.apiKey}>
          <span>晨羽 API Key</span>
          <Input
            id={fieldIds.apiKey}
            onChange={(event) => onApiKeyChange(event.target.value)}
            placeholder={apiKeyConfigured ? '已保存，留空则不修改' : '粘贴晨羽 API Key'}
            type="password"
            value={apiKey}
          />
        </label>
        <div className="flex items-center justify-between rounded-md border bg-muted/30 px-3 py-3">
          <div>
            <p className="text-xs text-muted-foreground">连接状态</p>
            <p className="mt-1 text-sm font-medium">
              {connectionStatus === 'checking'
                ? '正在检测晨羽连接'
                : connectionText[connectionStatus]}
            </p>
          </div>
          <span
            className={`inline-flex items-center gap-1 rounded-sm border px-2.5 py-1 text-xs font-medium ${connectionClassName[connectionStatus]}`}
          >
            {connectionStatus === 'checking' ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
            {connectionText[connectionStatus]}
          </span>
        </div>
        {connectionError ? (
          <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
            {connectionError}
          </p>
        ) : null}
      </CardContent>
    </Card>
  )
}
