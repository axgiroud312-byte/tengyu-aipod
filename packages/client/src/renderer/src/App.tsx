import { Button } from '@/components/ui/button'
import {
  CollectionPage,
  type CollectionPageState,
  type CollectionPlatformOption,
  type CollectionProfileOption,
} from '@/features/collection/CollectionPage'
import {
  collectionImagePoolKey,
  mergeCollectionImagePoolItems,
} from '@/features/collection/image-pool'
import { CustomerLoginPage } from '@/features/customer-auth/CustomerLoginPage'
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
import { FullTaskPage } from '@/features/pipeline/FullTaskPage'
import { SettingsPage } from '@/features/settings/SettingsPage'
import {
  type TitleExistingStrategy,
  type TitleFormState,
  type TitleKeywordGroupDraft,
  TitlePage,
  type TitlePageState,
  createTitleKeywordGroupDraft,
} from '@/features/title/TitlePage'
import { TutorialPage } from '@/features/tutorial/TutorialPage'
import { Shell } from '@/layout/Shell'
import {
  type WorkbenchModule,
  getStoredWorkbenchRoute,
  isWorkbenchRoute,
  moduleFromPath,
  workbenchModules,
} from '@/layout/navigation'
import { AlertTriangle, Loader2 } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
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
import type { CollectionConfig } from '../../main/lib/collection-config'
import type {
  CollectionCurrentPageResult,
  CollectionImageIndexClickResult,
  CollectionImageIndexDownloadResult,
  CollectionImageIndexItem,
  CollectionImageIndexScanResult,
} from '../../main/lib/collection-image-index-service'
import type { CollectionPlatformRule } from '../../main/lib/collection-injected-script'
import type { CollectionRecordRow } from '../../main/lib/collection-record-store'
import type {
  CollectionDebugLogEntry,
  CollectionDebugLogLevel,
} from '../../main/lib/collection-session-manager'
import type { CollectionSession } from '../../main/lib/collection-session-manager'
import type { CollectionSessionEvent } from '../../main/lib/collection-session-manager'
import type { CustomerAuthState } from '../../main/lib/customer-auth'
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
  searchSeeMoreClicks: 1,
}

const COLLECTION_SKU_PROMPT_COLLAPSE_MS = 120_000
const COLLECTION_DEBUG_LOG_LIMIT = 1000
const CUSTOMER_AUTH_RECHECK_MS = 5 * 60 * 1000
const CUSTOMER_AUTH_PENDING_RECHECK_MS = 3 * 1000

const anonymousCustomerAuthState: CustomerAuthState = {
  customer: null,
  message: null,
  status: 'anonymous',
}

type CollectionDebugDetails = Record<string, string | number | boolean | null | undefined>

function compactCollectionDebugDetails(details: CollectionDebugDetails) {
  const compacted: Record<string, string | number | boolean | null> = {}
  for (const [key, value] of Object.entries(details)) {
    if (value !== undefined) {
      compacted[key] = value
    }
  }
  return compacted
}
const COLLECTION_CONFIG_SAVE_DEBOUNCE_MS = 400
const COLLECTION_CURRENT_PAGE_POLL_MS = 1_500

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

function searchSeeMoreClicks(value: number) {
  if (!Number.isFinite(value)) {
    return 1
  }
  return Math.min(10, Math.max(0, Math.floor(value)))
}

