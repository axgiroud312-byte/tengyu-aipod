import { Button } from '@/components/ui/button'
import type { GenerationCapability } from '@tengyu-aipod/shared'
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
import type {
  GenerationProgress,
  GenerationRunResult,
  GenerationTaskEvent,
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
type ReferenceImageDraft = {
  id: string
  name: string
  dataUrl: string
  base64: string
  mime_type: string
}

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

        {(activeCapability === 'txt2img' || activeCapability === 'img2img') &&
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
