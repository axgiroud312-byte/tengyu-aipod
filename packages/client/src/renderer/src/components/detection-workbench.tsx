import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { progressPercent } from '@/lib/format'
import { detectionImageSrc } from '@/lib/media'
import type { RiskLevel, Skill, SkillSummary, SkillVariable } from '@tengyu-aipod/shared'
import {
  CheckCircle2,
  CheckSquare,
  ClipboardCheck,
  FolderOpen,
  ImageIcon,
  Loader2,
  Play,
  RefreshCw,
  Save,
  ShieldAlert,
  ShieldCheck,
  ShieldQuestion,
  SlidersHorizontal,
  Square,
  Trash2,
  Upload,
  X,
} from 'lucide-react'
import { type DragEvent as ReactDragEvent, useEffect, useMemo, useRef, useState } from 'react'
import type { DetectionConfig, DetectionThresholdConfig } from '../../../main/lib/detection-config'
import type {
  DetectionImageInfo,
  DetectionImageResult,
  DetectionInputSource,
  DetectionProgress,
  DetectionTaskEvent,
} from '../../../main/lib/detection-service'
import { type DetectionPreviewResult, detectionPreviewResults } from './detection-preview'
import { ImageLightbox, type ImageLightboxItem } from './image-lightbox'

const DEFAULT_MODEL = 'qwen3.6-flash'
const DEFAULT_DETECTION_SKILL_ID = 'infringement-detection'
const DEFAULT_THRESHOLD = { passMax: 39, reviewMax: 69 }
const DEFAULT_MAX_SIZE = 1024
const DEFAULT_CONCURRENCY = 20
const MAX_CONCURRENCY = 20
const DEFAULT_MAX_RETRIES = 1

const RISK_LEVELS: RiskLevel[] = ['pass', 'review', 'block']

const riskLabels: Record<RiskLevel, string> = {
  pass: '无风险',
  review: '疑似',
  block: '高风险',
}

function skillKey(skill: SkillSummary) {
  return `${skill.id}@@${skill.version}`
}

function parseSkillKey(value: string) {
  const [id, version] = value.split('@@')
  return id && version ? { id, version } : null
}

function fileName(path: string) {
  return path.split(/[\\/]/).filter(Boolean).at(-1) ?? path
}

function detectionPreviewItem(result: DetectionPreviewResult): ImageLightboxItem {
  const riskLabel = riskLabels[result.riskLevel]
  return {
    alt: fileName(result.imagePath),
    eyebrow: `${riskLabel} · 风险值 ${result.riskScore}`,
    note: (
      <div>
        <p className="text-xs font-medium text-muted-foreground">判断原因</p>
        <p className="mt-1 whitespace-pre-wrap text-sm text-foreground">
          {result.reason || '暂无判断原因'}
        </p>
      </div>
    ),
    src: detectionImageSrc({
      path: result.imagePath,
      thumbnailUrl: result.thumbnailUrl,
    }),
    title: fileName(result.imagePath),
    details: [
      { label: '风险等级', value: riskLabel },
      { label: '风险值', value: result.riskScore },
      { label: '印花 ID', value: result.printId, mono: true },
      { label: 'Artifact ID', value: result.artifactId, mono: true },
      { label: '缓存结果', value: result.cached ? '是' : '否' },
      { label: '图片路径', value: result.imagePath, mono: true },
    ],
  }
}

function defaultVariableValue(variable: SkillVariable) {
  if (Array.isArray(variable.default)) {
    return variable.default.map(String)
  }
  if (variable.type === 'checkbox') {
    return Boolean(variable.default)
  }
  if (variable.type === 'number') {
    return typeof variable.default === 'number' ? variable.default : (variable.min ?? 0)
  }
  if (typeof variable.default === 'string') {
    return variable.default
  }
  return ''
}

function variablesForSkill(skill: Skill, existing?: Record<string, unknown>) {
  return Object.fromEntries(
    skill.variables.map((variable) => [
      variable.key,
      existing?.[variable.key] ?? defaultVariableValue(variable),
    ]),
  )
}

function selectDefaultSkill(skills: SkillSummary[], config: DetectionConfig | null) {
  return (
    skills.find((skill) => skill.id === config?.skillId && skill.version === config.skillVersion) ??
    skills.find((skill) => skill.id === DEFAULT_DETECTION_SKILL_ID) ??
    skills.find((skill) => skill.module === 'detection') ??
    null
  )
}

function thresholdSummary(threshold: DetectionThresholdConfig) {
  return [
    `无风险 0-${threshold.passMax}`,
    threshold.passMax < threshold.reviewMax
      ? `疑似 ${threshold.passMax + 1}-${threshold.reviewMax}`
      : '疑似 无',
    threshold.reviewMax < 100 ? `高风险 ${threshold.reviewMax + 1}-100` : '高风险 无',
  ]
}

function isDetectedResult(
  result: DetectionImageResult,
): result is Extract<DetectionImageResult, { status: 'success' | 'skipped' }> {
  return result.status !== 'failed'
}

function isFailedResult(
  result: DetectionImageResult,
): result is Extract<DetectionImageResult, { status: 'failed' }> {
  return result.status === 'failed'
}

function riskTone(level: RiskLevel) {
  switch (level) {
    case 'pass':
      return {
        border: 'border-emerald-200',
        surface: 'bg-emerald-50',
        text: 'text-emerald-800',
        icon: ShieldCheck,
      }
    case 'review':
      return {
        border: 'border-amber-200',
        surface: 'bg-amber-50',
        text: 'text-amber-900',
        icon: ShieldQuestion,
      }
    case 'block':
      return {
        border: 'border-red-200',
        surface: 'bg-red-50',
        text: 'text-red-800',
        icon: ShieldAlert,
      }
  }
}

function droppedFilePath(file: File) {
  return (file as File & { path?: string }).path?.trim() ?? ''
}

type DropEntry = {
  isFile: boolean
  isDirectory: boolean
}
type DropFileEntry = DropEntry & {
  file: (callback: (file: File & { path?: string }) => void, error?: () => void) => void
}
type DropDirectoryEntry = DropEntry & {
  createReader: () => {
    readEntries: (callback: (entries: DropEntry[]) => void, error?: () => void) => void
  }
}
type DropItem = DataTransferItem & {
  webkitGetAsEntry?: () => DropEntry | null
}

