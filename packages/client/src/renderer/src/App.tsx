import { Button } from '@/components/ui/button'
import {
  CollectionPage,
  type CollectionPageState,
  type CollectionProfileOption,
} from '@/features/collection/CollectionPage'
import { DetectionPage } from '@/features/detection/DetectionPage'
import { GenerationPage } from '@/features/generation/GenerationPage'
import { ListingPage } from '@/features/listing/ListingPage'
import {
  type OnboardingApiKey,
  type OnboardingApiKeys,
  OnboardingPage,
  type OnboardingStep,
} from '@/features/onboarding/OnboardingPage'
import {
  type TitleExistingStrategy,
  type TitleFormState,
  TitlePage,
  type TitlePageState,
} from '@/features/title/TitlePage'
import { Shell } from '@/layout/Shell'
import {
  type WorkbenchModule,
  getStoredWorkbenchRoute,
  isWorkbenchRoute,
  moduleFromPath,
  workbenchModules,
} from '@/layout/navigation'
import { initializeActivationStore, useActivationStore } from '@/store/activation'
import type {
  ActivationBadgeState,
  PhotoshopProgressInfo,
  PhotoshopStatus,
  PsdTemplate,
} from '@tengyu-aipod/shared'
import {
  AlertTriangle,
  CheckCircle2,
  ExternalLink,
  FileStack,
  FolderOpen,
  ImageIcon,
  PlayCircle,
  RefreshCw,
  Settings2,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  HashRouter,
  Navigate,
  Route,
  Routes,
  useLocation,
  useNavigate,
  useParams,
} from 'react-router-dom'
import type { CollectionRecordRow } from '../../main/lib/collection-record-store'
import type { CollectionSession } from '../../main/lib/collection-session-manager'
import type { CollectionSessionEvent } from '../../main/lib/collection-session-manager'
import type {
  TitleBatchConfig,
  TitleBatchResult,
  TitleProgress,
  TitleTaskEvent,
} from '../../main/lib/title-service'
type PendingCollectionSku = Extract<CollectionSessionEvent, { type: 'sku-required' }>

const defaultCollectionProfiles: CollectionProfileOption[] = [
  { id: 'profile-001', label: '主店环境', detail: 'Temu 主店环境', online: true },
  { id: 'profile-002', label: '备用环境', detail: '可手动改写编号', online: false },
]