function parseOnboardingStep(value: string | undefined): OnboardingStep {
  const parsed = Number(value)
  return parsed === 1 || parsed === 2 ? parsed : 1
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

function collectionPageStateFromConfig(config: CollectionConfig): CollectionPageState {
  return {
    platform: config.platform,
    profileId: config.profile_id,
    mode: config.mode,
    outputDir: '',
    scrollKeywords: config.scroll_keywords,
    minWidth: config.size_filter.min_width,
    maxWidth: config.size_filter.max_width,
    minHeight: config.size_filter.min_height,
    maxHeight: config.size_filter.max_height,
    searchSeeMoreClicks: 1,
  }
}

function collectionConfigFromPageState(state: CollectionPageState): CollectionConfig {
  return {
    platform: state.platform,
    profile_id: state.profileId,
    mode: state.mode,
    output_dir: '',
    scroll_keywords: state.scrollKeywords,
    size_filter: {
      min_width: nonNegativeInteger(state.minWidth),
      max_width: nonNegativeInteger(state.maxWidth),
      min_height: nonNegativeInteger(state.minHeight),
      max_height: nonNegativeInteger(state.maxHeight),
    },
  }
}

function temuSearchUrl(keyword: string) {
  const trimmed = keyword.trim()
  if (!trimmed) {
    return ''
  }
  return `https://www.temu.com/search_result.html?search_key=${encodeURIComponent(trimmed)}&search_method=user`
}

function isTemuVerificationPageUrl(value: string | null | undefined) {
  if (!value) {
    return false
  }
  try {
    const url = new URL(value)
    return /(\.|^)temu\.com$/i.test(url.hostname) && url.pathname.includes('/bgn_verification.html')
  } catch {
    return false
  }
}

function onboardingPath(step: OnboardingStep) {
  return `/onboarding/${step}`
}

function WorkspaceRequired({ onOpenSettings }: { onOpenSettings: () => void }) {
  return (
    <div className="mt-20 max-w-xl space-y-5 rounded-md border border-white/70 bg-card/90 p-6 shadow-[0_22px_56px_rgba(30,64,175,0.1)] backdrop-blur-xl">
      <div className="flex items-start gap-3">
        <AlertTriangle className="mt-1 h-5 w-5 shrink-0 text-amber-600" />
        <div className="space-y-2">
          <h1 className="text-2xl font-semibold tracking-normal">请先选择工作区</h1>
          <p className="text-sm leading-6 text-muted-foreground">
            采集、生图、检测、PS
            套版、标题和上架都会把文件写入工作区。选择后会自动创建采集工作区、印花工作区、检测工作区和上架工作区。
          </p>
        </div>
      </div>
      <Button onClick={onOpenSettings} type="button">
        去设置页选择工作区
      </Button>
    </div>
  )
}

function MainWorkbench() {
  const location = useLocation()
  const navigate = useNavigate()
  const activeModule = moduleFromPath(location.pathname) ?? 'collection'
  const [workspaceRoot, setWorkspaceRoot] = useState<string | null>(null)
  const [isWorkspaceLoaded, setIsWorkspaceLoaded] = useState(false)
  const [platforms, setPlatforms] = useState<Array<{ key: string; label: string }>>([])
  const [languages, setLanguages] = useState<Array<{ key: string; label: string }>>([])
  const [models, setModels] = useState<Array<{ key: string; label: string }>>([])
  const [batchDir, setBatchDir] = useState('')
  const [platform, setPlatform] = useState('temu')
  const [language, setLanguage] = useState('en')
  const [model, setModel] = useState('qwen3.6-flash')
  const [titleFileName, setTitleFileName] = useState('标题')
  const [keywordGroups, setKeywordGroups] = useState<TitleKeywordGroupDraft[]>(() => [
    createTitleKeywordGroupDraft(),
  ])
  const [keywordGroupSeparator, setKeywordGroupSeparator] = useState(' ')
  const [imageIndex, setImageIndex] = useState('1')
  const [extraRequirement, setExtraRequirement] = useState('')
  const [existingStrategy, setExistingStrategy] = useState<TitleExistingStrategy>('skip')
  const [maxRetries, setMaxRetries] = useState('2')
  const [compression, setCompression] = useState(true)
  const [maxSize, setMaxSize] = useState('1024')
  const [scanResult, setScanResult] = useState<{
    skuCount: number
    skuCodes: string[]
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
  const [collectionDebugLogs, setCollectionDebugLogs] = useState<CollectionDebugLogEntry[]>([])
  const collectionDebugLogSequenceRef = useRef(0)
  const [collectionImageIndexScan, setCollectionImageIndexScan] =
    useState<CollectionImageIndexScanResult | null>(null)
  const [collectionImageIndexClick, setCollectionImageIndexClick] =
    useState<CollectionImageIndexClickResult | null>(null)
  const [collectionImageIndexDownload, setCollectionImageIndexDownload] =
    useState<CollectionImageIndexDownloadResult | null>(null)
  const [collectionCurrentPage, setCollectionCurrentPage] =
    useState<CollectionCurrentPageResult | null>(null)
  const [isDetectingCollectionCurrentPage, setIsDetectingCollectionCurrentPage] = useState(false)
  const [isOpeningCollectionSearchPage, setIsOpeningCollectionSearchPage] = useState(false)
  const [isOpeningCollectionShopPage, setIsOpeningCollectionShopPage] = useState(false)
  const [collectionImagePoolItems, setCollectionImagePoolItems] = useState<
    CollectionImageIndexItem[]
  >([])
  const [collectionSelectedImageIds, setCollectionSelectedImageIds] = useState<Set<string>>(
    () => new Set(),
  )
  const [collectionLastScanAddedCount, setCollectionLastScanAddedCount] = useState(0)
  const [collectionLastScanExistingCount, setCollectionLastScanExistingCount] = useState(0)
  const [collectionLastDownloadFailedCount, setCollectionLastDownloadFailedCount] = useState(0)
  const detectingCollectionCurrentPageRef = useRef(false)
  const [collectionPageState, setCollectionPageState] = useState<CollectionPageState>(
    defaultCollectionPageState,
  )
  const [isCollectionConfigLoaded, setIsCollectionConfigLoaded] = useState(false)
  const [collectionPlatforms, setCollectionPlatforms] = useState<CollectionPlatformOption[]>([])
  const [collectionProfiles, setCollectionProfiles] = useState<CollectionProfileOption[]>([])
  const [isStartingCollection, setIsStartingCollection] = useState(false)
  const [isStoppingCollection, setIsStoppingCollection] = useState(false)
  const [isResumingCollection, setIsResumingCollection] = useState(false)
  const [isRefreshingCollectionProfiles, setIsRefreshingCollectionProfiles] = useState(false)
  const [isScanningCollectionImageIndex, setIsScanningCollectionImageIndex] = useState(false)
  const [isProbingCollectionImageIndexClick, setIsProbingCollectionImageIndexClick] =
    useState(false)
  const [isDownloadingCollectionImageIndex, setIsDownloadingCollectionImageIndex] = useState(false)
  const [deletingRecordId, setDeletingRecordId] = useState<string | null>(null)
  useEffect(() => {
    let mounted = true
    async function loadWorkspace() {
      try {
        const state = await window.api.workspace.getState()
        if (mounted) {
          setWorkspaceRoot(state.root)
        }
      } finally {
        if (mounted) {
          setIsWorkspaceLoaded(true)
        }
      }
    }
    void loadWorkspace()
    return () => {
      mounted = false
    }
  }, [])

  useEffect(() => {
    let mounted = true
    async function loadCollectionConfig() {
      if (!workspaceRoot) {
        setIsCollectionConfigLoaded(true)
        return
      }
      setIsCollectionConfigLoaded(false)
      try {
        const config = await window.api.collection.getConfig()
        if (!mounted) {
          return
        }
        if (config) {
          setCollectionPageState(collectionPageStateFromConfig(config))
        }
        setIsCollectionConfigLoaded(true)
      } catch (error) {
        if (mounted) {
          setCollectionError(error instanceof Error ? error.message : '读取采集设置失败')
          setIsCollectionConfigLoaded(true)
        }
      }
    }
    void loadCollectionConfig()
    return () => {
      mounted = false
    }
  }, [workspaceRoot])

  useEffect(() => {
    if (!isCollectionConfigLoaded || !workspaceRoot) {
      return
    }
    let cancelled = false
    const timeout = window.setTimeout(() => {
      window.api.collection
        .saveConfig(collectionConfigFromPageState(collectionPageState))
        .catch((error) => {
          if (!cancelled) {
            setCollectionError(error instanceof Error ? error.message : '保存采集设置失败')
          }
        })
    }, COLLECTION_CONFIG_SAVE_DEBOUNCE_MS)
    return () => {
      cancelled = true
      window.clearTimeout(timeout)
    }
  }, [collectionPageState, isCollectionConfigLoaded, workspaceRoot])

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
    if (!isCollectionConfigLoaded || collectionPlatforms.length === 0) {
      return
    }
    setCollectionPageState((current) => {
      if (collectionPlatforms.some((item) => item.key === current.platform)) {
        return current
      }
      const firstPlatform = collectionPlatforms[0]?.key
      return firstPlatform ? { ...current, platform: firstPlatform } : current
    })
  }, [collectionPlatforms, isCollectionConfigLoaded])

  useEffect(() => {
    const offCollectionEvent = window.api.collection.onEvent((event) => {
      if (event.type === 'debug-log') {
        setCollectionDebugLogs((current) =>
          [...current, event.entry].slice(-COLLECTION_DEBUG_LOG_LIMIT),
        )
      }
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
    const profileId = collectionPageState.profileId.trim()
    const platform = collectionPageState.platform
    if (activeModule !== 'collection' || !profileId || !platform) {
      setCollectionCurrentPage(null)
      return
    }
    let cancelled = false
    async function tick(showLoading = false) {
      if (cancelled) {
        return
      }
      await refreshCollectionCurrentPage(showLoading)
    }
    void tick(true)
    const timer = window.setInterval(() => {
      void tick(false)
    }, COLLECTION_CURRENT_PAGE_POLL_MS)
    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [activeModule, collectionPageState.platform, collectionPageState.profileId])

  useEffect(() => {
    const offProgress = window.api.title.onProgress((nextProgress) => {
      setProgress(nextProgress)
      setTaskId(nextProgress.task_id)
    })
    const offCompleted = window.api.title.onCompleted((event: TitleTaskEvent) => {
      if (event.ok) {
        setResult(event.result)
        setIsRetryingFailed(false)
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
          ...(event.result.diagnosticsLogPath
            ? { diagnosticsLogPath: event.result.diagnosticsLogPath }
            : {}),
          ...(event.result.cancelled ? { status: 'cancelled' as const } : {}),
        }))
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
    titleFileName,
    keywordGroups,
    keywordGroupSeparator,
    imageIndex,
    extraRequirement,
    existingStrategy,
    maxRetries,
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
      case 'titleFileName':
        if (typeof value === 'string') setTitleFileName(value)
        return
      case 'keywordGroups':
        if (Array.isArray(value)) setKeywordGroups(value)
        return
      case 'keywordGroupSeparator':
        if (typeof value === 'string') setKeywordGroupSeparator(value)
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
      const nextScan = await window.api.title.scanBatchDir({
        batchDir: path.trim(),
        titleFileName,
      })
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
    const generationSettings = await window.api.generationSettings.get().catch(() => null)
    const titleConfig: TitleBatchConfig = {
      batchDir: batchDir.trim(),
      titleFileName,
      platform,
      language,
      model,
      keywordGroups,
      keywordGroupSeparator,
      imageIndex: parsePositiveNumber(imageIndex, 1),
      existingStrategy,
      maxRetries: parseNonNegativeNumber(maxRetries, 2),
      concurrency: generationSettings?.config.default_concurrency ?? 20,
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

  async function cancelTitleBatch() {
    if (!taskId) {
      setTitleError('没有正在运行的标题任务')
      return
    }
    const response = await window.api.title.cancel({ task_id: taskId })
    if (!response.ok) {
      setTitleError('当前标题任务已结束，无法取消')
      return
    }
    setTitleError(null)
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

  function clearCollectionDebugLogs() {
    setCollectionDebugLogs([])
  }

  function appendCollectionDebugLog(
    message: string,
    level: CollectionDebugLogLevel = 'info',
    details?: CollectionDebugDetails,
  ) {
    const compacted = details ? compactCollectionDebugDetails(details) : null
    setCollectionDebugLogs((current) =>
      [
        ...current,
        {
          id: `${Date.now()}-renderer-${++collectionDebugLogSequenceRef.current}`,
          timestamp: Date.now(),
          level,
          message,
          ...(compacted && Object.keys(compacted).length > 0 ? { details: compacted } : {}),
        },
      ].slice(-COLLECTION_DEBUG_LOG_LIMIT),
    )
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

  async function refreshCollectionCurrentPage(showLoading = false) {
    const profileId = collectionPageState.profileId.trim()
    if (!profileId) {
      setCollectionCurrentPage(null)
      return
    }
    if (detectingCollectionCurrentPageRef.current) {
      return
    }
    detectingCollectionCurrentPageRef.current = true
    if (showLoading) {
      setIsDetectingCollectionCurrentPage(true)
    }
    try {
      const result = await window.api.collection.getCurrentPage({
        platform: collectionPageState.platform,
        profile_id: profileId,
      })
      setCollectionCurrentPage(result)
    } catch (error) {
      setCollectionError(error instanceof Error ? error.message : '检测当前操作页面失败')
    } finally {
      detectingCollectionCurrentPageRef.current = false
      if (showLoading) {
        setIsDetectingCollectionCurrentPage(false)
      }
    }
  }

  async function openCollectionSearchPage(keyword: string) {
    const profileId = collectionPageState.profileId.trim()
    if (!profileId) {
      setCollectionError('请先选择或填写比特浏览器环境编号')
      return
    }
    const pageUrl = collectionPageState.platform === 'temu' ? temuSearchUrl(keyword) : ''
    if (!pageUrl) {
      setCollectionError('当前平台暂未配置关键词搜索入口，请在比特浏览器里手动打开页面')
      return
    }
    setIsOpeningCollectionSearchPage(true)
    setCollectionError(null)
    try {
      const result = await window.api.collection.openPage({
        platform: collectionPageState.platform,
        profile_id: profileId,
        page_url: pageUrl,
      })
      setCollectionCurrentPage(result)
      if (isTemuVerificationPageUrl(result.pageUrl)) {
        setCollectionError('Temu 进入安全验证页，请先在比特浏览器完成验证后再扫描图池')
      }
    } catch (error) {
      setCollectionError(error instanceof Error ? error.message : '打开搜索页面失败')
    } finally {
      setIsOpeningCollectionSearchPage(false)
    }
  }

  async function openCollectionShopPage(pageUrl: string) {
    const profileId = collectionPageState.profileId.trim()
    const targetPageUrl = pageUrl.trim()
    if (!profileId) {
      setCollectionError('请先选择或填写比特浏览器环境编号')
      return
    }
    if (collectionPageState.platform !== 'temu') {
      setCollectionError('当前只有 Temu 支持店铺链接采集')
      return
    }
    if (!targetPageUrl) {
      setCollectionError('请先输入 Temu 店铺链接')
      return
    }

    setIsOpeningCollectionShopPage(true)
    setCollectionError(null)
    try {
      const result = await window.api.collection.openPage({
        platform: collectionPageState.platform,
        profile_id: profileId,
        page_url: targetPageUrl,
      })
      setCollectionCurrentPage(result)
      if (isTemuVerificationPageUrl(result.pageUrl)) {
        setCollectionError('Temu 进入安全验证页，请先在比特浏览器完成验证后再扫描图池')
      }
    } catch (error) {
      setCollectionError(error instanceof Error ? error.message : '打开店铺页失败')
    } finally {
      setIsOpeningCollectionShopPage(false)
    }
  }

  function collectionImageIndexRequest(limit?: number, pageUrl?: string) {
    const profileId = collectionPageState.profileId.trim()
    if (!profileId) {
      throw new Error('请先选择或填写比特浏览器环境编号')
    }
    const outputDir = collectionSession?.output_dir
    return {
      platform: collectionPageState.platform,
      profile_id: profileId,
      ...(outputDir ? { output_dir: outputDir } : {}),
      ...(pageUrl?.trim() ? { page_url: pageUrl.trim() } : {}),
      ...(limit !== undefined ? { limit } : {}),
      see_more_clicks: searchSeeMoreClicks(collectionPageState.searchSeeMoreClicks),
    }
  }

  async function scanCollectionImageIndex(pageUrl?: string) {
    const targetPageUrl = pageUrl?.trim() || collectionCurrentPage?.pageUrl.trim()
    if (!targetPageUrl) {
      setCollectionError('请先在比特浏览器打开当前平台页面')
      appendCollectionDebugLog('扫描图池失败：未找到当前平台页面', 'warn', {
        operation: 'scan',
        stage: 'failed',
      })
      return
    }
    if (isTemuVerificationPageUrl(targetPageUrl)) {
      setCollectionError('当前是 Temu 安全验证页，请先在比特浏览器完成验证后再扫描图池')
      appendCollectionDebugLog('扫描图池已跳过：当前是 Temu 安全验证页', 'warn', {
        operation: 'scan',
        stage: 'blocked',
        pageUrl: targetPageUrl,
      })
      return
    }
    setIsScanningCollectionImageIndex(true)
    setCollectionError(null)
    appendCollectionDebugLog('----- 扫描图池任务开始 -----', 'info', {
      operation: 'scan',
      stage: 'start',
      pageUrl: targetPageUrl,
    })
    try {
      const result = await window.api.collection.scanImageIndex(
        collectionImageIndexRequest(0, targetPageUrl),
      )
      const scannedAt = Date.now()
      const mergeResult = mergeCollectionImagePoolItems(
        collectionImagePoolItems,
        result.items,
        result,
        scannedAt,
      )
      setCollectionImagePoolItems(mergeResult.items)
      setCollectionSelectedImageIds((current) => {
        if (mergeResult.addedItems.length === 0) {
          return current
        }
        const next = new Set(current)
        for (const item of mergeResult.addedItems) {
          next.add(item.id)
        }
        return next
      })
      setCollectionLastScanAddedCount(mergeResult.addedItems.length)
      setCollectionLastScanExistingCount(mergeResult.existingCount)
      setCollectionImageIndexScan(result)
      setCollectionImageIndexClick(null)
      setCollectionImageIndexDownload(null)
      appendCollectionDebugLog(
        mergeResult.addedItems.length > 0 ? '图池合并完成' : '图池合并完成：本次扫描图片已存在',
        mergeResult.addedItems.length > 0 ? 'info' : 'warn',
        {
          operation: 'scan',
          stage: 'finish',
          added: mergeResult.addedItems.length,
          existing: mergeResult.existingCount,
          total: mergeResult.items.length,
          pageUrl: result.pageUrl,
        },
      )
    } catch (error) {
      const message = error instanceof Error ? error.message : '扫描图片索引池失败'
      setCollectionError(message)
      appendCollectionDebugLog('扫描图池失败', 'error', {
        operation: 'scan',
        stage: 'failed',
        error: message,
        pageUrl: targetPageUrl,
      })
    } finally {
      setIsScanningCollectionImageIndex(false)
    }
  }

  async function probeCollectionImageIndexClick(pageUrl?: string) {
    setIsProbingCollectionImageIndexClick(true)
    setCollectionError(null)
    try {
      const result = await window.api.collection.probeImageIndexClick(
        collectionImageIndexRequest(80, pageUrl),
      )
      setCollectionImageIndexClick(result)
      if (!result.timedOut && result.item) {
        setCollectionImageIndexScan((current) =>
          current && current.pageUrl === result.pageUrl ? current : null,
        )
      }
    } catch (error) {
      setCollectionError(error instanceof Error ? error.message : '测试点击命中失败')
    } finally {
      setIsProbingCollectionImageIndexClick(false)
    }
  }

  async function downloadCollectionImageIndexSample(pageUrl?: string) {
    setIsDownloadingCollectionImageIndex(true)
    setCollectionError(null)
    try {
      const result = await window.api.collection.downloadImageIndexSample(
        collectionImageIndexRequest(5, pageUrl),
      )
      setCollectionImageIndexDownload(result)
      setCollectionImageIndexScan(result.scan)
    } catch (error) {
      setCollectionError(error instanceof Error ? error.message : '下载索引池样例失败')
    } finally {
      setIsDownloadingCollectionImageIndex(false)
    }
  }

  async function downloadCollectionImageIndexItems(
    items: CollectionImageIndexItem[],
    pageUrl?: string,
  ) {
    if (items.length === 0) {
      setCollectionError('请先勾选要下载的图片')
      appendCollectionDebugLog('下载图池失败：没有勾选图片', 'warn', {
        operation: 'download',
        stage: 'failed',
      })
      return
    }
    setIsDownloadingCollectionImageIndex(true)
    setCollectionError(null)
    appendCollectionDebugLog('----- 下载图池任务开始 -----', 'info', {
      operation: 'download',
      stage: 'start',
      total: items.length,
      pageUrl: pageUrl ?? collectionCurrentPage?.pageUrl ?? null,
    })
    try {
      const result = await window.api.collection.downloadImageIndexItems({
        ...collectionImageIndexRequest(undefined, pageUrl),
        items,
      })
      const savedKeys = new Set(result.saved.map((item) => collectionImagePoolKey(item.item)))
      setCollectionImageIndexDownload(result)
      setCollectionLastDownloadFailedCount(result.failed.length)
      if (savedKeys.size > 0) {
        setCollectionImagePoolItems((current) =>
          current.filter((item) => !savedKeys.has(collectionImagePoolKey(item))),
        )
        setCollectionSelectedImageIds((current) => {
          const next = new Set(current)
          for (const item of result.saved) {
            next.delete(item.item.id)
          }
          return next
        })
      }
      appendCollectionDebugLog('前端图池更新完成', result.failed.length > 0 ? 'warn' : 'info', {
        operation: 'download',
        stage: 'finish',
        saved: result.saved.length,
        failed: result.failed.length,
        total: items.length,
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : '下载图池图片失败'
      setCollectionError(message)
      appendCollectionDebugLog('下载图池失败', 'error', {
        operation: 'download',
        stage: 'failed',
        error: message,
        total: items.length,
      })
    } finally {
      setIsDownloadingCollectionImageIndex(false)
    }
  }

  function toggleCollectionImagePoolItem(itemId: string, checked: boolean) {
    setCollectionSelectedImageIds((current) => {
      const next = new Set(current)
      if (checked) {
        next.add(itemId)
      } else {
        next.delete(itemId)
      }
      return next
    })
  }

  function selectAllCollectionImagePoolItems() {
    setCollectionSelectedImageIds(new Set(collectionImagePoolItems.map((item) => item.id)))
  }

  function clearCollectionImagePoolSelection() {
    setCollectionSelectedImageIds(new Set())
  }

  function clearCollectionImagePool() {
    setCollectionImagePoolItems([])
    setCollectionSelectedImageIds(new Set())
    setCollectionLastScanAddedCount(0)
    setCollectionLastScanExistingCount(0)
    setCollectionLastDownloadFailedCount(0)
    setCollectionImageIndexScan(null)
    setCollectionImageIndexDownload(null)
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
      await window.api.collection.saveConfig(collectionConfigFromPageState(collectionPageState))
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
    <Shell>
      <div className="space-y-6">
        {!isWorkspaceLoaded ? (
          <div className="mt-20 text-sm text-muted-foreground">正在读取工作区...</div>
        ) : activeModule !== 'settings' && activeModule !== 'tutorial' && !workspaceRoot ? (
          <WorkspaceRequired onOpenSettings={() => navigate('/settings')} />
        ) : (
          <div className="space-y-6">
            {workspaceRoot ? (
              <>
                <div hidden={activeModule !== 'collection'}>
                  <CollectionPage
                    currentPage={collectionCurrentPage}
                    debugLogs={collectionDebugLogs}
                    deletingRecordId={deletingRecordId}
                    detectingCurrentPage={isDetectingCollectionCurrentPage}
                    error={collectionError}
                    imageIndexClick={collectionImageIndexClick}
                    imageIndexDownload={collectionImageIndexDownload}
                    imagePoolItems={collectionImagePoolItems}
                    imageIndexScan={collectionImageIndexScan}
                    imageIndexScanning={isScanningCollectionImageIndex}
                    imageIndexClickProbing={isProbingCollectionImageIndexClick}
                    imageIndexDownloading={isDownloadingCollectionImageIndex}
                    onClearDebugLogs={clearCollectionDebugLogs}
                    onClearImagePool={clearCollectionImagePool}
                    onClearImagePoolSelection={clearCollectionImagePoolSelection}
                    onDownloadImageIndexSample={(pageUrl) =>
                      void downloadCollectionImageIndexSample(pageUrl)
                    }
                    onDownloadImageIndexItems={(items, pageUrl) =>
                      void downloadCollectionImageIndexItems(items, pageUrl)
                    }
                    onDeleteRecord={(recordId) => void deleteCollectionRecord(recordId)}
                    onOpenSearchPage={(keyword) => void openCollectionSearchPage(keyword)}
                    onOpenShopPage={(pageUrl) => void openCollectionShopPage(pageUrl)}
                    onProbeImageIndexClick={(pageUrl) =>
                      void probeCollectionImageIndexClick(pageUrl)
                    }
                    onRefreshProfiles={() => void refreshCollectionProfiles()}
                    onRefreshRecords={() => void refreshCollectionRecords()}
                    onResumeSession={() => void resumeCollectionSession()}
                    onRetryRecord={(recordId) => void retryCollectionRecord(recordId)}
                    onScanImageIndex={(pageUrl) => void scanCollectionImageIndex(pageUrl)}
                    onSelectAllImagePoolItems={selectAllCollectionImagePoolItems}
                    onStartSession={() => void startCollectionSession()}
                    onStateChange={updateCollectionPageState}
                    onStopSession={() => void stopCollectionSession()}
                    onToggleImagePoolItem={toggleCollectionImagePoolItem}
                    lastDownloadFailedCount={collectionLastDownloadFailedCount}
                    lastScanAddedCount={collectionLastScanAddedCount}
                    lastScanExistingCount={collectionLastScanExistingCount}
                    openingSearchPage={isOpeningCollectionSearchPage}
                    openingShopPage={isOpeningCollectionShopPage}
                    platforms={collectionPlatforms}
                    profiles={collectionProfiles}
                    refreshingProfiles={isRefreshingCollectionProfiles}
                    records={collectionRecords}
                    resuming={isResumingCollection}
                    retryingRecordId={retryingRecordId}
                    selectedImageIds={collectionSelectedImageIds}
                    session={collectionSession}
                    starting={isStartingCollection}
                    state={collectionPageState}
                    stopping={isStoppingCollection}
                  />
                </div>
                <div hidden={activeModule !== 'title'}>
                  <TitlePage
                    languages={languages}
                    models={models}
                    onChooseBatchDir={() => void chooseBatchDir()}
                    onOpenPath={(path) => void openPath(path)}
                    onRetryFailed={() => void retryFailed()}
                    onRunBatch={() => void runTitleBatch()}
                    onScanBatchDir={() => void scanBatchDir()}
                    onCancelBatch={() => void cancelTitleBatch()}
                    onStateChange={updateTitleFormState}
                    openMessage={openMessage}
                    platforms={platforms}
                    state={titlePageState}
                    titleError={titleError}
                  />
                </div>
                <div hidden={activeModule !== 'generation'}>
                  <GenerationPage />
                </div>
                <div hidden={activeModule !== 'pipeline'}>
                  <FullTaskPage />
                </div>
                <div hidden={activeModule !== 'listing'}>
                  <ListingPage />
                </div>
                <div hidden={activeModule !== 'ps'}>
                  <PhotoshopPage />
                </div>
                <div hidden={activeModule !== 'detection'}>
                  <DetectionPage />
                </div>
              </>
            ) : null}
            <div hidden={activeModule !== 'settings'}>
              <SettingsPage onWorkspaceSaved={setWorkspaceRoot} />
            </div>
            <div hidden={activeModule !== 'tutorial'}>
              <TutorialPage />
            </div>
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
  const params = useParams()
  const step = parseOnboardingStep(params.step)
  const requestedStep = params.step
  const [apiKeys, setApiKeys] = useState<OnboardingApiKeys>({
    chenyu: '',
    grsai: '',
    bailian: '',
    bit_browser_url: '127.0.0.1:54345',
  })
  const [isStateLoaded, setIsStateLoaded] = useState(false)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    async function loadState() {
      const state = await window.api.onboarding.getState()
      if (!state.needs_onboarding) {
        setReady(true)
        navigate(getStoredWorkbenchRoute(), { replace: true })
      }
      setIsStateLoaded(true)
    }

    void loadState()
  }, [navigate])

  useEffect(() => {
    if (requestedStep && onboardingPath(step) !== `/onboarding/${requestedStep}`) {
      navigate(onboardingPath(step), { replace: true })
    }
  }, [navigate, requestedStep, step])

  async function saveApiKeys(nextStep: OnboardingStep = 2) {
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

  async function openTutorial() {
    await window.api.onboarding.complete()
    setReady(true)
    navigate('/tutorial', { replace: true })
  }

  if (ready) {
    return <MainWorkbench />
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
      apiKeys={apiKeys}
      onApiKeyChange={updateApiKey}
      onComplete={() => void complete()}
      onOpenTutorial={() => void openTutorial()}
      onSaveApiKeys={() => void saveApiKeys()}
      step={step}
    />
  )
}

function EnteringWorkbench() {
  return (
    <main className="grid min-h-screen place-items-center bg-background text-foreground">
      <div className="flex items-center gap-3 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" />
        正在进入工作台...
      </div>
    </main>
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
    return <EnteringWorkbench />
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

  return <MainWorkbench />
}

function CustomerAuthGate({ children }: { children: React.ReactNode }) {
  const [authState, setAuthState] = useState<CustomerAuthState>(anonymousCustomerAuthState)
  const [checking, setChecking] = useState(true)
  const [initialChecked, setInitialChecked] = useState(false)

  const verifyAuth = useCallback(async () => {
    setChecking(true)
    try {
      const nextState = await window.api.customerAuth.verify()
      setAuthState(nextState)
    } catch (error) {
      setAuthState({
        customer: null,
        message: error instanceof Error ? error.message : '客户授权校验失败',
        status: 'anonymous',
      })
    } finally {
      setChecking(false)
      setInitialChecked(true)
    }
  }, [])

  useEffect(() => {
    let active = true

    async function loadAuthState() {
      try {
        const snapshot = await window.api.customerAuth.getState()
        if (active) {
          setAuthState(snapshot)
        }
      } catch {
        // First render still performs the required strong verification below.
      }

      if (active) {
        await verifyAuth()
      }
    }

    void loadAuthState()
    return () => {
      active = false
    }
  }, [verifyAuth])

  useEffect(() => {
    if (authState.status !== 'active') {
      return
    }

    const timer = window.setInterval(() => {
      void window.api.customerAuth
        .verify({ allowStaleOnTransientFailure: true })
        .then(setAuthState)
        .catch((error) => {
          setAuthState({
            customer: null,
            message: error instanceof Error ? error.message : '客户授权校验失败',
            status: 'anonymous',
          })
        })
    }, CUSTOMER_AUTH_RECHECK_MS)
    return () => window.clearInterval(timer)
  }, [authState.status])

  useEffect(() => {
    if (!initialChecked || authState.status !== 'pending') {
      return
    }

    let inFlight = false
    const verifyPending = () => {
      if (inFlight) {
        return
      }
      inFlight = true
      void window.api.customerAuth
        .verify()
        .then((nextState) => {
          setAuthState((current) =>
            current.status === 'pending' && nextState.status === 'anonymous'
              ? {
                  ...current,
                  message: nextState.message ?? '客户授权校验失败',
                }
              : nextState,
          )
        })
        .catch((error) => {
          setAuthState((current) =>
            current.status === 'pending'
              ? {
                  ...current,
                  message: error instanceof Error ? error.message : '客户授权校验失败',
                }
              : current,
          )
        })
        .finally(() => {
          inFlight = false
        })
    }

    const timer = window.setInterval(verifyPending, CUSTOMER_AUTH_PENDING_RECHECK_MS)
    return () => window.clearInterval(timer)
  }, [authState.status, initialChecked])

  if (!initialChecked && authState.status === 'active') {
    return <EnteringWorkbench />
  }

  if (!initialChecked || authState.status !== 'active') {
    return (
      <CustomerLoginPage
        checking={checking}
        onRetryVerify={verifyAuth}
        onStateChange={setAuthState}
        state={authState}
      />
    )
  }

  return <>{children}</>
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
  return (
    <HashRouter>
      <CustomerAuthGate>
        <AppRoutes />
      </CustomerAuthGate>
    </HashRouter>
  )
}
