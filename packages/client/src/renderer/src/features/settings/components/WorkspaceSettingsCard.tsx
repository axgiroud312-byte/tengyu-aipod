import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { CheckCircle2, FolderOpen, Loader2 } from 'lucide-react'
import type { WorkspaceState } from '../types'

export function WorkspaceSettingsCard({
  saving,
  workspace,
  workspaceDraft,
  onChooseRoot,
  onSaveRoot,
  onWorkspaceDraftChange,
}: {
  saving: boolean
  workspace: WorkspaceState | null
  workspaceDraft: string
  onChooseRoot: () => void
  onSaveRoot: () => void
  onWorkspaceDraftChange: (value: string) => void
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>工作区</CardTitle>
        <CardDescription>选择后会在本地自动创建采集、印花、检测和上架工作区。</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <label className="grid gap-2 text-sm font-medium" htmlFor="workspace-root">
          <span>选择工作区</span>
          <div className="flex gap-2">
            <Input
              className="min-w-0 flex-1"
              id="workspace-root"
              onChange={(event) => onWorkspaceDraftChange(event.target.value)}
              placeholder="例如 /Users/you/Documents/腾域aipod工作区"
              value={workspaceDraft}
            />
            <Button onClick={onChooseRoot} type="button" variant="secondary">
              <FolderOpen className="mr-2 h-4 w-4" />
              浏览
            </Button>
            <Button disabled={saving || !workspaceDraft.trim()} onClick={onSaveRoot} type="button">
              {saving ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <CheckCircle2 className="mr-2 h-4 w-4" />
              )}
              保存工作区
            </Button>
          </div>
        </label>
        <div className="grid gap-2 text-sm md:grid-cols-2 xl:grid-cols-3">
          {(workspace?.directories ?? []).map((directory) => (
            <div className="rounded-md border bg-muted/40 px-3 py-2" key={directory}>
              {directory}
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  )
}
