import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Separator } from '@/components/ui/separator'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
import type { TitleExistingStrategy } from '@/features/title/TitlePage'
import {
  type PipelinePreviewImage,
  type PipelinePrintMode,
  type PipelineProgress,
  type PipelinePromptConfig,
  type PipelinePromptMode,
  type PipelineRunConfig,
  type PipelineRunRecord,
  type PipelineSourceMode,
  type SkillSummary,
  SkuCodeSchema,
} from '@tengyu-aipod/shared'
import {
  Check,
  ChevronDown,
  FolderOpen,
  Play,
  RefreshCw,
  Settings2,
  Square,
  WandSparkles,
} from 'lucide-react'
import type { ReactNode } from 'react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import type { DetectionConfig } from '../../../../main/lib/detection-config'

type Option = {
  key: string
  label: string
}

type TaskSourceMode = Extract<PipelineSourceMode, 'collection' | 'txt2img' | 'img2img'>
type ExtractProvider = 'grsai' | 'comfyui-chenyu'
type Img2imgReferenceMode = 'layout' | 'style' | 'layout-style' | 'manual'
type DetectionPassRule = 'allow-review' | 'pass-only'
type GenerationSettingsSnapshot = Awaited<ReturnType<typeof window.api.generationSettings.get>>
type ChenyuManagedInstance = Awaited<ReturnType<typeof window.api.chenyu.listInstances>>[number]
type GenerationImageSource = Awaited<
  ReturnType<typeof window.api.generation.scanImageFolder>
>[number]

type GrsaiImageModelOption = GenerationSettingsSnapshot['grsaiModels'][number]
type LocalModelOption = GenerationSettingsSnapshot['bailianTextModels'][number]

const FALLBACK_GRSAI_MODELS: GrsaiImageModelOption[] = [
  {
    id: 'gpt-image-2',
    label: 'gpt-image-2',
    sizes: ['1024x1024', '1536x1024', '1024x1536'],
    allowCustomSize: false,
  },
  {
    id: 'gpt-image-2-vip',
    label: 'gpt-image-2-vip',
    sizes: ['1024x1024', '2048x2048', '3840x2160', '2160x3840'],
    allowCustomSize: true,
  },
]

const FALLBACK_BAILIAN_TEXT_MODELS: LocalModelOption[] = [
  { id: 'qwen3.6-flash', label: 'qwen3.6-flash', modality: 'text' },
  { id: 'qwen3-vl-flash', label: 'qwen3-vl-flash', modality: 'text' },
]

const FALLBACK_BAILIAN_VISION_MODELS: GenerationSettingsSnapshot['bailianVisionModels'] = [
  { id: 'qwen3.6-flash', label: 'qwen3.6-flash', modality: 'vision' },
  { id: 'qwen3-vl-flash', label: 'qwen3-vl-flash', modality: 'vision' },
]

const DEFAULT_DETECTION_PREPROCESS = {
  compress: true,
  maxSize: 1024,
  format: 'jpg' as const,
  quality: 85,
}

const promptSkillCategories: Record<
  Extract<TaskSourceMode, 'txt2img' | 'img2img'>,
  Record<PipelinePrintMode, string>
> = {
  txt2img: {
    local: 'txt2img-local-print',
    full: 'txt2img-full-print',
  },
  img2img: {
    local: 'img2img-local-reference',
    full: 'img2img-full-reference',
  },
}

const extractSkillCategories = ['extract-paid-model', 'extract-comfyui-workflow'] as const

const sourceModeOptions: Array<{ key: TaskSourceMode; label: string }> = [
  { key: 'collection', label: '采集 + 提取' },
  { key: 'txt2img', label: '文生图' },
  { key: 'img2img', label: '图生图' },
]

