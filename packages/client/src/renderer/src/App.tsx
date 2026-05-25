import { Button } from '@/components/ui/button'
import { initializeActivationStore, useActivationStore } from '@/store/activation'
import type {
  ActivationBadgeState,
  PhotoshopProgressInfo,
  PhotoshopStatus,
  PsdTemplate,
} from '@tengyu-aipod/shared'
import { APP_VERSION } from '@tengyu-aipod/shared'
import {
  AlertTriangle,
  Calculator,
  CheckCircle2,
  ExternalLink,
  FileStack,
  FolderOpen,
  ImageIcon,
  KeyRound,
  Loader2,
  MonitorCheck,
  Play,
  PlayCircle,
  RefreshCw,
  RotateCcw,
  Settings2,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import type { CollectionRecordRow } from '../../main/lib/collection-record-store'
import type { CollectionSession } from '../../main/lib/collection-session-manager'
import type { CollectionSessionEvent } from '../../main/lib/collection-session-manager'
import type {
  TitleBatchConfig,
  TitleBatchResult,
  TitleProgress,
  TitleTaskEvent,
} from '../../main/lib/title-service'
import { DetectionWorkbench } from './components/detection-workbench'
import { GenerationWorkbench } from './components/generation-workbench'
import { ListingWorkbench } from './components/listing-workbench'

type OnboardingStep = 1 | 2 | 3 | 4
type WorkbenchModule = 'collection' | 'title' | 'generation' | 'detection' | 'listing' | 'ps'
type TitleExistingStrategy = NonNullable<TitleBatchConfig['existingStrategy']>
type PendingCollectionSku = Extract<CollectionSessionEvent, { type: 'sku-required' }>

const apiKeyFields = [
  { key: 'chenyu', label: '晨羽智云 API Key', placeholder: '用于 ComfyUI 生图' },
  { key: 'grsai', label: 'Grsai API Key', placeholder: '用于付费生图' },
  { key: 'bailian', label: '阿里云百炼 API Key', placeholder: '用于检测和标题' },
  { key: 'bit_browser_url', label: '比特浏览器地址', placeholder: '127.0.0.1:54345' },
]

const titleModelPrices: Record<string, { input: number; output: number }> = {
  'qwen3-vl-flash': { input: 0.15, output: 1.5 },
  'qwen3-vl-plus': { input: 1, output: 10 },
  'qwen-vl-max': { input: 1.6, output: 4 },
}

const COLLECTION_SKU_PROMPT_COLLAPSE_MS = 120_000

function normalizeActivationCode(value: string) {
  return value
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, 16)
    .replace(/(.{4})(?=.)/g, '$1-')
}

function defaultDeviceName() {
  return `我的${navigator.platform.includes('Mac') ? 'Mac' : '工作电脑'}`
}

function formatStatusTime(timestamp: number | null) {
  if (!timestamp) {
    return '未同步'
  }

  const date = new Date(timestamp)
  return `${date.toLocaleDateString('zh-CN')} ${date.toLocaleTimeString('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
  })}`
}

function statusToneClassName(tone: ActivationBadgeState['tone']) {
  switch (tone) {
    case 'green':
      return 'border-emerald-200 bg-emerald-50 text-emerald-800'
    case 'yellow':
      return 'border-amber-200 bg-amber-50 text-amber-900'
    case 'red':
      return 'border-red-200 bg-red-50 text-red-800'
    default:
      return 'border-border bg-muted text-muted-foreground'
  }
}

function statusDotClassName(tone: ActivationBadgeState['tone']) {
  switch (tone) {
    case 'green':
      return 'bg-emerald-500'
    case 'yellow':
      return 'bg-amber-500'
    case 'red':
      return 'bg-red-500'
    default:
      return 'bg-muted-foreground'
  }
}

