import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { ActiveGenerationTaskNotice } from '@/features/generation/components/ActiveGenerationTaskNotice'
import { ComfyuiInstanceSelectorCard } from '@/features/generation/components/ComfyuiInstanceSelectorCard'
import { CurrentTaskImagePreview } from '@/features/generation/components/CurrentTaskImagePreview'
import { ExtractSkillPicker } from '@/features/generation/components/ExtractSkillPicker'
import { GenerationCancelButton } from '@/features/generation/components/GenerationCancelButton'
import { GenerationFeedback } from '@/features/generation/components/GenerationFeedback'
import { ImageFolderPickerPanel } from '@/features/generation/components/ImageFolderPickerPanel'
import { PromptSkillPicker } from '@/features/generation/components/PromptSkillPicker'
import { SkillVariableControl } from '@/features/generation/components/SkillVariableControl'
import { TaskNameField } from '@/features/generation/components/TaskNameField'
import { VisibleFilenameFields } from '@/features/generation/components/VisibleFilenameFields'
import {
  formatGenerationDebugLogLine,
  generationDebugLogLevelCounts,
  generationDebugRawResponse,
} from '@/features/generation/generation-debug-log'
import { useComfyuiInstanceSelection } from '@/features/generation/hooks/use-comfyui-instance-selection'
import { useGenerationLocalSettings } from '@/features/generation/hooks/use-generation-local-settings'
import { useGenerationTaskEvents } from '@/features/generation/hooks/use-generation-task-events'
import {
  useExtractSkillOptions,
  usePromptSkillOptions,
} from '@/features/generation/hooks/use-skill-options'
import { GENERATION_DEBUG_LOG_LIMIT } from '@/features/generation/lib/constants'
import {
  type ActiveGenerationTask,
  type SkillVariablesState,
  bailianModelsForUse,
  clampNumber,
  defaultVariableValue,
  generationDebugLogLevelClassName,
  grsaiSizes,
  isGenerationCapabilityKey,
  modelLabel,
  modelOptionsForCapability,
  progressPercent,
  promptSkillCategoryFor,
  promptSkillLabel,
  rememberWorkflowKey,
  selectedPromptTexts,
  variablePayload,
  workflowKeyOrFallback,
  workflowOptionKey,
} from '@/features/generation/lib/format'
import { readFileAsDataUrl, splitDataUrl } from '@/features/generation/lib/media'
import type { GenerationCapability } from '@tengyu-aipod/shared'
import {
  ChevronDown,
  ChevronUp,
  CircleDashed,
  ImagePlus,
  Layers3,
  Loader2,
  Play,
  Plus,
  RefreshCw,
  Scissors,
  Terminal,
  Trash2,
  WandSparkles,
} from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { ComfyuiWorkflowSummary } from '../../../main/lib/comfyui-workflow-cache'
import type {
  GenerationDebugLogEntry,
  GenerationImageSource,
  GenerationProgress,
  GenerationRunImage,
  GenerationRunResult,
  Txt2imgPromptDraft,
} from '../../../main/lib/generation-service'
import {
  type GenerationProvider,
  type GenerationUiCapability,
  generationCapabilities,
  generationProviders,
  isGenerationProviderAvailable,
  useGenerationStore,
} from '../store/generation'

type Txt2imgMode = 'ai' | 'manual'
type Img2imgMode = 'layout' | 'style' | 'layout-style' | 'manual'
type ComfyuiImg2imgPromptMode = 'ai' | 'workflow' | 'manual'
type MattingMode = 'comfyui' | 'mixed'
type Txt2imgGenerationPath = 'grsai' | 'comfyui'
type ReferenceImageDraft = {
  id: string
  name: string
  dataUrl: string
  base64: string
  mime_type: string
}

const capabilityIcons: Record<GenerationUiCapability, typeof WandSparkles> = {
  txt2img: WandSparkles,
  img2img: ImagePlus,
  extract: Layers3,
  matting: Scissors,
  'extract-matting': Scissors,
}

const providerNotes: Record<GenerationProvider, string> = {
  grsai: '付费模型路径，适合文生图、图生图和提取。',
  'comfyui-chenyu': '云端 ComfyUI 工作流路径，适合图生图、提取和抠图。',
}

const unavailableText: Record<GenerationUiCapability, string> = {
  txt2img: '当前组合不可用，请切换实现方式。',
  img2img: '当前组合不可用，请切换实现方式。',
  extract: '当前组合不可用，请切换实现方式。',
  matting: 'Grsai 不内置透明底抠图，请使用 ComfyUI 或后续混合路径。',
  'extract-matting': '提取后抠图只支持 ComfyUI 工作流路径。',
}

const img2imgModes: Array<{ key: Img2imgMode; label: string; instruction: string }> = [
  {
    key: 'layout',
    label: '参考构图',
    instruction:
      'Use only the layout structure from the reference image. Do not copy subject matter.',
  },
  {
    key: 'style',
    label: '参考风格',
    instruction: 'Use only the art style from the reference image. Create new content.',
  },
  {
    key: 'layout-style',
    label: '构图+风格',
    instruction:
      'Use both layout and art style from the reference image while creating a new motif.',
  },
  {
    key: 'manual',
    label: '自己写',
    instruction: '',
  },
]

function capabilityCopy(capability: GenerationUiCapability, provider: GenerationProvider) {
  if (!isGenerationProviderAvailable(capability, provider)) {
    return {
      title: '不可用',
      description: unavailableText[capability],
    }
  }

  if (capability === 'txt2img') {
    return {
      title: '文生图表单占位',
      description: '后续接入智能生成提示词 / 自己写双模式、提示词审稿、生图设置和进度面板。',
    }
  }

  if (capability === 'img2img') {
    return {
      title: provider === 'grsai' ? 'Grsai 图生图表单占位' : 'ComfyUI 图生图工作流占位',
      description:
        provider === 'grsai'
          ? '后续接入参考构图、参考风格、构图+风格、自己写四种模式。'
          : '后续接入本地导入的图生图工作流列表和参数表单。',
    }
  }

  if (capability === 'extract') {
    return {
      title: provider === 'grsai' ? 'Grsai 提取表单占位' : 'ComfyUI 提取工作流占位',
      description:
        provider === 'grsai'
          ? '后续接入采集图多选、提取模板、参考图提示词生成和图生图执行。'
          : '后续接入提取工作流选择、源图上传和结果落盘。',
    }
  }

  return {
    title: 'ComfyUI 抠图表单占位',
    description: '后续接入抠图工作流、混合路径和透明底输出。',
  }
}

