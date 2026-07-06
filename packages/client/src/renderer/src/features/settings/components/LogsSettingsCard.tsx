import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { FileArchive, FolderOpen, Loader2, Trash2 } from 'lucide-react'
import type { WorkspaceState } from '../types'

export function LogsSettingsCard({
  deleting,
  exporting,
  opening,
  workspace,
  onDeleteAll,
  onExportZip,
  onOpenDirectory,
}: {
  deleting: boolean
  exporting: boolean
  opening: boolean
  workspace: WorkspaceState | null
  onDeleteAll: () => void
  onExportZip: () => void
  onOpenDirectory: () => void
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>日志</CardTitle>
        <CardDescription>
          打开或导出当前工作区 `.workbench/logs/` 下的运行日志、诊断日志和崩溃日志。
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0 text-sm text-muted-foreground">
          <p className="break-all">
            {workspace?.root ? `${workspace.root}/.workbench/logs` : '请先选择工作区'}
          </p>
        </div>
        <div className="flex flex-wrap gap-2 sm:justify-end">
          <Button
            disabled={opening || !workspace?.root}
            onClick={onOpenDirectory}
            type="button"
            variant="outline"
          >
            {opening ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <FolderOpen className="mr-2 h-4 w-4" />
            )}
            打开日志目录
          </Button>
          <Button
            disabled={exporting || !workspace?.root}
            onClick={onExportZip}
            type="button"
            variant="secondary"
          >
            {exporting ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <FileArchive className="mr-2 h-4 w-4" />
            )}
            导出日志包
          </Button>
          <Button
            disabled={deleting || !workspace?.root}
            onClick={onDeleteAll}
            type="button"
            variant="destructive"
          >
            {deleting ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Trash2 className="mr-2 h-4 w-4" />
            )}
            删除所有日志
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}
