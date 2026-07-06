import { localImageUrl } from '@/components/detection-image-url'
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
import { cn } from '@/lib/utils'
import {
  CheckSquare,
  Download,
  ExternalLink,
  FolderOpen,
  Globe2,
  Images,
  RefreshCw,
  Search,
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
  refreshingProfiles,
  imageIndexScanning,
  imageIndexDownloading,
  detectingCurrentPage,
  openingSearchPage,
  openingShopPage,
  onStateChange,
  onRefreshProfiles,
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

  return (
    <div className="space-y-4">
      <Card className="shadow-sm">
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
              <Button onClick={() => setIsDebugLogOpen(true)} type="button" variant="secondary">
                <Terminal className="mr-2 h-4 w-4" />
                日志 {debugLogs.length}
                {debugIssueCount > 0 ? (
                  <span className="ml-2 rounded bg-red-600 px-1.5 py-0.5 text-[10px] font-semibold text-white">
                    {debugIssueCount}
                  </span>
                ) : null}
              </Button>
              <Button
                disabled={imageIndexScanning || !canScanCurrentPage}
                onClick={() => onScanImageIndex(currentPageUrl)}
                type="button"
                variant="secondary"
              >
                <RefreshCw className="mr-2 h-4 w-4" />
                {imageIndexScanning ? '扫描中' : '扫描图池'}
              </Button>
              <label
                className="flex h-10 items-center gap-2 rounded-md border bg-background px-2 text-xs font-medium"
                htmlFor="collection-see-more-clicks"
              >
                <span className="whitespace-nowrap">See more 次数</span>
                <Input
                  className="h-8 w-16 px-2"
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
              <Button
                disabled={!imageItems.length}
                onClick={onSelectAllImagePoolItems}
                type="button"
                variant="secondary"
              >
                <CheckSquare className="mr-2 h-4 w-4" />
                全选
              </Button>
              <Button
                disabled={!imageItems.length}
                onClick={onClearImagePoolSelection}
                type="button"
                variant="secondary"
              >
                <X className="mr-2 h-4 w-4" />
                取消选择
              </Button>
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button disabled={!imageItems.length} type="button" variant="secondary">
                    <Trash2 className="mr-2 h-4 w-4" />
                    清空图池
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

          <div className="grid gap-3 lg:grid-cols-[minmax(220px,1fr)_minmax(260px,1.6fr)]">
            <label className="grid gap-2 text-sm font-medium" htmlFor="collection-profile-id">
              <span>环境编号</span>
              <Input
                id="collection-profile-id"
                onChange={(event) => onStateChange('profileId', event.target.value)}
                placeholder="手动输入环境编号"
                value={state.profileId}
              />
            </label>
            <div className="grid gap-2 text-sm font-medium">
              <span>采集任务目录</span>
              <div className="flex min-h-10 items-center rounded-md border bg-muted/40 px-3 text-sm text-muted-foreground">
                {session?.output_dir ?? '启动后自动创建：01-采集工作区 / 平台-时间'}
              </div>
            </div>
          </div>

          <div className="flex flex-col gap-3 rounded-md border bg-muted/40 p-3 text-sm lg:flex-row lg:items-center lg:justify-between">
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <Badge variant="secondary">{platformLabel(state.platform, platforms)}</Badge>
              <Badge variant="secondary">{profileLabel(state.profileId, profiles)}</Badge>
              <span className="truncate text-muted-foreground">
                {session?.output_dir ?? '采集会话启动后自动创建任务目录'}
              </span>
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
            <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <Globe2 className="h-4 w-4 shrink-0 text-primary" />
                  <Badge variant={currentPage?.status === 'last_valid' ? 'secondary' : 'default'}>
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
                <div className="mt-1 break-all text-xs text-muted-foreground">
                  {currentPageUrl || '请选择浏览器环境，并在比特浏览器里打开目标平台页面'}
                </div>
              </div>
              <div className="shrink-0 text-xs text-muted-foreground">
                {currentPage?.goodsId ? `商品 ${currentPage.goodsId}` : '扫描前会短暂等待页面稳定'}
              </div>
            </div>
            <div className="mt-2 text-xs text-muted-foreground">
              搜索页按设置次数加载 See more，店铺页会自动加载到稳定。
              {keywordPreview ? ` 当前关键词搜索页：${keywordPreview}` : ''}
            </div>
            {lastScanExistingCount > 0 && lastScanAddedCount === 0 ? (
              <div className="mt-2 text-xs text-muted-foreground">
                本次扫描到的图片已在图池中，已更新来源页面信息。
              </div>
            ) : null}
          </div>

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
        </CardContent>
      </Card>

      <Card className="shadow-sm">
        <CardHeader className="flex-row items-center justify-between space-y-0 p-4">
          <div>
            <CardTitle className="text-lg">图池列表</CardTitle>
            <p className="text-sm text-muted-foreground">
              {imageItems.length
                ? `散图 ${imagePoolGroups.looseItems.length} 张 · 商品页 ${imagePoolGroups.productGroups.length} 组/${productImageCount} 张`
                : '等待扫描'}
            </p>
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
                                loading="lazy"
                                src={group.coverUrl}
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
                        {openProductGroup.items.map((item) => (
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
                              loading="lazy"
                              src={item.originalUrl}
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
                  <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                    {imagePoolGroups.looseItems.map((item) => (
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
                          loading="lazy"
                          src={item.originalUrl}
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
      </Card>

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
