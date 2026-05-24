import { Button } from '@/components/ui/button'
import type { GenerationCapability, Skill, SkillSummary, SkillVariable } from '@tengyu-aipod/shared'
import {
  CircleDashed,
  ImagePlus,
  Layers3,
  Loader2,
  Play,
  Plus,
  Scissors,
  WandSparkles,
} from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import type { ComfyuiWorkflowSummary } from '../../../main/lib/comfyui-workflow-cache'
import type {
  GenerationImageSource,
  GenerationProgress,
  GenerationRunResult,
  GenerationTaskEvent,
  Img2imgPrintSource,
  Txt2imgPromptDraft,
} from '../../../main/lib/generation-service'
import {
  type GenerationProvider,
  generationCapabilities,
  generationProviders,
  isGenerationProviderAvailable,
  useGenerationStore,
} from '../store/generation'

type Txt2imgMode = 'ai' | 'manual'
type Img2imgMode = 'text' | 'layout' | 'style' | 'layout-style' | 'manual'
type MattingMode = 'comfyui' | 'mixed'
type ReferenceImageDraft = {
  id: string
  name: string
  dataUrl: string
  base64: string
  mime_type: string
}
type SkillVariablesState = Record<string, string | boolean>

const capabilityIcons: Record<GenerationCapability, typeof WandSparkles> = {
  txt2img: WandSparkles,
  img2img: ImagePlus,
  extract: Layers3,
  matting: Scissors,
}

const providerNotes: Record<GenerationProvider, string> = {
  grsai: '付费模型路径，适合文生图、图生图和提取。',
  'comfyui-chenyu': '云端 ComfyUI 工作流路径，适合图生图、提取和抠图。',
}

const unavailableText: Record<GenerationCapability, string> = {
  txt2img: 'ComfyUI 不提供文生图入口，请使用 Grsai。',
  img2img: '当前组合不可用，请切换实现方式。',
  extract: '当前组合不可用，请切换实现方式。',
  matting: 'Grsai 不内置透明底抠图，请使用 ComfyUI 或后续混合路径。',
}

const grsaiModels = [
  'nano-banana',
  'nano-banana-fast',
  'nano-banana-2',
  'nano-banana-2-cl',
  'nano-banana-2-4k-cl',
  'nano-banana-pro',
  'nano-banana-pro-cl',
  'nano-banana-pro-vip',
  'nano-banana-pro-4k-vip',
  'gpt-image-2',
  'gpt-image-2-vip',
]

const aspectRatios = ['1:1', '16:9', '9:16', '4:3', '3:4', '3:2', '2:3', '5:4', '4:5']
const img2imgModes: Array<{ key: Img2imgMode; label: string; instruction: string }> = [
  {
    key: 'text',
    label: '纯文字',
    instruction: 'Do not use reference images. Generate new print prompts from the text only.',
  },
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

function clampNumber(value: string, min: number, max: number, fallback: number) {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) {
    return fallback
  }
  return Math.max(min, Math.min(max, Math.floor(parsed)))
}

function progressPercent(progress: GenerationProgress | null) {
  if (!progress || progress.total === 0) {
    return 0
  }
  return Math.round((progress.processed / progress.total) * 100)
}

function splitDataUrl(dataUrl: string) {
  const match = dataUrl.match(/^data:([^;]+);base64,(.*)$/)
  return {
    mime_type: match?.[1] ?? 'image/png',
    base64: match?.[2] ?? dataUrl,
  }
}

function readFileAsDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.addEventListener('load', () => resolve(String(reader.result ?? '')))
    reader.addEventListener('error', () => reject(reader.error ?? new Error('读取参考图失败')))
    reader.readAsDataURL(file)
  })
}

function skillOptionKey(skill: Pick<SkillSummary, 'id' | 'version'>) {
  return `${skill.id}@${skill.version}`
}

function workflowOptionKey(workflow: Pick<ComfyuiWorkflowSummary, 'id' | 'version'>) {
  return `${workflow.id}@${workflow.version}`
}

function parseSkillOptionKey(value: string) {
  const [id = '', version = ''] = value.split('@')
  return { id, version }
}

function defaultVariableValue(variable: SkillVariable): string | boolean {
  if (variable.type === 'checkbox') {
    return Boolean(variable.default)
  }
  return String(variable.default ?? '')
}

function variablePayload(variables: SkillVariable[], values: SkillVariablesState) {
  return Object.fromEntries(
    variables.map((variable) => {
      const value = values[variable.key] ?? defaultVariableValue(variable)
      if (variable.type === 'number') {
        const parsed = Number(value)
        return [variable.key, Number.isFinite(parsed) ? parsed : value]
      }
      return [variable.key, value]
    }),
  )
}

