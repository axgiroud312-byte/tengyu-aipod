import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Loader2, RefreshCw } from 'lucide-react'
import type { SkillSyncResult } from '../types'

export function SkillSyncCard({
  result,
  syncing,
  onSync,
}: {
  result: SkillSyncResult | null
  syncing: boolean
  onSync: () => void
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>云端 Skill 同步</CardTitle>
        <CardDescription>
          服务器只下发系统提示词；模型、密钥和 Workflow 不从云端同步。
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 text-sm">
          {result ? (
            <SyncStatusRow
              label="Skill 缓存"
              value={result.ok ? `${result.count} 条` : result.error}
            />
          ) : (
            <SyncStatusRow label="Skill 缓存" value="正在读取缓存" />
          )}
        </div>
        <Button
          className="w-full"
          disabled={syncing}
          onClick={onSync}
          type="button"
          variant="outline"
        >
          {syncing ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <RefreshCw className="mr-2 h-4 w-4" />
          )}
          同步 Skill
        </Button>
      </CardContent>
    </Card>
  )
}

function SyncStatusRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-md border bg-muted/30 px-3 py-2">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-right font-medium">{value}</span>
    </div>
  )
}