async function readAllDirectoryEntries(entry: DropDirectoryEntry): Promise<DropEntry[]> {
  const reader = entry.createReader()
  const entries: DropEntry[] = []

  return await new Promise((resolve) => {
    function readNext() {
      reader.readEntries(
        (batch) => {
          if (!batch.length) {
            resolve(entries)
            return
          }
          entries.push(...batch)
          readNext()
        },
        () => resolve(entries),
      )
    }
    readNext()
  })
}

async function readDroppedEntryPaths(entry: DropEntry): Promise<string[]> {
  if (entry.isFile) {
    return await new Promise((resolve) => {
      ;(entry as DropFileEntry).file(
        (file) => {
          const path = droppedFilePath(file)
          resolve(path ? [path] : [])
        },
        () => resolve([]),
      )
    })
  }
  if (!entry.isDirectory) {
    return []
  }

  const nestedEntries = await readAllDirectoryEntries(entry as DropDirectoryEntry)
  const nestedPaths = await Promise.all(nestedEntries.map(readDroppedEntryPaths))
  return nestedPaths.flat()
}

async function collectDroppedPaths(dataTransfer: DataTransfer): Promise<string[]> {
  const itemPaths = await Promise.all(
    Array.from(dataTransfer.items)
      .filter((item) => item.kind === 'file')
      .map(async (item) => {
        const entry = (item as DropItem).webkitGetAsEntry?.()
        if (entry) {
          return readDroppedEntryPaths(entry)
        }
        const file = item.getAsFile()
        const path = file ? droppedFilePath(file) : ''
        return path ? [path] : []
      }),
  )

  const paths = itemPaths.flat().filter(Boolean)
  if (paths.length) {
    return Array.from(new Set(paths))
  }

  return Array.from(new Set(Array.from(dataTransfer.files).map(droppedFilePath).filter(Boolean)))
}

function ImageFolderPanel({
  sourceLabel,
  inputSources,
  images,
  selectedPaths,
  selectedCount,
  loading,
  onChoose,
  onScan,
  onUseSource,
  onDropPaths,
  onToggleImage,
  onSelectAll,
  onClearSelection,
}: {
  sourceLabel: string
  inputSources: DetectionInputSource[]
  images: DetectionImageInfo[]
  selectedPaths: Set<string>
  selectedCount: number
  loading: boolean
  onChoose: () => void
  onScan: () => void
  onUseSource: (source: DetectionInputSource) => Promise<void> | void
  onDropPaths: (paths: string[]) => Promise<void> | void
  onToggleImage: (path: string) => void
  onSelectAll: () => void
  onClearSelection: () => void
}) {
  const [dragging, setDragging] = useState(false)
  const dragCounterRef = useRef(0)

  async function handleDrop(event: ReactDragEvent<HTMLDivElement>) {
    event.preventDefault()
    dragCounterRef.current = 0
    setDragging(false)
    if (loading) {
      return
    }
    const paths = await collectDroppedPaths(event.dataTransfer)
    if (!paths.length) {
      return
    }
    await onDropPaths(paths)
  }

  function handleDragEnter(event: ReactDragEvent<HTMLDivElement>) {
    event.preventDefault()
    if (loading) {
      return
    }
    dragCounterRef.current += 1
    setDragging(true)
  }

  function handleDragLeave(event: ReactDragEvent<HTMLDivElement>) {
    event.preventDefault()
    if (loading) {
      return
    }
    dragCounterRef.current = Math.max(0, dragCounterRef.current - 1)
    if (dragCounterRef.current === 0) {
      setDragging(false)
    }
  }

  function handleDragOver(event: ReactDragEvent<HTMLDivElement>) {
    event.preventDefault()
    if (!loading) {
      event.dataTransfer.dropEffect = 'copy'
    }
  }

  return (
    <section className="rounded-md border bg-background p-4 shadow-sm">
      <div
        className={`rounded-md border border-dashed p-4 transition ${
          dragging ? 'border-primary bg-primary/5' : 'border-border bg-muted/20'
        }`}
        onDragEnter={handleDragEnter}
        onDragLeave={handleDragLeave}
        onDragOver={handleDragOver}
        onDrop={handleDrop}
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-lg font-semibold text-balance">输入来源</h2>
            <p className="mt-1 truncate text-sm text-muted-foreground">
              {sourceLabel || '拖入图片或文件夹，或选择文件夹'}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button onClick={onChoose} type="button" variant="secondary">
              <FolderOpen className="mr-2 h-4 w-4" />
              选择文件夹
            </Button>
            <Button disabled={!sourceLabel || loading} onClick={onScan} type="button">
              {loading ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <RefreshCw className="mr-2 h-4 w-4" />
              )}
              检索图片
            </Button>
          </div>
        </div>
        <div className="mt-3 flex items-center gap-2 text-sm text-muted-foreground">
          <Upload className="h-4 w-4" />
          <span>{dragging ? '松开后自动扫描' : '支持拖入图片文件或文件夹'}</span>
        </div>
      </div>

      {inputSources.length ? (
        <div className="mt-4 grid gap-2 sm:grid-cols-2">
          {inputSources.map((source) => (
            <Button
              disabled={loading || !source.count}
              key={source.key}
              onClick={() => void onUseSource(source)}
              type="button"
              variant="secondary"
            >
              <FolderOpen className="mr-2 h-4 w-4" />
              全选 {source.label.replace(' / ', '/')}/ ({source.count} 张)
            </Button>
          ))}
        </div>
      ) : null}

      <div className="mt-4 flex flex-wrap items-center justify-between gap-2 rounded-md border bg-muted/30 px-3 py-2 text-sm">
        <span>
          <ImageIcon className="mr-2 inline h-4 w-4 text-muted-foreground" />共{' '}
          <span className="font-medium tabular-nums">{images.length}</span> 张，将运行{' '}
          <span className="font-medium tabular-nums">{selectedCount}</span> 次
        </span>
        <div className="flex gap-2">
          <Button disabled={!images.length} onClick={onSelectAll} type="button" variant="ghost">
            <CheckSquare className="mr-2 h-4 w-4" />
            全选
          </Button>
          <Button
            disabled={!images.length}
            onClick={onClearSelection}
            type="button"
            variant="ghost"
          >
            <X className="mr-2 h-4 w-4" />
            清空
          </Button>
        </div>
      </div>

      <div className="mt-4 grid max-h-[430px] min-w-0 gap-3 overflow-auto pr-1 sm:grid-cols-2 min-[1400px]:grid-cols-3">
        {images.length ? (
          images.map((image) => {
            const selected = selectedPaths.has(image.path)
            return (
              <label
                className={`min-w-0 rounded-md border p-2 text-sm transition ${
                  selected ? 'border-primary bg-primary/5' : 'bg-muted/20'
                }`}
                key={image.path}
              >
                <img
                  alt={image.name}
                  className="h-28 w-full rounded-sm bg-muted object-cover"
                  loading="lazy"
                  src={detectionImageSrc({ path: image.path, thumbnailUrl: image.thumbnailUrl })}
                />
                <span className="mt-2 flex items-center gap-2">
                  <input
                    checked={selected}
                    className="h-4 w-4"
                    onChange={() => onToggleImage(image.path)}
                    type="checkbox"
                  />
                  <span className="min-w-0 truncate font-medium">{image.name}</span>
                </span>
                <span className="block truncate text-xs text-muted-foreground">
                  {image.relativePath}
                </span>
              </label>
            )
          })
        ) : (
          <div className="rounded-md bg-muted px-3 py-10 text-center text-sm text-muted-foreground sm:col-span-2 xl:col-span-3">
            {sourceLabel ? '暂无图片' : '请选择文件夹或拖入内容'}
          </div>
        )}
      </div>
    </section>
  )
}

