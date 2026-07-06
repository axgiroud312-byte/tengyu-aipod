import { Button } from '@/components/ui/button'
import { ComfyuiImg2imgPromptFields } from '@/features/generation/components/ComfyuiImg2imgPromptFields'
import { ComfyuiInstanceSelectorCard } from '@/features/generation/components/ComfyuiInstanceSelectorCard'
import { ComfyuiWorkflowSelect } from '@/features/generation/components/ComfyuiWorkflowSelect'
import { CurrentTaskImagePreview } from '@/features/generation/components/CurrentTaskImagePreview'
import { GenerationCancelButton } from '@/features/generation/components/GenerationCancelButton'
import { GenerationFeedback } from '@/features/generation/components/GenerationFeedback'
import { ImageFolderPickerPanel } from '@/features/generation/components/ImageFolderPickerPanel'
import { TaskNameField } from '@/features/generation/components/TaskNameField'
import { VisibleFilenameFields } from '@/features/generation/components/VisibleFilenameFields'
import { useComfyuiPanel } from '@/features/generation/hooks/use-comfyui-panel'
import { useGenerationLocalSettings } from '@/features/generation/hooks/use-generation-local-settings'
import { usePromptSkillOptions } from '@/features/generation/hooks/use-skill-options'
import {
  bailianModelsForUse,
  clampNumber,
  promptSkillCategoryFor,
  promptSkillLabel,
} from '@/features/generation/lib/format'
import {
  type ComfyuiImg2imgPromptMode,
  type Img2imgMode,
  img2imgModes,
} from '@/features/generation/lib/panel-options'
import { Loader2, Play } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'

