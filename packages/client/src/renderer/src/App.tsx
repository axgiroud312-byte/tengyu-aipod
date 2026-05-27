import { Button } from '@/components/ui/button'
import {
  CollectionPage,
  type CollectionPageState,
  type CollectionPlatformOption,
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
import { PhotoshopPage } from '@/features/photoshop/PhotoshopPage'
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
import type { ActivationBadgeState } from '@tengyu-aipod/shared'
import { AlertTriangle, RefreshCw } from 'lucide-react'
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
import type { BitBrowserProfileWithStatus } from '../../main/lib/bit-browser-client'
import type { CollectionPlatformRule } from '../../main/lib/collection-injected-script'
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

const defaultCollectionPageState: CollectionPageState = {
  platform: 'temu',
  profileId: '',
  mode: 'click',
  outputDir: '',
  scrollKeywords: '',
  minWidth: 0,
  maxWidth: 0,
  minHeight: 0,
  maxHeight: 0,
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

function nonNegativeInteger(value: number) {
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : 0
}

function parseOnboardingStep(value: string | undefined): OnboardingStep {
  const parsed = Number(value)
  return parsed === 1 || parsed === 2 || parsed === 3 || parsed === 4 ? parsed : 1
}

function collectionPlatformOption(rule: CollectionPlatformRule): CollectionPlatformOption {
  return {
    key: rule.key,
    label: rule.name,
    detail: rule.entry_url,
  }
}

function collectionProfileOption(profile: BitBrowserProfileWithStatus): CollectionProfileOption {
  const detailItems = [
    profile.remark,
    profile.platform,
    profile.url,
    profile.seq !== undefined ? `序号 ${profile.seq}` : null,
  ].filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
  return {
    id: profile.id,
    label: profile.name,
    detail: detailItems.join(' · ') || profile.id,
    online: profile.online,
  }
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
  const [collectionPlatforms, setCollectionPlatforms] = useState<CollectionPlatformOption[]>([])
  const [collectionProfiles, setCollectionProfiles] = useState<CollectionProfileOption[]>([])
  const [isStartingCollection, setIsStartingCollection] = useState(false)
  const [isStoppingCollection, setIsStoppingCollection] = useState(false)
  const [isResumingCollection, setIsResumingCollection] = useState(false)
  const [isRefreshingCollectionProfiles, setIsRefreshingCollectionProfiles] = useState(false)
  const [deletingRecordId, setDeletingRecordId] = useState<string | null>(null)
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
    let mounted = true
    async function loadCollectionPlatforms() {
      try {
        const rules = await window.api.collection.listPlatforms()
        if (!mounted) {
          return
        }
        const options = rules.map(collectionPlatformOption)
        setCollectionPlatforms(options)
        setCollectionPageState((current) => {
          if (options.some((item) => item.key === current.platform)) {
            return current
          }
          const firstPlatform = options[0]?.key
          return firstPlatform ? { ...current, platform: firstPlatform } : current
        })
      } catch (error) {
        if (mounted) {
          setCollectionError(error instanceof Error ? error.message : '读取采集平台失败')
        }
      }
    }
    void loadCollectionPlatforms()
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
      void refreshCollectionProfiles()
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
        limit: 10_000,
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

  async function chooseCollectionOutputDir() {
    const result = await window.api.onboarding.chooseWorkbenchRoot()
    if (result.ok) {
      updateCollectionPageState('outputDir', result.data.path)
      setCollectionError(null)
      return
    }
    if (result.error.code !== 'CANCELLED') {
      setCollectionError(result.error.message)
    }
  }

  async function refreshCollectionProfiles() {
    setIsRefreshingCollectionProfiles(true)
    try {
      const profiles = await window.api.collection.listProfiles()
      setCollectionProfiles(profiles.map(collectionProfileOption))
      setCollectionError(null)
    } catch (error) {
      setCollectionError(error instanceof Error ? error.message : '读取比特浏览器环境失败')
    } finally {
      setIsRefreshingCollectionProfiles(false)
    }
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
        size_filter: {
          min_width: nonNegativeInteger(collectionPageState.minWidth),
          max_width: nonNegativeInteger(collectionPageState.maxWidth),
          min_height: nonNegativeInteger(collectionPageState.minHeight),
          max_height: nonNegativeInteger(collectionPageState.maxHeight),
        },
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

  async function resumeCollectionSession() {
    setIsResumingCollection(true)
    setCollectionError(null)
    try {
      const session = await window.api.collection.resumeSession()
      setCollectionSession(session)
      await refreshCollectionRecords()
    } catch (error) {
      setCollectionError(error instanceof Error ? error.message : '恢复采集会话失败')
    } finally {
      setIsResumingCollection(false)
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

  async function deleteCollectionRecord(recordId: string) {
    setDeletingRecordId(recordId)
    try {
      await window.api.collection.deleteRecord({ record_id: recordId })
      await refreshCollectionRecords()
      setCollectionError(null)
    } catch (error) {
      setCollectionError(error instanceof Error ? error.message : '删除采集记录失败')
    } finally {
      setDeletingRecordId(null)
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
                deletingRecordId={deletingRecordId}
                error={collectionError}
                onOutputDirBrowse={() => void chooseCollectionOutputDir()}
                onDeleteRecord={(recordId) => void deleteCollectionRecord(recordId)}
                onRefreshProfiles={() => void refreshCollectionProfiles()}
                onRefreshRecords={() => void refreshCollectionRecords()}
                onResumeSession={() => void resumeCollectionSession()}
                onRetryRecord={(recordId) => void retryCollectionRecord(recordId)}
                onStartSession={() => void startCollectionSession()}
                onStateChange={updateCollectionPageState}
                onStopSession={() => void stopCollectionSession()}
                platforms={collectionPlatforms}
                profiles={collectionProfiles}
                refreshingProfiles={isRefreshingCollectionProfiles}
                records={collectionRecords}
                resuming={isResumingCollection}
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
              <PhotoshopPage />
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
