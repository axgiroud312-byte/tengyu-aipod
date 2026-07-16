import { Button } from '@/components/ui/button'
import { ComfyuiInstanceSelectorCard } from '@/features/generation/components/ComfyuiInstanceSelectorCard'
import { ComfyuiWorkflowSelect } from '@/features/generation/components/ComfyuiWorkflowSelect'
import { CurrentTaskImagePreview } from '@/features/generation/components/CurrentTaskImagePreview'
import { GenerationCancelButton } from '@/features/generation/components/GenerationCancelButton'
import { GenerationFeedback } from '@/features/generation/components/GenerationFeedback'
import { ImageFolderPickerPanel } from '@/features/generation/components/ImageFolderPickerPanel'
import { TaskNameField } from '@/features/generation/components/TaskNameField'
import { VisibleFilenameFields } from '@/features/generation/components/VisibleFilenameFields'
import { useComfyuiPanel } from '@/features/generation/hooks/use-comfyui-panel'
import type { MattingMode } from '@/features/generation/lib/panel-options'
import { Loader2, Play } from 'lucide-react'
import { useMemo, useState } from 'react'

export function ComfyuiMattingPanel() {
  const workflowScope = 'matting'
  const mixedWorkflowScope = 'matting-mixed'
  const workflowSlots = useMemo(
    () => [
      {
        id: 'main',
        load: () => window.api.generation.listComfyuiMattingWorkflows(),
        scope: workflowScope,
      },
      {
        id: 'mixed',
        load: () => window.api.generation.listComfyuiMixedMattingWorkflows(),
        scope: mixedWorkflowScope,
      },
    ],
    [],
  )
  const {
    beginRun,
    chooseSourceFolder,
    comfyuiInstanceSelection,
    error,
    handleRunStartFailure,
    loadingSources,
    previewImages,
    result,
    running,
    scanSourceFolder,
    setError,
    setProgress,
    sourceFolder,
    sources,
    taskEvents,
    workflowSlot,
  } = useComfyuiPanel({
    capability: 'matting',
    instanceScope: workflowScope,
    workflowErrorMessage: '读取 ComfyUI 抠图工作流失败',
    workflowSlots,
  })
  const [mode, setMode] = useState<MattingMode>('comfyui')
  const [taskName, setTaskName] = useState('')
  const [filenamePrefix, setFilenamePrefix] = useState('')
  const [filenameSeparator, setFilenameSeparator] = useState('-')
  const mainWorkflowSlot = workflowSlot('main')
  const mixedWorkflowSlot = workflowSlot('mixed')
  const activeWorkflowSlot = mode === 'mixed' ? mixedWorkflowSlot : mainWorkflowSlot
  const selectedWorkflow = activeWorkflowSlot.selectedWorkflow

  async function startMatting() {
    setError(null)
    if (sources.length === 0) {
      setError('请先检索图片文件夹')
      return
    }
    if (!selectedWorkflow) {
      setError(mode === 'mixed' ? '请选择 ComfyUI 混合抠图工作流' : '请选择 ComfyUI 抠图工作流')
      return
    }
    if (!comfyuiInstanceSelection.runTarget) {
      setError('请选择运行中的云机')
      return
    }
    beginRun()
    const workflowVersion = selectedWorkflow.version
    let taskId: string
    const sourceImagePaths = sources.map((source) => source.path)
    try {
      if (mode === 'mixed') {
        taskId = await window.api.generation.runMixedMatting({
          sourceImagePaths,
          workflowId: selectedWorkflow.id,
          workflowName: selectedWorkflow.name,
          ...(taskName.trim() ? { taskId: taskName.trim() } : {}),
          ...(filenamePrefix.trim() ? { filenamePrefix: filenamePrefix.trim() } : {}),
          ...(filenamePrefix.trim() ? { filenameSeparator } : {}),
          ...(workflowVersion ? { workflowVersion } : {}),
          ...comfyuiInstanceSelection.runTarget,
        })
      } else {
        taskId = await window.api.generation.runComfyuiMatting({
          sourceImagePaths,
          workflowId: selectedWorkflow.id,
          workflowName: selectedWorkflow.name,
          ...(taskName.trim() ? { taskId: taskName.trim() } : {}),
          ...(filenamePrefix.trim() ? { filenamePrefix: filenamePrefix.trim() } : {}),
          ...(filenamePrefix.trim() ? { filenameSeparator } : {}),
          ...(workflowVersion ? { workflowVersion } : {}),
          ...comfyuiInstanceSelection.runTarget,
        })
      }
    } catch (nextError) {
      handleRunStartFailure(nextError, '启动 ComfyUI 抠图失败')
      return
    }
    if (!taskEvents.activateTask(taskId)) {
      setProgress({
        task_id: taskId,
        capability: 'matting',
        processed: 0,
        total: sources.length,
        succeeded: 0,
        failed: 0,
        images: [],
      })
    }
  }

  return (
    <>
      <div className="mt-5 grid gap-5 min-[1400px]:grid-cols-[minmax(0,1fr)_340px]">
        <section aria-label="生图输入" className="space-y-5">
          <ImageFolderPickerPanel
            emptyText="暂无可用于抠图的图片"
            folderPath={sourceFolder}
            images={sources}
            loading={loadingSources}
            onChoose={() => void chooseSourceFolder()}
            onScan={() => void scanSourceFolder()}
            title="抠图图片文件夹"
          />

          <div className="rounded-md border bg-background p-4">
            <h4 className="font-semibold">抠图方式</h4>
            <div className="mt-4 grid gap-3 md:grid-cols-2">
              {[
                { key: 'comfyui' as const, label: 'ComfyUI 直接抠图', note: '推荐，单步完成。' },
                {
                  key: 'mixed' as const,
                  label: '付费黑白图 + 混合',
                  note: '质量更高，速度更慢。',
                },
              ].map((item) => (
                <label
                  className="grid cursor-pointer grid-cols-[20px_minmax(0,1fr)] gap-2 rounded-md border bg-muted/30 p-3 text-sm"
                  key={item.key}
                >
                  <input
                    checked={mode === item.key}
                    className="mt-1"
                    onChange={() => setMode(item.key)}
                    type="radio"
                  />
                  <span>
                    <span className="block font-medium">{item.label}</span>
                    <span className="mt-1 block text-xs text-muted-foreground">{item.note}</span>
                  </span>
                </label>
              ))}
            </div>
            <div className="mt-4 grid gap-4">
              <ComfyuiWorkflowSelect
                onChange={(key) => {
                  if (mode === 'mixed') {
                    mixedWorkflowSlot.setWorkflowKey(key)
                  } else {
                    mainWorkflowSlot.setWorkflowKey(key)
                  }
                }}
                workflowKey={activeWorkflowSlot.workflowKey}
                workflows={activeWorkflowSlot.workflows}
              />
            </div>
          </div>
        </section>

        <aside aria-label="生图启动与运行" className="space-y-5">
          <div className="rounded-md border bg-background p-4">
            <h4 className="font-semibold">执行</h4>
            <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
              <div>
                <dt className="text-muted-foreground">检索图片</dt>
                <dd className="font-medium tabular-nums">{sources.length}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">工作流</dt>
                <dd className="truncate font-medium">{selectedWorkflow?.name ?? '未选择'}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">路径</dt>
                <dd className="truncate font-medium">
                  {mode === 'mixed' ? '混合路径' : '直接抠图'}
                </dd>
              </div>
            </dl>
            <div className="mt-4">
              <TaskNameField
                onChange={setTaskName}
                placeholder="默认：抠图-时间"
                value={taskName}
              />
              <VisibleFilenameFields
                onPrefixChange={setFilenamePrefix}
                onSeparatorChange={setFilenameSeparator}
                prefix={filenamePrefix}
                separator={filenameSeparator}
              />
            </div>
            <Button
              className="mt-4 w-full"
              disabled={running || !comfyuiInstanceSelection.runTarget}
              onClick={() => void startMatting()}
              type="button"
            >
              {running ? <Loader2 className="mr-2 h-4 w-4" /> : <Play className="mr-2 h-4 w-4" />}
              开始抠图
            </Button>
            <div className="mt-2">
              <GenerationCancelButton
                onCancel={() => void taskEvents.cancelTask()}
                running={running}
              />
            </div>
          </div>

          <ComfyuiInstanceSelectorCard selection={comfyuiInstanceSelection} />
          <GenerationFeedback error={error} result={result} />
        </aside>
      </div>
      <CurrentTaskImagePreview images={previewImages} />
    </>
  )
}
