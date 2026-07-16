import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { ScrollArea } from '@/components/ui/scroll-area'
import { localImageUrl } from '@/lib/media'
import { type VirtualGridBreakpoint, useVirtualGrid } from '@/lib/use-virtual-grid'
import { cn } from '@/lib/utils'
import {
  CheckSquare,
  Download,
  ExternalLink,
  FolderOpen,
  Globe2,
  Images,
  Play,
  RefreshCw,
  RotateCcw,
  Search,
  SlidersHorizontal,
  Square,
  Store,
  Terminal,
  Trash2,
  X,
} from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import type {
  CollectionCurrentPageResult,
  CollectionImageIndexClickResult,
  CollectionImageIndexDownloadResult,
  CollectionImageIndexItem,
  CollectionImageIndexScanResult,
} from '../../../../main/lib/collection-image-index-service'
import type { CollectionRecordRow } from '../../../../main/lib/collection-record-store'
import type {
  CollectionDebugLogEntry,
  CollectionMode,
  CollectionPauseReason,
  CollectionSession,
  CollectionSessionStatus,
} from '../../../../main/lib/collection-session-manager'
import { collectionDebugLogLevelCounts, formatCollectionDebugLogLine } from './collection-debug-log'
import { groupCollectionImagePoolItems } from './image-pool'

export type CollectionPlatformKey = string

export interface CollectionPlatformOption {
  key: CollectionPlatformKey
  label: string
  detail: string
}

export interface CollectionProfileOption {
  id: string
  label: string
  detail: string
  online: boolean
}

export interface CollectionPageState {
  platform: CollectionPlatformKey
  profileId: string
  mode: CollectionMode
  outputDir: string
  scrollKeywords: string
  minWidth: number
  maxWidth: number
  minHeight: number
  maxHeight: number
  searchSeeMoreClicks: number
}

const EMPTY_IMAGE_ITEMS: CollectionImageIndexItem[] = []
const PRODUCT_GROUP_DEFAULT_IMAGE_LIMIT = 60
const COLLECTION_IMAGE_POOL_GRID_BREAKPOINTS: VirtualGridBreakpoint[] = [
  { query: '(min-width: 1280px)', columns: 3 },
  { query: '(min-width: 768px)', columns: 2 },
]

interface CollectionPageProps {
  session: CollectionSession | null
  records: CollectionRecordRow[]
  error: string | null
  platforms: CollectionPlatformOption[]
  profiles: CollectionProfileOption[]
  debugLogs: CollectionDebugLogEntry[]
  imageIndexScan: CollectionImageIndexScanResult | null
  imageIndexClick: CollectionImageIndexClickResult | null
  imageIndexDownload: CollectionImageIndexDownloadResult | null
  currentPage: CollectionCurrentPageResult | null
  imagePoolItems: CollectionImageIndexItem[]
  selectedImageIds: Set<string>
  lastScanAddedCount: number
  lastScanExistingCount: number
  lastDownloadFailedCount: number
  state: CollectionPageState
  starting: boolean
  stopping: boolean
  resuming: boolean
  refreshingProfiles: boolean
  imageIndexScanning: boolean
  imageIndexClickProbing: boolean
  imageIndexDownloading: boolean
  detectingCurrentPage: boolean
  openingSearchPage: boolean
  openingShopPage: boolean
  retryingRecordId: string | null
  deletingRecordId: string | null
  onStateChange: <K extends keyof CollectionPageState>(
    key: K,
    value: CollectionPageState[K],
  ) => void
  onRefreshProfiles: () => void
  onStartSession: () => void
  onStopSession: () => void
  onResumeSession: () => void
  onRetryRecord: (recordId: string) => void
  onDeleteRecord: (recordId: string) => void
  onRefreshRecords: () => void
  onClearDebugLogs: () => void
  onOpenSearchPage: (keyword: string) => void
  onOpenShopPage: (pageUrl: string) => void
  onScanImageIndex: (pageUrl?: string) => void
  onProbeImageIndexClick: (pageUrl?: string) => void
  onDownloadImageIndexSample: (pageUrl?: string) => void
  onDownloadImageIndexItems: (items: CollectionImageIndexItem[], pageUrl?: string) => void
  onToggleImagePoolItem: (itemId: string, checked: boolean) => void
  onSelectAllImagePoolItems: () => void
  onClearImagePoolSelection: () => void
  onClearImagePool: () => void
}

function temuSearchUrl(keyword: string) {
  const trimmed = keyword.trim()
  if (!trimmed) {
    return ''
  }
  return `https://www.temu.com/search_result.html?search_key=${encodeURIComponent(trimmed)}&search_method=user`
}

function platformLabel(value: string, platforms: CollectionPlatformOption[]) {
  return platforms.find((item) => item.key === value)?.label ?? value
}

function fileNameFromPath(path: string) {
  return path.split(/[\\/]/).at(-1) || path
}

function sessionStatusLabel(status: CollectionSessionStatus | undefined) {
  switch (status) {
    case 'starting':
      return '启动中'
    case 'active':
      return '进行中'
    case 'paused':
      return '已暂停'
    case 'stopping':
      return '停止中'
    case 'completed':
      return '已完成'
    default:
      return '未开始'
  }
}

