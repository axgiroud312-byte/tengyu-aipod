import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { FileJson, FolderOpen, Loader2, RefreshCw, Trash2 } from 'lucide-react'
import { type LocalWorkflowSummary, workflowCategoryOptions } from '../types'

export function LocalWorkflowCard({
  directoryPath,
  importing,
  workflows,
  onChooseDirectory,
  onDirectoryPathChange,
  onImport,
  onRemove,
}: {
  directoryPath: string
  importing: boolean
  workflows: LocalWorkflowSummary[]
  onChooseDirectory: () => void
  onDirectoryPathChange: (value: string) => void
  onImport: () => void
  onRemove: (id: string) => void
}) {
  const groupedWorkflows = workflowCategoryOptions
    .map((category) => ({
      ...category,
      workflows: workflows.filter((workflow) => workflow.capability === category.key),
    }))
    .filter((category) => category.workflows.length > 0)

  return (
    <Card>
      <CardHeader>
        <CardTitle>本地 Workflow</CardTitle>
        <CardDescription>
          选择一个总文件夹，按子文件夹名称自动归类并缓存 ComfyUI API JSON。
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <label className="block space-y-2 text-sm font-medium" htmlFor="workflow-directory">
            <span>Workflow 文件夹</span>
            <Input
              id="workflow-directory"
              onChange={(event) => onDirectoryPathChange(event.target.value)}
              placeholder="选择或粘贴 ComfyUI Workflow 总文件夹路径"
              value={directoryPath}
            />
          </label>
          <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
            <Button onClick={onChooseDirectory} type="button" variant="secondary">
              <FolderOpen className="mr-2 h-4 w-4" />
              选择文件夹
            </Button>
            <Button disabled={importing || !directoryPath.trim()} onClick={onImport} type="button">
              {importing ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <RefreshCw className="mr-2 h-4 w-4" />
              )}
              导入并刷新缓存
            </Button>
          </div>
          <p className="text-xs leading-5 text-muted-foreground">
            支持子文件夹：文生图 / 图生图 / 提取 / 抠图，也支持 txt2img / img2img / extract /
            matting。重新导入会用这个文件夹刷新本机缓存。
          </p>
        </div>

        <div className="space-y-2">
          {groupedWorkflows.length ? (
            groupedWorkflows.map((group) => (
              <div className="rounded-md border bg-muted/20 p-3" key={group.key}>
                <div className="mb-2 flex items-center justify-between gap-3">
                  <p className="text-sm font-medium">{group.label}</p>
                  <Badge variant="secondary">{group.workflows.length}</Badge>
                </div>
                <div className="space-y-2">
                  {group.workflows.map((workflow) => (
                    <div
                      className="flex items-center justify-between gap-3 rounded-md border bg-background px-3 py-2 text-sm"
                      key={`${workflow.id}@${workflow.version}`}
                    >
                      <div className="min-w-0">
                        <div className="flex min-w-0 flex-wrap items-center gap-2">
                          <p className="truncate font-medium">{workflow.name}</p>
                          <WorkflowDetectionBadge workflow={workflow} />
                        </div>
                        <p className="mt-1 truncate text-xs text-muted-foreground">
                          {workflow.version} · 图像 {workflow.detection.imageInputs} · 提示词{' '}
                          {workflow.detection.promptInputs} · 尺寸 {workflow.detection.sizeInputs} ·
                          数量 {workflow.detection.batchInputs} · 输出{' '}
                          {workflow.detection.outputImages}
                        </p>
                        {workflow.detection.warnings.length ? (
                          <p className="mt-1 line-clamp-2 text-xs text-amber-700">
                            {workflow.detection.warnings.join('；')}
                          </p>
                        ) : null}
                      </div>
                      <Button
                        className="h-8 px-2"
                        onClick={() => onRemove(workflow.id)}
                        type="button"
                        variant="ghost"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  ))}
                </div>
              </div>
            ))
          ) : (
            <div className="rounded-md border border-dashed bg-muted/30 px-3 py-6 text-center text-sm text-muted-foreground">
              <FileJson className="mx-auto mb-2 h-5 w-5" />
              暂无本地 Workflow
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  )
}

function WorkflowDetectionBadge({ workflow }: { workflow: LocalWorkflowSummary }) {
  if (workflow.detection.status === 'ready') {
    return <Badge className="bg-emerald-50 text-emerald-700">可运行</Badge>
  }
  if (workflow.detection.status === 'warning') {
    return <Badge className="bg-amber-50 text-amber-800">可运行，有提示</Badge>
  }
  return <Badge className="bg-red-50 text-red-700">需检查</Badge>
}
