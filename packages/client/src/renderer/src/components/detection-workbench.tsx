import { Button } from '@/components/ui/button'
import type { RiskLevel, Skill, SkillSummary, SkillVariable } from '@tengyu-aipod/shared'
import {
  CheckCircle2,
  FolderOpen,
  ImageIcon,
  Loader2,
  Play,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  ShieldQuestion,
  Square,
} from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import type {
  DetectionImageInfo,
  DetectionImageResult,
  DetectionProgress,
  DetectionTaskEvent,
} from '../../../main/lib/detection-service'
import { detectionImageSrc } from './detection-image-url'
import { type DetectionPreviewResult, detectionPreviewResults } from './detection-preview'
import { ImageLightbox, type ImageLightboxItem } from './image-lightbox'

const DEFAULT_MODEL = 'qwen3.6-flash'
const DEFAULT_DETECTION_SKILL_ID = 'infringement-detection'
const DEFAULT_THRESHOLD = { passMax: 39, reviewMax: 69 }
const DEFAULT_MAX_SIZE = 1024
const DEFAULT_CONCURRENCY = 20

const RISK_LEVELS: RiskLevel[] = ['pass', 'review', 'block']

const riskLabels: Record<RiskLevel, string> = {
  pass: '无风险',
  review: '疑似',
  block: '高风险',
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

function progressPercent(progress: DetectionProgress | null) {
  if (!progress?.total) {
    return 0
  }
  return Math.round((progress.processed / progress.total) * 100)
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

function defaultVariables(skill: Skill) {
  return Object.fromEntries(
    skill.variables.map((variable) => [variable.key, defaultVariableValue(variable)]),
  )
}

function selectDefaultSkill(skills: SkillSummary[]) {
  return (
    skills.find((skill) => skill.id === DEFAULT_DETECTION_SKILL_ID) ??
    skills.find((skill) => skill.module === 'detection') ??
    null
  )
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

function ImageFolderPanel({
  folder,
  images,
  loading,
  onChoose,
  onScan,
}: {
  folder: string
  images: DetectionImageInfo[]
  loading: boolean
  onChoose: () => void
  onScan: () => void
}) {
  return (
    <section className="rounded-md border bg-background p-4 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-lg font-semibold text-balance">输入文件夹</h2>
          <p className="mt-1 truncate text-sm text-muted-foreground">{folder || '未选择文件夹'}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button onClick={onChoose} type="button" variant="secondary">
            <FolderOpen className="mr-2 h-4 w-4" />
            选择文件夹
          </Button>
          <Button disabled={!folder || loading} onClick={onScan} type="button">
            {loading ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="mr-2 h-4 w-4" />
            )}
            检索图片
          </Button>
        </div>
      </div>

      <div className="mt-4 flex items-center gap-2 rounded-md border bg-muted/30 px-3 py-2 text-sm">
        <ImageIcon className="h-4 w-4 text-muted-foreground" />
        <span>
          共 <span className="font-medium tabular-nums">{images.length}</span> 张，将运行{' '}
          <span className="font-medium tabular-nums">{images.length}</span> 次
        </span>
      </div>

      <div className="mt-4 grid max-h-[430px] gap-3 overflow-auto pr-1 sm:grid-cols-2 xl:grid-cols-3">
        {images.length ? (
          images.map((image) => (
            <div className="min-w-0 rounded-md border bg-muted/20 p-2 text-sm" key={image.path}>
              <img
                alt={image.name}
                className="h-28 w-full rounded-sm bg-muted object-cover"
                src={detectionImageSrc({ path: image.path, thumbnailUrl: image.thumbnailUrl })}
              />
              <span className="mt-2 block truncate font-medium">{image.name}</span>
              <span className="block truncate text-xs text-muted-foreground">
                {image.relativePath}
              </span>
            </div>
          ))
        ) : (
          <div className="rounded-md bg-muted px-3 py-10 text-center text-sm text-muted-foreground sm:col-span-2 xl:col-span-3">
            {folder ? '暂无图片' : '请选择文件夹'}
          </div>
        )}
      </div>
    </section>
  )
}

function RunPanel({
  imageCount,
  compression,
  model,
  models,
  running,
  skillLoading,
  skillReady,
  progress,
  onCompressionChange,
  onModelChange,
  onRun,
  onCancel,
}: {
  imageCount: number
  compression: boolean
  model: string
  models: string[]
  running: boolean
  skillLoading: boolean
  skillReady: boolean
  progress: DetectionProgress | null
  onCompressionChange: (enabled: boolean) => void
  onModelChange: (model: string) => void
  onRun: () => void
  onCancel: () => void
}) {
  const percent = progressPercent(progress)
  return (
    <aside className="space-y-5 xl:sticky xl:top-6 xl:self-start">
      <section className="rounded-md border bg-background p-4 shadow-sm">
        <h2 className="text-lg font-semibold text-balance">检测执行</h2>
        <dl className="mt-4 grid grid-cols-2 gap-x-5 gap-y-3 text-sm">
          <div>
            <dt className="text-muted-foreground">检索图片</dt>
            <dd className="font-medium tabular-nums">{imageCount}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">运行次数</dt>
            <dd className="font-medium tabular-nums">{imageCount}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">模型</dt>
            <dd className="truncate font-medium">{model || DEFAULT_MODEL}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Skill</dt>
            <dd className="truncate font-medium">
              {skillLoading ? '读取中' : skillReady ? '已就绪' : '未就绪'}
            </dd>
          </div>
        </dl>

        <label className="mt-5 block space-y-2 text-sm font-medium">
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

        <label className="mt-4 flex items-center justify-between rounded-md border px-3 py-2 text-sm font-medium">
          <span>压缩图片</span>
          <input
            checked={compression}
            onChange={(event) => onCompressionChange(event.target.checked)}
            type="checkbox"
          />
        </label>

        <Button
          className="mt-4 w-full"
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
  onOpenPreview,
}: {
  level: RiskLevel
  results: Array<Extract<DetectionImageResult, { status: 'success' | 'skipped' }>>
  onOpenPreview: (result: DetectionPreviewResult) => void
}) {
  const tone = riskTone(level)
  const Icon = tone.icon
  return (
    <section className={`rounded-md border ${tone.border} bg-background p-4`}>
      <div className="flex items-center justify-between gap-3">
        <div className={`flex items-center gap-2 ${tone.text}`}>
          <Icon className="h-4 w-4" />
          <h3 className="font-semibold">{riskLabels[level]}</h3>
        </div>
        <span className="font-medium tabular-nums">{results.length}</span>
      </div>
      <div className="mt-4 grid max-h-[520px] gap-3 overflow-auto pr-1 md:grid-cols-2 xl:grid-cols-1 2xl:grid-cols-2">
        {results.length ? (
          results.map((result) => (
            <button
              className={`rounded-md border ${tone.border} ${tone.surface} p-2 text-left text-sm transition hover:shadow-sm focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2`}
              key={result.artifactId}
              onClick={() => onOpenPreview(result)}
              type="button"
            >
              <img
                alt={fileName(result.imagePath)}
                className="h-28 w-full rounded-sm bg-muted object-cover"
                src={detectionImageSrc({
                  path: result.imagePath,
                  thumbnailUrl: result.thumbnailUrl,
                })}
              />
              <span className="mt-2 flex items-center justify-between gap-2">
                <span className="truncate font-medium">{fileName(result.imagePath)}</span>
                <span className="text-xs tabular-nums">{result.riskScore}</span>
              </span>
              <span className="mt-1 line-clamp-2 text-xs text-muted-foreground">
                {result.reason}
              </span>
              {result.cached ? (
                <span className="mt-2 inline-flex rounded-md border bg-background/80 px-1.5 py-0.5 text-xs text-muted-foreground">
                  缓存
                </span>
              ) : null}
            </button>
          ))
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
  if (!results.length) {
    return null
  }
  return (
    <section className="rounded-md border bg-background p-4 shadow-sm">
      <div className="flex items-center gap-2 text-red-800">
        <ShieldAlert className="h-4 w-4" />
        <h3 className="font-semibold">失败</h3>
        <span className="font-medium tabular-nums">{results.length}</span>
      </div>
      <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {results.map((result) => (
          <div
            className="rounded-md border border-red-200 bg-red-50 p-2 text-sm"
            key={result.imagePath}
          >
            <img
              alt={fileName(result.imagePath)}
              className="h-28 w-full rounded-sm bg-muted object-cover"
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
    </section>
  )
}

export function DetectionWorkbench() {
  const [sourceFolder, setSourceFolder] = useState('')
  const [sourceImages, setSourceImages] = useState<DetectionImageInfo[]>([])
  const [loadingImages, setLoadingImages] = useState(false)
  const [compression, setCompression] = useState(true)
  const [models, setModels] = useState<string[]>([])
  const [model, setModel] = useState(DEFAULT_MODEL)
  const [skill, setSkill] = useState<Skill | null>(null)
  const [skillLoading, setSkillLoading] = useState(true)
  const [progress, setProgress] = useState<DetectionProgress | null>(null)
  const [running, setRunning] = useState(false)
  const [runningTaskId, setRunningTaskId] = useState<string | null>(null)
  const [results, setResults] = useState<DetectionImageResult[]>([])
  const [activeDetectionPreviewIndex, setActiveDetectionPreviewIndex] = useState<number | null>(
    null,
  )
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const runningTaskIdRef = useRef<string | null>(null)

  useEffect(() => {
    let mounted = true
    async function loadSkill() {
      setSkillLoading(true)
      try {
        const [skills, modelList, config] = await Promise.all([
          window.api.skill.list({ module: 'detection' }),
          window.api.detection.listModels(),
          window.api.detection.getConfig(),
        ])
        const summary = selectDefaultSkill(skills)
        if (!summary) {
          throw new Error('没有可用的侵权检测 Skill，请先在设置里同步 Skill')
        }
        const detail = await window.api.skill.get({ id: summary.id, version: summary.version })
        if (!mounted) {
          return
        }
        setModels(modelList)
        setModel(config?.model ?? modelList[0] ?? DEFAULT_MODEL)
        setSkill(detail)
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

      setRunning(false)
      runningTaskIdRef.current = null
      if (!event.ok) {
        setError(event.error)
        setMessage(null)
        return
      }

      setResults(event.result.results)
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

  async function chooseSourceFolder() {
    setError(null)
    const result = await window.api.detection.chooseInputFolder()
    if (!result.ok) {
      if (result.error.code !== 'CANCELLED') {
        setError(result.error.message)
      }
      return
    }
    setSourceFolder(result.data.path)
    setSourceImages([])
    setResults([])
    setProgress(null)
    setMessage(null)
  }

  async function scanSourceFolder() {
    if (!sourceFolder) {
      setError('请先选择输入文件夹')
      return
    }
    setLoadingImages(true)
    setError(null)
    setMessage(null)
    try {
      const images = await window.api.detection.scanFolder({ folder: sourceFolder })
      setSourceImages(images)
      setResults([])
      setProgress(null)
      setMessage(`已检索 ${images.length} 张图片`)
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : '检索图片失败')
    } finally {
      setLoadingImages(false)
    }
  }

  async function startDetection() {
    if (!sourceImages.length) {
      setError('请先检索图片文件夹')
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
    try {
      const generationSettings = await window.api.generationSettings.get().catch(() => null)
      const concurrency = generationSettings?.config.default_concurrency ?? DEFAULT_CONCURRENCY
      const taskId = await window.api.detection.run({
        imagePaths: sourceImages.map((image) => image.path),
        skillId: skill.id,
        skillVersion: skill.version,
        model: model || DEFAULT_MODEL,
        variables: defaultVariables(skill),
        threshold: DEFAULT_THRESHOLD,
        preprocess: {
          compress: compression,
          maxSize: DEFAULT_MAX_SIZE,
          format: 'jpg',
        },
        concurrency,
      })
      runningTaskIdRef.current = taskId
      setRunningTaskId(taskId)
      setProgress({
        task_id: taskId,
        processed: 0,
        total: sourceImages.length,
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
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-1">
          <p className="text-sm font-medium text-primary">侵权检测</p>
          <h1 className="text-2xl font-semibold text-balance">按文件夹批量检测印花风险</h1>
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

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
        <ImageFolderPanel
          folder={sourceFolder}
          images={sourceImages}
          loading={loadingImages}
          onChoose={() => void chooseSourceFolder()}
          onScan={() => void scanSourceFolder()}
        />

        <RunPanel
          compression={compression}
          imageCount={sourceImages.length}
          model={model}
          models={models}
          progress={progress}
          running={running}
          skillLoading={skillLoading}
          skillReady={Boolean(skill)}
          onCompressionChange={setCompression}
          onModelChange={setModel}
          onCancel={() => void cancelDetection()}
          onRun={() => void startDetection()}
        />
      </div>

      <section className="rounded-md border bg-background p-4 shadow-sm">
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
        </div>
        <div className="mt-4 grid gap-4 xl:grid-cols-3">
          {RISK_LEVELS.map((level) => (
            <RiskResults
              key={level}
              level={level}
              results={resultsByRisk[level]}
              onOpenPreview={openDetectionPreview}
            />
          ))}
        </div>
      </section>

      <FailedResults results={failedResults} />
      <ImageLightbox
        activeIndex={activeDetectionPreviewIndex}
        items={previewItems}
        title="侵权检测预览"
        onActiveIndexChange={setActiveDetectionPreviewIndex}
      />
    </div>
  )
}
