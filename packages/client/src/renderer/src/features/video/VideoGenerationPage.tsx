import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
import { localImageUrl } from '@/lib/media'
import { cn } from '@/lib/utils'
import {
  AlertTriangle,
  CheckCircle2,
  CircleAlert,
  CircleStop,
  Copy,
  Download,
  FileVideo,
  FolderOpen,
  ImageIcon,
  Loader2,
  Play,
  SlidersHorizontal,
  Square,
  Terminal,
  Trash2,
  Upload,
} from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import type {
  HappyHorseRatio,
  HappyHorseResolution,
  HappyHorseVersion,
  VideoCompletedEvent,
  VideoGenerationMode,
  VideoGenerationStatus,
  VideoProgressEvent,
  VideoRunInput,
  VideoRuntimeLogEntry,
} from '../../../../main/lib/video-generation-service'
import { formatVideoDebugLogLine, videoDebugLogLevelCounts } from './video-generation-debug-log'
import {
  buildVideoReferenceToken,
  filterVideoPromptReferenceOptions,
  findVideoPromptMention,
  replaceVideoPromptRange,
} from './video-prompt-mentions'

type SelectedImage = {
  path: string
  name: string
}

const VIDEO_DEBUG_LOG_LIMIT = 1000
const RATIO_OPTIONS: HappyHorseRatio[] = [
  '16:9',
  '9:16',
  '3:4',
  '4:3',
  '4:5',
  '5:4',
  '1:1',
  '9:21',
  '21:9',
]
const DURATION_OPTIONS: Array<VideoRunInput['duration']> = [3, 5, 8, 10, 15]
const RESOLUTION_OPTIONS: HappyHorseResolution[] = ['720P', '1080P']
const VERSION_OPTIONS: HappyHorseVersion[] = ['happyhorse-1.1', 'happyhorse-1.0']
const VIDEO_STATUS_STEPS: Array<{ status: VideoGenerationStatus; label: string }> = [
  { status: 'validating', label: '校验' },
  { status: 'submitting', label: '提交' },
  { status: 'pending', label: '等待' },
  { status: 'running', label: '生成中' },
  { status: 'downloading', label: '下载' },
  { status: 'succeeded', label: '完成' },
  { status: 'failed', label: '失败' },
  { status: 'stopped', label: '已停止' },
]
const VIDEO_SEQUENTIAL_STATUSES: VideoGenerationStatus[] = [
  'validating',
  'submitting',
  'pending',
  'running',
  'downloading',
  'succeeded',
]

function imageModeLabel(mode: VideoGenerationMode) {
  return mode === 'image-to-video' ? '图生视频' : '参考生视频'
}

