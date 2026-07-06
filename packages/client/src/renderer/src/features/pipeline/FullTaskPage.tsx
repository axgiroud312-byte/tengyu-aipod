import { ImageLightbox, type ImageLightboxItem } from '@/components/image-lightbox'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
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
import {
  finalPipelineResult,
  pipelineResultStats,
  sectionItemsForLightbox,
  selectedPipelineResultPreview,
} from '@/features/pipeline/pipeline-result-preview'
import {
  type TitleExistingStrategy,
  type TitleKeywordGroupDraft,
  createTitleKeywordGroupDraft,
} from '@/features/title/TitlePage'
import { fileUrlLocalPath, localImageUrl } from '@/lib/media'
import { useIpcMutation } from '@/lib/use-ipc'
import type {
  PipelineItemRecord,
  PipelinePrintMode,
  PipelineProgress,
  PipelinePromptConfig,
  PipelineResultImage,
  PipelineResultSection,
  PipelineRunConfig,
  PipelineRunDetail,
  PipelineRunRecord,
  PipelineRunStats,
  PipelineSourceMode,
  PipelineStartStep,
  SkillSummary,
} from '@tengyu-aipod/shared'
import {
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Folder,
  FolderOpen,
  ImageIcon,
  Loader2,
  Play,
  Plus,
  RefreshCw,
  Settings2,
  Sparkles,
  Square,
  Trash2,
  Upload,
  WandSparkles,
} from 'lucide-react'
import type { ReactNode } from 'react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { DetectionConfig } from '../../../../main/lib/detection-config'
import type { TitleKeywordGroup } from '../../../../main/lib/title-service'

type Option = {
  key: string
  label: string
}

type TaskSourceMode = PipelineSourceMode
type ExtractProvider = 'grsai' | 'comfyui-chenyu'
type Txt2imgProvider = 'grsai' | 'comfyui-chenyu'
type Img2imgProvider = 'grsai' | 'comfyui-chenyu'
type Img2imgReferenceMode = 'layout' | 'style' | 'layout-style'
type ComfyuiImg2imgPromptMode = 'ai' | 'workflow'
type DetectionPassRule = 'allow-review' | 'pass-only'
type GenerationSettingsSnapshot = Awaited<ReturnType<typeof window.api.generationSettings.get>>
type ChenyuManagedInstance = Awaited<ReturnType<typeof window.api.chenyu.listInstances>>[number]
type ReferenceImageDraft = {
  id: string
  name: string
  dataUrl: string
  base64: string
  mime_type: string
}
type FullTaskToggleSnapshot = {
  mattingEnabled: boolean
  detectionEnabled: boolean
  photoshopEnabled: boolean
  titleEnabled: boolean
}

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

const DEFAULT_PIPELINE_STATS: PipelineRunStats = {
  sourceImages: 0,
  prints: 0,
  detectionPass: 0,
  detectionReview: 0,
  detectionBlock: 0,
  photoshopGroups: 0,
  titleSucceeded: 0,
  titleFailed: 0,
}

const FULL_TASK_SESSION_PREFIX = 'tengyu-aipod:full-task:'

function readSessionState<T>(key: string, fallback: T): T {
  try {
    const value = window.sessionStorage.getItem(`${FULL_TASK_SESSION_PREFIX}${key}`)
    return value ? (JSON.parse(value) as T) : fallback
  } catch {
    return fallback
  }
}

function useFullTaskSessionState<T>(key: string, fallback: T) {
  const [value, setValue] = useState<T>(() => readSessionState(key, fallback))

  useEffect(() => {
    try {
      window.sessionStorage.setItem(`${FULL_TASK_SESSION_PREFIX}${key}`, JSON.stringify(value))
    } catch {
      // 会话草稿只是便利功能，写入失败时不阻断完整任务。
    }
  }, [key, value])

  return [value, setValue] as const
}

function parsePipelineStats(value: string): PipelineRunStats {
  try {
    return { ...DEFAULT_PIPELINE_STATS, ...(JSON.parse(value) as Partial<PipelineRunStats>) }
  } catch {
    return { ...DEFAULT_PIPELINE_STATS }
  }
}

function pipelineRunMessage(detail: Pick<PipelineRunDetail['run'], 'status' | 'error_summary'>) {
  if (detail.error_summary) {
    return detail.error_summary
  }
  if (detail.status === 'running') {
    return '完整任务运行中'
  }
  if (detail.status === 'completed') {
    return '完整任务已完成'
  }
  if (detail.status === 'cancelled') {
    return '完整任务已取消，已完成产物已保留'
  }
  if (detail.status === 'interrupted') {
    return '完整任务已中断，已完成产物已保留'
  }
  return '完整任务已结束'
}

function progressFromRunDetail(detail: PipelineRunDetail): PipelineProgress {
  const runningStep = detail.steps.find((step) => step.status === 'running')
  const stats = parsePipelineStats(detail.run.stats_json)
  return {
    run_id: detail.run.id,
    status: detail.run.status,
    current_step: runningStep?.step_key ?? null,
    message: pipelineRunMessage(detail.run),
    stats,
    steps: detail.steps,
    items: detail.items ?? [],
    result_sections: detail.result_sections ?? [],
    logs: detail.logs ?? [],
  }
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
  { key: 'existing_prints', label: '已有印花' },
]

