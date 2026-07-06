import { Button } from '@/components/ui/button'
import { ComfyuiInstanceSelectorCard } from '@/features/generation/components/ComfyuiInstanceSelectorCard'
import { ComfyuiWorkflowSelect } from '@/features/generation/components/ComfyuiWorkflowSelect'
import { CurrentTaskImagePreview } from '@/features/generation/components/CurrentTaskImagePreview'
import { ExtractSkillPicker } from '@/features/generation/components/ExtractSkillPicker'
import { GenerationCancelButton } from '@/features/generation/components/GenerationCancelButton'
import { GenerationFeedback } from '@/features/generation/components/GenerationFeedback'
import { ImageFolderPickerPanel } from '@/features/generation/components/ImageFolderPickerPanel'
import { TaskNameField } from '@/features/generation/components/TaskNameField'
import { VisibleFilenameFields } from '@/features/generation/components/VisibleFilenameFields'
import { useComfyuiPanel } from '@/features/generation/hooks/use-comfyui-panel'
import { useExtractSkillOptions } from '@/features/generation/hooks/use-skill-options'
import { clampNumber } from '@/features/generation/lib/format'
import { Loader2, Play } from 'lucide-react'
import { useMemo, useState } from 'react'

export function ComfyuiExtractMattingPanel() {
  const extractWorkflowScope = 'extract-matting:extract'
  const mattingWorkflowScope = 'extract-matting:matting'
  const workflowSlots = useMemo(
    () => [
      {
        id: 'extract',
        load: () => window.api.generation.listComfyuiExtractWorkflows(),
        scope: extractWorkflowScope,
      },
      {
        id: 'matting',
        load: () => window.api.generation.listComfyuiMattingWorkflows(),
        scope: mattingWorkflowScope,
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
    instanceScope: 'extract-matting',
    workflowErrorMessage: '读取 ComfyUI 工作流失败',
    workflowSlots,
  })
  const [width, setWidth] = useState('1024')
  const [height, setHeight] = useState('1024')
  const [taskName, setTaskName] = useState('')
  const [filenamePrefix, setFilenamePrefix] = useState('')
  const [filenameSeparator, setFilenameSeparator] = useState('-')
  const { extractSkills, selectedSkill, selectedSkillKey, setSelectedSkillKey } =
    useExtractSkillOptions(setError)

  const extractWorkflowSlot = workflowSlot('extract')
  const mattingWorkflowSlot = workflowSlot('matting')
  const selectedExtractWorkflow = extractWorkflowSlot.selectedWorkflow
  const selectedMattingWorkflow = mattingWorkflowSlot.selectedWorkflow

  async function startExtractMatting() {
    setError(null)
    if (sources.length === 0) {
      setError('请先检索图片文件夹')
      return
    }
    if (!selectedExtractWorkflow) {
      setError('请选择 ComfyUI 提取工作流')
      return
    }
    if (!selectedMattingWorkflow) {
      setError('请选择 ComfyUI 抠图工作流')
      return
    }
    if (!selectedSkill) {
      setError('请先在后台配置提取 Skill')
      return
    }
    if (!comfyuiInstanceSelection.runTarget) {
      setError('请选择运行中的云机')
      return
    }

    beginRun()
    try {
      const taskId = await window.api.generation.runComfyuiExtractMatting({
        sourceImagePaths: sources.map((source) => source.path),
        extractWorkflowId: selectedExtractWorkflow.id,
        extractWorkflowName: selectedExtractWorkflow.name,
        extractWorkflowVersion: selectedExtractWorkflow.version,
        mattingWorkflowId: selectedMattingWorkflow.id,
        mattingWorkflowName: selectedMattingWorkflow.name,
        mattingWorkflowVersion: selectedMattingWorkflow.version,
        skillId: selectedSkill.id,
        skillVersion: selectedSkill.version,
        ...(taskName.trim() ? { taskId: taskName.trim() } : {}),
        ...(filenamePrefix.trim() ? { filenamePrefix: filenamePrefix.trim() } : {}),
        ...(filenamePrefix.trim() ? { filenameSeparator } : {}),
        width: clampNumber(width, 256, 4096, 1024),
        height: clampNumber(height, 256, 4096, 1024),
        ...comfyuiInstanceSelection.runTarget,
      })
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
    } catch (nextError) {
      handleRunStartFailure(nextError, '启动提取后抠图失败')
    }
  }

  return (
    <>
      <div className="mt-5 grid gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
        <div className="space-y-5">
          <ImageFolderPickerPanel
            emptyText="暂无可用于提取后抠图的图片"
            folderPath={sourceFolder}
            images={sources}
            loading={loadingSources}
            onChoose={() => void chooseSourceFolder()}
            onScan={() => void scanSourceFolder()}
            title="提取后抠图图片文件夹"
          />

          <div className="rounded-md border bg-background p-4">
            <h4 className="font-semibold">工作流设置</h4>
            <div className="mt-4 grid gap-4 md:grid-cols-2">
              <ComfyuiWorkflowSelect
                label="提取工作流"
                onChange={extractWorkflowSlot.setWorkflowKey}
                workflowKey={extractWorkflowSlot.workflowKey}
                workflows={extractWorkflowSlot.workflows}
              />
              <ComfyuiWorkflowSelect
                label="抠图工作流"
                onChange={mattingWorkflowSlot.setWorkflowKey}
                workflowKey={mattingWorkflowSlot.workflowKey}
                workflows={mattingWorkflowSlot.workflows}
              />
              <label className="block space-y-2 text-sm font-medium">
                <span>宽度</span>
                <input
                  className="h-10 w-full rounded-md border px-3 text-sm tabular-nums outline-none focus-visible:ring-2 focus-visible:ring-primary"
                  max={4096}
                  min={256}
                  onChange={(event) => setWidth(event.target.value)}
                  type="number"
                  value={width}
                />
              </label>
              <label className="block space-y-2 text-sm font-medium">
                <span>高度</span>
                <input
                  className="h-10 w-full rounded-md border px-3 text-sm tabular-nums outline-none focus-visible:ring-2 focus-visible:ring-primary"
                  max={4096}
                  min={256}
                  onChange={(event) => setHeight(event.target.value)}
                  type="number"
                  value={height}
                />
              </label>
            </div>
          </div>

          <div className="rounded-md border bg-background p-4">
            <h4 className="font-semibold">提取 Skill</h4>
            <div className="mt-4">
              <ExtractSkillPicker
                extractSkills={extractSkills}
                onChange={(key) => {
                  setSelectedSkillKey(key)
                  setError(null)
                }}
                selectedSkill={selectedSkill}
                selectedSkillKey={selectedSkillKey}
              />
            </div>
          </div>
        </div>

        <aside className="space-y-5">
          <div className="rounded-md border bg-background p-4">
            <h4 className="font-semibold">执行</h4>
            <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
              <div>
                <dt className="text-muted-foreground">检索图片</dt>
                <dd className="font-medium tabular-nums">{sources.length}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">提取</dt>
                <dd className="truncate font-medium">
                  {selectedExtractWorkflow?.name ?? '未选择'}
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground">抠图</dt>
                <dd className="truncate font-medium">
                  {selectedMattingWorkflow?.name ?? '未选择'}
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground">输出</dt>
                <dd className="truncate font-medium">只保留最终图</dd>
              </div>
            </dl>
            <div className="mt-4">
              <TaskNameField
                onChange={setTaskName}
                placeholder="默认：提取后抠图-时间"
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
              onClick={() => void startExtractMatting()}
              type="button"
            >
              {running ? <Loader2 className="mr-2 h-4 w-4" /> : <Play className="mr-2 h-4 w-4" />}
              开始提取后抠图
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
