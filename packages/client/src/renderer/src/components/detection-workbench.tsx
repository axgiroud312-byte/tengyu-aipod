import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { type RiskLevel, estimateDetectionCost } from '@tengyu-aipod/shared'
import {
  AlertTriangle,
  Copy,
  Download,
  FolderOpen,
  Loader2,
  MoveRight,
  RefreshCw,
  Trash2,
  Upload,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { DetectionConfig } from '../../../main/lib/detection-config'
import type {
  DetectionImageInfo,
  DetectionImageResult,
  DetectionInputSources,
  DetectionProgress,
  DetectionTaskEvent,
} from '../../../main/lib/detection-service'
import { DetectionSettingsPanel } from './detection-settings-panel'

type FlattenedImage = DetectionImageInfo & {
  folder: string
  sourceLabel: string
  sourceKey: string
  external: boolean
}

type ResultFilter = 'all' | RiskLevel | 'failed'

const DEFAULT_MAX_SIZE = 1024

function fileUrl(path: string) {
  return encodeURI(`file://${path.startsWith('/') ? '' : '/'}${path.replace(/\\/g, '/')}`)
}

function isImagePath(path: string) {
  return /\.(?:jpe?g|png|webp)$/i.test(path)
}

function formatBytes(bytes: number) {
  if (!Number.isFinite(bytes)) {
    return '-'
  }
  if (bytes < 1024) {
    return `${bytes} B`
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`
  }
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

function riskTone(riskLevel: RiskLevel | 'failed') {
  switch (riskLevel) {
    case 'pass':
      return 'border-emerald-200 bg-emerald-50 text-emerald-800'
    case 'review':
      return 'border-amber-200 bg-amber-50 text-amber-900'
    case 'block':
      return 'border-red-200 bg-red-50 text-red-800'
    default:
      return 'border-border bg-muted text-muted-foreground'
  }
}

function riskLabel(riskLevel: RiskLevel | 'failed') {
  switch (riskLevel) {
    case 'pass':
      return '通过'
    case 'review':
      return '复核'
    case 'block':
      return '拦截'
    default:
      return '失败'
  }
}

const resultFilterLabels: Record<ResultFilter, string> = {
  all: '全部',
  pass: '通过',
  review: '复核',
  block: '拦截',
  failed: '失败',
}

function resultLevel(result: DetectionImageResult): RiskLevel | 'failed' {
  return result.status === 'failed' ? 'failed' : result.riskLevel
}

function resultScore(result: DetectionImageResult) {
  return result.status === 'failed' ? '-' : String(result.riskScore)
}

function resultReason(result: DetectionImageResult) {
  return result.status === 'failed' ? result.error : result.reason || '-'
}

function progressPercent(progress: DetectionProgress | null) {
  if (!progress?.total) {
    return 0
  }
  return Math.round((progress.processed / progress.total) * 100)
}

function csvEscape(value: string) {
  return `"${value.replaceAll('"', '""')}"`
}

function toCsv(rows: DetectionImageResult[]) {
  const header = [
    'status',
    'artifact_id',
    'print_id',
    'risk_score',
    'risk_level',
    'reason',
    'image_path',
    'output_path',
    'error',
  ]
  const lines = [header.join(',')]
  for (const row of rows) {
    lines.push(
      [
        csvEscape(row.status),
        csvEscape(row.artifactId ?? ''),
        csvEscape(row.printId ?? ''),
        csvEscape('riskScore' in row ? String(row.riskScore) : ''),
        csvEscape('riskLevel' in row ? row.riskLevel : ''),
        csvEscape('reason' in row ? row.reason : ''),
        csvEscape(row.imagePath),
        csvEscape('outputPath' in row ? row.outputPath : ''),
        csvEscape('error' in row ? row.error : ''),
      ].join(','),
    )
  }
  return lines.join('\n')
}

function flattenImages(
  sources: DetectionInputSources | null,
  imageMap: Record<string, DetectionImageInfo[]>,
) {
  const items: FlattenedImage[] = []
  if (sources) {
    for (const source of sources.sources) {
      for (const image of imageMap[source.folder] ?? []) {
        items.push({
          ...image,
          folder: source.folder,
          sourceLabel: source.label,
          sourceKey: source.key,
          external: false,
        })
      }
    }
  }
  return items
}

function RiskBadge({ level }: { level: RiskLevel | 'failed' }) {
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs ${riskTone(level)}`}
    >
      {riskLabel(level)}
    </span>
  )
}

function ThumbnailGrid({
  items,
  selectedPaths,
  onToggle,
}: {
  items: FlattenedImage[]
  selectedPaths: Set<string>
  onToggle: (image: FlattenedImage) => void
}) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const [scrollTop, setScrollTop] = useState(0)
  const [viewportHeight, setViewportHeight] = useState(520)
  const columns = 4
  const rowHeight = 152
  const rows = Math.max(1, Math.ceil(items.length / columns))

  useEffect(() => {
    const element = containerRef.current
    if (!element) {
      return
    }
    const resize = () => setViewportHeight(element.clientHeight)
    resize()
    const observer = new ResizeObserver(resize)
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  const startRow = Math.max(0, Math.floor(scrollTop / rowHeight) - 2)
  const endRow = Math.min(rows, Math.ceil((scrollTop + viewportHeight) / rowHeight) + 2)
  const visibleItems: Array<{ row: number; image: FlattenedImage; index: number }> = []
  for (let row = startRow; row < endRow; row += 1) {
    for (let col = 0; col < columns; col += 1) {
      const index = row * columns + col
      const image = items[index]
      if (!image) {
        continue
      }
      visibleItems.push({ row, image, index })
    }
  }

  return (
    <div
      ref={containerRef}
      className="relative h-[420px] overflow-auto rounded-md border bg-background"
      onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
    >
      <div className="relative" style={{ height: `${rows * rowHeight}px` }}>
        {visibleItems.map(({ row, image, index }) => {
          const selected = selectedPaths.has(image.path)
          const col = index % columns
          return (
            <button
              key={image.path}
              className={`absolute flex h-[140px] flex-col gap-2 rounded-md border p-2 text-left text-xs transition ${
                selected
                  ? 'border-primary bg-primary/5'
                  : 'border-border bg-background hover:bg-muted/40'
              }`}
              onClick={() => onToggle(image)}
              style={{
                top: `${row * rowHeight + 8}px`,
                left: `calc(${(col * 100) / columns}% + 8px)`,
                width: `calc(${100 / columns}% - 12px)`,
              }}
              type="button"
            >
              <div className="relative h-20 overflow-hidden rounded-sm bg-muted">
                <img
                  alt={image.name}
                  className="h-full w-full object-cover"
                  src={image.thumbnailUrl || fileUrl(image.path)}
                />
                <span className="absolute left-1 top-1 rounded-full bg-background/90 px-1.5 py-0.5 text-[10px] font-medium">
                  {selected ? '已选' : '未选'}
                </span>
              </div>
              <div className="min-w-0">
                <p className="truncate font-medium">{image.name}</p>
                <p className="truncate text-muted-foreground">{image.sourceLabel}</p>
              </div>
            </button>
          )
        })}
      </div>
    </div>
  )
}

export function DetectionWorkbench() {
  const [config, setConfig] = useState<DetectionConfig | null>(null)
  const [sources, setSources] = useState<DetectionInputSources | null>(null)
  const [sourceImages, setSourceImages] = useState<Record<string, DetectionImageInfo[]>>({})
  const [selectedFolders, setSelectedFolders] = useState<string[]>([])
  const [manualOverrides, setManualOverrides] = useState<Record<string, boolean>>({})
  const [externalImages, setExternalImages] = useState<DetectionImageInfo[]>([])
  const [compression, setCompression] = useState(true)
  const [maxSize, setMaxSize] = useState(String(DEFAULT_MAX_SIZE))
  const [format, setFormat] = useState<'jpg' | 'png'>('jpg')
  const [concurrency, setConcurrency] = useState('3')
  const [progress, setProgress] = useState<DetectionProgress | null>(null)
  const [runningTaskId, setRunningTaskId] = useState<string | null>(null)
  const [results, setResults] = useState<DetectionImageResult[]>([])
  const [resultFilter, setResultFilter] = useState<ResultFilter>('all')
  const [activeResult, setActiveResult] = useState<DetectionImageResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [dragActive, setDragActive] = useState(false)
  const [balance, setBalance] = useState('')
  const [isPromoteDialogOpen, setIsPromoteDialogOpen] = useState(false)
  const [promoteMode, setPromoteMode] = useState<'copy' | 'move'>('copy')
  const [isPromoting, setIsPromoting] = useState(false)

  useEffect(() => {
    let mounted = true
    async function load() {
      try {
        const inputSources = await window.api.detection.listInputSources()
        if (!mounted) {
          return
        }
        setSources(inputSources)
        const scanned = await Promise.all(
          inputSources.sources.map(async (source) => [
            source.folder,
            await window.api.detection.scanFolder({ folder: source.folder }),
          ]),
        )
        if (!mounted) {
          return
        }
        setSourceImages(Object.fromEntries(scanned) as Record<string, DetectionImageInfo[]>)
      } catch (loadError) {
        if (!mounted) {
          return
        }
        setError(loadError instanceof Error ? loadError.message : '加载检测输入失败')
      }
    }
    void load()
    return () => {
      mounted = false
    }
  }, [])

  useEffect(() => {
    const offProgress = window.api.detection.onProgress((nextProgress) => {
      setProgress(nextProgress)
      setRunningTaskId(nextProgress.task_id)
    })
    const offCompleted = window.api.detection.onCompleted((event: DetectionTaskEvent) => {
      if (event.ok) {
        setResults(event.result.results)
        setProgress({
          task_id: event.result.taskId,
          processed: event.result.total,
          total: event.result.total,
          succeeded: event.result.succeeded,
          failed: event.result.failed,
          skipped: event.result.skipped,
          concurrency: Number(concurrency) || 3,
        })
        setRunningTaskId(event.result.taskId)
        setMessage(
          `检测完成：成功 ${event.result.succeeded}，失败 ${event.result.failed}，跳过 ${event.result.skipped}`,
        )
        setError(null)
        return
      }
      setError(event.error)
      setMessage(null)
    })
    return () => {
      offProgress()
      offCompleted()
    }
  }, [concurrency])

  const allImages = useMemo(
    () => [
      ...flattenImages(sources, sourceImages),
      ...externalImages.map((image) => ({
        ...image,
        folder: 'external',
        sourceLabel: '外部拖入',
        sourceKey: 'external',
        external: true,
      })),
    ],
    [externalImages, sourceImages, sources],
  )

  const selectedFolderSet = useMemo(() => new Set(selectedFolders), [selectedFolders])
  const selectedPaths = useMemo(() => {
    const next = new Set<string>()
    for (const image of allImages) {
      const manual = manualOverrides[image.path]
      const folderSelected = image.external ? false : selectedFolderSet.has(image.folder)
      if (manual === true || (manual === undefined && folderSelected)) {
        next.add(image.path)
      }
    }
    return next
  }, [allImages, manualOverrides, selectedFolderSet])

  const selectedImages = useMemo(
    () => allImages.filter((image) => selectedPaths.has(image.path)),
    [allImages, selectedPaths],
  )

  const resultsSorted = useMemo(() => {
    return [...results].sort((left, right) => {
      const leftScore = left.status === 'failed' ? -1 : left.riskScore
      const rightScore = right.status === 'failed' ? -1 : right.riskScore
      return rightScore - leftScore
    })
  }, [results])

  const stats = useMemo(() => {
    const next = { pass: 0, review: 0, block: 0, failed: 0 }
    for (const result of results) {
      if (result.status === 'failed') {
        next.failed += 1
        continue
      }
      next[result.riskLevel] += 1
    }
    return next
  }, [results])
  const filteredResults = useMemo(() => {
    if (resultFilter === 'all') {
      return resultsSorted
    }
    return resultsSorted.filter((result) => resultLevel(result) === resultFilter)
  }, [resultFilter, resultsSorted])
  const passPromotionIds = useMemo(
    () =>
      resultsSorted.reduce<string[]>((acc, result) => {
        if (result.status === 'failed' || result.riskLevel !== 'pass' || !result.artifactId) {
          return acc
        }
        acc.push(result.artifactId)
        return acc
      }, []),
    [resultsSorted],
  )

  const isRunning = Boolean(progress && progress.processed < progress.total)
  const canRun = Boolean(config?.skillId) && selectedImages.length > 0 && !isRunning
  const selectedCount = selectedImages.length
  const progressPercentValue = progressPercent(progress)
  const estimatedCost = useMemo(
    () => estimateDetectionCost(selectedCount, config?.model ?? 'qwen3.6-flash', compression),
    [compression, config?.model, selectedCount],
  )
  const balanceValue = balance.trim() ? Number(balance) : null
  const hasBalance = balanceValue !== null && Number.isFinite(balanceValue)
  const balanceLow =
    hasBalance && balanceValue !== null ? balanceValue < estimatedCost.yuan * 1.5 : false

  const toggleFolder = useCallback((folder: string) => {
    setSelectedFolders((current) =>
      current.includes(folder) ? current.filter((item) => item !== folder) : [...current, folder],
    )
  }, [])

  const toggleImage = useCallback(
    (image: FlattenedImage) => {
      setManualOverrides((current) => {
        const nextValue = !(
          current[image.path] ?? (image.external ? false : selectedFolderSet.has(image.folder))
        )
        return { ...current, [image.path]: nextValue }
      })
    },
    [selectedFolderSet],
  )

  const addExternalFiles = useCallback((files: FileList | File[]) => {
    const additions: DetectionImageInfo[] = []
    for (const file of Array.from(files)) {
      const path = (file as File & { path?: string }).path
      if (!path || !isImagePath(path)) {
        continue
      }
      const id = path
      additions.push({
        id,
        path,
        name: file.name,
        sizeBytes: file.size,
        modifiedAt: file.lastModified,
        thumbnailUrl: fileUrl(path),
      })
    }
    if (!additions.length) {
      return
    }
    setExternalImages((current) => {
      const existing = new Set(current.map((item) => item.path))
      return [...current, ...additions.filter((item) => !existing.has(item.path))]
    })
    setManualOverrides((current) => {
      const next = { ...current }
      for (const addition of additions) {
        next[addition.path] = true
      }
      return next
    })
    setDragActive(false)
  }, [])

  async function runDetection() {
    if (!config?.skillId) {
      setError('请先保存检测配置')
      return
    }
    if (!selectedImages.length) {
      setError('请先选择待检测图片')
      return
    }
    const nextConcurrency = Math.max(1, Math.min(8, Number(concurrency) || 3))
    setError(null)
    setMessage(null)
    setResults([])
    const nextTaskId = await window.api.detection.run({
      imagePaths: selectedImages.map((image) => image.path),
      skillId: config.skillId,
      skillVersion: config.skillVersion,
      model: config.model,
      variables: config.variables,
      threshold: config.threshold,
      preprocess: {
        compress: compression,
        maxSize: Math.max(256, Number(maxSize) || DEFAULT_MAX_SIZE),
        format,
      },
      concurrency: nextConcurrency,
    })
    setRunningTaskId(nextTaskId)
    setProgress({
      task_id: nextTaskId,
      processed: 0,
      total: selectedImages.length,
      succeeded: 0,
      failed: 0,
      skipped: 0,
      concurrency: nextConcurrency,
    })
  }

  async function exportCsv() {
    if (!resultsSorted.length) {
      setError('没有可导出的检测结果')
      return
    }
    const blob = new Blob([toCsv(resultsSorted)], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `detection-results-${runningTaskId ?? 'latest'}.csv`
    link.click()
    URL.revokeObjectURL(url)
  }

  function openPromoteDialog() {
    if (!passPromotionIds.length) {
      setError('没有可加入待套版的通过图')
      return
    }
    setPromoteMode('copy')
    setIsPromoteDialogOpen(true)
  }

  async function promotePassImages() {
    if (!passPromotionIds.length) {
      setError('没有可加入待套版的通过图')
      setIsPromoteDialogOpen(false)
      return
    }
    setIsPromoting(true)
    setError(null)
    setMessage(null)
    try {
      const count = await window.api.detection.promoteToMatting({
        artifact_ids: passPromotionIds,
        mode: promoteMode,
      })
      setMessage(
        promoteMode === 'move'
          ? `已移动 ${count} 张通过图到待套版`
          : `已复制 ${count} 张通过图到待套版`,
      )
      setIsPromoteDialogOpen(false)
    } catch (promoteError) {
      setError(promoteError instanceof Error ? promoteError.message : '加入待套版失败')
    } finally {
      setIsPromoting(false)
    }
  }

  async function retestRow(result: DetectionImageResult) {
    if (!result.artifactId) {
      setError('这张图没有可重测记录')
      return
    }
    setError(null)
    setMessage(null)
    const nextTaskId = await window.api.detection.retest({ artifact_ids: [result.artifactId] })
    setRunningTaskId(nextTaskId)
    setProgress({
      task_id: nextTaskId,
      processed: 0,
      total: 1,
      succeeded: 0,
      failed: 0,
      skipped: 0,
      concurrency: Number(concurrency) || 3,
    })
  }

  async function deleteRow(result: DetectionImageResult) {
    if (!result.artifactId) {
      return
    }
    await window.api.detection.deleteResult({ artifact_id: result.artifactId })
    setResults((current) => current.filter((item) => item.artifactId !== result.artifactId))
  }

  async function moveRow(result: DetectionImageResult) {
    if (!result.artifactId) {
      return
    }
    const count = await window.api.detection.promoteToMatting({
      artifact_ids: [result.artifactId],
      mode: 'move',
    })
    setMessage(`已移动 ${count} 张到待套版`)
  }

  function clearSelection() {
    setSelectedFolders([])
    setManualOverrides({})
    setExternalImages([])
    setResults([])
    setError(null)
    setMessage(null)
  }

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-6">
        <div className="space-y-1">
          <p className="text-sm font-medium text-primary">侵权检测</p>
          <h1 className="text-2xl font-semibold text-balance">选择印花，判断风险，流转到待套版</h1>
          <p className="text-sm text-muted-foreground">
            检测输入来自 02-生图，也支持外部图片拖入。
          </p>
        </div>
        <div className="grid grid-cols-3 overflow-hidden rounded-md border bg-card text-sm shadow-sm">
          <div className="border-r px-4 py-3">
            <div className="text-xs text-muted-foreground">已选</div>
            <div className="mt-1 font-mono text-lg font-semibold tabular-nums">{selectedCount}</div>
          </div>
          <div className="border-r px-4 py-3">
            <div className="text-xs text-muted-foreground">通过</div>
            <div className="mt-1 font-mono text-lg font-semibold text-emerald-700 tabular-nums">
              {stats.pass}
            </div>
          </div>
          <div className="px-4 py-3">
            <div className="text-xs text-muted-foreground">风险</div>
            <div className="mt-1 font-mono text-lg font-semibold text-red-700 tabular-nums">
              {stats.review + stats.block}
            </div>
          </div>
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

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
        <div className="space-y-6">
          <div className="rounded-md border bg-background p-5 shadow-sm">
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="text-sm font-medium text-muted-foreground">输入选择</p>
                <h2 className="mt-1 text-lg font-semibold">02-生图 / 03-提取 / 04-抠图</h2>
              </div>
              <div className="text-sm text-muted-foreground">拖入外部图片也可以</div>
            </div>

            <div
              className={`mt-4 rounded-md border-2 border-dashed p-4 transition ${
                dragActive ? 'border-primary bg-primary/5' : 'border-border'
              }`}
              onDragOver={(event) => {
                event.preventDefault()
                setDragActive(true)
              }}
              onDragLeave={() => setDragActive(false)}
              onDrop={(event) => {
                event.preventDefault()
                addExternalFiles(event.dataTransfer.files)
              }}
            >
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Upload className="h-4 w-4" />
                把外部图片拖到这里，或在下方缩略图里手动勾选
              </div>
            </div>

            <div className="mt-4 grid gap-3 md:grid-cols-2">
              {sources?.sources.map((source) => (
                <label
                  className={`flex items-center justify-between rounded-md border px-3 py-2 text-sm ${
                    selectedFolderSet.has(source.folder)
                      ? 'border-primary bg-primary/5'
                      : 'bg-background'
                  }`}
                  key={source.folder}
                >
                  <span className="min-w-0">
                    <span className="block font-medium">{source.label}</span>
                    <span className="block text-xs text-muted-foreground">{source.folder}</span>
                  </span>
                  <span className="flex items-center gap-3">
                    <span className="text-xs text-muted-foreground">{source.count}</span>
                    <input
                      checked={selectedFolderSet.has(source.folder)}
                      onChange={() => toggleFolder(source.folder)}
                      type="checkbox"
                    />
                  </span>
                </label>
              ))}
            </div>
          </div>

          <div className="rounded-md border bg-background p-5 shadow-sm">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-sm font-medium text-muted-foreground">检测设置</p>
                <h2 className="mt-1 text-lg font-semibold">模型 / 模板 / 阈值 / 关注重点</h2>
              </div>
              <div className="text-right text-xs text-muted-foreground">
                <div>预估费用</div>
                <div className="mt-1 font-mono text-foreground">按已选 {selectedCount} 张图</div>
              </div>
            </div>

            <div className="mt-4">
              <DetectionSettingsPanel
                onCompressionChange={setCompression}
                onConfigChange={setConfig}
                previewImageCount={selectedCount}
              />
            </div>

            <div className="mt-5 grid gap-4 md:grid-cols-2">
              <label className="block space-y-2 text-sm font-medium">
                <span>并发</span>
                <input
                  className="h-10 w-full rounded-md border px-3 text-sm tabular-nums outline-none focus-visible:ring-2 focus-visible:ring-primary"
                  max={8}
                  min={1}
                  onChange={(event) => setConcurrency(event.target.value)}
                  type="number"
                  value={concurrency}
                />
              </label>
              <label className="block space-y-2 text-sm font-medium">
                <span>最大边长</span>
                <input
                  className="h-10 w-full rounded-md border px-3 text-sm tabular-nums outline-none focus-visible:ring-2 focus-visible:ring-primary"
                  min={256}
                  onChange={(event) => setMaxSize(event.target.value)}
                  type="number"
                  value={maxSize}
                />
              </label>
              <label className="block space-y-2 text-sm font-medium">
                <span>格式</span>
                <select
                  className="h-10 w-full rounded-md border bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-primary"
                  onChange={(event) => setFormat(event.target.value === 'png' ? 'png' : 'jpg')}
                  value={format}
                >
                  <option value="jpg">JPG</option>
                  <option value="png">PNG</option>
                </select>
              </label>
              <label className="inline-flex items-center gap-2 self-end text-sm font-medium">
                <input
                  checked={compression}
                  onChange={(event) => setCompression(event.target.checked)}
                  type="checkbox"
                />
                压缩图片
              </label>
            </div>

            <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t pt-5">
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <FolderOpen className="h-4 w-4" />
                主操作在右侧执行栏，最小窗口下不用滚动也能开始检测。
              </div>
              <Button
                disabled={!selectedCount}
                onClick={clearSelection}
                type="button"
                variant="secondary"
              >
                清空选择
              </Button>
            </div>
          </div>

          <div className="rounded-md border bg-background p-5 shadow-sm">
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="text-sm font-medium text-muted-foreground">结果列表</p>
                <h2 className="mt-1 text-lg font-semibold">按风险值降序</h2>
              </div>
              <div className="flex gap-2">
                <Button
                  disabled={!passPromotionIds.length}
                  onClick={openPromoteDialog}
                  type="button"
                  variant="secondary"
                >
                  <Copy className="mr-2 h-4 w-4" />
                  一键加入待套版
                </Button>
                <Button
                  disabled={!resultsSorted.length}
                  onClick={() => void exportCsv()}
                  type="button"
                  variant="secondary"
                >
                  <Download className="mr-2 h-4 w-4" />
                  导出表格
                </Button>
              </div>
            </div>

            <div className="mt-4 grid gap-3 md:grid-cols-4">
              <div className="rounded-md bg-muted p-3">
                <div className="text-muted-foreground">通过</div>
                <div className="mt-1 font-semibold text-emerald-700">{stats.pass}</div>
              </div>
              <div className="rounded-md bg-muted p-3">
                <div className="text-muted-foreground">复核</div>
                <div className="mt-1 font-semibold text-amber-700">{stats.review}</div>
              </div>
              <div className="rounded-md bg-muted p-3">
                <div className="text-muted-foreground">拦截</div>
                <div className="mt-1 font-semibold text-red-700">{stats.block}</div>
              </div>
              <div className="rounded-md bg-muted p-3">
                <div className="text-muted-foreground">失败</div>
                <div className="mt-1 font-semibold">{stats.failed}</div>
              </div>
            </div>

            <Tabs
              className="mt-5"
              onValueChange={(value) => setResultFilter(value as ResultFilter)}
              value={resultFilter}
            >
              <TabsList className="grid h-auto w-full grid-cols-5 p-1">
                {(['all', 'pass', 'review', 'block', 'failed'] as ResultFilter[]).map((filter) => (
                  <TabsTrigger className="h-9" key={filter} value={filter}>
                    {resultFilterLabels[filter]}
                  </TabsTrigger>
                ))}
              </TabsList>
            </Tabs>

            <div className="mt-5 grid max-h-[560px] gap-4 overflow-auto pr-1 sm:grid-cols-2 2xl:grid-cols-3">
              {filteredResults.length ? (
                filteredResults.map((result) => {
                  const level = resultLevel(result)
                  return (
                    <div
                      className="rounded-md border bg-muted/20 p-3 text-sm transition hover:border-primary/50"
                      key={`${result.artifactId ?? result.imagePath}-${result.status}`}
                    >
                      <button
                        className="block w-full overflow-hidden rounded-md border bg-muted text-left"
                        onClick={() => setActiveResult(result)}
                        type="button"
                      >
                        <img
                          alt={result.imagePath}
                          className="h-36 w-full object-cover"
                          src={result.thumbnailUrl || fileUrl(result.imagePath)}
                        />
                      </button>
                      <div className="mt-3 flex items-center justify-between gap-3">
                        <RiskBadge level={level} />
                        <span className="font-mono text-lg font-semibold tabular-nums">
                          {resultScore(result)}
                        </span>
                      </div>
                      <p className="mt-2 line-clamp-2 min-h-10 text-muted-foreground">
                        {resultReason(result)}
                      </p>
                      <p className="mt-2 truncate text-xs text-muted-foreground">
                        {result.imagePath}
                      </p>
                      <div className="mt-3 flex flex-wrap gap-2">
                        <Button
                          className="h-8 px-2"
                          disabled={!result.artifactId}
                          onClick={() => void moveRow(result)}
                          type="button"
                          variant="secondary"
                        >
                          <MoveRight className="mr-1 h-3.5 w-3.5" />
                          移动
                        </Button>
                        <Button
                          className="h-8 px-2"
                          disabled={!result.artifactId}
                          onClick={() => void retestRow(result)}
                          type="button"
                          variant="secondary"
                        >
                          <RefreshCw className="mr-1 h-3.5 w-3.5" />
                          重测
                        </Button>
                        <Button
                          className="h-8 px-2"
                          disabled={!result.artifactId}
                          onClick={() => void deleteRow(result)}
                          type="button"
                          variant="secondary"
                        >
                          <Trash2 className="mr-1 h-3.5 w-3.5" />
                          删除
                        </Button>
                      </div>
                    </div>
                  )
                })
              ) : (
                <div className="rounded-md bg-muted px-3 py-10 text-center text-sm text-muted-foreground sm:col-span-2 2xl:col-span-3">
                  暂无检测结果
                </div>
              )}
            </div>
          </div>
        </div>

        <aside className="space-y-5 xl:sticky xl:top-6 xl:self-start">
          <div className="rounded-md border bg-background p-5 shadow-sm">
            <p className="text-sm font-medium text-muted-foreground">预估与执行</p>
            <h2 className="mt-1 text-lg font-semibold">开始检测</h2>
            <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
              <div className="rounded-md bg-muted p-3">
                <dt className="text-muted-foreground">当前选图</dt>
                <dd className="mt-1 font-semibold">{selectedCount} 张</dd>
              </div>
              <div className="rounded-md bg-muted p-3">
                <dt className="text-muted-foreground">预估费用</dt>
                <dd className="mt-1 font-semibold">¥{estimatedCost.yuan.toFixed(4)}</dd>
              </div>
              <div className="rounded-md bg-muted p-3">
                <dt className="text-muted-foreground">检测模板</dt>
                <dd className="mt-1 font-semibold">{config?.skillId ? '已保存' : '未保存'}</dd>
              </div>
              <div className="rounded-md bg-muted p-3">
                <dt className="text-muted-foreground">并发</dt>
                <dd className="mt-1 font-semibold">
                  {Math.max(1, Math.min(8, Number(concurrency) || 3))}
                </dd>
              </div>
            </dl>
            <label className="mt-3 block space-y-2 text-sm font-medium">
              <span>余额（手动输入）</span>
              <input
                className="h-10 w-full rounded-md border px-3 text-sm tabular-nums outline-none focus-visible:ring-2 focus-visible:ring-primary"
                min={0}
                onChange={(event) => setBalance(event.target.value)}
                placeholder="用于预览告警"
                step="0.01"
                type="number"
                value={balance}
              />
            </label>
            {hasBalance ? (
              <div
                className={`mt-3 rounded-md border px-3 py-2 text-sm ${
                  balanceLow
                    ? 'border-red-200 bg-red-50 text-red-800'
                    : 'border-emerald-200 bg-emerald-50 text-emerald-800'
                }`}
              >
                {balanceLow ? '余额低于建议安全线' : '余额充足'}
              </div>
            ) : null}
            <div className="mt-4 grid grid-cols-2 gap-2">
              <Button
                disabled={!selectedCount}
                onClick={clearSelection}
                type="button"
                variant="secondary"
              >
                清空
              </Button>
              <Button disabled={!canRun} onClick={() => void runDetection()} type="button">
                {isRunning ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <FolderOpen className="mr-2 h-4 w-4" />
                )}
                开始检测
              </Button>
            </div>
          </div>

          <div className="rounded-md border bg-background p-5 shadow-sm">
            <h2 className="text-lg font-semibold">阈值分段</h2>
            <dl className="mt-4 space-y-3 text-sm">
              <div className="flex items-center justify-between rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-emerald-800">
                <dt>通过</dt>
                <dd>0-{config?.threshold.passMax ?? 39}</dd>
              </div>
              <div className="flex items-center justify-between rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-amber-900">
                <dt>复核</dt>
                <dd>
                  {(config?.threshold.passMax ?? 39) + 1}-{config?.threshold.reviewMax ?? 69}
                </dd>
              </div>
              <div className="flex items-center justify-between rounded-md border border-red-200 bg-red-50 px-3 py-2 text-red-800">
                <dt>拦截</dt>
                <dd>{(config?.threshold.reviewMax ?? 69) + 1}-100</dd>
              </div>
            </dl>
          </div>

          <div className="rounded-md border bg-background p-5 shadow-sm">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold">进度</h2>
              <span className="text-sm tabular-nums text-muted-foreground">
                {progressPercentValue}%
              </span>
            </div>
            <div className="mt-4 h-2 overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full bg-primary transition-all"
                style={{ width: `${progressPercentValue}%` }}
              />
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
                <dt className="text-muted-foreground">跳过</dt>
                <dd className="font-medium tabular-nums">{progress?.skipped ?? 0}</dd>
              </div>
            </dl>
          </div>

          <div className="rounded-md border bg-background p-5 shadow-sm">
            <div className="flex items-center justify-between gap-4">
              <h2 className="text-lg font-semibold">手动多选缩略图</h2>
              <div className="text-sm text-muted-foreground">{selectedCount} 张已选</div>
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              点图即可切换选中状态。来源勾选会批量选中对应目录。
            </p>
            <div className="mt-4">
              <ThumbnailGrid
                items={allImages}
                selectedPaths={selectedPaths}
                onToggle={toggleImage}
              />
            </div>
          </div>
        </aside>
      </div>
      {isPromoteDialogOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/35 px-4">
          <div className="w-full max-w-md rounded-md border bg-background p-5 shadow-xl">
            <div className="flex items-start gap-3">
              <div className="mt-0.5 rounded-md border border-emerald-200 bg-emerald-50 p-2 text-emerald-700">
                <AlertTriangle className="h-4 w-4" />
              </div>
              <div>
                <h2 className="text-lg font-semibold">一键加入待套版</h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  发现 {passPromotionIds.length} 张通过印花，将流转到 04-待套版印花。
                </p>
              </div>
            </div>

            <div className="mt-5 space-y-3">
              <label
                className={`flex cursor-pointer items-start gap-3 rounded-md border p-3 text-sm ${
                  promoteMode === 'copy' ? 'border-primary bg-primary/5' : 'bg-background'
                }`}
              >
                <input
                  checked={promoteMode === 'copy'}
                  className="mt-1"
                  onChange={() => setPromoteMode('copy')}
                  type="radio"
                />
                <span>
                  <span className="block font-medium">复制（推荐）</span>
                  <span className="mt-1 block text-muted-foreground">
                    保留 03-检测/通过 副本，同时复制到 04-待套版印花。
                  </span>
                </span>
              </label>
              <label
                className={`flex cursor-pointer items-start gap-3 rounded-md border p-3 text-sm ${
                  promoteMode === 'move' ? 'border-primary bg-primary/5' : 'bg-background'
                }`}
              >
                <input
                  checked={promoteMode === 'move'}
                  className="mt-1"
                  onChange={() => setPromoteMode('move')}
                  type="radio"
                />
                <span>
                  <span className="block font-medium">移动</span>
                  <span className="mt-1 block text-muted-foreground">
                    将通过图移入 04-待套版印花，不保留 03-检测/通过 副本。
                  </span>
                </span>
              </label>
            </div>

            <div className="mt-5 flex justify-end gap-2">
              <Button
                disabled={isPromoting}
                onClick={() => setIsPromoteDialogOpen(false)}
                type="button"
                variant="secondary"
              >
                取消
              </Button>
              <Button disabled={isPromoting} onClick={() => void promotePassImages()} type="button">
                {isPromoting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                确认
              </Button>
            </div>
          </div>
        </div>
      ) : null}
      <Dialog open={Boolean(activeResult)} onOpenChange={(open) => !open && setActiveResult(null)}>
        {activeResult ? (
          <DialogContent className="max-w-4xl">
            <DialogHeader>
              <DialogTitle>检测详情</DialogTitle>
              <DialogDescription>
                风险值 {resultScore(activeResult)}，等级 {riskLabel(resultLevel(activeResult))}
              </DialogDescription>
            </DialogHeader>
            <div className="grid gap-5 md:grid-cols-[minmax(0,1fr)_320px]">
              <div className="overflow-hidden rounded-md border bg-muted">
                <img
                  alt={activeResult.imagePath}
                  className="max-h-[520px] w-full object-contain"
                  src={activeResult.thumbnailUrl || fileUrl(activeResult.imagePath)}
                />
              </div>
              <div className="space-y-4 text-sm">
                <div className="flex items-center justify-between rounded-md border px-3 py-2">
                  <span className="text-muted-foreground">风险等级</span>
                  <RiskBadge level={resultLevel(activeResult)} />
                </div>
                <div className="rounded-md border px-3 py-2">
                  <div className="text-muted-foreground">模型依据</div>
                  <p className="mt-2 leading-6">{resultReason(activeResult)}</p>
                </div>
                <div className="rounded-md border px-3 py-2">
                  <div className="text-muted-foreground">源文件</div>
                  <p className="mt-2 break-all text-xs">{activeResult.imagePath}</p>
                </div>
                {'outputPath' in activeResult ? (
                  <div className="rounded-md border px-3 py-2">
                    <div className="text-muted-foreground">检测产物</div>
                    <p className="mt-2 break-all text-xs">{activeResult.outputPath}</p>
                  </div>
                ) : null}
              </div>
            </div>
            <DialogFooter>
              <Button
                disabled={!activeResult.artifactId}
                onClick={() => void retestRow(activeResult)}
                type="button"
                variant="secondary"
              >
                重测
              </Button>
              <Button
                disabled={!activeResult.artifactId}
                onClick={() => void moveRow(activeResult)}
                type="button"
              >
                移动到待套版
              </Button>
            </DialogFooter>
          </DialogContent>
        ) : null}
      </Dialog>
    </div>
  )
}
