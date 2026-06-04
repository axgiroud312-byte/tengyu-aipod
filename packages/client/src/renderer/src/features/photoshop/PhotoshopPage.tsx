import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { ScrollArea } from '@/components/ui/scroll-area'
import type {
  PhotoshopBatchResult,
  PhotoshopOutputLayout,
  PhotoshopProgressInfo,
  PhotoshopProgressLogEntry,
  PhotoshopStatus,
  PsdTemplate,
} from '@tengyu-aipod/shared'
import {
  AlertTriangle,
  ExternalLink,
  FolderOpen,
  ImageIcon,
  PlayCircle,
  RefreshCw,
  Settings2,
  Terminal,
} from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { PhotoshopPrintFolderScan } from '../../../../main/photoshop/print-folder'
import { formatPhotoshopDebugLogLine, photoshopDebugLogLevelCounts } from './photoshop-debug-log'

function statusLabel(status: PhotoshopStatus | null) {
  if (!status) {
    return '检测中'
  }
  if (status.com_connected) {
    return `已连接${status.version ? ` · 版本 ${status.version}` : ''}`
  }
  if (status.running) {
    return '运行中 · COM 未连接'
  }
  if (status.installed) {
    return '已安装 · 未启动'
  }
  return '仅支持 Windows / 未安装'
}

function statusTone(status: PhotoshopStatus | null) {
  if (!status) {
    return 'border-border bg-muted text-muted-foreground'
  }
  if (status.com_connected) {
    return 'border-emerald-200 bg-emerald-50 text-emerald-800'
  }
  if (status.running || status.installed) {
    return 'border-amber-200 bg-amber-50 text-amber-900'
  }
  return 'border-red-200 bg-red-50 text-red-800'
}

function statusDot(status: PhotoshopStatus | null) {
  if (!status) {
    return 'bg-muted-foreground'
  }
  if (status.com_connected) {
    return 'bg-emerald-500'
  }
  if (status.running || status.installed) {
    return 'bg-amber-500'
  }
  return 'bg-red-500'
}

function templateLabel(path: string) {
  return path.split(/[\\/]/).pop() ?? path
}

function progressPercent(progress: PhotoshopProgressInfo | null) {
  if (!progress || progress.total_groups <= 0) {
    return 0
  }
  return Math.round(((progress.completed + progress.skipped) / progress.total_groups) * 100)
}

function timestampSlug(value: number) {
  const date = new Date(value)
  const pad = (item: number) => String(item).padStart(2, '0')
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`
}

function joinLocalPath(root: string, ...parts: string[]) {
  const separator = root.includes('\\') ? '\\' : '/'
  return [root.replace(/[\\/]+$/, ''), ...parts].join(separator)
}

function localImageUrl(path: string) {
  return `tengyu-local-image://image/${encodeURIComponent(path)}`
}

function photoshopDebugLogLevelClassName(level: PhotoshopProgressLogEntry['level']) {
  if (level === 'error') {
    return 'break-all whitespace-pre-wrap text-red-300'
  }
  if (level === 'warn') {
    return 'break-all whitespace-pre-wrap text-amber-200'
  }
  return 'break-all whitespace-pre-wrap text-zinc-100'
}

const resultFilters = [
  { key: 'all', label: '全部' },
  { key: 'done', label: '完成' },
  { key: 'failed', label: '失败' },
  { key: 'skipped', label: '跳过' },
] as const

