import { DirectoryPicker } from '@/components/directory-picker'
import { Button } from '@/components/ui/button'
import type { PhotoshopProgressInfo, PhotoshopStatus, PsdTemplate } from '@tengyu-aipod/shared'
import {
  AlertTriangle,
  ExternalLink,
  ImageIcon,
  PlayCircle,
  RefreshCw,
  Settings2,
} from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'

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
  const [printFolder, setPrintFolder] = useState('04-待套版印花')
  const [outputDir, setOutputDir] = useState('05-货号成品')
  const [templatePaths, setTemplatePaths] = useState<string[]>([])
  const [replaceRange, setReplaceRange] = useState<'auto' | 'top' | 'all'>('auto')
  const [clipMode, setClipMode] = useState<'auto' | 'guides' | 'none'>('auto')
  const [format, setFormat] = useState<'jpg' | 'png'>('jpg')
  const [maxRetries, setMaxRetries] = useState(1)
  const [resultFilter, setResultFilter] = useState<(typeof resultFilters)[number]['key']>('all')
  const [progress, setProgress] = useState<PhotoshopProgressInfo | null>(null)
  const [scannedTemplates, setScannedTemplates] = useState<PsdTemplate[]>([])
  const [message, setMessage] = useState('请选择印花文件夹和 PSD/PSB 模板')
  const [running, setRunning] = useState(false)
  const isMac = navigator.platform.toLowerCase().includes('mac')
  const percent = progressPercent(progress)
  const estimatedGroups = templatePaths.length
  const estimatedOutputs = scannedTemplates.reduce(
    (count, item) => count + item.clip_areas.length,
    0,
  )

  useEffect(() => {
    return window.api.photoshop.onProgress((nextProgress) => {
      setProgress(nextProgress)
    })
  }, [])

  async function chooseTemplates() {
    const result = await window.api.photoshop.chooseTemplates()
    if (result.ok) {
      setTemplatePaths(result.data.paths)
      setScannedTemplates([])
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
      <PhotoshopStatusBar />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="grid gap-6 lg:grid-cols-2">
          <div className="rounded-md border bg-background p-5 shadow-sm">
            <p className="text-sm font-medium text-muted-foreground">印花文件夹</p>
            <h2 className="mt-1 text-lg font-semibold">待套版印花</h2>
            <label className="mt-4 block space-y-2 text-sm font-medium" htmlFor="ps-print-folder">
              <span className="flex items-center gap-2">
                <ImageIcon className="h-4 w-4" />
                输入目录
              </span>
              <DirectoryPicker
                id="ps-print-folder"
                onChange={setPrintFolder}
                showOpen={false}
                title="选择印花输入目录"
                value={printFolder}
              />
            </label>
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
            <h2 className="mt-1 text-lg font-semibold">货号成品保存位置</h2>
            <div className="mt-4 flex gap-2">
              <input
                className="h-10 min-w-0 flex-1 rounded-md border px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-primary"
                onChange={(event) => setOutputDir(event.target.value)}
                value={outputDir}
              />
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
              当前版本仅展示目录配置，真实套版执行入口后续接入。
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
          <div className="max-w-sm">
            <ImageIcon className="mx-auto h-8 w-8 text-muted-foreground" />
            <p className="mt-3 text-sm font-medium">暂无套版结果</p>
            <p className="mt-1 text-xs text-muted-foreground">
              扫描模板后可先确认裁切区域；批量套版执行接入后，这里会显示输出缩略图。
            </p>
          </div>
        </div>
      </section>
    </div>
  )
}