export function VideoGenerationPage() {
  const [mode, setMode] = useState<VideoGenerationMode>('image-to-video')
  const [images, setImages] = useState<SelectedImage[]>([])
  const [prompt, setPrompt] = useState('')
  const [taskName, setTaskName] = useState('')
  const [modelVersion, setModelVersion] = useState<HappyHorseVersion>('happyhorse-1.1')
  const [resolution, setResolution] = useState<HappyHorseResolution>('720P')
  const [duration, setDuration] = useState<VideoRunInput['duration']>(5)
  const [watermark, setWatermark] = useState(false)
  const [ratio, setRatio] = useState<HappyHorseRatio>('9:16')
  const [taskId, setTaskId] = useState<string | null>(null)
  const [progress, setProgress] = useState<VideoProgressEvent | null>(null)
  const [result, setResult] = useState<VideoCompletedEvent | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [openMessage, setOpenMessage] = useState<string | null>(null)
  const [isChoosingImages, setIsChoosingImages] = useState(false)
  const [isStarting, setIsStarting] = useState(false)
  const [isStopping, setIsStopping] = useState(false)
  const [isLogOpen, setIsLogOpen] = useState(false)
  const [logs, setLogs] = useState<VideoRuntimeLogEntry[]>([])
  const logViewportRef = useRef<HTMLDivElement | null>(null)
  const promptTextareaRef = useRef<HTMLTextAreaElement | null>(null)
  const [pendingPromptCaret, setPendingPromptCaret] = useState<number | null>(null)
  const [activeMentionIndex, setActiveMentionIndex] = useState(0)
  const [activeMentionQuery, setActiveMentionQuery] =
    useState<ReturnType<typeof findVideoPromptMention>>(null)
  const latestLogId = logs.at(-1)?.id ?? null

  useEffect(() => {
    const offProgress = window.api.video.onProgress((event) => {
      setProgress(event)
      setTaskId(event.task_id)
    })
    const offCompleted = window.api.video.onCompleted((event) => {
      setResult(event)
      if (!event.ok) {
        setError(event.error)
      } else {
        setError(null)
      }
    })
    const offDebug = window.api.video.onDebugLog((entry) => {
      setLogs((current) => [...current, entry].slice(-VIDEO_DEBUG_LOG_LIMIT))
    })
    return () => {
      offProgress()
      offCompleted()
      offDebug()
    }
  }, [])

  useEffect(() => {
    if (!isLogOpen) {
      return
    }
    const viewport = logViewportRef.current
    if (!viewport) {
      return
    }
    viewport.dataset.lastLogId = latestLogId ?? ''
    viewport.scrollTop = viewport.scrollHeight
  }, [isLogOpen, latestLogId])

  useEffect(() => {
    setImages([])
    setPrompt('')
    setTaskName('')
    setTaskId(null)
    setProgress(null)
    setResult(null)
    setError(null)
    setOpenMessage(null)
    setActiveMentionIndex(0)
    setActiveMentionQuery(null)
    if (mode === 'reference-to-video') {
      setRatio('9:16')
    }
  }, [mode])

  useEffect(() => {
    const caret = pendingPromptCaret
    const target = promptTextareaRef.current
    if (caret === null || !target) {
      return
    }
    target.focus()
    target.setSelectionRange(caret, caret)
    setPendingPromptCaret(null)
    syncPromptMention(target)
  }, [pendingPromptCaret])

  const logCounts = useMemo(() => videoDebugLogLevelCounts(logs), [logs])
  const mentionOptions = useMemo(() => {
    if (mode !== 'reference-to-video' || !activeMentionQuery) {
      return []
    }
    return filterVideoPromptReferenceOptions(images, activeMentionQuery.query)
  }, [activeMentionQuery, images, mode])
  const canStart = useMemo(() => {
    if (mode === 'image-to-video') {
      return images.length === 1 && !isStarting
    }
    return images.length >= 1 && prompt.trim().length > 0 && !isStarting
  }, [images.length, isStarting, mode, prompt])
  const videoPath = result?.ok ? result.outputPath : null
  const diagnosticsLogPath = progress?.diagnosticsLogPath ?? result?.diagnosticsLogPath ?? null
  const currentStatus = progress?.status ?? (result ? (result.ok ? 'succeeded' : 'failed') : null)
  const currentSequentialIndex = currentStatus
    ? VIDEO_SEQUENTIAL_STATUSES.indexOf(currentStatus)
    : -1
  const isMentionOpen =
    mode === 'reference-to-video' && mentionOptions.length > 0 && activeMentionQuery !== null

  useEffect(() => {
    if (activeMentionIndex < mentionOptions.length) {
      return
    }
    setActiveMentionIndex(0)
  }, [activeMentionIndex, mentionOptions.length])

  async function chooseImages() {
    setIsChoosingImages(true)
    setError(null)
    try {
      const selected = await window.api.video.chooseImages({
        multiple: mode === 'reference-to-video',
      })
      if (!selected.ok) {
        return
      }
      const next = selected.data.paths.map((path) => ({
        path,
        name: path.split(/[\\/]/).pop() ?? path,
      }))
      setImages(mode === 'image-to-video' ? next.slice(0, 1) : next.slice(0, 9))
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : '选择图片失败')
    } finally {
      setIsChoosingImages(false)
    }
  }

  async function startRun() {
    setIsStarting(true)
    setError(null)
    setOpenMessage(null)
    setResult(null)
    try {
      const nextTaskId = await window.api.video.run({
        mode,
        taskName: taskName.trim() || undefined,
        prompt: prompt.trim() || undefined,
        imagePaths: images.map((item) => item.path),
        modelVersion,
        resolution,
        duration,
        watermark,
        ...(mode === 'reference-to-video' ? { ratio } : {}),
      })
      setTaskId(nextTaskId)
      setProgress({
        task_id: nextTaskId,
        mode,
        status: 'validating',
        message: '正在校验本地图片',
      })
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : '启动视频生成失败')
    } finally {
      setIsStarting(false)
    }
  }

  async function stopRun() {
    if (!taskId) {
      return
    }
    setIsStopping(true)
    try {
      const response = await window.api.video.stop({ task_id: taskId })
      if (!response.ok) {
        setError('当前没有可停止的查询任务')
      }
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : '停止查询失败')
    } finally {
      setIsStopping(false)
    }
  }

  async function openPath(path: string) {
    const response = await window.api.video.openPath({ path })
    setOpenMessage(response.ok ? null : response.error.message)
  }

  async function copyVideoUrl() {
    if (!result?.ok) {
      return
    }
    try {
      await navigator.clipboard.writeText(result.videoUrl)
      setOpenMessage(null)
    } catch (nextError) {
      setOpenMessage(nextError instanceof Error ? nextError.message : '复制链接失败')
    }
  }

  function removeImage(path: string) {
    setImages((current) => current.filter((item) => item.path !== path))
  }

  function syncPromptMention(target: HTMLTextAreaElement) {
    if (mode !== 'reference-to-video') {
      setActiveMentionQuery(null)
      return
    }
    setActiveMentionQuery(
      findVideoPromptMention(target.value, target.selectionStart ?? target.value.length),
    )
  }

  function insertReferenceToken(index: number) {
    const token = buildVideoReferenceToken(index)
    const target = promptTextareaRef.current
    const currentValue = target?.value ?? prompt
    const selectionStart = target?.selectionStart ?? currentValue.length
    const selectionEnd = target?.selectionEnd ?? currentValue.length
    const start = activeMentionQuery ? activeMentionQuery.start : selectionStart
    const end = activeMentionQuery ? activeMentionQuery.end : selectionEnd
    const next = replaceVideoPromptRange(currentValue, start, end, token)
    setPendingPromptCaret(next.caret)
    setPrompt(next.value)
    setActiveMentionIndex(0)
    setActiveMentionQuery(null)
  }

  function handlePromptKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (!isMentionOpen) {
      return
    }
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setActiveMentionIndex((current) => (current + 1) % mentionOptions.length)
      return
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault()
      setActiveMentionIndex(
        (current) => (current - 1 + mentionOptions.length) % mentionOptions.length,
      )
      return
    }
    if (event.key === 'Enter' || event.key === 'Tab') {
      event.preventDefault()
      const selected = mentionOptions[activeMentionIndex]
      if (selected) {
        insertReferenceToken(selected.index)
      }
      return
    }
    if (event.key === 'Escape') {
      event.preventDefault()
      setActiveMentionQuery(null)
      setActiveMentionIndex(0)
    }
  }

  return (
    <section aria-label="视频生成生产工作区" className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-4 border-b pb-4">
        <div>
          <p className="text-sm font-medium text-muted-foreground">视频生成</p>
          <h2 className="mt-1 text-xl font-semibold">HappyHorse 单次视频生产</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            本次只生成 1 个 MP4，完成后保存到 05-视频工作区。
          </p>
        </div>
        <Button onClick={() => setIsLogOpen(true)} type="button" variant="secondary">
          <Terminal className="mr-2 h-4 w-4" />
          日志 {logs.length}
          {logCounts.warn > 0 ? (
            <Badge className="ml-2" variant="outline">
              warn {logCounts.warn}
            </Badge>
          ) : null}
          {logCounts.error > 0 ? (
            <Badge className="ml-2" variant="destructive">
              error {logCounts.error}
            </Badge>
          ) : null}
        </Button>
      </div>

      <div className="grid min-w-0 gap-5 min-[1600px]:grid-cols-[minmax(0,1.15fr)_minmax(420px,0.85fr)]">
        <section
          aria-label="视频输入素材与提示词"
          className="min-w-0 self-start rounded-md border bg-background p-5 shadow-sm"
        >
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
                <ImageIcon className="h-4 w-4" />
                输入素材与提示词
              </p>
              <h2 className="mt-1 text-lg font-semibold">
                {mode === 'image-to-video' ? '首帧驱动视频' : '多图参考视频'}
              </h2>
            </div>
            <Tabs onValueChange={(value) => setMode(value as VideoGenerationMode)} value={mode}>
              <TabsList className="grid w-[240px] grid-cols-2">
                <TabsTrigger value="image-to-video">图生视频</TabsTrigger>
                <TabsTrigger value="reference-to-video">参考生视频</TabsTrigger>
              </TabsList>
            </Tabs>
          </div>

          <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-y py-4">
            <div className="text-sm">
              <span className="font-medium">
                {mode === 'image-to-video' ? '首帧图' : '视频参考图'}
              </span>
              <span className="ml-2 text-muted-foreground">
                {mode === 'image-to-video' ? '1 张' : `${images.length}/9 张`}
              </span>
            </div>
            <Button
              disabled={isChoosingImages}
              onClick={() => void chooseImages()}
              type="button"
              variant="secondary"
            >
              {isChoosingImages ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Upload className="mr-2 h-4 w-4" />
              )}
              {mode === 'image-to-video' ? '选择首帧图' : '选择参考图'}
            </Button>
          </div>

          {images.length > 0 ? (
            <div className="mt-4 grid gap-3 sm:grid-cols-2 2xl:grid-cols-3">
              {images.map((image, index) => (
                <div className="min-w-0 rounded-md border bg-muted/20 p-3" key={image.path}>
                  <div className="aspect-[4/3] overflow-hidden rounded-sm border bg-white">
                    <img
                      alt={image.name}
                      className="h-full w-full object-cover"
                      loading="lazy"
                      src={localImageUrl(image.path)}
                    />
                  </div>
                  <div className="mt-3 flex min-w-0 items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        {mode === 'reference-to-video' ? (
                          <Button
                            className="h-7 px-2 text-xs"
                            onClick={() => insertReferenceToken(index + 1)}
                            type="button"
                            variant="outline"
                          >
                            {buildVideoReferenceToken(index + 1)}
                          </Button>
                        ) : null}
                        <span className="truncate text-sm font-medium">{image.name}</span>
                      </div>
                      <p className="mt-1 truncate text-xs text-muted-foreground" title={image.path}>
                        {image.path}
                      </p>
                    </div>
                    <Button
                      aria-label={`删除 ${image.name}`}
                      className="h-8 w-8 shrink-0 p-0"
                      onClick={() => removeImage(image.path)}
                      title={`删除 ${image.name}`}
                      type="button"
                      variant="ghost"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="mt-4 flex min-h-44 items-center justify-center rounded-md border border-dashed bg-muted/20 px-4 text-center text-sm text-muted-foreground">
              <div>
                <ImageIcon className="mx-auto mb-2 h-6 w-6" />
                {mode === 'image-to-video' ? '尚未选择首帧图' : '尚未选择视频参考图'}
              </div>
            </div>
          )}

          <label className="mt-5 grid gap-2 text-sm font-medium" htmlFor="video-prompt">
            <span>{mode === 'reference-to-video' ? '提示词' : '提示词（可选）'}</span>
            <div className="space-y-2">
              <div className="relative">
                <Textarea
                  id="video-prompt"
                  onBlur={() => {
                    window.setTimeout(() => {
                      if (document.activeElement !== promptTextareaRef.current) {
                        setActiveMentionQuery(null)
                        setActiveMentionIndex(0)
                      }
                    }, 0)
                  }}
                  onChange={(event) => {
                    setPrompt(event.target.value)
                    syncPromptMention(event.target)
                  }}
                  onFocus={(event) => syncPromptMention(event.target)}
                  onKeyDown={handlePromptKeyDown}
                  onSelect={(event) => syncPromptMention(event.currentTarget)}
                  placeholder={
                    mode === 'reference-to-video'
                      ? '例如：输入 @ 选图，或点击图片编号插入'
                      : '例如：让产品缓慢旋转，镜头轻微推进'
                  }
                  ref={promptTextareaRef}
                  rows={5}
                  value={prompt}
                />
                {isMentionOpen ? (
                  <div className="absolute inset-x-0 top-full z-20 mt-2 rounded-md border bg-white p-1 shadow-lg">
                    {mentionOptions.map((option, index) => (
                      <button
                        className={cn(
                          'flex w-full items-center justify-between rounded-sm px-3 py-2 text-left text-sm',
                          index === activeMentionIndex ? 'bg-muted' : 'hover:bg-muted/70',
                        )}
                        key={option.path}
                        onClick={() => insertReferenceToken(option.index)}
                        onMouseDown={(event) => event.preventDefault()}
                        type="button"
                      >
                        <span className="font-medium">{option.token}</span>
                        <span className="ml-3 truncate text-xs text-muted-foreground">
                          {option.name}
                        </span>
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>
              {mode === 'reference-to-video' && images.length > 0 ? (
                <div className="flex flex-wrap gap-2">
                  {images.map((image, index) => (
                    <Button
                      className="h-8 px-2 text-xs"
                      key={image.path}
                      onClick={() => insertReferenceToken(index + 1)}
                      type="button"
                      variant="outline"
                    >
                      {buildVideoReferenceToken(index + 1)}
                    </Button>
                  ))}
                </div>
              ) : null}
            </div>
          </label>
        </section>

        <div className="min-w-0 self-start space-y-5">
          <aside
            aria-label="视频参数与启动"
            className="rounded-md border bg-background p-5 shadow-sm"
          >
            <p className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
              <SlidersHorizontal className="h-4 w-4" />
              生成参数
            </p>
            <h2 className="mt-1 text-lg font-semibold">参数与启动</h2>

            <div className="mt-5 grid gap-4 sm:grid-cols-2">
              <div className="grid gap-2 text-sm font-medium">
                <span>模型版本</span>
                <Select
                  onValueChange={(value) => setModelVersion(value as HappyHorseVersion)}
                  value={modelVersion}
                >
                  <SelectTrigger aria-label="模型版本">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {VERSION_OPTIONS.map((option) => (
                      <SelectItem key={option} value={option}>
                        {option}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="grid gap-2 text-sm font-medium">
                <span>清晰度</span>
                <Select
                  onValueChange={(value) => setResolution(value as HappyHorseResolution)}
                  value={resolution}
                >
                  <SelectTrigger aria-label="清晰度">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {RESOLUTION_OPTIONS.map((option) => (
                      <SelectItem key={option} value={option}>
                        {option}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="grid gap-2 text-sm font-medium">
                <span>时长</span>
                <Select
                  onValueChange={(value) => setDuration(Number(value) as VideoRunInput['duration'])}
                  value={String(duration)}
                >
                  <SelectTrigger aria-label="时长">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {DURATION_OPTIONS.map((option) => (
                      <SelectItem key={option} value={String(option)}>
                        {option} 秒
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {mode === 'reference-to-video' ? (
                <div className="grid gap-2 text-sm font-medium">
                  <span>比例</span>
                  <Select
                    onValueChange={(value) => setRatio(value as HappyHorseRatio)}
                    value={ratio}
                  >
                    <SelectTrigger aria-label="比例">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {RATIO_OPTIONS.map((option) => (
                        <SelectItem key={option} value={option}>
                          {option}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              ) : null}

              <label
                className="grid gap-2 text-sm font-medium sm:col-span-2"
                htmlFor="video-task-name"
              >
                <span>任务名</span>
                <Input
                  id="video-task-name"
                  onChange={(event) => setTaskName(event.target.value)}
                  placeholder="留空则自动使用时间"
                  value={taskName}
                />
              </label>
            </div>

            <label
              className="mt-4 inline-flex items-center gap-2 text-sm font-medium"
              htmlFor="video-watermark"
            >
              <Checkbox
                checked={watermark}
                id="video-watermark"
                onCheckedChange={(checked) => setWatermark(checked === true)}
              />
              添加水印
            </label>

            <div className="mt-4 flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-950">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>可能产生百炼费用；停止查询不会取消云端任务，云端可能继续运行并计费。</span>
            </div>

            <div className="mt-4 flex flex-wrap gap-2">
              <Button disabled={!canStart} onClick={() => void startRun()} type="button">
                {isStarting ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Play className="mr-2 h-4 w-4" />
                )}
                {result?.ok === false || error ? '重新生成' : '开始生成'}
              </Button>
              <Button
                disabled={!taskId || isStopping}
                onClick={() => void stopRun()}
                type="button"
                variant="secondary"
              >
                {isStopping ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Square className="mr-2 h-4 w-4" />
                )}
                停止查询
              </Button>
            </div>
          </aside>

          <section
            aria-label="视频运行与成果"
            className="rounded-md border bg-background p-5 shadow-sm"
          >
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-sm font-medium text-muted-foreground">运行反馈与输出</p>
                <h2 className="mt-1 text-lg font-semibold">本地 MP4 成果</h2>
              </div>
              {currentStatus ? (
                <Badge
                  className={
                    currentStatus === 'succeeded'
                      ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
                      : undefined
                  }
                  variant={
                    currentStatus === 'failed'
                      ? 'destructive'
                      : currentStatus === 'succeeded'
                        ? 'outline'
                        : 'secondary'
                  }
                >
                  {VIDEO_STATUS_STEPS.find((step) => step.status === currentStatus)?.label}
                </Badge>
              ) : null}
            </div>

            <section aria-label="视频运行状态" className="mt-5">
              <div className="grid grid-cols-4 gap-2 sm:grid-cols-8">
                {VIDEO_STATUS_STEPS.map((step) => {
                  const sequentialIndex = VIDEO_SEQUENTIAL_STATUSES.indexOf(step.status)
                  const isActive = currentStatus === step.status
                  const isComplete =
                    sequentialIndex >= 0 &&
                    currentSequentialIndex >= 0 &&
                    sequentialIndex < currentSequentialIndex
                  return (
                    <div
                      className={cn(
                        'flex h-9 items-center justify-center rounded-sm border px-1 text-[11px] font-medium',
                        isComplete && 'border-emerald-200 bg-emerald-50 text-emerald-800',
                        isActive &&
                          step.status === 'failed' &&
                          'border-red-300 bg-red-50 text-red-800',
                        isActive &&
                          step.status === 'stopped' &&
                          'border-amber-300 bg-amber-50 text-amber-900',
                        isActive &&
                          step.status === 'succeeded' &&
                          'border-emerald-300 bg-emerald-50 text-emerald-800',
                        isActive &&
                          step.status !== 'failed' &&
                          step.status !== 'stopped' &&
                          step.status !== 'succeeded' &&
                          'border-primary/30 bg-primary/10 text-primary',
                        !isActive && !isComplete && 'text-muted-foreground',
                      )}
                      key={step.status}
                    >
                      {step.label}
                    </div>
                  )
                })}
              </div>

              {progress ? (
                <output className="mt-4 block rounded-md border bg-muted/20 p-3 text-sm">
                  <div className="flex items-start gap-2">
                    {progress.status === 'succeeded' ? (
                      <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-700" />
                    ) : progress.status === 'failed' ? (
                      <CircleAlert className="mt-0.5 h-4 w-4 shrink-0 text-red-700" />
                    ) : progress.status === 'stopped' ? (
                      <CircleStop className="mt-0.5 h-4 w-4 shrink-0 text-amber-700" />
                    ) : progress.status === 'downloading' ? (
                      <Download className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                    ) : (
                      <Loader2 className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                    )}
                    <div className="min-w-0">
                      <p className="font-medium">{progress.message}</p>
                      <p className="mt-1 break-all text-xs text-muted-foreground">
                        task={progress.task_id}
                        {progress.taskStatus ? ` · status=${progress.taskStatus}` : ''}
                      </p>
                    </div>
                  </div>
                  {diagnosticsLogPath ? (
                    <Button
                      className="mt-3"
                      onClick={() => void openPath(diagnosticsLogPath)}
                      type="button"
                      variant="secondary"
                    >
                      <Terminal className="mr-2 h-4 w-4" />
                      打开诊断日志
                    </Button>
                  ) : null}
                </output>
              ) : (
                <div className="mt-4 rounded-md border border-dashed px-4 py-8 text-center text-sm text-muted-foreground">
                  提交任务后在这里显示云端状态和本地保存结果
                </div>
              )}
            </section>

            <div className="mt-5 border-t pt-5">
              {videoPath ? (
                <div className="space-y-3">
                  {/* biome-ignore lint/a11y/useMediaCaption: 本地预览视频没有独立字幕轨，首版只提供文件预览 */}
                  <video
                    className="aspect-video max-h-[420px] w-full rounded-sm border bg-black object-contain"
                    controls
                    src={localVideoSrc(videoPath)}
                  />
                  <div className="rounded-sm bg-muted px-3 py-2">
                    <p className="text-xs font-medium text-muted-foreground">保存路径</p>
                    <p className="mt-1 break-all text-xs">{videoPath}</p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      onClick={() => void openPath(videoPath)}
                      type="button"
                      variant="secondary"
                    >
                      <FolderOpen className="mr-2 h-4 w-4" />
                      打开目录
                    </Button>
                    <Button onClick={() => void copyVideoUrl()} type="button" variant="secondary">
                      <Copy className="mr-2 h-4 w-4" />
                      复制原始地址
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="flex min-h-48 items-center justify-center rounded-md bg-zinc-950 px-4 text-center text-sm text-zinc-400">
                  <div>
                    <FileVideo className="mx-auto mb-2 h-7 w-7" />
                    MP4 下载完成后显示本地预览
                  </div>
                </div>
              )}
            </div>

            {error ? (
              <div className="mt-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
                <div className="flex items-start gap-2">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                  <span>{error}</span>
                </div>
              </div>
            ) : null}

            {openMessage ? (
              <div className="mt-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
                {openMessage}
              </div>
            ) : null}
          </section>
        </div>
      </div>

      <Dialog onOpenChange={setIsLogOpen} open={isLogOpen}>
        <DialogContent className="max-w-4xl">
          <DialogHeader>
            <DialogTitle>视频生成日志</DialogTitle>
            <DialogDescription>只保留最近 1000 条，应用重启后清空。</DialogDescription>
          </DialogHeader>
          <div className="flex justify-end">
            <Button onClick={() => setLogs([])} type="button" variant="ghost">
              <Trash2 className="mr-2 h-4 w-4" />
              清空日志
            </Button>
          </div>
          <ScrollArea className="h-[480px] rounded-md border bg-zinc-950 p-3 text-xs text-zinc-100">
            <div ref={logViewportRef}>
              {logs.length === 0 ? (
                <div className="text-zinc-500">暂无日志</div>
              ) : (
                logs.map((entry) => (
                  <div className="whitespace-pre-wrap break-all font-mono leading-6" key={entry.id}>
                    {formatVideoDebugLogLine(entry)}
                  </div>
                ))
              )}
            </div>
          </ScrollArea>
        </DialogContent>
      </Dialog>
    </section>
  )
}

function localVideoSrc(path: string) {
  return pathToFileUrl(path)
}

function pathToFileUrl(path: string) {
  const normalized = path.replace(/\\/g, '/')
  return normalized.startsWith('/') ? `file://${normalized}` : `file:///${normalized}`
}