const defaultCollectionPageState: CollectionPageState = {
  platform: 'temu',
  profileId: '',
  mode: 'click',
  outputDir: '',
  scrollKeywords: '',
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

function parseOnboardingStep(value: string | undefined): OnboardingStep {
  const parsed = Number(value)
  return parsed === 1 || parsed === 2 || parsed === 3 || parsed === 4 ? parsed : 1
}

function onboardingPath(step: OnboardingStep) {
  return `/onboarding/${step}`
}

function isForceOnboardingState(state: unknown) {
  return (
    typeof state === 'object' &&
    state !== null &&
    'forceOnboarding' in state &&
    (state as { forceOnboarding?: unknown }).forceOnboarding === true
  )
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
  const location = useLocation()
  const activeModule = moduleFromPath(location.pathname) ?? 'title'
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
  const [collectionPageState, setCollectionPageState] = useState<CollectionPageState>(
    defaultCollectionPageState,
  )
  const [collectionProfiles, setCollectionProfiles] =
    useState<CollectionProfileOption[]>(defaultCollectionProfiles)
  const [isStartingCollection, setIsStartingCollection] = useState(false)
  const [isStoppingCollection, setIsStoppingCollection] = useState(false)
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
        event.type === 'session-paused' ||
        event.type === 'session-resumed' ||
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

  const titlePageState: TitlePageState = {
    batchDir,
    platform,
    language,
    model,
    imageIndex,
    extraRequirement,
    existingStrategy,
    maxRetries,
    concurrency,
    compression,
    maxSize,
    scanResult,
    progress,
    taskId,
    result,
    isRetryingFailed,
  }

  function updateTitleFormState(
    key: keyof TitleFormState,
    value: TitleFormState[keyof TitleFormState],
  ) {
    switch (key) {
      case 'batchDir':
        if (typeof value === 'string') setBatchDir(value)
        return
      case 'platform':
        if (typeof value === 'string') setPlatform(value)
        return
      case 'language':
        if (typeof value === 'string') setLanguage(value)
        return
      case 'model':
        if (typeof value === 'string') setModel(value)
        return
      case 'imageIndex':
        if (typeof value === 'string') setImageIndex(value)
        return
      case 'extraRequirement':
        if (typeof value === 'string') setExtraRequirement(value)
        return
      case 'existingStrategy':
        if (value === 'skip' || value === 'regenerate') setExistingStrategy(value)
        return
      case 'maxRetries':
        if (typeof value === 'string') setMaxRetries(value)
        return
      case 'concurrency':
        if (typeof value === 'string') setConcurrency(value)
        return
      case 'compression':
        setCompression(value === true)
        return
      case 'maxSize':
        if (typeof value === 'string') setMaxSize(value)
        return
    }
  }

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
    const failedCount = result?.results.filter((item) => item.status === 'failed').length ?? 0
    const nextTaskId = await window.api.title.retryFailed({ task_id: taskId })
    setTaskId(nextTaskId)
    setProgress({
      task_id: nextTaskId,
      processed: 0,
      total: failedCount,
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

  function updateCollectionPageState<K extends keyof CollectionPageState>(
    key: K,
    value: CollectionPageState[K],
  ) {
    setCollectionPageState((current) => ({ ...current, [key]: value }))
  }

  function refreshCollectionProfiles() {
    setCollectionProfiles(defaultCollectionProfiles)
    setCollectionError(null)
  }

  async function startCollectionSession() {
    const profileId = collectionPageState.profileId.trim()
    if (!profileId) {
      setCollectionError('请先选择或填写比特浏览器环境编号')
      return
    }
    setIsStartingCollection(true)
    setCollectionError(null)
    try {
      const session = await window.api.collection.startSession({
        platform: collectionPageState.platform,
        profile_id: profileId,
        mode: collectionPageState.mode,
        ...(collectionPageState.outputDir.trim()
          ? { output_dir: collectionPageState.outputDir.trim() }
          : {}),
      })
      setCollectionSession(session)
      await refreshCollectionRecords()
    } catch (error) {
      setCollectionError(error instanceof Error ? error.message : '启动采集会话失败')
    } finally {
      setIsStartingCollection(false)
    }
  }

  async function stopCollectionSession() {
    setIsStoppingCollection(true)
    setCollectionError(null)
    try {
      const session = await window.api.collection.stopSession()
      setCollectionSession(session)
      if (!session) {
        setCollectionRecords([])
      }
      await refreshCollectionRecords()
    } catch (error) {
      setCollectionError(error instanceof Error ? error.message : '停止采集会话失败')
    } finally {
      setIsStoppingCollection(false)
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
    <Shell activationBadge={<ActivationBadge onEnterActivation={onEnterActivation} />}>
      <div className="space-y-6">
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
          <div className="space-y-6">
            {activeModule === 'collection' ? (
              <CollectionPage
                error={collectionError}
                onOutputDirBrowse={() => updateCollectionPageState('outputDir', '')}
                onRefreshProfiles={refreshCollectionProfiles}
                onRefreshRecords={() => void refreshCollectionRecords()}
                onRetryRecord={(recordId) => void retryCollectionRecord(recordId)}
                onStartSession={() => void startCollectionSession()}
                onStateChange={updateCollectionPageState}
                onStopSession={() => void stopCollectionSession()}
                profiles={collectionProfiles}
                records={collectionRecords}
                retryingRecordId={retryingRecordId}
                session={collectionSession}
                starting={isStartingCollection}
                state={collectionPageState}
                stopping={isStoppingCollection}
              />
            ) : activeModule === 'title' ? (
              <TitlePage
                languages={languages}
                models={models}
                onChooseBatchDir={() => void chooseBatchDir()}
                onOpenPath={(path) => void openPath(path)}
                onRetryFailed={() => void retryFailed()}
                onRunBatch={() => void runTitleBatch()}
                onScanBatchDir={() => void scanBatchDir()}
                onStateChange={updateTitleFormState}
                openMessage={openMessage}
                platforms={platforms}
                state={titlePageState}
                titleError={titleError}
              />
            ) : activeModule === 'generation' ? (
              <GenerationPage />
            ) : activeModule === 'listing' ? (
              <ListingPage />
            ) : activeModule === 'ps' ? (
              <div className="space-y-6">
                <PhotoshopStatusBar />
                <PhotoshopMockupPanel />
              </div>
            ) : (
              <DetectionPage />
            )}
          </div>
        )}
      </div>
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
    </Shell>
  )
}

function Onboarding() {
  const navigate = useNavigate()
  const location = useLocation()
  const params = useParams()
  const step = parseOnboardingStep(params.step)
  const requestedStep = params.step
  const forceOnboarding = isForceOnboardingState(location.state)
  const [activationCode, setActivationCode] = useState('')
  const [deviceName, setDeviceName] = useState(defaultDeviceName)
  const [activationMessage, setActivationMessage] = useState<string | null>(null)
  const [isActivating, setIsActivating] = useState(false)
  const [workbenchRoot, setWorkbenchRoot] = useState('')
  const [apiKeys, setApiKeys] = useState<OnboardingApiKeys>({
    chenyu: '',
    grsai: '',
    bailian: '',
    bit_browser_url: '127.0.0.1:54345',
  })
  const [isStateLoaded, setIsStateLoaded] = useState(false)
  const [ready, setReady] = useState(false)

  function enterActivation() {
    setReady(false)
    navigate(onboardingPath(1), { replace: true, state: { forceOnboarding: true } })
  }

  useEffect(() => {
    async function loadState() {
      const state = await window.api.onboarding.getState()
      setWorkbenchRoot(state.default_workbench_root)
      if (!state.needs_onboarding && !forceOnboarding) {
        setReady(true)
        navigate(getStoredWorkbenchRoute(), { replace: true })
      }
      setIsStateLoaded(true)
    }

    void loadState()
  }, [forceOnboarding, navigate])

  const canActivate = useMemo(
    () => /^POD-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(activationCode),
    [activationCode],
  )

  useEffect(() => {
    if (requestedStep && onboardingPath(step) !== `/onboarding/${requestedStep}`) {
      navigate(onboardingPath(step), { replace: true })
    }
  }, [navigate, requestedStep, step])

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
    navigate(onboardingPath(2))
  }

  async function chooseWorkbenchRoot() {
    const result = await window.api.onboarding.chooseWorkbenchRoot()
    if (result.ok) {
      setWorkbenchRoot(result.data.path)
    }
  }

  async function saveWorkbenchRoot() {
    await window.api.onboarding.saveWorkbenchRoot(workbenchRoot)
    navigate(onboardingPath(3))
  }

  async function saveApiKeys(nextStep: OnboardingStep = 4) {
    const cleaned: OnboardingApiKeys = {
      chenyu: apiKeys.chenyu.trim(),
      grsai: apiKeys.grsai.trim(),
      bailian: apiKeys.bailian.trim(),
      bit_browser_url: apiKeys.bit_browser_url.trim(),
    }
    await window.api.onboarding.saveApiKeys(cleaned)
    navigate(onboardingPath(nextStep))
  }

  function updateApiKey(key: OnboardingApiKey, value: string) {
    setApiKeys((current) => ({ ...current, [key]: value }))
  }

  async function complete() {
    await window.api.onboarding.complete()
    setReady(true)
    navigate(getStoredWorkbenchRoute(), { replace: true })
  }

  if (ready) {
    return <MainWorkbench onEnterActivation={enterActivation} />
  }

  if (!isStateLoaded) {
    return (
      <main className="grid min-h-screen place-items-center bg-background text-sm text-muted-foreground">
        正在读取启动状态...
      </main>
    )
  }

  return (
    <OnboardingPage
      activationBadge={<ActivationBadge onEnterActivation={enterActivation} />}
      activationCode={activationCode}
      activationMessage={activationMessage}
      apiKeys={apiKeys}
      canActivate={canActivate}
      deviceName={deviceName}
      isActivating={isActivating}
      onActivate={() => void activate()}
      onActivationCodeChange={(value) => setActivationCode(normalizeActivationCode(value))}
      onApiKeyChange={updateApiKey}
      onChooseWorkbenchRoot={() => void chooseWorkbenchRoot()}
      onComplete={() => void complete()}
      onDeviceNameChange={setDeviceName}
      onNavigateStep={(nextStep) => navigate(onboardingPath(nextStep))}
      onSaveApiKeys={() => void saveApiKeys()}
      onSaveWorkbenchRoot={() => void saveWorkbenchRoot()}
      onWorkbenchRootChange={setWorkbenchRoot}
      step={step}
      workbenchRoot={workbenchRoot}
    />
  )
}

function WorkbenchRoute() {
  const navigate = useNavigate()
  const location = useLocation()
  const [needsOnboarding, setNeedsOnboarding] = useState<boolean | null>(null)

  useEffect(() => {
    async function loadState() {
      const state = await window.api.onboarding.getState()
      setNeedsOnboarding(state.needs_onboarding)
      if (state.needs_onboarding) {
        navigate(onboardingPath(1), { replace: true })
      }
    }

    void loadState()
  }, [navigate])

  if (needsOnboarding === null) {
    return (
      <main className="grid min-h-screen place-items-center bg-background text-sm text-muted-foreground">
        正在读取启动状态...
      </main>
    )
  }

  if (needsOnboarding) {
    return null
  }

  const activePath = isWorkbenchRoute(location.pathname)
    ? location.pathname
    : getStoredWorkbenchRoute()

  if (activePath !== location.pathname) {
    return <Navigate replace to={activePath} />
  }

  return (
    <MainWorkbench
      onEnterActivation={() =>
        navigate(onboardingPath(1), { replace: true, state: { forceOnboarding: true } })
      }
    />
  )
}

function AppRoutes() {
  return (
    <Routes>
      <Route element={<Navigate replace to={getStoredWorkbenchRoute()} />} path="/" />
      <Route element={<Onboarding />} path="/onboarding/:step" />
      <Route element={<WorkbenchRoute />} path="/*" />
      <Route element={<Navigate replace to={getStoredWorkbenchRoute()} />} path="*" />
    </Routes>
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

  return (
    <HashRouter>
      <AppRoutes />
    </HashRouter>
  )
}