function capabilityCopy(capability: GenerationCapability, provider: GenerationProvider) {
  if (!isGenerationProviderAvailable(capability, provider)) {
    return {
      title: '不可用',
      description: unavailableText[capability],
    }
  }

  if (capability === 'txt2img') {
    return {
      title: '文生图表单占位',
      description: '后续接入 AI 生成提示词 / 自己写双模式、提示词审稿、生图设置和进度面板。',
    }
  }

  if (capability === 'img2img') {
    return {
      title: provider === 'grsai' ? 'Grsai 图生图表单占位' : 'ComfyUI 图生图工作流占位',
      description:
        provider === 'grsai'
          ? '后续接入纯文字、参考构图、参考风格、构图+风格、自己写五种模式。'
          : '后续接入云端派发的图生图工作流列表和参数表单。',
    }
  }

  if (capability === 'extract') {
    return {
      title: provider === 'grsai' ? 'Grsai 提取表单占位' : 'ComfyUI 提取工作流占位',
      description:
        provider === 'grsai'
          ? '后续接入采集图多选、提取 skill、参考图提示词生成和图生图执行。'
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
  const [mode, setMode] = useState<Txt2imgMode>('ai')
  const [img2imgMode, setImg2imgMode] = useState<Img2imgMode>('text')
  const [printMode, setPrintMode] = useState<'local' | 'full'>('local')
  const [promptCount, setPromptCount] = useState('5')
  const [requirement, setRequirement] = useState('')
  const [skillId, setSkillId] = useState(
    capability === 'img2img' ? 'img2img-print-prompt-v3' : 'txt2img-print-prompt-v3',
  )
  const [llmModel, setLlmModel] = useState('qwen3-vl-plus')
  const [manualText, setManualText] = useState('')
  const [referenceImages, setReferenceImages] = useState<ReferenceImageDraft[]>([])
  const [drafts, setDrafts] = useState<Txt2imgPromptDraft[]>([])
  const [generationModel, setGenerationModel] = useState('nano-banana-2')
  const [aspectRatio, setAspectRatio] = useState('1:1')
  const [imageSize, setImageSize] = useState<'1K' | '2K' | '4K'>('1K')
  const [concurrency, setConcurrency] = useState('3')
  const [progress, setProgress] = useState<GenerationProgress | null>(null)
  const [result, setResult] = useState<GenerationRunResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [generatingPrompts, setGeneratingPrompts] = useState(false)
  const [running, setRunning] = useState(false)

  useEffect(() => {
    const offProgress = window.api.generation.onProgress((nextProgress) => {
      if (nextProgress.capability !== capability) {
        return
      }
      setProgress(nextProgress)
    })
    const offCompleted = window.api.generation.onCompleted((event: GenerationTaskEvent) => {
      setRunning(false)
      if (event.ok) {
        setResult(event.result)
        setError(null)
        return
      }
      setError(event.error)
    })
    return () => {
      offProgress()
      offCompleted()
    }
  }, [capability])

  const activeImg2imgMode = img2imgModes.find((item) => item.key === img2imgMode) ?? img2imgModes[0]
  const aiMode = capability === 'txt2img' ? mode === 'ai' : img2imgMode !== 'manual'
  const manualMode = capability === 'txt2img' ? mode === 'manual' : img2imgMode === 'manual'
  const usesReference =
    capability === 'img2img' &&
    (img2imgMode === 'layout' || img2imgMode === 'style' || img2imgMode === 'layout-style')

  const selectedPrompts = useMemo(
    () => drafts.filter((draft) => draft.selected && draft.text.trim()).map((draft) => draft.text),
    [drafts],
  )
  const percent = progressPercent(progress)

  async function generatePrompts() {
    setGeneratingPrompts(true)
    setError(null)
    try {
      const nextDrafts = await window.api.generation.generatePrompts({
        capability,
        ...(skillId.trim() ? { skillId: skillId.trim() } : {}),
        printMode,
        requirement,
        count: clampNumber(promptCount, 1, 20, 5),
        model: llmModel,
        ...(capability === 'img2img' && activeImg2imgMode
          ? { modeInstruction: activeImg2imgMode.instruction }
          : {}),
        ...(usesReference
          ? {
              referenceImages: referenceImages.map((image) => ({
                base64: image.base64,
                mime_type: image.mime_type,
              })),
            }
          : {}),
      })
      setDrafts(nextDrafts)
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : '生成提示词失败')
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

  async function parseManualText() {
    const prompts = await window.api.generation.parseManualPrompts(manualText)
    setDrafts(
      prompts.map((text) => ({
        id: crypto.randomUUID(),
        text,
        selected: true,
      })),
    )
  }

  function updateDraft(id: string, patch: Partial<Txt2imgPromptDraft>) {
    setDrafts((current) =>
      current.map((draft) => (draft.id === id ? { ...draft, ...patch } : draft)),
    )
  }

  function addDraft() {
    setDrafts((current) => [...current, { id: crypto.randomUUID(), text: '', selected: true }])
  }

  async function startGeneration() {
    setError(null)
    if (manualMode) {
      await parseManualText()
    }

    const prompts = manualMode
      ? await window.api.generation.parseManualPrompts(manualText)
      : selectedPrompts
    if (prompts.length === 0) {
      setError('请先准备至少一条提示词')
      return
    }

    setResult(null)
    setRunning(true)
    const taskId = await window.api.generation.runTxt2img({
      capability,
      prompts,
      model: generationModel,
      aspectRatio,
      imageSize,
      concurrency: clampNumber(concurrency, 1, 10, 3),
    })
    setProgress({
      task_id: taskId,
      capability,
      processed: 0,
      total: prompts.length,
      succeeded: 0,
      failed: 0,
    })
  }

  return (
    <div className="mt-5 grid gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
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
                  AI 生成提示词
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

          {aiMode ? (
            <div className="mt-4 grid gap-4">
              {capability === 'img2img' && usesReference ? (
                <div className="rounded-md border p-3">
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
                        <div className="rounded-md border bg-muted p-2 text-xs" key={image.id}>
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
                    max={20}
                    min={1}
                    onChange={(event) => setPromptCount(event.target.value)}
                    type="number"
                    value={promptCount}
                  />
                </label>
                <label className="block space-y-2 text-sm font-medium">
                  <span>LLM 模型</span>
                  <select
                    className="h-10 w-full rounded-md border bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-primary"
                    onChange={(event) => setLlmModel(event.target.value)}
                    value={llmModel}
                  >
                    <option value="qwen3-vl-plus">qwen3-vl-plus</option>
                    <option value="qwen3.6-plus">qwen3.6-plus</option>
                    <option value="qwen3-vl-flash">qwen3-vl-flash</option>
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

              <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_auto]">
                <label className="block space-y-2 text-sm font-medium">
                  <span>Skill</span>
                  <input
                    className="h-10 w-full rounded-md border px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-primary"
                    onChange={(event) => setSkillId(event.target.value)}
                    value={skillId}
                  />
                </label>
                <div className="flex items-end">
                  <Button
                    disabled={generatingPrompts}
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
          <div className="flex items-center justify-between">
            <h4 className="font-semibold">提示词审稿</h4>
            <Button className="h-9 px-3" onClick={addDraft} type="button" variant="secondary">
              <Plus className="mr-2 h-4 w-4" />
              添加自定义
            </Button>
          </div>
          <div className="mt-3 space-y-2">
            {drafts.length ? (
              drafts.map((draft) => (
                <div className="grid grid-cols-[24px_minmax(0,1fr)] gap-2" key={draft.id}>
                  <input
                    checked={draft.selected}
                    className="mt-3"
                    onChange={(event) => updateDraft(draft.id, { selected: event.target.checked })}
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
        </div>
      </div>

      <aside className="space-y-5">
        <div className="rounded-md border bg-background p-4">
          <h4 className="font-semibold">生图设置</h4>
          <div className="mt-4 grid gap-3">
            <label className="block space-y-2 text-sm font-medium">
              <span>生图模型</span>
              <select
                className="h-10 w-full rounded-md border bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-primary"
                onChange={(event) => setGenerationModel(event.target.value)}
                value={generationModel}
              >
                {grsaiModels.map((model) => (
                  <option key={model} value={model}>
                    {model}
                  </option>
                ))}
              </select>
            </label>
            <div className="grid grid-cols-2 gap-3">
              <label className="block space-y-2 text-sm font-medium">
                <span>比例</span>
                <select
                  className="h-10 w-full rounded-md border bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-primary"
                  onChange={(event) => setAspectRatio(event.target.value)}
                  value={aspectRatio}
                >
                  {aspectRatios.map((ratio) => (
                    <option key={ratio} value={ratio}>
                      {ratio}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block space-y-2 text-sm font-medium">
                <span>分辨率</span>
                <select
                  className="h-10 w-full rounded-md border bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-primary"
                  onChange={(event) => setImageSize(event.target.value as '1K' | '2K' | '4K')}
                  value={imageSize}
                >
                  <option value="1K">1K</option>
                  <option value="2K">2K</option>
                  <option value="4K">4K</option>
                </select>
              </label>
            </div>
            <label className="block space-y-2 text-sm font-medium">
              <span>并发</span>
              <input
                className="h-10 w-full rounded-md border px-3 text-sm tabular-nums outline-none focus-visible:ring-2 focus-visible:ring-primary"
                max={10}
                min={1}
                onChange={(event) => setConcurrency(event.target.value)}
                type="number"
                value={concurrency}
              />
            </label>
            <Button disabled={running} onClick={() => void startGeneration()} type="button">
              {running ? <Loader2 className="mr-2 h-4 w-4" /> : <Play className="mr-2 h-4 w-4" />}
              开始生图
            </Button>
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
            <div className="mt-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>
          ) : null}
          {result ? (
            <div className="mt-3 rounded-md bg-muted px-3 py-2 text-sm">
              完成：成功 {result.succeeded}，失败 {result.failed}
            </div>
          ) : null}
        </div>
      </aside>
    </div>
  )
}

function GrsaiExtractPanel() {
  const [sources, setSources] = useState<GenerationImageSource[]>([])
  const [sourceFolder, setSourceFolder] = useState('')
  const [selectedPaths, setSelectedPaths] = useState<string[]>([])
  const [skills, setSkills] = useState<SkillSummary[]>([])
  const [selectedSkillKey, setSelectedSkillKey] = useState('')
  const [selectedSkill, setSelectedSkill] = useState<Skill | null>(null)
  const [variables, setVariables] = useState<SkillVariablesState>({})
  const [promptCount, setPromptCount] = useState('1')
  const [llmModel, setLlmModel] = useState('qwen3-vl-plus')
  const [generationModel, setGenerationModel] = useState('nano-banana-2')
  const [aspectRatio, setAspectRatio] = useState('1:1')
  const [imageSize, setImageSize] = useState<'1K' | '2K' | '4K'>('1K')
  const [concurrency, setConcurrency] = useState('3')
  const [progress, setProgress] = useState<GenerationProgress | null>(null)
  const [result, setResult] = useState<GenerationRunResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loadingSources, setLoadingSources] = useState(false)
  const [running, setRunning] = useState(false)

  useEffect(() => {
    void loadSources()
    void loadSkills()
  }, [])

  useEffect(() => {
    if (!selectedSkillKey) {
      setSelectedSkill(null)
      return
    }
    const { id, version } = parseSkillOptionKey(selectedSkillKey)
    window.api.skill
      .get({ id, version })
      .then((skill) => {
        setSelectedSkill(skill)
        setVariables(
          Object.fromEntries(
            skill.variables.map((variable) => [variable.key, defaultVariableValue(variable)]),
          ),
        )
        setLlmModel(skill.recommendedModel ?? 'qwen3-vl-plus')
      })
      .catch((nextError) => {
        setError(nextError instanceof Error ? nextError.message : '读取提取 Skill 失败')
      })
  }, [selectedSkillKey])

  useEffect(() => {
    const offProgress = window.api.generation.onProgress((nextProgress) => {
      if (nextProgress.capability !== 'extract') {
        return
      }
      setProgress(nextProgress)
    })
    const offCompleted = window.api.generation.onCompleted((event: GenerationTaskEvent) => {
      if (event.ok && event.result.taskId !== progress?.task_id) {
        return
      }
      setRunning(false)
      if (event.ok) {
        setResult(event.result)
        setError(null)
        return
      }
      setError(event.error)
    })
    return () => {
      offProgress()
      offCompleted()
    }
  }, [progress?.task_id])

  const selectedCount = selectedPaths.length
  const percent = progressPercent(progress)

  async function loadSources() {
    setLoadingSources(true)
    setError(null)
    try {
      const nextSources = await window.api.generation.listExtractSources()
      setSourceFolder(nextSources.folder)
      setSources(nextSources.images)
      setSelectedPaths((current) =>
        current.filter((path) => nextSources.images.some((image) => image.path === path)),
      )
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : '读取采集源图失败')
    } finally {
      setLoadingSources(false)
    }
  }

  async function loadSkills() {
    try {
      const nextSkills = await window.api.skill.list({ module: 'generation', category: 'extract' })
      setSkills(nextSkills)
      const first = nextSkills[0]
      if (first) {
        setSelectedSkillKey(skillOptionKey(first))
      }
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : '读取提取 Skill 列表失败')
    }
  }

  function toggleSource(path: string, checked: boolean) {
    setSelectedPaths((current) =>
      checked ? Array.from(new Set([...current, path])) : current.filter((item) => item !== path),
    )
  }

  function selectAllSources() {
    setSelectedPaths(sources.map((source) => source.path))
  }

  function clearSources() {
    setSelectedPaths([])
  }

  function setVariable(key: string, value: string | boolean) {
    setVariables((current) => ({ ...current, [key]: value }))
  }

  async function startExtract() {
    setError(null)
    if (!selectedSkill) {
      setError('请选择提取 Skill')
      return
    }
    if (selectedPaths.length === 0) {
      setError('请先选择 01-采集 下的源图')
      return
    }

    setResult(null)
    setRunning(true)
    const taskId = await window.api.generation.runExtract({
      sourceImagePaths: selectedPaths,
      skillId: selectedSkill.id,
      skillVersion: selectedSkill.version,
      variables: variablePayload(selectedSkill.variables, variables),
      promptCount: clampNumber(promptCount, 1, 20, 1),
      llmModel,
      model: generationModel,
      aspectRatio,
      imageSize,
      concurrency: clampNumber(concurrency, 1, 10, 3),
    })
    setProgress({
      task_id: taskId,
      capability: 'extract',
      processed: 0,
      total: selectedPaths.length * clampNumber(promptCount, 1, 20, 1),
      succeeded: 0,
      failed: 0,
    })
  }

  return (
    <div className="mt-5 grid gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
      <div className="space-y-5">
        <div className="rounded-md border bg-background p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h4 className="font-semibold">采集源图</h4>
              <p className="mt-1 text-sm text-muted-foreground">{sourceFolder || '01-采集'}</p>
            </div>
            <div className="flex gap-2">
              <Button onClick={() => void loadSources()} type="button" variant="secondary">
                {loadingSources ? (
                  <Loader2 className="mr-2 h-4 w-4" />
                ) : (
                  <ImagePlus className="mr-2 h-4 w-4" />
                )}
                刷新
              </Button>
              <Button onClick={selectAllSources} type="button" variant="secondary">
                全选
              </Button>
              <Button onClick={clearSources} type="button" variant="secondary">
                清空
              </Button>
            </div>
          </div>

          <div className="mt-4 grid max-h-[420px] gap-3 overflow-auto pr-1 sm:grid-cols-2 lg:grid-cols-3">
            {sources.length ? (
              sources.map((source) => (
                <label
                  className="grid cursor-pointer grid-cols-[20px_minmax(0,1fr)] gap-2 rounded-md border bg-muted/30 p-2 text-sm"
                  key={source.path}
                >
                  <input
                    checked={selectedPaths.includes(source.path)}
                    className="mt-1"
                    onChange={(event) => toggleSource(source.path, event.target.checked)}
                    type="checkbox"
                  />
                  <span className="min-w-0">
                    <img
                      alt={source.name}
                      className="h-28 w-full rounded-sm object-cover"
                      src={source.thumbnailUrl}
                    />
                    <span className="mt-2 block truncate font-medium">{source.name}</span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {source.relativePath}
                    </span>
                  </span>
                </label>
              ))
            ) : (
              <div className="rounded-md bg-muted px-3 py-8 text-center text-sm text-muted-foreground sm:col-span-2 lg:col-span-3">
                暂无采集源图
              </div>
            )}
          </div>
        </div>

        <div className="rounded-md border bg-background p-4">
          <h4 className="font-semibold">提取 Skill</h4>
          <div className="mt-4 grid gap-4 md:grid-cols-3">
            <label className="block space-y-2 text-sm font-medium md:col-span-2">
              <span>Skill</span>
              <select
                className="h-10 w-full rounded-md border bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-primary"
                onChange={(event) => setSelectedSkillKey(event.target.value)}
                value={selectedSkillKey}
              >
                {skills.map((skill) => (
                  <option key={skillOptionKey(skill)} value={skillOptionKey(skill)}>
                    {skill.id} · {skill.version}
                  </option>
                ))}
              </select>
            </label>
            <label className="block space-y-2 text-sm font-medium">
              <span>每张提示词数</span>
              <input
                className="h-10 w-full rounded-md border px-3 text-sm tabular-nums outline-none focus-visible:ring-2 focus-visible:ring-primary"
                max={20}
                min={1}
                onChange={(event) => setPromptCount(event.target.value)}
                type="number"
                value={promptCount}
              />
            </label>
          </div>

          <div className="mt-4 grid gap-4 md:grid-cols-2">
            {selectedSkill?.variables.length ? (
              selectedSkill.variables.map((variable) => (
                <SkillVariableControl
                  key={variable.key}
                  onChange={(value) => setVariable(variable.key, value)}
                  value={variables[variable.key] ?? defaultVariableValue(variable)}
                  variable={variable}
                />
              ))
            ) : (
              <>
                <label className="block space-y-2 text-sm font-medium">
                  <span>印花区域偏好</span>
                  <select
                    className="h-10 w-full rounded-md border bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-primary"
                    onChange={(event) => setVariable('printAreaPreference', event.target.value)}
                    value={String(variables.printAreaPreference ?? 'auto')}
                  >
                    <option value="auto">自动识别</option>
                    <option value="front">优先正面</option>
                    <option value="largest">最大印花</option>
                  </select>
                </label>
                <label className="flex items-center gap-2 rounded-md border px-3 py-2 text-sm font-medium">
                  <input
                    checked={Boolean(variables.allowMultiplePrints)}
                    onChange={(event) => setVariable('allowMultiplePrints', event.target.checked)}
                    type="checkbox"
                  />
                  允许多印花
                </label>
              </>
            )}
          </div>
        </div>
      </div>

      <aside className="space-y-5">
        <div className="rounded-md border bg-background p-4">
          <h4 className="font-semibold">执行设置</h4>
          <div className="mt-4 grid gap-3">
            <label className="block space-y-2 text-sm font-medium">
              <span>LLM 模型</span>
              <select
                className="h-10 w-full rounded-md border bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-primary"
                onChange={(event) => setLlmModel(event.target.value)}
                value={llmModel}
              >
                <option value="qwen3-vl-plus">qwen3-vl-plus</option>
                <option value="qwen3-vl-flash">qwen3-vl-flash</option>
                <option value="qwen-vl-max">qwen-vl-max</option>
              </select>
            </label>
            <label className="block space-y-2 text-sm font-medium">
              <span>Grsai 模型</span>
              <select
                className="h-10 w-full rounded-md border bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-primary"
                onChange={(event) => setGenerationModel(event.target.value)}
                value={generationModel}
              >
                {grsaiModels.map((model) => (
                  <option key={model} value={model}>
                    {model}
                  </option>
                ))}
              </select>
            </label>
            <div className="grid grid-cols-2 gap-3">
              <label className="block space-y-2 text-sm font-medium">
                <span>比例</span>
                <select
                  className="h-10 w-full rounded-md border bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-primary"
                  onChange={(event) => setAspectRatio(event.target.value)}
                  value={aspectRatio}
                >
                  {aspectRatios.map((ratio) => (
                    <option key={ratio} value={ratio}>
                      {ratio}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block space-y-2 text-sm font-medium">
                <span>分辨率</span>
                <select
                  className="h-10 w-full rounded-md border bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-primary"
                  onChange={(event) => setImageSize(event.target.value as '1K' | '2K' | '4K')}
                  value={imageSize}
                >
                  <option value="1K">1K</option>
                  <option value="2K">2K</option>
                  <option value="4K">4K</option>
                </select>
              </label>
            </div>
            <label className="block space-y-2 text-sm font-medium">
              <span>并发</span>
              <input
                className="h-10 w-full rounded-md border px-3 text-sm tabular-nums outline-none focus-visible:ring-2 focus-visible:ring-primary"
                max={10}
                min={1}
                onChange={(event) => setConcurrency(event.target.value)}
                type="number"
                value={concurrency}
              />
            </label>
            <Button disabled={running} onClick={() => void startExtract()} type="button">
              {running ? <Loader2 className="mr-2 h-4 w-4" /> : <Play className="mr-2 h-4 w-4" />}
              开始提取
            </Button>
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
            <div className="mt-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>
          ) : null}
          {result ? (
            <div className="mt-3 rounded-md bg-muted px-3 py-2 text-sm">
              完成：成功 {result.succeeded}，失败 {result.failed}
            </div>
          ) : null}
        </div>
      </aside>
    </div>
  )
}

function ComfyuiImg2imgPanel() {
  const [sources, setSources] = useState<Img2imgPrintSource[]>([])
  const [folders, setFolders] = useState<string[]>([])
  const [selectedArtifactIds, setSelectedArtifactIds] = useState<string[]>([])
  const [workflows, setWorkflows] = useState<ComfyuiWorkflowSummary[]>([])
  const [workflowKey, setWorkflowKey] = useState('')
  const [prompt, setPrompt] = useState('')
  const [progress, setProgress] = useState<GenerationProgress | null>(null)
  const [result, setResult] = useState<GenerationRunResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [running, setRunning] = useState(false)

  useEffect(() => {
    void loadSources()
    void loadWorkflows()
  }, [])

  useEffect(() => {
    const offProgress = window.api.generation.onProgress((nextProgress) => {
      if (nextProgress.capability !== 'img2img') {
        return
      }
      setProgress(nextProgress)
    })
    const offCompleted = window.api.generation.onCompleted((event: GenerationTaskEvent) => {
      if (event.ok && event.result.taskId !== progress?.task_id) {
        return
      }
      setRunning(false)
      if (event.ok) {
        setResult(event.result)
        setError(null)
        return
      }
      setError(event.error)
    })
    return () => {
      offProgress()
      offCompleted()
    }
  }, [progress?.task_id])

  const percent = progressPercent(progress)
  const selectedWorkflow = workflows.find((workflow) => workflowOptionKey(workflow) === workflowKey)

  async function loadSources() {
    setLoading(true)
    setError(null)
    try {
      const nextSources = await window.api.generation.listImg2imgSources()
      setFolders(nextSources.folders)
      setSources(nextSources.images)
      setSelectedArtifactIds((current) =>
        current.filter((id) => nextSources.images.some((image) => image.artifactId === id)),
      )
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : '读取印花失败')
    } finally {
      setLoading(false)
    }
  }

  async function loadWorkflows() {
    try {
      const nextWorkflows = await window.api.generation.listComfyuiImg2imgWorkflows()
      setWorkflows(nextWorkflows)
      setWorkflowKey(
        (current) => current || (nextWorkflows[0] ? workflowOptionKey(nextWorkflows[0]) : ''),
      )
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : '读取 ComfyUI 工作流失败')
    }
  }

  function toggleSource(artifactId: string, checked: boolean) {
    setSelectedArtifactIds((current) =>
      checked
        ? Array.from(new Set([...current, artifactId]))
        : current.filter((item) => item !== artifactId),
    )
  }

  async function startImg2img() {
    setError(null)
    if (selectedArtifactIds.length === 0) {
      setError('请先选择已提取或已生成的印花')
      return
    }
    if (!selectedWorkflow) {
      setError('请选择 ComfyUI 图生图工作流')
      return
    }

    setResult(null)
    setRunning(true)
    const taskId = await window.api.generation.runComfyuiImg2img({
      sourceArtifactIds: selectedArtifactIds,
      workflowId: selectedWorkflow.id,
      workflowVersion: selectedWorkflow.version,
      prompt,
    })
    setProgress({
      task_id: taskId,
      capability: 'img2img',
      processed: 0,
      total: selectedArtifactIds.length,
      succeeded: 0,
      failed: 0,
    })
  }

  return (
    <div className="mt-5 grid gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
      <div className="space-y-5">
        <div className="rounded-md border bg-background p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h4 className="font-semibold">可用印花</h4>
              <p className="mt-1 text-sm text-muted-foreground">
                {folders.length ? folders.join(' / ') : '02-生图'}
              </p>
            </div>
            <Button onClick={() => void loadSources()} type="button" variant="secondary">
              {loading ? (
                <Loader2 className="mr-2 h-4 w-4" />
              ) : (
                <ImagePlus className="mr-2 h-4 w-4" />
              )}
              刷新
            </Button>
          </div>

          <div className="mt-4 grid max-h-[430px] gap-3 overflow-auto pr-1 sm:grid-cols-2 lg:grid-cols-3">
            {sources.length ? (
              sources.map((source) => (
                <label
                  className="grid cursor-pointer grid-cols-[20px_minmax(0,1fr)] gap-2 rounded-md border bg-muted/30 p-2 text-sm"
                  key={source.artifactId}
                >
                  <input
                    checked={selectedArtifactIds.includes(source.artifactId)}
                    className="mt-1"
                    onChange={(event) => toggleSource(source.artifactId, event.target.checked)}
                    type="checkbox"
                  />
                  <span className="min-w-0">
                    <img
                      alt={source.name}
                      className="h-28 w-full rounded-sm object-cover"
                      src={source.thumbnailUrl}
                    />
                    <span className="mt-2 block truncate font-medium">{source.name}</span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {source.step} · {source.relativePath}
                    </span>
                  </span>
                </label>
              ))
            ) : (
              <div className="rounded-md bg-muted px-3 py-8 text-center text-sm text-muted-foreground sm:col-span-2 lg:col-span-3">
                暂无可用于图生图的印花
              </div>
            )}
          </div>
        </div>

        <div className="rounded-md border bg-background p-4">
          <h4 className="font-semibold">ComfyUI 工作流</h4>
          <div className="mt-4 grid gap-4 md:grid-cols-2">
            <label className="block space-y-2 text-sm font-medium">
              <span>工作流</span>
              <select
                className="h-10 w-full rounded-md border bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-primary"
                onChange={(event) => setWorkflowKey(event.target.value)}
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
              <span>提示词</span>
              <input
                className="h-10 w-full rounded-md border px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-primary"
                onChange={(event) => setPrompt(event.target.value)}
                placeholder="可留空，使用工作流默认图生图逻辑"
                value={prompt}
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
              <dt className="text-muted-foreground">已选印花</dt>
              <dd className="font-medium tabular-nums">{selectedArtifactIds.length}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">工作流</dt>
              <dd className="truncate font-medium">{selectedWorkflow?.name ?? '未选择'}</dd>
            </div>
          </dl>
          <Button
            className="mt-4 w-full"
            disabled={running}
            onClick={() => void startImg2img()}
            type="button"
          >
            {running ? <Loader2 className="mr-2 h-4 w-4" /> : <Play className="mr-2 h-4 w-4" />}
            开始图生图
          </Button>
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
            <div className="mt-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>
          ) : null}
          {result ? (
            <div className="mt-3 rounded-md bg-muted px-3 py-2 text-sm">
              完成：成功 {result.succeeded}，失败 {result.failed}
            </div>
          ) : null}
        </div>
      </aside>
    </div>
  )
}

function ComfyuiExtractPanel() {
  const [sources, setSources] = useState<GenerationImageSource[]>([])
  const [sourceFolder, setSourceFolder] = useState('')
  const [selectedPaths, setSelectedPaths] = useState<string[]>([])
  const [workflows, setWorkflows] = useState<ComfyuiWorkflowSummary[]>([])
  const [workflowKey, setWorkflowKey] = useState('')
  const [prompt, setPrompt] = useState('')
  const [progress, setProgress] = useState<GenerationProgress | null>(null)
  const [result, setResult] = useState<GenerationRunResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loadingSources, setLoadingSources] = useState(false)
  const [running, setRunning] = useState(false)

  useEffect(() => {
    void loadSources()
    void loadWorkflows()
  }, [])

  useEffect(() => {
    const offProgress = window.api.generation.onProgress((nextProgress) => {
      if (nextProgress.capability !== 'extract') {
        return
      }
      setProgress(nextProgress)
    })
    const offCompleted = window.api.generation.onCompleted((event: GenerationTaskEvent) => {
      if (event.ok && event.result.taskId !== progress?.task_id) {
        return
      }
      setRunning(false)
      if (event.ok) {
        setResult(event.result)
        setError(null)
        return
      }
      setError(event.error)
    })
    return () => {
      offProgress()
      offCompleted()
    }
  }, [progress?.task_id])

  const percent = progressPercent(progress)
  const selectedWorkflow = workflows.find((workflow) => workflowOptionKey(workflow) === workflowKey)

  async function loadSources() {
    setLoadingSources(true)
    setError(null)
    try {
      const nextSources = await window.api.generation.listExtractSources()
      setSourceFolder(nextSources.folder)
      setSources(nextSources.images)
      setSelectedPaths((current) =>
        current.filter((path) => nextSources.images.some((image) => image.path === path)),
      )
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : '读取采集源图失败')
    } finally {
      setLoadingSources(false)
    }
  }

  async function loadWorkflows() {
    try {
      const nextWorkflows = await window.api.generation.listComfyuiExtractWorkflows()
      setWorkflows(nextWorkflows)
      setWorkflowKey(
        (current) => current || (nextWorkflows[0] ? workflowOptionKey(nextWorkflows[0]) : ''),
      )
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : '读取 ComfyUI 提取工作流失败')
    }
  }

  function toggleSource(path: string, checked: boolean) {
    setSelectedPaths((current) =>
      checked ? Array.from(new Set([...current, path])) : current.filter((item) => item !== path),
    )
  }

  function selectAllSources() {
    setSelectedPaths(sources.map((source) => source.path))
  }

  function clearSources() {
    setSelectedPaths([])
  }

  async function startExtract() {
    setError(null)
    if (selectedPaths.length === 0) {
      setError('请先选择 01-采集 下的源图')
      return
    }
    if (!selectedWorkflow) {
      setError('请选择 ComfyUI 提取工作流')
      return
    }

    setResult(null)
    setRunning(true)
    const taskId = await window.api.generation.runComfyuiExtract({
      sourceImagePaths: selectedPaths,
      workflowId: selectedWorkflow.id,
      workflowVersion: selectedWorkflow.version,
      prompt,
    })
    setProgress({
      task_id: taskId,
      capability: 'extract',
      processed: 0,
      total: selectedPaths.length,
      succeeded: 0,
      failed: 0,
    })
  }

  return (
    <div className="mt-5 grid gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
      <div className="space-y-5">
        <div className="rounded-md border bg-background p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h4 className="font-semibold">采集源图</h4>
              <p className="mt-1 text-sm text-muted-foreground">{sourceFolder || '01-采集'}</p>
            </div>
            <div className="flex gap-2">
              <Button onClick={() => void loadSources()} type="button" variant="secondary">
                {loadingSources ? (
                  <Loader2 className="mr-2 h-4 w-4" />
                ) : (
                  <ImagePlus className="mr-2 h-4 w-4" />
                )}
                刷新
              </Button>
              <Button onClick={selectAllSources} type="button" variant="secondary">
                全选
              </Button>
              <Button onClick={clearSources} type="button" variant="secondary">
                清空
              </Button>
            </div>
          </div>

          <div className="mt-4 grid max-h-[430px] gap-3 overflow-auto pr-1 sm:grid-cols-2 lg:grid-cols-3">
            {sources.length ? (
              sources.map((source) => (
                <label
                  className="grid cursor-pointer grid-cols-[20px_minmax(0,1fr)] gap-2 rounded-md border bg-muted/30 p-2 text-sm"
                  key={source.path}
                >
                  <input
                    checked={selectedPaths.includes(source.path)}
                    className="mt-1"
                    onChange={(event) => toggleSource(source.path, event.target.checked)}
                    type="checkbox"
                  />
                  <span className="min-w-0">
                    <img
                      alt={source.name}
                      className="h-28 w-full rounded-sm object-cover"
                      src={source.thumbnailUrl}
                    />
                    <span className="mt-2 block truncate font-medium">{source.name}</span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {source.relativePath}
                    </span>
                  </span>
                </label>
              ))
            ) : (
              <div className="rounded-md bg-muted px-3 py-8 text-center text-sm text-muted-foreground sm:col-span-2 lg:col-span-3">
                暂无采集源图
              </div>
            )}
          </div>
        </div>

        <div className="rounded-md border bg-background p-4">
          <h4 className="font-semibold">ComfyUI 提取工作流</h4>
          <div className="mt-4 grid gap-4 md:grid-cols-2">
            <label className="block space-y-2 text-sm font-medium">
              <span>工作流</span>
              <select
                className="h-10 w-full rounded-md border bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-primary"
                onChange={(event) => setWorkflowKey(event.target.value)}
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
              <span>提示词</span>
              <input
                className="h-10 w-full rounded-md border px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-primary"
                onChange={(event) => setPrompt(event.target.value)}
                placeholder="可留空，使用工作流默认提取逻辑"
                value={prompt}
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
              <dt className="text-muted-foreground">已选源图</dt>
              <dd className="font-medium tabular-nums">{selectedPaths.length}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">工作流</dt>
              <dd className="truncate font-medium">{selectedWorkflow?.name ?? '未选择'}</dd>
            </div>
          </dl>
          <Button
            className="mt-4 w-full"
            disabled={running}
            onClick={() => void startExtract()}
            type="button"
          >
            {running ? <Loader2 className="mr-2 h-4 w-4" /> : <Play className="mr-2 h-4 w-4" />}
            开始提取
          </Button>
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
            <div className="mt-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>
          ) : null}
          {result ? (
            <div className="mt-3 rounded-md bg-muted px-3 py-2 text-sm">
              完成：成功 {result.succeeded}，失败 {result.failed}
            </div>
          ) : null}
        </div>
      </aside>
    </div>
  )
}

