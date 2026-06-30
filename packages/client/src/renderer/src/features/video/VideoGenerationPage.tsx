import { localImageUrl } from '@/components/detection-image-url'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
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
import {
  AlertTriangle,
  Copy,
  FolderOpen,
  Loader2,
  Play,
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
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold">视频生成</h1>
          <p className="text-sm text-muted-foreground">
            只生成 1 个 MP4，结果自动保存到 05-视频工作区。
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

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.2fr)_minmax(340px,0.8fr)]">
        <Card>
          <CardHeader>
            <CardTitle>输入</CardTitle>
            <CardDescription>图生视频用 1 张首帧图，参考生视频用 1-9 张参考图。</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <Tabs onValueChange={(value) => setMode(value as VideoGenerationMode)} value={mode}>
              <TabsList>
                <TabsTrigger value="image-to-video">图生视频</TabsTrigger>
                <TabsTrigger value="reference-to-video">参考生视频</TabsTrigger>
              </TabsList>
              <TabsContent className="space-y-4" value="image-to-video">
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
                  选择首帧图
                </Button>
              </TabsContent>
              <TabsContent className="space-y-4" value="reference-to-video">
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
                  选择参考图
                </Button>
              </TabsContent>
            </Tabs>

            <div className="grid gap-3 md:grid-cols-2">
              {images.map((image, index) => (
                <div className="rounded-md border bg-muted/20 p-3" key={image.path}>
                  <div className="mb-2 aspect-[4/3] overflow-hidden rounded-sm border bg-white">
                    <img
                      alt={image.name}
                      className="h-full w-full object-cover"
                      src={localImageUrl(image.path)}
                    />
                  </div>
                  <div className="space-y-1 text-sm">
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
                      <div className="font-medium">{image.name}</div>
                    </div>
                    <div className="break-all text-xs text-muted-foreground">{image.path}</div>
                  </div>
                  <Button
                    className="mt-3 w-full"
                    onClick={() => removeImage(image.path)}
                    type="button"
                    variant="ghost"
                  >
                    <Trash2 className="mr-2 h-4 w-4" />
                    删除
                  </Button>
                </div>
              ))}
            </div>

            <label className="grid gap-2 text-sm font-medium" htmlFor="video-prompt">
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
                        ? '例如：输入 @ 选图，或直接点下面编号插入'
                        : '例如：让产品缓慢旋转，镜头轻微推进'
                    }
                    ref={promptTextareaRef}
                    rows={4}
                    value={prompt}
                  />
                  {isMentionOpen ? (
                    <div className="absolute inset-x-0 top-full z-20 mt-2 rounded-md border bg-white p-1 shadow-lg">
                      {mentionOptions.map((option, index) => (
                        <button
                          className={`flex w-full items-center justify-between rounded-sm px-3 py-2 text-left text-sm ${
                            index === activeMentionIndex ? 'bg-muted' : 'hover:bg-muted/70'
                          }`}
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
                {mode === 'reference-to-video' ? (
                  <p className="text-xs text-muted-foreground">
                    上传后会自动编号。点编号可插入到提示词，输入{' '}
                    <span className="font-medium">@</span> 也能选图。
                  </p>
                ) : null}
              </div>
            </label>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>参数与运行</CardTitle>
            <CardDescription>视频生成通常需要 1-5 分钟，停止查询不会取消云端任务。</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-2 text-sm font-medium">
              <span>模型版本</span>
              <Select
                onValueChange={(value) => setModelVersion(value as HappyHorseVersion)}
                value={modelVersion}
              >
                <SelectTrigger>
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
                <SelectTrigger>
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
                <SelectTrigger>
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
                <Select onValueChange={(value) => setRatio(value as HappyHorseRatio)} value={ratio}>
                  <SelectTrigger>
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

            <label className="grid gap-2 text-sm font-medium" htmlFor="video-task-name">
              <span>任务名</span>
              <Input
                id="video-task-name"
                onChange={(event) => setTaskName(event.target.value)}
                placeholder="留空则自动使用时间"
                value={taskName}
              />
            </label>

            <div className="flex items-center gap-2 text-sm font-medium">
              <Checkbox
                checked={watermark}
                onCheckedChange={(checked) => setWatermark(checked === true)}
              />
              添加水印
            </div>

            <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
              可能产生百炼费用；停止查询不会取消云端任务，云端可能继续运行并计费。
            </div>

            <div className="flex gap-2">
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

            {progress ? (
              <div className="rounded-md border bg-muted/20 p-3 text-sm">
                <div className="font-medium">{progress.message}</div>
                <div className="mt-1 break-all text-xs text-muted-foreground">
                  task={progress.task_id}
                  {progress.taskStatus ? ` · status=${progress.taskStatus}` : ''}
                </div>
                {progress.diagnosticsLogPath ? (
                  <div className="mt-1 break-all text-xs text-muted-foreground">
                    diagnostics: {progress.diagnosticsLogPath}
                  </div>
                ) : null}
              </div>
            ) : null}

            {videoPath ? (
              <div className="space-y-3 rounded-md border bg-muted/20 p-3">
                {/* biome-ignore lint/a11y/useMediaCaption: 本地预览视频没有独立字幕轨，首版只提供文件预览 */}
                <video
                  className="w-full rounded-sm border bg-black"
                  controls
                  src={localVideoSrc(videoPath)}
                />
                <div className="break-all text-xs text-muted-foreground">{videoPath}</div>
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
                    复制 video_url
                  </Button>
                </div>
              </div>
            ) : null}

            {error ? (
              <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
                <div className="flex items-start gap-2">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                  <span>{error}</span>
                </div>
              </div>
            ) : null}

            {openMessage ? (
              <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
                {openMessage}
              </div>
            ) : null}
          </CardContent>
        </Card>
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
    </div>
  )
}

function localVideoSrc(path: string) {
  return pathToFileUrl(path)
}

function pathToFileUrl(path: string) {
  const normalized = path.replace(/\\/g, '/')
  return normalized.startsWith('/') ? `file://${normalized}` : `file:///${normalized}`
}