function pauseReasonLabel(reason: CollectionPauseReason | undefined) {
  switch (reason) {
    case 'manual_intervention':
      return '需要回到目标平台页面'
    case 'browser_closed':
      return '比特浏览器已关闭'
    case 'window_closed':
      return '采集窗口已关闭'
    default:
      return null
  }
}

function collectionRecordStatusLabel(status: CollectionRecordRow['status']) {
  switch (status) {
    case 'success':
      return '成功'
    case 'skipped':
      return '跳过'
    default:
      return '失败'
  }
}

function collectionRecordStatusClassName(status: CollectionRecordRow['status']) {
  switch (status) {
    case 'success':
      return 'text-emerald-700'
    case 'skipped':
      return 'text-amber-700'
    default:
      return 'text-red-700'
  }
}

function sourceLabel(source: CollectionImageIndexItem['source']) {
  switch (source) {
    case 'background':
      return '背景图'
    case 'performance':
      return '资源'
    case 'source':
      return 'source'
    case 'ssr':
      return '页面数据'
    case 'url_param':
      return 'URL'
    default:
      return 'img'
  }
}

function rectLabel(item: CollectionImageIndexItem) {
  const downloadWidth = temuDownloadWidth(item.originalUrl)
  if (downloadWidth) {
    const ratioWidth = item.naturalWidth || item.rect?.width || 0
    const ratioHeight = item.naturalHeight || item.rect?.height || 0
    if (ratioWidth > 0 && ratioHeight > 0) {
      return `下载约 ${downloadWidth}x${Math.round((downloadWidth * ratioHeight) / ratioWidth)}`
    }
    return `下载约 ${downloadWidth}w`
  }
  if (item.naturalWidth > 0 && item.naturalHeight > 0) {
    return `${item.naturalWidth}x${item.naturalHeight}`
  }
  return item.rect ? `${item.rect.width}x${item.rect.height}` : '尺寸未知'
}

function temuDownloadWidth(value: string) {
  const match = value.match(/\/w\/(\d+)/i)
  if (!match?.[1]) {
    return null
  }
  const width = Number(match[1])
  return Number.isFinite(width) && width > 0 ? width : null
}

function clampSearchSeeMoreClicks(value: number) {
  if (!Number.isFinite(value)) {
    return 0
  }
  return Math.min(10, Math.max(0, Math.floor(value)))
}

function profileLabel(profileId: string, profiles: CollectionProfileOption[]) {
  const profile = profiles.find((item) => item.id === profileId)
  if (!profile) {
    return profileId || '未选择'
  }
  return `${profile.label}${profile.online ? ' · 已打开' : ' · 未打开'}`
}

function currentPageStatusLabel(currentPage: CollectionCurrentPageResult | null) {
  if (!currentPage || currentPage.status === 'none') {
    return '未检测到页面'
  }
  if (currentPage.status === 'last_valid') {
    return '上次有效页面'
  }
  return '正在操作'
}

function currentPageKindLabel(currentPage: CollectionCurrentPageResult | null) {
  if (!currentPage?.pageUrl) {
    return '等待页面'
  }
  if (currentPage.pageUrl.includes('/bgn_verification.html')) {
    return '安全验证页'
  }
  if (isTemuShopPageUrl(currentPage.pageUrl)) {
    return '店铺页'
  }
  if (currentPage.isGoodsPage) {
    return '商品详情页'
  }
  if (currentPage.pageUrl.includes('/search_result.html')) {
    return '搜索结果页'
  }
  return '平台页面'
}

function isTemuShopPageUrl(value: string) {
  try {
    const url = new URL(value)
    const pathname = url.pathname.toLowerCase()
    return (
      pathname.endsWith('/mall.html') ||
      /-m-\d+\.html$/i.test(pathname) ||
      url.searchParams.has('mall_id')
    )
  } catch {
    return false
  }
}

function sourcePageLabel(item: CollectionImageIndexItem) {
  if (item.sourcePageTitle) {
    return item.sourcePageTitle
  }
  if (item.sourcePageUrl) {
    return item.sourcePageUrl
  }
  return item.goodsLink ?? item.originalUrl
}

function collectionImageIndexItemImageSrc(item: CollectionImageIndexItem) {
  return item.localPath ? localImageUrl(item.localPath) : item.originalUrl
}

function collectionImagePoolCoverSrc(group: {
  coverUrl: string
  items: CollectionImageIndexItem[]
}) {
  const localItem = group.items.find((item) => item.localPath)
  return localItem?.localPath ? localImageUrl(localItem.localPath) : group.coverUrl
}

function debugLogLevelClassName(level: CollectionDebugLogEntry['level']) {
  switch (level) {
    case 'error':
      return 'text-red-300'
    case 'warn':
      return 'text-amber-300'
    case 'info':
      return 'text-emerald-200'
    default:
      return 'text-zinc-400'
  }
}