export function ComfyuiImg2imgPanel() {
  const { settings, error: settingsError } = useGenerationLocalSettings()
  const workflowScope = 'img2img'
  const workflowSlots = useMemo(
    () => [
      {
        id: 'main',
        load: () => window.api.generation.listComfyuiImg2imgWorkflows(),
        scope: workflowScope,
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
    sources: sourceImages,
    taskEvents,
    workflowSlot,
  } = useComfyuiPanel({
    capability: 'img2img',
    instanceScope: workflowScope,
    workflowErrorMessage: '读取 ComfyUI 工作流失败',
    workflowSlots,
  })
  const [width, setWidth] = useState('1024')
  const [height, setHeight] = useState('1024')
  const [batchSize, setBatchSize] = useState('1')
  const [promptMode, setPromptMode] = useState<ComfyuiImg2imgPromptMode>('ai')
  const [printMode, setPrintMode] = useState<'local' | 'full'>('local')
  const [referenceMode, setReferenceMode] = useState<Exclude<Img2imgMode, 'manual'>>('layout')
  const [promptModel, setPromptModel] = useState('qwen3.6-flash')
  const [requirement, setRequirement] = useState('')
  const [prompt, setPrompt] = useState('')
  const [taskName, setTaskName] = useState('')
  const [filenamePrefix, setFilenamePrefix] = useState('')
  const [filenameSeparator, setFilenameSeparator] = useState('-')

  const promptSkillCategory = promptSkillCategoryFor('img2img', printMode)
  const promptSkillSelection = usePromptSkillOptions(promptSkillCategory, setError)
  const selectedReferenceMode =
    img2imgModes.find((item) => item.key === referenceMode) ?? img2imgModes[0]
  const promptModelOptions = useMemo(() => bailianModelsForUse(settings, true), [settings])

  useEffect(() => {
    if (settingsError) {
      setError(settingsError)
    }
  }, [settingsError, setError])

  useEffect(() => {
    const preferred = settings?.config.bailian_vision_model
    const firstModel =
      promptModelOptions.find((model) => model.id === preferred) ?? promptModelOptions[0]
    if (firstModel && !promptModelOptions.some((model) => model.id === promptModel)) {
      setPromptModel(firstModel.id)
    }
  }, [promptModel, promptModelOptions, settings])

  const mainWorkflowSlot = workflowSlot('main')
  const selectedWorkflow = mainWorkflowSlot.selectedWorkflow
  const outputCount = clampNumber(batchSize, 1, 8, 1)
  const expectedOutputCount = sourceImages.length * outputCount

  async function startImg2img() {
    setError(null)
    if (sourceImages.length === 0) {
      setError('请先检索图片文件夹')
      return
    }
    if (!selectedWorkflow) {
      setError('请选择 ComfyUI 图生图工作流')
      return
    }
    if (!comfyuiInstanceSelection.runTarget) {
      setError('请选择运行中的云机')
      return
    }
    const customPrompt = prompt.trim()
    if (promptMode === 'manual' && !customPrompt) {
      setError('请填写图生图提示词，或切回使用工作流默认提示词')
      return
    }
    if (promptMode === 'ai' && !promptSkillSelection.selectedSkill) {
      setError(`请先选择${promptSkillLabel(promptSkillCategory)} Skill`)
      return
    }
    if (promptMode === 'ai' && !promptModel.trim()) {
      setError('请选择提示词模型')
      return
    }

    beginRun()
    try {
      const taskId = await window.api.generation.runComfyuiImg2img({
        sourceImagePaths: sourceImages.map((image) => image.path),
        workflowId: selectedWorkflow.id,
        workflowName: selectedWorkflow.name,
        workflowVersion: selectedWorkflow.version,
        ...(taskName.trim() ? { taskId: taskName.trim() } : {}),
        ...(filenamePrefix.trim() ? { filenamePrefix: filenamePrefix.trim() } : {}),
        ...(filenamePrefix.trim() ? { filenameSeparator } : {}),
        promptMode,
        ...(promptMode === 'manual' ? { prompt: customPrompt } : {}),
        ...(promptMode === 'ai'
          ? {
              printMode,
              promptModel,
              modeInstruction: selectedReferenceMode?.instruction ?? '',
              requirement,
              ...(promptSkillSelection.selectedSkill
                ? {
                    promptSkillId: promptSkillSelection.selectedSkill.id,
                    promptSkillVersion: promptSkillSelection.selectedSkill.version,
                  }
                : {}),
            }
          : {}),
        width: clampNumber(width, 256, 4096, 1024),
        height: clampNumber(height, 256, 4096, 1024),
        batchSize: outputCount,
        ...comfyuiInstanceSelection.runTarget,
      })
      if (!taskEvents.activateTask(taskId)) {
        setProgress({
          task_id: taskId,
          capability: 'img2img',
          processed: 0,
          total: expectedOutputCount,
          succeeded: 0,
          failed: 0,
          images: [],
        })
      }
    } catch (nextError) {
      handleRunStartFailure(nextError, '启动 ComfyUI 图生图失败')
    }
  }

  return (
    <>
      <div className="mt-5 grid gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
        <div className="space-y-5">
          <ImageFolderPickerPanel
            emptyText="暂无可用于图生图的图片"
            folderPath={sourceFolder}
            images={sourceImages}
            loading={loadingSources}
            onChoose={() => void chooseSourceFolder()}
            onScan={() => void scanSourceFolder()}
            title="图生图图片文件夹"
          />

          <div className="rounded-md border bg-background p-4">
            <h4 className="font-semibold">ComfyUI 工作流</h4>
            <div className="mt-4 grid gap-4 md:grid-cols-2">
              <ComfyuiWorkflowSelect
                onChange={mainWorkflowSlot.setWorkflowKey}
                workflowKey={mainWorkflowSlot.workflowKey}
                workflows={mainWorkflowSlot.workflows}
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
              <label className="block space-y-2 text-sm font-medium">
                <span>每张生成</span>
                <input
                  className="h-10 w-full rounded-md border px-3 text-sm tabular-nums outline-none focus-visible:ring-2 focus-visible:ring-primary"
                  max={8}
                  min={1}
                  onChange={(event) => setBatchSize(event.target.value)}
                  type="number"
                  value={batchSize}
                />
              </label>
              <ComfyuiImg2imgPromptFields
                img2imgModes={img2imgModes}
                printMode={printMode}
                prompt={prompt}
                promptMode={promptMode}
                promptModel={promptModel}
                promptModelOptions={promptModelOptions}
                promptSkillCategory={promptSkillCategory}
                promptSkillSelection={promptSkillSelection}
                referenceMode={referenceMode}
                requirement={requirement}
                setPrintMode={setPrintMode}
                setPrompt={setPrompt}
                setPromptMode={setPromptMode}
                setPromptModel={setPromptModel}
                setReferenceMode={setReferenceMode}
                setRequirement={setRequirement}
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
                <dd className="font-medium tabular-nums">{sourceImages.length}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">工作流</dt>
                <dd className="truncate font-medium">{selectedWorkflow?.name ?? '未选择'}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">提示词</dt>
                <dd className="font-medium">
                  {promptMode === 'ai'
                    ? 'AI 看图写提示词'
                    : promptMode === 'workflow'
                      ? '工作流默认'
                      : '手动填写'}
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground">预计输出</dt>
                <dd className="font-medium tabular-nums">{expectedOutputCount}</dd>
              </div>
            </dl>
            <div className="mt-4">
              <TaskNameField
                onChange={setTaskName}
                placeholder="默认：图生图-时间"
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
              onClick={() => void startImg2img()}
              type="button"
            >
              {running ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Play className="mr-2 h-4 w-4" />
              )}
              开始图生图
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