function ComfyuiMattingPanel() {
  const [mode, setMode] = useState<MattingMode>('comfyui')
  const [sources, setSources] = useState<Img2imgPrintSource[]>([])
  const [folders, setFolders] = useState<string[]>([])
  const [selectedArtifactIds, setSelectedArtifactIds] = useState<string[]>([])
  const [workflows, setWorkflows] = useState<ComfyuiWorkflowSummary[]>([])
  const [workflowKey, setWorkflowKey] = useState('')
  const [mixedWorkflows, setMixedWorkflows] = useState<ComfyuiWorkflowSummary[]>([])
  const [mixedWorkflowKey, setMixedWorkflowKey] = useState('')
  const [prompt, setPrompt] = useState('')
  const [progress, setProgress] = useState<GenerationProgress | null>(null)
  const [result, setResult] = useState<GenerationRunResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loadingSources, setLoadingSources] = useState(false)
  const [running, setRunning] = useState(false)

  useEffect(() => {
    void loadSources()
    void loadWorkflows()
  }, [])

  useEffect(() => {
    const offProgress = window.api.generation.onProgress((nextProgress) => {
      if (nextProgress.capability !== 'matting') {
        return
      }
      setProgress(nextProgress)
    })
    const offCompleted = window.api.generation.onCompleted((event: GenerationTaskEvent) => {
      if (event.ok && event.result.taskId !== progress?.task_id) {
        return
      }
      setRunning(false)
      if (event.ok) {
        setResult(event.result)
        setError(null)
        return
      }
      setError(event.error)
    })
    return () => {
      offProgress()
      offCompleted()
    }
  }, [progress?.task_id])

  const percent = progressPercent(progress)
  const activeWorkflows = mode === 'mixed' ? mixedWorkflows : workflows
  const activeWorkflowKey = mode === 'mixed' ? mixedWorkflowKey : workflowKey
  const selectedWorkflow = activeWorkflows.find(
    (workflow) => workflowOptionKey(workflow) === activeWorkflowKey,
  )
  async function loadSources() {
    setLoadingSources(true)
    setError(null)
    try {
      const nextSources = await window.api.generation.listImg2imgSources()
      setFolders(nextSources.folders)
      setSources(nextSources.images)
      setSelectedArtifactIds((current) =>
        current.filter((id) => nextSources.images.some((image) => image.artifactId === id)),
      )
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : '读取印花失败')
    } finally {
      setLoadingSources(false)
    }
  }

  async function loadWorkflows() {
    try {
      const [nextWorkflows, nextMixedWorkflows] = await Promise.all([
        window.api.generation.listComfyuiMattingWorkflows(),
        window.api.generation.listComfyuiMixedMattingWorkflows(),
      ])
      setWorkflows(nextWorkflows)
      setMixedWorkflows(nextMixedWorkflows)
      setWorkflowKey(
        (current) => current || (nextWorkflows[0] ? workflowOptionKey(nextWorkflows[0]) : ''),
      )
      setMixedWorkflowKey(
        (current) =>
          current || (nextMixedWorkflows[0] ? workflowOptionKey(nextMixedWorkflows[0]) : ''),
      )
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : '读取 ComfyUI 抠图工作流失败')
    }
  }

  function toggleSource(artifactId: string, checked: boolean) {
    setSelectedArtifactIds((current) =>
      checked
        ? Array.from(new Set([...current, artifactId]))
        : current.filter((item) => item !== artifactId),
    )
  }

  async function startMatting() {
    setError(null)
    if (selectedArtifactIds.length === 0) {
      setError('请先选择已生成或导入的印花')
      return
    }
    if (!selectedWorkflow) {
      setError(mode === 'mixed' ? '请选择 ComfyUI 混合抠图工作流' : '请选择 ComfyUI 抠图工作流')
      return
    }
    setResult(null)
    setRunning(true)
    const workflowVersion = selectedWorkflow.version
    let taskId: string
    if (mode === 'mixed') {
      taskId = await window.api.generation.runMixedMatting({
        sourceArtifactIds: selectedArtifactIds,
        workflowId: selectedWorkflow.id,
        prompt,
        ...(workflowVersion ? { workflowVersion } : {}),
      })
    } else {
      taskId = await window.api.generation.runComfyuiMatting({
        sourceArtifactIds: selectedArtifactIds,
        workflowId: selectedWorkflow.id,
        prompt,
        ...(workflowVersion ? { workflowVersion } : {}),
      })
    }
    setProgress({
      task_id: taskId,
      capability: 'matting',
      processed: 0,
      total: selectedArtifactIds.length,
      succeeded: 0,
      failed: 0,
    })
  }

  return (
    <div className="mt-5 grid gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
      <div className="space-y-5">
        <div className="rounded-md border bg-background p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h4 className="font-semibold">待抠图印花</h4>
              <p className="mt-1 text-sm text-muted-foreground">
                {folders.length ? folders.join(' / ') : '02-生图'}
              </p>
            </div>
            <Button onClick={() => void loadSources()} type="button" variant="secondary">
              {loadingSources ? (
                <Loader2 className="mr-2 h-4 w-4" />
              ) : (
                <ImagePlus className="mr-2 h-4 w-4" />
              )}
              刷新
            </Button>
          </div>

          <div className="mt-4 grid max-h-[430px] gap-3 overflow-auto pr-1 sm:grid-cols-2 lg:grid-cols-3">
            {sources.length ? (
              sources.map((source) => (
                <label
                  className="grid cursor-pointer grid-cols-[20px_minmax(0,1fr)] gap-2 rounded-md border bg-muted/30 p-2 text-sm"
                  key={source.artifactId}
                >
                  <input
                    checked={selectedArtifactIds.includes(source.artifactId)}
                    className="mt-1"
                    onChange={(event) => toggleSource(source.artifactId, event.target.checked)}
                    type="checkbox"
                  />
                  <span className="min-w-0">
                    <img
                      alt={source.name}
                      className="h-28 w-full rounded-sm object-cover"
                      src={source.thumbnailUrl}
                    />
                    <span className="mt-2 block truncate font-medium">{source.name}</span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {source.step} · {source.relativePath}
                    </span>
                  </span>
                </label>
              ))
            ) : (
              <div className="rounded-md bg-muted px-3 py-8 text-center text-sm text-muted-foreground sm:col-span-2 lg:col-span-3">
                暂无可用于抠图的印花
              </div>
            )}
          </div>
        </div>

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
          <div className="mt-4 grid gap-4 md:grid-cols-2">
            <label className="block space-y-2 text-sm font-medium">
              <span>工作流</span>
              <select
                className="h-10 w-full rounded-md border bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-primary"
                onChange={(event) =>
                  mode === 'mixed'
                    ? setMixedWorkflowKey(event.target.value)
                    : setWorkflowKey(event.target.value)
                }
                value={activeWorkflowKey}
              >
                {activeWorkflows.map((workflow) => (
                  <option key={workflowOptionKey(workflow)} value={workflowOptionKey(workflow)}>
                    {workflow.name} · {workflow.version}
                  </option>
                ))}
              </select>
            </label>
            <label className="block space-y-2 text-sm font-medium">
              <span>提示词</span>
              <input
                className="h-10 w-full rounded-md border px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-primary"
                onChange={(event) => setPrompt(event.target.value)}
                placeholder={
                  mode === 'mixed'
                    ? '可留空，使用混合工作流默认逻辑'
                    : '可留空，使用工作流默认抠图逻辑'
                }
                value={prompt}
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
              <dt className="text-muted-foreground">已选印花</dt>
              <dd className="font-medium tabular-nums">{selectedArtifactIds.length}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">工作流</dt>
              <dd className="truncate font-medium">{selectedWorkflow?.name ?? '未选择'}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">路径</dt>
              <dd className="truncate font-medium">{mode === 'mixed' ? '混合路径' : '直接抠图'}</dd>
            </div>
          </dl>
          <Button
            className="mt-4 w-full"
            disabled={running}
            onClick={() => void startMatting()}
            type="button"
          >
            {running ? <Loader2 className="mr-2 h-4 w-4" /> : <Play className="mr-2 h-4 w-4" />}
            开始抠图
          </Button>
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
            <div className="mt-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>
          ) : null}
          {result ? (
            <div className="mt-3 rounded-md bg-muted px-3 py-2 text-sm">
              完成：成功 {result.succeeded}，失败 {result.failed}
            </div>
          ) : null}
        </div>
      </aside>
    </div>
  )
}