function PhotoshopStatusBar() {
  const [status, setStatus] = useState<PhotoshopStatus | null>(null)
  const [checking, setChecking] = useState(false)

  const refreshStatus = useCallback(async () => {
    setChecking(true)
    try {
      const nextStatus = await window.api.photoshop.getStatus()
      setStatus(nextStatus)
    } finally {
      setChecking(false)
    }
  }, [])

  useEffect(() => {
    void refreshStatus()
    const timer = window.setInterval(() => {
      void refreshStatus()
    }, 30_000)

    return () => window.clearInterval(timer)
  }, [refreshStatus])

  return (
    <div className={`rounded-md border px-4 py-3 text-sm ${statusTone(status)}`}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${statusDot(status)}`} />
          <div className="min-w-0">
            <p className="font-medium">Photoshop 状态：{statusLabel(status)}</p>
            {status?.error_message ? (
              <p className="truncate text-xs opacity-80">{status.error_message}</p>
            ) : null}
          </div>
        </div>
        <Button
          className="h-8 shrink-0 px-3"
          disabled={checking}
          onClick={() => void refreshStatus()}
          type="button"
          variant="secondary"
        >
          <RefreshCw className="mr-2 h-3.5 w-3.5" />
          刷新
        </Button>
      </div>
    </div>
  )
}

export function PhotoshopPage() {
  const [skipCompleted, setSkipCompleted] = useState(true)
  const [outputLayout, setOutputLayout] = useState<PhotoshopOutputLayout>('template_first')
  const [printFolder, setPrintFolder] = useState('02-印花工作区')
  const [outputDir, setOutputDir] = useState(`04-上架工作区/套版-${timestampSlug(Date.now())}`)
  const [printScan, setPrintScan] = useState<PhotoshopPrintFolderScan | null>(null)
  const [loadingPrints, setLoadingPrints] = useState(false)
  const [templatePaths, setTemplatePaths] = useState<string[]>([])
  const [replaceRange, setReplaceRange] = useState<'auto' | 'top' | 'all'>('auto')
  const [clipMode, setClipMode] = useState<'auto' | 'guides' | 'none'>('auto')
  const [format, setFormat] = useState<'jpg' | 'png'>('jpg')
  const [maxRetries, setMaxRetries] = useState(1)
  const [resultFilter, setResultFilter] = useState<(typeof resultFilters)[number]['key']>('all')
  const [progress, setProgress] = useState<PhotoshopProgressInfo | null>(null)
  const [debugLogs, setDebugLogs] = useState<PhotoshopProgressLogEntry[]>([])
  const [isDebugLogOpen, setIsDebugLogOpen] = useState(false)
  const [batchResult, setBatchResult] = useState<PhotoshopBatchResult | null>(null)
  const [currentTaskId, setCurrentTaskId] = useState<string | null>(null)
  const [scannedTemplates, setScannedTemplates] = useState<PsdTemplate[]>([])
  const [message, setMessage] = useState('请选择印花文件夹和 PSD/PSB 模板')
  const [running, setRunning] = useState(false)
  const isMac = navigator.platform.toLowerCase().includes('mac')
  const debugLogEndRef = useRef<HTMLDivElement | null>(null)
  const percent = progressPercent(progress)
  const logCounts = photoshopDebugLogLevelCounts(debugLogs)
  const debugIssueCount = logCounts.warn + logCounts.error
  const printAssets = printScan?.prints ?? []
  const estimatedGroups =
    scannedTemplates.length > 0
      ? scannedTemplates.reduce(
          (count, template) =>
            count + Math.ceil(printAssets.length / Math.max(template.representative_so_count, 1)),
          0,
        )
      : templatePaths.length * printAssets.length
  const estimatedOutputs = scannedTemplates.reduce(
    (count, item) => count + item.clip_areas.length,
    0,
  )

  useEffect(() => {
    return window.api.photoshop.onProgress((nextProgress) => {
      setProgress(nextProgress)
      setCurrentTaskId(nextProgress.task_id)
    })
  }, [])

  useEffect(() => {
    return window.api.photoshop.onLog((entry) => {
      if (entry.task_id) {
        setCurrentTaskId(entry.task_id)
      }
      setDebugLogs((current) => [...current, entry].slice(-1000))
    })
  }, [])

  useEffect(() => {
    if (isDebugLogOpen && debugLogs.length > 0) {
      debugLogEndRef.current?.scrollIntoView({ block: 'end' })
    }
  }, [debugLogs.length, isDebugLogOpen])

  useEffect(() => {
    window.api.workspace
      .getState()
      .then((workspace) => {
        if (!workspace.root) {
          return
        }
        const nextPrintFolder = joinLocalPath(workspace.root, '02-印花工作区')
        setPrintFolder(nextPrintFolder)
        setOutputDir(
          joinLocalPath(workspace.root, '04-上架工作区', `套版-${timestampSlug(Date.now())}`),
        )
        void loadPrintFolder(nextPrintFolder)
      })
      .catch(() => null)
  }, [])

  async function loadPrintFolder(folder = printFolder) {
    if (!folder.trim()) {
      setPrintScan(null)
      return
    }
    setLoadingPrints(true)
    try {
      const scan = await window.api.photoshop.scanPrintFolder({ folder })
      setPrintScan(scan)
      setMessage(`已检索到 ${scan.prints.length} 张印花`)
    } catch (error) {
      setPrintScan(null)
      setMessage(error instanceof Error ? error.message : String(error))
    } finally {
      setLoadingPrints(false)
    }
  }

  async function choosePrintFolder() {
    const result = await window.api.photoshop.choosePrintFolder()
    if (result.ok) {
      setPrintFolder(result.data.path)
      await loadPrintFolder(result.data.path)
    }
  }

  async function chooseTemplates() {
    const result = await window.api.photoshop.chooseTemplates()
    if (result.ok) {
      setTemplatePaths(result.data.paths)
      setScannedTemplates([])
    }
  }

  async function chooseOutputFolder() {
    const result = await window.api.photoshop.chooseOutputFolder()
    if (result.ok) {
      setOutputDir(result.data.path)
    }
  }

  async function scanTemplates() {
    setRunning(true)
    setMessage('正在扫描模板...')
    setProgress({
      task_id: 'ui-preview',
      total_groups: Math.max(templatePaths.length, 1),
      completed: 0,
      failed: 0,
      skipped: 0,
      current_group: null,
      current_stage: 'task_start',
      verified_outputs: 0,
    })
    try {
      const templates: PsdTemplate[] = []
      for (let index = 0; index < templatePaths.length; index += 1) {
        const template = await window.api.photoshop.scanTemplate({
          psd_path: templatePaths[index] ?? '',
        })
        templates.push(template)
        setProgress({
          task_id: 'ui-preview',
          total_groups: templatePaths.length,
          completed: index + 1,
          failed: 0,
          skipped: 0,
          current_group: index,
          current_stage: 'group_complete',
          verified_outputs: templates.reduce((count, item) => count + item.clip_areas.length, 0),
        })
      }
      setScannedTemplates(templates)
      setMessage('模板已扫描，套版执行会沿用这些参数')
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error))
      setProgress((current) =>
        current
          ? { ...current, failed: current.failed + 1, current_stage: 'group_complete' }
          : null,
      )
    } finally {
      setRunning(false)
    }
  }

  async function runPhotoshopBatch() {
    setRunning(true)
    setMessage('正在执行套版...')
    setDebugLogs([])
    setBatchResult(null)
    try {
      const scan = await window.api.photoshop.scanPrintFolder({ folder: printFolder })
      setPrintScan(scan)
      if (scan.prints.length === 0) {
        throw new Error('印花文件夹内没有可套版图片')
      }
      const result = await window.api.photoshop.runBatch({
        print_folder: printFolder,
        templates: templatePaths,
        replace_range: replaceRange,
        output_layout: outputLayout,
        format,
        clip_mode: clipMode,
        skip_completed: skipCompleted,
        max_retries: maxRetries,
        output_root: outputDir,
      })
      setBatchResult(result)
      setCurrentTaskId(result.task_id)
      setMessage(
        result.cancelled
          ? `套版已取消：已输出 ${result.outputs.length} 张成品图`
          : `套版完成：输出 ${result.outputs.length} 张成品图`,
      )
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error))
      setProgress((current) =>
        current
          ? { ...current, failed: current.failed + 1, current_stage: 'group_complete' }
          : null,
      )
    } finally {
      setRunning(false)
    }
  }

  async function cancelPhotoshopBatch() {
    if (!currentTaskId) {
      return
    }
    const result = await window.api.photoshop.cancel({ task_id: currentTaskId })
    setMessage(result.ok ? '已发送取消请求，当前组结束后停止' : '当前没有可取消的 PS 任务')
  }

  if (isMac) {
    return (
      <div className="space-y-6">
        <PhotoshopStatusBar />
        <div className="rounded-md border border-amber-200 bg-amber-50 p-6 text-amber-950 shadow-sm">
          <div className="flex items-start gap-3">
            <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" />
            <div>
              <h2 className="text-lg font-semibold">PS 套版仅 Windows 可用</h2>
              <p className="mt-1 text-sm">
                当前电脑不能执行 Photoshop COM 套版。你仍可查看配置结构，实际运行请切到 Windows
                电脑。
              </p>
            </div>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="rounded-md border bg-background p-5 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-sm font-medium text-muted-foreground">PS 套版</p>
            <h2 className="mt-1 text-xl font-semibold">模板批量套版与上架图输出</h2>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button onClick={() => setIsDebugLogOpen(true)} type="button" variant="secondary">
              <Terminal className="mr-2 h-4 w-4" />
              日志 {debugLogs.length}
              {debugIssueCount > 0 ? (
                <span className="ml-2 rounded bg-red-600 px-1.5 py-0.5 text-[10px] font-semibold text-white">
                  {debugIssueCount}
                </span>
              ) : null}
            </Button>
          </div>
        </div>
      </div>

      <PhotoshopStatusBar />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="grid gap-6 lg:grid-cols-2">
          <div className="rounded-md border bg-background p-5 shadow-sm">
            <p className="text-sm font-medium text-muted-foreground">印花文件夹</p>
            <h2 className="mt-1 text-lg font-semibold">套版输入图片</h2>
            <label className="mt-4 block space-y-2 text-sm font-medium">
              <span className="flex items-center gap-2">
                <ImageIcon className="h-4 w-4" />
                输入目录
              </span>
              <div className="flex gap-2">
                <input
                  className="h-10 min-w-0 flex-1 rounded-md border px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-primary"
                  onChange={(event) => setPrintFolder(event.target.value)}
                  value={printFolder}
                />
                <Button
                  className="h-10 px-3"
                  onClick={() => void choosePrintFolder()}
                  type="button"
                  variant="secondary"
                >
                  <FolderOpen className="h-4 w-4" />
                </Button>
              </div>
            </label>
          </div>

          <div className="rounded-md border bg-background p-5 shadow-sm">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-sm font-medium text-muted-foreground">套版候选清单</p>
                <h2 className="mt-1 text-lg font-semibold">输入目录印花</h2>
              </div>
              <Button
                disabled={loadingPrints}
                onClick={() => void loadPrintFolder()}
                type="button"
                variant="secondary"
              >
                <RefreshCw className="mr-2 h-4 w-4" />
                刷新
              </Button>
            </div>
            <div className="mt-4 grid gap-2">
              {printAssets.length ? (
                printAssets.slice(0, 6).map((candidate) => (
                  <div
                    className="grid grid-cols-[48px_minmax(0,1fr)] gap-3 rounded-md border bg-muted/30 p-2 text-left text-sm hover:bg-muted"
                    key={candidate.id}
                  >
                    <img
                      alt=""
                      className="h-12 w-12 rounded border object-cover"
                      src={candidate.thumbnail_url}
                    />
                    <span className="min-w-0">
                      <span className="block truncate font-medium">{candidate.id}</span>
                      <span className="mt-1 block truncate text-xs text-muted-foreground">
                        {candidate.file_path}
                      </span>
                    </span>
                  </div>
                ))
              ) : (
                <div className="rounded-md bg-muted px-3 py-8 text-center text-sm text-muted-foreground">
                  当前输入目录未找到图片
                </div>
              )}
              {printAssets.length > 6 ? (
                <p className="text-xs text-muted-foreground">
                  还有 {printAssets.length - 6} 张未显示
                </p>
              ) : null}
            </div>
          </div>

          <div className="rounded-md border bg-background p-5 shadow-sm">
            <p className="text-sm font-medium text-muted-foreground">PSD / PSB 模板</p>
            <h2 className="mt-1 text-lg font-semibold">多模板扫描</h2>
            <div className="mt-4 flex gap-2">
              <div className="min-h-10 min-w-0 flex-1 rounded-md border px-3 py-2 text-sm text-muted-foreground">
                {templatePaths.length > 0
                  ? templatePaths.map(templateLabel).join('，')
                  : '未选择模板'}
              </div>
              <Button onClick={() => void chooseTemplates()} type="button" variant="secondary">
                选择
              </Button>
            </div>
            <label className="mt-4 inline-flex items-center gap-2 rounded-md border px-3 py-2 text-sm font-medium">
              <input
                checked={skipCompleted}
                className="h-4 w-4"
                onChange={(event) => setSkipCompleted(event.target.checked)}
                type="checkbox"
              />
              跳过已完成
            </label>
            <label className="ml-2 mt-4 inline-flex items-center gap-2 rounded-md border px-3 py-2 text-sm font-medium">
              <input
                checked={outputLayout === 'sku_first'}
                className="h-4 w-4"
                onChange={(event) =>
                  setOutputLayout(event.target.checked ? 'sku_first' : 'template_first')
                }
                type="checkbox"
              />
              货号优先输出
            </label>
          </div>

          <div className="rounded-md border bg-background p-5 shadow-sm">
            <p className="text-sm font-medium text-muted-foreground">输出参数</p>
            <h2 className="mt-1 text-lg font-semibold">替换范围、裁切与格式</h2>
            <div className="mt-5 grid gap-4">
              <label className="space-y-2 text-sm font-medium">
                <span>替换范围</span>
                <select
                  className="h-10 w-full rounded-md border px-3"
                  onChange={(event) => setReplaceRange(event.target.value as typeof replaceRange)}
                  value={replaceRange}
                >
                  <option value="auto">自动识别</option>
                  <option value="top">顶层智能对象</option>
                  <option value="all">全部智能对象</option>
                </select>
              </label>
              <label className="space-y-2 text-sm font-medium">
                <span>裁切模式</span>
                <select
                  className="h-10 w-full rounded-md border px-3"
                  onChange={(event) => setClipMode(event.target.value as typeof clipMode)}
                  value={clipMode}
                >
                  <option value="auto">自动裁切</option>
                  <option value="guides">参考辅助线</option>
                  <option value="none">不裁切</option>
                </select>
              </label>
              <label className="space-y-2 text-sm font-medium">
                <span>导出格式</span>
                <select
                  className="h-10 w-full rounded-md border px-3"
                  onChange={(event) => setFormat(event.target.value as typeof format)}
                  value={format}
                >
                  <option value="jpg">JPG</option>
                  <option value="png">PNG</option>
                </select>
              </label>
              <label className="space-y-2 text-sm font-medium">
                <span>失败重试</span>
                <input
                  className="h-10 w-full rounded-md border px-3"
                  min={0}
                  max={5}
                  onChange={(event) => setMaxRetries(Number(event.target.value))}
                  type="number"
                  value={maxRetries}
                />
              </label>
            </div>
          </div>

          <div className="rounded-md border bg-background p-5 shadow-sm">
            <p className="text-sm font-medium text-muted-foreground">输出目录</p>
            <h2 className="mt-1 text-lg font-semibold">上架工作区保存位置</h2>
            <div className="mt-4 flex gap-2">
              <input
                className="h-10 min-w-0 flex-1 rounded-md border px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-primary"
                onChange={(event) => setOutputDir(event.target.value)}
                value={outputDir}
              />
              <Button
                className="h-10 px-3"
                onClick={() => void chooseOutputFolder()}
                type="button"
                variant="secondary"
              >
                <FolderOpen className="h-4 w-4" />
              </Button>
              <Button
                className="h-10 px-3"
                disabled={!outputDir.trim()}
                onClick={() => void window.api.photoshop.openPath(outputDir)}
                type="button"
                variant="secondary"
              >
                打开
              </Button>
            </div>
            <p className="mt-2 text-xs text-muted-foreground">
              默认是本次套版批次目录，可直接改成其他批次目录。
            </p>
          </div>
        </div>

        <aside className="space-y-5 lg:sticky lg:top-6 lg:self-start">
          <div className="rounded-md border bg-background p-5 shadow-sm">
            <p className="text-sm font-medium text-muted-foreground">预估</p>
            <h2 className="mt-1 text-lg font-semibold">准备套版</h2>
            <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
              <div className="rounded-md bg-muted p-3">
                <dt className="text-muted-foreground">模板数</dt>
                <dd className="mt-1 font-semibold">{templatePaths.length}</dd>
              </div>
              <div className="rounded-md bg-muted p-3">
                <dt className="text-muted-foreground">印花数</dt>
                <dd className="mt-1 font-semibold">{printAssets.length || '-'}</dd>
              </div>
              <div className="rounded-md bg-muted p-3">
                <dt className="text-muted-foreground">裁切数</dt>
                <dd className="mt-1 font-semibold">{estimatedOutputs || '-'}</dd>
              </div>
              <div className="rounded-md bg-muted p-3">
                <dt className="text-muted-foreground">任务组</dt>
                <dd className="mt-1 font-semibold">{estimatedGroups || '-'}</dd>
              </div>
              <div className="rounded-md bg-muted p-3">
                <dt className="text-muted-foreground">重试</dt>
                <dd className="mt-1 font-semibold">{maxRetries}</dd>
              </div>
            </dl>
            <Button
              className="mt-4 w-full"
              disabled={running || templatePaths.length === 0}
              onClick={() => void scanTemplates()}
              type="button"
            >
              <PlayCircle className="mr-2 h-4 w-4" />
              {running ? '扫描中...' : '扫描模板'}
            </Button>
            <Button
              className="mt-3 w-full"
              disabled={running || templatePaths.length === 0 || !printFolder.trim()}
              onClick={() => void runPhotoshopBatch()}
              type="button"
            >
              <PlayCircle className="mr-2 h-4 w-4" />
              {running ? '执行中...' : '开始套版'}
            </Button>
            <Button
              className="mt-3 w-full"
              disabled={!running || !currentTaskId}
              onClick={() => void cancelPhotoshopBatch()}
              type="button"
              variant="secondary"
            >
              取消套版
            </Button>
          </div>

          <div className="rounded-md border bg-background p-5 shadow-sm">
            <div className="flex items-center justify-between text-sm">
              <h2 className="text-lg font-semibold">进度</h2>
              <span>{percent}%</span>
            </div>
            <div className="mt-3 h-2 overflow-hidden rounded-full bg-muted">
              <div className="h-full bg-primary" style={{ width: `${percent}%` }} />
            </div>
            <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
              <div className="rounded-md bg-muted p-3">完成 {progress?.completed ?? 0}</div>
              <div className="rounded-md bg-muted p-3">失败 {progress?.failed ?? 0}</div>
              <div className="rounded-md bg-muted p-3">跳过 {progress?.skipped ?? 0}</div>
              <div className="rounded-md bg-muted p-3">输出 {progress?.verified_outputs ?? 0}</div>
            </div>
            <div className="mt-3 flex items-center gap-2 text-sm text-muted-foreground">
              <Settings2 className="h-4 w-4" />
              <span>{message}</span>
            </div>
          </div>

          <div className="rounded-md border bg-background p-5 shadow-sm">
            <h2 className="text-lg font-semibold">模板预览</h2>
            <div className="mt-3 grid grid-cols-2 gap-2">
              {scannedTemplates.length > 0 ? (
                scannedTemplates.map((template) => (
                  <button
                    className="rounded-md border p-2 text-left text-xs hover:bg-muted"
                    key={template.id}
                    onDoubleClick={() => void window.api.photoshop.openPath(template.file_path)}
                    type="button"
                  >
                    <span className="block truncate font-medium">
                      {templateLabel(template.file_path)}
                    </span>
                    <span className="mt-1 block text-muted-foreground">
                      {template.clip_areas.length} 张裁切
                    </span>
                    <ExternalLink className="mt-2 h-3.5 w-3.5 text-muted-foreground" />
                  </button>
                ))
              ) : (
                <div className="col-span-2 rounded-md bg-muted p-3 text-xs text-muted-foreground">
                  完成扫描后显示模板预览
                </div>
              )}
            </div>
          </div>

          <Button
            className="w-full"
            disabled={!outputDir.trim()}
            onClick={() => void window.api.photoshop.openPath(outputDir)}
            type="button"
            variant="secondary"
          >
            打开输出目录
          </Button>
        </aside>
      </div>

      <section className="rounded-md border bg-background p-5 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-sm font-medium text-muted-foreground">套版结果</p>
            <h2 className="mt-1 text-lg font-semibold">输出缩略图</h2>
          </div>
          <div className="flex rounded-md border bg-muted p-1">
            {resultFilters.map((filter) => (
              <button
                className={`rounded-sm px-3 py-1.5 text-sm font-medium ${
                  resultFilter === filter.key
                    ? 'bg-background text-foreground shadow-sm'
                    : 'text-muted-foreground'
                }`}
                key={filter.key}
                onClick={() => setResultFilter(filter.key)}
                type="button"
              >
                {filter.label}
              </button>
            ))}
          </div>
        </div>
        <div className="mt-4 flex min-h-40 items-center justify-center rounded-md border border-dashed bg-muted/40 p-6 text-center">
          {batchResult?.result_groups.length ? (
            <div className="grid w-full gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {batchResult.result_groups.map((group) => (
                <div
                  className="rounded-md border bg-background p-3 text-left shadow-sm"
                  key={`${group.template_id}-${group.group_index}-${group.sku_folder}`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold">{group.sku_folder}</p>
                      <p className="truncate text-xs text-muted-foreground">
                        {group.template_name} · {group.print_ids.join(', ')}
                      </p>
                    </div>
                    <Button
                      className="h-8 px-2"
                      onClick={() =>
                        void window.api.photoshop.openPath(group.outputs[0] ?? outputDir)
                      }
                      type="button"
                      variant="secondary"
                    >
                      <ExternalLink className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                  <div className="mt-3 grid grid-cols-3 gap-2">
                    {group.outputs.map((output) => (
                      <button
                        className="aspect-square overflow-hidden rounded border bg-muted"
                        key={output}
                        onDoubleClick={() => void window.api.photoshop.openPath(output)}
                        type="button"
                      >
                        <img
                          alt=""
                          className="h-full w-full object-cover"
                          src={localImageUrl(output)}
                        />
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="max-w-sm">
              <ImageIcon className="mx-auto h-8 w-8 text-muted-foreground" />
              <p className="mt-3 text-sm font-medium">暂无套版结果</p>
              <p className="mt-1 text-xs text-muted-foreground">套版完成后显示输出缩略图。</p>
            </div>
          )}
        </div>
      </section>

      <Dialog onOpenChange={setIsDebugLogOpen} open={isDebugLogOpen}>
        <DialogContent className="max-w-5xl gap-0 p-0">
          <DialogHeader className="border-b px-4 py-3 pr-12">
            <div className="flex items-center justify-between gap-3">
              <DialogTitle className="flex items-center gap-2 text-base">
                <Terminal className="h-4 w-4 text-primary" />
                PS 套版日志
              </DialogTitle>
              <div className="flex items-center gap-2">
                <Button
                  className="h-8 px-3"
                  disabled={!batchResult?.log_path}
                  onClick={() =>
                    batchResult?.log_path && window.api.photoshop.openPath(batchResult.log_path)
                  }
                  type="button"
                  variant="secondary"
                >
                  打开文件
                </Button>
                <Button
                  className="h-8 px-3"
                  disabled={!debugLogs.length}
                  onClick={() => setDebugLogs([])}
                  type="button"
                  variant="secondary"
                >
                  清空
                </Button>
              </div>
            </div>
          </DialogHeader>
          <div className="p-4">
            <ScrollArea className="h-[min(70vh,620px)] rounded-md border bg-zinc-950">
              <div className="space-y-1 p-3 font-mono text-[12px] leading-5">
                {debugLogs.length ? (
                  debugLogs.map((entry, index) => (
                    <div
                      className={photoshopDebugLogLevelClassName(entry.level)}
                      key={`${entry.ts}-${index}`}
                    >
                      {formatPhotoshopDebugLogLine(entry)}
                    </div>
                  ))
                ) : (
                  <div className="text-zinc-500">暂无日志</div>
                )}
                <div ref={debugLogEndRef} />
              </div>
            </ScrollArea>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