function DetectionRulesPanel({
  skills,
  skill,
  model,
  models,
  threshold,
  variables,
  compression,
  maxSize,
  format,
  concurrency,
  running,
  saving,
  onSkillChange,
  onModelChange,
  onThresholdChange,
  onVariableChange,
  onCompressionChange,
  onMaxSizeChange,
  onFormatChange,
  onConcurrencyChange,
  onSave,
}: {
  skills: SkillSummary[]
  skill: Skill | null
  model: string
  models: string[]
  threshold: DetectionThresholdConfig
  variables: Record<string, unknown>
  compression: boolean
  maxSize: number
  format: 'jpg' | 'png'
  concurrency: number
  running: boolean
  saving: boolean
  onSkillChange: (value: string) => void
  onModelChange: (value: string) => void
  onThresholdChange: (value: DetectionThresholdConfig) => void
  onVariableChange: (key: string, value: unknown) => void
  onCompressionChange: (enabled: boolean) => void
  onMaxSizeChange: (value: number) => void
  onFormatChange: (value: 'jpg' | 'png') => void
  onConcurrencyChange: (value: number) => void
  onSave: () => void
}) {
  return (
    <section className="min-w-0 border-t pt-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <SlidersHorizontal className="h-4 w-4 text-muted-foreground" />
            <h2 className="text-lg font-semibold">检测规则</h2>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            本次修改可直接运行，也可保存为默认配置。
          </p>
        </div>
        <Button
          disabled={saving || running || !skill}
          onClick={onSave}
          type="button"
          variant="secondary"
        >
          {saving ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <Save className="mr-2 h-4 w-4" />
          )}
          保存默认配置
        </Button>
      </div>

      <div className="mt-4 grid min-w-0 gap-4 sm:grid-cols-2">
        <label className="space-y-2 text-sm font-medium">
          <span>检测模型</span>
          <select
            className="h-10 w-full rounded-md border bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-primary"
            disabled={running}
            onChange={(event) => onModelChange(event.target.value)}
            value={model}
          >
            {(models.length ? models : [DEFAULT_MODEL]).map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </select>
        </label>
        <label className="space-y-2 text-sm font-medium">
          <span>检测 Skill</span>
          <select
            className="h-10 w-full rounded-md border bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-primary"
            disabled={running || !skills.length}
            onChange={(event) => onSkillChange(event.target.value)}
            value={skill ? skillKey(skill) : ''}
          >
            {skills.length ? (
              skills.map((item) => (
                <option key={skillKey(item)} value={skillKey(item)}>
                  {item.id} / {item.version}
                </option>
              ))
            ) : (
              <option value="">暂无可用 Skill</option>
            )}
          </select>
        </label>
      </div>

      <div className="mt-4 rounded-md border bg-muted/20 p-4">
        <div className="flex flex-wrap gap-2 text-xs font-medium">
          {thresholdSummary(threshold).map((item, index) => (
            <span
              className={
                index === 0 ? 'text-emerald-800' : index === 1 ? 'text-amber-900' : 'text-red-800'
              }
              key={item}
            >
              {item}
            </span>
          ))}
        </div>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <label className="space-y-2 text-sm">
            <span className="flex justify-between gap-3">
              <span>无风险上限</span>
              <span className="tabular-nums">{threshold.passMax}</span>
            </span>
            <input
              className="w-full"
              disabled={running}
              max={threshold.reviewMax}
              min={0}
              onChange={(event) =>
                onThresholdChange({
                  ...threshold,
                  passMax: Math.min(Number(event.target.value), threshold.reviewMax),
                })
              }
              type="range"
              value={threshold.passMax}
            />
          </label>
          <label className="space-y-2 text-sm">
            <span className="flex justify-between gap-3">
              <span>疑似上限</span>
              <span className="tabular-nums">{threshold.reviewMax}</span>
            </span>
            <input
              className="w-full"
              disabled={running}
              max={100}
              min={threshold.passMax}
              onChange={(event) =>
                onThresholdChange({
                  ...threshold,
                  reviewMax: Math.max(Number(event.target.value), threshold.passMax),
                })
              }
              type="range"
              value={threshold.reviewMax}
            />
          </label>
        </div>
      </div>

      {skill?.variables.length ? (
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          {skill.variables.map((variable) => {
            const value = variables[variable.key]
            if (variable.type === 'select') {
              const selectedValues = Array.isArray(value) ? value.map(String) : []
              const multiple = Array.isArray(variable.default)
              return (
                <label className="space-y-2 text-sm font-medium" key={variable.key}>
                  <span>{variable.label}</span>
                  <select
                    className={`${multiple ? 'min-h-24 py-2' : 'h-10'} w-full rounded-md border bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-primary`}
                    disabled={running}
                    multiple={multiple}
                    onChange={(event) =>
                      onVariableChange(
                        variable.key,
                        multiple
                          ? Array.from(event.target.selectedOptions).map((option) => option.value)
                          : event.target.value,
                      )
                    }
                    value={multiple ? selectedValues : typeof value === 'string' ? value : ''}
                  >
                    {variable.options?.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>
              )
            }
            if (variable.type === 'checkbox') {
              return (
                <div
                  className="flex items-center justify-between rounded-md border px-3 py-2 text-sm font-medium"
                  key={variable.key}
                >
                  <span>{variable.label}</span>
                  <Switch
                    aria-label={variable.label}
                    checked={Boolean(value)}
                    disabled={running}
                    onCheckedChange={(checked) => onVariableChange(variable.key, checked)}
                  />
                </div>
              )
            }
            if (variable.type === 'textarea') {
              return (
                <label className="space-y-2 text-sm font-medium sm:col-span-2" key={variable.key}>
                  <span>{variable.label}</span>
                  <textarea
                    className="min-h-24 w-full resize-y rounded-md border bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-primary"
                    disabled={running}
                    onChange={(event) => onVariableChange(variable.key, event.target.value)}
                    placeholder={variable.placeholder}
                    value={typeof value === 'string' ? value : ''}
                  />
                </label>
              )
            }
            return (
              <label className="space-y-2 text-sm font-medium" key={variable.key}>
                <span>{variable.label}</span>
                <input
                  className="h-10 w-full rounded-md border bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-primary"
                  disabled={running}
                  max={variable.max}
                  min={variable.min}
                  onChange={(event) =>
                    onVariableChange(
                      variable.key,
                      variable.type === 'number' ? Number(event.target.value) : event.target.value,
                    )
                  }
                  placeholder={variable.placeholder}
                  type={variable.type === 'number' ? 'number' : 'text'}
                  value={
                    variable.type === 'number'
                      ? typeof value === 'number'
                        ? value
                        : 0
                      : typeof value === 'string'
                        ? value
                        : ''
                  }
                />
              </label>
            )
          })}
        </div>
      ) : null}

      <div className="mt-4 grid min-w-0 gap-3 border-t pt-4 sm:grid-cols-2 min-[1500px]:grid-cols-4">
        <div className="flex items-center justify-between rounded-md border px-3 py-2 text-sm font-medium">
          <span>压缩图片</span>
          <Switch
            aria-label="压缩图片"
            checked={compression}
            disabled={running}
            onCheckedChange={onCompressionChange}
          />
        </div>
        <label className="space-y-1 text-sm font-medium">
          <span>最大边长</span>
          <input
            className="h-10 w-full rounded-md border bg-background px-3 text-sm tabular-nums outline-none focus-visible:ring-2 focus-visible:ring-primary"
            disabled={running}
            min={256}
            onChange={(event) => onMaxSizeChange(Math.max(256, Number(event.target.value) || 256))}
            type="number"
            value={maxSize}
          />
        </label>
        <label className="space-y-1 text-sm font-medium">
          <span>预处理格式</span>
          <select
            className="h-10 w-full rounded-md border bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-primary"
            disabled={running}
            onChange={(event) => onFormatChange(event.target.value === 'png' ? 'png' : 'jpg')}
            value={format}
          >
            <option value="jpg">JPG</option>
            <option value="png">PNG</option>
          </select>
        </label>
        <label className="space-y-1 text-sm font-medium">
          <span>并发</span>
          <input
            className="h-10 w-full rounded-md border bg-background px-3 text-sm tabular-nums outline-none focus-visible:ring-2 focus-visible:ring-primary"
            disabled={running}
            max={MAX_CONCURRENCY}
            min={1}
            onChange={(event) =>
              onConcurrencyChange(
                Math.max(1, Math.min(MAX_CONCURRENCY, Number(event.target.value) || 1)),
              )
            }
            type="number"
            value={concurrency}
          />
        </label>
      </div>
      <p className="mt-3 text-xs text-muted-foreground">
        可重试错误最多自动重试 {DEFAULT_MAX_RETRIES} 次。
      </p>
    </section>
  )
}

function RunPanel({
  imageCount,
  model,
  running,
  skillLoading,
  skillReady,
  skillLabel,
  concurrency,
  progress,
  onRun,
  onCancel,
}: {
  imageCount: number
  model: string
  running: boolean
  skillLoading: boolean
  skillReady: boolean
  skillLabel: string
  concurrency: number
  progress: DetectionProgress | null
  onRun: () => void
  onCancel: () => void
}) {
  const percent = progressPercent(progress)
  return (
    <aside
      aria-label="检测启动与运行"
      className="min-w-0 space-y-5 min-[1400px]:sticky min-[1400px]:top-6 min-[1400px]:self-start"
    >
      <section className="rounded-md border bg-background p-4 shadow-sm">
        <h2 className="text-lg font-semibold text-balance">启动检测</h2>
        <dl className="mt-4 grid grid-cols-2 gap-x-5 gap-y-3 text-sm">
          <div>
            <dt className="text-muted-foreground">运行图片</dt>
            <dd className="font-medium tabular-nums">{imageCount}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">并发</dt>
            <dd className="font-medium tabular-nums">{concurrency}</dd>
          </div>
          <div className="min-w-0">
            <dt className="text-muted-foreground">模型</dt>
            <dd className="truncate font-medium">{model || DEFAULT_MODEL}</dd>
          </div>
          <div className="min-w-0">
            <dt className="text-muted-foreground">Skill</dt>
            <dd className="truncate font-medium">
              {skillLoading ? '读取中' : skillReady ? skillLabel : '未就绪'}
            </dd>
          </div>
        </dl>

        <Button
          className="mt-5 w-full"
          disabled={running || !imageCount || !skillReady}
          onClick={onRun}
          type="button"
        >
          {running ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <Play className="mr-2 h-4 w-4" />
          )}
          开始检测
        </Button>
        {running ? (
          <Button className="mt-2 w-full" onClick={onCancel} type="button" variant="secondary">
            <Square className="mr-2 h-4 w-4" />
            取消任务
          </Button>
        ) : null}
      </section>

      <section className="rounded-md border bg-background p-4 shadow-sm">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-lg font-semibold text-balance">进度</h2>
          <span className="text-sm tabular-nums text-muted-foreground">{percent}%</span>
        </div>
        <div className="mt-4 h-2 overflow-hidden rounded-full bg-muted">
          <div className="h-full rounded-full bg-primary" style={{ width: `${percent}%` }} />
        </div>
        <dl className="mt-4 grid grid-cols-2 gap-y-3 text-sm">
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
            <dt className="text-muted-foreground">缓存</dt>
            <dd className="font-medium tabular-nums">{progress?.skipped ?? 0}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">失败</dt>
            <dd className="font-medium tabular-nums">{progress?.failed ?? 0}</dd>
          </div>
        </dl>
        {progress?.status === 'cancelled' ? (
          <div className="mt-3 rounded-md bg-muted px-3 py-2 text-sm text-muted-foreground">
            已取消
          </div>
        ) : null}
      </section>
    </aside>
  )
}