export function CollectionPage({
  session,
  records,
  error,
  platforms,
  profiles,
  debugLogs,
  imageIndexScan,
  imageIndexDownload,
  currentPage,
  imagePoolItems,
  selectedImageIds,
  lastScanAddedCount,
  lastScanExistingCount,
  lastDownloadFailedCount,
  state,
  starting,
  stopping,
  resuming,
  refreshingProfiles,
  imageIndexScanning,
  imageIndexDownloading,
  detectingCurrentPage,
  openingSearchPage,
  openingShopPage,
  retryingRecordId,
  deletingRecordId,
  onStateChange,
  onRefreshProfiles,
  onStartSession,
  onStopSession,
  onResumeSession,
  onRetryRecord,
  onDeleteRecord,
  onRefreshRecords,
  onClearDebugLogs,
  onOpenSearchPage,
  onOpenShopPage,
  onScanImageIndex,
  onDownloadImageIndexItems,
  onToggleImagePoolItem,
  onSelectAllImagePoolItems,
  onClearImagePoolSelection,
  onClearImagePool,
}: CollectionPageProps) {
  const [keyword, setKeyword] = useState('')
  const [shopUrl, setShopUrl] = useState('')
  const [openProductGroupKey, setOpenProductGroupKey] = useState<string | null>(null)
  const [expandedProductGroupKeys, setExpandedProductGroupKeys] = useState<Set<string>>(
    () => new Set(),
  )
  const [isDebugLogOpen, setIsDebugLogOpen] = useState(false)
  const debugLogEndRef = useRef<HTMLDivElement | null>(null)
  const keywordPreview = state.platform === 'temu' ? temuSearchUrl(keyword) : ''
  const imageItems = imagePoolItems ?? EMPTY_IMAGE_ITEMS
  const currentPageUrl = currentPage?.pageUrl || ''
  const canScanCurrentPage = Boolean(currentPageUrl) && currentPage?.status !== 'none'
  const debugLogCounts = useMemo(() => collectionDebugLogLevelCounts(debugLogs), [debugLogs])
  const debugIssueCount = debugLogCounts.warn + debugLogCounts.error
  const imagePoolGroups = useMemo(() => groupCollectionImagePoolItems(imageItems), [imageItems])
  const openProductGroup = imagePoolGroups.productGroups.find(
    (group) => group.key === openProductGroupKey,
  )
  const openProductGroupExpanded = openProductGroup
    ? expandedProductGroupKeys.has(openProductGroup.key)
    : false
  const openProductGroupItems = openProductGroup
    ? openProductGroupExpanded
      ? openProductGroup.items
      : openProductGroup.items.slice(0, PRODUCT_GROUP_DEFAULT_IMAGE_LIMIT)
    : EMPTY_IMAGE_ITEMS
  const openProductGroupHiddenCount = openProductGroup
    ? openProductGroup.items.length - openProductGroupItems.length
    : 0
  const looseImageGrid = useVirtualGrid({
    count: imagePoolGroups.looseItems.length,
    defaultColumns: 1,
    breakpoints: COLLECTION_IMAGE_POOL_GRID_BREAKPOINTS,
    estimateRowHeight: 92,
    gap: 12,
    overscan: 5,
  })
  const productImageCount = imagePoolGroups.productGroups.reduce(
    (total, group) => total + group.items.length,
    0,
  )

  const selectedItems = useMemo(() => {
    return imageItems.filter((item) => selectedImageIds.has(item.id))
  }, [imageItems, selectedImageIds])

  useEffect(() => {
    if (isDebugLogOpen && debugLogs.length > 0) {
      debugLogEndRef.current?.scrollIntoView({ block: 'end' })
    }
  }, [debugLogs.length, isDebugLogOpen])

  function toggleImagePoolItems(items: CollectionImageIndexItem[], checked: boolean) {
    for (const item of items) {
      onToggleImagePoolItem(item.id, checked)
    }
  }

  function toggleExpandedProductGroup(groupKey: string) {
    setExpandedProductGroupKeys((current) => {
      const next = new Set(current)
      if (next.has(groupKey)) {
        next.delete(groupKey)
      } else {
        next.add(groupKey)
      }
      return next
    })
  }

  return (
    <div className="space-y-4">
      <section
        aria-label="采集工具"
        className="rounded-md border bg-card text-card-foreground shadow-sm"
      >
        <CardContent className="space-y-4 p-4">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
            <div className="min-w-0 space-y-1">
              <CardTitle className="flex items-center gap-2 text-lg">
                <Images className="h-5 w-5 text-primary" />
                图池采集
              </CardTitle>
              <p className="text-sm text-muted-foreground">
                跟随比特浏览器当前页面，持续累计图池后选择下载。
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              {!session ? (
                <Button disabled={starting} onClick={onStartSession} type="button">
                  <Play className="mr-2 h-4 w-4" />
                  {starting ? '启动中' : '开始采集会话'}
                </Button>
              ) : null}
              {session?.status === 'paused' ? (
                <Button disabled={resuming} onClick={onResumeSession} type="button">
                  <Play className="mr-2 h-4 w-4" />
                  {resuming ? '恢复中' : '恢复采集'}
                </Button>
              ) : null}
              {session ? (
                <Button
                  disabled={stopping}
                  onClick={onStopSession}
                  type="button"
                  variant="secondary"
                >
                  <Square className="mr-2 h-4 w-4" />
                  {stopping ? '停止中' : '停止采集'}
                </Button>
              ) : null}
              <Button
                aria-label={`采集日志 ${debugLogs.length}`}
                onClick={() => setIsDebugLogOpen(true)}
                type="button"
                variant="secondary"
              >
                <Terminal className="mr-2 h-4 w-4" />
                采集日志 {debugLogs.length}
                {debugIssueCount > 0 ? (
                  <span className="ml-2 rounded bg-red-600 px-1.5 py-0.5 text-[10px] font-semibold text-white">
                    {debugIssueCount}
                  </span>
                ) : null}
              </Button>
            </div>
          </div>

          {error ? (
            <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
              {error}
            </div>
          ) : null}

          <div className="grid gap-3 lg:grid-cols-[minmax(260px,1.2fr)_180px_220px]">
            <label className="grid gap-2 text-sm font-medium" htmlFor="collection-keyword">
              <span>搜索关键词</span>
              <div className="flex gap-2">
                <div className="relative min-w-0 flex-1">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    className="pl-9"
                    id="collection-keyword"
                    onChange={(event) => setKeyword(event.target.value)}
                    placeholder="钥匙扣"
                    value={keyword}
                  />
                </div>
                <Button
                  disabled={!keyword.trim() || openingSearchPage || state.platform !== 'temu'}
                  onClick={() => onOpenSearchPage(keyword)}
                  type="button"
                  variant="secondary"
                >
                  <ExternalLink className="mr-2 h-4 w-4" />
                  {openingSearchPage ? '打开中' : '打开搜索页'}
                </Button>
              </div>
            </label>

            <div className="space-y-2">
              <label className="text-sm font-medium" htmlFor="collection-platform">
                平台
              </label>
              <select
                className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm shadow-xs outline-none transition-colors focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
                id="collection-platform"
                onChange={(event) => onStateChange('platform', event.target.value)}
                value={state.platform}
              >
                {platforms.map((item) => (
                  <option key={item.key} value={item.key}>
                    {item.label}
                  </option>
                ))}
              </select>
            </div>

            <div className="grid gap-2 text-sm font-medium">
              <div className="flex items-center justify-between gap-2">
                <span>浏览器环境</span>
                <Button
                  className="h-7 px-2"
                  disabled={refreshingProfiles}
                  onClick={onRefreshProfiles}
                  type="button"
                  variant="secondary"
                >
                  <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
                  {refreshingProfiles ? '刷新中' : '刷新'}
                </Button>
              </div>
              <select
                className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm shadow-xs outline-none transition-colors focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
                onChange={(event) => onStateChange('profileId', event.target.value)}
                value={state.profileId}
              >
                {state.profileId && !profiles.some((profile) => profile.id === state.profileId) ? (
                  <option value={state.profileId}>{state.profileId}</option>
                ) : null}
                {!state.profileId ? <option value="">选择环境</option> : null}
                {profiles.map((profile) => (
                  <option key={profile.id} value={profile.id}>
                    {profile.label} · {profile.online ? '已打开' : '未打开'}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="grid gap-3 lg:grid-cols-[minmax(260px,1fr)_auto]">
            <label className="grid gap-2 text-sm font-medium" htmlFor="collection-shop-url">
              <span>店铺链接</span>
              <div className="relative min-w-0">
                <Store className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  className="pl-9"
                  id="collection-shop-url"
                  onChange={(event) => setShopUrl(event.target.value)}
                  placeholder="https://www.temu.com/mall.html?mall_id=..."
                  value={shopUrl}
                />
              </div>
            </label>
            <div className="flex items-end">
              <Button
                className="w-full lg:w-auto"
                disabled={
                  !shopUrl.trim() ||
                  openingShopPage ||
                  imageIndexScanning ||
                  state.platform !== 'temu'
                }
                onClick={() => onOpenShopPage(shopUrl)}
                type="button"
                variant="secondary"
              >
                <Store className="mr-2 h-4 w-4" />
                {openingShopPage ? '打开中' : '打开店铺页'}
              </Button>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2 border-t pt-3">
            <Button
              disabled={imageIndexScanning || !canScanCurrentPage}
              onClick={() => onScanImageIndex(currentPageUrl)}
              type="button"
              variant="secondary"
            >
              <RefreshCw className="mr-2 h-4 w-4" />
              {imageIndexScanning ? '扫描中' : '扫描图池'}
            </Button>
            <Button
              aria-label="全选图池"
              className="h-10 w-10 p-0"
              disabled={!imageItems.length}
              onClick={onSelectAllImagePoolItems}
              title="全选图池"
              type="button"
              variant="secondary"
            >
              <CheckSquare className="h-4 w-4" />
            </Button>
            <Button
              aria-label="取消图池选择"
              className="h-10 w-10 p-0"
              disabled={!imageItems.length}
              onClick={onClearImagePoolSelection}
              title="取消图池选择"
              type="button"
              variant="secondary"
            >
              <X className="h-4 w-4" />
            </Button>
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button
                  aria-label="清空图池"
                  className="h-10 w-10 p-0"
                  disabled={!imageItems.length}
                  title="清空图池"
                  type="button"
                  variant="secondary"
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>清空图池</AlertDialogTitle>
                  <AlertDialogDescription>
                    将清空当前图池、选择状态和本次扫描结果。已下载到工作区的图片不会被删除。
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>取消</AlertDialogCancel>
                  <AlertDialogAction onClick={onClearImagePool}>清空</AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
            <Button
              disabled={!selectedItems.length || imageIndexDownloading}
              onClick={() => onDownloadImageIndexItems(selectedItems)}
              type="button"
            >
              <Download className="mr-2 h-4 w-4" />
              {imageIndexDownloading ? '下载中' : `下载选中 ${selectedItems.length}`}
            </Button>
            <Button
              disabled={!imageItems.length || imageIndexDownloading}
              onClick={() => onDownloadImageIndexItems(imageItems)}
              type="button"
            >
              <Download className="mr-2 h-4 w-4" />
              下载全部 {imageItems.length}
            </Button>
          </div>
          <section aria-label="采集运行反馈" className="space-y-3 border-t pt-4">
            <div className="grid gap-3 lg:grid-cols-2">
              <div className="flex flex-col gap-3 rounded-md border bg-muted/40 p-3 text-sm">
                <div className="flex min-w-0 flex-wrap items-center gap-2">
                  <Badge variant="secondary">{platformLabel(state.platform, platforms)}</Badge>
                  <Badge variant="secondary">{profileLabel(state.profileId, profiles)}</Badge>
                  <Badge variant={session?.status === 'active' ? 'default' : 'secondary'}>
                    {sessionStatusLabel(session?.status)}
                  </Badge>
                </div>
                <div className="truncate text-xs text-muted-foreground">
                  {session?.output_dir ?? '采集会话启动后自动创建任务目录'}
                </div>
                <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                  <span>图池 {imageItems.length}</span>
                  <span>已选 {selectedItems.length}</span>
                  <span>本次新增 {lastScanAddedCount}</span>
                  <span>本次已存在 {lastScanExistingCount}</span>
                  <span>下载失败 {lastDownloadFailedCount}</span>
                  <span>当前页图片 {imageIndexScan?.imageCount ?? 0}</span>
                  <span>当前页可下载 {imageIndexScan?.collectableCount ?? 0}</span>
                </div>
              </div>

              <div className="rounded-md border bg-background p-3 text-sm">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <Globe2 className="h-4 w-4 shrink-0 text-primary" />
                      <Badge
                        variant={currentPage?.status === 'last_valid' ? 'secondary' : 'default'}
                      >
                        {currentPageStatusLabel(currentPage)}
                      </Badge>
                      <Badge variant="secondary">{currentPageKindLabel(currentPage)}</Badge>
                      {detectingCurrentPage ? (
                        <span className="text-xs text-muted-foreground">检测中...</span>
                      ) : null}
                    </div>
                    <div className="mt-2 truncate font-medium">
                      {currentPage?.title || '等待比特浏览器当前页面'}
                    </div>
                    <div className="mt-1 truncate text-xs text-muted-foreground">
                      {currentPageUrl || '等待目标平台页面'}
                    </div>
                  </div>
                  {currentPage?.goodsId ? (
                    <div className="shrink-0 text-xs text-muted-foreground">
                      商品 {currentPage.goodsId}
                    </div>
                  ) : null}
                </div>
                {keywordPreview ? (
                  <div className="mt-2 truncate text-xs text-muted-foreground">
                    搜索页 {keywordPreview}
                  </div>
                ) : null}
                {lastScanExistingCount > 0 && lastScanAddedCount === 0 ? (
                  <div className="mt-2 text-xs text-muted-foreground">
                    本次扫描到的图片已在图池中，已更新来源页面信息。
                  </div>
                ) : null}
              </div>
            </div>

            {session?.status === 'paused' && pauseReasonLabel(session.pause_reason) ? (
              <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
                暂停原因：{pauseReasonLabel(session.pause_reason)}
              </div>
            ) : null}

            {imageIndexDownload ? (
              <div className="rounded-md border bg-muted/40 p-3 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <div className="font-medium">保存目录</div>
                    <div className="mt-1 break-all text-xs text-muted-foreground">
                      {imageIndexDownload.outputDir}
                    </div>
                  </div>
                  <Badge variant="secondary">
                    成功 {imageIndexDownload.saved.length} / 失败 {imageIndexDownload.failed.length}
                  </Badge>
                </div>
                {imageIndexDownload.saved.length ? (
                  <div className="mt-3 grid gap-2 md:grid-cols-2 xl:grid-cols-3">
                    {imageIndexDownload.saved.slice(0, 6).map((item) => (
                      <div
                        className="flex min-w-0 items-center gap-2 rounded-md border bg-background p-2"
                        key={item.savedPath}
                      >
                        <img
                          alt=""
                          className="h-10 w-10 rounded border object-cover"
                          decoding="async"
                          loading="lazy"
                          src={localImageUrl(item.savedPath)}
                        />
                        <div className="min-w-0 text-xs">
                          <div className="truncate font-medium">
                            {fileNameFromPath(item.savedPath)}
                          </div>
                          <div className="text-muted-foreground">
                            {Math.round(item.bytes / 1024)} KB
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : null}
              </div>
            ) : null}
          </section>
        </CardContent>
      </section>

      <section
        aria-label="图池工作区"
        className="min-h-[520px] rounded-md border bg-card text-card-foreground shadow-sm"
      >
        <CardHeader className="flex-row items-center justify-between space-y-0 p-4">
          <div>
            <CardTitle className="text-lg">图池</CardTitle>
            <p className="text-sm text-muted-foreground">
              {imageItems.length
                ? `散图 ${imagePoolGroups.looseItems.length} 张 · 商品页 ${imagePoolGroups.productGroups.length} 组/${productImageCount} 张`
                : '等待扫描'}
            </p>
            <div className="mt-2 flex flex-wrap gap-2 text-xs">
              <Badge variant="secondary">商品页</Badge>
              <Badge variant="secondary">散图</Badge>
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-4 pt-0">
          {imageItems.length ? (
            <div className="space-y-5">
              {imagePoolGroups.productGroups.length ? (
                <section className="space-y-3">
                  <div className="flex items-center justify-between gap-3">
                    <div className="text-sm font-medium">商品页</div>
                    <div className="text-xs text-muted-foreground">
                      {imagePoolGroups.productGroups.length} 组 · {productImageCount} 张
                    </div>
                  </div>
                  <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                    {imagePoolGroups.productGroups.map((group) => {
                      const selectedCount = group.items.filter((item) =>
                        selectedImageIds.has(item.id),
                      ).length
                      return (
                        <div
                          className={cn(
                            'rounded-md border p-3 transition-colors',
                            selectedCount > 0 ? 'border-primary bg-primary/5' : 'hover:bg-muted/40',
                          )}
                          key={group.key}
                        >
                          <div className="grid grid-cols-[auto_72px_minmax(0,1fr)] gap-3">
                            <Checkbox
                              checked={
                                selectedCount === group.items.length
                                  ? true
                                  : selectedCount > 0
                                    ? 'indeterminate'
                                    : false
                              }
                              onCheckedChange={(checked) =>
                                toggleImagePoolItems(group.items, checked === true)
                              }
                            />
                            <div className="relative h-16 w-16 overflow-hidden rounded-md border bg-muted">
                              <img
                                alt=""
                                className="h-full w-full object-cover"
                                decoding="async"
                                loading="lazy"
                                src={collectionImagePoolCoverSrc(group)}
                              />
                              <div className="absolute bottom-1 right-1 rounded bg-background/90 p-1 shadow-sm">
                                <FolderOpen className="h-3.5 w-3.5 text-primary" />
                              </div>
                            </div>
                            <div className="min-w-0 text-sm">
                              <div className="truncate font-medium">{group.title}</div>
                              <div className="mt-1 text-xs text-muted-foreground">
                                {group.items.length} 张 · 已选 {selectedCount}
                              </div>
                              <Button
                                className="mt-2 h-8 px-2"
                                onClick={() =>
                                  setOpenProductGroupKey((current) =>
                                    current === group.key ? null : group.key,
                                  )
                                }
                                type="button"
                                variant="secondary"
                              >
                                {openProductGroupKey === group.key ? '收起' : '查看'}
                              </Button>
                            </div>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                  {openProductGroup ? (
                    <div className="rounded-md border bg-muted/20 p-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="min-w-0 truncate text-sm font-medium">
                          {openProductGroup.title}
                        </div>
                        <Badge variant="secondary">{openProductGroup.items.length} 张</Badge>
                      </div>
                      <div className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                        {openProductGroupItems.map((item) => (
                          <label
                            className={cn(
                              'grid cursor-pointer grid-cols-[auto_72px_minmax(0,1fr)] gap-3 rounded-md border bg-background p-3 transition-colors',
                              selectedImageIds.has(item.id)
                                ? 'border-primary bg-primary/5'
                                : 'hover:bg-muted/40',
                            )}
                            htmlFor={`image-index-${item.id}`}
                            key={item.id}
                          >
                            <Checkbox
                              checked={selectedImageIds.has(item.id)}
                              id={`image-index-${item.id}`}
                              onCheckedChange={(checked) =>
                                onToggleImagePoolItem(item.id, checked === true)
                              }
                            />
                            <img
                              alt=""
                              className="h-16 w-16 rounded-md border object-cover"
                              decoding="async"
                              loading="lazy"
                              src={collectionImageIndexItemImageSrc(item)}
                            />
                            <div className="min-w-0 text-sm">
                              <div className="flex items-center gap-2">
                                <Badge variant="secondary">{sourceLabel(item.source)}</Badge>
                                <span className="text-xs text-muted-foreground">
                                  score {item.score}
                                </span>
                              </div>
                              <div className="mt-2 truncate text-xs text-muted-foreground">
                                {sourcePageLabel(item)}
                              </div>
                              <div className="mt-1 text-xs text-muted-foreground">
                                {rectLabel(item)}
                              </div>
                            </div>
                          </label>
                        ))}
                      </div>
                      {openProductGroupHiddenCount > 0 || openProductGroupExpanded ? (
                        <div className="mt-3 flex justify-center">
                          <Button
                            onClick={() => toggleExpandedProductGroup(openProductGroup.key)}
                            type="button"
                            variant="secondary"
                          >
                            {openProductGroupExpanded
                              ? `收起到前 ${PRODUCT_GROUP_DEFAULT_IMAGE_LIMIT} 张`
                              : `查看全部，剩余 ${openProductGroupHiddenCount} 张`}
                          </Button>
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                </section>
              ) : null}

              {imagePoolGroups.looseItems.length ? (
                <section className="space-y-3">
                  <div className="flex items-center justify-between gap-3">
                    <div className="text-sm font-medium">散图</div>
                    <div className="text-xs text-muted-foreground">
                      {imagePoolGroups.looseItems.length} 张
                    </div>
                  </div>
                  <div className="max-h-[640px] overflow-auto pr-1" ref={looseImageGrid.parentRef}>
                    <div className="relative" style={{ height: `${looseImageGrid.totalSize}px` }}>
                      {looseImageGrid.virtualRows.map((virtualRow) => {
                        const rowStart = virtualRow.index * looseImageGrid.columns
                        const rowItems = imagePoolGroups.looseItems.slice(
                          rowStart,
                          rowStart + looseImageGrid.columns,
                        )
                        return (
                          <div
                            className="absolute left-0 top-0 grid w-full gap-3 md:grid-cols-2 xl:grid-cols-3"
                            data-index={virtualRow.index}
                            key={virtualRow.key}
                            ref={looseImageGrid.measureElement}
                            style={{ transform: `translateY(${virtualRow.start}px)` }}
                          >
                            {rowItems.map((item) => (
                              <label
                                className={cn(
                                  'grid cursor-pointer grid-cols-[auto_72px_minmax(0,1fr)] gap-3 rounded-md border p-3 transition-colors',
                                  selectedImageIds.has(item.id)
                                    ? 'border-primary bg-primary/5'
                                    : 'hover:bg-muted/40',
                                )}
                                htmlFor={`image-index-${item.id}`}
                                key={item.id}
                              >
                                <Checkbox
                                  checked={selectedImageIds.has(item.id)}
                                  id={`image-index-${item.id}`}
                                  onCheckedChange={(checked) =>
                                    onToggleImagePoolItem(item.id, checked === true)
                                  }
                                />
                                <img
                                  alt=""
                                  className="h-16 w-16 rounded-md border object-cover"
                                  decoding="async"
                                  loading="lazy"
                                  src={collectionImageIndexItemImageSrc(item)}
                                />
                                <div className="min-w-0 text-sm">
                                  <div className="flex items-center gap-2">
                                    <Badge variant="secondary">{sourceLabel(item.source)}</Badge>
                                    <span className="text-xs text-muted-foreground">
                                      score {item.score}
                                    </span>
                                  </div>
                                  <div className="mt-2 truncate text-xs text-muted-foreground">
                                    {sourcePageLabel(item)}
                                  </div>
                                  <div className="mt-1 text-xs text-muted-foreground">
                                    {rectLabel(item)}
                                  </div>
                                </div>
                              </label>
                            ))}
                          </div>
                        )
                      })}
                    </div>
                  </div>
                </section>
              ) : null}
            </div>
          ) : (
            <div className="rounded-md border border-dashed bg-muted/20 px-3 py-10 text-center text-sm text-muted-foreground">
              <div className="font-medium text-foreground">还没有图池结果</div>
              <div className="mt-1">
                在比特浏览器打开目标页后点“扫描图池”，新结果会持续累计在这里。
              </div>
            </div>
          )}
        </CardContent>
      </section>

      <section aria-label="采集结果与异常">
        <Card className="shadow-sm">
          <CardHeader className="flex-row items-center justify-between space-y-0 p-4">
            <div>
              <CardTitle className="text-lg">采集结果与异常</CardTitle>
              <p className="text-sm text-muted-foreground">
                当前会话 {records.length} 条记录，失败项可直接重试。
              </p>
            </div>
            <Button onClick={onRefreshRecords} type="button" variant="secondary">
              <RefreshCw className="mr-2 h-4 w-4" />
              刷新记录
            </Button>
          </CardHeader>
          <CardContent className="p-4 pt-0">
            {records.length ? (
              <div className="space-y-2">
                {records.slice(0, 20).map((record) => (
                  <div
                    className="grid gap-3 rounded-md border p-3 text-sm md:grid-cols-[72px_minmax(0,1fr)_auto]"
                    key={record.id}
                  >
                    {record.savedPath && record.status !== 'failed' ? (
                      <img
                        alt=""
                        className="h-14 w-[72px] rounded-md border object-cover"
                        decoding="async"
                        loading="lazy"
                        src={localImageUrl(record.savedPath)}
                      />
                    ) : (
                      <div className="grid h-14 w-[72px] place-items-center rounded-md border bg-muted text-xs text-muted-foreground">
                        无预览
                      </div>
                    )}
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span
                          className={cn(
                            'font-medium',
                            collectionRecordStatusClassName(record.status),
                          )}
                        >
                          {collectionRecordStatusLabel(record.status)}
                        </span>
                        {record.skuCode ? (
                          <Badge variant="secondary">{record.skuCode}</Badge>
                        ) : null}
                      </div>
                      <div className="mt-1 truncate text-xs text-muted-foreground">
                        {fileNameFromPath(record.savedPath ?? record.sourceUrl)}
                      </div>
                      {record.reason ? (
                        <div className="mt-1 text-xs text-red-700">{record.reason}</div>
                      ) : null}
                    </div>
                    <div className="flex items-center gap-2">
                      {record.status === 'failed' ? (
                        <Button
                          disabled={retryingRecordId === record.id}
                          onClick={() => onRetryRecord(record.id)}
                          type="button"
                          variant="secondary"
                        >
                          <RotateCcw className="mr-2 h-4 w-4" />
                          {retryingRecordId === record.id ? '重试中' : '重试'}
                        </Button>
                      ) : null}
                      <Button
                        aria-label={`删除采集记录 ${record.id}`}
                        disabled={deletingRecordId === record.id}
                        onClick={() => onDeleteRecord(record.id)}
                        title="删除记录"
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
              <div className="rounded-md border border-dashed px-3 py-8 text-center text-sm text-muted-foreground">
                暂无采集记录
              </div>
            )}
          </CardContent>
        </Card>
      </section>

      <Accordion collapsible type="single">
        <AccordionItem className="rounded-md border bg-card px-4" value="advanced">
          <AccordionTrigger className="text-sm">
            <span className="flex items-center gap-2">
              <SlidersHorizontal className="h-4 w-4 text-muted-foreground" />
              高级设置
            </span>
          </AccordionTrigger>
          <AccordionContent>
            <div className="grid gap-4 border-t pt-4 md:grid-cols-2 xl:grid-cols-4">
              <label
                className="grid gap-2 text-sm font-medium"
                htmlFor="collection-see-more-clicks"
              >
                <span>See more 次数</span>
                <Input
                  id="collection-see-more-clicks"
                  max={10}
                  min={0}
                  onChange={(event) =>
                    onStateChange(
                      'searchSeeMoreClicks',
                      clampSearchSeeMoreClicks(Number(event.target.value)),
                    )
                  }
                  type="number"
                  value={state.searchSeeMoreClicks}
                />
              </label>
              <label className="grid gap-2 text-sm font-medium" htmlFor="collection-mode">
                <span>采集模式</span>
                <select
                  className="h-10 rounded-md border border-input bg-background px-3 text-sm"
                  id="collection-mode"
                  onChange={(event) =>
                    onStateChange('mode', event.target.value === 'scroll' ? 'scroll' : 'click')
                  }
                  value={state.mode}
                >
                  <option value="click">点击采集</option>
                  <option value="scroll">滚动采集</option>
                </select>
              </label>
              <label className="grid gap-2 text-sm font-medium" htmlFor="collection-profile-id">
                <span>环境编号</span>
                <Input
                  id="collection-profile-id"
                  onChange={(event) => onStateChange('profileId', event.target.value)}
                  placeholder="手动输入环境编号"
                  value={state.profileId}
                />
              </label>
              <label
                className="grid gap-2 text-sm font-medium"
                htmlFor="collection-scroll-keywords"
              >
                <span>滚动关键词</span>
                <Input
                  id="collection-scroll-keywords"
                  onChange={(event) => onStateChange('scrollKeywords', event.target.value)}
                  placeholder="每行一个过滤关键词"
                  value={state.scrollKeywords}
                />
              </label>
              <div className="grid gap-2 text-sm font-medium">
                <span>采集任务目录</span>
                <div className="flex min-h-10 items-center rounded-md border bg-muted/40 px-3 text-xs text-muted-foreground">
                  {session?.output_dir ?? '启动后自动创建'}
                </div>
              </div>
              {(
                [
                  ['minWidth', '最小宽度'],
                  ['maxWidth', '最大宽度'],
                  ['minHeight', '最小高度'],
                  ['maxHeight', '最大高度'],
                ] as const
              ).map(([key, label]) => (
                <label
                  className="grid gap-2 text-sm font-medium"
                  htmlFor={`collection-${key}`}
                  key={key}
                >
                  <span>{label}</span>
                  <Input
                    id={`collection-${key}`}
                    min={0}
                    onChange={(event) => onStateChange(key, Number(event.target.value) || 0)}
                    type="number"
                    value={state[key]}
                  />
                </label>
              ))}
            </div>
          </AccordionContent>
        </AccordionItem>
      </Accordion>

      <Dialog onOpenChange={setIsDebugLogOpen} open={isDebugLogOpen}>
        <DialogContent className="max-w-5xl gap-0 p-0">
          <DialogHeader className="border-b px-4 py-3 pr-12">
            <div className="flex items-center justify-between gap-3">
              <DialogTitle className="flex items-center gap-2 text-base">
                <Terminal className="h-4 w-4 text-primary" />
                采集日志
              </DialogTitle>
              <Button
                className="h-8 px-3"
                disabled={!debugLogs.length}
                onClick={onClearDebugLogs}
                type="button"
                variant="secondary"
              >
                清空
              </Button>
            </div>
          </DialogHeader>
          <div className="p-4">
            <ScrollArea className="h-[min(70vh,620px)] rounded-md border bg-zinc-950">
              <div className="space-y-1 p-3 font-mono text-[12px] leading-5">
                {debugLogs.length ? (
                  debugLogs.map((entry) => (
                    <div
                      className={cn(
                        'break-all whitespace-pre-wrap',
                        debugLogLevelClassName(entry.level),
                      )}
                      key={entry.id}
                    >
                      {formatCollectionDebugLogLine(entry)}
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