function SkillVariableControl({
  variable,
  value,
  onChange,
}: {
  variable: SkillVariable
  value: string | boolean
  onChange: (value: string | boolean) => void
}) {
  if (variable.type === 'checkbox') {
    return (
      <label className="flex items-center gap-2 rounded-md border px-3 py-2 text-sm font-medium">
        <input
          checked={Boolean(value)}
          onChange={(event) => onChange(event.target.checked)}
          type="checkbox"
        />
        {variable.label}
      </label>
    )
  }

  if (variable.type === 'select') {
    return (
      <label className="block space-y-2 text-sm font-medium">
        <span>{variable.label}</span>
        <select
          className="h-10 w-full rounded-md border bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-primary"
          onChange={(event) => onChange(event.target.value)}
          value={String(value)}
        >
          {(variable.options ?? []).map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </label>
    )
  }

  if (variable.type === 'textarea') {
    return (
      <label className="block space-y-2 text-sm font-medium md:col-span-2">
        <span>{variable.label}</span>
        <textarea
          className="min-h-24 w-full resize-none rounded-md border px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-primary"
          onChange={(event) => onChange(event.target.value)}
          placeholder={variable.placeholder}
          value={String(value)}
        />
      </label>
    )
  }

  return (
    <label className="block space-y-2 text-sm font-medium">
      <span>{variable.label}</span>
      <input
        className="h-10 w-full rounded-md border px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-primary"
        max={variable.max}
        min={variable.min}
        onChange={(event) => onChange(event.target.value)}
        placeholder={variable.placeholder}
        type={variable.type === 'number' ? 'number' : 'text'}
        value={String(value)}
      />
    </label>
  )
}

export function GenerationWorkbench() {
  const activeCapability = useGenerationStore((state) => state.activeCapability)
  const tabs = useGenerationStore((state) => state.tabs)
  const setActiveCapability = useGenerationStore((state) => state.setActiveCapability)
  const setProvider = useGenerationStore((state) => state.setProvider)
  const activeProvider = tabs[activeCapability].provider
  const activeCapabilityMeta = generationCapabilities.find((item) => item.key === activeCapability)
  const activeCopy = capabilityCopy(activeCapability, activeProvider)
  const unavailable = !isGenerationProviderAvailable(activeCapability, activeProvider)

  return (
    <div className="space-y-6">
      <div className="rounded-md border bg-background p-5 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-sm font-medium text-muted-foreground">生图模块</p>
            <h2 className="mt-1 text-xl font-semibold text-balance">
              按能力选择 Grsai 或 ComfyUI 路径
            </h2>
          </div>
          <div className="rounded-md border bg-muted px-3 py-2 text-xs text-muted-foreground">
            <div>输出目录</div>
            <div className="mt-1 font-medium text-foreground">
              {activeCapabilityMeta?.outputDir ?? '02-生图'}
            </div>
          </div>
        </div>

        <div className="mt-5 grid grid-cols-4 gap-2">
          {generationCapabilities.map((item) => {
            const Icon = capabilityIcons[item.key]
            const selected = activeCapability === item.key
            return (
              <Button
                className="h-11 justify-start gap-2"
                key={item.key}
                onClick={() => setActiveCapability(item.key)}
                type="button"
                variant={selected ? 'default' : 'secondary'}
              >
                <Icon className="h-4 w-4" />
                {item.label}
              </Button>
            )
          })}
        </div>
      </div>

      <div className="rounded-md border bg-background p-5 shadow-sm">
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

        {activeCapability === 'extract' && activeProvider === 'grsai' ? (
          <GrsaiExtractPanel />
        ) : activeCapability === 'extract' && activeProvider === 'comfyui-chenyu' ? (
          <ComfyuiExtractPanel />
        ) : activeCapability === 'matting' && activeProvider === 'comfyui-chenyu' ? (
          <ComfyuiMattingPanel />
        ) : activeCapability === 'img2img' && activeProvider === 'comfyui-chenyu' ? (
          <ComfyuiImg2imgPanel />
        ) : (activeCapability === 'txt2img' || activeCapability === 'img2img') &&
          activeProvider === 'grsai' ? (
          <GrsaiPromptGenerationPanel capability={activeCapability} />
        ) : (
          <div
            className={`mt-5 rounded-md border p-5 ${
              unavailable ? 'border-amber-200 bg-amber-50 text-amber-900' : 'bg-muted/40'
            }`}
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
        )}
      </div>
    </div>
  )
}