function RiskResults({
  level,
  results,
  pendingArtifactId,
  onOpenPreview,
  onRetest,
  onDelete,
}: {
  level: RiskLevel
  results: Array<Extract<DetectionImageResult, { status: 'success' | 'skipped' }>>
  pendingArtifactId: string | null
  onOpenPreview: (result: DetectionPreviewResult) => void
  onRetest: (result: DetectionPreviewResult) => void
  onDelete: (result: DetectionPreviewResult) => void
}) {
  const tone = riskTone(level)
  const Icon = tone.icon
  return (
    <section
      aria-label={`${riskLabels[level]}结果`}
      className={`rounded-md border ${tone.border} bg-background p-4`}
    >
      <div className="flex items-center justify-between gap-3">
        <div className={`flex items-center gap-2 ${tone.text}`}>
          <Icon className="h-4 w-4" />
          <h3 className="font-semibold">{riskLabels[level]}</h3>
        </div>
        <span className="font-medium tabular-nums">{results.length}</span>
      </div>
      <div className="mt-4 grid max-h-[520px] gap-3 overflow-auto pr-1 md:grid-cols-2 xl:grid-cols-1 2xl:grid-cols-2">
        {results.length ? (
          results.map((result) => {
            const name = fileName(result.imagePath)
            const pending = pendingArtifactId === result.artifactId
            return (
              <article
                className={`min-w-0 rounded-md border ${tone.border} ${tone.surface} p-2 text-sm`}
                key={result.artifactId}
              >
                <button
                  aria-label={`预览 ${name}`}
                  className="block w-full text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                  onClick={() => onOpenPreview(result)}
                  type="button"
                >
                  <img
                    alt={name}
                    className="h-28 w-full rounded-sm bg-muted object-cover"
                    loading="lazy"
                    src={detectionImageSrc({
                      path: result.imagePath,
                      thumbnailUrl: result.thumbnailUrl,
                    })}
                  />
                  <span className="mt-2 flex items-center justify-between gap-2">
                    <span className="truncate font-medium">{name}</span>
                    <span className={`inline-flex items-center gap-1 text-xs ${tone.text}`}>
                      <Icon className="h-3.5 w-3.5" />
                      {riskLabels[level]} {result.riskScore}
                    </span>
                  </span>
                  <span className="mt-1 line-clamp-2 text-xs text-muted-foreground">
                    {result.reason || '暂无判断原因'}
                  </span>
                </button>
                <div className="mt-3 flex items-center justify-between gap-2 border-t border-current/10 pt-2">
                  <span className="text-xs text-muted-foreground">
                    {result.cached ? '缓存结果' : '本次检测'}
                  </span>
                  <div className="flex gap-1">
                    <Button
                      aria-label={`重测 ${name}`}
                      className="h-8 px-2"
                      disabled={pending}
                      onClick={() => onRetest(result)}
                      title={`重测 ${name}`}
                      type="button"
                      variant="ghost"
                    >
                      <RefreshCw className={`h-3.5 w-3.5 ${pending ? 'animate-spin' : ''}`} />
                    </Button>
                    <Button
                      aria-label={`删除 ${name}`}
                      className="h-8 px-2 text-red-700 hover:text-red-800"
                      disabled={pending}
                      onClick={() => onDelete(result)}
                      title={`删除 ${name}`}
                      type="button"
                      variant="ghost"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
              </article>
            )
          })
        ) : (
          <div className="rounded-md bg-muted px-3 py-8 text-center text-sm text-muted-foreground md:col-span-2 xl:col-span-1 2xl:col-span-2">
            暂无结果
          </div>
        )}
      </div>
    </section>
  )
}

