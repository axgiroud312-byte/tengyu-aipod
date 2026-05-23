import { Button } from '@/components/ui/button'
import { APP_VERSION, type RiskLevel } from '@tengyu-aipod/shared'
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
      return 'Pass'
    case 'review':
      return 'Review'
    case 'block':
      return 'Block'
    default:
      return 'Failed'
  }
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
      className="relative h-[520px] overflow-auto rounded-md border bg-background"
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
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [dragActive, setDragActive] = useState(false)
  const [balance, setBalance] = useState('')

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

  const isRunning = Boolean(progress && progress.processed < progress.total)
  const canRun = Boolean(config?.skillId) && selectedImages.length > 0 && !isRunning
  const selectedCount = selectedImages.length

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

  async function promotePassImages() {
    const passIds = resultsSorted.reduce<string[]>((acc, result) => {
      if (result.status === 'failed' || result.riskLevel !== 'pass' || !result.artifactId) {
        return acc
      }
      acc.push(result.artifactId)
      return acc
    }, [])
    if (!passIds.length) {
      setError('没有可加入待套版的 pass 图')
      return
    }
    const count = await window.api.detection.promoteToMatting({
      artifact_ids: passIds,
      mode: 'copy',
    })
    setMessage(`已复制 ${count} 张 pass 图到待套版`)
  }

  async function retestRow(result: DetectionImageResult) {
    if (!result.artifactId) {
      setError('这张图没有可重测的 artifact')
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

  return (
    <div className="space-y-6">
      <div className="rounded-md border bg-background p-5 shadow-sm">
        <div className="flex items-start justify-between gap-6">
          <div className="space-y-1">
            <p className="text-sm font-medium text-muted-foreground">侵权检测模块</p>
            <h1 className="text-2xl font-semibold text-balance">输入选择、批量检测、结果流转</h1>
            <p className="text-sm text-muted-foreground">版本 {APP_VERSION}</p>
          </div>
          <div className="rounded-md border bg-muted px-3 py-2 text-right text-xs text-muted-foreground">
            <div>当前选图</div>
            <div className="mt-1 font-mono text-foreground">{selectedCount}</div>
          </div>
        </div>
      </div>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
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
                <h2 className="mt-1 text-lg font-semibold">模型 / Skill / 阈值 / 关注重点</h2>
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
                预估费用按当前选图实时刷新
              </div>
              <div className="flex gap-2">
                <Button
                  disabled={!selectedCount}
                  onClick={() => {
                    setSelectedFolders([])
                    setManualOverrides({})
                    setExternalImages([])
                    setResults([])
                    setError(null)
                    setMessage(null)
                  }}
                  type="button"
                  variant="secondary"
                >
                  清空选择
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
          </div>

          {progress ? (
            <div className="rounded-md border bg-background p-5 shadow-sm">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <p className="text-sm font-medium text-muted-foreground">进度</p>
                  <h2 className="mt-1 text-lg font-semibold">
                    {progress.processed} / {progress.total}
                  </h2>
                </div>
                <div className="text-right text-sm text-muted-foreground">
                  <div>当前并发</div>
                  <div className="mt-1 font-mono text-foreground">
                    {progress.concurrency ?? (Number(concurrency) || 3)}
                  </div>
                </div>
              </div>
              <div className="mt-4 h-2 overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full rounded-full bg-primary transition-all"
                  style={{
                    width: `${progress.total ? Math.round((progress.processed / progress.total) * 100) : 0}%`,
                  }}
                />
              </div>
              <div className="mt-4 grid grid-cols-4 gap-3 text-sm">
                <div className="rounded-md bg-muted p-3">
                  <div className="text-muted-foreground">成功</div>
                  <div className="mt-1 font-semibold">{progress.succeeded}</div>
                </div>
                <div className="rounded-md bg-muted p-3">
                  <div className="text-muted-foreground">失败</div>
                  <div className="mt-1 font-semibold">{progress.failed}</div>
                </div>
                <div className="rounded-md bg-muted p-3">
                  <div className="text-muted-foreground">跳过</div>
                  <div className="mt-1 font-semibold">{progress.skipped}</div>
                </div>
                <div className="rounded-md bg-muted p-3">
                  <div className="text-muted-foreground">任务</div>
                  <div className="mt-1 truncate font-mono text-xs">{runningTaskId ?? '-'}</div>
                </div>
              </div>
            </div>
          ) : null}

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

          <div className="rounded-md border bg-background p-5 shadow-sm">
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="text-sm font-medium text-muted-foreground">结果列表</p>
                <h2 className="mt-1 text-lg font-semibold">按风险值降序</h2>
              </div>
              <div className="flex gap-2">
                <Button
                  disabled={!resultsSorted.length}
                  onClick={() => void promotePassImages()}
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
                  导出 CSV
                </Button>
              </div>
            </div>

            <div className="mt-4 grid gap-3 md:grid-cols-4">
              <div className="rounded-md bg-muted p-3">
                <div className="text-muted-foreground">Pass</div>
                <div className="mt-1 font-semibold text-emerald-700">{stats.pass}</div>
              </div>
              <div className="rounded-md bg-muted p-3">
                <div className="text-muted-foreground">Review</div>
                <div className="mt-1 font-semibold text-amber-700">{stats.review}</div>
              </div>
              <div className="rounded-md bg-muted p-3">
                <div className="text-muted-foreground">Block</div>
                <div className="mt-1 font-semibold text-red-700">{stats.block}</div>
              </div>
              <div className="rounded-md bg-muted p-3">
                <div className="text-muted-foreground">Failed</div>
                <div className="mt-1 font-semibold">{stats.failed}</div>
              </div>
            </div>

            <div className="mt-5 overflow-hidden rounded-md border">
              <div className="grid grid-cols-[120px_90px_100px_1fr_1fr_180px] gap-3 border-b bg-muted/50 px-3 py-2 text-xs font-medium text-muted-foreground">
                <div>缩略图</div>
                <div>风险值</div>
                <div>等级</div>
                <div>依据</div>
                <div>来源</div>
                <div>操作</div>
              </div>
              <div className="max-h-[520px] overflow-auto">
                {resultsSorted.length ? (
                  resultsSorted.map((result) => {
                    const riskScore = result.status === 'failed' ? '-' : String(result.riskScore)
                    const level = result.status === 'failed' ? 'failed' : result.riskLevel
                    return (
                      <div
                        className="grid grid-cols-[120px_90px_100px_1fr_1fr_180px] gap-3 border-b px-3 py-3 text-sm last:border-b-0"
                        key={`${result.artifactId ?? result.imagePath}-${result.status}`}
                      >
                        <div className="h-16 overflow-hidden rounded-md border bg-muted">
                          <img
                            alt={result.imagePath}
                            className="h-full w-full object-cover"
                            src={result.thumbnailUrl || fileUrl(result.imagePath)}
                          />
                        </div>
                        <div className="flex items-center font-mono text-base font-semibold tabular-nums">
                          {riskScore}
                        </div>
                        <div className="flex items-center">
                          <RiskBadge level={level} />
                        </div>
                        <div className="flex items-center text-muted-foreground">
                          {result.status === 'failed' ? result.error : result.reason || '-'}
                        </div>
                        <div className="flex items-center truncate text-xs text-muted-foreground">
                          {result.imagePath}
                        </div>
                        <div className="flex flex-wrap gap-2">
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
                  <div className="px-3 py-8 text-center text-sm text-muted-foreground">
                    暂无检测结果
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>

        <aside className="space-y-6">
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

          <div className="rounded-md border bg-background p-5 shadow-sm">
            <h2 className="text-lg font-semibold">预估</h2>
            <div className="mt-3 rounded-md bg-muted p-3 text-sm">
              <div className="text-muted-foreground">当前选图</div>
              <div className="mt-1 font-semibold">{selectedCount} 张</div>
            </div>
            <div className="mt-3 rounded-md bg-muted p-3 text-sm">
              <div className="text-muted-foreground">提示</div>
              <div className="mt-1">{config?.skillId ? '检测配置已就绪' : '请先保存检测配置'}</div>
            </div>
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
          </div>
        </aside>
      </div>
    </div>
  )
}