function GrsaiPromptGenerationPanel({
  capability,
}: {
  capability: Extract<GenerationCapability, 'txt2img' | 'img2img'>
}) {
  const { settings, error: settingsError } = useGenerationLocalSettings()
  const workflowsVersion = useGenerationStore((state) => state.workflowsVersion)
  const [mode, setMode] = useState<Txt2imgMode>('ai')
  const [img2imgMode, setImg2imgMode] = useState<Img2imgMode>('layout')
  const [printMode, setPrintMode] = useState<'local' | 'full'>('local')
  const [promptCount, setPromptCount] = useState('5')
  const [requirement, setRequirement] = useState('')
  const [llmModel, setLlmModel] = useState('qwen3.6-flash')
  const [manualText, setManualText] = useState('')
  const [referenceImages, setReferenceImages] = useState<ReferenceImageDraft[]>([])
  const [sendReferenceToImageModel, setSendReferenceToImageModel] = useState(false)
  const [txt2imgGenerationPath, setTxt2imgGenerationPath] = useState<Txt2imgGenerationPath>('grsai')
  const [comfyuiTxt2imgWorkflows, setComfyuiTxt2imgWorkflows] = useState<ComfyuiWorkflowSummary[]>(
    [],
  )
  const [comfyuiTxt2imgWorkflowKey, setComfyuiTxt2imgWorkflowKey] = useState('')
  const [comfyuiTxt2imgWidth, setComfyuiTxt2imgWidth] = useState('1024')
  const [comfyuiTxt2imgHeight, setComfyuiTxt2imgHeight] = useState('1024')
  const [loadingComfyuiTxt2imgWorkflows, setLoadingComfyuiTxt2imgWorkflows] = useState(false)
  const [drafts, setDrafts] = useState<Txt2imgPromptDraft[]>([])
  const [draftsCollapsed, setDraftsCollapsed] = useState(true)
  const [generationModel, setGenerationModel] = useState('gpt-image-2')
  const [aspectRatio, setAspectRatio] = useState('1024x1024')
  const [taskName, setTaskName] = useState('')
  const [filenamePrefix, setFilenamePrefix] = useState('')
  const [filenameSeparator, setFilenameSeparator] = useState('-')
  const [progress, setProgress] = useState<GenerationProgress | null>(null)
  const [previewImages, setPreviewImages] = useState<GenerationRunImage[]>([])
  const [result, setResult] = useState<GenerationRunResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [generatingPrompts, setGeneratingPrompts] = useState(false)
  const [running, setRunning] = useState(false)
  const taskEvents = useGenerationTaskEvents({
    expectedCapability: capability,
    setProgress,
    setPreviewImages,
    setResult,
    setError,
    setRunning,
  })

  const activeImg2imgMode = img2imgModes.find((item) => item.key === img2imgMode) ?? img2imgModes[0]
  const aiMode = capability === 'txt2img' ? mode === 'ai' : img2imgMode !== 'manual'
  const manualMode = capability === 'txt2img' ? mode === 'manual' : img2imgMode === 'manual'
  const usesPromptReference = capability === 'img2img' && img2imgMode !== 'manual'
  const sendsReferenceToImageModel = capability === 'img2img' && sendReferenceToImageModel
  const generationModels = useMemo(
    () => modelOptionsForCapability(settings, capability),
    [capability, settings],
  )
  const selectedGenerationModel = useMemo(
    () => generationModels.find((model) => model.id === generationModel) ?? null,
    [generationModel, generationModels],
  )
  const sizeOptions = grsaiSizes(selectedGenerationModel)
  const defaultConcurrency = settings?.config.default_concurrency ?? 20
  const llmModels = useMemo(
    () => bailianModelsForUse(settings, usesPromptReference),
    [settings, usesPromptReference],
  )
  const promptSkillCategory = promptSkillCategoryFor(capability, printMode)
  const promptSkillSelection = usePromptSkillOptions(promptSkillCategory, setError)
  const selectedPromptSkill = promptSkillSelection.selectedSkill

  const selectedPrompts = useMemo(() => selectedPromptTexts(drafts), [drafts])
  const percent = progressPercent(progress)
  const usesComfyuiTxt2img = capability === 'txt2img' && txt2imgGenerationPath === 'comfyui'
  const comfyuiInstanceSelection = useComfyuiInstanceSelection('txt2img', usesComfyuiTxt2img)
  const selectedComfyuiTxt2imgWorkflow = comfyuiTxt2imgWorkflows.find(
    (workflow) => workflowOptionKey(workflow) === comfyuiTxt2imgWorkflowKey,
  )

  useEffect(() => {
    const firstModel = generationModels[0]
    if (firstModel && !generationModels.some((model) => model.id === generationModel)) {
      setGenerationModel(firstModel.id)
    }
  }, [generationModel, generationModels])

  useEffect(() => {
    if (!sizeOptions.includes(aspectRatio)) {
      setAspectRatio(sizeOptions[0] ?? '1024x1024')
    }
  }, [aspectRatio, sizeOptions])

  useEffect(() => {
    const preferredModel = usesPromptReference
      ? settings?.config.bailian_vision_model
      : settings?.config.bailian_text_model
    const firstLlm = llmModels.find((model) => model.id === preferredModel) ?? llmModels[0]
    if (firstLlm && !llmModels.some((model) => model.id === llmModel)) {
      setLlmModel(firstLlm.id)
    }
  }, [llmModel, llmModels, settings, usesPromptReference])

  useEffect(() => {
    void workflowsVersion
    if (capability !== 'txt2img') {
      return
    }
    void loadComfyuiTxt2imgWorkflows()
  }, [capability, workflowsVersion])

  async function loadComfyuiTxt2imgWorkflows() {
    setLoadingComfyuiTxt2imgWorkflows(true)
    setError(null)
    try {
      const nextWorkflows = await window.api.generation.listComfyuiTxt2imgWorkflows()
      setComfyuiTxt2imgWorkflows(nextWorkflows)
      setComfyuiTxt2imgWorkflowKey((current) =>
        current && nextWorkflows.some((workflow) => workflowOptionKey(workflow) === current)
          ? current
          : workflowKeyOrFallback('txt2img', nextWorkflows),
      )
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : '读取 ComfyUI 文生图工作流失败')
    } finally {
      setLoadingComfyuiTxt2imgWorkflows(false)
    }
  }

  function promptReferenceImages() {
    return referenceImages.map((image) => ({
      base64: image.base64,
      mime_type: image.mime_type,
    }))
  }

  async function generatePrompts() {
    setGeneratingPrompts(true)
    setError(null)
    if (usesPromptReference && referenceImages.length === 0) {
      setError('请先添加至少一张参考图')
      setGeneratingPrompts(false)
      return []
    }
    if (!selectedPromptSkill) {
      setError(`请先在后台配置${promptSkillLabel(promptSkillCategory)} Skill`)
      setGeneratingPrompts(false)
      return []
    }
    try {
      const nextDrafts = await window.api.generation.generatePrompts({
        capability,
        skillId: selectedPromptSkill.id,
        skillVersion: selectedPromptSkill.version,
        printMode,
        requirement,
        count: clampNumber(promptCount, 1, 1000, 5),
        model: llmModel,
        ...(capability === 'img2img' && activeImg2imgMode
          ? { modeInstruction: activeImg2imgMode.instruction }
          : {}),
        ...(usesPromptReference
          ? {
              referenceImages: promptReferenceImages(),
            }
          : {}),
      })
      setDrafts((current) => [...current, ...nextDrafts])
      setDraftsCollapsed(true)
      return nextDrafts
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : '生成提示词失败')
      return []
    } finally {
      setGeneratingPrompts(false)
    }
  }

  async function addReferenceFiles(files: FileList | null) {
    if (!files?.length) {
      return
    }

    const nextImages = await Promise.all(
      Array.from(files).map(async (file) => {
        const dataUrl = await readFileAsDataUrl(file)
        const { base64, mime_type } = splitDataUrl(dataUrl)
        return {
          id: crypto.randomUUID(),
          name: file.name,
          dataUrl,
          base64,
          mime_type,
        } satisfies ReferenceImageDraft
      }),
    )
    setReferenceImages((current) => [...current, ...nextImages])
  }

  function removeReferenceImage(id: string) {
    setReferenceImages((current) => current.filter((image) => image.id !== id))
  }

  async function parseManualText() {
    const prompts = await window.api.generation.parseManualPrompts(manualText)
    const nextDrafts = prompts.map((text) => ({
      id: crypto.randomUUID(),
      text,
      selected: true,
    }))
    setDrafts((current) => [...current, ...nextDrafts])
    setDraftsCollapsed(true)
    return nextDrafts
  }

  function updateDraft(id: string, patch: Partial<Txt2imgPromptDraft>) {
    setDrafts((current) =>
      current.map((draft) => (draft.id === id ? { ...draft, ...patch } : draft)),
    )
  }

  function addDraft() {
    setDraftsCollapsed(false)
    setDrafts((current) => [...current, { id: crypto.randomUUID(), text: '', selected: true }])
  }

  function clearDrafts() {
    setDrafts([])
    setDraftsCollapsed(true)
  }

  async function runGenerationWithPrompts(prompts: string[]) {
    if (prompts.length === 0) {
      setError('请先准备至少一条提示词')
      return
    }
    if (usesComfyuiTxt2img && !selectedComfyuiTxt2imgWorkflow) {
      setError('请选择 ComfyUI 文生图工作流')
      return
    }
    if (usesComfyuiTxt2img && !comfyuiInstanceSelection.runTarget) {
      setError('请选择运行中的云机')
      return
    }
    if (sendsReferenceToImageModel && referenceImages.length === 0) {
      setError('请先添加至少一张参考图')
      return
    }

    setResult(null)
    setPreviewImages([])
    setRunning(true)
    taskEvents.beginTask()
    try {
      let taskId: string
      if (usesComfyuiTxt2img) {
        if (!selectedComfyuiTxt2imgWorkflow) {
          throw new Error('请选择 ComfyUI 文生图工作流')
        }
        taskId = await window.api.generation.runComfyuiTxt2img({
          prompts,
          workflowId: selectedComfyuiTxt2imgWorkflow.id,
          workflowName: selectedComfyuiTxt2imgWorkflow.name,
          ...(taskName.trim() ? { taskId: taskName.trim() } : {}),
          ...(filenamePrefix.trim() ? { filenamePrefix: filenamePrefix.trim() } : {}),
          ...(filenamePrefix.trim() ? { filenameSeparator } : {}),
          ...(selectedComfyuiTxt2imgWorkflow.version
            ? { workflowVersion: selectedComfyuiTxt2imgWorkflow.version }
            : {}),
          width: clampNumber(comfyuiTxt2imgWidth, 256, 4096, 1024),
          height: clampNumber(comfyuiTxt2imgHeight, 256, 4096, 1024),
          concurrency: defaultConcurrency,
          ...(comfyuiInstanceSelection.runTarget ?? {}),
        })
      } else {
        taskId = await window.api.generation.runTxt2img({
          capability,
          prompts,
          model: generationModel,
          aspectRatio,
          ...(taskName.trim() ? { taskId: taskName.trim() } : {}),
          ...(filenamePrefix.trim() ? { filenamePrefix: filenamePrefix.trim() } : {}),
          ...(filenamePrefix.trim() ? { filenameSeparator } : {}),
          ...(sendsReferenceToImageModel
            ? {
                referenceImages: promptReferenceImages(),
              }
            : {}),
          concurrency: defaultConcurrency,
        })
      }
      if (!taskEvents.activateTask(taskId)) {
        setProgress({
          task_id: taskId,
          capability,
          processed: 0,
          total: prompts.length,
          succeeded: 0,
          failed: 0,
        })
      }
    } catch (nextError) {
      taskEvents.clearTaskStart()
      setRunning(false)
      setError(nextError instanceof Error ? nextError.message : '启动生图任务失败')
    }
  }

  async function startGeneration() {
    setError(null)
    const prompts = manualMode
      ? [...selectedPrompts, ...selectedPromptTexts(await parseManualText())]
      : selectedPrompts
    await runGenerationWithPrompts(prompts)
  }

  async function oneClickRun() {
    setError(null)
    if (manualMode) {
      const prompts = [...selectedPrompts, ...selectedPromptTexts(await parseManualText())]
      await runGenerationWithPrompts(prompts)
      return
    }

    const nextDrafts = await generatePrompts()
    if (nextDrafts.length === 0) {
      return
    }
    const prompts = [...selectedPrompts, ...selectedPromptTexts(nextDrafts)]
    await runGenerationWithPrompts(prompts)
  }

  return (
    <>
      <div
        className={`grid gap-5 xl:grid-cols-[minmax(0,1fr)_340px] ${
          capability === 'txt2img' ? '' : 'mt-5'
        }`}
      >
        <div className="space-y-5">
          <div className="rounded-md border bg-background p-4">
            <div className="flex gap-2">
              {capability === 'txt2img' ? (
                <>
                  <Button
                    onClick={() => setMode('ai')}
                    type="button"
                    variant={mode === 'ai' ? 'default' : 'secondary'}
                  >
                    智能生成提示词
                  </Button>
                  <Button
                    onClick={() => setMode('manual')}
                    type="button"
                    variant={mode === 'manual' ? 'default' : 'secondary'}
                  >
                    自己写提示词
                  </Button>
                </>
              ) : (
                img2imgModes.map((item) => (
                  <Button
                    key={item.key}
                    onClick={() => setImg2imgMode(item.key)}
                    type="button"
                    variant={img2imgMode === item.key ? 'default' : 'secondary'}
                  >
                    {item.label}
                  </Button>
                ))
              )}
            </div>

            {capability === 'img2img' ? (
              <div className="mt-4 rounded-md border p-3">
                <label className="block space-y-2 text-sm font-medium">
                  <span>参考图</span>
                  <input
                    accept="image/*"
                    className="block w-full text-sm"
                    multiple
                    onChange={(event) => void addReferenceFiles(event.target.files)}
                    type="file"
                  />
                </label>
                {referenceImages.length ? (
                  <div className="mt-3 grid grid-cols-4 gap-2">
                    {referenceImages.map((image) => (
                      <div
                        className="relative rounded-md border bg-muted p-2 text-xs"
                        key={image.id}
                      >
                        <button
                          aria-label={`删除参考图 ${image.name}`}
                          className="absolute right-3 top-3 inline-flex h-7 w-7 items-center justify-center rounded-sm border bg-background/90 text-muted-foreground shadow-sm hover:text-red-600"
                          onClick={() => removeReferenceImage(image.id)}
                          type="button"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                        <img
                          alt={image.name}
                          className="h-20 w-full rounded-sm object-cover"
                          src={image.dataUrl}
                        />
                        <div className="mt-1 truncate">{image.name}</div>
                      </div>
                    ))}
                  </div>
                ) : null}
              </div>
            ) : null}

            {aiMode ? (
              <div className="mt-4 grid gap-4">
                <div className="grid gap-4 md:grid-cols-3">
                  <fieldset className="rounded-md border p-3">
                    <legend className="px-1 text-sm font-medium">印花类型</legend>
                    <div className="mt-2 flex gap-4 text-sm">
                      <label className="inline-flex items-center gap-2">
                        <input
                          checked={printMode === 'local'}
                          onChange={() => setPrintMode('local')}
                          type="radio"
                        />
                        局部
                      </label>
                      <label className="inline-flex items-center gap-2">
                        <input
                          checked={printMode === 'full'}
                          onChange={() => setPrintMode('full')}
                          type="radio"
                        />
                        满印
                      </label>
                    </div>
                  </fieldset>
                  <label className="block space-y-2 text-sm font-medium">
                    <span>提示词数量</span>
                    <input
                      className="h-10 w-full rounded-md border px-3 text-sm tabular-nums outline-none focus-visible:ring-2 focus-visible:ring-primary"
                      max={1000}
                      min={1}
                      onChange={(event) => setPromptCount(event.target.value)}
                      type="number"
                      value={promptCount}
                    />
                  </label>
                  <label className="block space-y-2 text-sm font-medium">
                    <span>语言模型</span>
                    <select
                      className="h-10 w-full rounded-md border bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-primary"
                      onChange={(event) => setLlmModel(event.target.value)}
                      value={llmModel}
                    >
                      {llmModels.map((model) => (
                        <option key={model.id} value={model.id}>
                          {modelLabel(model)}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>

                <label className="block space-y-2 text-sm font-medium">
                  <span>{capability === 'img2img' ? '新图要求' : '印花要求'}</span>
                  <textarea
                    className="min-h-24 w-full resize-none rounded-md border px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-primary"
                    onChange={(event) => setRequirement(event.target.value)}
                    placeholder={
                      capability === 'img2img'
                        ? '生成新的复古花朵，不直接复制参考图主体'
                        : '圣诞风格小熊主题，复古海报感'
                    }
                    value={requirement}
                  />
                </label>

                <div className="grid gap-3 rounded-md border bg-muted/30 px-3 py-3 md:grid-cols-[minmax(0,1fr)_auto] md:items-end">
                  <PromptSkillPicker
                    category={promptSkillCategory}
                    onChange={promptSkillSelection.selectPromptSkill}
                    promptSkills={promptSkillSelection.promptSkills}
                    selectedSkill={selectedPromptSkill}
                    selectedSkillId={promptSkillSelection.selectedSkillId}
                  />
                  <Button
                    disabled={generatingPrompts || running || !selectedPromptSkill}
                    onClick={() => void generatePrompts()}
                    type="button"
                  >
                    {generatingPrompts ? (
                      <Loader2 className="mr-2 h-4 w-4" />
                    ) : (
                      <WandSparkles className="mr-2 h-4 w-4" />
                    )}
                    生成提示词
                  </Button>
                </div>
              </div>
            ) : (
              <div className="mt-4 space-y-3">
                <label className="block space-y-2 text-sm font-medium">
                  <span>提示词</span>
                  <textarea
                    className="min-h-40 w-full resize-none rounded-md border px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-primary"
                    onChange={(event) => setManualText(event.target.value)}
                    placeholder="每行一条，或粘贴 JSON 数组"
                    value={manualText}
                  />
                </label>
                <Button onClick={() => void parseManualText()} type="button" variant="secondary">
                  解析到审稿列表
                </Button>
              </div>
            )}
          </div>

          <div className="rounded-md border bg-background p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h4 className="font-semibold">提示词审稿</h4>
                <p className="mt-1 text-sm text-muted-foreground">
                  已选 {selectedPrompts.length} / 共 {drafts.length}
                </p>
              </div>
              <div className="flex flex-wrap justify-end gap-2">
                {drafts.length ? (
                  <>
                    <Button
                      className="h-9 px-3"
                      disabled={running || generatingPrompts}
                      onClick={clearDrafts}
                      type="button"
                      variant="secondary"
                    >
                      <Trash2 className="mr-2 h-4 w-4" />
                      清除当前提示词
                    </Button>
                    <Button
                      className="h-9 px-3"
                      onClick={() => setDraftsCollapsed((current) => !current)}
                      type="button"
                      variant="secondary"
                    >
                      {draftsCollapsed ? (
                        <ChevronDown className="mr-2 h-4 w-4" />
                      ) : (
                        <ChevronUp className="mr-2 h-4 w-4" />
                      )}
                      {draftsCollapsed ? '展开' : '收起'}
                    </Button>
                  </>
                ) : null}
                <Button className="h-9 px-3" onClick={addDraft} type="button" variant="secondary">
                  <Plus className="mr-2 h-4 w-4" />
                  添加自定义
                </Button>
              </div>
            </div>
            {!draftsCollapsed ? (
              <div className="mt-3 space-y-2">
                {drafts.length ? (
                  drafts.map((draft) => (
                    <div className="grid grid-cols-[24px_minmax(0,1fr)] gap-2" key={draft.id}>
                      <input
                        checked={draft.selected}
                        className="mt-3"
                        onChange={(event) =>
                          updateDraft(draft.id, { selected: event.target.checked })
                        }
                        type="checkbox"
                      />
                      <textarea
                        className="min-h-12 w-full resize-y rounded-md border px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-primary"
                        onChange={(event) => updateDraft(draft.id, { text: event.target.value })}
                        value={draft.text}
                      />
                    </div>
                  ))
                ) : (
                  <div className="rounded-md bg-muted px-3 py-6 text-center text-sm text-muted-foreground">
                    暂无提示词
                  </div>
                )}
              </div>
            ) : null}
            {draftsCollapsed && drafts.length === 0 ? (
              <div className="mt-3">
                <div className="rounded-md bg-muted px-3 py-6 text-center text-sm text-muted-foreground">
                  暂无提示词
                </div>
              </div>
            ) : null}
          </div>
        </div>

        <aside className="space-y-5">
          <div className="rounded-md border bg-background p-4">
            <h4 className="font-semibold">生图设置</h4>
            {settingsError ? (
              <div className="mt-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                {settingsError}
              </div>
            ) : null}
            <div className="mt-4 grid gap-3">
              {capability === 'txt2img' ? (
                <div className="grid grid-cols-2 gap-2 rounded-md bg-muted p-1">
                  <Button
                    className="h-9"
                    onClick={() => setTxt2imgGenerationPath('grsai')}
                    type="button"
                    variant={txt2imgGenerationPath === 'grsai' ? 'default' : 'secondary'}
                  >
                    Grsai
                  </Button>
                  <Button
                    className="h-9"
                    onClick={() => setTxt2imgGenerationPath('comfyui')}
                    type="button"
                    variant={txt2imgGenerationPath === 'comfyui' ? 'default' : 'secondary'}
                  >
                    ComfyUI 工作流
                  </Button>
                </div>
              ) : null}

              {!usesComfyuiTxt2img ? (
                <>
                  <label className="block space-y-2 text-sm font-medium">
                    <span>生图模型</span>
                    <select
                      className="h-10 w-full rounded-md border bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-primary"
                      onChange={(event) => setGenerationModel(event.target.value)}
                      value={generationModel}
                    >
                      {generationModels.map((model) => (
                        <option key={model.id} value={model.id}>
                          {modelLabel(model)}
                        </option>
                      ))}
                    </select>
                  </label>
                  <div className="grid gap-3">
                    <label className="block space-y-2 text-sm font-medium">
                      <span>尺寸</span>
                      <select
                        className="h-10 w-full rounded-md border bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-primary"
                        onChange={(event) => setAspectRatio(event.target.value)}
                        value={aspectRatio}
                      >
                        {sizeOptions.map((size) => (
                          <option key={size} value={size}>
                            {size}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>
                </>
              ) : (
                <>
                  <label className="block space-y-2 text-sm font-medium">
                    <span>文生图工作流</span>
                    <select
                      className="h-10 w-full rounded-md border bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-primary"
                      onChange={(event) => {
                        rememberWorkflowKey('txt2img', event.target.value)
                        setComfyuiTxt2imgWorkflowKey(event.target.value)
                      }}
                      value={comfyuiTxt2imgWorkflowKey}
                    >
                      {!comfyuiTxt2imgWorkflows.length ? (
                        <option value="">暂无可用工作流</option>
                      ) : null}
                      {comfyuiTxt2imgWorkflows.map((workflow) => (
                        <option
                          key={workflowOptionKey(workflow)}
                          value={workflowOptionKey(workflow)}
                        >
                          {workflow.name} · {workflow.version}
                        </option>
                      ))}
                    </select>
                  </label>
                  <Button
                    disabled={loadingComfyuiTxt2imgWorkflows}
                    onClick={() => void loadComfyuiTxt2imgWorkflows()}
                    type="button"
                    variant="secondary"
                  >
                    {loadingComfyuiTxt2imgWorkflows ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : (
                      <RefreshCw className="mr-2 h-4 w-4" />
                    )}
                    刷新工作流
                  </Button>
                  <div className="grid grid-cols-2 gap-3">
                    <label className="block space-y-2 text-sm font-medium">
                      <span>宽度</span>
                      <input
                        className="h-10 w-full rounded-md border px-3 text-sm tabular-nums outline-none focus-visible:ring-2 focus-visible:ring-primary"
                        max={4096}
                        min={256}
                        onChange={(event) => setComfyuiTxt2imgWidth(event.target.value)}
                        type="number"
                        value={comfyuiTxt2imgWidth}
                      />
                    </label>
                    <label className="block space-y-2 text-sm font-medium">
                      <span>高度</span>
                      <input
                        className="h-10 w-full rounded-md border px-3 text-sm tabular-nums outline-none focus-visible:ring-2 focus-visible:ring-primary"
                        max={4096}
                        min={256}
                        onChange={(event) => setComfyuiTxt2imgHeight(event.target.value)}
                        type="number"
                        value={comfyuiTxt2imgHeight}
                      />
                    </label>
                  </div>
                </>
              )}
              {capability === 'img2img' ? (
                <label className="inline-flex items-center gap-2 text-sm font-medium">
                  <input
                    checked={sendReferenceToImageModel}
                    onChange={(event) => setSendReferenceToImageModel(event.target.checked)}
                    type="checkbox"
                  />
                  生图时带参考图
                </label>
              ) : null}
              <TaskNameField
                onChange={setTaskName}
                placeholder={`默认：${capability === 'txt2img' ? '文生图' : '图生图'}-时间`}
                value={taskName}
              />
              <VisibleFilenameFields
                onPrefixChange={setFilenamePrefix}
                onSeparatorChange={setFilenameSeparator}
                prefix={filenamePrefix}
                separator={filenameSeparator}
              />
              <Button
                disabled={
                  running ||
                  generatingPrompts ||
                  (aiMode && !selectedPromptSkill) ||
                  (usesComfyuiTxt2img && !comfyuiInstanceSelection.runTarget)
                }
                onClick={() => void oneClickRun()}
                type="button"
              >
                {running || generatingPrompts ? (
                  <Loader2 className="mr-2 h-4 w-4" />
                ) : (
                  <WandSparkles className="mr-2 h-4 w-4" />
                )}
                一键运行
              </Button>
              <Button
                disabled={
                  running ||
                  generatingPrompts ||
                  (usesComfyuiTxt2img && !comfyuiInstanceSelection.runTarget)
                }
                onClick={() => void startGeneration()}
                type="button"
                variant="secondary"
              >
                {running ? <Loader2 className="mr-2 h-4 w-4" /> : <Play className="mr-2 h-4 w-4" />}
                开始生图
              </Button>
              <GenerationCancelButton
                onCancel={() => void taskEvents.cancelTask()}
                running={running}
              />
            </div>
          </div>

          {usesComfyuiTxt2img ? (
            <>
              <ComfyuiInstanceSelectorCard selection={comfyuiInstanceSelection} />
              <GenerationFeedback error={error} result={result} />
            </>
          ) : (
            <div className="rounded-md border bg-background p-4">
              <div className="flex items-center justify-between">
                <h4 className="font-semibold">进度</h4>
                <span className="text-sm tabular-nums text-muted-foreground">{percent}%</span>
              </div>
              <div className="mt-4 h-2 rounded-full bg-muted">
                <div className="h-2 rounded-full bg-primary" style={{ width: `${percent}%` }} />
              </div>
              <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
                <div>
                  <dt className="text-muted-foreground">处理</dt>
                  <dd className="font-medium tabular-nums">
                    {progress ? `${progress.processed}/${progress.total}` : '0/0'}
                  </dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">成功</dt>
                  <dd className="font-medium tabular-nums">{progress?.succeeded ?? 0}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">失败</dt>
                  <dd className="font-medium tabular-nums">{progress?.failed ?? 0}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">已选提示词</dt>
                  <dd className="font-medium tabular-nums">{selectedPrompts.length}</dd>
                </div>
              </dl>
              {error ? (
                <div className="mt-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
                  {error}
                </div>
              ) : null}
              {result ? (
                <div className="mt-3 rounded-md bg-muted px-3 py-2 text-sm">
                  {result.cancelled ? '已取消' : '完成'}：成功 {result.succeeded}，失败{' '}
                  {result.failed}
                  {result.diagnosticsLogPath ? (
                    <p className="mt-2 break-all font-mono text-xs text-muted-foreground">
                      诊断日志：{result.diagnosticsLogPath}
                    </p>
                  ) : null}
                </div>
              ) : null}
            </div>
          )}
        </aside>
      </div>
      <CurrentTaskImagePreview images={previewImages} />
    </>
  )
}

function GrsaiExtractPanel() {
  const { settings, error: settingsError } = useGenerationLocalSettings()
  const [sources, setSources] = useState<GenerationImageSource[]>([])
  const [sourceFolder, setSourceFolder] = useState('')
  const [generationModel, setGenerationModel] = useState('gpt-image-2')
  const [aspectRatio, setAspectRatio] = useState('1024x1024')
  const [taskName, setTaskName] = useState('')
  const [filenamePrefix, setFilenamePrefix] = useState('')
  const [filenameSeparator, setFilenameSeparator] = useState('-')
  const [progress, setProgress] = useState<GenerationProgress | null>(null)
  const [previewImages, setPreviewImages] = useState<GenerationRunImage[]>([])
  const [result, setResult] = useState<GenerationRunResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loadingSources, setLoadingSources] = useState(false)
  const [running, setRunning] = useState(false)
  const { extractSkills, selectedSkill, selectedSkillKey, setSelectedSkillKey } =
    useExtractSkillOptions(setError)
  const taskEvents = useGenerationTaskEvents({
    expectedCapability: 'extract',
    setProgress,
    setPreviewImages,
    setResult,
    setError,
    setRunning,
  })

  const selectedCount = sources.length
  const percent = progressPercent(progress)
  const generationModels = useMemo(() => modelOptionsForCapability(settings, 'extract'), [settings])
  const selectedGenerationModel = useMemo(
    () => generationModels.find((model) => model.id === generationModel) ?? null,
    [generationModel, generationModels],
  )
  const sizeOptions = grsaiSizes(selectedGenerationModel)
  const defaultConcurrency = settings?.config.default_concurrency ?? 20

  useEffect(() => {
    const firstModel = generationModels[0]
    if (firstModel && !generationModels.some((model) => model.id === generationModel)) {
      setGenerationModel(firstModel.id)
    }
  }, [generationModel, generationModels])

  useEffect(() => {
    if (!sizeOptions.includes(aspectRatio)) {
      setAspectRatio(sizeOptions[0] ?? '1024x1024')
    }
  }, [aspectRatio, sizeOptions])

  async function chooseSourceFolder() {
    setError(null)
    const result = await window.api.generation.chooseImageFolder()
    if (!result.ok) {
      if (result.error.code !== 'CANCELLED') {
        setError(result.error.message)
      }
      return
    }
    setSourceFolder(result.data.path)
    setSources([])
  }

  async function scanSourceFolder() {
    if (!sourceFolder) {
      setError('请先选择图片文件夹')
      return
    }
    setLoadingSources(true)
    setError(null)
    try {
      const images = await window.api.generation.scanImageFolder({ folder: sourceFolder })
      setSources(images)
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : '检索图片失败')
    } finally {
      setLoadingSources(false)
    }
  }

  async function startExtract() {
    setError(null)
    if (!selectedSkill) {
      setError('请先在后台配置提取 Skill')
      return
    }
    if (sources.length === 0) {
      setError('请先检索图片文件夹')
      return
    }

    setResult(null)
    setPreviewImages([])
    setRunning(true)
    taskEvents.beginTask()
    try {
      const taskId = await window.api.generation.runExtract({
        sourceImagePaths: sources.map((source) => source.path),
        skillId: selectedSkill.id,
        skillVersion: selectedSkill.version,
        variables: {},
        model: generationModel,
        aspectRatio,
        concurrency: defaultConcurrency,
        ...(taskName.trim() ? { taskId: taskName.trim() } : {}),
        ...(filenamePrefix.trim() ? { filenamePrefix: filenamePrefix.trim() } : {}),
        ...(filenamePrefix.trim() ? { filenameSeparator } : {}),
      })
      if (!taskEvents.activateTask(taskId)) {
        setProgress({
          task_id: taskId,
          capability: 'extract',
          processed: 0,
          total: sources.length,
          succeeded: 0,
          failed: 0,
        })
      }
    } catch (nextError) {
      taskEvents.clearTaskStart()
      setRunning(false)
      setError(nextError instanceof Error ? nextError.message : '启动 Grsai 提取失败')
    }
  }

  return (
    <>
      <div className="mt-5 grid gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
        <div className="space-y-5">
          <ImageFolderPickerPanel
            emptyText="暂无可用于提取的图片"
            folderPath={sourceFolder}
            images={sources}
            loading={loadingSources}
            onChoose={() => void chooseSourceFolder()}
            onScan={() => void scanSourceFolder()}
            title="提取图片文件夹"
          />

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
            <h4 className="font-semibold">执行设置</h4>
            {settingsError ? (
              <div className="mt-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                {settingsError}
              </div>
            ) : null}
            <div className="mt-4 grid gap-3">
              <label className="block space-y-2 text-sm font-medium">
                <span>Grsai 模型</span>
                <select
                  className="h-10 w-full rounded-md border bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-primary"
                  onChange={(event) => setGenerationModel(event.target.value)}
                  value={generationModel}
                >
                  {generationModels.map((model) => (
                    <option key={model.id} value={model.id}>
                      {modelLabel(model)}
                    </option>
                  ))}
                </select>
              </label>
              <div className="grid gap-3">
                <label className="block space-y-2 text-sm font-medium">
                  <span>尺寸</span>
                  <select
                    className="h-10 w-full rounded-md border bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-primary"
                    onChange={(event) => setAspectRatio(event.target.value)}
                    value={aspectRatio}
                  >
                    {sizeOptions.map((size) => (
                      <option key={size} value={size}>
                        {size}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <TaskNameField
                onChange={setTaskName}
                placeholder="默认：提取-时间"
                value={taskName}
              />
              <VisibleFilenameFields
                onPrefixChange={setFilenamePrefix}
                onSeparatorChange={setFilenameSeparator}
                prefix={filenamePrefix}
                separator={filenameSeparator}
              />
              <Button disabled={running} onClick={() => void startExtract()} type="button">
                {running ? <Loader2 className="mr-2 h-4 w-4" /> : <Play className="mr-2 h-4 w-4" />}
                开始提取
              </Button>
              <GenerationCancelButton
                onCancel={() => void taskEvents.cancelTask()}
                running={running}
              />
            </div>
          </div>

          <div className="rounded-md border bg-background p-4">
            <div className="flex items-center justify-between">
              <h4 className="font-semibold">进度</h4>
              <span className="text-sm tabular-nums text-muted-foreground">{percent}%</span>
            </div>
            <div className="mt-4 h-2 rounded-full bg-muted">
              <div className="h-2 rounded-full bg-primary" style={{ width: `${percent}%` }} />
            </div>
            <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
              <div>
                <dt className="text-muted-foreground">源图</dt>
                <dd className="font-medium tabular-nums">{selectedCount}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">处理</dt>
                <dd className="font-medium tabular-nums">
                  {progress ? `${progress.processed}/${progress.total}` : '0/0'}
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground">成功</dt>
                <dd className="font-medium tabular-nums">{progress?.succeeded ?? 0}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">失败</dt>
                <dd className="font-medium tabular-nums">{progress?.failed ?? 0}</dd>
              </div>
            </dl>
            {error ? (
              <div className="mt-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
                {error}
              </div>
            ) : null}
            {result ? (
              <div className="mt-3 rounded-md bg-muted px-3 py-2 text-sm">
                {result.cancelled ? '已取消' : '完成'}：成功 {result.succeeded}，失败{' '}
                {result.failed}
                {result.diagnosticsLogPath ? (
                  <p className="mt-2 break-all font-mono text-xs text-muted-foreground">
                    诊断日志：{result.diagnosticsLogPath}
                  </p>
                ) : null}
              </div>
            ) : null}
          </div>
        </aside>
      </div>
      <CurrentTaskImagePreview images={previewImages} />
    </>
  )
}

function ComfyuiImg2imgPanel() {
  const { settings, error: settingsError } = useGenerationLocalSettings()
  const workflowsVersion = useGenerationStore((state) => state.workflowsVersion)
  const workflowScope = 'img2img'
  const comfyuiInstanceSelection = useComfyuiInstanceSelection(workflowScope)
  const [sourceFolder, setSourceFolder] = useState('')
  const [sourceImages, setSourceImages] = useState<GenerationImageSource[]>([])
  const [workflows, setWorkflows] = useState<ComfyuiWorkflowSummary[]>([])
  const [workflowKey, setWorkflowKey] = useState('')
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
  const [, setProgress] = useState<GenerationProgress | null>(null)
  const [previewImages, setPreviewImages] = useState<GenerationRunImage[]>([])
  const [result, setResult] = useState<GenerationRunResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loadingSources, setLoadingSources] = useState(false)
  const [running, setRunning] = useState(false)
  const taskEvents = useGenerationTaskEvents({
    expectedCapability: 'img2img',
    setProgress,
    setPreviewImages,
    setResult,
    setError,
    setRunning,
  })

  const promptSkillCategory = promptSkillCategoryFor('img2img', printMode)
  const promptSkillSelection = usePromptSkillOptions(promptSkillCategory, setError)
  const selectedReferenceMode =
    img2imgModes.find((item) => item.key === referenceMode) ?? img2imgModes[0]
  const promptModelOptions = useMemo(() => bailianModelsForUse(settings, true), [settings])

  useEffect(() => {
    if (settingsError) {
      setError(settingsError)
    }
  }, [settingsError])

  useEffect(() => {
    const preferred = settings?.config.bailian_vision_model
    const firstModel =
      promptModelOptions.find((model) => model.id === preferred) ?? promptModelOptions[0]
    if (firstModel && !promptModelOptions.some((model) => model.id === promptModel)) {
      setPromptModel(firstModel.id)
    }
  }, [promptModel, promptModelOptions, settings])

  useEffect(() => {
    void workflowsVersion
    void loadWorkflows()
  }, [workflowsVersion])

  const selectedWorkflow = workflows.find((workflow) => workflowOptionKey(workflow) === workflowKey)
  const outputCount = clampNumber(batchSize, 1, 8, 1)
  const expectedOutputCount = sourceImages.length * outputCount

  async function chooseSourceFolder() {
    setError(null)
    const result = await window.api.generation.chooseImageFolder()
    if (!result.ok) {
      if (result.error.code !== 'CANCELLED') {
        setError(result.error.message)
      }
      return
    }
    setSourceFolder(result.data.path)
    setSourceImages([])
  }

  async function loadWorkflows() {
    try {
      const nextWorkflows = await window.api.generation.listComfyuiImg2imgWorkflows()
      setWorkflows(nextWorkflows)
      setWorkflowKey((current) =>
        current && nextWorkflows.some((workflow) => workflowOptionKey(workflow) === current)
          ? current
          : workflowKeyOrFallback(workflowScope, nextWorkflows),
      )
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : '读取 ComfyUI 工作流失败')
    }
  }

  async function scanSourceFolder() {
    if (!sourceFolder) {
      setError('请先选择图片文件夹')
      return
    }
    setLoadingSources(true)
    setError(null)
    try {
      const images = await window.api.generation.scanImageFolder({ folder: sourceFolder })
      setSourceImages(images)
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : '检索图片失败')
    } finally {
      setLoadingSources(false)
    }
  }

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

    setResult(null)
    setPreviewImages([])
    setRunning(true)
    taskEvents.beginTask()
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
      taskEvents.clearTaskStart()
      setRunning(false)
      setError(nextError instanceof Error ? nextError.message : '启动 ComfyUI 图生图失败')
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
              <label className="block space-y-2 text-sm font-medium">
                <span>工作流</span>
                <select
                  className="h-10 w-full rounded-md border bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-primary"
                  onChange={(event) => {
                    rememberWorkflowKey(workflowScope, event.target.value)
                    setWorkflowKey(event.target.value)
                  }}
                  value={workflowKey}
                >
                  {workflows.map((workflow) => (
                    <option key={workflowOptionKey(workflow)} value={workflowOptionKey(workflow)}>
                      {workflow.name} · {workflow.version}
                    </option>
                  ))}
                </select>
              </label>
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
              <fieldset className="rounded-md border p-3 md:col-span-2">
                <legend className="px-1 text-sm font-medium">提示词来源</legend>
                <div className="mt-2 flex flex-wrap gap-4 text-sm">
                  <label className="inline-flex items-center gap-2">
                    <input
                      checked={promptMode === 'ai'}
                      onChange={() => setPromptMode('ai')}
                      type="radio"
                    />
                    AI 看图写提示词（推荐）
                  </label>
                  <label className="inline-flex items-center gap-2">
                    <input
                      checked={promptMode === 'workflow'}
                      onChange={() => setPromptMode('workflow')}
                      type="radio"
                    />
                    工作流默认
                  </label>
                  <label className="inline-flex items-center gap-2">
                    <input
                      checked={promptMode === 'manual'}
                      onChange={() => setPromptMode('manual')}
                      type="radio"
                    />
                    手动填写
                  </label>
                </div>
                {promptMode === 'ai' ? (
                  <div className="mt-3 grid gap-4 md:grid-cols-2">
                    <label className="block space-y-2 text-sm font-medium">
                      <span>印花模式</span>
                      <select
                        className="h-10 w-full rounded-md border bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-primary"
                        onChange={(event) => setPrintMode(event.target.value as 'local' | 'full')}
                        value={printMode}
                      >
                        <option value="local">局部</option>
                        <option value="full">满印</option>
                      </select>
                    </label>
                    <label className="block space-y-2 text-sm font-medium">
                      <span>参考方式</span>
                      <select
                        className="h-10 w-full rounded-md border bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-primary"
                        onChange={(event) =>
                          setReferenceMode(event.target.value as Exclude<Img2imgMode, 'manual'>)
                        }
                        value={referenceMode}
                      >
                        {img2imgModes
                          .filter((item) => item.key !== 'manual')
                          .map((item) => (
                            <option key={item.key} value={item.key}>
                              {item.label}
                            </option>
                          ))}
                      </select>
                    </label>
                    <PromptSkillPicker
                      category={promptSkillCategory}
                      onChange={promptSkillSelection.selectPromptSkill}
                      promptSkills={promptSkillSelection.promptSkills}
                      selectedSkill={promptSkillSelection.selectedSkill}
                      selectedSkillId={promptSkillSelection.selectedSkillId}
                    />
                    <label className="block space-y-2 text-sm font-medium">
                      <span>提示词模型</span>
                      <select
                        className="h-10 w-full rounded-md border bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-primary"
                        onChange={(event) => setPromptModel(event.target.value)}
                        value={promptModel}
                      >
                        {promptModelOptions.map((model) => (
                          <option key={model.id} value={model.id}>
                            {modelLabel(model)}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="block space-y-2 text-sm font-medium md:col-span-2">
                      <span>其他要求</span>
                      <textarea
                        className="min-h-24 w-full resize-none rounded-md border px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-primary"
                        onChange={(event) => setRequirement(event.target.value)}
                        placeholder="例如：改成复古花卉徽章，干净白底，适合印花"
                        value={requirement}
                      />
                    </label>
                  </div>
                ) : null}
                {promptMode === 'manual' ? (
                  <label className="mt-3 block space-y-2 text-sm font-medium">
                    <span>图生图提示词</span>
                    <textarea
                      className="min-h-28 w-full resize-none rounded-md border px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-primary"
                      onChange={(event) => setPrompt(event.target.value)}
                      placeholder="例如：保留主体轮廓，改成复古花卉徽章，干净白底，适合印花"
                      value={prompt}
                    />
                  </label>
                ) : null}
              </fieldset>
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

function ComfyuiExtractPanel() {
  const workflowsVersion = useGenerationStore((state) => state.workflowsVersion)
  const workflowScope = 'extract'
  const comfyuiInstanceSelection = useComfyuiInstanceSelection(workflowScope)
  const [sources, setSources] = useState<GenerationImageSource[]>([])
  const [sourceFolder, setSourceFolder] = useState('')
  const [workflows, setWorkflows] = useState<ComfyuiWorkflowSummary[]>([])
  const [workflowKey, setWorkflowKey] = useState('')
  const [width, setWidth] = useState('1024')
  const [height, setHeight] = useState('1024')
  const [taskName, setTaskName] = useState('')
  const [filenamePrefix, setFilenamePrefix] = useState('')
  const [filenameSeparator, setFilenameSeparator] = useState('-')
  const [, setProgress] = useState<GenerationProgress | null>(null)
  const [previewImages, setPreviewImages] = useState<GenerationRunImage[]>([])
  const [result, setResult] = useState<GenerationRunResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loadingSources, setLoadingSources] = useState(false)
  const [running, setRunning] = useState(false)
  const { extractSkills, selectedSkill, selectedSkillKey, setSelectedSkillKey } =
    useExtractSkillOptions(setError)
  const taskEvents = useGenerationTaskEvents({
    expectedCapability: 'extract',
    setProgress,
    setPreviewImages,
    setResult,
    setError,
    setRunning,
  })

  useEffect(() => {
    void workflowsVersion
    void loadWorkflows()
  }, [workflowsVersion])

  const selectedWorkflow = workflows.find((workflow) => workflowOptionKey(workflow) === workflowKey)

  async function chooseSourceFolder() {
    setError(null)
    const result = await window.api.generation.chooseImageFolder()
    if (!result.ok) {
      if (result.error.code !== 'CANCELLED') {
        setError(result.error.message)
      }
      return
    }
    setSourceFolder(result.data.path)
    setSources([])
  }

  async function loadWorkflows() {
    try {
      const nextWorkflows = await window.api.generation.listComfyuiExtractWorkflows()
      setWorkflows(nextWorkflows)
      setWorkflowKey((current) =>
        current && nextWorkflows.some((workflow) => workflowOptionKey(workflow) === current)
          ? current
          : workflowKeyOrFallback(workflowScope, nextWorkflows),
      )
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : '读取 ComfyUI 提取工作流失败')
    }
  }

  async function scanSourceFolder() {
    if (!sourceFolder) {
      setError('请先选择图片文件夹')
      return
    }
    setLoadingSources(true)
    setError(null)
    try {
      const images = await window.api.generation.scanImageFolder({ folder: sourceFolder })
      setSources(images)
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : '检索图片失败')
    } finally {
      setLoadingSources(false)
    }
  }

  async function startExtract() {
    setError(null)
    if (sources.length === 0) {
      setError('请先检索图片文件夹')
      return
    }
    if (!selectedWorkflow) {
      setError('请选择 ComfyUI 提取工作流')
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

    setResult(null)
    setPreviewImages([])
    setRunning(true)
    taskEvents.beginTask()
    try {
      const taskId = await window.api.generation.runComfyuiExtract({
        sourceImagePaths: sources.map((source) => source.path),
        workflowId: selectedWorkflow.id,
        workflowName: selectedWorkflow.name,
        workflowVersion: selectedWorkflow.version,
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
          capability: 'extract',
          processed: 0,
          total: sources.length,
          succeeded: 0,
          failed: 0,
          images: [],
        })
      }
    } catch (nextError) {
      taskEvents.clearTaskStart()
      setRunning(false)
      setError(nextError instanceof Error ? nextError.message : '启动 ComfyUI 提取失败')
    }
  }

  return (
    <>
      <div className="mt-5 grid gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
        <div className="space-y-5">
          <ImageFolderPickerPanel
            emptyText="暂无可用于提取的图片"
            folderPath={sourceFolder}
            images={sources}
            loading={loadingSources}
            onChoose={() => void chooseSourceFolder()}
            onScan={() => void scanSourceFolder()}
            title="提取图片文件夹"
          />

          <div className="rounded-md border bg-background p-4">
            <h4 className="font-semibold">ComfyUI 提取工作流</h4>
            <div className="mt-4 grid gap-4 md:grid-cols-2">
              <label className="block space-y-2 text-sm font-medium">
                <span>工作流</span>
                <select
                  className="h-10 w-full rounded-md border bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-primary"
                  onChange={(event) => {
                    rememberWorkflowKey(workflowScope, event.target.value)
                    setWorkflowKey(event.target.value)
                  }}
                  value={workflowKey}
                >
                  {workflows.map((workflow) => (
                    <option key={workflowOptionKey(workflow)} value={workflowOptionKey(workflow)}>
                      {workflow.name} · {workflow.version}
                    </option>
                  ))}
                </select>
              </label>
              <div className="md:col-span-2">
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
                <dt className="text-muted-foreground">工作流</dt>
                <dd className="truncate font-medium">{selectedWorkflow?.name ?? '未选择'}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Skill</dt>
                <dd className="truncate font-medium">{selectedSkill?.id ?? '未配置'}</dd>
              </div>
            </dl>
            <div className="mt-4">
              <TaskNameField
                onChange={setTaskName}
                placeholder="默认：提取-时间"
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
              onClick={() => void startExtract()}
              type="button"
            >
              {running ? <Loader2 className="mr-2 h-4 w-4" /> : <Play className="mr-2 h-4 w-4" />}
              开始提取
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

function ComfyuiExtractMattingPanel() {
  const workflowsVersion = useGenerationStore((state) => state.workflowsVersion)
  const extractWorkflowScope = 'extract-matting:extract'
  const mattingWorkflowScope = 'extract-matting:matting'
  const comfyuiInstanceSelection = useComfyuiInstanceSelection('extract-matting')
  const [sources, setSources] = useState<GenerationImageSource[]>([])
  const [sourceFolder, setSourceFolder] = useState('')
  const [extractWorkflows, setExtractWorkflows] = useState<ComfyuiWorkflowSummary[]>([])
  const [extractWorkflowKey, setExtractWorkflowKey] = useState('')
  const [mattingWorkflows, setMattingWorkflows] = useState<ComfyuiWorkflowSummary[]>([])
  const [mattingWorkflowKey, setMattingWorkflowKey] = useState('')
  const [width, setWidth] = useState('1024')
  const [height, setHeight] = useState('1024')
  const [taskName, setTaskName] = useState('')
  const [filenamePrefix, setFilenamePrefix] = useState('')
  const [filenameSeparator, setFilenameSeparator] = useState('-')
  const [, setProgress] = useState<GenerationProgress | null>(null)
  const [previewImages, setPreviewImages] = useState<GenerationRunImage[]>([])
  const [result, setResult] = useState<GenerationRunResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loadingSources, setLoadingSources] = useState(false)
  const [running, setRunning] = useState(false)
  const { extractSkills, selectedSkill, selectedSkillKey, setSelectedSkillKey } =
    useExtractSkillOptions(setError)
  const taskEvents = useGenerationTaskEvents({
    expectedCapability: 'matting',
    setProgress,
    setPreviewImages,
    setResult,
    setError,
    setRunning,
  })

  useEffect(() => {
    void workflowsVersion
    void loadWorkflows()
  }, [workflowsVersion])

  const selectedExtractWorkflow = extractWorkflows.find(
    (workflow) => workflowOptionKey(workflow) === extractWorkflowKey,
  )
  const selectedMattingWorkflow = mattingWorkflows.find(
    (workflow) => workflowOptionKey(workflow) === mattingWorkflowKey,
  )

  async function chooseSourceFolder() {
    setError(null)
    const result = await window.api.generation.chooseImageFolder()
    if (!result.ok) {
      if (result.error.code !== 'CANCELLED') {
        setError(result.error.message)
      }
      return
    }
    setSourceFolder(result.data.path)
    setSources([])
  }

  async function loadWorkflows() {
    try {
      const [nextExtractWorkflows, nextMattingWorkflows] = await Promise.all([
        window.api.generation.listComfyuiExtractWorkflows(),
        window.api.generation.listComfyuiMattingWorkflows(),
      ])
      setExtractWorkflows(nextExtractWorkflows)
      setMattingWorkflows(nextMattingWorkflows)
      setExtractWorkflowKey((current) =>
        current && nextExtractWorkflows.some((workflow) => workflowOptionKey(workflow) === current)
          ? current
          : workflowKeyOrFallback(extractWorkflowScope, nextExtractWorkflows),
      )
      setMattingWorkflowKey((current) =>
        current && nextMattingWorkflows.some((workflow) => workflowOptionKey(workflow) === current)
          ? current
          : workflowKeyOrFallback(mattingWorkflowScope, nextMattingWorkflows),
      )
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : '读取 ComfyUI 工作流失败')
    }
  }

  async function scanSourceFolder() {
    if (!sourceFolder) {
      setError('请先选择图片文件夹')
      return
    }
    setLoadingSources(true)
    setError(null)
    try {
      const images = await window.api.generation.scanImageFolder({ folder: sourceFolder })
      setSources(images)
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : '检索图片失败')
    } finally {
      setLoadingSources(false)
    }
  }

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

    setResult(null)
    setPreviewImages([])
    setRunning(true)
    taskEvents.beginTask()
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
      taskEvents.clearTaskStart()
      setRunning(false)
      setError(nextError instanceof Error ? nextError.message : '启动提取后抠图失败')
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
              <label className="block space-y-2 text-sm font-medium">
                <span>提取工作流</span>
                <select
                  className="h-10 w-full rounded-md border bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-primary"
                  onChange={(event) => {
                    rememberWorkflowKey(extractWorkflowScope, event.target.value)
                    setExtractWorkflowKey(event.target.value)
                  }}
                  value={extractWorkflowKey}
                >
                  {extractWorkflows.map((workflow) => (
                    <option key={workflowOptionKey(workflow)} value={workflowOptionKey(workflow)}>
                      {workflow.name} · {workflow.version}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block space-y-2 text-sm font-medium">
                <span>抠图工作流</span>
                <select
                  className="h-10 w-full rounded-md border bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-primary"
                  onChange={(event) => {
                    rememberWorkflowKey(mattingWorkflowScope, event.target.value)
                    setMattingWorkflowKey(event.target.value)
                  }}
                  value={mattingWorkflowKey}
                >
                  {mattingWorkflows.map((workflow) => (
                    <option key={workflowOptionKey(workflow)} value={workflowOptionKey(workflow)}>
                      {workflow.name} · {workflow.version}
                    </option>
                  ))}
                </select>
              </label>
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

function ComfyuiMattingPanel() {
  const workflowsVersion = useGenerationStore((state) => state.workflowsVersion)
  const workflowScope = 'matting'
  const mixedWorkflowScope = 'matting-mixed'
  const comfyuiInstanceSelection = useComfyuiInstanceSelection(workflowScope)
  const [mode, setMode] = useState<MattingMode>('comfyui')
  const [sourceFolder, setSourceFolder] = useState('')
  const [sources, setSources] = useState<GenerationImageSource[]>([])
  const [workflows, setWorkflows] = useState<ComfyuiWorkflowSummary[]>([])
  const [workflowKey, setWorkflowKey] = useState('')
  const [mixedWorkflows, setMixedWorkflows] = useState<ComfyuiWorkflowSummary[]>([])
  const [mixedWorkflowKey, setMixedWorkflowKey] = useState('')
  const [taskName, setTaskName] = useState('')
  const [filenamePrefix, setFilenamePrefix] = useState('')
  const [filenameSeparator, setFilenameSeparator] = useState('-')
  const [, setProgress] = useState<GenerationProgress | null>(null)
  const [previewImages, setPreviewImages] = useState<GenerationRunImage[]>([])
  const [result, setResult] = useState<GenerationRunResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loadingSources, setLoadingSources] = useState(false)
  const [running, setRunning] = useState(false)
  const taskEvents = useGenerationTaskEvents({
    expectedCapability: 'matting',
    setProgress,
    setPreviewImages,
    setResult,
    setError,
    setRunning,
  })

  useEffect(() => {
    void workflowsVersion
    void loadWorkflows()
  }, [workflowsVersion])

  const activeWorkflows = mode === 'mixed' ? mixedWorkflows : workflows
  const activeWorkflowKey = mode === 'mixed' ? mixedWorkflowKey : workflowKey
  const selectedWorkflow = activeWorkflows.find(
    (workflow) => workflowOptionKey(workflow) === activeWorkflowKey,
  )

  async function chooseSourceFolder() {
    setError(null)
    const result = await window.api.generation.chooseImageFolder()
    if (!result.ok) {
      if (result.error.code !== 'CANCELLED') {
        setError(result.error.message)
      }
      return
    }
    setSourceFolder(result.data.path)
    setSources([])
  }

  async function loadWorkflows() {
    try {
      const [nextWorkflows, nextMixedWorkflows] = await Promise.all([
        window.api.generation.listComfyuiMattingWorkflows(),
        window.api.generation.listComfyuiMixedMattingWorkflows(),
      ])
      setWorkflows(nextWorkflows)
      setMixedWorkflows(nextMixedWorkflows)
      setWorkflowKey((current) =>
        current && nextWorkflows.some((workflow) => workflowOptionKey(workflow) === current)
          ? current
          : workflowKeyOrFallback(workflowScope, nextWorkflows),
      )
      setMixedWorkflowKey((current) =>
        current && nextMixedWorkflows.some((workflow) => workflowOptionKey(workflow) === current)
          ? current
          : workflowKeyOrFallback(mixedWorkflowScope, nextMixedWorkflows),
      )
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : '读取 ComfyUI 抠图工作流失败')
    }
  }

  async function scanSourceFolder() {
    if (!sourceFolder) {
      setError('请先选择图片文件夹')
      return
    }
    setLoadingSources(true)
    setError(null)
    try {
      const images = await window.api.generation.scanImageFolder({ folder: sourceFolder })
      setSources(images)
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : '检索图片失败')
    } finally {
      setLoadingSources(false)
    }
  }

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
    setResult(null)
    setPreviewImages([])
    setRunning(true)
    taskEvents.beginTask()
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
      taskEvents.clearTaskStart()
      setRunning(false)
      setError(nextError instanceof Error ? nextError.message : '启动 ComfyUI 抠图失败')
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
      <div className="mt-5 grid gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
        <div className="space-y-5">
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
              <label className="block space-y-2 text-sm font-medium">
                <span>工作流</span>
                <select
                  className="h-10 w-full rounded-md border bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-primary"
                  onChange={(event) => {
                    if (mode === 'mixed') {
                      rememberWorkflowKey(mixedWorkflowScope, event.target.value)
                      setMixedWorkflowKey(event.target.value)
                    } else {
                      rememberWorkflowKey(workflowScope, event.target.value)
                      setWorkflowKey(event.target.value)
                    }
                  }}
                  value={activeWorkflowKey}
                >
                  {activeWorkflows.map((workflow) => (
                    <option key={workflowOptionKey(workflow)} value={workflowOptionKey(workflow)}>
                      {workflow.name} · {workflow.version}
                    </option>
                  ))}
                </select>
              </label>
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

export function GenerationWorkbench() {
  const activeCapability = useGenerationStore((state) => state.activeCapability)
  const tabs = useGenerationStore((state) => state.tabs)
  const setActiveCapability = useGenerationStore((state) => state.setActiveCapability)
  const setProvider = useGenerationStore((state) => state.setProvider)
  const [activeTasks, setActiveTasks] = useState<ActiveGenerationTask[]>([])
  const [debugLogs, setDebugLogs] = useState<GenerationDebugLogEntry[]>([])
  const [isDebugLogOpen, setIsDebugLogOpen] = useState(false)
  const [expandedDebugLogId, setExpandedDebugLogId] = useState<string | null>(null)
  const debugLogEndRef = useRef<HTMLDivElement | null>(null)
  const activeProvider = tabs[activeCapability].provider
  const activeCapabilityMeta = generationCapabilities.find((item) => item.key === activeCapability)
  const activeCopy = capabilityCopy(activeCapability, activeProvider)
  const unavailable = !isGenerationProviderAvailable(activeCapability, activeProvider)
  const debugLogCounts = useMemo(() => generationDebugLogLevelCounts(debugLogs), [debugLogs])
  const debugIssueCount = debugLogCounts.warn + debugLogCounts.error

  useEffect(() => {
    return window.api.generation.onDebugLog((entry) => {
      setDebugLogs((current) => [...current, entry].slice(-GENERATION_DEBUG_LOG_LIMIT))
    })
  }, [])

  useEffect(() => {
    const offProgress = window.api.generation.onProgress((progress) => {
      if (
        progress.status === 'cancelled' ||
        (progress.total > 0 && progress.processed >= progress.total)
      ) {
        setActiveTasks((current) => current.filter((task) => task.taskId !== progress.task_id))
        return
      }
      setActiveTasks((current) => {
        const previous = current.find((task) => task.taskId === progress.task_id)
        const nextTask: ActiveGenerationTask = {
          taskId: progress.task_id,
          capability: progress.capability,
          processed: progress.processed,
          total: progress.total,
          succeeded: progress.succeeded,
          failed: progress.failed,
          ...(previous?.cancelRequested ? { cancelRequested: true } : {}),
        }
        const existing = current.findIndex((task) => task.taskId === progress.task_id)
        if (existing === -1) {
          return [...current, nextTask]
        }
        return current.map((task, index) => (index === existing ? nextTask : task))
      })
    })
    const offCompleted = window.api.generation.onCompleted((event) => {
      const taskId = event.ok ? event.result.taskId : event.taskId
      setActiveTasks((current) => current.filter((task) => task.taskId !== taskId))
    })
    return () => {
      offProgress()
      offCompleted()
    }
  }, [])

  useEffect(() => {
    if (isDebugLogOpen && debugLogs.length > 0) {
      debugLogEndRef.current?.scrollIntoView({ block: 'end' })
    }
  }, [debugLogs.length, isDebugLogOpen])

  async function cancelAllActiveTasks() {
    const taskIds = activeTasks.map((task) => task.taskId)
    setActiveTasks((current) =>
      current.map((task) =>
        taskIds.includes(task.taskId) ? { ...task, cancelRequested: true } : task,
      ),
    )
    await Promise.all(taskIds.map((taskId) => window.api.generation.cancel({ task_id: taskId })))
  }

  return (
    <div className="space-y-6">
      <ActiveGenerationTaskNotice
        tasks={activeTasks}
        onCancelAll={() => void cancelAllActiveTasks()}
      />

      <div className="rounded-md border bg-background p-5 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-sm font-medium text-muted-foreground">生图模块</p>
            <h2 className="mt-1 text-xl font-semibold text-balance">
              按能力选择 Grsai 或 ComfyUI 路径
            </h2>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button onClick={() => setIsDebugLogOpen(true)} type="button" variant="secondary">
              <Terminal className="mr-2 h-4 w-4" />
              日志 {debugLogs.length}
              {debugIssueCount > 0 ? (
                <span className="ml-2 rounded bg-red-600 px-1.5 py-0.5 text-[10px] font-semibold text-white">
                  {debugIssueCount}
                </span>
              ) : null}
            </Button>
            <div className="rounded-md border bg-muted px-3 py-2 text-xs text-muted-foreground">
              <div>输出目录</div>
              <div className="mt-1 font-medium text-foreground">
                {activeCapabilityMeta?.outputDir ?? '02-印花工作区'}
              </div>
            </div>
          </div>
        </div>

        <Tabs
          className="mt-5"
          onValueChange={(value) => {
            if (isGenerationCapabilityKey(value)) {
              setActiveCapability(value)
            }
          }}
          value={activeCapability}
        >
          <TabsList className="grid h-auto w-full grid-cols-5 p-1">
            {generationCapabilities.map((item) => {
              const Icon = capabilityIcons[item.key]
              return (
                <TabsTrigger className="h-10 gap-2" key={item.key} value={item.key}>
                  <Icon className="h-4 w-4" />
                  {item.label}
                </TabsTrigger>
              )
            })}
          </TabsList>
        </Tabs>
      </div>

      <div
        className="rounded-md border bg-background p-5 shadow-sm"
        hidden={activeCapability !== 'txt2img'}
      >
        <GrsaiPromptGenerationPanel capability="txt2img" />
      </div>

      <div
        className="rounded-md border bg-background p-5 shadow-sm"
        hidden={activeCapability === 'txt2img'}
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="text-base font-semibold">实现方式</h3>
            <p className="mt-1 text-sm text-muted-foreground">{providerNotes[activeProvider]}</p>
          </div>
          <div className="flex gap-2">
            {generationProviders.map((provider) => {
              const available = isGenerationProviderAvailable(activeCapability, provider.key)
              const selected = activeProvider === provider.key
              return (
                <Button
                  className="h-10"
                  disabled={!available}
                  key={provider.key}
                  onClick={() => setProvider(activeCapability, provider.key)}
                  title={available ? provider.label : unavailableText[activeCapability]}
                  type="button"
                  variant={selected ? 'default' : 'secondary'}
                >
                  {provider.label}
                </Button>
              )
            })}
          </div>
        </div>

        <div hidden={!(activeCapability === 'extract' && activeProvider === 'grsai')}>
          <GrsaiExtractPanel />
        </div>
        <div hidden={!(activeCapability === 'extract' && activeProvider === 'comfyui-chenyu')}>
          <ComfyuiExtractPanel />
        </div>
        <div hidden={!(activeCapability === 'matting' && activeProvider === 'comfyui-chenyu')}>
          <ComfyuiMattingPanel />
        </div>
        <div
          hidden={!(activeCapability === 'extract-matting' && activeProvider === 'comfyui-chenyu')}
        >
          <ComfyuiExtractMattingPanel />
        </div>
        <div hidden={!(activeCapability === 'img2img' && activeProvider === 'comfyui-chenyu')}>
          <ComfyuiImg2imgPanel />
        </div>
        <div hidden={!(activeCapability === 'img2img' && activeProvider === 'grsai')}>
          <GrsaiPromptGenerationPanel capability="img2img" />
        </div>
        <div
          className={`mt-5 rounded-md border p-5 ${
            unavailable ? 'border-amber-200 bg-amber-50 text-amber-900' : 'bg-muted/40'
          }`}
          hidden={
            (activeCapability === 'extract' &&
              (activeProvider === 'grsai' || activeProvider === 'comfyui-chenyu')) ||
            (activeCapability === 'matting' && activeProvider === 'comfyui-chenyu') ||
            (activeCapability === 'extract-matting' && activeProvider === 'comfyui-chenyu') ||
            (activeCapability === 'img2img' &&
              (activeProvider === 'grsai' || activeProvider === 'comfyui-chenyu'))
          }
        >
          <div className="flex items-start gap-3">
            <CircleDashed className="mt-0.5 h-5 w-5 shrink-0" />
            <div>
              <h4 className="font-semibold">{activeCopy.title}</h4>
              <p className="mt-1 text-sm leading-6 text-muted-foreground">
                {activeCopy.description}
              </p>
            </div>
          </div>
        </div>
      </div>

      <Dialog onOpenChange={setIsDebugLogOpen} open={isDebugLogOpen}>
        <DialogContent className="max-w-5xl gap-0 p-0">
          <DialogHeader className="border-b px-4 py-3 pr-12">
            <div className="flex items-center justify-between gap-3">
              <DialogTitle className="flex items-center gap-2 text-base">
                <Terminal className="h-4 w-4 text-primary" />
                生图日志
              </DialogTitle>
              <Button
                className="h-8 px-3"
                disabled={!debugLogs.length}
                onClick={() => {
                  setDebugLogs([])
                  setExpandedDebugLogId(null)
                }}
                type="button"
                variant="secondary"
              >
                清空
              </Button>
            </div>
          </DialogHeader>
          <div className="p-4">
            <ScrollArea className="h-[min(70vh,620px)] rounded-md border bg-zinc-950">
              <div className="space-y-1 p-3 font-mono text-[12px] leading-5">
                {debugLogs.length ? (
                  debugLogs.map((entry) => {
                    const rawResponse = generationDebugRawResponse(entry)
                    const expanded = expandedDebugLogId === entry.id
                    return (
                      <div className="space-y-2" key={entry.id}>
                        <div className={generationDebugLogLevelClassName(entry.level)}>
                          {formatGenerationDebugLogLine(entry)}
                          {rawResponse !== null ? (
                            <button
                              className="ml-2 rounded-sm border border-zinc-700 px-1.5 py-0.5 text-[11px] text-zinc-200 hover:border-zinc-500 hover:bg-zinc-900"
                              onClick={() =>
                                setExpandedDebugLogId((current) =>
                                  current === entry.id ? null : entry.id,
                                )
                              }
                              type="button"
                            >
                              {expanded ? '收起原文' : '展开原文'}
                            </button>
                          ) : null}
                        </div>
                        {expanded && rawResponse !== null ? (
                          <pre className="max-h-[360px] overflow-auto whitespace-pre-wrap break-words rounded-md border border-zinc-800 bg-zinc-900 p-3 text-[12px] leading-5 text-zinc-100">
                            {rawResponse || '(空字符串)'}
                          </pre>
                        ) : null}
                      </div>
                    )
                  })
                ) : (
                  <div className="text-zinc-500">暂无日志</div>
                )}
                <div ref={debugLogEndRef} />
              </div>
            </ScrollArea>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