function FailedResults({
  results,
}: {
  results: Array<Extract<DetectionImageResult, { status: 'failed' }>>
}) {
  return (
    <section aria-label="检测异常" className="mt-4 border-t pt-4">
      <div className="flex items-center gap-2 text-red-800">
        <ShieldAlert className="h-4 w-4" />
        <h3 className="font-semibold">异常</h3>
        <span className="font-medium tabular-nums">{results.length}</span>
      </div>
      {results.length ? (
        <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {results.map((result) => (
            <div
              className="rounded-md border border-red-200 bg-red-50 p-2 text-sm"
              key={result.imagePath}
            >
              <img
                alt={fileName(result.imagePath)}
                className="h-28 w-full rounded-sm bg-muted object-cover"
                loading="lazy"
                src={detectionImageSrc({
                  path: result.imagePath,
                  thumbnailUrl: result.thumbnailUrl,
                })}
              />
              <span className="mt-2 block truncate font-medium">{fileName(result.imagePath)}</span>
              <p className="mt-1 line-clamp-2 text-xs text-red-800">{result.error}</p>
            </div>
          ))}
        </div>
      ) : (
        <p className="mt-2 text-sm text-muted-foreground">当前没有检测异常。</p>
      )}
    </section>
  )
}

export function DetectionWorkbench() {
  const [sourcePaths, setSourcePaths] = useState<string[]>([])
  const [inputSources, setInputSources] = useState<DetectionInputSource[]>([])
  const [sourceImages, setSourceImages] = useState<DetectionImageInfo[]>([])
  const [selectedImagePaths, setSelectedImagePaths] = useState<Set<string>>(new Set())
  const [loadingImages, setLoadingImages] = useState(false)
  const [compression, setCompression] = useState(true)
  const [maxSize, setMaxSize] = useState(DEFAULT_MAX_SIZE)
  const [format, setFormat] = useState<'jpg' | 'png'>('jpg')
  const [concurrency, setConcurrency] = useState(DEFAULT_CONCURRENCY)
  const [models, setModels] = useState<string[]>([])
  const [skills, setSkills] = useState<SkillSummary[]>([])
  const [model, setModel] = useState(DEFAULT_MODEL)
  const [skill, setSkill] = useState<Skill | null>(null)
  const [threshold, setThreshold] = useState<DetectionThresholdConfig>(DEFAULT_THRESHOLD)
  const [variables, setVariables] = useState<Record<string, unknown>>({})
  const [skillLoading, setSkillLoading] = useState(true)
  const [savingConfig, setSavingConfig] = useState(false)
  const [progress, setProgress] = useState<DetectionProgress | null>(null)
  const [running, setRunning] = useState(false)
  const [runningTaskId, setRunningTaskId] = useState<string | null>(null)
  const [results, setResults] = useState<DetectionImageResult[]>([])
  const [pendingArtifactId, setPendingArtifactId] = useState<string | null>(null)
  const [promoting, setPromoting] = useState(false)
  const [activeDetectionPreviewIndex, setActiveDetectionPreviewIndex] = useState<number | null>(
    null,
  )
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const runningTaskIdRef = useRef<string | null>(null)
  const retestArtifactIdRef = useRef<string | null>(null)

  useEffect(() => {
    let mounted = true
    async function loadSkill() {
      setSkillLoading(true)
      try {
        const [skillList, modelList, config, sources, generationSettings] = await Promise.all([
          window.api.skill.list({ module: 'detection' }),
          window.api.detection.listModels(),
          window.api.detection.getConfig(),
          window.api.detection.listInputSources().catch(() => null),
          window.api.generationSettings.get().catch(() => null),
        ])
        const summary = selectDefaultSkill(skillList, config)
        if (!summary) {
          throw new Error('没有可用的侵权检测 Skill，请先在设置里同步 Skill')
        }
        const detail = await window.api.skill.get({ id: summary.id, version: summary.version })
        if (!mounted) {
          return
        }
        setModels(modelList)
        setSkills(skillList)
        setModel(config?.model ?? modelList[0] ?? DEFAULT_MODEL)
        setThreshold(config?.threshold ?? DEFAULT_THRESHOLD)
        setInputSources(sources?.sources ?? [])
        setSkill(detail)
        setVariables(
          variablesForSkill(
            detail,
            config?.skillId === detail.id && config.skillVersion === detail.version
              ? config.variables
              : undefined,
          ),
        )
        setConcurrency(
          Math.max(
            1,
            Math.min(
              MAX_CONCURRENCY,
              generationSettings?.config.default_concurrency ?? DEFAULT_CONCURRENCY,
            ),
          ),
        )
        setError(null)
      } catch (nextError) {
        if (!mounted) {
          return
        }
        setSkill(null)
        setError(nextError instanceof Error ? nextError.message : '读取侵权检测 Skill 失败')
      } finally {
        if (mounted) {
          setSkillLoading(false)
        }
      }
    }

    void loadSkill()
    return () => {
      mounted = false
    }
  }, [])

  useEffect(() => {
    const offProgress = window.api.detection.onProgress((nextProgress) => {
      const activeTaskId = runningTaskIdRef.current
      if (activeTaskId && nextProgress.task_id !== activeTaskId) {
        return
      }
      setProgress(nextProgress)
      setRunningTaskId(nextProgress.task_id)
    })
    const offCompleted = window.api.detection.onCompleted((event: DetectionTaskEvent) => {
      const activeTaskId = runningTaskIdRef.current
      const eventTaskId = event.ok ? event.result.taskId : event.taskId
      if (activeTaskId && eventTaskId !== activeTaskId) {
        return
      }

      const retestArtifactId = retestArtifactIdRef.current
      setRunning(false)
      runningTaskIdRef.current = null
      retestArtifactIdRef.current = null
      if (!event.ok) {
        setError(event.error)
        setMessage(null)
        return
      }

      setResults((current) =>
        retestArtifactId
          ? [
              ...current.filter((item) => item.artifactId !== retestArtifactId),
              ...event.result.results,
            ]
          : event.result.results,
      )
      setProgress((current) => ({
        task_id: event.result.taskId,
        processed: event.result.cancelled
          ? (current?.processed ??
            event.result.succeeded + event.result.failed + event.result.skipped)
          : event.result.total,
        total: event.result.total,
        succeeded: event.result.succeeded,
        failed: event.result.failed,
        skipped: event.result.skipped,
        concurrency: current?.concurrency ?? DEFAULT_CONCURRENCY,
        ...(event.result.diagnosticsLogPath
          ? { diagnosticsLogPath: event.result.diagnosticsLogPath }
          : {}),
        ...(event.result.cancelled ? { status: 'cancelled' as const } : {}),
      }))
      setRunningTaskId(event.result.taskId)
      setMessage(
        event.result.cancelled
          ? `已取消：成功 ${event.result.succeeded}，缓存 ${event.result.skipped}，失败 ${event.result.failed}`
          : `检测完成：成功 ${event.result.succeeded}，缓存 ${event.result.skipped}，失败 ${event.result.failed}`,
      )
      setError(null)
    })
    return () => {
      offProgress()
      offCompleted()
    }
  }, [])

  const detectedResults = useMemo(() => results.filter(isDetectedResult), [results])
  const resultsByRisk = useMemo(
    () =>
      Object.fromEntries(
        RISK_LEVELS.map((level) => [
          level,
          detectedResults.filter((result) => result.riskLevel === level),
        ]),
      ) as Record<
        RiskLevel,
        Array<Extract<DetectionImageResult, { status: 'success' | 'skipped' }>>
      >,
    [detectedResults],
  )
  const failedResults = useMemo(() => results.filter(isFailedResult), [results])
  const selectedImages = useMemo(
    () => sourceImages.filter((image) => selectedImagePaths.has(image.path)),
    [selectedImagePaths, sourceImages],
  )
  const passArtifactIds = useMemo(
    () => resultsByRisk.pass.map((result) => result.artifactId),
    [resultsByRisk.pass],
  )
  const previewResults = useMemo(() => detectionPreviewResults(results), [results])
  const previewItems = useMemo(
    () => previewResults.map((result) => detectionPreviewItem(result)),
    [previewResults],
  )

  useEffect(() => {
    setActiveDetectionPreviewIndex((current) =>
      current !== null && current >= previewItems.length ? null : current,
    )
  }, [previewItems.length])

  function openDetectionPreview(result: DetectionPreviewResult) {
    const index = previewResults.findIndex(
      (item) => item.artifactId === result.artifactId && item.imagePath === result.imagePath,
    )
    if (index >= 0) {
      setActiveDetectionPreviewIndex(index)
    }
  }

  async function changeSkill(value: string) {
    const parsed = parseSkillKey(value)
    if (!parsed) {
      return
    }
    const summary = skills.find((item) => item.id === parsed.id && item.version === parsed.version)
    if (!summary) {
      return
    }
    setSkillLoading(true)
    setError(null)
    try {
      const detail = await window.api.skill.get({ id: summary.id, version: summary.version })
      setSkill(detail)
      setVariables(variablesForSkill(detail))
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : '读取侵权检测 Skill 失败')
    } finally {
      setSkillLoading(false)
    }
  }

  async function saveDefaultConfig() {
    if (!skill) {
      setError('请先选择侵权检测 Skill')
      return
    }
    setSavingConfig(true)
    setError(null)
    try {
      await window.api.detection.saveConfig({
        threshold,
        skillId: skill.id,
        skillVersion: skill.version,
        model,
        variables,
      })
      setMessage('检测默认配置已保存')
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : '保存侵权检测配置失败')
    } finally {
      setSavingConfig(false)
    }
  }

  async function retestResult(result: DetectionPreviewResult) {
    retestArtifactIdRef.current = result.artifactId
    setPendingArtifactId(result.artifactId)
    setError(null)
    setMessage(null)
    try {
      const taskId = await window.api.detection.retest({ artifact_ids: [result.artifactId] })
      runningTaskIdRef.current = taskId
      setRunningTaskId(taskId)
      setRunning(true)
      setProgress({
        task_id: taskId,
        processed: 0,
        total: 1,
        succeeded: 0,
        failed: 0,
        skipped: 0,
        concurrency,
      })
      setMessage(`已开始重测 ${fileName(result.imagePath)}`)
    } catch (nextError) {
      retestArtifactIdRef.current = null
      setError(nextError instanceof Error ? nextError.message : '启动重测失败')
    } finally {
      setPendingArtifactId(null)
    }
  }

  async function deleteResult(result: DetectionPreviewResult) {
    setPendingArtifactId(result.artifactId)
    setError(null)
    try {
      const deleted = await window.api.detection.deleteResult({ artifact_id: result.artifactId })
      if (deleted > 0) {
        setResults((current) => current.filter((item) => item.artifactId !== result.artifactId))
        setMessage(`已删除 ${fileName(result.imagePath)}`)
      } else {
        setError('未找到可删除的检测结果')
      }
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : '删除检测结果失败')
    } finally {
      setPendingArtifactId(null)
    }
  }

  async function promotePassResults() {
    if (!passArtifactIds.length) {
      setError('没有可加入套版候选清单的无风险图片')
      return
    }
    setPromoting(true)
    setError(null)
    try {
      const promoted = await window.api.detection.promoteToMatting({
        artifact_ids: passArtifactIds,
        mode: 'copy',
      })
      setMessage(`已加入 ${promoted} 张无风险图片到套版候选清单`)
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : '加入套版候选清单失败')
    } finally {
      setPromoting(false)
    }
  }

  async function scanSourcePaths(paths: string[]) {
    if (!paths.length) {
      setError('请先选择输入文件夹或拖入图片')
      return
    }
    setSourcePaths(paths)
    setSourceImages([])
    setSelectedImagePaths(new Set())
    setResults([])
    setProgress(null)
    retestArtifactIdRef.current = null
    setMessage(null)
    setLoadingImages(true)
    setError(null)
    try {
      const images = await window.api.detection.scanPaths({ paths })
      setSourceImages(images)
      setSelectedImagePaths(new Set(images.map((image) => image.path)))
      setMessage(`已检索 ${images.length} 张图片`)
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : '检索图片失败')
    } finally {
      setLoadingImages(false)
    }
  }

  async function chooseSourceFolder() {
    setError(null)
    const result = await window.api.detection.chooseInputFolder()
    if (!result.ok) {
      if (result.error.code !== 'CANCELLED') {
        setError(result.error.message)
      }
      return
    }
    setSourcePaths([result.data.path])
    setSourceImages([])
    setSelectedImagePaths(new Set())
    setResults([])
    setProgress(null)
    retestArtifactIdRef.current = null
    setMessage(null)
  }

  async function scanSelectedSources() {
    if (!sourcePaths.length) {
      setError('请先选择输入文件夹或拖入图片')
      return
    }
    await scanSourcePaths(sourcePaths)
  }

  async function handleDroppedPaths(paths: string[]) {
    await scanSourcePaths(paths)
  }

  async function useInputSource(source: DetectionInputSource) {
    await scanSourcePaths([source.folder])
  }

  function toggleImageSelection(path: string) {
    setSelectedImagePaths((current) => {
      const next = new Set(current)
      if (next.has(path)) {
        next.delete(path)
      } else {
        next.add(path)
      }
      return next
    })
  }

  function selectAllImages() {
    setSelectedImagePaths(new Set(sourceImages.map((image) => image.path)))
  }

  function clearImageSelection() {
    setSelectedImagePaths(new Set())
  }

  async function startDetection() {
    if (!sourceImages.length) {
      setError('请先检索图片')
      return
    }
    if (!selectedImages.length) {
      setError('请至少勾选 1 张图片')
      return
    }
    if (!skill) {
      setError('没有可用的侵权检测 Skill，请先在设置里同步 Skill')
      return
    }

    setRunning(true)
    setError(null)
    setMessage(null)
    setResults([])
    setProgress(null)
    retestArtifactIdRef.current = null
    try {
      const taskId = await window.api.detection.run({
        imagePaths: selectedImages.map((image) => image.path),
        skillId: skill.id,
        skillVersion: skill.version,
        model: model || DEFAULT_MODEL,
        variables,
        threshold,
        preprocess: {
          compress: compression,
          maxSize,
          format,
        },
        concurrency,
        maxRetries: DEFAULT_MAX_RETRIES,
      })
      runningTaskIdRef.current = taskId
      setRunningTaskId(taskId)
      setProgress({
        task_id: taskId,
        processed: 0,
        total: selectedImages.length,
        succeeded: 0,
        failed: 0,
        skipped: 0,
        concurrency,
      })
    } catch (nextError) {
      runningTaskIdRef.current = null
      setRunning(false)
      setError(nextError instanceof Error ? nextError.message : '启动侵权检测失败')
    }
  }

  async function cancelDetection() {
    const taskId = runningTaskIdRef.current ?? runningTaskId
    if (!taskId) {
      setError('没有正在运行的检测任务')
      return
    }
    const response = await window.api.detection.cancel({ task_id: taskId })
    if (!response.ok) {
      setError('当前检测任务已结束，无法取消')
      return
    }
    setError(null)
  }

  return (
    <section aria-label="侵权检测生产工作区" className="min-w-0 space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold text-balance">侵权检测</h1>
          <p className="text-sm text-muted-foreground text-pretty">
            选择印花、确认检测规则，再按无风险、疑似和高风险检查结果。
          </p>
          <p className="text-sm text-muted-foreground text-pretty">
            当前任务 {runningTaskId ?? '未开始'}
          </p>
        </div>
        <div className="flex items-center gap-2 rounded-md border bg-background px-3 py-2 text-sm shadow-sm">
          <CheckCircle2 className="h-4 w-4 text-emerald-700" />
          <span className="font-medium tabular-nums">{detectedResults.length}</span>
          <span className="text-muted-foreground">已分类</span>
        </div>
      </div>

      {error ? (
        <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
          {error}
        </div>
      ) : null}
      {message ? (
        <div className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
          {message}
        </div>
      ) : null}

      <div className="grid min-w-0 gap-5 min-[1400px]:grid-cols-[minmax(0,1fr)_340px]">
        <section aria-label="检测输入与规则" className="min-w-0 space-y-5">
          <ImageFolderPanel
            sourceLabel={
              sourcePaths.length === 1
                ? (sourcePaths[0] ?? '')
                : sourcePaths.length > 1
                  ? `已选择 ${sourcePaths.length} 个路径`
                  : ''
            }
            inputSources={inputSources}
            images={sourceImages}
            selectedPaths={selectedImagePaths}
            selectedCount={selectedImages.length}
            loading={loadingImages}
            onChoose={() => void chooseSourceFolder()}
            onScan={() => void scanSelectedSources()}
            onUseSource={(source) => useInputSource(source)}
            onDropPaths={(paths) => handleDroppedPaths(paths)}
            onToggleImage={toggleImageSelection}
            onSelectAll={selectAllImages}
            onClearSelection={clearImageSelection}
          />
          <DetectionRulesPanel
            compression={compression}
            concurrency={concurrency}
            format={format}
            maxSize={maxSize}
            model={model}
            models={models}
            running={running}
            saving={savingConfig}
            skill={skill}
            skills={skills}
            threshold={threshold}
            variables={variables}
            onCompressionChange={setCompression}
            onConcurrencyChange={setConcurrency}
            onFormatChange={setFormat}
            onMaxSizeChange={setMaxSize}
            onModelChange={setModel}
            onSave={() => void saveDefaultConfig()}
            onSkillChange={(value) => void changeSkill(value)}
            onThresholdChange={setThreshold}
            onVariableChange={(key, value) =>
              setVariables((current) => ({ ...current, [key]: value }))
            }
          />
        </section>

        <RunPanel
          concurrency={concurrency}
          imageCount={selectedImages.length}
          model={model}
          progress={progress}
          running={running}
          skillLabel={skill ? `${skill.id} / ${skill.version}` : ''}
          skillLoading={skillLoading}
          skillReady={Boolean(skill)}
          onCancel={() => void cancelDetection()}
          onRun={() => void startDetection()}
        />
      </div>

      <section
        aria-label="检测结果"
        className="min-w-0 rounded-md border bg-background p-4 shadow-sm"
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-balance">检测结果</h2>
            <p className="mt-1 text-sm text-muted-foreground text-pretty">
              无风险 {resultsByRisk.pass.length}，疑似 {resultsByRisk.review.length}，高风险{' '}
              {resultsByRisk.block.length}
            </p>
            {progress?.diagnosticsLogPath ? (
              <p className="mt-2 break-all font-mono text-xs text-muted-foreground">
                诊断日志：{progress.diagnosticsLogPath}
              </p>
            ) : null}
          </div>
          <Button
            disabled={!passArtifactIds.length || promoting}
            onClick={() => void promotePassResults()}
            type="button"
            variant="secondary"
          >
            {promoting ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <ClipboardCheck className="mr-2 h-4 w-4" />
            )}
            加入套版候选清单
          </Button>
        </div>
        <div className="mt-4 grid gap-4 min-[1400px]:grid-cols-3">
          {RISK_LEVELS.map((level) => (
            <RiskResults
              key={level}
              level={level}
              pendingArtifactId={pendingArtifactId}
              results={resultsByRisk[level]}
              onDelete={(result) => void deleteResult(result)}
              onOpenPreview={openDetectionPreview}
              onRetest={(result) => void retestResult(result)}
            />
          ))}
        </div>
        <FailedResults results={failedResults} />
      </section>

      <ImageLightbox
        activeIndex={activeDetectionPreviewIndex}
        items={previewItems}
        title="侵权检测预览"
        onActiveIndexChange={setActiveDetectionPreviewIndex}
      />
    </section>
  )
}