const existingPrintStartStepOptions: Array<{ key: PipelineStartStep; label: string }> = [
  { key: 'matting', label: '从抠图开始' },
  { key: 'detection', label: '从侵权检测开始' },
  { key: 'photoshop', label: '从 PS 套版开始' },
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
  placeholder = '请选择',
  value,
}: {
  label: string
  onValueChange: (value: string) => void
  options: Option[]
  placeholder?: string
  value: string
}) {
  return (
    <Field label={label}>
      <Select onValueChange={onValueChange} value={value}>
        <SelectTrigger className="min-w-0 [&>span]:min-w-0 [&>span]:truncate">
          <SelectValue placeholder={placeholder} />
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

function ChenyuInstanceSelectField({
  instances,
  loading,
  onRefresh,
  onValueChange,
  options,
  value,
}: {
  instances: ChenyuManagedInstance[]
  loading: boolean
  onRefresh: () => void
  onValueChange: (value: string) => void
  options: Option[]
  value: string
}) {
  const selectedInstance = instances.find((instance) => instance.instanceUuid === value) ?? null
  const selectedComfyuiUrl = selectedInstance ? instanceComfyuiUrl(selectedInstance) : ''

  return (
    <div className="grid min-w-0 gap-2 text-sm font-medium">
      <div className="flex items-center justify-between gap-2">
        <span>晨羽实例</span>
        <Button className="h-7 px-2 text-xs" disabled={loading} onClick={onRefresh} variant="ghost">
          {loading ? (
            <Loader2 className="mr-1 h-3 w-3 animate-spin" />
          ) : (
            <RefreshCw className="mr-1 h-3 w-3" />
          )}
          刷新
        </Button>
      </div>
      <Select onValueChange={onValueChange} value={value}>
        <SelectTrigger className="min-w-0 [&>span]:min-w-0 [&>span]:truncate">
          <SelectValue placeholder="暂无运行中云机" />
        </SelectTrigger>
        <SelectContent className="max-w-[min(28rem,var(--radix-select-trigger-width))]">
          {options.map((option) => (
            <SelectItem className="truncate" key={option.key} value={option.key}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <div className="min-h-8 space-y-1 text-xs font-normal text-muted-foreground">
        {options.length === 0 ? (
          <p>暂无运行中云机，请到设置页开机后点击刷新。</p>
        ) : selectedInstance ? (
          <>
            <p className="break-all font-mono">UUID: {selectedInstance.instanceUuid}</p>
            <p className="break-all font-mono">ComfyUI: {selectedComfyuiUrl || '未配置'}</p>
          </>
        ) : (
          <p>请选择本次任务使用的运行云机。</p>
        )}
      </div>
    </div>
  )
}

function PromptRequirementField({
  id,
  onOpenChange,
  onValueChange,
  open,
  label = '印花要求',
  value,
}: {
  id: string
  onOpenChange: (open: boolean) => void
  onValueChange: (value: string) => void
  open: boolean
  label?: string
  value: string
}) {
  const summary = value.trim().replace(/\s+/g, ' ')

  return (
    <div className="relative grid gap-2 text-sm font-medium">
      <span>{label}</span>
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

function ReferenceImagePicker({
  images,
  onAddFiles,
  onRemove,
}: {
  images: ReferenceImageDraft[]
  onAddFiles: (files: FileList | null) => void
  onRemove: (id: string) => void
}) {
  return (
    <div className="rounded-md border p-3">
      <label className="block space-y-2 text-sm font-medium">
        <span>参考图</span>
        <div className="flex min-h-10 items-center gap-3 rounded-md border border-dashed px-3 py-2">
          <Upload className="h-4 w-4 text-muted-foreground" />
          <input
            accept="image/*"
            className="block min-w-0 flex-1 text-sm"
            multiple
            onChange={(event) => {
              onAddFiles(event.target.files)
              event.currentTarget.value = ''
            }}
            type="file"
          />
        </div>
      </label>
      {images.length ? (
        <div className="mt-3 grid grid-cols-2 gap-2 md:grid-cols-4">
          {images.map((image) => (
            <div className="relative rounded-md border bg-muted p-2 text-xs" key={image.id}>
              <button
                aria-label={`删除参考图 ${image.name}`}
                className="absolute right-3 top-3 inline-flex h-7 w-7 items-center justify-center rounded-sm border bg-background/90 text-muted-foreground shadow-sm hover:text-red-600"
                onClick={() => onRemove(image.id)}
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
  )
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

function optionFromSkill(skill: SkillSummary): Option {
  return {
    key: skillVersionOptionKey(skill),
    label: `${skillTitle(skill)}${skill.version ? ` · ${skill.version}` : ''}`,
  }
}

function skillVersionOptionKey(skill: Pick<SkillSummary, 'id' | 'version'>) {
  return `${skill.id}@@${skill.version}`
}

function parseSkillVersionKey(value: string) {
  const [id, version] = value.split('@@')
  if (!id) {
    return null
  }
  return { id, version: version || undefined }
}

function optionFromPromptSkill(skill: SkillSummary): Option {
  return {
    key: skillVersionOptionKey(skill),
    label: `${skillTitle(skill)}${skill.version ? ` · ${skill.version}` : ''}`,
  }
}

function detectionSkillOptionKey(skill: Pick<SkillSummary, 'id' | 'version'>) {
  return skillVersionOptionKey(skill)
}

function parseDetectionSkillKey(value: string) {
  const [id, version] = value.split('@@')
  if (!id || !version) {
    return null
  }
  return { id, version }
}

function optionFromDetectionSkill(skill: SkillSummary): Option {
  return {
    key: detectionSkillOptionKey(skill),
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

function promptSkillCategoryFor(sourceMode: TaskSourceMode, printMode: PipelinePrintMode) {
  if (sourceMode !== 'txt2img' && sourceMode !== 'img2img') {
    return null
  }
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

function pipelineResultImageSrc(image: PipelineResultImage) {
  const localPath = image.local_path ?? image.source_path ?? fileUrlLocalPath(image.url ?? '')
  return localPath ? localImageUrl(localPath) : (image.url ?? '')
}

function pipelineResultImageRawPath(image: PipelineResultImage | null) {
  return image?.local_path ?? image?.source_path ?? image?.url ?? null
}

function pipelineResultLightboxItem(image: PipelineResultImage): ImageLightboxItem {
  const riskLabel =
    image.risk_level === 'pass'
      ? '无风险'
      : image.risk_level === 'review'
        ? '疑似'
        : image.risk_level === 'block'
          ? '高风险'
          : null
  return {
    alt: image.label,
    title: image.label,
    src: pipelineResultImageSrc(image),
    ...(riskLabel
      ? {
          eyebrow: `${image.allowed ? '通过' : '未通过'} · ${riskLabel}${
            image.risk_score === undefined ? '' : ` · 风险值 ${image.risk_score}`
          }`,
        }
      : {}),
    ...(image.prompt || image.reason
      ? {
          note: (
            <div className="space-y-3">
              {image.prompt ? (
                <div>
                  <p className="text-xs font-medium text-muted-foreground">提示词</p>
                  <p className="mt-1 whitespace-pre-wrap text-sm text-foreground">{image.prompt}</p>
                </div>
              ) : null}
              {image.reason ? (
                <div>
                  <p className="text-xs font-medium text-muted-foreground">判断原因</p>
                  <p className="mt-1 whitespace-pre-wrap text-sm text-foreground">{image.reason}</p>
                </div>
              ) : null}
            </div>
          ),
        }
      : {}),
    details: [
      ...(image.print_id ? [{ label: '印花 ID', value: image.print_id, mono: true }] : []),
      ...(image.artifact_id
        ? [{ label: 'Artifact ID', value: image.artifact_id, mono: true }]
        : []),
      ...(image.risk_level ? [{ label: '风险等级', value: riskLabel ?? image.risk_level }] : []),
      ...(image.risk_score === undefined ? [] : [{ label: '风险值', value: image.risk_score }]),
      ...(image.local_path ? [{ label: '图片路径', value: image.local_path, mono: true }] : []),
      ...(image.source_path ? [{ label: '来源路径', value: image.source_path, mono: true }] : []),
    ],
  }
}

function pipelineRawImageSrc(pathOrUrl: string | null | undefined) {
  if (!pathOrUrl) {
    return undefined
  }
  if (/^(?:tengyu-local-image|file|https?):\/\//i.test(pathOrUrl)) {
    return pathOrUrl
  }
  return localImageUrl(pathOrUrl)
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

function formatPipelineLogDetails(details?: Record<string, unknown>) {
  if (!details) {
    return ''
  }
  const entries = Object.entries(details).filter(([, value]) => value !== undefined && value !== '')
  if (!entries.length) {
    return ''
  }
  return entries.map(([key, value]) => `${key}=${String(value)}`).join(' ')
}

function PipelineLogDialog({
  logs,
  open,
  onOpenChange,
}: {
  logs: NonNullable<PipelineProgress['logs']>
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent className="max-w-5xl gap-0 p-0">
        <DialogHeader className="border-b px-4 py-3 pr-12">
          <DialogTitle className="text-base">完整任务日志</DialogTitle>
        </DialogHeader>
        <div className="max-h-[68vh] overflow-auto bg-zinc-950 p-4 font-mono text-xs text-zinc-100">
          {logs.length ? (
            logs.map((entry) => (
              <div
                className={
                  entry.level === 'error'
                    ? 'text-red-300'
                    : entry.level === 'warn'
                      ? 'text-amber-300'
                      : 'text-zinc-100'
                }
                key={entry.id}
              >
                {new Date(entry.created_at).toLocaleTimeString()} [{entry.level.toUpperCase()}]{' '}
                {entry.step_key ? `[${entry.step_key}] ` : ''}
                {entry.message}
                {formatPipelineLogDetails(entry.details)
                  ? ` ${formatPipelineLogDetails(entry.details)}`
                  : ''}
              </div>
            ))
          ) : (
            <div className="text-zinc-500">暂无日志</div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}

function PipelineResultsPanel({
  config,
  message,
  progress,
}: {
  config: PipelineRunConfig
  message: string
  progress: PipelineProgress | null
}) {
  const sections = progress?.result_sections ?? []
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})
  const [pages, setPages] = useState<Record<string, number>>({})
  const [lightbox, setLightbox] = useState<{
    title: string
    items: ImageLightboxItem[]
    index: number
  } | null>(null)
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null)
  const [heroImageIndex, setHeroImageIndex] = useState(0)
  const finalResult = finalPipelineResult(config, progress)
  const stats = pipelineResultStats(config, progress)
  const selectedSection = finalResult?.section ?? null
  const resultPreview = selectedPipelineResultPreview(
    selectedSection,
    selectedGroupId,
    heroImageIndex,
  )
  const selectedGroup = resultPreview.selectedGroup
  const selectedImage = resultPreview.activeImage
  const heroImagePath =
    pipelineResultImageRawPath(selectedImage) ?? selectedGroup?.cover_path ?? null
  const heroTitle = selectedGroup?.label ?? selectedImage?.label ?? '等待结果'
  const heroImageCountLabel = resultPreview.images.length
    ? `${resultPreview.activeImageIndex + 1}/${resultPreview.images.length}`
    : null
  const heroSubtitle =
    (selectedGroup
      ? [heroImageCountLabel, selectedGroup.subtitle].filter(Boolean).join(' · ')
      : heroImageCountLabel) ??
    (selectedSection ? `${selectedSection.completed}/${selectedSection.total}` : message)
  const selectedSectionKey = selectedSection?.key ?? ''
  const selectedGroupIds = selectedSection?.groups?.map((group) => group.id).join('\u0000') ?? ''

  useEffect(() => {
    const availableGroupIds = selectedGroupIds ? selectedGroupIds.split('\u0000') : []
    setSelectedGroupId((current) => {
      if (!selectedSectionKey) {
        return null
      }
      return current && availableGroupIds.includes(current) ? current : null
    })
    setHeroImageIndex(0)
  }, [selectedSectionKey, selectedGroupIds])

  function toggleSection(key: string) {
    setCollapsed((current) => ({ ...current, [key]: !current[key] }))
  }

  function updatePage(key: string, delta: number, maxPage: number) {
    setPages((current) => {
      const next = Math.max(0, Math.min(maxPage, (current[key] ?? 0) + delta))
      return { ...current, [key]: next }
    })
  }

  function openLightbox(section: PipelineResultSection, image: PipelineResultImage) {
    const sectionItems = sectionItemsForLightbox(section)
    const previewItems = sectionItems.filter(
      (item) => item.status === 'success' && pipelineResultImageSrc(item),
    )
    const items = previewItems.map(pipelineResultLightboxItem)
    const index = previewItems.findIndex((item) => item.id === image.id)
    setLightbox({ title: section.title, items, index: Math.max(0, index) })
  }

  function selectGroup(groupId: string) {
    setSelectedGroupId(groupId)
    setHeroImageIndex(0)
  }

  function updateHeroImage(delta: number) {
    setHeroImageIndex((current) =>
      Math.max(0, Math.min(resultPreview.images.length - 1, current + delta)),
    )
  }

  return (
    <Card className="overflow-hidden">
      <CardHeader className="border-b bg-gradient-to-r from-blue-50 via-slate-50 to-emerald-50 pb-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-2 text-lg text-balance">
              <Sparkles className="size-5" />
              结果预览
            </CardTitle>
            <CardDescription>{message}</CardDescription>
          </div>
          <Badge variant="secondary">{progress?.status ?? '未启动'}</Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-4 p-5">
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1.1fr)_minmax(360px,0.9fr)]">
          <div className="relative min-h-[360px] overflow-hidden rounded-md border bg-slate-950">
            {heroImagePath ? (
              <img
                alt={heroTitle}
                className="h-full min-h-[360px] w-full object-cover"
                loading="lazy"
                src={pipelineRawImageSrc(heroImagePath)}
              />
            ) : (
              <div className="flex min-h-[360px] items-center justify-center bg-muted text-sm text-muted-foreground">
                <div className="flex flex-col items-center gap-2 px-4 text-center">
                  <ImageIcon className="size-6" />
                  <span>启动完整任务后，这里会展示当前最终产物。</span>
                </div>
              </div>
            )}
            {resultPreview.images.length > 1 ? (
              <div className="pointer-events-none absolute inset-x-3 top-1/2 flex -translate-y-1/2 justify-between">
                <Button
                  aria-label="上一张"
                  className="pointer-events-auto size-9 rounded-full bg-background/90 p-0 shadow-sm backdrop-blur"
                  disabled={resultPreview.activeImageIndex <= 0}
                  onClick={() => updateHeroImage(-1)}
                  type="button"
                  variant="secondary"
                >
                  <ChevronLeft className="size-4" />
                </Button>
                <Button
                  aria-label="下一张"
                  className="pointer-events-auto size-9 rounded-full bg-background/90 p-0 shadow-sm backdrop-blur"
                  disabled={resultPreview.activeImageIndex >= resultPreview.images.length - 1}
                  onClick={() => updateHeroImage(1)}
                  type="button"
                  variant="secondary"
                >
                  <ChevronRight className="size-4" />
                </Button>
              </div>
            ) : null}
            <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-slate-950/90 to-transparent p-4 text-white">
              <div className="truncate text-xl font-semibold">{heroTitle}</div>
              <div className="mt-1 truncate text-sm text-white/70">{heroSubtitle}</div>
            </div>
          </div>

          <div className="rounded-md border bg-background p-3">
            <div className="mb-3 flex items-center justify-between gap-3">
              <div className="flex min-w-0 items-start gap-2">
                {finalResult?.mode === 'groups' ? (
                  <Folder className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                ) : (
                  <ImageIcon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                )}
                <div className="min-w-0">
                  <div className="font-semibold">
                    {finalResult?.mode === 'groups' ? '套版后文件夹' : '最终产物'}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {finalResult?.mode === 'groups'
                      ? '按模板批次和货号显示最终产物。'
                      : '展示当前任务最后阶段的产物。'}
                  </div>
                </div>
              </div>
              <Badge variant="outline">
                {resultPreview.groups.length || selectedSection?.completed || 0}
              </Badge>
            </div>

            {resultPreview.groups.length ? (
              <div className="grid max-h-[430px] grid-cols-2 gap-3 overflow-y-auto pr-1">
                {resultPreview.groups.map((group) => (
                  <button
                    aria-pressed={group.id === selectedGroup?.id}
                    className={`min-w-0 rounded-md border p-2 text-left transition hover:shadow-sm focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 ${
                      group.id === selectedGroup?.id
                        ? 'border-primary bg-primary/10 shadow-sm'
                        : 'bg-muted/20'
                    }`}
                    key={group.id}
                    onClick={() => selectGroup(group.id)}
                    type="button"
                  >
                    {group.cover_path ? (
                      <img
                        alt={group.label}
                        className="aspect-[4/3] w-full rounded-sm bg-muted object-cover"
                        loading="lazy"
                        src={pipelineRawImageSrc(group.cover_path)}
                      />
                    ) : (
                      <div className="flex aspect-[4/3] items-center justify-center rounded-sm bg-muted text-muted-foreground">
                        <FolderOpen className="size-5" />
                      </div>
                    )}
                    <div className="mt-2 truncate text-xs font-medium">{group.label}</div>
                    <div className="mt-1 truncate text-xs text-muted-foreground">
                      {group.subtitle ?? `${group.items.length} 张`}
                    </div>
                  </button>
                ))}
              </div>
            ) : selectedSection?.items.length ? (
              <div className="grid max-h-[430px] grid-cols-2 gap-3 overflow-y-auto pr-1">
                {selectedSection.items
                  .filter((item) => item.status === 'success' && pipelineResultImageSrc(item))
                  .map((image) => (
                    <button
                      className="min-w-0 rounded-md border bg-muted/20 p-2 text-left transition hover:shadow-sm focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
                      key={image.id}
                      onClick={() => openLightbox(selectedSection, image)}
                      type="button"
                    >
                      <img
                        alt={image.label}
                        className="aspect-[4/3] w-full rounded-sm bg-muted object-cover"
                        loading="lazy"
                        src={pipelineResultImageSrc(image)}
                      />
                      <div className="mt-2 truncate text-xs font-medium">{image.label}</div>
                    </button>
                  ))}
              </div>
            ) : (
              <div className="flex min-h-[280px] items-center justify-center rounded-md bg-muted text-sm text-muted-foreground">
                等待结果
              </div>
            )}
          </div>
        </div>

        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
          {stats.map((item) => (
            <div className="rounded-md border bg-background p-3" key={item.key}>
              <div className="text-xs font-medium text-muted-foreground">{item.label}</div>
              <div className="mt-2 text-2xl font-semibold tabular-nums">{item.value}</div>
              <div className="mt-1 text-xs text-muted-foreground">{item.detail}</div>
            </div>
          ))}
        </div>

        {sections.length ? (
          <div className="space-y-3">
            {sections
              .filter((section) => section.key !== selectedSection?.key)
              .map((section) => {
                const isCollapsed = collapsed[section.key] ?? section.default_collapsed ?? true
                const pageSize = 12
                const maxPage = Math.max(0, Math.ceil(section.items.length / pageSize) - 1)
                const page = Math.min(pages[section.key] ?? 0, maxPage)
                const visibleItems = section.paginated
                  ? section.items.slice(page * pageSize, page * pageSize + pageSize)
                  : section.items
                return (
                  <section className="rounded-md border bg-background p-4" key={section.key}>
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <button
                        className="flex min-w-0 items-center gap-2 text-left"
                        onClick={() => toggleSection(section.key)}
                        type="button"
                      >
                        <ChevronDown
                          className={`size-4 shrink-0 transition-transform ${
                            isCollapsed ? '-rotate-90' : ''
                          }`}
                        />
                        <span className="truncate font-semibold">{section.title}</span>
                        <span className="text-sm tabular-nums text-muted-foreground">
                          {section.completed}/{section.total}
                        </span>
                        {section.failed ? (
                          <span className="text-sm tabular-nums text-muted-foreground">
                            失败 {section.failed}
                          </span>
                        ) : null}
                      </button>
                      {section.paginated && !isCollapsed ? (
                        <div className="flex items-center gap-2">
                          <Button
                            aria-label="上一页"
                            className="size-8 p-0"
                            disabled={page === 0}
                            onClick={() => updatePage(section.key, -1, maxPage)}
                            type="button"
                            variant="outline"
                          >
                            <ChevronLeft className="size-4" />
                          </Button>
                          <span className="min-w-14 text-center text-xs tabular-nums text-muted-foreground">
                            {page + 1}/{maxPage + 1}
                          </span>
                          <Button
                            aria-label="下一页"
                            className="size-8 p-0"
                            disabled={page >= maxPage}
                            onClick={() => updatePage(section.key, 1, maxPage)}
                            type="button"
                            variant="outline"
                          >
                            <ChevronRight className="size-4" />
                          </Button>
                        </div>
                      ) : null}
                    </div>
                    {isCollapsed ? null : visibleItems.length ? (
                      <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4">
                        {visibleItems.map((image) =>
                          image.status === 'loading' ? (
                            <div
                              className="flex aspect-square items-center justify-center rounded-md border border-dashed bg-muted/30 text-sm text-muted-foreground"
                              key={image.id}
                            >
                              <Loader2 className="mr-2 size-4 animate-spin" />
                              图像加载中
                            </div>
                          ) : (
                            <button
                              className="min-w-0 rounded-md border bg-muted/20 p-2 text-left transition hover:shadow-sm focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
                              key={image.id}
                              onClick={() => openLightbox(section, image)}
                              type="button"
                            >
                              <img
                                alt={image.label}
                                className="aspect-square w-full rounded-sm bg-muted object-cover"
                                loading="lazy"
                                src={pipelineResultImageSrc(image)}
                              />
                              <div className="mt-2 truncate text-xs font-medium">{image.label}</div>
                              {image.risk_level ? (
                                <div className="mt-1 text-xs tabular-nums text-muted-foreground">
                                  风险值 {image.risk_score ?? '-'}
                                </div>
                              ) : null}
                            </button>
                          ),
                        )}
                      </div>
                    ) : (
                      <div className="mt-4 rounded-md bg-muted px-3 py-8 text-center text-sm text-muted-foreground">
                        等待结果
                      </div>
                    )}
                  </section>
                )
              })}
          </div>
        ) : null}
      </CardContent>
      <ImageLightbox
        activeIndex={lightbox?.index ?? null}
        items={lightbox?.items ?? []}
        onActiveIndexChange={(index) =>
          setLightbox((current) => {
            if (!current || index === null) {
              return null
            }
            return { ...current, index }
          })
        }
        title={lightbox?.title ?? '图片预览'}
      />
    </Card>
  )
}

function itemStatusVariant(
  status: PipelineItemRecord['status'],
): 'default' | 'secondary' | 'destructive' | 'outline' {
  if (status === 'failed') {
    return 'destructive'
  }
  if (status === 'completed') {
    return 'default'
  }
  if (status === 'running') {
    return 'secondary'
  }
  return 'outline'
}

function itemStatusLabel(status: PipelineItemRecord['status']) {
  if (status === 'running') {
    return '进行中'
  }
  if (status === 'completed') {
    return '已完成'
  }
  if (status === 'failed') {
    return '失败'
  }
  if (status === 'filtered') {
    return '已拦截'
  }
  if (status === 'skipped') {
    return '已跳过'
  }
  if (status === 'interrupted') {
    return '已中断'
  }
  return status
}

function runStatusVariant(
  status: PipelineRunRecord['status'],
): 'default' | 'secondary' | 'destructive' | 'outline' {
  if (status === 'failed') {
    return 'destructive'
  }
  if (status === 'completed') {
    return 'default'
  }
  if (status === 'running') {
    return 'secondary'
  }
  return 'outline'
}

function runStatusLabel(status: PipelineRunRecord['status']) {
  if (status === 'running') {
    return '进行中'
  }
  if (status === 'completed') {
    return '已完成'
  }
  if (status === 'failed') {
    return '失败'
  }
  if (status === 'cancelled') {
    return '已取消'
  }
  if (status === 'interrupted') {
    return '已中断'
  }
  return status
}

function runTimeLabel(value: number) {
  return new Date(value).toLocaleString()
}

function PipelineRunHistoryPanel({
  currentRunId,
  loading,
  onRefresh,
  onResume,
  resumeLoading,
  runs,
}: {
  currentRunId: string | null
  loading: boolean
  onRefresh: () => void
  onResume: (runId: string) => void
  resumeLoading: boolean
  runs: PipelineRunRecord[]
}) {
  return (
    <Card>
      <CardHeader className="pb-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle className="text-base">历史记录</CardTitle>
            <CardDescription>失败或已中断的完整任务可从中断处继续。</CardDescription>
          </div>
          <Button disabled={loading} onClick={onRefresh} variant="ghost">
            <RefreshCw className="mr-2 h-4 w-4" />
            刷新
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {runs.length ? (
          <div className="space-y-2">
            {runs.slice(0, 12).map((run) => {
              const canResume = run.status === 'failed' || run.status === 'interrupted'
              return (
                <div
                  className="flex flex-wrap items-center justify-between gap-3 rounded-md border px-3 py-2 text-sm"
                  key={run.id}
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="truncate font-medium">{run.name}</span>
                      <Badge variant={runStatusVariant(run.status)}>
                        {runStatusLabel(run.status)}
                      </Badge>
                      {run.id === currentRunId ? <Badge variant="outline">当前</Badge> : null}
                    </div>
                    <div className="mt-1 truncate text-xs text-muted-foreground">
                      {runTimeLabel(run.created_at)}
                      {run.error_summary ? ` · ${run.error_summary}` : ''}
                    </div>
                  </div>
                  {canResume ? (
                    <Button
                      disabled={resumeLoading}
                      onClick={() => onResume(run.id)}
                      variant="outline"
                    >
                      <Play className="mr-2 h-4 w-4" />
                      从中断处继续
                    </Button>
                  ) : null}
                </div>
              )
            })}
          </div>
        ) : (
          <div className="rounded-md bg-muted px-3 py-8 text-center text-sm text-muted-foreground">
            暂无历史记录
          </div>
        )}
      </CardContent>
    </Card>
  )
}

function PipelineItemsPanel({ progress }: { progress: PipelineProgress | null }) {
  const items = (progress?.items ?? [])
    .slice()
    .sort((left, right) => right.updated_at - left.updated_at)

  return (
    <Card>
      <CardHeader className="pb-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle className="text-base">逐项状态</CardTitle>
            <CardDescription>每张印花在各节的当前状态。</CardDescription>
          </div>
          <Badge variant="secondary">{items.length}</Badge>
        </div>
      </CardHeader>
      <CardContent>
        {items.length ? (
          <div className="space-y-2">
            {items.slice(0, 24).map((item) => (
              <div
                className="flex flex-wrap items-center justify-between gap-3 rounded-md border px-3 py-2 text-sm"
                key={item.id}
              >
                <div className="min-w-0 space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{item.item_key}</span>
                    <Badge variant="outline">{item.step_key}</Badge>
                    <Badge variant={itemStatusVariant(item.status)}>
                      {itemStatusLabel(item.status)}
                    </Badge>
                  </div>
                  <div className="truncate text-xs text-muted-foreground">
                    {item.output_path ?? item.source_path ?? '-'}
                  </div>
                  {item.error_message ? (
                    <div className="text-xs text-red-600">{item.error_message}</div>
                  ) : null}
                </div>
                <div className="shrink-0 text-xs text-muted-foreground">
                  {new Date(item.updated_at).toLocaleTimeString()}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="rounded-md bg-muted px-3 py-8 text-center text-sm text-muted-foreground">
            启动完整任务后，这里会显示逐项状态。
          </div>
        )}
      </CardContent>
    </Card>
  )
}

export function FullTaskPage() {
  const [name, setName] = useFullTaskSessionState('name', '')
  const [printSkuCode, setPrintSkuCode] = useFullTaskSessionState('printSkuCode', '')
  const [filenameSeparator, setFilenameSeparator] = useFullTaskSessionState(
    'filenameSeparator',
    '-',
  )
  const [sourceMode, setSourceMode] = useFullTaskSessionState<TaskSourceMode>(
    'sourceMode',
    'collection',
  )
  const [printMode, setPrintMode] = useFullTaskSessionState<PipelinePrintMode>('printMode', 'local')
  const [sourceFolder, setSourceFolder] = useFullTaskSessionState('sourceFolder', '')
  const [existingPrintFolder, setExistingPrintFolder] = useFullTaskSessionState(
    'existingPrintFolder',
    '',
  )
  const [existingPrintStartStep, setExistingPrintStartStep] =
    useFullTaskSessionState<PipelineStartStep>('existingPrintStartStep', 'photoshop')
  const [referenceImages, setReferenceImages] = useFullTaskSessionState<ReferenceImageDraft[]>(
    'referenceImages',
    [],
  )
  const [sendReferenceToImageModel, setSendReferenceToImageModel] = useFullTaskSessionState(
    'sendReferenceToImageModel',
    false,
  )
  const [txt2imgProvider, setTxt2imgProvider] = useFullTaskSessionState<Txt2imgProvider>(
    'txt2imgProvider',
    'grsai',
  )
  const [txt2imgComfyuiWorkflowId, setTxt2imgComfyuiWorkflowId] = useFullTaskSessionState(
    'txt2imgComfyuiWorkflowId',
    '',
  )
  const [txt2imgComfyuiInstanceUuid, setTxt2imgComfyuiInstanceUuid] = useFullTaskSessionState(
    'txt2imgComfyuiInstanceUuid',
    '',
  )
  const [img2imgProvider, setImg2imgProvider] = useFullTaskSessionState<Img2imgProvider>(
    'img2imgProvider',
    'grsai',
  )
  const [img2imgSourceFolder, setImg2imgSourceFolder] = useFullTaskSessionState(
    'img2imgSourceFolder',
    '',
  )
  const [img2imgComfyuiWorkflowId, setImg2imgComfyuiWorkflowId] = useFullTaskSessionState(
    'img2imgComfyuiWorkflowId',
    '',
  )
  const [img2imgComfyuiInstanceUuid, setImg2imgComfyuiInstanceUuid] = useFullTaskSessionState(
    'img2imgComfyuiInstanceUuid',
    '',
  )
  const [img2imgComfyuiBatchSize, setImg2imgComfyuiBatchSize] = useFullTaskSessionState(
    'img2imgComfyuiBatchSize',
    '1',
  )
  const [img2imgComfyuiPromptMode, setImg2imgComfyuiPromptMode] =
    useFullTaskSessionState<ComfyuiImg2imgPromptMode>('img2imgComfyuiPromptMode', 'ai')
  const [extractProvider, setExtractProvider] = useFullTaskSessionState<ExtractProvider>(
    'extractProvider',
    'grsai',
  )
  const [img2imgReferenceMode, setImg2imgReferenceMode] =
    useFullTaskSessionState<Img2imgReferenceMode>('img2imgReferenceMode', 'layout-style')
  const [promptRequirement, setPromptRequirement] = useFullTaskSessionState('promptRequirement', '')
  const [promptRequirementOpen, setPromptRequirementOpen] = useState(false)
  const [promptCount, setPromptCount] = useFullTaskSessionState('promptCount', '5')
  const [promptSkillId, setPromptSkillId] = useFullTaskSessionState('promptSkillId', '')
  const [promptModel, setPromptModel] = useFullTaskSessionState('promptModel', '')
  const [grsaiModel, setGrsaiModel] = useFullTaskSessionState('grsaiModel', 'gpt-image-2')
  const [aspectRatio, setAspectRatio] = useFullTaskSessionState('aspectRatio', '1024x1024')
  const [grsaiConcurrency, setGrsaiConcurrency] = useFullTaskSessionState('grsaiConcurrency', '20')
  const [extractSkillId, setExtractSkillId] = useFullTaskSessionState('extractSkillId', '')
  const [extractWorkflowId, setExtractWorkflowId] = useFullTaskSessionState('extractWorkflowId', '')
  const [extractInstanceUuid, setExtractInstanceUuid] = useFullTaskSessionState(
    'extractInstanceUuid',
    '',
  )
  const [width, setWidth] = useFullTaskSessionState('width', '1024')
  const [height, setHeight] = useFullTaskSessionState('height', '1024')
  const [mattingEnabled, setMattingEnabled] = useFullTaskSessionState('mattingEnabled', true)
  const [mattingWorkflowId, setMattingWorkflowId] = useFullTaskSessionState('mattingWorkflowId', '')
  const [mattingInstanceUuid, setMattingInstanceUuid] = useFullTaskSessionState(
    'mattingInstanceUuid',
    '',
  )
  const [skipCompleted, setSkipCompleted] = useFullTaskSessionState('skipCompleted', true)
  const [replaceRange, setReplaceRange] = useFullTaskSessionState<
    'auto' | 'topmost' | 'top' | 'all'
  >('replaceRange', 'topmost')
  const [clipMode, setClipMode] = useFullTaskSessionState<'auto' | 'guides' | 'none'>(
    'clipMode',
    'auto',
  )
  const [format, setFormat] = useFullTaskSessionState<'jpg' | 'png'>('format', 'jpg')
  const [photoshopMaxRetries, setPhotoshopMaxRetries] = useFullTaskSessionState(
    'photoshopMaxRetries',
    '1',
  )
  const [templatePaths, setTemplatePaths] = useFullTaskSessionState<string[]>('templatePaths', [])
  const [outputRoot, setOutputRoot] = useFullTaskSessionState('outputRoot', '')
  const [photoshopEnabled, setPhotoshopEnabled] = useFullTaskSessionState('photoshopEnabled', false)
  const [detectionEnabled, setDetectionEnabled] = useFullTaskSessionState('detectionEnabled', true)
  const [detectionConfig, setDetectionConfig] = useState<DetectionConfig | null>(null)
  const [detectionPassRule, setDetectionPassRule] = useFullTaskSessionState<DetectionPassRule>(
    'detectionPassRule',
    'allow-review',
  )
  const [detectionCompression, setDetectionCompression] = useFullTaskSessionState(
    'detectionCompression',
    true,
  )
  const [detectionModel, setDetectionModel] = useFullTaskSessionState('detectionModel', '')
  const [detectionSkillKey, setDetectionSkillKey] = useFullTaskSessionState('detectionSkillKey', '')
  const [titlePlatform, setTitlePlatform] = useFullTaskSessionState('titlePlatform', 'temu')
  const [titleLanguage, setTitleLanguage] = useFullTaskSessionState('titleLanguage', 'en')
  const [titleModel, setTitleModel] = useFullTaskSessionState('titleModel', 'qwen3.6-flash')
  const [titleFileName, setTitleFileName] = useFullTaskSessionState('titleFileName', '标题')
  const [titleImageIndex, setTitleImageIndex] = useFullTaskSessionState('titleImageIndex', '1')
  const [titleKeywordGroups, setTitleKeywordGroups] = useFullTaskSessionState<
    TitleKeywordGroupDraft[]
  >('titleKeywordGroups', [createTitleKeywordGroupDraft()])
  const [titleKeywordGroupSeparator, setTitleKeywordGroupSeparator] = useFullTaskSessionState(
    'titleKeywordGroupSeparator',
    ' ',
  )
  const [titleExistingStrategy, setTitleExistingStrategy] =
    useFullTaskSessionState<TitleExistingStrategy>('titleExistingStrategy', 'skip')
  const [titleMaxRetries, setTitleMaxRetries] = useFullTaskSessionState('titleMaxRetries', '2')
  const [titleCompression, setTitleCompression] = useFullTaskSessionState('titleCompression', true)
  const [titleMaxSize, setTitleMaxSize] = useFullTaskSessionState('titleMaxSize', '1024')
  const [titleEnabled, setTitleEnabled] = useFullTaskSessionState('titleEnabled', false)
  const [extraRequirement, setExtraRequirement] = useFullTaskSessionState('extraRequirement', '')
  const [progress, setProgress] = useState<PipelineProgress | null>(null)
  const [currentRunId, setCurrentRunId] = useFullTaskSessionState<string | null>(
    'currentRunId',
    null,
  )
  const [runHistory, setRunHistory] = useState<PipelineRunRecord[]>([])
  const [runHistoryLoading, setRunHistoryLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState('按三个大区块配置后即可启动')
  const [running, setRunning] = useState(false)
  const [optionsLoading, setOptionsLoading] = useState(false)
  const [isLogOpen, setIsLogOpen] = useState(false)
  const [generationSettings, setGenerationSettings] = useState<GenerationSettingsSnapshot | null>(
    null,
  )
  const [generationSkills, setGenerationSkills] = useState<SkillSummary[]>([])
  const [txt2imgWorkflows, setTxt2imgWorkflows] = useState<Option[]>([])
  const [img2imgWorkflows, setImg2imgWorkflows] = useState<Option[]>([])
  const [extractWorkflows, setExtractWorkflows] = useState<Option[]>([])
  const [mattingWorkflows, setMattingWorkflows] = useState<Option[]>([])
  const [chenyuInstances, setChenyuInstances] = useState<ChenyuManagedInstance[]>([])
  const [platforms, setPlatforms] = useState<Option[]>([])
  const [languages, setLanguages] = useState<Option[]>([])
  const [titleModels, setTitleModels] = useState<Option[]>([])
  const [detectionModels, setDetectionModels] = useState<string[]>([])
  const [detectionSkills, setDetectionSkills] = useState<SkillSummary[]>([])
  const previousSourceModeRef = useRef<TaskSourceMode | null>(null)
  const existingPrintToggleSnapshotRef = useRef<FullTaskToggleSnapshot | null>(null)
  const chooseSourceFolderMutation = useIpcMutation(() => window.api.generation.chooseImageFolder())
  const chooseImg2imgSourceFolderMutation = useIpcMutation(() =>
    window.api.generation.chooseImageFolder(),
  )
  const chooseExistingPrintFolderMutation = useIpcMutation(() =>
    window.api.photoshop.choosePrintFolder(),
  )
  const chooseTemplatesMutation = useIpcMutation(() => window.api.photoshop.chooseTemplates())
  const chooseOutputRootMutation = useIpcMutation(() => window.api.photoshop.chooseOutputFolder())
  const cancelPipelineMutation = useIpcMutation((runId: string) =>
    window.api.pipeline.cancel({ run_id: runId }),
  )
  const resumePipelineMutation = useIpcMutation(
    (runId: string) => window.api.pipeline.resume({ run_id: runId }),
    { successMessage: '已从中断处继续' },
  )

  const isMac = navigator.platform.toLowerCase().includes('mac')
  const requiresPromptGeneration =
    sourceMode === 'txt2img' ||
    (sourceMode === 'img2img' &&
      (img2imgProvider === 'grsai' ||
        (img2imgProvider === 'comfyui-chenyu' && img2imgComfyuiPromptMode === 'ai')))
  const txt2imgUsesComfyui = sourceMode === 'txt2img' && txt2imgProvider === 'comfyui-chenyu'
  const img2imgUsesComfyui = sourceMode === 'img2img' && img2imgProvider === 'comfyui-chenyu'
  const img2imgUsesGrsai = sourceMode === 'img2img' && img2imgProvider === 'grsai'
  const txt2imgComfyuiWorkflow = useMemo(
    () => txt2imgWorkflows.find((workflow) => workflow.key === txt2imgComfyuiWorkflowId) ?? null,
    [txt2imgComfyuiWorkflowId, txt2imgWorkflows],
  )
  const img2imgComfyuiWorkflow = useMemo(
    () => img2imgWorkflows.find((workflow) => workflow.key === img2imgComfyuiWorkflowId) ?? null,
    [img2imgComfyuiWorkflowId, img2imgWorkflows],
  )
  const grsaiModelOptions = useMemo(() => grsaiModelsFor(generationSettings), [generationSettings])
  const selectedGrsaiModel = useMemo(
    () => grsaiModelOptions.find((item) => item.id === grsaiModel) ?? grsaiModelOptions[0] ?? null,
    [grsaiModelOptions, grsaiModel],
  )
  const grsaiSizeOptions = selectedGrsaiModel?.sizes.length
    ? selectedGrsaiModel.sizes
    : (FALLBACK_GRSAI_MODELS[0]?.sizes ?? ['1024x1024', '1536x1024', '1024x1536'])
  const promptModelOptions = useMemo(() => {
    if (!requiresPromptGeneration) {
      return []
    }
    return (
      sourceMode === 'img2img'
        ? visionModelsFor(generationSettings)
        : textModelsFor(generationSettings)
    ).map((item) => ({ key: item.id, label: modelLabel(item) }))
  }, [generationSettings, requiresPromptGeneration, sourceMode])
  const promptSkillCategory = requiresPromptGeneration
    ? promptSkillCategoryFor(sourceMode, printMode)
    : null
  const promptSkillOptions = useMemo(() => {
    if (!promptSkillCategory) {
      return []
    }
    const filtered = generationSkills.filter((skill) =>
      skillInCategories(skill, [promptSkillCategory]),
    )
    const pool = filtered.length > 0 ? filtered : generationSkills
    return pool.map(optionFromPromptSkill)
  }, [generationSkills, promptSkillCategory])
  const selectedExtractSkill = useMemo(() => parseSkillVersionKey(extractSkillId), [extractSkillId])
  const extractSkillOptions = useMemo(() => {
    const filtered = generationSkills.filter((skill) =>
      skillInCategories(skill, extractSkillCategories),
    )
    const pool = filtered.length > 0 ? filtered : generationSkills
    return pool.map(optionFromSkill)
  }, [generationSkills])
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
  const detectionModelOptions = useMemo(
    () => (detectionModels.length ? detectionModels : ['qwen3.6-flash']),
    [detectionModels],
  )
  const detectionSkillOptions = useMemo(
    () => detectionSkills.map(optionFromDetectionSkill),
    [detectionSkills],
  )
  const selectedDetectionSkill = useMemo(
    () => parseDetectionSkillKey(detectionSkillKey),
    [detectionSkillKey],
  )
  const selectedImg2imgReferenceMode =
    img2imgReferenceModes.find((item) => item.key === img2imgReferenceMode) ??
    img2imgReferenceModes[0]
  const selectedPromptSkill = useMemo(() => parseSkillVersionKey(promptSkillId), [promptSkillId])
  const sourceBadgeLabel =
    sourceMode === 'collection'
      ? '采集 + 提取'
      : sourceMode === 'txt2img'
        ? txt2imgProvider === 'grsai'
          ? '文生图 / Grsai'
          : '文生图 / 晨羽'
        : sourceMode === 'img2img'
          ? img2imgProvider === 'grsai'
            ? '图生图 / Grsai'
            : '图生图 / 晨羽'
          : '已有印花来源'
  const isExistingPrintSource = sourceMode === 'existing_prints'
  const mattingLockedOn = isExistingPrintSource && existingPrintStartStep === 'matting'
  const mattingLockedSkipped = isExistingPrintSource && existingPrintStartStep !== 'matting'
  const detectionLockedOn = isExistingPrintSource && existingPrintStartStep === 'detection'
  const detectionLockedSkipped = isExistingPrintSource && existingPrintStartStep === 'photoshop'
  const photoshopLockedOn = isExistingPrintSource && existingPrintStartStep === 'photoshop'
  const effectiveMattingEnabled = mattingLockedOn || (!mattingLockedSkipped && mattingEnabled)
  const effectiveDetectionEnabled =
    detectionLockedOn || (!detectionLockedSkipped && detectionEnabled)
  const effectivePhotoshopEnabled = photoshopLockedOn || photoshopEnabled
  const effectiveTitleEnabled = titleEnabled && effectivePhotoshopEnabled
  const validationIssues = useMemo(() => {
    const issues: string[] = []
    const normalizedPrintSkuCode = printSkuCode.trim()
    if (effectivePhotoshopEnabled && !normalizedPrintSkuCode) {
      issues.push('请先填写印花货号')
    }
    if (effectivePhotoshopEnabled && isMac) {
      issues.push('PS 套版仅支持 Windows，关闭 PS 套版后可在当前电脑运行前置步骤')
    }
    if (effectivePhotoshopEnabled && templatePaths.length === 0) {
      issues.push('请先选择 PSD 模板')
    }
    if (sourceMode === 'collection') {
      if (!sourceFolder.trim()) {
        issues.push('请先选择采集文件夹')
      }
      if (extractSkillOptions.length === 0) {
        issues.push('请先在后台配置提取 Skill')
      }
      if (!selectedExtractSkill) {
        issues.push('请先选择提取 Skill')
      }
      if (extractProvider === 'comfyui-chenyu') {
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
    if (sourceMode === 'existing_prints') {
      if (!existingPrintFolder.trim()) {
        issues.push('请先选择已有印花文件夹')
      }
    }
    if (sourceMode === 'txt2img') {
      if (promptSkillOptions.length === 0) {
        issues.push('请先在后台配置提示词 Skill')
      }
      if (!selectedPromptSkill) {
        issues.push('请先选择提示词 Skill')
      }
      if (!promptModel.trim()) {
        issues.push('请先选择提示词模型')
      }
      if (!promptRequirement.trim()) {
        issues.push('请先填写印花要求')
      }
    }
    if (sourceMode === 'txt2img' && txt2imgProvider === 'comfyui-chenyu') {
      if (runningInstances.length === 0) {
        issues.push('请先开机晨羽云机')
      }
      if (!txt2imgComfyuiWorkflowId.trim()) {
        issues.push('请先选择晨羽文生图工作流')
      }
      if (!txt2imgComfyuiInstanceUuid.trim()) {
        issues.push('请先选择晨羽文生图实例')
      }
    }
    if (sourceMode === 'img2img' && img2imgProvider === 'grsai') {
      if (referenceImages.length === 0) {
        issues.push('请先添加至少一张图生图参考图')
      }
      if (promptSkillOptions.length === 0) {
        issues.push('请先在后台配置提示词 Skill')
      }
      if (!selectedPromptSkill) {
        issues.push('请先选择提示词 Skill')
      }
      if (!promptModel.trim()) {
        issues.push('请先选择提示词模型')
      }
      if (!promptRequirement.trim()) {
        issues.push('请先填写印花要求')
      }
    }
    if (sourceMode === 'img2img' && img2imgProvider === 'comfyui-chenyu') {
      if (!img2imgSourceFolder.trim()) {
        issues.push('请先选择图生图图片文件夹')
      }
      if (runningInstances.length === 0) {
        issues.push('请先开机晨羽云机')
      }
      if (!img2imgComfyuiWorkflowId.trim()) {
        issues.push('请先选择晨羽图生图工作流')
      }
      if (!img2imgComfyuiInstanceUuid.trim()) {
        issues.push('请先选择晨羽图生图实例')
      }
      if (img2imgComfyuiPromptMode === 'ai') {
        if (promptSkillOptions.length === 0) {
          issues.push('请先在后台配置提示词 Skill')
        }
        if (!selectedPromptSkill) {
          issues.push('请先选择提示词 Skill')
        }
        if (!promptModel.trim()) {
          issues.push('请先选择提示词模型')
        }
      }
    }
    if (effectiveMattingEnabled) {
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
    if (effectiveDetectionEnabled) {
      if (!detectionModel.trim()) {
        issues.push('请先选择侵权检测模型')
      }
      if (!selectedDetectionSkill) {
        issues.push('请先选择侵权检测 Skill')
      }
    }
    if (titleEnabled && !effectivePhotoshopEnabled) {
      issues.push('标题生成需要先启用 PS 套版')
    }
    if (
      effectiveTitleEnabled &&
      (!titlePlatform.trim() || !titleLanguage.trim() || !titleModel.trim())
    ) {
      issues.push('请先完成标题设置')
    }
    return issues
  }, [
    extractProvider,
    extractSkillOptions.length,
    extractInstanceUuid,
    extractWorkflowId,
    detectionModel,
    effectiveDetectionEnabled,
    effectiveMattingEnabled,
    effectivePhotoshopEnabled,
    effectiveTitleEnabled,
    isMac,
    mattingInstanceUuid,
    mattingWorkflowId,
    promptModel,
    promptRequirement,
    promptSkillOptions.length,
    printSkuCode,
    referenceImages.length,
    runningInstances.length,
    selectedExtractSkill,
    selectedDetectionSkill,
    selectedPromptSkill,
    img2imgComfyuiPromptMode,
    img2imgComfyuiInstanceUuid,
    img2imgComfyuiWorkflowId,
    img2imgProvider,
    img2imgSourceFolder,
    sourceFolder,
    existingPrintFolder,
    sourceMode,
    templatePaths.length,
    txt2imgComfyuiInstanceUuid,
    txt2imgComfyuiWorkflowId,
    txt2imgProvider,
    titleEnabled,
    titleLanguage,
    titleModel,
    titlePlatform,
  ])
  const canStart = !running && validationIssues.length === 0

  const refreshOptions = useCallback(async () => {
    setOptionsLoading(true)
    try {
      const results = await Promise.allSettled([
        window.api.skill.list({ module: 'generation' }),
        window.api.generation.listComfyuiTxt2imgWorkflows(),
        window.api.generation.listComfyuiImg2imgWorkflows(),
        window.api.generation.listComfyuiExtractWorkflows(),
        window.api.generation.listComfyuiMattingWorkflows(),
        window.api.chenyu.listInstances(),
        window.api.title.listPlatforms(),
        window.api.title.listLanguages(),
        window.api.title.listModels(),
        window.api.generationSettings.get(),
        window.api.detection.getConfig(),
        window.api.detection.listModels(),
        window.api.skill.list({ module: 'detection' }),
      ])
      const failed = results
        .map((result, index) => ({ result, index }))
        .filter(
          (item): item is { result: PromiseRejectedResult; index: number } =>
            item.result.status === 'rejected',
        )
      const errorLabels = [
        'Skill',
        '文生图工作流',
        '图生图工作流',
        '提取工作流',
        '抠图工作流',
        '晨羽实例',
        '标题平台',
        '标题语言',
        '标题模型',
        '生图设置',
        '检测配置',
        '检测模型',
        '检测 Skill',
      ]

      if (failed.length) {
        setError(`部分配置加载失败：${failed.map((item) => errorLabels[item.index]).join('、')}`)
      }

      const skills = results[0].status === 'fulfilled' ? results[0].value : []
      const nextTxt2imgWorkflows = results[1].status === 'fulfilled' ? results[1].value : []
      const nextImg2imgWorkflows = results[2].status === 'fulfilled' ? results[2].value : []
      const nextExtractWorkflows = results[3].status === 'fulfilled' ? results[3].value : []
      const nextMattingWorkflows = results[4].status === 'fulfilled' ? results[4].value : []
      const nextInstances = results[5].status === 'fulfilled' ? results[5].value : []
      const nextPlatforms = results[6].status === 'fulfilled' ? results[6].value : []
      const nextLanguages = results[7].status === 'fulfilled' ? results[7].value : []
      const nextTitleModels = results[8].status === 'fulfilled' ? results[8].value : []
      const nextGenerationSettings = results[9].status === 'fulfilled' ? results[9].value : null
      const nextDetectionConfig = results[10].status === 'fulfilled' ? results[10].value : null
      const nextDetectionModels = results[11].status === 'fulfilled' ? results[11].value : []
      const nextDetectionSkills = results[12].status === 'fulfilled' ? results[12].value : []

      setGenerationSkills(skills)
      setTxt2imgWorkflows(nextTxt2imgWorkflows.map(optionFromWorkflow))
      setImg2imgWorkflows(nextImg2imgWorkflows.map(optionFromWorkflow))
      setExtractWorkflows(nextExtractWorkflows.map(optionFromWorkflow))
      setMattingWorkflows(nextMattingWorkflows.map(optionFromWorkflow))
      setChenyuInstances(nextInstances)
      setPlatforms(nextPlatforms)
      setLanguages(nextLanguages)
      setTitleModels(nextTitleModels)
      setGenerationSettings(nextGenerationSettings)
      setDetectionConfig(nextDetectionConfig)
      setDetectionModels(nextDetectionModels)
      setDetectionSkills(nextDetectionSkills)
    } finally {
      setOptionsLoading(false)
    }
  }, [])

  const refreshRunHistory = useCallback(async () => {
    setRunHistoryLoading(true)
    try {
      setRunHistory(await window.api.pipeline.listRuns())
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : '读取完整任务历史失败')
    } finally {
      setRunHistoryLoading(false)
    }
  }, [])

  useEffect(() => {
    void refreshOptions().catch((nextError) =>
      setError(nextError instanceof Error ? nextError.message : '读取完整任务配置失败'),
    )
  }, [refreshOptions])

  useEffect(() => {
    void refreshRunHistory()
  }, [refreshRunHistory])

  useEffect(() => {
    if (!currentRunId) {
      return
    }
    let disposed = false
    void window.api.pipeline
      .getRun({ run_id: currentRunId })
      .then((detail) => {
        if (disposed || !detail) {
          return
        }
        const restoredProgress = progressFromRunDetail(detail)
        setProgress(restoredProgress)
        setMessage(restoredProgress.message)
        setRunning(detail.run.status === 'running')
        setError(detail.run.error_summary)
      })
      .catch((nextError) => {
        if (!disposed) {
          setError(nextError instanceof Error ? nextError.message : '恢复完整任务状态失败')
        }
      })
    return () => {
      disposed = true
    }
  }, [currentRunId])

  useEffect(() => {
    return window.api.pipeline.onProgress((nextProgress) => {
      if (!currentRunId || nextProgress.run_id === currentRunId) {
        setProgress(nextProgress)
        setMessage(nextProgress.message)
      }
    })
  }, [currentRunId])

  useEffect(() => {
    return window.api.pipeline.onCompleted((event) => {
      if (event.ok) {
        setCurrentRunId(event.result.run.id)
        setProgress(progressFromRunDetail(event.result))
        setMessage(pipelineRunMessage(event.result.run))
        setError(event.result.run.error_summary)
      } else {
        setError(event.error)
        setMessage('完整任务失败')
      }
      setRunning(false)
      void refreshOptions()
      void refreshRunHistory()
    })
  }, [refreshOptions, refreshRunHistory, setCurrentRunId])

  useEffect(() => {
    if (grsaiModelOptions.length === 0) {
      return
    }
    if (!grsaiModelOptions.some((item) => item.id === grsaiModel)) {
      setGrsaiModel(grsaiModelOptions[0]?.id ?? 'gpt-image-2')
    }
  }, [grsaiModel, grsaiModelOptions, setGrsaiModel])

  useEffect(() => {
    if (!selectedGrsaiModel?.sizes.length) {
      return
    }
    if (!selectedGrsaiModel.sizes.includes(aspectRatio)) {
      setAspectRatio(selectedGrsaiModel.sizes[0] ?? '1024x1024')
    }
  }, [aspectRatio, selectedGrsaiModel, setAspectRatio])

  useEffect(() => {
    if (!requiresPromptGeneration || promptModelOptions.length === 0) {
      if (requiresPromptGeneration && promptModelOptions.length === 0) {
        setPromptModel('')
      }
      return
    }
    if (!promptModelOptions.some((item) => item.key === promptModel)) {
      setPromptModel(promptModelOptions[0]?.key ?? '')
    }
  }, [promptModel, promptModelOptions, requiresPromptGeneration, setPromptModel])

  useEffect(() => {
    if (sourceMode !== 'collection' || extractSkillOptions.length === 0) {
      if (sourceMode === 'collection' && extractSkillOptions.length === 0) {
        setExtractSkillId('')
      }
      return
    }
    if (!extractSkillOptions.some((item) => item.key === extractSkillId)) {
      setExtractSkillId(extractSkillOptions[0]?.key ?? '')
    }
  }, [extractSkillId, extractSkillOptions, setExtractSkillId, sourceMode])

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
  }, [
    chenyuInstances,
    extractInstanceUuid,
    extractProvider,
    runningInstances,
    setExtractInstanceUuid,
    sourceMode,
  ])

  useEffect(() => {
    if (sourceMode !== 'txt2img' || txt2imgProvider !== 'comfyui-chenyu') {
      return
    }
    const fallback = selectFallbackChenyuInstance(chenyuInstances)
    if (!fallback) {
      setTxt2imgComfyuiInstanceUuid('')
      return
    }
    if (
      !runningInstances.some((instance) => instance.instanceUuid === txt2imgComfyuiInstanceUuid)
    ) {
      setTxt2imgComfyuiInstanceUuid(fallback.instanceUuid)
    }
  }, [
    chenyuInstances,
    runningInstances,
    setTxt2imgComfyuiInstanceUuid,
    sourceMode,
    txt2imgComfyuiInstanceUuid,
    txt2imgProvider,
  ])

  useEffect(() => {
    if (sourceMode !== 'img2img' || img2imgProvider !== 'comfyui-chenyu') {
      return
    }
    const fallback = selectFallbackChenyuInstance(chenyuInstances)
    if (!fallback) {
      setImg2imgComfyuiInstanceUuid('')
      return
    }
    if (
      !runningInstances.some((instance) => instance.instanceUuid === img2imgComfyuiInstanceUuid)
    ) {
      setImg2imgComfyuiInstanceUuid(fallback.instanceUuid)
    }
  }, [
    chenyuInstances,
    img2imgComfyuiInstanceUuid,
    img2imgProvider,
    runningInstances,
    setImg2imgComfyuiInstanceUuid,
    sourceMode,
  ])

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
  }, [
    chenyuInstances,
    mattingEnabled,
    mattingInstanceUuid,
    runningInstances,
    setMattingInstanceUuid,
  ])

  useEffect(() => {
    if (!requiresPromptGeneration || promptSkillOptions.length === 0) {
      if (requiresPromptGeneration && promptSkillOptions.length === 0) {
        setPromptSkillId('')
      }
      return
    }
    if (!promptSkillOptions.some((item) => item.key === promptSkillId)) {
      setPromptSkillId(promptSkillOptions[0]?.key ?? '')
    }
  }, [promptSkillId, promptSkillOptions, requiresPromptGeneration, setPromptSkillId])

  useEffect(() => {
    const previousSourceMode = previousSourceModeRef.current
    const enteredExistingPrints =
      sourceMode === 'existing_prints' && previousSourceMode !== 'existing_prints'
    const leftExistingPrints =
      sourceMode !== 'existing_prints' && previousSourceMode === 'existing_prints'
    if (leftExistingPrints && existingPrintToggleSnapshotRef.current) {
      const snapshot = existingPrintToggleSnapshotRef.current
      existingPrintToggleSnapshotRef.current = null
      setMattingEnabled(snapshot.mattingEnabled)
      setDetectionEnabled(snapshot.detectionEnabled)
      setPhotoshopEnabled(snapshot.photoshopEnabled)
      setTitleEnabled(snapshot.titleEnabled)
    }
    previousSourceModeRef.current = sourceMode
    if (sourceMode !== 'existing_prints') {
      return
    }
    if (enteredExistingPrints) {
      setPhotoshopEnabled(true)
      setTitleEnabled(true)
    }
    if (existingPrintStartStep === 'matting') {
      setMattingEnabled(true)
    } else if (existingPrintStartStep === 'detection') {
      setMattingEnabled(false)
      setDetectionEnabled(true)
    } else {
      setMattingEnabled(false)
      setDetectionEnabled(false)
      setPhotoshopEnabled(true)
    }
  }, [
    existingPrintStartStep,
    setDetectionEnabled,
    setMattingEnabled,
    setPhotoshopEnabled,
    setTitleEnabled,
    sourceMode,
  ])

  useEffect(() => {
    const firstPlatform = platforms[0]
    if (firstPlatform && !platforms.some((item) => item.key === titlePlatform)) {
      setTitlePlatform(firstPlatform.key)
    }
  }, [platforms, setTitlePlatform, titlePlatform])

  useEffect(() => {
    const firstLanguage = languages[0]
    if (firstLanguage && !languages.some((item) => item.key === titleLanguage)) {
      setTitleLanguage(firstLanguage.key)
    }
  }, [languages, setTitleLanguage, titleLanguage])

  useEffect(() => {
    const firstTitleModel = titleModels[0]
    if (firstTitleModel && !titleModels.some((item) => item.key === titleModel)) {
      setTitleModel(firstTitleModel.key)
    }
  }, [setTitleModel, titleModel, titleModels])

  useEffect(() => {
    if (detectionModelOptions.length === 0) {
      return
    }
    if (!detectionModel || !detectionModelOptions.includes(detectionModel)) {
      setDetectionModel(detectionConfig?.model ?? detectionModelOptions[0] ?? 'qwen3.6-flash')
    }
  }, [detectionConfig, detectionModel, detectionModelOptions, setDetectionModel])

  useEffect(() => {
    if (detectionSkillOptions.length === 0) {
      return
    }
    const configSkillKey =
      detectionConfig?.skillId && detectionConfig.skillVersion
        ? detectionSkillOptionKey({
            id: detectionConfig.skillId,
            version: detectionConfig.skillVersion,
          })
        : ''
    if (
      !detectionSkillKey ||
      !detectionSkillOptions.some((item) => item.key === detectionSkillKey)
    ) {
      setDetectionSkillKey(
        detectionSkillOptions.some((item) => item.key === configSkillKey)
          ? configSkillKey
          : (detectionSkillOptions[0]?.key ?? ''),
      )
    }
  }, [detectionConfig, detectionSkillKey, detectionSkillOptions, setDetectionSkillKey])

  useEffect(() => {
    if (!photoshopEnabled && titleEnabled) {
      setTitleEnabled(false)
    }
  }, [photoshopEnabled, setTitleEnabled, titleEnabled])

  function updatePrintMode(nextMode: PipelinePrintMode) {
    setPrintMode(nextMode)
    if (sourceMode !== 'existing_prints') {
      setMattingEnabled(nextMode === 'local')
    }
  }

  function updateSourceMode(nextMode: TaskSourceMode) {
    setPromptRequirementOpen(false)
    setSourceMode(nextMode)
    if (nextMode === 'existing_prints') {
      existingPrintToggleSnapshotRef.current = {
        mattingEnabled,
        detectionEnabled,
        photoshopEnabled,
        titleEnabled,
      }
      setMattingEnabled(false)
      setDetectionEnabled(false)
      setPhotoshopEnabled(true)
      setTitleEnabled(true)
    }
  }

  async function chooseSourceFolder() {
    const selected = await chooseSourceFolderMutation.run()
    if (selected?.ok) {
      setSourceFolder(selected.data.path)
    }
  }

  async function chooseImg2imgSourceFolder() {
    const selected = await chooseImg2imgSourceFolderMutation.run()
    if (selected?.ok) {
      setImg2imgSourceFolder(selected.data.path)
    }
  }

  async function chooseExistingPrintFolder() {
    const selected = await chooseExistingPrintFolderMutation.run()
    if (selected?.ok) {
      setExistingPrintFolder(selected.data.path)
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

  async function chooseTemplates() {
    const selected = await chooseTemplatesMutation.run()
    if (selected?.ok) {
      setTemplatePaths(selected.data.paths)
    }
  }

  async function chooseOutputRoot() {
    const selected = await chooseOutputRootMutation.run()
    if (selected?.ok) {
      setOutputRoot(selected.data.path)
    }
  }

  function buildPromptConfig(): PipelinePromptConfig {
    const skill = selectedPromptSkill
    return {
      mode: 'ai',
      requirement: promptRequirement,
      count: numberFromText(promptCount, 5),
      model: promptModel,
      ...(sourceMode === 'img2img' && selectedImg2imgReferenceMode?.instruction
        ? { modeInstruction: selectedImg2imgReferenceMode.instruction }
        : {}),
      ...(skill
        ? { skillId: skill.id, ...(skill.version ? { skillVersion: skill.version } : {}) }
        : {}),
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
                ...(selectedExtractSkill
                  ? {
                      skillId: selectedExtractSkill.id,
                      ...(selectedExtractSkill.version
                        ? { skillVersion: selectedExtractSkill.version }
                        : {}),
                    }
                  : {}),
                grsai,
              }
            : {
                provider: 'comfyui-chenyu',
                ...(selectedExtractSkill
                  ? {
                      skillId: selectedExtractSkill.id,
                      ...(selectedExtractSkill.version
                        ? { skillVersion: selectedExtractSkill.version }
                        : {}),
                    }
                  : {}),
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
    if (sourceMode === 'existing_prints') {
      return {
        mode: 'existing_prints',
        printFolder: existingPrintFolder,
        startStep: existingPrintStartStep,
      }
    }
    if (sourceMode === 'txt2img') {
      if (txt2imgProvider === 'comfyui-chenyu') {
        return {
          mode: 'txt2img',
          provider: 'comfyui-chenyu',
          prompt: buildPromptConfig(),
          comfyui: {
            workflowId: txt2imgComfyuiWorkflowId,
            instanceUuid: txt2imgComfyuiInstanceUuid,
            width: numberFromText(width, 1024),
            height: numberFromText(height, 1024),
            concurrency: 1,
          },
        }
      }
      return {
        mode: 'txt2img',
        provider: 'grsai',
        prompt: buildPromptConfig(),
        grsai,
      }
    }
    if (img2imgProvider === 'comfyui-chenyu') {
      return {
        mode: 'img2img',
        provider: 'comfyui-chenyu',
        sourceFolder: img2imgSourceFolder,
        prompt:
          img2imgComfyuiPromptMode === 'ai'
            ? buildPromptConfig()
            : {
                mode: 'workflow',
              },
        comfyui: {
          workflowId: img2imgComfyuiWorkflowId,
          instanceUuid: img2imgComfyuiInstanceUuid,
          width: numberFromText(width, 1024),
          height: numberFromText(height, 1024),
          batchSize: numberFromText(img2imgComfyuiBatchSize, 1),
        },
      }
    }
    return {
      mode: 'img2img',
      provider: 'grsai',
      referenceImages: referenceImages.map((image) => ({
        name: image.name,
        base64: image.base64,
        mime_type: image.mime_type,
      })),
      prompt: buildPromptConfig(),
      sendReferenceImages: sendReferenceToImageModel,
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
    const selectedSkill = selectedDetectionSkill
    return {
      enabled: effectiveDetectionEnabled,
      allowReview: detectionPassRule === 'allow-review',
      skillId: selectedSkill?.id ?? base.skillId,
      skillVersion: selectedSkill?.version ?? base.skillVersion,
      model: detectionModel || base.model,
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

  function updateTitleKeywordGroup(index: number, key: keyof TitleKeywordGroup, value: string) {
    setTitleKeywordGroups((current) =>
      current.map((group, groupIndex) =>
        groupIndex === index ? { ...group, [key]: value } : group,
      ),
    )
  }

  function addTitleKeywordGroup() {
    setTitleKeywordGroups((current) => [...current, createTitleKeywordGroupDraft()])
  }

  function removeTitleKeywordGroup(index: number) {
    setTitleKeywordGroups((current) => {
      const nextGroups = current.filter((_, groupIndex) => groupIndex !== index)
      return nextGroups.length ? nextGroups : [createTitleKeywordGroupDraft()]
    })
  }

  function buildConfig(): PipelineRunConfig {
    return {
      ...(nonEmpty(name) ? { name: name.trim() } : {}),
      ...(nonEmpty(printSkuCode) ? { printSkuCode: printSkuCode.trim() } : {}),
      ...(filenameSeparator !== '-' ? { filenameSeparator } : {}),
      printMode,
      source: buildSourceConfig(),
      matting: {
        enabled: effectiveMattingEnabled,
        mode: 'comfyui',
        ...(nonEmpty(mattingWorkflowId) ? { workflowId: mattingWorkflowId.trim() } : {}),
        ...(nonEmpty(mattingInstanceUuid) ? { instanceUuid: mattingInstanceUuid.trim() } : {}),
        width: numberFromText(width, 1024),
        height: numberFromText(height, 1024),
      },
      detection: buildDetectionConfig(),
      photoshop: {
        enabled: effectivePhotoshopEnabled,
        templates: templatePaths,
        ...(nonEmpty(outputRoot) ? { outputRoot: outputRoot.trim() } : {}),
        replaceRange,
        format,
        clipMode,
        skipCompleted,
        maxRetries: numberFromText(photoshopMaxRetries, 1),
      },
      title: {
        enabled: effectiveTitleEnabled,
        platform: titlePlatform,
        language: titleLanguage,
        model: titleModel,
        titleFileName,
        imageIndex: numberFromText(titleImageIndex, 1),
        existingStrategy: titleExistingStrategy,
        maxRetries: numberFromText(titleMaxRetries, 2),
        ...(nonEmpty(extraRequirement) ? { extraRequirement: extraRequirement.trim() } : {}),
        keywordGroups: titleKeywordGroups,
        keywordGroupSeparator: titleKeywordGroupSeparator,
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
    setMessage('正在提交完整任务')
    try {
      const runId = await window.api.pipeline.run(buildConfig())
      setCurrentRunId(runId)
      setRunning(true)
      setMessage('完整任务已启动')
      void refreshRunHistory()
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : '完整任务启动失败')
    }
  }

  async function resumePipeline(runId: string) {
    setError(null)
    setMessage('正在从中断处继续')
    const resumedRunId = await resumePipelineMutation.run(runId)
    if (!resumedRunId) {
      return
    }
    setCurrentRunId(resumedRunId)
    setRunning(true)
    setMessage('完整任务续跑已启动')
    void refreshRunHistory()
  }

  async function cancelPipeline() {
    if (!currentRunId) {
      return
    }
    const result = await cancelPipelineMutation.run(currentRunId)
    if (!result) {
      return
    }
    if (!result.ok) {
      setError('当前完整任务已结束，无法取消')
      return
    }
    setMessage('已请求取消，当前步骤结束后停止')
  }

  return (
    <div className="space-y-5">
      <div className="space-y-5">
        {isMac && effectivePhotoshopEnabled ? (
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
                <CardDescription>上方配置，下方按模块查看预览和日志。</CardDescription>
              </div>
              <Badge variant="secondary">可视化</Badge>
            </div>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_minmax(180px,260px)_120px_220px]">
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
                  placeholder="例如 gyxkj"
                  value={printSkuCode}
                />
              </Field>
              <Field label="分隔符">
                <Input
                  onChange={(event) => setFilenameSeparator(event.target.value)}
                  placeholder="-"
                  value={filenameSeparator}
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
                  <p className="text-sm font-medium text-muted-foreground">任务起点</p>
                  <h2 className="mt-1 text-lg font-semibold">任务起点</h2>
                  <p className="mt-1 text-sm text-muted-foreground">
                    采集+提取、文生图、图生图、已有印花只保留各自需要的设置。
                  </p>
                </div>
                <Badge variant="secondary">{sourceBadgeLabel}</Badge>
              </div>

              <Tabs
                className="mt-4"
                onValueChange={(value) => updateSourceMode(value as TaskSourceMode)}
                value={sourceMode}
              >
                <TabsList className="grid w-full grid-cols-2 md:grid-cols-4">
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
                      <Field label="采集文件夹">
                        <Input
                          onChange={(event) => setSourceFolder(event.target.value)}
                          placeholder="选择采集图片文件夹"
                          value={sourceFolder}
                        />
                      </Field>
                      <Button
                        className="mt-7 h-10"
                        disabled={chooseSourceFolderMutation.loading}
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
                      <SelectField
                        label="提取 Skill"
                        onValueChange={setExtractSkillId}
                        options={extractSkillOptions}
                        value={extractSkillId}
                      />
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
                          label="晨羽工作流"
                          onValueChange={setExtractWorkflowId}
                          options={extractWorkflows}
                          value={extractWorkflowId}
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
                        <ChenyuInstanceSelectField
                          instances={runningInstances}
                          loading={optionsLoading}
                          onRefresh={() => void refreshOptions()}
                          onValueChange={setExtractInstanceUuid}
                          options={runningInstanceOptions}
                          value={extractInstanceUuid}
                        />
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
                      <Badge variant="secondary">
                        {txt2imgProvider === 'grsai' ? 'AI 写提示词' : '晨羽工作流'}
                      </Badge>
                      <span className="text-muted-foreground">
                        {txt2imgProvider === 'grsai'
                          ? 'AI 生成提示词后再走 Grsai 付费生图。'
                          : '提示词先走百炼，再送入晨羽文生图工作流。'}
                      </span>
                    </div>
                    <div className="grid gap-4 lg:grid-cols-[minmax(180px,220px)_1fr]">
                      <SelectField
                        label="生图方式"
                        onValueChange={(value) => setTxt2imgProvider(value as Txt2imgProvider)}
                        options={[
                          { key: 'grsai', label: 'Grsai' },
                          { key: 'comfyui-chenyu', label: '晨羽智云' },
                        ]}
                        value={txt2imgProvider}
                      />
                      {txt2imgUsesComfyui ? (
                        <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_auto]">
                          <SelectField
                            label="文生图工作流"
                            onValueChange={setTxt2imgComfyuiWorkflowId}
                            options={txt2imgWorkflows}
                            value={txt2imgComfyuiWorkflowId}
                          />
                          <Button
                            className="mt-7 h-10"
                            onClick={() => void refreshOptions()}
                            variant="outline"
                          >
                            <RefreshCw className="mr-2 h-4 w-4" />
                            刷新
                          </Button>
                        </div>
                      ) : null}
                    </div>
                    <div className="grid gap-4 lg:grid-cols-4">
                      <SelectField
                        label="提示词 Skill"
                        onValueChange={setPromptSkillId}
                        options={promptSkillOptions}
                        value={promptSkillId}
                      />
                      <SelectField
                        label="提示词模型"
                        onValueChange={setPromptModel}
                        options={promptModelOptions}
                        value={promptModel}
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

                    {txt2imgProvider === 'grsai' ? (
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
                    ) : (
                      <div className="grid gap-4 md:grid-cols-3">
                        <ChenyuInstanceSelectField
                          instances={runningInstances}
                          loading={optionsLoading}
                          onRefresh={() => void refreshOptions()}
                          onValueChange={setTxt2imgComfyuiInstanceUuid}
                          options={runningInstanceOptions}
                          value={txt2imgComfyuiInstanceUuid}
                        />
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
                      </div>
                    )}
                  </>
                ) : null}

                {sourceMode === 'img2img' ? (
                  <>
                    {img2imgUsesGrsai ? (
                      <ReferenceImagePicker
                        images={referenceImages}
                        onAddFiles={(files) => void addReferenceFiles(files)}
                        onRemove={removeReferenceImage}
                      />
                    ) : null}

                    <div className="flex flex-wrap items-center gap-2 text-sm">
                      <Badge variant="secondary">
                        {img2imgProvider === 'grsai' ? '固定付费模型' : '晨羽工作流'}
                      </Badge>
                      <span className="text-muted-foreground">
                        {img2imgProvider === 'grsai'
                          ? '默认只用于提示词生成，勾选后才送给 Grsai 图片模型。'
                          : '选择图片文件夹、工作流、晨羽实例和每张生成数量。'}
                      </span>
                    </div>

                    <div className="grid gap-4 lg:grid-cols-[minmax(180px,220px)_1fr]">
                      <SelectField
                        label="生图方式"
                        onValueChange={(value) => setImg2imgProvider(value as Img2imgProvider)}
                        options={[
                          { key: 'grsai', label: 'Grsai' },
                          { key: 'comfyui-chenyu', label: '晨羽智云' },
                        ]}
                        value={img2imgProvider}
                      />
                      {img2imgUsesComfyui ? (
                        <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_auto]">
                          <Field label="图片文件夹">
                            <Input
                              onChange={(event) => setImg2imgSourceFolder(event.target.value)}
                              placeholder="选择任意图片文件夹"
                              value={img2imgSourceFolder}
                            />
                          </Field>
                          <Button
                            className="mt-7 h-10"
                            disabled={chooseImg2imgSourceFolderMutation.loading}
                            onClick={() => void chooseImg2imgSourceFolder()}
                            variant="outline"
                          >
                            <FolderOpen className="mr-2 h-4 w-4" />
                            选择
                          </Button>
                        </div>
                      ) : null}
                    </div>

                    {img2imgUsesGrsai ? (
                      <>
                        <label
                          className="inline-flex w-fit items-center gap-2 rounded-md border px-3 py-2 text-sm font-medium"
                          htmlFor="send-reference-to-image-model"
                        >
                          <Checkbox
                            aria-label="生图时带参考图"
                            checked={sendReferenceToImageModel}
                            id="send-reference-to-image-model"
                            onCheckedChange={(checked) =>
                              setSendReferenceToImageModel(Boolean(checked))
                            }
                          />
                          生图时带参考图
                        </label>

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

                        <div className="grid gap-4 lg:grid-cols-4">
                          <SelectField
                            label="提示词 Skill"
                            onValueChange={setPromptSkillId}
                            options={promptSkillOptions}
                            value={promptSkillId}
                          />
                          <SelectField
                            label="提示词模型"
                            onValueChange={setPromptModel}
                            options={promptModelOptions}
                            value={promptModel}
                          />
                          <PromptRequirementField
                            id="img2img-print-requirement"
                            label="印花要求"
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
                    ) : (
                      <>
                        <div className="grid gap-4 md:grid-cols-4">
                          <SelectField
                            label="图生图工作流"
                            onValueChange={setImg2imgComfyuiWorkflowId}
                            options={img2imgWorkflows}
                            value={img2imgComfyuiWorkflowId}
                          />
                          <ChenyuInstanceSelectField
                            instances={runningInstances}
                            loading={optionsLoading}
                            onRefresh={() => void refreshOptions()}
                            onValueChange={setImg2imgComfyuiInstanceUuid}
                            options={runningInstanceOptions}
                            value={img2imgComfyuiInstanceUuid}
                          />
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
                        </div>
                        <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_160px]">
                          <Field label="每张生成">
                            <Input
                              className="tabular-nums"
                              min={1}
                              max={8}
                              onChange={(event) => setImg2imgComfyuiBatchSize(event.target.value)}
                              type="number"
                              value={img2imgComfyuiBatchSize}
                            />
                          </Field>
                          <SelectField
                            label="提示词方式"
                            onValueChange={(value) =>
                              setImg2imgComfyuiPromptMode(value as ComfyuiImg2imgPromptMode)
                            }
                            options={[
                              { key: 'ai', label: 'AI 看图写提示词（推荐）' },
                              { key: 'workflow', label: '工作流默认' },
                            ]}
                            value={img2imgComfyuiPromptMode}
                          />
                        </div>
                        {img2imgComfyuiPromptMode === 'ai' ? (
                          <>
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
                                label="提示词 Skill"
                                onValueChange={setPromptSkillId}
                                options={promptSkillOptions}
                                value={promptSkillId}
                              />
                              <SelectField
                                label="提示词模型"
                                onValueChange={setPromptModel}
                                options={promptModelOptions}
                                value={promptModel}
                              />
                              <PromptRequirementField
                                id="img2img-comfyui-print-requirement"
                                label="其他要求"
                                onOpenChange={setPromptRequirementOpen}
                                onValueChange={setPromptRequirement}
                                open={promptRequirementOpen}
                                value={promptRequirement}
                              />
                            </div>
                          </>
                        ) : null}
                      </>
                    )}
                  </>
                ) : null}

                {sourceMode === 'existing_prints' ? (
                  <>
                    <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_auto]">
                      <Field label="已有印花文件夹">
                        <Input
                          onChange={(event) => setExistingPrintFolder(event.target.value)}
                          placeholder="选择 02-印花工作区 下的具体印花文件夹"
                          value={existingPrintFolder}
                        />
                      </Field>
                      <Button
                        className="mt-7 h-10"
                        disabled={chooseExistingPrintFolderMutation.loading}
                        onClick={() => void chooseExistingPrintFolder()}
                        variant="outline"
                      >
                        <FolderOpen className="mr-2 h-4 w-4" />
                        选择
                      </Button>
                    </div>
                    <SelectField
                      label="起始步骤"
                      onValueChange={(value) =>
                        setExistingPrintStartStep(value as PipelineStartStep)
                      }
                      options={existingPrintStartStepOptions}
                      value={existingPrintStartStep}
                    />
                    <div className="rounded-md border border-dashed px-3 py-3 text-sm text-muted-foreground">
                      不能选择 02-印花工作区 根目录或等待套版目录；启用 PS
                      时会按印花货号重新生成等待套版文件名。
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
                      checked={effectiveMattingEnabled}
                      disabled={mattingLockedOn || mattingLockedSkipped}
                      onCheckedChange={(checked) => setMattingEnabled(Boolean(checked))}
                    />
                    {mattingLockedSkipped ? '跳过抠图' : '启用抠图'}
                  </label>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                {effectiveMattingEnabled ? (
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
                      <ChenyuInstanceSelectField
                        instances={runningInstances}
                        loading={optionsLoading}
                        onRefresh={() => void refreshOptions()}
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
                    {mattingLockedSkipped
                      ? '当前起始步骤会跳过抠图。'
                      : '已关闭抠图，后续步骤会直接进入侵权检测和套版。'}
                  </div>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <CardTitle className="text-lg">侵权检测 / 套版 / 标题</CardTitle>
                    <CardDescription>后续步骤按开关顺序执行，未开启不参与校验。</CardDescription>
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
                      checked={effectiveDetectionEnabled}
                      disabled={detectionLockedOn || detectionLockedSkipped}
                      onCheckedChange={(checked) => setDetectionEnabled(Boolean(checked))}
                    />
                    {detectionLockedSkipped ? '跳过检测' : '启用检测'}
                  </label>
                </div>

                {effectiveDetectionEnabled ? (
                  <div className="space-y-4">
                    <div className="grid gap-4 lg:grid-cols-3">
                      <SelectField
                        label="检测模型"
                        onValueChange={setDetectionModel}
                        options={detectionModelOptions.map((item) => ({
                          key: item,
                          label: item,
                        }))}
                        value={detectionModel}
                      />
                      <SelectField
                        label="检测 Skill"
                        onValueChange={setDetectionSkillKey}
                        options={detectionSkillOptions}
                        value={detectionSkillKey}
                      />
                      <SelectField
                        label="通过要求"
                        onValueChange={(value) => setDetectionPassRule(value as DetectionPassRule)}
                        options={[
                          { key: 'allow-review', label: '无风险 + 疑似通过' },
                          { key: 'pass-only', label: '仅无风险通过' },
                        ]}
                        value={detectionPassRule}
                      />
                    </div>
                    <div className="grid gap-3 rounded-md border bg-muted/20 p-3 text-sm text-muted-foreground md:grid-cols-3">
                      <div>
                        <p className="text-xs">默认配置</p>
                        <p className="mt-1 truncate font-medium text-foreground">
                          {detectionConfig?.model || '未加载'}
                        </p>
                      </div>
                      <div>
                        <p className="text-xs">本次 Skill</p>
                        <p className="mt-1 truncate font-medium text-foreground">
                          {selectedDetectionSkill?.id || '未选择'}
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
                    {detectionLockedSkipped
                      ? '当前起始步骤会跳过侵权检测。'
                      : '已关闭侵权检测，后续会直接进入已开启的下一步。'}
                  </div>
                )}

                <Separator />

                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-medium text-muted-foreground">PS 套版</p>
                    <p className="mt-1 text-sm text-muted-foreground">
                      开启后才要求印花货号、PSD 模板和 Windows 环境。
                    </p>
                  </div>
                  <label
                    className="flex items-center gap-2 rounded-md border px-3 py-2 text-sm font-medium"
                    htmlFor="photoshop-enabled"
                  >
                    <Checkbox
                      aria-label="启用 PS 套版"
                      checked={effectivePhotoshopEnabled}
                      disabled={photoshopLockedOn}
                      id="photoshop-enabled"
                      onCheckedChange={(checked) => setPhotoshopEnabled(Boolean(checked))}
                    />
                    启用套版
                  </label>
                </div>

                {effectivePhotoshopEnabled ? (
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
                        disabled={chooseTemplatesMutation.loading}
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
                        disabled={chooseOutputRootMutation.loading}
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
                          checked={skipCompleted}
                          id="skip-completed"
                          onCheckedChange={(checked) => setSkipCompleted(Boolean(checked))}
                        />
                        跳过已完成
                      </label>
                    </div>

                    <div className="grid gap-4 lg:grid-cols-4">
                      <SelectField
                        label="替换范围"
                        onValueChange={(value) =>
                          setReplaceRange(value as 'auto' | 'topmost' | 'top' | 'all')
                        }
                        options={[
                          { key: 'topmost', label: '最上方智能对象（推荐）' },
                          { key: 'auto', label: '自动识别（最上方优先）' },
                          { key: 'top', label: '根级智能对象' },
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
                          max={5}
                          min={0}
                          onChange={(event) => setPhotoshopMaxRetries(event.target.value)}
                          type="number"
                          value={photoshopMaxRetries}
                        />
                      </Field>
                    </div>
                  </AdvancedDisclosure>
                ) : (
                  <div className="rounded-md border border-dashed px-3 py-4 text-sm text-muted-foreground">
                    已关闭 PS 套版，任务会在当前印花产物处结束。
                  </div>
                )}

                <Separator />

                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-medium text-muted-foreground">标题生成</p>
                    <p className="mt-1 text-sm text-muted-foreground">
                      需要 PS 套版产出的货号文件夹；关闭套版时不可开启。
                    </p>
                  </div>
                  <label
                    className="flex items-center gap-2 rounded-md border px-3 py-2 text-sm font-medium"
                    htmlFor="title-enabled"
                  >
                    <Checkbox
                      aria-label="启用标题生成"
                      checked={effectiveTitleEnabled}
                      disabled={!effectivePhotoshopEnabled}
                      id="title-enabled"
                      onCheckedChange={(checked) => setTitleEnabled(Boolean(checked))}
                    />
                    启用标题
                  </label>
                </div>

                {effectiveTitleEnabled ? (
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

                    <div className="grid gap-4 md:grid-cols-4">
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
                      <Field label="关键词分隔符">
                        <Input
                          onChange={(event) => setTitleKeywordGroupSeparator(event.target.value)}
                          placeholder="空格"
                          value={titleKeywordGroupSeparator}
                        />
                      </Field>
                    </div>

                    <div className="rounded-md border p-4">
                      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                        <div>
                          <p className="text-sm font-medium text-muted-foreground">标题关键词组</p>
                          <p className="mt-1 text-xs text-muted-foreground">
                            完整任务会在每个模板批次标题生成时按货号顺序平均分组。
                          </p>
                        </div>
                        <Button onClick={addTitleKeywordGroup} type="button" variant="secondary">
                          <Plus className="mr-2 h-4 w-4" />
                          新增组
                        </Button>
                      </div>

                      <div className="mt-4 space-y-2">
                        {titleKeywordGroups.map((group, index) => (
                          <div
                            className="grid gap-2 rounded-md border bg-background p-3 md:grid-cols-[72px_minmax(0,1fr)_minmax(0,1fr)_40px]"
                            key={group.id}
                          >
                            <div className="flex items-center text-sm font-medium text-muted-foreground">
                              第 {index + 1} 组
                            </div>
                            <Input
                              aria-label={`第 ${index + 1} 组前缀`}
                              onChange={(event) =>
                                updateTitleKeywordGroup(index, 'prefix', event.target.value)
                              }
                              placeholder="前缀关键词"
                              value={group.prefix ?? ''}
                            />
                            <Input
                              aria-label={`第 ${index + 1} 组后缀`}
                              onChange={(event) =>
                                updateTitleKeywordGroup(index, 'suffix', event.target.value)
                              }
                              placeholder="后缀关键词"
                              value={group.suffix ?? ''}
                            />
                            <Button
                              aria-label={`删除第 ${index + 1} 组`}
                              className="h-10 w-10 p-0"
                              onClick={() => removeTitleKeywordGroup(index)}
                              title={`删除第 ${index + 1} 组`}
                              type="button"
                              variant="ghost"
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </div>
                        ))}
                      </div>
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
                ) : (
                  <div className="rounded-md border border-dashed px-3 py-4 text-sm text-muted-foreground">
                    {effectivePhotoshopEnabled
                      ? '已关闭标题生成，任务会在 PS 套版后结束。'
                      : '标题生成需要先启用 PS 套版。'}
                  </div>
                )}
              </CardContent>
            </Card>

            {!running && validationIssues.length ? (
              <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-3 text-sm text-amber-800">
                <p className="font-medium">暂不能启动</p>
                <ul className="mt-2 list-disc space-y-1 pl-5">
                  {validationIssues.map((issue) => (
                    <li key={issue}>{issue}</li>
                  ))}
                </ul>
              </div>
            ) : null}

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
                disabled={!running || !currentRunId || cancelPipelineMutation.loading}
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
              <Button onClick={() => setIsLogOpen(true)} variant="secondary">
                <Settings2 className="mr-2 h-4 w-4" />
                日志 {progress?.logs?.length ?? 0}
              </Button>
              <span className="text-sm text-muted-foreground">{message}</span>
            </div>
          </CardContent>
        </Card>
      </div>

      <PipelineResultsPanel config={buildConfig()} message={message} progress={progress} />
      <PipelineRunHistoryPanel
        currentRunId={currentRunId}
        loading={runHistoryLoading}
        onRefresh={() => void refreshRunHistory()}
        onResume={(runId) => void resumePipeline(runId)}
        resumeLoading={resumePipelineMutation.loading}
        runs={runHistory}
      />
      <PipelineItemsPanel progress={progress} />

      <PipelineLogDialog logs={progress?.logs ?? []} onOpenChange={setIsLogOpen} open={isLogOpen} />
    </div>
  )
}
