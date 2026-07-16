import { Button } from '@/components/ui/button'
import { ComfyuiInstanceSelectorCard } from '@/features/generation/components/ComfyuiInstanceSelectorCard'
import { CurrentTaskImagePreview } from '@/features/generation/components/CurrentTaskImagePreview'
import { GenerationCancelButton } from '@/features/generation/components/GenerationCancelButton'
import { GenerationFeedback } from '@/features/generation/components/GenerationFeedback'
import { PromptSkillPicker } from '@/features/generation/components/PromptSkillPicker'
import { SkillVariableControl } from '@/features/generation/components/SkillVariableControl'
import { TaskNameField } from '@/features/generation/components/TaskNameField'
import { VisibleFilenameFields } from '@/features/generation/components/VisibleFilenameFields'
import { useComfyuiInstanceSelection } from '@/features/generation/hooks/use-comfyui-instance-selection'
import { useGenerationLocalSettings } from '@/features/generation/hooks/use-generation-local-settings'
import { useGenerationTaskEvents } from '@/features/generation/hooks/use-generation-task-events'
import { usePromptSkillOptions } from '@/features/generation/hooks/use-skill-options'
import {
  type SkillVariablesState,
  bailianModelsForUse,
  clampNumber,
  defaultVariableValue,
  grsaiSizes,
  modelLabel,
  modelOptionsForCapability,
  promptSkillCategoryFor,
  promptSkillLabel,
  rememberWorkflowKey,
  selectedPromptTexts,
  variablePayload,
  workflowKeyOrFallback,
  workflowOptionKey,
} from '@/features/generation/lib/format'
import {
  type Img2imgMode,
  type ReferenceImageDraft,
  type Txt2imgGenerationPath,
  type Txt2imgMode,
  img2imgModes,
} from '@/features/generation/lib/panel-options'
import { progressPercent } from '@/lib/format'
import { readFileAsDataUrl, splitDataUrl } from '@/lib/media'
import { useGenerationStore } from '@/store/generation'
import type { GenerationCapability } from '@tengyu-aipod/shared'
import {
  ChevronDown,
  ChevronUp,
  CircleDashed,
  Loader2,
  Play,
  Plus,
  RefreshCw,
  Trash2,
  WandSparkles,
} from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import type { ComfyuiWorkflowSummary } from '../../../../../../main/lib/comfyui-workflow-cache'
import type {
  GenerationProgress,
  GenerationRunImage,
  GenerationRunResult,
  Txt2imgPromptDraft,
} from '../../../../../../main/lib/generation-service'

export function GrsaiPromptGenerationPanel({
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
        className={`grid gap-5 min-[1400px]:grid-cols-[minmax(0,1fr)_340px] ${
          capability === 'txt2img' ? '' : 'mt-5'
        }`}
      >
        <section aria-label="生图输入" className="space-y-5">
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
                          loading="lazy"
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
        </section>

        <aside aria-label="生图启动与运行" className="space-y-5">
          <div className="rounded-md border bg-background p-4">
            <h4 className="font-semibold">生图设置</h4>
            {settingsError ? (
              <div className="mt-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                {settingsError}
              </div>
            ) : null}
            <div className="mt-4 grid gap-3">
              {capability === 'txt2img' ? (
                <fieldset
                  aria-label="文生图生图路径"
                  className="grid grid-cols-2 gap-2 rounded-md bg-muted p-1"
                >
                  <Button
                    aria-pressed={txt2imgGenerationPath === 'grsai'}
                    className="h-9"
                    onClick={() => setTxt2imgGenerationPath('grsai')}
                    type="button"
                    variant={txt2imgGenerationPath === 'grsai' ? 'default' : 'secondary'}
                  >
                    Grsai
                  </Button>
                  <Button
                    aria-pressed={txt2imgGenerationPath === 'comfyui'}
                    className="h-9"
                    onClick={() => setTxt2imgGenerationPath('comfyui')}
                    type="button"
                    variant={txt2imgGenerationPath === 'comfyui' ? 'default' : 'secondary'}
                  >
                    ComfyUI 工作流
                  </Button>
                </fieldset>
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