function parsePositiveNumber(value: string, fallback: number) {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

function parseNonNegativeNumber(value: string, fallback: number) {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback
}

function estimateTitleCost(imageCount: number, model: string, compression: boolean) {
  const price = titleModelPrices[model] ?? { input: 1, output: 10 }
  const imageTokens = compression ? 256 : 1024
  const outputTokens = 80
  return (imageCount * (imageTokens * price.input + outputTokens * price.output)) / 1_000_000
}

function progressPercent(progress: TitleProgress | null) {
  if (!progress || progress.total === 0) {
    return 0
  }
  return Math.round((progress.processed / progress.total) * 100)
}

function collectionStatusLabel(status: CollectionRecordRow['status']) {
  switch (status) {
    case 'success':
      return '成功'
    case 'skipped':
      return '跳过'
    default:
      return '失败'
  }
}

function collectionStatusClassName(status: CollectionRecordRow['status']) {
  switch (status) {
    case 'success':
      return 'text-emerald-700'
    case 'skipped':
      return 'text-amber-700'
    default:
      return 'text-red-700'
  }
}

function fileNameFromPath(path: string | null | undefined) {
  if (!path) {
    return '未保存'
  }
  return path.split(/[\\/]/).at(-1) || path
}

function moduleTitle(module: WorkbenchModule) {
  switch (module) {
    case 'collection':
      return '采集模块'
    case 'title':
      return '标题生成模块'
    case 'generation':
      return '生图模块'
    case 'ps':
      return 'PS 套版模块'
    case 'listing':
      return '上架模块'
    default:
      return '侵权检测模块'
  }
}

function moduleDescription(module: WorkbenchModule) {
  switch (module) {
    case 'collection':
      return '查看当前采集会话的保存记录和失败重试'
    case 'title':
      return '从货号成品图批量生成跨境标题'
    case 'generation':
      return '按文生图、图生图、提取、抠图组织生产路径'
    case 'ps':
      return '扫描 PSD 模板并准备 Photoshop 套版执行'
    case 'listing':
      return '批量操作店小秘草稿并保留真实页面证据'
    default:
      return '批量检测印花风险并流转结果'
  }
}

function photoshopStatusLabel(status: PhotoshopStatus | null) {
  if (!status) {
    return '检测中'
  }
  if (status.com_connected) {
    return `已连接${status.version ? ` · v${status.version}` : ''}`
  }
  if (status.running) {
    return '运行中 · COM 未连接'
  }
  if (status.installed) {
    return '已安装 · 未启动'
  }
  return '仅支持 Windows / 未安装'
}

function photoshopStatusTone(status: PhotoshopStatus | null) {
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

function photoshopStatusDot(status: PhotoshopStatus | null) {
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
    <div
      className={`flex items-center justify-between gap-3 rounded-md border px-4 py-3 text-sm ${photoshopStatusTone(
        status,
      )}`}
    >
      <div className="flex min-w-0 items-center gap-2">
        <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${photoshopStatusDot(status)}`} />
        <div className="min-w-0">
          <p className="font-medium">Photoshop 状态：{photoshopStatusLabel(status)}</p>
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
        刷新状态
      </Button>
    </div>
  )
}

function templateLabel(path: string) {
  return path.split(/[\\/]/).pop() ?? path
}

function photoshopProgressPercent(progress: PhotoshopProgressInfo | null) {
  if (!progress || progress.total_groups <= 0) {
    return 0
  }
  return Math.round(((progress.completed + progress.skipped) / progress.total_groups) * 100)
}

function PhotoshopMockupPanel() {
  const [skipCompleted, setSkipCompleted] = useState(true)
  const [printFolder, setPrintFolder] = useState('04-待套版印花')
  const [templatePaths, setTemplatePaths] = useState<string[]>([])
  const [replaceRange, setReplaceRange] = useState<'auto' | 'top' | 'all'>('auto')
  const [clipMode, setClipMode] = useState<'auto' | 'guides' | 'none'>('auto')
  const [format, setFormat] = useState<'jpg' | 'png'>('jpg')
  const [maxRetries, setMaxRetries] = useState(1)
  const [progress, setProgress] = useState<PhotoshopProgressInfo | null>(null)
  const [scannedTemplates, setScannedTemplates] = useState<PsdTemplate[]>([])
  const [message, setMessage] = useState('请选择印花文件夹和 PSD/PSB 模板')
  const [running, setRunning] = useState(false)
  const isMac = navigator.platform.toLowerCase().includes('mac')

  useEffect(() => {
    return window.api.photoshop.onProgress((nextProgress) => {
      setProgress(nextProgress)
    })
  }, [])

  async function choosePrintFolder() {
    const result = await window.api.photoshop.choosePrintFolder()
    if (result.ok) {
      setPrintFolder(result.data.path)
    }
  }

  async function chooseTemplates() {
    const result = await window.api.photoshop.chooseTemplates()
    if (result.ok) {
      setTemplatePaths(result.data.paths)
      setScannedTemplates([])
    }
  }

  async function prepareMockups() {
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
      setMessage('模板已扫描，执行入口将在全链路任务中接入')
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
      <div className="rounded-md border border-amber-200 bg-amber-50 p-4 text-amber-950">
        <div className="flex items-start gap-3">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" />
          <div>
            <h2 className="text-base font-semibold tracking-normal">PS 套版仅 Windows 可用</h2>
            <p className="mt-1 text-sm">请在 Windows 电脑使用 Photoshop COM 套版功能。</p>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-4 rounded-md border p-4">
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-1">
          <h2 className="text-base font-semibold tracking-normal">PS 套版</h2>
          <p className="text-sm text-muted-foreground">选择印花、模板和导出策略</p>
        </div>
        <label className="flex shrink-0 items-center gap-2 text-sm font-medium">
          <input
            checked={skipCompleted}
            className="h-4 w-4"
            onChange={(event) => setSkipCompleted(event.target.checked)}
            type="checkbox"
          />
          跳过已完成
        </label>
      </div>

      <div className="grid gap-3 lg:grid-cols-[1fr_1fr]">
        <label className="space-y-2 text-sm font-medium">
          <span className="flex items-center gap-2">
            <ImageIcon className="h-4 w-4" />
            印花文件夹
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

        <div className="space-y-2 text-sm font-medium">
          <span className="flex items-center gap-2">
            <FileStack className="h-4 w-4" />
            PSD/PSB 模板
          </span>
          <div className="flex gap-2">
            <div className="min-h-10 min-w-0 flex-1 rounded-md border px-3 py-2 text-sm text-muted-foreground">
              {templatePaths.length > 0
                ? templatePaths.map(templateLabel).join('，')
                : '未选择模板'}
            </div>
            <Button
              className="h-10 px-3"
              onClick={() => void chooseTemplates()}
              type="button"
              variant="secondary"
            >
              选择
            </Button>
          </div>
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-5">
        <label className="space-y-2 text-sm font-medium">
          <span>替换范围</span>
          <select
            className="h-10 w-full rounded-md border px-3"
            onChange={(event) => setReplaceRange(event.target.value as typeof replaceRange)}
            value={replaceRange}
          >
            <option value="auto">auto</option>
            <option value="top">top</option>
            <option value="all">all</option>
          </select>
        </label>
        <label className="space-y-2 text-sm font-medium">
          <span>适配方式</span>
          <select className="h-10 w-full rounded-md border px-3" disabled value="fit">
            <option value="fit">fit</option>
          </select>
        </label>
        <label className="space-y-2 text-sm font-medium">
          <span>裁切模式</span>
          <select
            className="h-10 w-full rounded-md border px-3"
            onChange={(event) => setClipMode(event.target.value as typeof clipMode)}
            value={clipMode}
          >
            <option value="auto">auto</option>
            <option value="guides">guides</option>
            <option value="none">none</option>
          </select>
        </label>
        <label className="space-y-2 text-sm font-medium">
          <span>格式</span>
          <select
            className="h-10 w-full rounded-md border px-3"
            onChange={(event) => setFormat(event.target.value as typeof format)}
            value={format}
          >
            <option value="jpg">jpg</option>
            <option value="png">png</option>
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

      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Settings2 className="h-4 w-4" />
          <span>{message}</span>
        </div>
        <Button
          disabled={running || templatePaths.length === 0}
          onClick={() => void prepareMockups()}
          type="button"
        >
          <PlayCircle className="mr-2 h-4 w-4" />
          {running ? '处理中...' : '开始套版'}
        </Button>
      </div>

      <div className="grid gap-4 lg:grid-cols-[1fr_280px]">
          <div className="rounded-md bg-muted p-4">
          <div className="flex items-center justify-between text-sm">
            <span className="font-medium">执行进度</span>
            <span>{photoshopProgressPercent(progress)}%</span>
          </div>
          <div className="mt-3 h-2 overflow-hidden rounded-full bg-background">
            <div
              className="h-full bg-foreground"
              style={{ width: `${photoshopProgressPercent(progress)}%` }}
            />
          </div>
          <div className="mt-3 grid grid-cols-4 gap-2 text-xs text-muted-foreground">
            <span>完成 {progress?.completed ?? 0}</span>
            <span>失败 {progress?.failed ?? 0}</span>
            <span>跳过 {progress?.skipped ?? 0}</span>
            <span>输出 {progress?.verified_outputs ?? 0}</span>
          </div>
        </div>

        <div className="rounded-md border p-3">
          <p className="text-sm font-medium">预览</p>
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
      </div>
    </div>
  )
}

function ActivationBadge({
  onEnterActivation,
}: {
  onEnterActivation: () => void
}) {
  const status = useActivationStore((state) => state.status)
  const refresh = useActivationStore((state) => state.refresh)
  const [open, setOpen] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const displayStatus =
    status ??
    ({
      kind: 'inactive',
      tone: 'muted',
      label: '读取中',
      detail: '正在读取激活状态',
      daysRemaining: null,
      maxDevices: null,
      usedDevices: null,
      deviceName: null,
      customerName: null,
      customerHasContact: false,
      codeSuffix: null,
      lastServerCheck: null,
      localBlockReason: null,
      localBlockMessage: null,
      cachedStatus: null,
    } satisfies ActivationBadgeState)

  async function syncStatus() {
    setSyncing(true)
    try {
      await refresh()
    } finally {
      setSyncing(false)
    }
  }

  return (
    <div className="relative">
      <button
        className={`inline-flex h-10 min-w-40 items-center justify-center gap-2 rounded-md border px-3 text-sm font-medium shadow-sm transition-colors ${statusToneClassName(
          displayStatus.tone,
        )}`}
        onClick={() => setOpen((current) => !current)}
        type="button"
      >
        <span className={`h-2.5 w-2.5 rounded-full ${statusDotClassName(displayStatus.tone)}`} />
        <span>{displayStatus.label}</span>
      </button>

      {open ? (
        <div className="absolute right-0 top-12 z-20 w-80 rounded-md border bg-background p-4 text-sm shadow-lg">
          <div className="space-y-1">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="font-semibold text-foreground">{displayStatus.label}</p>
                <p className="text-muted-foreground">{displayStatus.detail}</p>
              </div>
              {displayStatus.tone === 'red' ? (
                <AlertTriangle className="h-5 w-5 shrink-0 text-red-600" />
              ) : null}
            </div>
          </div>

          <dl className="mt-4 grid grid-cols-2 gap-3 text-xs">
            <div>
              <dt className="text-muted-foreground">本机名称</dt>
              <dd className="mt-1 font-medium">{displayStatus.deviceName ?? '-'}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">绑定设备</dt>
              <dd className="mt-1 font-medium">
                {displayStatus.usedDevices !== null && displayStatus.maxDevices !== null
                  ? `${displayStatus.usedDevices}/${displayStatus.maxDevices}`
                  : '-'}
              </dd>
            </div>
            <div>
              <dt className="text-muted-foreground">激活码后 4 位</dt>
              <dd className="mt-1 font-mono font-medium">{displayStatus.codeSuffix ?? '-'}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">上次联网</dt>
              <dd className="mt-1 font-medium">
                {formatStatusTime(displayStatus.lastServerCheck)}
              </dd>
            </div>
          </dl>

          {displayStatus.localBlockMessage ? (
            <div className="mt-4 rounded-md border border-red-200 bg-red-50 p-3 text-xs text-red-800">
              {displayStatus.localBlockMessage}
            </div>
          ) : null}

          <div className="mt-4 flex items-center justify-between gap-2">
            <Button
              className="h-9 px-3"
              disabled
              title="服务端解绑接口尚未接入"
              type="button"
              variant="secondary"
            >
              解绑本机
            </Button>
            <div className="flex gap-2">
              <Button
                className="h-9 px-3"
                disabled={syncing}
                onClick={() => void syncStatus()}
                type="button"
                variant="secondary"
              >
                <RefreshCw className="mr-2 h-3.5 w-3.5" />
                同步
              </Button>
              <Button
                className="h-9 px-3"
                onClick={() => {
                  setOpen(false)
                  onEnterActivation()
                }}
                type="button"
              >
                输入新激活码
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}

function MainWorkbench({ onEnterActivation }: { onEnterActivation: () => void }) {
  const status = useActivationStore((state) => state.status)
  const [activeModule, setActiveModule] = useState<WorkbenchModule>('title')
  const [platforms, setPlatforms] = useState<Array<{ key: string; label: string }>>([])
  const [languages, setLanguages] = useState<Array<{ key: string; label: string }>>([])
  const [models, setModels] = useState<Array<{ key: string; label: string }>>([])
  const [batchDir, setBatchDir] = useState('')
  const [platform, setPlatform] = useState('temu_pop')
  const [language, setLanguage] = useState('en')
  const [model, setModel] = useState('qwen3-vl-plus')
  const [imageIndex, setImageIndex] = useState('1')
  const [extraRequirement, setExtraRequirement] = useState('')
  const [existingStrategy, setExistingStrategy] = useState<TitleExistingStrategy>('skip')
  const [maxRetries, setMaxRetries] = useState('2')
  const [concurrency, setConcurrency] = useState('3')
  const [compression, setCompression] = useState(true)
  const [maxSize, setMaxSize] = useState('1024')
  const [scanResult, setScanResult] = useState<{
    skuCount: number
    existingTitles: Record<string, string>
  } | null>(null)
  const [progress, setProgress] = useState<TitleProgress | null>(null)
  const [taskId, setTaskId] = useState<string | null>(null)
  const [result, setResult] = useState<TitleBatchResult | null>(null)
  const [titleError, setTitleError] = useState<string | null>(null)
  const [openMessage, setOpenMessage] = useState<string | null>(null)
  const [isRetryingFailed, setIsRetryingFailed] = useState(false)
  const [pendingCollectionSku, setPendingCollectionSku] = useState<PendingCollectionSku | null>(
    null,
  )
  const [collectionSkuCode, setCollectionSkuCode] = useState('')
  const [collectionSkuError, setCollectionSkuError] = useState<string | null>(null)
  const [isCollectionSkuPromptExpanded, setIsCollectionSkuPromptExpanded] = useState(false)
  const [collectionSession, setCollectionSession] = useState<CollectionSession | null>(null)
  const [collectionRecords, setCollectionRecords] = useState<CollectionRecordRow[]>([])
  const [collectionError, setCollectionError] = useState<string | null>(null)
  const [retryingRecordId, setRetryingRecordId] = useState<string | null>(null)
  const isBlocked =
    status?.kind === 'expired' || status?.kind === 'banned' || status?.kind === 'blocked'

  useEffect(() => {
    let mounted = true
    async function loadOptions() {
      const [nextPlatforms, nextLanguages, nextModels] = await Promise.all([
        window.api.title.listPlatforms(),
        window.api.title.listLanguages(),
        window.api.title.listModels(),
      ])
      if (!mounted) {
        return
      }
      setPlatforms(nextPlatforms)
      setLanguages(nextLanguages)
      setModels(nextModels)
      setPlatform((current) => nextPlatforms[0]?.key ?? current)
      setLanguage((current) => nextLanguages[0]?.key ?? current)
      setModel((current) => nextModels[0]?.key ?? current)
    }
    void loadOptions()
    return () => {
      mounted = false
    }
  }, [])

  useEffect(() => {
    const offCollectionEvent = window.api.collection.onEvent((event) => {
      if (event.type === 'sku-required') {
        setPendingCollectionSku(event)
        setCollectionSkuCode('')
        setCollectionSkuError(null)
        setIsCollectionSkuPromptExpanded(true)
      }
      if (
        event.type === 'image-saved' ||
        event.type === 'session-started' ||
        event.type === 'session-stopped'
      ) {
        void refreshCollectionRecords()
      }
    })
    return () => {
      offCollectionEvent()
    }
  }, [])

  useEffect(() => {
    if (!pendingCollectionSku || !isCollectionSkuPromptExpanded) {
      return
    }
    const timeout = window.setTimeout(() => {
      setIsCollectionSkuPromptExpanded(false)
    }, COLLECTION_SKU_PROMPT_COLLAPSE_MS)
    return () => {
      window.clearTimeout(timeout)
    }
  }, [isCollectionSkuPromptExpanded, pendingCollectionSku])

  useEffect(() => {
    if (activeModule === 'collection') {
      void refreshCollectionRecords()
    }
  }, [activeModule])

  useEffect(() => {
    const offProgress = window.api.title.onProgress((nextProgress) => {
      setProgress(nextProgress)
      setTaskId(nextProgress.task_id)
    })
    const offCompleted = window.api.title.onCompleted((event: TitleTaskEvent) => {
      if (event.ok) {
        setResult(event.result)
        setIsRetryingFailed(false)
        setProgress({
          task_id: event.result.taskId,
          processed: event.result.total,
          total: event.result.total,
          succeeded: event.result.succeeded,
          failed: event.result.failed,
          skipped: event.result.skipped,
        })
        setTitleError(null)
        return
      }
      setIsRetryingFailed(false)
      setTitleError(event.error)
    })
    return () => {
      offProgress()
      offCompleted()
    }
  }, [])

  const existingTitleCount = scanResult ? Object.keys(scanResult.existingTitles).length : 0
  const pendingEstimateCount = scanResult
    ? existingStrategy === 'skip'
      ? Math.max(0, scanResult.skuCount - existingTitleCount)
      : scanResult.skuCount
    : 0
  const estimatedCost = estimateTitleCost(pendingEstimateCount, model, compression)
  const percent = progressPercent(progress)
  const isRunning = Boolean(progress && progress.processed < progress.total && !result)
  const progressStatusText = isRetryingFailed
    ? '失败重试中'
    : isRunning
      ? '处理中'
      : result
        ? '完成'
        : taskId
          ? '等待任务结果'
          : '未开始'
  const canRun = Boolean(batchDir.trim()) && !isRunning
  const successRows = result?.results.filter((item) => item.status === 'success') ?? []
  const failedRows = result?.results.filter((item) => item.status === 'failed') ?? []

  async function chooseBatchDir() {
    const selected = await window.api.title.chooseBatchDir()
    if (!selected.ok) {
      return
    }
    setBatchDir(selected.data.path)
    setTitleError(null)
    await scanBatchDir(selected.data.path)
  }

  async function scanBatchDir(path = batchDir) {
    if (!path.trim()) {
      setTitleError('请先选择货号批次目录')
      return
    }
    try {
      const nextScan = await window.api.title.scanBatchDir({ batchDir: path.trim() })
      setScanResult(nextScan)
      setTitleError(null)
    } catch (error) {
      setTitleError(error instanceof Error ? error.message : '扫描批次目录失败')
    }
  }

  async function runTitleBatch() {
    if (!batchDir.trim()) {
      setTitleError('请先选择货号批次目录')
      return
    }
    setResult(null)
    setIsRetryingFailed(false)
    setOpenMessage(null)
    setTitleError(null)
    const titleConfig: TitleBatchConfig = {
      batchDir: batchDir.trim(),
      platform,
      language,
      model,
      imageIndex: parsePositiveNumber(imageIndex, 1),
      existingStrategy,
      maxRetries: parseNonNegativeNumber(maxRetries, 2),
      concurrency: parsePositiveNumber(concurrency, 3),
      preprocess: {
        compression,
        maxSize: parsePositiveNumber(maxSize, 1024),
        format: 'jpg',
      },
    }
    if (extraRequirement.trim()) {
      titleConfig.extraRequirement = extraRequirement.trim()
    }
    const nextTaskId = await window.api.title.run(titleConfig)
    setTaskId(nextTaskId)
    setProgress({
      task_id: nextTaskId,
      processed: 0,
      total: scanResult?.skuCount ?? 0,
      succeeded: 0,
      failed: 0,
      skipped: 0,
    })
  }

  async function retryFailed() {
    if (!taskId) {
      setTitleError('没有可重试的任务')
      return
    }
    setResult(null)
    setIsRetryingFailed(true)
    setTitleError(null)
    const nextTaskId = await window.api.title.retryFailed({ task_id: taskId })
    setTaskId(nextTaskId)
    setProgress({
      task_id: nextTaskId,
      processed: 0,
      total: failedRows.length,
      succeeded: 0,
      failed: 0,
      skipped: 0,
    })
  }

  async function openPath(path: string) {
    const response = await window.api.title.openPath({ path })
    setOpenMessage(response.ok ? null : response.error.message)
  }

  async function refreshCollectionRecords() {
    try {
      const session = await window.api.collection.getActiveSession()
      setCollectionSession(session)
      if (!session) {
        setCollectionRecords([])
        return
      }
      const records = await window.api.collection.listRecords({
        session_id: session.id,
        limit: 20,
      })
      setCollectionRecords(records)
      setCollectionError(null)
    } catch (error) {
      setCollectionError(error instanceof Error ? error.message : '读取采集记录失败')
    }
  }

  async function retryCollectionRecord(recordId: string) {
    setRetryingRecordId(recordId)
    try {
      await window.api.collection.retryRecord({ record_id: recordId })
      await refreshCollectionRecords()
      setCollectionError(null)
    } catch (error) {
      setCollectionError(error instanceof Error ? error.message : '重试采集记录失败')
    } finally {
      setRetryingRecordId(null)
    }
  }

  async function submitCollectionSku() {
    if (!pendingCollectionSku) {
      return
    }
    const skuCode = collectionSkuCode.trim()
    if (!skuCode) {
      setCollectionSkuError('请填写货号')
      return
    }
    try {
      await window.api.collection.setSku({
        goods_link: pendingCollectionSku.goods_link,
        sku_code: skuCode,
      })
      setPendingCollectionSku(null)
      setCollectionSkuCode('')
      setCollectionSkuError(null)
      setIsCollectionSkuPromptExpanded(false)
    } catch (error) {
      setCollectionSkuError(error instanceof Error ? error.message : '保存货号失败')
    }
  }

  return (
    <main className="min-h-screen bg-background text-foreground">
      <header className="flex h-16 items-center justify-between border-b px-8">
        <div>
          <p className="text-sm font-medium text-muted-foreground">Workbench</p>
          <h1 className="text-lg font-semibold tracking-normal">腾域 aipod</h1>
        </div>
        <ActivationBadge onEnterActivation={onEnterActivation} />
      </header>

      <section className="mx-auto w-full max-w-7xl space-y-6 px-8 py-6">
        {isBlocked ? (
          <div className="mt-20 max-w-xl space-y-5 rounded-md border border-red-200 bg-red-50 p-6 text-red-900">
            <div className="space-y-2">
              <h1 className="text-2xl font-semibold tracking-normal">
                {status?.label ?? '激活状态异常'}
              </h1>
              <p className="text-sm">{status?.localBlockMessage ?? status?.detail}</p>
            </div>
            <Button onClick={onEnterActivation} type="button">
              输入新激活码
            </Button>
          </div>
        ) : (
          <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
            <div className="space-y-6">
              <div className="rounded-md border bg-background p-5 shadow-sm">
                <div className="flex items-start justify-between gap-6">
                  <div className="space-y-1">
                    <p className="text-sm font-medium text-muted-foreground">
                      {moduleTitle(activeModule)}
                    </p>
                    <h1 className="text-2xl font-semibold text-balance">
                      {moduleDescription(activeModule)}
                    </h1>
                  </div>
                  <div className="rounded-md border bg-muted px-3 py-2 text-right text-xs text-muted-foreground">
                    <div>版本</div>
                    <div className="mt-1 font-mono text-foreground">{APP_VERSION}</div>
                  </div>
                </div>
                <div className="mt-4 flex gap-2">
                  <Button
                    onClick={() => setActiveModule('collection')}
                    type="button"
                    variant={activeModule === 'collection' ? 'default' : 'secondary'}
                  >
                    采集
                  </Button>
                  <Button
                    onClick={() => setActiveModule('title')}
                    type="button"
                    variant={activeModule === 'title' ? 'default' : 'secondary'}
                  >
                    标题生成
                  </Button>
                  <Button
                    onClick={() => setActiveModule('generation')}
                    type="button"
                    variant={activeModule === 'generation' ? 'default' : 'secondary'}
                  >
                    生图
                  </Button>
                  <Button
                    onClick={() => setActiveModule('detection')}
                    type="button"
                    variant={activeModule === 'detection' ? 'default' : 'secondary'}
                  >
                    侵权检测
                  </Button>
                  <Button
                    onClick={() => setActiveModule('listing')}
                    type="button"
                    variant={activeModule === 'listing' ? 'default' : 'secondary'}
                  >
                    上架
                  </Button>
                  <Button
                    onClick={() => setActiveModule('ps')}
                    type="button"
                    variant={activeModule === 'ps' ? 'default' : 'secondary'}
                  >
                    PS 套版
                  </Button>
                </div>
              </div>

              {activeModule === 'collection' ? (
                <div className="rounded-md border bg-background p-5 shadow-sm">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <h2 className="text-lg font-semibold text-balance">当前采集记录</h2>
                      <p className="mt-1 text-sm text-muted-foreground">
                        {collectionSession
                          ? `${collectionSession.platform} · ${collectionSession.mode === 'click' ? '点击模式' : '滚动模式'}`
                          : '当前没有活动采集会话'}
                      </p>
                    </div>
                    <Button
                      onClick={() => void refreshCollectionRecords()}
                      type="button"
                      variant="secondary"
                    >
                      <RefreshCw className="mr-2 h-4 w-4" />
                      刷新
                    </Button>
                  </div>

                  {collectionError ? (
                    <div className="mt-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
                      {collectionError}
                    </div>
                  ) : null}

                  <div className="mt-5 grid gap-4 lg:grid-cols-[minmax(0,1fr)_280px]">
                    <div className="rounded-md border">
                      <div className="border-b px-3 py-2 text-sm font-medium">
                        最近保存（{collectionRecords.length}）
                      </div>
                      <div className="max-h-96 overflow-auto p-2">
                        {collectionRecords.length ? (
                          collectionRecords.map((record) => (
                            <div
                              className="grid gap-3 rounded-md px-2 py-3 text-sm md:grid-cols-[96px_minmax(0,1fr)_auto]"
                              key={record.id}
                            >
                              {record.savedPath && record.status !== 'failed' ? (
                                <img
                                  alt=""
                                  className="h-16 w-24 rounded-md border object-cover"
                                  src={`file://${record.savedPath}`}
                                />
                              ) : (
                                <div className="flex h-16 w-24 items-center justify-center rounded-md border bg-muted text-xs text-muted-foreground">
                                  无预览
                                </div>
                              )}
                              <div className="min-w-0">
                                <div className="truncate font-medium">
                                  {fileNameFromPath(record.savedPath)}
                                </div>
                                <div className="mt-1 truncate text-xs text-muted-foreground">
                                  {record.goodsLink ?? record.pageUrl}
                                </div>
                                {record.reason ? (
                                  <div className="mt-1 text-xs text-red-700">{record.reason}</div>
                                ) : null}
                              </div>
                              <div className="flex items-center gap-2 md:justify-end">
                                <span
                                  className={`text-xs font-medium ${collectionStatusClassName(record.status)}`}
                                >
                                  {collectionStatusLabel(record.status)}
                                </span>
                                {record.status === 'failed' ? (
                                  <Button
                                    className="h-8 px-2"
                                    disabled={retryingRecordId === record.id}
                                    onClick={() => void retryCollectionRecord(record.id)}
                                    type="button"
                                    variant="secondary"
                                  >
                                    <RotateCcw className="mr-2 h-3.5 w-3.5" />
                                    重试
                                  </Button>
                                ) : null}
                              </div>
                            </div>
                          ))
                        ) : (
                          <div className="px-2 py-10 text-center text-sm text-muted-foreground">
                            暂无采集记录
                          </div>
                        )}
                      </div>
                    </div>

                    <div className="rounded-md border p-4">
                      <h3 className="text-sm font-medium">当前会话</h3>
                      <dl className="mt-3 space-y-3 text-sm">
                        <div>
                          <dt className="text-muted-foreground">状态</dt>
                          <dd className="mt-1 font-medium">
                            {collectionSession?.status ?? '未开始'}
                          </dd>
                        </div>
                        <div>
                          <dt className="text-muted-foreground">输出目录</dt>
                          <dd className="mt-1 break-all text-xs">
                            {collectionSession?.output_dir ?? '-'}
                          </dd>
                        </div>
                        <div>
                          <dt className="text-muted-foreground">失败记录</dt>
                          <dd className="mt-1 font-medium tabular-nums">
                            {
                              collectionRecords.filter((record) => record.status === 'failed')
                                .length
                            }
                          </dd>
                        </div>
                      </dl>
                    </div>
                  </div>
                </div>
              ) : activeModule === 'title' ? (
                <div className="rounded-md border bg-background p-5 shadow-sm">
                  <div className="grid gap-5">
                    <label className="block space-y-2 text-sm font-medium">
                      <span>货号批次目录</span>
                      <div className="flex gap-2">
                        <input
                          className="h-10 min-w-0 flex-1 rounded-md border px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-primary"
                          onChange={(event) => setBatchDir(event.target.value)}
                          placeholder="选择 05-货号成品 下的一个批次目录"
                          value={batchDir}
                        />
                        <Button
                          onClick={() => void chooseBatchDir()}
                          type="button"
                          variant="secondary"
                        >
                          <FolderOpen className="mr-2 h-4 w-4" />
                          选择
                        </Button>
                        <Button
                          onClick={() => void scanBatchDir()}
                          type="button"
                          variant="secondary"
                        >
                          扫描
                        </Button>
                      </div>
                    </label>

                    <div className="grid gap-4 md:grid-cols-3">
                      <label className="block space-y-2 text-sm font-medium">
                        <span>平台</span>
                        <select
                          className="h-10 w-full rounded-md border bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-primary"
                          onChange={(event) => setPlatform(event.target.value)}
                          value={platform}
                        >
                          {platforms.map((item) => (
                            <option key={item.key} value={item.key}>
                              {item.label}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="block space-y-2 text-sm font-medium">
                        <span>语言</span>
                        <select
                          className="h-10 w-full rounded-md border bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-primary"
                          onChange={(event) => setLanguage(event.target.value)}
                          value={language}
                        >
                          {languages.map((item) => (
                            <option key={item.key} value={item.key}>
                              {item.label}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="block space-y-2 text-sm font-medium">
                        <span>模型</span>
                        <select
                          className="h-10 w-full rounded-md border bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-primary"
                          onChange={(event) => setModel(event.target.value)}
                          value={model}
                        >
                          {models.map((item) => (
                            <option key={item.key} value={item.key}>
                              {item.label}
                            </option>
                          ))}
                        </select>
                      </label>
                    </div>

                    <label className="block space-y-2 text-sm font-medium">
                      <span>标题额外要求</span>
                      <textarea
                        className="min-h-24 w-full resize-none rounded-md border px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-primary"
                        onChange={(event) => setExtraRequirement(event.target.value)}
                        placeholder="例如：强调原创设计、节日主题、含 vintage 关键词"
                        value={extraRequirement}
                      />
                    </label>

                    <div className="grid gap-4 md:grid-cols-4">
                      <label className="block space-y-2 text-sm font-medium">
                        <span>取第几张图</span>
                        <input
                          className="h-10 w-full rounded-md border px-3 text-sm tabular-nums outline-none focus-visible:ring-2 focus-visible:ring-primary"
                          min={1}
                          onChange={(event) => setImageIndex(event.target.value)}
                          type="number"
                          value={imageIndex}
                        />
                      </label>
                      <label className="block space-y-2 text-sm font-medium">
                        <span>失败重试</span>
                        <input
                          className="h-10 w-full rounded-md border px-3 text-sm tabular-nums outline-none focus-visible:ring-2 focus-visible:ring-primary"
                          max={5}
                          min={0}
                          onChange={(event) => setMaxRetries(event.target.value)}
                          type="number"
                          value={maxRetries}
                        />
                      </label>
                      <label className="block space-y-2 text-sm font-medium">
                        <span>并发数</span>
                        <input
                          className="h-10 w-full rounded-md border px-3 text-sm tabular-nums outline-none focus-visible:ring-2 focus-visible:ring-primary"
                          max={10}
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
                    </div>

                    <div className="grid gap-4 md:grid-cols-2">
                      <fieldset className="rounded-md border p-4">
                        <legend className="px-1 text-sm font-medium">已有标题策略</legend>
                        <div className="mt-2 flex gap-4 text-sm">
                          <label className="inline-flex items-center gap-2">
                            <input
                              checked={existingStrategy === 'skip'}
                              onChange={() => setExistingStrategy('skip')}
                              type="radio"
                            />
                            跳过已有
                          </label>
                          <label className="inline-flex items-center gap-2">
                            <input
                              checked={existingStrategy === 'regenerate'}
                              onChange={() => setExistingStrategy('regenerate')}
                              type="radio"
                            />
                            重新生成
                          </label>
                        </div>
                      </fieldset>
                      <fieldset className="rounded-md border p-4">
                        <legend className="px-1 text-sm font-medium">图像预处理</legend>
                        <div className="mt-2 space-y-2 text-sm">
                          <label className="inline-flex items-center gap-2 text-muted-foreground">
                            <input checked disabled type="checkbox" />
                            透明底自动加白
                          </label>
                          <label className="flex items-center gap-2">
                            <input
                              checked={compression}
                              onChange={(event) => setCompression(event.target.checked)}
                              type="checkbox"
                            />
                            压缩图片节省 token
                          </label>
                        </div>
                      </fieldset>
                    </div>

                    {titleError ? (
                      <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
                        {titleError}
                      </div>
                    ) : null}

                    <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-5">
                      <div className="flex items-center gap-2 text-sm text-muted-foreground">
                        <Calculator className="h-4 w-4" />
                        预估 {pendingEstimateCount} 张图，约 ¥
                        <span className="tabular-nums">{estimatedCost.toFixed(4)}</span>
                      </div>
                      <Button disabled={!canRun} onClick={() => void runTitleBatch()} type="button">
                        {isRunning ? (
                          <Loader2 className="mr-2 h-4 w-4" />
                        ) : (
                          <Play className="mr-2 h-4 w-4" />
                        )}
                        开始生成标题
                      </Button>
                    </div>
                  </div>
                </div>
              ) : activeModule === 'generation' ? (
                <GenerationWorkbench />
              ) : activeModule === 'listing' ? (
                <ListingWorkbench />
              ) : activeModule === 'ps' ? (
                <div className="space-y-6">
                  <PhotoshopStatusBar />
                  <PhotoshopMockupPanel />
                </div>
              ) : (
                <DetectionWorkbench />
              )}

              {activeModule === 'title' ? (
                <>
                  {result ? (
                    <div className="rounded-md border bg-background p-5 shadow-sm">
                      <div className="flex items-start justify-between gap-4">
                        <div>
                          <h2 className="text-lg font-semibold text-balance">生成结果</h2>
                          <p className="mt-1 text-sm text-muted-foreground">
                            成功 {result.succeeded} 个，失败 {result.failed} 个，跳过{' '}
                            {result.skipped} 个
                          </p>
                        </div>
                        <div className="flex gap-2">
                          <Button
                            onClick={() => void openPath(result.xlsxPath)}
                            type="button"
                            variant="secondary"
                          >
                            打开 xlsx
                          </Button>
                          <Button
                            onClick={() => void openPath(batchDir)}
                            type="button"
                            variant="secondary"
                          >
                            打开批次目录
                          </Button>
                        </div>
                      </div>
                      {openMessage ? (
                        <p className="mt-3 text-sm text-red-700">{openMessage}</p>
                      ) : null}
                      <div className="mt-5 grid gap-4 lg:grid-cols-2">
                        <div className="rounded-md border">
                          <div className="border-b px-3 py-2 text-sm font-medium">
                            成功列表（{successRows.length}）
                          </div>
                          <div className="max-h-56 overflow-auto p-2">
                            {successRows.length ? (
                              successRows.map((item) => (
                                <div
                                  className="grid grid-cols-[120px_minmax(0,1fr)] gap-3 rounded-md px-2 py-2 text-sm"
                                  key={item.skuCode}
                                >
                                  <span className="font-mono text-xs text-muted-foreground">
                                    {item.skuCode}
                                  </span>
                                  <span className="truncate">{item.title}</span>
                                </div>
                              ))
                            ) : (
                              <div className="px-2 py-6 text-center text-sm text-muted-foreground">
                                暂无成功项
                              </div>
                            )}
                          </div>
                        </div>
                        <div className="rounded-md border">
                          <div className="flex items-center justify-between border-b px-3 py-2 text-sm font-medium">
                            <span>失败列表（{failedRows.length}）</span>
                            <Button
                              className="h-8 px-2"
                              disabled={!failedRows.length}
                              onClick={() => void retryFailed()}
                              type="button"
                              variant="secondary"
                            >
                              <RotateCcw className="mr-2 h-3.5 w-3.5" />
                              重试失败
                            </Button>
                          </div>
                          <div className="max-h-56 overflow-auto p-2">
                            {failedRows.length ? (
                              failedRows.map((item) => (
                                <div className="rounded-md px-2 py-2 text-sm" key={item.skuCode}>
                                  <div className="font-mono text-xs text-muted-foreground">
                                    {item.skuCode}
                                  </div>
                                  <div className="mt-1 text-red-700">{item.error}</div>
                                </div>
                              ))
                            ) : (
                              <div className="px-2 py-6 text-center text-sm text-muted-foreground">
                                没有失败项
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                  ) : null}
                </>
              ) : null}
            </div>
            {activeModule === 'title' ? (
              <aside className="space-y-6">
                <div className="rounded-md border bg-background p-5 shadow-sm">
                  <h2 className="text-lg font-semibold text-balance">批次概览</h2>
                  <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
                    <div className="rounded-md bg-muted p-3">
                      <dt className="text-muted-foreground">货号文件夹</dt>
                      <dd className="mt-1 text-xl font-semibold tabular-nums">
                        {scanResult?.skuCount ?? 0}
                      </dd>
                    </div>
                    <div className="rounded-md bg-muted p-3">
                      <dt className="text-muted-foreground">已有标题</dt>
                      <dd className="mt-1 text-xl font-semibold tabular-nums">
                        {existingTitleCount}
                      </dd>
                    </div>
                    <div className="rounded-md bg-muted p-3">
                      <dt className="text-muted-foreground">预计生成</dt>
                      <dd className="mt-1 text-xl font-semibold tabular-nums">
                        {pendingEstimateCount}
                      </dd>
                    </div>
                    <div className="rounded-md bg-muted p-3">
                      <dt className="text-muted-foreground">预计费用</dt>
                      <dd className="mt-1 text-xl font-semibold tabular-nums">
                        ¥{estimatedCost.toFixed(4)}
                      </dd>
                    </div>
                  </dl>
                </div>

                <div className="rounded-md border bg-background p-5 shadow-sm">
                  <div className="flex items-center justify-between">
                    <h2 className="text-lg font-semibold text-balance">执行进度</h2>
                    <span className="text-sm tabular-nums text-muted-foreground">{percent}%</span>
                  </div>
                  <div className="mt-4 h-2 rounded-full bg-muted">
                    <div className="h-2 rounded-full bg-primary" style={{ width: `${percent}%` }} />
                  </div>
                  <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
                    <div>
                      <dt className="text-muted-foreground">处理中</dt>
                      <dd className="mt-1 font-medium tabular-nums">
                        {progress ? `${progress.processed}/${progress.total}` : '0/0'}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-muted-foreground">跳过</dt>
                      <dd className="mt-1 font-medium tabular-nums">{progress?.skipped ?? 0}</dd>
                    </div>
                    <div>
                      <dt className="text-muted-foreground">成功</dt>
                      <dd className="mt-1 font-medium tabular-nums">{progress?.succeeded ?? 0}</dd>
                    </div>
                    <div>
                      <dt className="text-muted-foreground">失败</dt>
                      <dd className="mt-1 font-medium tabular-nums">{progress?.failed ?? 0}</dd>
                    </div>
                  </dl>
                  <div className="mt-4 rounded-md bg-muted px-3 py-2 text-sm text-muted-foreground">
                    {progressStatusText}
                  </div>
                </div>
              </aside>
            ) : null}
          </div>
        )}
      </section>
      {pendingCollectionSku && isCollectionSkuPromptExpanded ? (
        <div className="fixed bottom-5 right-5 z-40 w-96 rounded-md border bg-background p-4 text-sm shadow-xl">
          <div className="space-y-1">
            <p className="font-semibold">填写采集货号</p>
            <p className="break-all text-xs text-muted-foreground">
              {pendingCollectionSku.goods_link}
            </p>
          </div>
          <div className="mt-3 flex gap-2">
            <input
              className="h-10 min-w-0 flex-1 rounded-md border px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-primary"
              onChange={(event) => setCollectionSkuCode(event.target.value)}
              placeholder="例如 SKU-001"
              value={collectionSkuCode}
            />
            <Button onClick={() => void submitCollectionSku()} type="button">
              保存
            </Button>
          </div>
          {collectionSkuError ? (
            <p className="mt-2 text-xs text-red-700">{collectionSkuError}</p>
          ) : null}
          <button
            className="mt-3 text-xs text-muted-foreground underline"
            onClick={() => setIsCollectionSkuPromptExpanded(false)}
            type="button"
          >
            稍后填写
          </button>
        </div>
      ) : pendingCollectionSku ? (
        <button
          className="fixed bottom-5 right-5 z-40 rounded-md border bg-background px-4 py-3 text-left text-sm shadow-xl"
          onClick={() => setIsCollectionSkuPromptExpanded(true)}
          type="button"
        >
          <span className="block font-semibold">待填写采集货号</span>
          <span className="mt-1 block max-w-72 truncate text-xs text-muted-foreground">
            {pendingCollectionSku.goods_link}
          </span>
        </button>
      ) : null}
    </main>
  )
}

function StepHeader({ step }: { step: OnboardingStep }) {
  const steps = [
    { number: 1, label: '激活', icon: MonitorCheck },
    { number: 2, label: '素材目录', icon: FolderOpen },
    { number: 3, label: 'API Keys', icon: KeyRound },
    { number: 4, label: '完成', icon: CheckCircle2 },
  ]

  return (
    <div className="grid grid-cols-4 gap-3">
      {steps.map((item) => {
        const Icon = item.icon
        const isCurrent = item.number === step
        const isDone = item.number < step
        return (
          <div
            className={`rounded-md border p-3 ${
              isCurrent || isDone ? 'border-primary bg-muted' : 'bg-background'
            }`}
            key={item.number}
          >
            <div className="flex items-center gap-2 text-sm font-medium">
              <Icon className="h-4 w-4" />
              Step {item.number}/4
            </div>
            <div className="mt-1 text-xs text-muted-foreground">{item.label}</div>
          </div>
        )
      })}
    </div>
  )
}

function Onboarding() {
  const [step, setStep] = useState<OnboardingStep>(1)
  const [activationCode, setActivationCode] = useState('')
  const [deviceName, setDeviceName] = useState(defaultDeviceName)
  const [activationMessage, setActivationMessage] = useState<string | null>(null)
  const [isActivating, setIsActivating] = useState(false)
  const [workbenchRoot, setWorkbenchRoot] = useState('')
  const [apiKeys, setApiKeys] = useState<Record<string, string>>({
    chenyu: '',
    grsai: '',
    bailian: '',
    bit_browser_url: '127.0.0.1:54345',
  })
  const [ready, setReady] = useState(false)

  function enterActivation() {
    setReady(false)
    setStep(1)
  }

  useEffect(() => {
    async function loadState() {
      const state = await window.api.onboarding.getState()
      setWorkbenchRoot(state.default_workbench_root)
      if (!state.needs_onboarding) {
        setReady(true)
      }
    }

    void loadState()
  }, [])

  const canActivate = useMemo(
    () => /^POD-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(activationCode),
    [activationCode],
  )

  async function activate() {
    setActivationMessage(null)
    setIsActivating(true)
    const result = await window.api.activation.activate({
      code: activationCode,
      device_name: deviceName.trim() || defaultDeviceName(),
    })
    setIsActivating(false)

    if (!result.ok) {
      setActivationMessage(result.error.message)
      return
    }

    setActivationMessage(
      `激活成功，可用设备 ${result.data.used_devices}/${result.data.max_devices}`,
    )
    setStep(2)
  }

  async function chooseWorkbenchRoot() {
    const result = await window.api.onboarding.chooseWorkbenchRoot()
    if (result.ok) {
      setWorkbenchRoot(result.data.path)
    }
  }

  async function saveWorkbenchRoot() {
    await window.api.onboarding.saveWorkbenchRoot(workbenchRoot)
    setStep(3)
  }

  async function saveApiKeys(nextStep: OnboardingStep = 4) {
    const cleaned = Object.fromEntries(
      Object.entries(apiKeys).map(([key, value]) => [key, value.trim()]),
    )
    await window.api.onboarding.saveApiKeys(cleaned)
    setStep(nextStep)
  }

  async function complete() {
    await window.api.onboarding.complete()
    setReady(true)
  }

  if (ready) {
    return <MainWorkbench onEnterActivation={enterActivation} />
  }

  return (
    <main className="min-h-screen bg-background px-8 py-10 text-foreground">
      <div className="fixed right-8 top-6 z-20">
        <ActivationBadge onEnterActivation={enterActivation} />
      </div>
      <section className="mx-auto max-w-5xl space-y-6">
        <div className="space-y-2">
          <p className="text-sm font-medium text-muted-foreground">首次启动</p>
          <h1 className="text-3xl font-semibold tracking-normal">欢迎使用腾域 aipod</h1>
        </div>
        <StepHeader step={step} />

        <div className="rounded-lg border bg-background p-6 shadow-sm">
          {step === 1 ? (
            <div className="space-y-5">
              <div>
                <h2 className="text-xl font-semibold">Step 1/4 - 激活</h2>
              </div>
              <label className="block space-y-2 text-sm font-medium">
                <span>激活码</span>
                <input
                  className="h-11 w-full rounded-md border px-3 font-mono text-base outline-none focus-visible:ring-2 focus-visible:ring-primary"
                  onChange={(event) =>
                    setActivationCode(normalizeActivationCode(event.target.value))
                  }
                  placeholder="POD-XXXX-YYYY-ZZZZ"
                  value={activationCode}
                />
              </label>
              <label className="block space-y-2 text-sm font-medium">
                <span>本机名称</span>
                <input
                  className="h-11 w-full rounded-md border px-3 text-base outline-none focus-visible:ring-2 focus-visible:ring-primary"
                  onChange={(event) => setDeviceName(event.target.value)}
                  value={deviceName}
                />
              </label>
              {activationMessage ? (
                <p className="text-sm text-muted-foreground">{activationMessage}</p>
              ) : null}
              <div className="flex items-center gap-3">
                <Button
                  disabled={!canActivate || isActivating}
                  onClick={() => void activate()}
                  type="button"
                >
                  {isActivating ? '激活中...' : '激活'}
                </Button>
                <a
                  className="text-sm text-muted-foreground underline"
                  href="https://example.com/support"
                >
                  联系客服微信
                </a>
              </div>
            </div>
          ) : null}

          {step === 2 ? (
            <div className="space-y-5">
              <h2 className="text-xl font-semibold">Step 2/4 - 素材总目录</h2>
              <label className="block space-y-2 text-sm font-medium">
                <span>素材根目录</span>
                <div className="flex gap-2">
                  <input
                    className="h-11 min-w-0 flex-1 rounded-md border px-3 text-base outline-none focus-visible:ring-2 focus-visible:ring-primary"
                    onChange={(event) => setWorkbenchRoot(event.target.value)}
                    value={workbenchRoot}
                  />
                  <Button
                    onClick={() => void chooseWorkbenchRoot()}
                    type="button"
                    variant="secondary"
                  >
                    浏览...
                  </Button>
                </div>
              </label>
              <div className="rounded-md bg-muted p-4 text-sm text-muted-foreground">
                软件会创建 01-采集、02-生图、03-检测、04-待套版印花、05-货号成品 和 .workbench。
              </div>
              <div className="flex gap-2">
                <Button onClick={() => setStep(1)} type="button" variant="secondary">
                  上一步
                </Button>
                <Button onClick={() => void saveWorkbenchRoot()} type="button">
                  下一步
                </Button>
              </div>
            </div>
          ) : null}

          {step === 3 ? (
            <div className="space-y-5">
              <h2 className="text-xl font-semibold">Step 3/4 - API Keys</h2>
              <div className="grid gap-4">
                {apiKeyFields.map((field) => (
                  <label className="block space-y-2 text-sm font-medium" key={field.key}>
                    <span>{field.label}</span>
                    <div className="flex gap-2">
                      <input
                        className="h-11 min-w-0 flex-1 rounded-md border px-3 text-base outline-none focus-visible:ring-2 focus-visible:ring-primary"
                        onChange={(event) =>
                          setApiKeys((current) => ({ ...current, [field.key]: event.target.value }))
                        }
                        placeholder={field.placeholder}
                        type={field.key === 'bit_browser_url' ? 'text' : 'password'}
                        value={apiKeys[field.key] ?? ''}
                      />
                      <Button
                        onClick={() => setApiKeys((current) => ({ ...current, [field.key]: '' }))}
                        type="button"
                        variant="secondary"
                      >
                        跳过
                      </Button>
                      <Button type="button" variant="secondary">
                        测试连接
                      </Button>
                    </div>
                  </label>
                ))}
              </div>
              <div className="flex gap-2">
                <Button onClick={() => setStep(2)} type="button" variant="secondary">
                  上一步
                </Button>
                <Button onClick={() => void saveApiKeys()} type="button" variant="secondary">
                  全部跳过
                </Button>
                <Button onClick={() => void saveApiKeys()} type="button">
                  下一步
                </Button>
              </div>
            </div>
          ) : null}

          {step === 4 ? (
            <div className="space-y-5 text-center">
              <CheckCircle2 className="mx-auto h-14 w-14 text-foreground" />
              <div>
                <h2 className="text-2xl font-semibold">软件已准备就绪</h2>
              </div>
              <div className="flex justify-center gap-2">
                <Button asChild variant="secondary">
                  <a href="https://example.com/tutorial">
                    <PlayCircle className="mr-2 h-4 w-4" />
                    查看教程视频
                  </a>
                </Button>
                <Button onClick={() => void complete()} type="button">
                  开始使用
                </Button>
              </div>
            </div>
          ) : null}
        </div>
      </section>
    </main>
  )
}

export function App() {
  useEffect(() => {
    let cleanup: (() => void) | null = null

    void initializeActivationStore().then((nextCleanup) => {
      cleanup = nextCleanup
    })

    return () => {
      cleanup?.()
    }
  }, [])

  return <Onboarding />
}