const img2imgReferenceModes: Array<{
  key: Img2imgReferenceMode
  label: string
  instruction: string
}> = [
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

function Field({
  children,
  label,
}: {
  children: ReactNode
  label: string
}) {
  return (
    <div className="grid min-w-0 gap-2 text-sm font-medium">
      <span>{label}</span>
      {children}
    </div>
  )
}

function SelectField({
  label,
  onValueChange,
  options,
  value,
}: {
  label: string
  onValueChange: (value: string) => void
  options: Option[]
  value: string
}) {
  return (
    <Field label={label}>
      <Select onValueChange={onValueChange} value={value}>
        <SelectTrigger className="min-w-0 [&>span]:min-w-0 [&>span]:truncate">
          <SelectValue />
        </SelectTrigger>
        <SelectContent className="max-w-[min(28rem,var(--radix-select-trigger-width))]">
          {options.map((option) => (
            <SelectItem className="truncate" key={option.key} value={option.key}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </Field>
  )
}

function PromptRequirementField({
  id,
  onOpenChange,
  onValueChange,
  open,
  value,
}: {
  id: string
  onOpenChange: (open: boolean) => void
  onValueChange: (value: string) => void
  open: boolean
  value: string
}) {
  const summary = value.trim().replace(/\s+/g, ' ')

  return (
    <div className="relative grid gap-2 text-sm font-medium">
      <span>印花要求</span>
      <button
        aria-controls={id}
        aria-expanded={open}
        className="flex h-9 w-full items-center justify-between gap-2 rounded-md border border-input bg-transparent px-3 py-2 text-left text-sm shadow-sm ring-offset-background focus:outline-none focus:ring-1 focus:ring-ring"
        onClick={() => onOpenChange(!open)}
        type="button"
      >
        <span className={summary ? 'truncate' : 'truncate text-muted-foreground'}>
          {summary || '点击填写印花要求'}
        </span>
        <ChevronDown
          className={`h-4 w-4 shrink-0 opacity-50 transition-transform ${open ? 'rotate-180' : ''}`}
        />
      </button>
      {open ? (
        <div
          className="absolute left-0 top-full z-30 mt-2 w-[min(28rem,calc(100vw-2rem))] rounded-md border bg-popover p-3 text-popover-foreground shadow-md"
          id={id}
        >
          <Textarea
            autoFocus
            className="min-h-32 resize-y"
            onChange={(event) => onValueChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                onOpenChange(false)
              }
            }}
            placeholder="例如：圣诞元素、不要文字、适合儿童 T 恤"
            value={value}
          />
          <div className="mt-2 flex justify-end">
            <Button className="h-8 px-3" onClick={() => onOpenChange(false)} variant="secondary">
              <Check className="mr-2 h-4 w-4" />
              收起
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  )
}

function splitLines(value: string) {
  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
}

function optionFromSkill(skill: SkillSummary): Option {
  return {
    key: skill.id,
    label: `${skillTitle(skill)}${skill.version ? ` · ${skill.version}` : ''}`,
  }
}

function skillTitle(skill: SkillSummary) {
  const noteTitle = skill.notes?.split('：')[0]?.trim()
  if (noteTitle && !noteTitle.startsWith('用于')) {
    if (noteTitle.includes('付费模型提取') || noteTitle.includes('ComfyUI 提取')) {
      return '提取提示词'
    }
    return noteTitle
  }

  if (skill.category === 'extract-paid-model' || skill.category === 'extract-comfyui-workflow') {
    return '提取提示词'
  }
  if (skill.category === 'txt2img-local-print') {
    return '文生图局部印花'
  }
  if (skill.category === 'txt2img-full-print') {
    return '文生图满印'
  }
  if (skill.category === 'img2img-local-reference') {
    return '图生图局部参考图'
  }
  if (skill.category === 'img2img-full-reference') {
    return '图生图满印参考图'
  }
  return skill.id
}

function optionFromWorkflow(workflow: { id: string; name: string; version?: string }): Option {
  return {
    key: workflow.id,
    label: `${workflow.name || workflow.id}${workflow.version ? ` · ${workflow.version}` : ''}`,
  }
}

function nonEmpty(value: string) {
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function numberFromText(value: string, fallback: number) {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

function modelLabel(model: { id: string; label?: string }) {
  return model.label ?? model.id
}

function grsaiModelsFor(settings: GenerationSettingsSnapshot | null) {
  return settings?.grsaiModels.length ? settings.grsaiModels : FALLBACK_GRSAI_MODELS
}

function textModelsFor(settings: GenerationSettingsSnapshot | null) {
  return settings?.bailianTextModels.length
    ? settings.bailianTextModels
    : FALLBACK_BAILIAN_TEXT_MODELS
}

function visionModelsFor(settings: GenerationSettingsSnapshot | null) {
  return settings?.bailianVisionModels.length
    ? settings.bailianVisionModels
    : FALLBACK_BAILIAN_VISION_MODELS
}

function promptSkillCategoryFor(
  sourceMode: Extract<TaskSourceMode, 'txt2img' | 'img2img'>,
  printMode: PipelinePrintMode,
) {
  return promptSkillCategories[sourceMode][printMode]
}

function instanceComfyuiUrl(instance: ChenyuManagedInstance) {
  return instance.comfyuiUrl ?? instance.serverUrls[0] ?? ''
}

function isRunningChenyuInstance(instance: ChenyuManagedInstance) {
  return instance.statusName === 'running' && Boolean(instanceComfyuiUrl(instance))
}

function selectFallbackChenyuInstance(instances: ChenyuManagedInstance[]) {
  const runningInstances = instances.filter(isRunningChenyuInstance)
  return runningInstances.find((instance) => instance.isCurrent) ?? runningInstances[0] ?? null
}

function skillInCategories(skill: SkillSummary, categories: readonly string[]) {
  return categories.includes(skill.category ?? '')
}

function localImageUrl(path: string) {
  return `tengyu-local-image://image/${encodeURIComponent(path)}`
}

function fileUrlLocalPath(url: string) {
  try {
    const parsed = new URL(url)
    if (parsed.protocol !== 'file:') {
      return null
    }
    const path = decodeURIComponent(parsed.pathname)
    return /^\/[A-Za-z]:/.test(path) ? path.slice(1) : path
  } catch {
    return null
  }
}

function pipelinePreviewSrc(image: PipelinePreviewImage) {
  const localPath = image.local_path ?? fileUrlLocalPath(image.url)
  return localPath ? localImageUrl(localPath) : image.url
}

function previewTitleForSource(
  sourceMode: TaskSourceMode,
  currentStep: PipelineProgress['current_step'],
) {
  if (currentStep === 'extract') {
    return '提取结果'
  }
  if (currentStep === 'matting') {
    return '抠图结果'
  }
  if (currentStep === 'detection') {
    return '检测后放行'
  }
  if (currentStep === 'photoshop') {
    return '套版执行'
  }
  if (currentStep === 'title') {
    return '标题生成'
  }
  if (sourceMode === 'collection') {
    return '采集来源'
  }
  return sourceMode === 'txt2img' ? '文生图预览' : '图生图预览'
}

function compactPath(value: string) {
  return value.split(/[\\/]/).filter(Boolean).slice(-3).join(' / ') || value
}

function promptPreviewLines(
  promptMode: PipelinePromptMode,
  manualPrompts: string,
  requirement: string,
) {
  if (promptMode === 'manual') {
    return splitLines(manualPrompts)
  }
  return requirement.trim() ? [requirement.trim()] : []
}

function AdvancedDisclosure({
  children,
  summary,
}: {
  children: ReactNode
  summary: string
}) {
  return (
    <details className="rounded-md border bg-background px-3 py-2 text-sm">
      <summary className="flex cursor-pointer list-none items-center gap-2 font-medium">
        <Settings2 className="size-4" />
        {summary}
      </summary>
      <div className="mt-4">{children}</div>
    </details>
  )
}

function SourceImagePreviewGrid({
  images,
  title,
}: {
  images: GenerationImageSource[]
  title: string
}) {
  return (
    <div>
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-sm font-semibold">{title}</h3>
        <span className="text-xs tabular-nums text-muted-foreground">{images.length} 张</span>
      </div>
      {images.length ? (
        <div className="mt-3 grid grid-cols-2 gap-2">
          {images.slice(0, 12).map((image) => (
            <div className="min-w-0 rounded-md border bg-muted/30 p-2" key={image.path}>
              <img
                alt={image.name}
                className="aspect-square w-full rounded-sm object-cover"
                src={localImageUrl(image.path)}
              />
              <span className="mt-2 block truncate text-xs font-medium">{image.name}</span>
            </div>
          ))}
        </div>
      ) : (
        <div className="mt-3 rounded-md bg-muted px-3 py-8 text-center text-sm text-muted-foreground">
          选择文件夹后显示图片
        </div>
      )}
    </div>
  )
}

function PipelineImagePreviewGrid({ images }: { images: PipelinePreviewImage[] }) {
  return (
    <div>
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-sm font-semibold">运行产物</h3>
        <span className="text-xs tabular-nums text-muted-foreground">{images.length} 张</span>
      </div>
      {images.length ? (
        <div className="mt-3 grid grid-cols-2 gap-2">
          {images.slice(0, 12).map((image, index) => (
            <div
              className="min-w-0 rounded-md border bg-muted/30 p-2"
              key={image.local_path ?? image.url}
            >
              <img
                alt={`产物 ${index + 1}`}
                className="aspect-square w-full rounded-sm object-cover"
                src={pipelinePreviewSrc(image)}
              />
              <span className="mt-2 block truncate text-xs font-medium">
                {image.print_id ?? image.artifact_id ?? `产物 ${index + 1}`}
              </span>
            </div>
          ))}
        </div>
      ) : (
        <div className="mt-3 rounded-md bg-muted px-3 py-8 text-center text-sm text-muted-foreground">
          启动后逐张显示生成结果
        </div>
      )}
    </div>
  )
}

function PromptPreview({
  lines,
  modeLabel,
}: {
  lines: string[]
  modeLabel: string
}) {
  return (
    <div>
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-sm font-semibold">提示词</h3>
        <span className="text-xs text-muted-foreground">{modeLabel}</span>
      </div>
      {lines.length ? (
        <div className="mt-3 space-y-2">
          {lines.slice(0, 6).map((line, index) => (
            <div className="rounded-md border bg-muted/30 px-3 py-2 text-sm" key={line}>
              <div className="mb-1 text-xs tabular-nums text-muted-foreground">
                {String(index + 1).padStart(2, '0')}
              </div>
              <p className="line-clamp-3 text-pretty">{line}</p>
            </div>
          ))}
        </div>
      ) : (
        <div className="mt-3 rounded-md bg-muted px-3 py-6 text-center text-sm text-muted-foreground">
          填写提示词或印花要求后显示
        </div>
      )}
    </div>
  )
}

function PipelineEffectPreview({
  currentStep,
  message,
  previewImages,
  progress,
  promptLines,
  promptMode,
  sourceFolder,
  sourceLoading,
  sourceError,
  sourceImages,
  sourceMode,
}: {
  currentStep: PipelineProgress['current_step']
  message: string
  previewImages: PipelinePreviewImage[]
  progress: PipelineProgress | null
  promptLines: string[]
  promptMode: PipelinePromptMode
  sourceFolder: string
  sourceLoading: boolean
  sourceError: string | null
  sourceImages: GenerationImageSource[]
  sourceMode: TaskSourceMode
}) {
  const showPrompt = sourceMode === 'txt2img' || sourceMode === 'img2img'
  const title = previewTitleForSource(sourceMode, currentStep)
  return (
    <div className="space-y-4 xl:sticky xl:top-4">
      <div className="rounded-md border bg-background p-4 shadow-sm">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-sm font-medium text-muted-foreground">实际效果</p>
            <h2 className="mt-1 text-lg font-semibold text-balance">{title}</h2>
          </div>
          <Badge variant="secondary">{currentStep ?? '配置中'}</Badge>
        </div>
        <p className="mt-2 text-sm text-pretty text-muted-foreground">{message}</p>

        <div className="mt-4 space-y-5">
          {showPrompt ? (
            <PromptPreview
              lines={promptLines}
              modeLabel={promptMode === 'manual' ? '手写' : 'AI 生成'}
            />
          ) : null}

          {sourceMode === 'collection' || sourceMode === 'img2img' ? (
            <div>
              <SourceImagePreviewGrid
                images={sourceImages}
                title={sourceMode === 'img2img' ? '参考图' : '采集图'}
              />
              {sourceLoading ? (
                <p className="mt-2 text-xs text-muted-foreground">正在检索图片...</p>
              ) : null}
              {sourceError ? <p className="mt-2 text-xs text-red-600">{sourceError}</p> : null}
            </div>
          ) : null}

          <PipelineImagePreviewGrid images={previewImages} />
        </div>
      </div>

      <div className="rounded-md border bg-background p-4">
        <div className="flex items-center justify-between gap-3">
          <h3 className="text-sm font-semibold">运行摘要</h3>
          <span className="text-xs text-muted-foreground">{progress?.status ?? '未启动'}</span>
        </div>
        <div className="mt-3 grid grid-cols-2 gap-2 text-sm">
          <div className="rounded-md border p-3">
            <div className="text-xs text-muted-foreground">印花</div>
            <div className="mt-1 text-lg font-semibold tabular-nums">
              {progress?.stats.prints ?? 0}
            </div>
          </div>
          <div className="rounded-md border p-3">
            <div className="text-xs text-muted-foreground">疑似放行</div>
            <div className="mt-1 text-lg font-semibold tabular-nums">
              {progress?.stats.detectionReview ?? 0}
            </div>
          </div>
          <div className="rounded-md border p-3">
            <div className="text-xs text-muted-foreground">高风险拦截</div>
            <div className="mt-1 text-lg font-semibold tabular-nums">
              {progress?.stats.detectionBlock ?? 0}
            </div>
          </div>
          <div className="rounded-md border p-3">
            <div className="text-xs text-muted-foreground">标题成功</div>
            <div className="mt-1 text-lg font-semibold tabular-nums">
              {progress?.stats.titleSucceeded ?? 0}
            </div>
          </div>
        </div>
        {sourceFolder ? (
          <p className="mt-3 truncate text-xs text-muted-foreground">{compactPath(sourceFolder)}</p>
        ) : null}
      </div>
    </div>
  )
}

export function FullTaskPage() {
  const [name, setName] = useState('')
  const [printSkuCode, setPrintSkuCode] = useState('')
  const [sourceMode, setSourceMode] = useState<TaskSourceMode>('collection')
  const [printMode, setPrintMode] = useState<PipelinePrintMode>('local')
  const [sourceFolder, setSourceFolder] = useState('')
  const [extractProvider, setExtractProvider] = useState<ExtractProvider>('grsai')
  const [promptMode, setPromptMode] = useState<PipelinePromptMode>('manual')
  const [img2imgReferenceMode, setImg2imgReferenceMode] =
    useState<Img2imgReferenceMode>('layout-style')
  const [manualPrompts, setManualPrompts] = useState('')
  const [promptRequirement, setPromptRequirement] = useState('')
  const [promptRequirementOpen, setPromptRequirementOpen] = useState(false)
  const [promptCount, setPromptCount] = useState('5')
  const [promptSkillId, setPromptSkillId] = useState('')
  const [promptModel, setPromptModel] = useState('')
  const [grsaiModel, setGrsaiModel] = useState('gpt-image-2')
  const [aspectRatio, setAspectRatio] = useState('1024x1024')
  const [grsaiConcurrency, setGrsaiConcurrency] = useState('20')
  const [extractSkillId, setExtractSkillId] = useState('')
  const [extractWorkflowId, setExtractWorkflowId] = useState('')
  const [extractInstanceUuid, setExtractInstanceUuid] = useState('')
  const [width, setWidth] = useState('1024')
  const [height, setHeight] = useState('1024')
  const [mattingEnabled, setMattingEnabled] = useState(true)
  const [mattingWorkflowId, setMattingWorkflowId] = useState('')
  const [mattingInstanceUuid, setMattingInstanceUuid] = useState('')
  const [skipCompleted, setSkipCompleted] = useState(true)
  const [replaceRange, setReplaceRange] = useState<'auto' | 'top' | 'all'>('auto')
  const [clipMode, setClipMode] = useState<'auto' | 'guides' | 'none'>('auto')
  const [format, setFormat] = useState<'jpg' | 'png'>('jpg')
  const [photoshopMaxRetries, setPhotoshopMaxRetries] = useState('1')
  const [templatePaths, setTemplatePaths] = useState<string[]>([])
  const [outputRoot, setOutputRoot] = useState('')
  const [detectionEnabled, setDetectionEnabled] = useState(true)
  const [detectionConfig, setDetectionConfig] = useState<DetectionConfig | null>(null)
  const [detectionPassRule, setDetectionPassRule] = useState<DetectionPassRule>('allow-review')
  const [detectionCompression, setDetectionCompression] = useState(true)
  const [titlePlatform, setTitlePlatform] = useState('temu')
  const [titleLanguage, setTitleLanguage] = useState('en')
  const [titleModel, setTitleModel] = useState('qwen3.6-flash')
  const [titleFileName, setTitleFileName] = useState('标题')
  const [titleImageIndex, setTitleImageIndex] = useState('1')
  const [titlePrefix, setTitlePrefix] = useState('')
  const [titleSuffix, setTitleSuffix] = useState('')
  const [titleSeparator, setTitleSeparator] = useState(' ')
  const [titleExistingStrategy, setTitleExistingStrategy] = useState<TitleExistingStrategy>('skip')
  const [titleMaxRetries, setTitleMaxRetries] = useState('2')
  const [titleCompression, setTitleCompression] = useState(true)
  const [titleMaxSize, setTitleMaxSize] = useState('1024')
  const [extraRequirement, setExtraRequirement] = useState('')
  const [progress, setProgress] = useState<PipelineProgress | null>(null)
  const [currentRunId, setCurrentRunId] = useState<string | null>(null)
  const [recentRuns, setRecentRuns] = useState<PipelineRunRecord[]>([])
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState('按三个大区块配置后即可启动')
  const [running, setRunning] = useState(false)
  const [sourcePreviewImages, setSourcePreviewImages] = useState<GenerationImageSource[]>([])
  const [sourcePreviewLoading, setSourcePreviewLoading] = useState(false)
  const [sourcePreviewError, setSourcePreviewError] = useState<string | null>(null)
  const [pipelinePreviewImages, setPipelinePreviewImages] = useState<PipelinePreviewImage[]>([])

  const [generationSettings, setGenerationSettings] = useState<GenerationSettingsSnapshot | null>(
    null,
  )
  const [generationSkills, setGenerationSkills] = useState<SkillSummary[]>([])
  const [extractWorkflows, setExtractWorkflows] = useState<Option[]>([])
  const [mattingWorkflows, setMattingWorkflows] = useState<Option[]>([])
  const [chenyuInstances, setChenyuInstances] = useState<ChenyuManagedInstance[]>([])
  const [platforms, setPlatforms] = useState<Option[]>([])
  const [languages, setLanguages] = useState<Option[]>([])
  const [titleModels, setTitleModels] = useState<Option[]>([])

  const isMac = navigator.platform.toLowerCase().includes('mac')
  const grsaiModelOptions = useMemo(() => grsaiModelsFor(generationSettings), [generationSettings])
  const selectedGrsaiModel = useMemo(
    () => grsaiModelOptions.find((item) => item.id === grsaiModel) ?? grsaiModelOptions[0] ?? null,
    [grsaiModelOptions, grsaiModel],
  )
  const grsaiSizeOptions = selectedGrsaiModel?.sizes.length
    ? selectedGrsaiModel.sizes
    : (FALLBACK_GRSAI_MODELS[0]?.sizes ?? ['1024x1024', '1536x1024', '1024x1536'])
  const promptModelOptions = useMemo(
    () =>
      (sourceMode === 'img2img'
        ? visionModelsFor(generationSettings)
        : textModelsFor(generationSettings)
      ).map((item) => ({ key: item.id, label: modelLabel(item) })),
    [generationSettings, sourceMode],
  )
  const promptSkillCategory =
    sourceMode === 'collection' ? null : promptSkillCategoryFor(sourceMode, printMode)
  const promptSkillOptions = useMemo(() => {
    if (!promptSkillCategory) {
      return []
    }
    const filtered = generationSkills.filter((skill) =>
      skillInCategories(skill, [promptSkillCategory]),
    )
    const pool = filtered.length > 0 ? filtered : generationSkills
    return pool.map(optionFromSkill)
  }, [generationSkills, promptSkillCategory])
  const extractSkillOptions = useMemo(() => {
    if (extractProvider !== 'grsai') {
      return []
    }
    const filtered = generationSkills.filter((skill) =>
      skillInCategories(skill, extractSkillCategories),
    )
    const pool = filtered.length > 0 ? filtered : generationSkills
    return pool.map(optionFromSkill)
  }, [extractProvider, generationSkills])
  const runningInstances = useMemo(
    () => chenyuInstances.filter(isRunningChenyuInstance),
    [chenyuInstances],
  )
  const runningInstanceOptions = useMemo(
    () =>
      runningInstances.map((instance) => ({
        key: instance.instanceUuid,
        label: `${instance.title || instance.instanceUuid}${instance.isCurrent ? ' · 默认' : ''}`,
      })),
    [runningInstances],
  )
  const promptModeOptions: Option[] = [
    { key: 'manual', label: '手写提示词' },
    { key: 'ai', label: 'AI 生成提示词' },
  ]
  const selectedImg2imgReferenceMode =
    img2imgReferenceModes.find((item) => item.key === img2imgReferenceMode) ??
    img2imgReferenceModes[0]
  const promptLines = promptPreviewLines(promptMode, manualPrompts, promptRequirement)
  const workflowPreviewImages = progress?.preview_images ?? pipelinePreviewImages
  const sourceBadgeLabel =
    sourceMode === 'collection'
      ? '采集 + 提取'
      : sourceMode === 'txt2img'
        ? '固定付费模型'
        : '固定付费模型'
  const sourceFolderLabel = sourceMode === 'img2img' ? '图生图参考文件夹' : '采集文件夹'
  const sourceFolderPlaceholder =
    sourceMode === 'img2img' ? '选择参考图文件夹' : '选择采集图片文件夹'
  const validationIssues = useMemo(() => {
    const issues: string[] = []
    const normalizedPrintSkuCode = printSkuCode.trim()
    if (!normalizedPrintSkuCode) {
      issues.push('请先填写印花货号')
    } else if (!SkuCodeSchema.safeParse(normalizedPrintSkuCode).success) {
      issues.push('印花货号只能使用英文、数字、短横线和下划线，长度 1-60')
    }
    if (templatePaths.length === 0) {
      issues.push('请先选择 PSD 模板')
    }
    if (sourceMode === 'collection') {
      if (!sourceFolder.trim()) {
        issues.push('请先选择采集文件夹')
      }
      if (extractProvider === 'grsai') {
        if (extractSkillOptions.length === 0) {
          issues.push('请先在后台配置提取 Skill')
        }
        if (!extractSkillId.trim()) {
          issues.push('请先选择提取 Skill')
        }
      } else {
        if (runningInstances.length === 0) {
          issues.push('请先开机晨羽云机')
        }
        if (!extractWorkflowId.trim()) {
          issues.push('请先选择晨羽提取工作流')
        }
        if (!extractInstanceUuid.trim()) {
          issues.push('请先选择晨羽提取实例')
        }
      }
    }
    if (sourceMode === 'txt2img' || sourceMode === 'img2img') {
      if (sourceMode === 'img2img' && !sourceFolder.trim()) {
        issues.push('请先选择图生图参考文件夹')
      }
      if (promptMode === 'manual') {
        if (splitLines(manualPrompts).length === 0) {
          issues.push('请至少填写一条提示词')
        }
      } else {
        if (promptSkillOptions.length === 0) {
          issues.push('请先在后台配置提示词 Skill')
        }
        if (!promptSkillId.trim()) {
          issues.push('请先选择提示词 Skill')
        }
        if (!promptModel.trim()) {
          issues.push('请先选择提示词模型')
        }
        if (!promptRequirement.trim()) {
          issues.push('请先填写印花要求')
        }
      }
    }
    if (mattingEnabled) {
      if (runningInstances.length === 0) {
        issues.push('请先开机晨羽云机')
      }
      if (!mattingWorkflowId.trim()) {
        issues.push('请先选择抠图工作流')
      }
      if (!mattingInstanceUuid.trim()) {
        issues.push('请先选择抠图晨羽实例')
      }
    }
    if (detectionEnabled && !detectionConfig) {
      issues.push('请先完成侵权检测设置加载')
    }
    if (!titlePlatform.trim() || !titleLanguage.trim() || !titleModel.trim()) {
      issues.push('请先完成标题设置')
    }
    return issues
  }, [
    extractProvider,
    extractSkillId,
    extractSkillOptions.length,
    extractInstanceUuid,
    extractWorkflowId,
    detectionConfig,
    detectionEnabled,
    manualPrompts,
    mattingEnabled,
    mattingInstanceUuid,
    mattingWorkflowId,
    promptMode,
    promptModel,
    promptRequirement,
    promptSkillId,
    promptSkillOptions.length,
    printSkuCode,
    runningInstances.length,
    sourceFolder,
    sourceMode,
    templatePaths.length,
    titleLanguage,
    titleModel,
    titlePlatform,
  ])
  const canStart = !running && !isMac && validationIssues.length === 0

  const refreshOptions = useCallback(async () => {
    const results = await Promise.allSettled([
      window.api.skill.list({ module: 'generation' }),
      window.api.generation.listComfyuiExtractWorkflows(),
      window.api.generation.listComfyuiMattingWorkflows(),
      window.api.chenyu.listInstances(),
      window.api.title.listPlatforms(),
      window.api.title.listLanguages(),
      window.api.title.listModels(),
      window.api.generationSettings.get(),
      window.api.pipeline.listRuns(),
      window.api.detection.getConfig(),
    ])
    const failed = results
      .map((result, index) => ({ result, index }))
      .filter(
        (item): item is { result: PromiseRejectedResult; index: number } =>
          item.result.status === 'rejected',
      )
    const errorLabels = [
      'Skill',
      '提取工作流',
      '抠图工作流',
      '晨羽实例',
      '标题平台',
      '标题语言',
      '标题模型',
      '生图设置',
      '最近任务',
      '检测配置',
    ]

    if (failed.length) {
      setError(`部分配置加载失败：${failed.map((item) => errorLabels[item.index]).join('、')}`)
    }

    const skills = results[0].status === 'fulfilled' ? results[0].value : []
    const nextExtractWorkflows = results[1].status === 'fulfilled' ? results[1].value : []
    const nextMattingWorkflows = results[2].status === 'fulfilled' ? results[2].value : []
    const nextInstances = results[3].status === 'fulfilled' ? results[3].value : []
    const nextPlatforms = results[4].status === 'fulfilled' ? results[4].value : []
    const nextLanguages = results[5].status === 'fulfilled' ? results[5].value : []
    const nextTitleModels = results[6].status === 'fulfilled' ? results[6].value : []
    const nextGenerationSettings = results[7].status === 'fulfilled' ? results[7].value : null
    const runs = results[8].status === 'fulfilled' ? results[8].value : []
    const nextDetectionConfig = results[9].status === 'fulfilled' ? results[9].value : null

    setGenerationSkills(skills)
    setExtractWorkflows(nextExtractWorkflows.map(optionFromWorkflow))
    setMattingWorkflows(nextMattingWorkflows.map(optionFromWorkflow))
    setChenyuInstances(nextInstances)
    setPlatforms(nextPlatforms)
    setLanguages(nextLanguages)
    setTitleModels(nextTitleModels)
    setGenerationSettings(nextGenerationSettings)
    setRecentRuns(runs)
    setDetectionConfig(nextDetectionConfig)
  }, [])

  useEffect(() => {
    void refreshOptions().catch((nextError) =>
      setError(nextError instanceof Error ? nextError.message : '读取完整任务配置失败'),
    )
  }, [refreshOptions])

  useEffect(() => {
    return window.api.pipeline.onProgress((nextProgress) => {
      if (!currentRunId || nextProgress.run_id === currentRunId) {
        setProgress(nextProgress)
        setPipelinePreviewImages(nextProgress.preview_images ?? [])
        setMessage(nextProgress.message)
      }
    })
  }, [currentRunId])

  useEffect(() => {
    return window.api.pipeline.onCompleted((event) => {
      if (event.ok) {
        setCurrentRunId(event.result.run.id)
        setProgress((current) =>
          current
            ? { ...current, status: event.result.run.status, steps: event.result.steps }
            : current,
        )
        setMessage(event.result.run.status === 'completed' ? '完整任务完成' : '完整任务已结束')
        setError(event.result.run.error_summary)
      } else {
        setError(event.error)
        setMessage('完整任务失败')
      }
      setRunning(false)
      void refreshOptions()
    })
  }, [refreshOptions])

  useEffect(() => {
    if (grsaiModelOptions.length === 0) {
      return
    }
    if (!grsaiModelOptions.some((item) => item.id === grsaiModel)) {
      setGrsaiModel(grsaiModelOptions[0]?.id ?? 'gpt-image-2')
    }
  }, [grsaiModel, grsaiModelOptions])

  useEffect(() => {
    if (!selectedGrsaiModel?.sizes.length) {
      return
    }
    if (!selectedGrsaiModel.sizes.includes(aspectRatio)) {
      setAspectRatio(selectedGrsaiModel.sizes[0] ?? '1024x1024')
    }
  }, [aspectRatio, selectedGrsaiModel])

  useEffect(() => {
    if (promptMode !== 'ai' || promptModelOptions.length === 0) {
      if (promptMode === 'ai' && promptModelOptions.length === 0) {
        setPromptModel('')
      }
      return
    }
    if (!promptModelOptions.some((item) => item.key === promptModel)) {
      setPromptModel(promptModelOptions[0]?.key ?? '')
    }
  }, [promptModel, promptModelOptions, promptMode])

  useEffect(() => {
    if (
      sourceMode !== 'collection' ||
      extractProvider !== 'grsai' ||
      extractSkillOptions.length === 0
    ) {
      if (
        sourceMode === 'collection' &&
        extractProvider === 'grsai' &&
        extractSkillOptions.length === 0
      ) {
        setExtractSkillId('')
      }
      return
    }
    if (!extractSkillOptions.some((item) => item.key === extractSkillId)) {
      setExtractSkillId(extractSkillOptions[0]?.key ?? '')
    }
  }, [extractProvider, extractSkillId, extractSkillOptions, sourceMode])

  useEffect(() => {
    if (sourceMode !== 'collection' || extractProvider !== 'comfyui-chenyu') {
      return
    }
    const fallback = selectFallbackChenyuInstance(chenyuInstances)
    if (!fallback) {
      setExtractInstanceUuid('')
      return
    }
    if (!runningInstances.some((instance) => instance.instanceUuid === extractInstanceUuid)) {
      setExtractInstanceUuid(fallback.instanceUuid)
    }
  }, [chenyuInstances, extractInstanceUuid, extractProvider, runningInstances, sourceMode])

  useEffect(() => {
    if (!mattingEnabled) {
      return
    }
    const fallback = selectFallbackChenyuInstance(chenyuInstances)
    if (!fallback) {
      setMattingInstanceUuid('')
      return
    }
    if (!runningInstances.some((instance) => instance.instanceUuid === mattingInstanceUuid)) {
      setMattingInstanceUuid(fallback.instanceUuid)
    }
  }, [chenyuInstances, mattingEnabled, mattingInstanceUuid, runningInstances])

  useEffect(() => {
    if (sourceMode === 'collection' || promptMode !== 'ai' || promptSkillOptions.length === 0) {
      if (promptMode === 'ai' && promptSkillOptions.length === 0) {
        setPromptSkillId('')
      }
      return
    }
    if (!promptSkillOptions.some((item) => item.key === promptSkillId)) {
      setPromptSkillId(promptSkillOptions[0]?.key ?? '')
    }
  }, [promptMode, promptSkillId, promptSkillOptions, sourceMode])

  useEffect(() => {
    const firstPlatform = platforms[0]
    if (firstPlatform && !platforms.some((item) => item.key === titlePlatform)) {
      setTitlePlatform(firstPlatform.key)
    }
  }, [platforms, titlePlatform])

  useEffect(() => {
    const firstLanguage = languages[0]
    if (firstLanguage && !languages.some((item) => item.key === titleLanguage)) {
      setTitleLanguage(firstLanguage.key)
    }
  }, [languages, titleLanguage])

  useEffect(() => {
    const firstTitleModel = titleModels[0]
    if (firstTitleModel && !titleModels.some((item) => item.key === titleModel)) {
      setTitleModel(firstTitleModel.key)
    }
  }, [titleModel, titleModels])

  useEffect(() => {
    if (sourceMode === 'txt2img' || !sourceFolder.trim()) {
      setSourcePreviewImages([])
      setSourcePreviewError(null)
      return
    }
    void scanSourcePreview(sourceFolder)
  }, [sourceFolder, sourceMode])

  function updatePrintMode(nextMode: PipelinePrintMode) {
    setPrintMode(nextMode)
    setMattingEnabled(nextMode === 'local')
  }

  function updateSourceMode(nextMode: TaskSourceMode) {
    setPromptRequirementOpen(false)
    setSourceMode(nextMode)
  }

  function updatePromptMode(nextMode: PipelinePromptMode) {
    setPromptRequirementOpen(false)
    setPromptMode(nextMode)
  }

  async function chooseSourceFolder() {
    const selected = await window.api.generation.chooseImageFolder()
    if (selected.ok) {
      setSourceFolder(selected.data.path)
    }
  }

  async function scanSourcePreview(folder = sourceFolder) {
    if (!folder.trim() || sourceMode === 'txt2img') {
      setSourcePreviewImages([])
      return
    }
    setSourcePreviewLoading(true)
    setSourcePreviewError(null)
    try {
      const images = await window.api.generation.scanImageFolder({ folder })
      setSourcePreviewImages(images)
    } catch (scanError) {
      setSourcePreviewImages([])
      setSourcePreviewError(scanError instanceof Error ? scanError.message : '检索图片失败')
    } finally {
      setSourcePreviewLoading(false)
    }
  }

  async function chooseTemplates() {
    const selected = await window.api.photoshop.chooseTemplates()
    if (selected.ok) {
      setTemplatePaths(selected.data.paths)
    }
  }

  async function chooseOutputRoot() {
    const selected = await window.api.photoshop.chooseOutputFolder()
    if (selected.ok) {
      setOutputRoot(selected.data.path)
    }
  }

  function buildPromptConfig(): PipelinePromptConfig {
    if (promptMode === 'manual') {
      return {
        mode: 'manual',
        prompts: splitLines(manualPrompts),
      }
    }
    return {
      mode: 'ai',
      requirement: promptRequirement,
      count: numberFromText(promptCount, 5),
      model: promptModel,
      ...(sourceMode === 'img2img' && selectedImg2imgReferenceMode?.instruction
        ? { modeInstruction: selectedImg2imgReferenceMode.instruction }
        : {}),
      ...(nonEmpty(promptSkillId) ? { skillId: promptSkillId.trim() } : {}),
    }
  }

  function buildSourceConfig(): PipelineRunConfig['source'] {
    const grsai = {
      model: grsaiModel,
      aspectRatio,
      concurrency: numberFromText(grsaiConcurrency, 20),
    }
    if (sourceMode === 'collection') {
      return {
        mode: 'collection',
        sourceFolder,
        extract:
          extractProvider === 'grsai'
            ? {
                provider: 'grsai',
                ...(nonEmpty(extractSkillId) ? { skillId: extractSkillId.trim() } : {}),
                grsai,
              }
            : {
                provider: 'comfyui-chenyu',
                comfyui: {
                  workflowId: extractWorkflowId,
                  instanceUuid: extractInstanceUuid,
                  width: numberFromText(width, 1024),
                  height: numberFromText(height, 1024),
                  concurrency: 1,
                },
              },
      }
    }
    if (sourceMode === 'txt2img') {
      return {
        mode: 'txt2img',
        provider: 'grsai',
        prompt: buildPromptConfig(),
        grsai,
      }
    }
    return {
      mode: 'img2img',
      provider: 'grsai',
      sourceFolder,
      prompt: buildPromptConfig(),
      sendReferenceImages: true,
      grsai,
    }
  }

  function buildDetectionConfig(): NonNullable<PipelineRunConfig['detection']> {
    const base = detectionConfig ?? {
      threshold: { passMax: 39, reviewMax: 69 },
      skillId: '',
      skillVersion: '',
      model: 'qwen3.6-flash',
      variables: {},
    }
    return {
      enabled: detectionEnabled,
      allowReview: detectionPassRule === 'allow-review',
      skillId: base.skillId,
      skillVersion: base.skillVersion,
      model: base.model,
      variables: base.variables,
      threshold: base.threshold,
      concurrency: 20,
      maxRetries: 1,
      preprocess: {
        ...DEFAULT_DETECTION_PREPROCESS,
        compress: detectionCompression,
      },
    }
  }

  function buildConfig(): PipelineRunConfig {
    return {
      ...(nonEmpty(name) ? { name: name.trim() } : {}),
      ...(nonEmpty(printSkuCode) ? { printSkuCode: printSkuCode.trim() } : {}),
      printMode,
      source: buildSourceConfig(),
      matting: {
        enabled: mattingEnabled,
        mode: 'comfyui',
        ...(nonEmpty(mattingWorkflowId) ? { workflowId: mattingWorkflowId.trim() } : {}),
        ...(nonEmpty(mattingInstanceUuid) ? { instanceUuid: mattingInstanceUuid.trim() } : {}),
        width: numberFromText(width, 1024),
        height: numberFromText(height, 1024),
      },
      detection: buildDetectionConfig(),
      photoshop: {
        templates: templatePaths,
        ...(nonEmpty(outputRoot) ? { outputRoot: outputRoot.trim() } : {}),
        replaceRange,
        format,
        clipMode,
        skipCompleted,
        maxRetries: numberFromText(photoshopMaxRetries, 1),
      },
      title: {
        platform: titlePlatform,
        language: titleLanguage,
        model: titleModel,
        titleFileName,
        imageIndex: numberFromText(titleImageIndex, 1),
        existingStrategy: titleExistingStrategy,
        maxRetries: numberFromText(titleMaxRetries, 2),
        ...(nonEmpty(extraRequirement) ? { extraRequirement: extraRequirement.trim() } : {}),
        ...(nonEmpty(titlePrefix) ? { titlePrefix: titlePrefix.trim() } : {}),
        ...(nonEmpty(titleSuffix) ? { titleSuffix: titleSuffix.trim() } : {}),
        ...(titleSeparator ? { titleSeparator } : {}),
        preprocess: {
          compression: titleCompression,
          maxSize: numberFromText(titleMaxSize, 1024),
          format: 'jpg',
          quality: 85,
        },
      },
    }
  }

  async function runPipeline() {
    if (validationIssues.length > 0) {
      setError(validationIssues[0] ?? '请先补齐完整任务配置')
      return
    }
    setError(null)
    setPipelinePreviewImages([])
    setMessage('正在提交完整任务')
    try {
      const runId = await window.api.pipeline.run(buildConfig())
      setCurrentRunId(runId)
      setRunning(true)
      setMessage('完整任务已启动')
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : '完整任务启动失败')
    }
  }

  async function cancelPipeline() {
    if (!currentRunId) {
      return
    }
    const result = await window.api.pipeline.cancel({ run_id: currentRunId })
    if (!result.ok) {
      setError('当前完整任务已结束，无法取消')
      return
    }
    setMessage('已请求取消，当前步骤结束后停止')
  }

  return (
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_520px]">
      <div className="space-y-5">
        {isMac ? (
          <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
            PS 套版 v1 仅支持 Windows，当前电脑不能启动完整任务。
          </div>
        ) : null}
        {error ? (
          <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
          </div>
        ) : null}

        <Card>
          <CardHeader className="pb-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <CardTitle className="flex items-center gap-2 text-lg text-balance">
                  <WandSparkles className="size-5" />
                  完整任务
                </CardTitle>
                <CardDescription>少配参数，右侧直接看来源和运行产物。</CardDescription>
              </div>
              <Badge variant="secondary">可视化</Badge>
            </div>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_minmax(180px,260px)_220px]">
              <Field label="任务名">
                <Input
                  onChange={(event) => setName(event.target.value)}
                  placeholder="可选"
                  value={name}
                />
              </Field>
              <Field label="印花货号">
                <Input
                  onChange={(event) => setPrintSkuCode(event.target.value)}
                  placeholder="例如 TY-001"
                  value={printSkuCode}
                />
              </Field>
              <SelectField
                label="印花类型"
                onValueChange={(value) => updatePrintMode(value as PipelinePrintMode)}
                options={[
                  { key: 'local', label: '局部印花' },
                  { key: 'full', label: '满印' },
                ]}
                value={printMode}
              />
            </div>

            <div className="rounded-md border bg-muted/20 p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-medium text-muted-foreground">印花来源</p>
                  <h2 className="mt-1 text-lg font-semibold">来源准备</h2>
                  <p className="mt-1 text-sm text-muted-foreground">
                    采集+提取、文生图、图生图只保留各自需要的设置。
                  </p>
                </div>
                <Badge variant="secondary">{sourceBadgeLabel}</Badge>
              </div>

              <Tabs
                className="mt-4"
                onValueChange={(value) => updateSourceMode(value as TaskSourceMode)}
                value={sourceMode}
              >
                <TabsList className="grid w-full grid-cols-3">
                  {sourceModeOptions.map((option) => (
                    <TabsTrigger key={option.key} value={option.key}>
                      {option.label}
                    </TabsTrigger>
                  ))}
                </TabsList>
              </Tabs>

              <div className="mt-5 space-y-4">
                {sourceMode === 'collection' ? (
                  <>
                    <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_auto]">
                      <Field label={sourceFolderLabel}>
                        <Input
                          onChange={(event) => setSourceFolder(event.target.value)}
                          placeholder={sourceFolderPlaceholder}
                          value={sourceFolder}
                        />
                      </Field>
                      <Button
                        className="mt-7 h-10"
                        onClick={() => void chooseSourceFolder()}
                        variant="outline"
                      >
                        <FolderOpen className="mr-2 h-4 w-4" />
                        选择
                      </Button>
                    </div>

                    <div className="grid gap-4 lg:grid-cols-3">
                      <SelectField
                        label="提取方式"
                        onValueChange={(value) => setExtractProvider(value as ExtractProvider)}
                        options={[
                          { key: 'grsai', label: '付费模型' },
                          { key: 'comfyui-chenyu', label: '晨羽智云' },
                        ]}
                        value={extractProvider}
                      />
                      {extractProvider === 'grsai' ? (
                        <SelectField
                          label="提取 Skill"
                          onValueChange={setExtractSkillId}
                          options={extractSkillOptions}
                          value={extractSkillId}
                        />
                      ) : (
                        <SelectField
                          label="晨羽工作流"
                          onValueChange={setExtractWorkflowId}
                          options={extractWorkflows}
                          value={extractWorkflowId}
                        />
                      )}
                      {extractProvider === 'grsai' ? (
                        <SelectField
                          label="Grsai 模型"
                          onValueChange={setGrsaiModel}
                          options={grsaiModelOptions.map((item) => ({
                            key: item.id,
                            label: item.label,
                          }))}
                          value={grsaiModel}
                        />
                      ) : (
                        <SelectField
                          label="晨羽实例"
                          onValueChange={setExtractInstanceUuid}
                          options={runningInstanceOptions}
                          value={extractInstanceUuid}
                        />
                      )}
                    </div>

                    {extractProvider === 'grsai' ? (
                      <div className="grid gap-4 md:grid-cols-3">
                        <Field label="尺寸 / 比例">
                          <Input
                            onChange={(event) => setAspectRatio(event.target.value)}
                            placeholder={grsaiSizeOptions.slice(0, 3).join(' / ')}
                            value={aspectRatio}
                          />
                        </Field>
                        <Field label="并发">
                          <Input
                            className="tabular-nums"
                            onChange={(event) => setGrsaiConcurrency(event.target.value)}
                            type="number"
                            value={grsaiConcurrency}
                          />
                        </Field>
                        <div className="flex items-end text-xs text-muted-foreground">
                          采集后会先提取，再把原图变成可套版印花。
                        </div>
                      </div>
                    ) : (
                      <div className="grid gap-4 md:grid-cols-3">
                        <Field label="宽">
                          <Input
                            className="tabular-nums"
                            onChange={(event) => setWidth(event.target.value)}
                            type="number"
                            value={width}
                          />
                        </Field>
                        <Field label="高">
                          <Input
                            className="tabular-nums"
                            onChange={(event) => setHeight(event.target.value)}
                            type="number"
                            value={height}
                          />
                        </Field>
                        <div className="flex items-end text-xs text-muted-foreground">
                          晨羽路径要先配好运行云机和工作流。
                        </div>
                      </div>
                    )}
                  </>
                ) : null}

                {sourceMode === 'txt2img' ? (
                  <>
                    <div className="flex flex-wrap items-center gap-2 text-sm">
                      <Badge variant="secondary">固定付费模型</Badge>
                      <span className="text-muted-foreground">只需要选提示词和 Grsai 参数。</span>
                    </div>
                    <div className="grid gap-4 lg:grid-cols-3">
                      <SelectField
                        label="提示词模式"
                        onValueChange={(value) => updatePromptMode(value as PipelinePromptMode)}
                        options={promptModeOptions}
                        value={promptMode}
                      />
                      {promptMode === 'ai' ? (
                        <SelectField
                          label="提示词模型"
                          onValueChange={setPromptModel}
                          options={promptModelOptions}
                          value={promptModel}
                        />
                      ) : (
                        <div className="flex items-end rounded-md border border-dashed px-3 py-2 text-sm text-muted-foreground">
                          手写模式只需要填写提示词。
                        </div>
                      )}
                    </div>

                    {promptMode === 'manual' ? (
                      <Field label="提示词">
                        <Textarea
                          onChange={(event) => setManualPrompts(event.target.value)}
                          placeholder="每行一条提示词"
                          value={manualPrompts}
                        />
                      </Field>
                    ) : (
                      <div className="grid gap-4 lg:grid-cols-3">
                        <SelectField
                          label="提示词 Skill"
                          onValueChange={setPromptSkillId}
                          options={promptSkillOptions}
                          value={promptSkillId}
                        />
                        <PromptRequirementField
                          id="txt2img-print-requirement"
                          onOpenChange={setPromptRequirementOpen}
                          onValueChange={setPromptRequirement}
                          open={promptRequirementOpen}
                          value={promptRequirement}
                        />
                        <Field label="数量">
                          <Input
                            className="tabular-nums"
                            onChange={(event) => setPromptCount(event.target.value)}
                            type="number"
                            value={promptCount}
                          />
                        </Field>
                      </div>
                    )}

                    <div className="grid gap-4 md:grid-cols-3">
                      <SelectField
                        label="Grsai 模型"
                        onValueChange={setGrsaiModel}
                        options={grsaiModelOptions.map((item) => ({
                          key: item.id,
                          label: item.label,
                        }))}
                        value={grsaiModel}
                      />
                      <Field label="尺寸 / 比例">
                        <Input
                          onChange={(event) => setAspectRatio(event.target.value)}
                          placeholder={grsaiSizeOptions.slice(0, 3).join(' / ')}
                          value={aspectRatio}
                        />
                      </Field>
                      <Field label="并发">
                        <Input
                          className="tabular-nums"
                          onChange={(event) => setGrsaiConcurrency(event.target.value)}
                          type="number"
                          value={grsaiConcurrency}
                        />
                      </Field>
                    </div>
                  </>
                ) : null}

                {sourceMode === 'img2img' ? (
                  <>
                    <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_auto]">
                      <Field label={sourceFolderLabel}>
                        <Input
                          onChange={(event) => setSourceFolder(event.target.value)}
                          placeholder={sourceFolderPlaceholder}
                          value={sourceFolder}
                        />
                      </Field>
                      <Button
                        className="mt-7 h-10"
                        onClick={() => void chooseSourceFolder()}
                        variant="outline"
                      >
                        <FolderOpen className="mr-2 h-4 w-4" />
                        选择
                      </Button>
                    </div>

                    <div className="flex flex-wrap items-center gap-2 text-sm">
                      <Badge variant="secondary">固定付费模型</Badge>
                      <span className="text-muted-foreground">
                        图生图会把参考图一起送给 Grsai。
                      </span>
                    </div>

                    <SelectField
                      label="参考方式"
                      onValueChange={(value) =>
                        setImg2imgReferenceMode(value as Img2imgReferenceMode)
                      }
                      options={img2imgReferenceModes.map((item) => ({
                        key: item.key,
                        label: item.label,
                      }))}
                      value={img2imgReferenceMode}
                    />

                    <div className="grid gap-4 lg:grid-cols-3">
                      <SelectField
                        label="提示词模式"
                        onValueChange={(value) => updatePromptMode(value as PipelinePromptMode)}
                        options={promptModeOptions}
                        value={promptMode}
                      />
                      {promptMode === 'ai' ? (
                        <SelectField
                          label="提示词模型"
                          onValueChange={setPromptModel}
                          options={promptModelOptions}
                          value={promptModel}
                        />
                      ) : (
                        <div className="lg:col-span-2 flex items-end rounded-md border border-dashed px-3 py-2 text-sm text-muted-foreground">
                          手写模式只需要填写提示词。
                        </div>
                      )}
                    </div>

                    {promptMode === 'manual' ? (
                      <Field label="提示词">
                        <Textarea
                          onChange={(event) => setManualPrompts(event.target.value)}
                          placeholder="每行一条提示词"
                          value={manualPrompts}
                        />
                      </Field>
                    ) : (
                      <div className="grid gap-4 lg:grid-cols-3">
                        <SelectField
                          label="提示词 Skill"
                          onValueChange={setPromptSkillId}
                          options={promptSkillOptions}
                          value={promptSkillId}
                        />
                        <PromptRequirementField
                          id="img2img-print-requirement"
                          onOpenChange={setPromptRequirementOpen}
                          onValueChange={setPromptRequirement}
                          open={promptRequirementOpen}
                          value={promptRequirement}
                        />
                        <Field label="数量">
                          <Input
                            className="tabular-nums"
                            onChange={(event) => setPromptCount(event.target.value)}
                            type="number"
                            value={promptCount}
                          />
                        </Field>
                      </div>
                    )}

                    <div className="grid gap-4 md:grid-cols-3">
                      <SelectField
                        label="Grsai 模型"
                        onValueChange={setGrsaiModel}
                        options={grsaiModelOptions.map((item) => ({
                          key: item.id,
                          label: item.label,
                        }))}
                        value={grsaiModel}
                      />
                      <Field label="尺寸 / 比例">
                        <Input
                          onChange={(event) => setAspectRatio(event.target.value)}
                          placeholder={grsaiSizeOptions.slice(0, 3).join(' / ')}
                          value={aspectRatio}
                        />
                      </Field>
                      <Field label="并发">
                        <Input
                          className="tabular-nums"
                          onChange={(event) => setGrsaiConcurrency(event.target.value)}
                          type="number"
                          value={grsaiConcurrency}
                        />
                      </Field>
                    </div>
                  </>
                ) : null}
              </div>
            </div>

            <Card>
              <CardHeader className="pb-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <CardTitle className="text-lg">是否抠图</CardTitle>
                    <CardDescription>抠图固定走 ComfyUI 晨羽工作流。</CardDescription>
                  </div>
                  <label
                    className="flex items-center gap-2 rounded-md border px-3 py-2 text-sm font-medium"
                    htmlFor="matting-enabled"
                  >
                    <Checkbox
                      aria-label="启用抠图"
                      id="matting-enabled"
                      checked={mattingEnabled}
                      onCheckedChange={(checked) => setMattingEnabled(Boolean(checked))}
                    />
                    启用抠图
                  </label>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                {mattingEnabled ? (
                  <AdvancedDisclosure summary="抠图设置">
                    <div className="flex flex-wrap items-center gap-2 text-sm">
                      <Badge variant="secondary">仅晨羽工作流</Badge>
                      <span className="text-muted-foreground">
                        需要先配置运行云机和抠图工作流。
                      </span>
                    </div>
                    <div className="grid gap-4 lg:grid-cols-3">
                      <SelectField
                        label="抠图工作流"
                        onValueChange={setMattingWorkflowId}
                        options={mattingWorkflows}
                        value={mattingWorkflowId}
                      />
                      <SelectField
                        label="晨羽实例"
                        onValueChange={setMattingInstanceUuid}
                        options={runningInstanceOptions}
                        value={mattingInstanceUuid}
                      />
                      <Field label="宽">
                        <Input
                          className="tabular-nums"
                          onChange={(event) => setWidth(event.target.value)}
                          type="number"
                          value={width}
                        />
                      </Field>
                    </div>
                    <div className="grid gap-4 lg:grid-cols-3">
                      <Field label="高">
                        <Input
                          className="tabular-nums"
                          onChange={(event) => setHeight(event.target.value)}
                          type="number"
                          value={height}
                        />
                      </Field>
                      <div className="lg:col-span-2 flex items-end rounded-md border border-dashed px-3 py-2 text-sm text-muted-foreground">
                        关闭后会直接进入侵权检测、套版和标题。
                      </div>
                    </div>
                  </AdvancedDisclosure>
                ) : (
                  <div className="rounded-md border border-dashed px-3 py-4 text-sm text-muted-foreground">
                    已关闭抠图，后续步骤会直接进入侵权检测和套版。
                  </div>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <CardTitle className="text-lg">侵权检测 / 套版 / 标题</CardTitle>
                    <CardDescription>检测可选，后面两步固定顺序执行。</CardDescription>
                  </div>
                  <Badge variant="secondary">后续流程</Badge>
                </div>
              </CardHeader>
              <CardContent className="space-y-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-medium text-muted-foreground">侵权检测</p>
                    <p className="mt-1 text-sm text-muted-foreground">
                      勾选后会复用单独的检测设置面板。
                    </p>
                  </div>
                  <label
                    className="flex items-center gap-2 rounded-md border px-3 py-2 text-sm font-medium"
                    htmlFor="detection-enabled"
                  >
                    <Checkbox
                      aria-label="启用侵权检测"
                      id="detection-enabled"
                      checked={detectionEnabled}
                      onCheckedChange={(checked) => setDetectionEnabled(Boolean(checked))}
                    />
                    启用检测
                  </label>
                </div>

                {detectionEnabled ? (
                  <div className="space-y-4">
                    <SelectField
                      label="通过要求"
                      onValueChange={(value) => setDetectionPassRule(value as DetectionPassRule)}
                      options={[
                        { key: 'allow-review', label: '无风险 + 疑似通过' },
                        { key: 'pass-only', label: '仅无风险通过' },
                      ]}
                      value={detectionPassRule}
                    />
                    <div className="grid gap-3 rounded-md border bg-muted/20 p-3 text-sm text-muted-foreground md:grid-cols-3">
                      <div>
                        <p className="text-xs">检测模型</p>
                        <p className="mt-1 truncate font-medium text-foreground">
                          {detectionConfig?.model || '未加载'}
                        </p>
                      </div>
                      <div>
                        <p className="text-xs">检测 Skill</p>
                        <p className="mt-1 truncate font-medium text-foreground">
                          {detectionConfig?.skillId || '未选择'}
                        </p>
                      </div>
                      <label className="flex items-center gap-2" htmlFor="detection-compression">
                        <Checkbox
                          checked={detectionCompression}
                          id="detection-compression"
                          onCheckedChange={(checked) => setDetectionCompression(Boolean(checked))}
                        />
                        压缩图片
                      </label>
                    </div>
                  </div>
                ) : (
                  <div className="rounded-md border border-dashed px-3 py-4 text-sm text-muted-foreground">
                    已关闭侵权检测，后续会直接进入 PS 套版。
                  </div>
                )}

                <Separator />

                <AdvancedDisclosure summary="PS 套版设置">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="text-sm font-medium text-muted-foreground">PS 套版</p>
                      <p className="mt-1 text-sm text-muted-foreground">
                        选择模板和输出目录，其他参数沿用现有模块设置。
                      </p>
                    </div>
                    <Badge variant="secondary">Windows only</Badge>
                  </div>

                  <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_auto_auto]">
                    <Field label="PSD 模板">
                      <Input readOnly value={templatePaths.join('；')} />
                    </Field>
                    <Button
                      className="mt-7 h-10"
                      onClick={() => void chooseTemplates()}
                      variant="outline"
                    >
                      <FolderOpen className="mr-2 h-4 w-4" />
                      选择模板
                    </Button>
                    <Button
                      className="mt-7 h-10"
                      onClick={() => setTemplatePaths([])}
                      variant="ghost"
                    >
                      清空
                    </Button>
                  </div>

                  <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_auto]">
                    <Field label="套版输出目录">
                      <Input
                        onChange={(event) => setOutputRoot(event.target.value)}
                        placeholder="留空则写入 04-上架工作区"
                        value={outputRoot}
                      />
                    </Field>
                    <Button
                      className="mt-7 h-10"
                      onClick={() => void chooseOutputRoot()}
                      variant="outline"
                    >
                      <FolderOpen className="mr-2 h-4 w-4" />
                      选择
                    </Button>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <label
                      className="flex items-center gap-2 rounded-md border px-3 py-2 text-sm font-medium"
                      htmlFor="skip-completed"
                    >
                      <Checkbox
                        aria-label="跳过已完成"
                        id="skip-completed"
                        checked={skipCompleted}
                        onCheckedChange={(checked) => setSkipCompleted(Boolean(checked))}
                      />
                      跳过已完成
                    </label>
                  </div>

                  <div className="grid gap-4 lg:grid-cols-4">
                    <SelectField
                      label="替换范围"
                      onValueChange={(value) => setReplaceRange(value as 'auto' | 'top' | 'all')}
                      options={[
                        { key: 'auto', label: '自动识别' },
                        { key: 'top', label: '顶层智能对象' },
                        { key: 'all', label: '全部智能对象' },
                      ]}
                      value={replaceRange}
                    />
                    <SelectField
                      label="裁切模式"
                      onValueChange={(value) => setClipMode(value as 'auto' | 'guides' | 'none')}
                      options={[
                        { key: 'auto', label: '自动裁切' },
                        { key: 'guides', label: '参考辅助线' },
                        { key: 'none', label: '不裁切' },
                      ]}
                      value={clipMode}
                    />
                    <SelectField
                      label="导出格式"
                      onValueChange={(value) => setFormat(value as 'jpg' | 'png')}
                      options={[
                        { key: 'jpg', label: 'JPG' },
                        { key: 'png', label: 'PNG' },
                      ]}
                      value={format}
                    />
                    <Field label="失败重试">
                      <Input
                        className="tabular-nums"
                        min={0}
                        max={5}
                        onChange={(event) => setPhotoshopMaxRetries(event.target.value)}
                        type="number"
                        value={photoshopMaxRetries}
                      />
                    </Field>
                  </div>
                </AdvancedDisclosure>

                <Separator />

                <AdvancedDisclosure summary="标题生成设置">
                  <div>
                    <p className="text-sm font-medium text-muted-foreground">标题生成</p>
                    <p className="mt-1 text-sm text-muted-foreground">
                      直接扫描套版后的货号文件夹并写入标题表。
                    </p>
                  </div>

                  <div className="grid gap-4 md:grid-cols-3">
                    <SelectField
                      label="标题平台"
                      onValueChange={setTitlePlatform}
                      options={platforms}
                      value={titlePlatform}
                    />
                    <SelectField
                      label="标题语言"
                      onValueChange={setTitleLanguage}
                      options={languages}
                      value={titleLanguage}
                    />
                    <SelectField
                      label="标题模型"
                      onValueChange={setTitleModel}
                      options={titleModels}
                      value={titleModel}
                    />
                  </div>

                  <div className="grid gap-4 md:grid-cols-3">
                    <Field label="标题文件名">
                      <Input
                        onChange={(event) => setTitleFileName(event.target.value)}
                        value={titleFileName}
                      />
                    </Field>
                    <Field label="取第几张">
                      <Input
                        className="tabular-nums"
                        min={1}
                        onChange={(event) => setTitleImageIndex(event.target.value)}
                        type="number"
                        value={titleImageIndex}
                      />
                    </Field>
                    <Field label="最大边长">
                      <Input
                        className="tabular-nums"
                        min={256}
                        onChange={(event) => setTitleMaxSize(event.target.value)}
                        type="number"
                        value={titleMaxSize}
                      />
                    </Field>
                  </div>

                  <div className="grid gap-4 md:grid-cols-3">
                    <Field label="前缀">
                      <Input
                        onChange={(event) => setTitlePrefix(event.target.value)}
                        placeholder="默认不填"
                        value={titlePrefix}
                      />
                    </Field>
                    <Field label="后缀">
                      <Input
                        onChange={(event) => setTitleSuffix(event.target.value)}
                        placeholder="默认不填"
                        value={titleSuffix}
                      />
                    </Field>
                    <Field label="分隔符">
                      <Input
                        onChange={(event) => setTitleSeparator(event.target.value)}
                        placeholder="空格"
                        value={titleSeparator}
                      />
                    </Field>
                  </div>

                  <div className="grid gap-4 md:grid-cols-2">
                    <SelectField
                      label="已有标题策略"
                      onValueChange={(value) =>
                        setTitleExistingStrategy(value as TitleExistingStrategy)
                      }
                      options={[
                        { key: 'skip', label: '跳过已有' },
                        { key: 'regenerate', label: '重新生成' },
                      ]}
                      value={titleExistingStrategy}
                    />
                    <Field label="失败重试次数">
                      <Input
                        className="tabular-nums"
                        min={0}
                        max={5}
                        onChange={(event) => setTitleMaxRetries(event.target.value)}
                        type="number"
                        value={titleMaxRetries}
                      />
                    </Field>
                  </div>

                  <Field label="标题额外要求">
                    <Textarea
                      onChange={(event) => setExtraRequirement(event.target.value)}
                      placeholder="例如：强调原创设计、带 vintage 关键词"
                      value={extraRequirement}
                    />
                  </Field>

                  <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_320px]">
                    <Field label="图像预处理">
                      <div className="rounded-md border p-4">
                        <div className="space-y-3 text-sm">
                          <label
                            className="flex items-center gap-2 text-muted-foreground"
                            htmlFor="title-preprocess-flatten"
                          >
                            <Checkbox checked disabled id="title-preprocess-flatten" />
                            透明底自动加白
                          </label>
                          <label className="flex items-center gap-2" htmlFor="title-compression">
                            <Checkbox
                              checked={titleCompression}
                              id="title-compression"
                              onCheckedChange={(checked) => setTitleCompression(Boolean(checked))}
                            />
                            压缩图片节省费用
                          </label>
                        </div>
                      </div>
                    </Field>
                    <div className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">
                      标题生成会沿用当前平台、语言、模型和预处理设置。
                    </div>
                  </div>
                </AdvancedDisclosure>
              </CardContent>
            </Card>

            <div className="flex flex-wrap items-center gap-3">
              <Button
                disabled={!canStart}
                onClick={() => void runPipeline()}
                title={validationIssues[0] ?? undefined}
              >
                <Play className="mr-2 h-4 w-4" />
                启动完整任务
              </Button>
              <Button
                disabled={!running || !currentRunId}
                onClick={() => void cancelPipeline()}
                variant="outline"
              >
                <Square className="mr-2 h-4 w-4" />
                取消
              </Button>
              <Button onClick={() => void refreshOptions()} variant="ghost">
                <RefreshCw className="mr-2 h-4 w-4" />
                刷新选项
              </Button>
              <span className="text-sm text-muted-foreground">{message}</span>
            </div>
          </CardContent>
        </Card>
      </div>

      <aside className="space-y-5">
        <PipelineEffectPreview
          currentStep={progress?.current_step ?? null}
          message={message}
          previewImages={workflowPreviewImages}
          progress={progress}
          promptLines={promptLines}
          promptMode={promptMode}
          sourceError={sourcePreviewError}
          sourceFolder={sourceFolder}
          sourceImages={sourcePreviewImages}
          sourceLoading={sourcePreviewLoading}
          sourceMode={sourceMode}
        />

        <Card>
          <CardHeader className="pb-4">
            <CardTitle className="text-base">最近完整任务</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {recentRuns.length === 0 ? (
              <div className="text-sm text-muted-foreground">暂无历史记录。</div>
            ) : (
              recentRuns.slice(0, 8).map((run) => (
                <div className="rounded-md border px-3 py-2 text-sm" key={run.id}>
                  <div className="flex items-center justify-between gap-3">
                    <span className="truncate font-medium">{run.name}</span>
                    <span className="shrink-0 text-xs text-muted-foreground">{run.status}</span>
                  </div>
                  <div className="mt-1 truncate text-xs text-muted-foreground">
                    {run.source_mode}
                  </div>
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </aside>
    </div>
  )
}
