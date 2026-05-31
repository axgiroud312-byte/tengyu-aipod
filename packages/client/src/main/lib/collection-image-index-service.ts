import { mkdir, stat, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { AppErrorClass, WORKBENCH_DIRECTORIES } from '@tengyu-aipod/shared'
import type { ipcMain } from 'electron'
import type { Browser, Page } from 'playwright'
import { z } from 'zod'
import { cdpClient } from './cdp-client'
import { getPlatformRule } from './collection-platform-rules'
import type { CollectionDebugLogLevel, CollectionSessionEvent } from './collection-session-manager'

const nodeRequire = createRequire(import.meta.url)

export type CollectionImageIndexRect = {
  x: number
  y: number
  width: number
  height: number
  right: number
  bottom: number
}

export type CollectionImageIndexSource =
  | 'img'
  | 'source'
  | 'background'
  | 'performance'
  | 'url_param'

export type CollectionImageIndexBucket = 'loose' | 'product'

export type CollectionImageIndexPageKind = 'home' | 'search' | 'channel' | 'detail' | 'platform'

export type CollectionImageIndexDetailGalleryCandidate = {
  rect: CollectionImageIndexRect
  naturalWidth: number
  naturalHeight: number
}

export type CollectionImageIndexItem = {
  id: string
  bucket: CollectionImageIndexBucket
  pageKind: CollectionImageIndexPageKind
  source: CollectionImageIndexSource
  displayUrl: string
  originalUrl: string
  score: number
  visible: boolean
  rect: CollectionImageIndexRect | null
  naturalWidth: number
  naturalHeight: number
  goodsLink: string | null
  groupKey: string | null
  groupTitle: string | null
  coverUrl: string | null
  tag: string
  sourcePageUrl?: string | undefined
  sourcePageTitle?: string | undefined
  scannedAt?: number | undefined
}

export type CollectionImageIndexPageSummary = {
  pageUrl: string
  title: string
  imageCount: number
  indexedCount: number
  collectableCount: number
}

export type CollectionImageIndexScanResult = CollectionImageIndexPageSummary & {
  sourceCounts: Record<string, number>
  items: CollectionImageIndexItem[]
  scannedPages: CollectionImageIndexPageSummary[]
}

export type CollectionImageIndexClickResult = {
  pageUrl: string
  title: string
  clickedAt: { x: number; y: number } | null
  item: CollectionImageIndexItem | null
  timedOut: boolean
}

export type CollectionImageIndexDownloadResult = {
  scan: CollectionImageIndexScanResult
  outputDir: string
  saved: Array<{
    item: CollectionImageIndexItem
    savedPath: string
    bytes: number
  }>
  failed: Array<{
    item: CollectionImageIndexItem
    error: string
  }>
}

export type CollectionCurrentPageStatus = 'active' | 'last_valid' | 'none'

export type CollectionCurrentPageResult = {
  pageUrl: string
  title: string
  status: CollectionCurrentPageStatus
  isGoodsPage: boolean
  goodsId: string | null
  lastDetectedAt: number | null
}

export type CollectionPageActivitySnapshot = {
  pageUrl: string
  title: string
  visible: boolean
  focused: boolean
  lastActivityAt: number
  detectedAt: number
}

type PageIndexPayload = {
  href: string
  title: string
  imageCount: number
  indexedCount: number
  collectableCount: number
  sourceCounts: Record<string, number>
  items: CollectionImageIndexItem[]
}

type ProbeInput = {
  platform: string
  profileId: string
  outputDir?: string | undefined
  pageUrl?: string | undefined
  limit?: number | undefined
  debug?: CollectionImageIndexDebug | undefined
}

type CurrentPageInput = {
  platform: string
  profileId: string
}

type OpenPageInput = CurrentPageInput & {
  pageUrl: string
}

type DownloadInput = ProbeInput & {
  items?: CollectionImageIndexItem[] | undefined
}

type DownloadedImage = {
  buffer: Buffer
  extension: '.jpg' | '.jpeg' | '.png' | '.webp'
}

type CollectionImageIndexDebugDetails = Record<string, string | number | boolean | null | undefined>
type CollectionImageIndexDebug = (
  message: string,
  level?: CollectionDebugLogLevel,
  details?: CollectionImageIndexDebugDetails,
) => void

const DEFAULT_ITEM_LIMIT = 60
const DEFAULT_DOWNLOAD_LIMIT = 5
const CLICK_PROBE_TIMEOUT_MS = 30_000
const SCAN_PAGE_STABILIZE_MS = 1_500

const lastValidCurrentPages = new Map<string, CollectionCurrentPageResult>()
let collectionImageIndexDebugSequence = 0

function createCollectionImageIndexDebugEmitter(): CollectionImageIndexDebug {
  return (message, level, details) => {
    emitCollectionImageIndexDebugLog(message, level ?? 'info', details)
  }
}

function emitCollectionImageIndexDebugLog(
  message: string,
  level: CollectionDebugLogLevel,
  details?: CollectionImageIndexDebugDetails,
) {
  const event: CollectionSessionEvent = {
    type: 'debug-log',
    entry: {
      id: `${Date.now()}-image-index-${++collectionImageIndexDebugSequence}`,
      timestamp: Date.now(),
      level,
      message,
      ...(details ? { details: compactImageIndexLogDetails(details) } : {}),
    },
  }
  for (const window of electronBrowserWindow().getAllWindows()) {
    window.webContents.send('collection:event', event)
  }
}

function compactImageIndexLogDetails(details: CollectionImageIndexDebugDetails) {
  const compacted: Record<string, string | number | boolean | null> = {}
  for (const [key, value] of Object.entries(details)) {
    if (value !== undefined) {
      compacted[key] = value
    }
  }
  return compacted
}

function shortLogText(value: string) {
  return value.length > 180 ? `${value.slice(0, 177)}...` : value
}

export async function getCollectionCurrentPage(input: CurrentPageInput) {
  const rule = getPlatformRule(input.platform)
  const browser = await cdpClient.connectToProfile(input.profileId)
  const pages = candidatePages(browser, rule.allowed_domains)
  const snapshots = await Promise.all(pages.map(pageActivitySnapshot))
  const previous = lastValidCurrentPages.get(currentPageCacheKey(input))
  const result = chooseCollectionCurrentPage(input.platform, snapshots, previous)
  if (result.status === 'active') {
    lastValidCurrentPages.set(currentPageCacheKey(input), result)
  }
  return result
}

export async function openCollectionPage(input: OpenPageInput) {
  const rule = getPlatformRule(input.platform)
  if (!isAllowedDomain(input.pageUrl, rule.allowed_domains)) {
    throw new AppErrorClass('HTTP_4XX', '页面地址不属于当前采集平台', false, {
      kind: 'validation',
      pageUrl: input.pageUrl,
      platform: input.platform,
    })
  }
  const browser = await cdpClient.connectToProfile(input.profileId)
  const page = await openOrReusePage(browser, rule.allowed_domains, input.pageUrl)
  await page.bringToFront().catch(() => null)
  await page.waitForLoadState('domcontentloaded').catch(() => null)
  await page.waitForTimeout(SCAN_PAGE_STABILIZE_MS).catch(() => null)
  const snapshot = await pageActivitySnapshot(page)
  const result = currentPageResultFromSnapshot(input.platform, snapshot, 'active')
  lastValidCurrentPages.set(currentPageCacheKey(input), result)
  return result
}

export async function scanCollectionImageIndex(input: ProbeInput) {
  const debug = input.debug
  const startedAt = Date.now()
  debug?.('开始扫描图池', 'info', {
    operation: 'scan',
    stage: 'start',
    platform: input.platform,
    pageUrl: input.pageUrl ?? null,
  })
  try {
    const rule = getPlatformRule(input.platform)
    debug?.('连接比特浏览器采集页面', 'debug', {
      operation: 'scan',
      stage: 'progress',
      platform: input.platform,
    })
    const browser = await cdpClient.connectToProfile(input.profileId)
    const candidates = await targetPages(browser, rule.allowed_domains, input.pageUrl)
    if (candidates.length === 0) {
      debug?.('未找到可扫描页面', 'warn', {
        operation: 'scan',
        stage: 'failed',
        platform: input.platform,
        pageUrl: input.pageUrl ?? null,
      })
      throw new AppErrorClass(
        'HTTP_4XX',
        '未找到当前平台页面，请先在比特浏览器打开采集页面',
        false,
        {
          kind: 'not_found',
          platform: input.platform,
        },
      )
    }

    debug?.('定位到可扫描页面', 'info', {
      operation: 'scan',
      stage: 'progress',
      total: candidates.length,
      pageUrl: input.pageUrl ?? null,
    })
    const pageResults = await Promise.all(
      candidates.map(async (page, index) => {
        const pageUrl = page.url()
        debug?.(`扫描页面开始 ${index + 1}/${candidates.length}`, 'info', {
          operation: 'scan',
          stage: 'progress',
          index: index + 1,
          total: candidates.length,
          pageUrl,
        })
        const result = await scanPageImageIndex(
          page,
          input.limit ?? DEFAULT_ITEM_LIMIT,
          input.platform,
        )
        debug?.(`扫描页面完成 ${index + 1}/${candidates.length}`, 'info', {
          operation: 'scan',
          stage: 'success',
          index: index + 1,
          total: candidates.length,
          pageUrl: result.pageUrl,
          imageCount: result.imageCount,
          collectableCount: result.collectableCount,
        })
        return result
      }),
    )
    const result = bestScanResult(pageResults)
    debug?.('图池扫描完成', 'info', {
      operation: 'scan',
      stage: 'finish',
      durationMs: Date.now() - startedAt,
      pageUrl: result.pageUrl,
      imageCount: result.imageCount,
      collectableCount: result.collectableCount,
      total: candidates.length,
    })
    return result
  } catch (error) {
    debug?.('图池扫描失败', 'error', {
      operation: 'scan',
      stage: 'failed',
      durationMs: Date.now() - startedAt,
      error: appErrorMessage(error),
    })
    throw error
  }
}

export async function probeCollectionImageIndexClick(input: ProbeInput) {
  const scan = await scanCollectionImageIndex({
    ...input,
    limit: 0,
  })
  const browser = await cdpClient.connectToProfile(input.profileId)
  const page = (
    await targetPages(browser, getPlatformRule(input.platform).allowed_domains, input.pageUrl)
  ).find((item) => item.url() === scan.pageUrl)
  if (!page) {
    throw new AppErrorClass('HTTP_4XX', '索引池页面已经关闭，请重新扫描', false, {
      kind: 'not_found',
      pageUrl: scan.pageUrl,
    })
  }

  await page.bringToFront().catch(() => null)
  const result = (await page.evaluate(clickProbeScript(CLICK_PROBE_TIMEOUT_MS, scan.items))) as {
    clickedAt: { x: number; y: number } | null
    item: CollectionImageIndexItem | null
    timedOut: boolean
  }
  return {
    pageUrl: scan.pageUrl,
    title: scan.title,
    clickedAt: result.clickedAt,
    item: result.item,
    timedOut: result.timedOut,
  } satisfies CollectionImageIndexClickResult
}

export async function downloadCollectionImageIndexSample(input: ProbeInput) {
  return downloadCollectionImageIndexItems({
    ...input,
    limit: input.limit ?? DEFAULT_DOWNLOAD_LIMIT,
  })
}

export async function downloadCollectionImageIndexItems(input: DownloadInput) {
  const debug = input.debug
  const startedAt = Date.now()
  const passedItems = input.items?.length ? uniqueDownloadItems(input.items) : null
  const scan = passedItems
    ? scanResultFromItems(passedItems, input.pageUrl)
    : await scanCollectionImageIndex({
        ...input,
        limit: input.limit ?? DEFAULT_DOWNLOAD_LIMIT,
      })
  const targetDir = await resolveOutputDir(input.outputDir, input.platform)
  await mkdir(targetDir, { recursive: true })
  const saved: CollectionImageIndexDownloadResult['saved'] = []
  const failed: CollectionImageIndexDownloadResult['failed'] = []
  const items = passedItems ?? scan.items.slice(0, input.limit ?? DEFAULT_DOWNLOAD_LIMIT)
  const createdAt = Date.now()
  debug?.('开始下载图池图片', 'info', {
    operation: 'download',
    stage: 'start',
    total: items.length,
    outputDir: targetDir,
  })

  for (const [index, item] of items.entries()) {
    const itemStartedAt = Date.now()
    debug?.(`第 ${index + 1}/${items.length} 张开始下载`, 'info', {
      operation: 'download',
      stage: 'progress',
      index: index + 1,
      total: items.length,
      bucket: item.bucket,
      groupTitle: item.groupTitle ?? null,
      pageUrl: item.sourcePageUrl ?? scan.pageUrl,
      url: shortLogText(item.originalUrl),
    })
    try {
      const image = await downloadImage(item.originalUrl)
      const itemTargetDir = collectionImageIndexItemTargetDir(
        targetDir,
        input.platform,
        item.sourcePageUrl ?? scan.pageUrl,
        item,
      )
      await mkdir(itemTargetDir, { recursive: true })
      const savedPath = await nextImagePath(
        itemTargetDir,
        `${input.platform}-${timestampSlug(createdAt)}-${String(index + 1).padStart(2, '0')}`,
        image.extension,
      )
      await writeFile(savedPath, image.buffer)
      saved.push({ item, savedPath, bytes: image.buffer.byteLength })
      debug?.(`第 ${index + 1}/${items.length} 张成功`, 'info', {
        operation: 'download',
        stage: 'success',
        index: index + 1,
        total: items.length,
        bytes: image.buffer.byteLength,
        durationMs: Date.now() - itemStartedAt,
        savedPath,
        bucket: item.bucket,
        groupTitle: item.groupTitle ?? null,
      })
    } catch (error) {
      const message = appErrorMessage(error)
      failed.push({ item, error: message })
      debug?.(`第 ${index + 1}/${items.length} 张失败`, 'error', {
        operation: 'download',
        stage: 'failed',
        index: index + 1,
        total: items.length,
        durationMs: Date.now() - itemStartedAt,
        error: message,
        bucket: item.bucket,
        groupTitle: item.groupTitle ?? item.sourcePageTitle ?? null,
        pageUrl: item.sourcePageUrl ?? scan.pageUrl,
        url: shortLogText(item.originalUrl),
      })
    }
  }

  debug?.('图池下载完成', failed.length > 0 ? 'warn' : 'info', {
    operation: 'download',
    stage: 'finish',
    total: items.length,
    saved: saved.length,
    failed: failed.length,
    durationMs: Date.now() - startedAt,
    outputDir: targetDir,
  })
  return { scan, outputDir: targetDir, saved, failed } satisfies CollectionImageIndexDownloadResult
}

export function collectionImageIndexItemTargetDir(
  rootDir: string,
  platform: string,
  pageUrl: string | undefined,
  item: Partial<
    Pick<
      CollectionImageIndexItem,
      'bucket' | 'pageKind' | 'goodsLink' | 'sourcePageUrl' | 'groupKey'
    >
  >,
) {
  const sourcePageUrl = item.sourcePageUrl ?? pageUrl
  const bucket = collectionImageIndexItemBucket(platform, sourcePageUrl, item)
  if (bucket === 'loose') {
    return rootDir
  }
  const folderName = collectionImageIndexProductFolderName(platform, sourcePageUrl, item)
  return join(rootDir, '商品页', folderName ?? '未识别商品')
}

export function collectionImageIndexProductFolderName(
  platform: string,
  pageUrl: string | undefined,
  item: Partial<Pick<CollectionImageIndexItem, 'goodsLink' | 'groupKey'>>,
) {
  if (item.groupKey?.trim()) {
    return safePathSegment(item.groupKey.trim())
  }
  if (platform !== 'temu') {
    return null
  }
  const currentPageGoodsId = temuGoodsIdFromUrl(pageUrl)
  const itemGoodsId = temuGoodsIdFromUrl(item.goodsLink)
  const goodsId = currentPageGoodsId ?? itemGoodsId
  return goodsId ? safePathSegment(`temu-g-${goodsId}`) : null
}

export function collectionImageIndexPageKind(
  platform: string,
  pageUrl: string | undefined,
): CollectionImageIndexPageKind {
  if (platform !== 'temu' || !pageUrl) {
    return 'platform'
  }
  if (temuGoodsIdFromUrl(pageUrl)) {
    return 'detail'
  }
  let url: URL
  try {
    url = new URL(pageUrl)
  } catch {
    return 'platform'
  }
  const pathname = url.pathname.toLowerCase()
  if (pathname.includes('/search_result.html')) {
    return 'search'
  }
  if (pathname.includes('/channel/')) {
    return 'channel'
  }
  if (pathname === '/' || /^\/[a-z]{2}(?:-[a-z]{2})?\/?$/i.test(url.pathname)) {
    return 'home'
  }
  return 'platform'
}

export function collectionImageIndexDetailGalleryBounds(
  candidates: CollectionImageIndexDetailGalleryCandidate[],
  viewport: { width: number; height: number },
): CollectionImageIndexRect | null {
  const usable = candidates.filter((candidate) => {
    const rect = candidate.rect
    return rect.width >= 40 && rect.height >= 40 && rect.right > 0 && rect.x < viewport.width * 0.75
  })
  const hero = usable
    .filter((candidate) => candidate.rect.width >= 240 && candidate.rect.height >= 240)
    .sort((left, right) => {
      if (left.rect.y !== right.rect.y) {
        return left.rect.y - right.rect.y
      }
      return right.rect.width * right.rect.height - left.rect.width * left.rect.height
    })[0]

  if (!hero) {
    return null
  }

  const galleryItems = usable.filter((candidate) => {
    const rect = candidate.rect
    return (
      rect.x <= hero.rect.right + 32 &&
      rect.right >= Math.max(0, hero.rect.x - 180) &&
      rect.y <= hero.rect.bottom + 48 &&
      rect.bottom >= hero.rect.y - 80
    )
  })
  const boundsItems = galleryItems.length ? galleryItems : [hero]
  const left = Math.max(0, Math.min(...boundsItems.map((item) => item.rect.x)) - 16)
  const top = Math.min(...boundsItems.map((item) => item.rect.y)) - 16
  const right = Math.max(...boundsItems.map((item) => item.rect.right)) + 16
  const bottom = Math.max(...boundsItems.map((item) => item.rect.bottom)) + 16

  return {
    x: Math.round(left),
    y: Math.round(top),
    width: Math.round(right - left),
    height: Math.round(bottom - top),
    right: Math.round(right),
    bottom: Math.round(bottom),
  }
}

export function collectionImageIndexRectCenterInside(
  rect: CollectionImageIndexRect,
  bounds: CollectionImageIndexRect,
) {
  const centerX = rect.x + rect.width / 2
  const centerY = rect.y + rect.height / 2
  return (
    centerX >= bounds.x &&
    centerX <= bounds.right &&
    centerY >= bounds.y &&
    centerY <= bounds.bottom
  )
}

export function collectionImageIndexUpgradeTemuImageUrl(url: string) {
  if (!/img\.kwcdn\.com/i.test(url)) {
    return url
  }

  let next = url.replace(/\/w\/\d+/gi, '/w/1300').replace(/\/q\/\d+/gi, '/q/90')
  if (/imageView2\/2/i.test(next)) {
    if (!/\/w\/\d+/i.test(next)) {
      next += '/w/1300'
    }
    if (!/\/q\/\d+/i.test(next)) {
      next += '/q/90'
    }
    return next
  }

  const hashIndex = next.indexOf('#')
  const hash = hashIndex >= 0 ? next.slice(hashIndex) : ''
  const withoutHash = hashIndex >= 0 ? next.slice(0, hashIndex) : next
  const separator = withoutHash.includes('?') ? '&' : '?'
  return `${withoutHash}${separator}imageView2/2/w/1300/q/90/format/webp${hash}`
}

function collectionImageIndexItemBucket(
  platform: string,
  pageUrl: string | undefined,
  item: Partial<Pick<CollectionImageIndexItem, 'bucket' | 'pageKind'>>,
): CollectionImageIndexBucket {
  if (item.bucket === 'loose' || item.bucket === 'product') {
    return item.bucket
  }
  const pageKind = item.pageKind ?? collectionImageIndexPageKind(platform, pageUrl)
  return pageKind === 'detail' ? 'product' : 'loose'
}

function temuGoodsIdFromUrl(value: string | null | undefined) {
  if (!value) {
    return null
  }
  let url: URL
  try {
    url = new URL(value)
  } catch {
    return null
  }
  if (!/(\.|^)temu\.com$/i.test(url.hostname)) {
    return null
  }
  const slugMatch = url.pathname.match(/-g-(\d+)\.html$/i)
  if (slugMatch?.[1]) {
    return slugMatch[1]
  }
  const goodsPathMatch = url.pathname.match(/\/goods\/([^/?#]+)/i)
  if (goodsPathMatch?.[1]) {
    return goodsPathMatch[1]
  }
  return url.searchParams.get('goods_id') ?? url.searchParams.get('goodsId')
}

function safePathSegment(value: string) {
  return value
    .replace(/[<>:"/\\|?*]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120)
}

function uniqueDownloadItems(items: CollectionImageIndexItem[]) {
  const unique = new Map<string, CollectionImageIndexItem>()
  for (const item of items) {
    const key = collectionImageIndexDownloadKey(item)
    if (!unique.has(key)) {
      unique.set(key, item)
    }
  }
  return Array.from(unique.values())
}

function collectionImageIndexDownloadKey(item: CollectionImageIndexItem) {
  const bucket = item.bucket ?? 'loose'
  const group =
    bucket === 'product' ? (item.groupKey ?? item.sourcePageUrl ?? item.goodsLink ?? '') : ''
  return `${bucket}:${group}:${urlWithoutSearchAndHash(item.originalUrl)}`
}

function urlWithoutSearchAndHash(value: string) {
  try {
    const url = new URL(value)
    url.search = ''
    url.hash = ''
    return url.href
  } catch {
    return value.replace(/[?#].*$/, '')
  }
}

function scanResultFromItems(
  items: CollectionImageIndexItem[],
  pageUrl: string | undefined,
): CollectionImageIndexScanResult {
  const sourceCounts = items.reduce<Record<string, number>>((counts, item) => {
    counts[item.source] = (counts[item.source] ?? 0) + 1
    return counts
  }, {})
  const summary = {
    pageUrl: pageUrl ?? items[0]?.goodsLink ?? '',
    title: '已选图池',
    imageCount: items.length,
    indexedCount: items.length,
    collectableCount: items.length,
  }
  return {
    ...summary,
    sourceCounts,
    items,
    scannedPages: [summary],
  }
}

async function scanPageImageIndex(
  page: Page,
  itemLimit: number,
  platform: string,
): Promise<CollectionImageIndexScanResult> {
  await page.waitForLoadState('domcontentloaded').catch(() => null)
  await page.waitForTimeout(SCAN_PAGE_STABILIZE_MS).catch(() => null)
  const payload = (await page.evaluate(scanScript(itemLimit, platform))) as PageIndexPayload
  return {
    pageUrl: payload.href,
    title: payload.title,
    imageCount: payload.imageCount,
    indexedCount: payload.indexedCount,
    collectableCount: payload.collectableCount,
    sourceCounts: payload.sourceCounts,
    items: payload.items,
    scannedPages: [
      {
        pageUrl: payload.href,
        title: payload.title,
        imageCount: payload.imageCount,
        indexedCount: payload.indexedCount,
        collectableCount: payload.collectableCount,
      },
    ],
  }
}

function bestScanResult(results: CollectionImageIndexScanResult[]) {
  const ordered = [...results].sort((left, right) => {
    if (right.collectableCount !== left.collectableCount) {
      return right.collectableCount - left.collectableCount
    }
    return right.indexedCount - left.indexedCount
  })
  const best = ordered[0]
  if (!best) {
    throw new AppErrorClass('HTTP_4XX', '当前平台页面没有可扫描结果', false, { kind: 'not_found' })
  }
  return {
    ...best,
    scannedPages: ordered.map((item) => ({
      pageUrl: item.pageUrl,
      title: item.title,
      imageCount: item.imageCount,
      indexedCount: item.indexedCount,
      collectableCount: item.collectableCount,
    })),
  } satisfies CollectionImageIndexScanResult
}

function currentPageCacheKey(input: CurrentPageInput) {
  return `${input.platform}:${input.profileId}`
}

export function chooseCollectionCurrentPage(
  platform: string,
  snapshots: CollectionPageActivitySnapshot[],
  previous: CollectionCurrentPageResult | undefined,
): CollectionCurrentPageResult {
  const active = snapshots
    .filter((item) => item.visible || item.focused)
    .sort((left, right) => {
      if (Number(right.focused) !== Number(left.focused)) {
        return Number(right.focused) - Number(left.focused)
      }
      if (Number(right.visible) !== Number(left.visible)) {
        return Number(right.visible) - Number(left.visible)
      }
      return right.lastActivityAt - left.lastActivityAt || right.detectedAt - left.detectedAt
    })[0]
  if (active) {
    return currentPageResultFromSnapshot(platform, active, 'active')
  }
  if (previous?.pageUrl) {
    return { ...previous, status: 'last_valid' }
  }
  return {
    pageUrl: '',
    title: '',
    status: 'none',
    isGoodsPage: false,
    goodsId: null,
    lastDetectedAt: null,
  }
}

function currentPageResultFromSnapshot(
  platform: string,
  snapshot: CollectionPageActivitySnapshot,
  status: CollectionCurrentPageStatus,
): CollectionCurrentPageResult {
  const goodsId = platform === 'temu' ? temuGoodsIdFromUrl(snapshot.pageUrl) : null
  return {
    pageUrl: snapshot.pageUrl,
    title: snapshot.title,
    status,
    isGoodsPage: Boolean(goodsId),
    goodsId,
    lastDetectedAt: snapshot.lastActivityAt || snapshot.detectedAt,
  }
}

async function pageActivitySnapshot(page: Page): Promise<CollectionPageActivitySnapshot> {
  await ensurePageActivityTracker(page)
  const activity = await page
    .evaluate(() => {
      const state = (
        window as typeof window & {
          __collectionImageIndexActivity?: { lastActivityAt?: number }
        }
      ).__collectionImageIndexActivity
      return {
        title: document.title,
        visible: document.visibilityState === 'visible',
        focused: document.hasFocus(),
        lastActivityAt: Number(state?.lastActivityAt ?? 0),
      }
    })
    .catch(() => ({
      title: '',
      visible: false,
      focused: false,
      lastActivityAt: 0,
    }))
  return {
    pageUrl: page.url(),
    title: activity.title,
    visible: activity.visible,
    focused: activity.focused,
    lastActivityAt: activity.lastActivityAt,
    detectedAt: Date.now(),
  }
}

async function ensurePageActivityTracker(page: Page) {
  await page
    .evaluate(() => {
      const global = window as typeof window & {
        __collectionImageIndexActivity?: { installed?: boolean; lastActivityAt?: number }
      }
      if (global.__collectionImageIndexActivity?.installed) {
        return
      }
      const state = {
        installed: true,
        lastActivityAt: Date.now(),
      }
      global.__collectionImageIndexActivity = state
      const mark = () => {
        state.lastActivityAt = Date.now()
      }
      for (const eventName of ['focus', 'pointerdown', 'keydown', 'visibilitychange']) {
        window.addEventListener(eventName, mark, true)
        document.addEventListener(eventName, mark, true)
      }
      if (document.visibilityState === 'visible') {
        mark()
      }
    })
    .catch(() => null)
}

function candidatePages(browser: Browser, allowedDomains: string[]) {
  return browser
    .contexts()
    .flatMap((context) => context.pages())
    .filter((page) => !page.isClosed() && isAllowedDomain(page.url(), allowedDomains))
}

async function targetPages(
  browser: Browser,
  allowedDomains: string[],
  pageUrlOrKeyword: string | undefined,
) {
  const pages = candidatePages(browser, allowedDomains)
  const target = pageUrlOrKeyword?.trim()
  if (!target) {
    return pages
  }

  const exact = pages.filter((page) => samePageUrl(page.url(), target))
  if (exact.length > 0) {
    return exact
  }

  const matched = pages.filter((page) => page.url().includes(target) || target.includes(page.url()))
  if (matched.length > 0) {
    return matched
  }
  if (!/^https?:\/\//i.test(target) || !isAllowedDomain(target, allowedDomains)) {
    return []
  }

  const context = browser.contexts()[0] ?? (await browser.newContext())
  const page = await context.newPage()
  await page.goto(target, { waitUntil: 'domcontentloaded' }).catch(() => null)
  await page.waitForTimeout(5_000).catch(() => null)
  return [page]
}

async function openOrReusePage(browser: Browser, allowedDomains: string[], pageUrl: string) {
  const pages = candidatePages(browser, allowedDomains)
  const existing = pages.find((page) => samePageUrl(page.url(), pageUrl))
  if (existing) {
    return existing
  }
  const context = browser.contexts()[0] ?? (await browser.newContext())
  const page = await context.newPage()
  await page.goto(pageUrl, { waitUntil: 'domcontentloaded' }).catch(() => null)
  return page
}

function samePageUrl(left: string, right: string) {
  try {
    const leftUrl = new URL(left)
    const rightUrl = new URL(right)
    leftUrl.hash = ''
    rightUrl.hash = ''
    return leftUrl.href === rightUrl.href
  } catch {
    return left === right
  }
}

function isAllowedDomain(url: string, allowedDomains: string[]) {
  let hostname: string
  try {
    hostname = new URL(url).hostname.toLowerCase()
  } catch {
    return false
  }

  return allowedDomains.some((domain) => {
    const normalized = domain.trim().toLowerCase()
    if (!normalized) {
      return false
    }
    if (normalized.startsWith('*.')) {
      const suffix = normalized.slice(1)
      return hostname.endsWith(suffix) && hostname.length > suffix.length
    }
    return hostname === normalized
  })
}

async function resolveOutputDir(_outputDir: string | undefined, platform: string) {
  const { readAppConfig } = await import('../onboarding')
  const config = await readAppConfig()
  if (!config.workbench_root) {
    throw new AppErrorClass('HTTP_4XX', '请先在设置里选择工作区', false, {
      kind: 'validation',
    })
  }
  return join(
    config.workbench_root,
    WORKBENCH_DIRECTORIES.collection,
    `${platform}-${timestampSlug(Date.now())}`,
  )
}

async function downloadImage(url: string): Promise<DownloadedImage> {
  const response = await fetch(url, {
    headers: {
      'user-agent':
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
    },
  })
  if (!response.ok) {
    throw new AppErrorClass('HTTP_5XX', '下载索引池图片失败', true, {
      status: response.status,
      url,
    })
  }
  const buffer = Buffer.from(await response.arrayBuffer())
  if (isAvifBuffer(buffer) || response.headers.get('content-type')?.includes('avif')) {
    const sharp = nodeRequire('sharp') as typeof import('sharp')
    return { buffer: await sharp(buffer).png().toBuffer(), extension: '.png' }
  }
  return { buffer, extension: extensionFromUrl(url) }
}

function extensionFromUrl(url: string): DownloadedImage['extension'] {
  try {
    const pathname = new URL(url).pathname.toLowerCase()
    if (pathname.endsWith('.png')) return '.png'
    if (pathname.endsWith('.webp')) return '.webp'
    if (pathname.endsWith('.jpeg')) return '.jpeg'
  } catch {}
  return '.jpg'
}

function isAvifBuffer(buffer: Buffer) {
  if (buffer.byteLength < 16 || buffer.toString('ascii', 4, 8) !== 'ftyp') {
    return false
  }
  const brandHeader = buffer.toString('ascii', 8, Math.min(buffer.byteLength, 32))
  return brandHeader.includes('avif') || brandHeader.includes('avis')
}

async function nextImagePath(folder: string, baseName: string, ext: string) {
  for (let index = 1; index <= 9999; index += 1) {
    const suffix = index === 1 ? '' : `-${String(index).padStart(3, '0')}`
    const candidate = join(folder, `${baseName}${suffix}${ext}`)
    try {
      await stat(candidate)
    } catch {
      return candidate
    }
  }
  throw new AppErrorClass('HTTP_4XX', '索引池验证文件序号已达上限', false, { folder })
}

function timestampSlug(value: number) {
  const date = new Date(value)
  const pad = (item: number) => String(item).padStart(2, '0')
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`
}

function appErrorMessage(error: unknown) {
  if (error instanceof Error) {
    return error.message
  }
  return String(error)
}

const ImageIndexRectSchema = z.object({
  x: z.number(),
  y: z.number(),
  width: z.number(),
  height: z.number(),
  right: z.number(),
  bottom: z.number(),
})

const ImageIndexItemSchema = z.object({
  id: z.string(),
  bucket: z.enum(['loose', 'product']).default('loose'),
  pageKind: z.enum(['home', 'search', 'channel', 'detail', 'platform']).default('platform'),
  source: z.enum(['img', 'source', 'background', 'performance', 'url_param']),
  displayUrl: z.string().min(1),
  originalUrl: z.string().min(1),
  score: z.number(),
  visible: z.boolean(),
  rect: ImageIndexRectSchema.nullable(),
  naturalWidth: z.number(),
  naturalHeight: z.number(),
  goodsLink: z.string().nullable(),
  groupKey: z.string().nullable().default(null),
  groupTitle: z.string().nullable().default(null),
  coverUrl: z.string().nullable().default(null),
  tag: z.string(),
  sourcePageUrl: z.string().optional(),
  sourcePageTitle: z.string().optional(),
  scannedAt: z.number().optional(),
})

const ImageIndexInputSchema = z.object({
  platform: z.string().min(1),
  profile_id: z.string().min(1),
  output_dir: z.string().optional(),
  page_url: z.string().optional(),
  limit: z.number().int().min(0).max(500).optional(),
  items: z.array(ImageIndexItemSchema).max(1000).optional(),
})

const CurrentPageInputSchema = z.object({
  platform: z.string().min(1),
  profile_id: z.string().min(1),
})

const OpenPageInputSchema = CurrentPageInputSchema.extend({
  page_url: z.string().url(),
})

export function registerCollectionImageIndexIpc() {
  const ipcMain = electronIpcMain()
  ipcMain.handle('collection:get-current-page', (_event, input: unknown) => {
    const parsed = CurrentPageInputSchema.safeParse(input)
    if (!parsed.success) {
      throw new AppErrorClass('HTTP_4XX', '当前页面检测参数不正确', false, {
        kind: 'validation',
        issues: parsed.error.issues,
      })
    }
    return getCollectionCurrentPage({
      platform: parsed.data.platform,
      profileId: parsed.data.profile_id,
    })
  })
  ipcMain.handle('collection:open-page', (_event, input: unknown) => {
    const parsed = OpenPageInputSchema.safeParse(input)
    if (!parsed.success) {
      throw new AppErrorClass('HTTP_4XX', '打开采集页面参数不正确', false, {
        kind: 'validation',
        issues: parsed.error.issues,
      })
    }
    return openCollectionPage({
      platform: parsed.data.platform,
      profileId: parsed.data.profile_id,
      pageUrl: parsed.data.page_url,
    })
  })
  ipcMain.handle('collection:scan-image-index', (_event, input: unknown) => {
    const parsed = ImageIndexInputSchema.safeParse(input)
    if (!parsed.success) {
      throw new AppErrorClass('HTTP_4XX', '索引池扫描参数不正确', false, {
        kind: 'validation',
        issues: parsed.error.issues,
      })
    }
    return scanCollectionImageIndex({
      platform: parsed.data.platform,
      profileId: parsed.data.profile_id,
      ...(parsed.data.output_dir ? { outputDir: parsed.data.output_dir } : {}),
      ...(parsed.data.page_url ? { pageUrl: parsed.data.page_url } : {}),
      ...(parsed.data.limit !== undefined ? { limit: parsed.data.limit } : {}),
      debug: createCollectionImageIndexDebugEmitter(),
    })
  })
  ipcMain.handle('collection:probe-image-index-click', (_event, input: unknown) => {
    const parsed = ImageIndexInputSchema.safeParse(input)
    if (!parsed.success) {
      throw new AppErrorClass('HTTP_4XX', '索引池点击测试参数不正确', false, {
        kind: 'validation',
        issues: parsed.error.issues,
      })
    }
    return probeCollectionImageIndexClick({
      platform: parsed.data.platform,
      profileId: parsed.data.profile_id,
      ...(parsed.data.output_dir ? { outputDir: parsed.data.output_dir } : {}),
      ...(parsed.data.page_url ? { pageUrl: parsed.data.page_url } : {}),
      ...(parsed.data.limit !== undefined ? { limit: parsed.data.limit } : {}),
      debug: createCollectionImageIndexDebugEmitter(),
    })
  })
  ipcMain.handle('collection:download-image-index-sample', (_event, input: unknown) => {
    const parsed = ImageIndexInputSchema.safeParse(input)
    if (!parsed.success) {
      throw new AppErrorClass('HTTP_4XX', '索引池下载参数不正确', false, {
        kind: 'validation',
        issues: parsed.error.issues,
      })
    }
    return downloadCollectionImageIndexSample({
      platform: parsed.data.platform,
      profileId: parsed.data.profile_id,
      ...(parsed.data.output_dir ? { outputDir: parsed.data.output_dir } : {}),
      ...(parsed.data.page_url ? { pageUrl: parsed.data.page_url } : {}),
      ...(parsed.data.limit !== undefined ? { limit: parsed.data.limit } : {}),
      debug: createCollectionImageIndexDebugEmitter(),
    })
  })
  ipcMain.handle('collection:download-image-index-items', (_event, input: unknown) => {
    const parsed = ImageIndexInputSchema.safeParse(input)
    if (!parsed.success) {
      throw new AppErrorClass('HTTP_4XX', '图池下载参数不正确', false, {
        kind: 'validation',
        issues: parsed.error.issues,
      })
    }
    return downloadCollectionImageIndexItems({
      platform: parsed.data.platform,
      profileId: parsed.data.profile_id,
      ...(parsed.data.output_dir ? { outputDir: parsed.data.output_dir } : {}),
      ...(parsed.data.page_url ? { pageUrl: parsed.data.page_url } : {}),
      ...(parsed.data.limit !== undefined ? { limit: parsed.data.limit } : {}),
      ...(parsed.data.items ? { items: parsed.data.items } : {}),
      debug: createCollectionImageIndexDebugEmitter(),
    })
  })
}

function electronIpcMain(): typeof ipcMain {
  return (nodeRequire('electron') as typeof import('electron')).ipcMain
}

function electronBrowserWindow() {
  return (nodeRequire('electron') as typeof import('electron')).BrowserWindow
}

function scanScript(itemLimit: number, platform: string) {
  return `(() => {
    const __name = (value) => value;
    const detailGalleryBounds = (${collectionImageIndexDetailGalleryBounds.toString()});
    const rectCenterInside = (${collectionImageIndexRectCenterInside.toString()});
    const upgradeTemuImageUrl = (${collectionImageIndexUpgradeTemuImageUrl.toString()});
    const scanImageIndex = (${scanImageIndexOnPage.toString()});
    return scanImageIndex(${JSON.stringify(itemLimit)}, ${JSON.stringify(platform)}, detailGalleryBounds, rectCenterInside, upgradeTemuImageUrl);
  })()`
}

function clickProbeScript(timeoutMs: number, indexedItems: CollectionImageIndexItem[]) {
  return `(() => {
    const indexedItems = ${JSON.stringify(indexedItems)};
    return new Promise((resolve) => {
      let settled = false;
      const done = (value) => {
        if (settled) return;
        settled = true;
        document.removeEventListener('click', onClick, true);
        window.clearTimeout(timer);
        resolve(value);
      };
      const onClick = (event) => {
        const x = event.clientX;
        const y = event.clientY;
        const hit = indexedItems
          .filter((item) => {
            const rect = item.rect;
            if (!rect) return false;
            const margin = 4;
            return x >= rect.x - margin &&
              x <= rect.right + margin &&
              y >= rect.y - margin &&
              y <= rect.bottom + margin;
          })
          .sort((left, right) => right.score - left.score)[0] || null;
        done({ clickedAt: { x, y }, item: hit, timedOut: false });
      };
      const timer = window.setTimeout(() => {
        done({ clickedAt: null, item: null, timedOut: true });
      }, ${JSON.stringify(timeoutMs)});
      document.addEventListener('click', onClick, true);
    });
  })()`
}

function scanImageIndexOnPage(
  itemLimit: number,
  platform: string,
  detailGalleryBounds: typeof collectionImageIndexDetailGalleryBounds,
  rectCenterInside: typeof collectionImageIndexRectCenterInside,
  upgradeTemuImageUrl: typeof collectionImageIndexUpgradeTemuImageUrl,
): PageIndexPayload {
  const productRe = /img\.kwcdn\.com\/(product|local-image)\//i
  const goodsRe = /(?:-g-\d+|goods(?:\.html)?|goods_id=|goodsId=)/i
  const badRe = /sprite|logo|icon|avatar|payment|captcha|data:|blob:|about:/i
  const collectableThreshold = 55
  const pageKind = pageKindFor(platform, location.href)
  const bucket = pageKind === 'detail' ? 'product' : 'loose'
  const groupKey = bucket === 'product' ? productGroupKey(platform, location.href) : null
  const groupTitle = bucket === 'product' ? document.title || null : null
  const isTemuDetailPage = platform === 'temu' && pageKind === 'detail'
  let temuDetailGalleryBounds: CollectionImageIndexRect | null | undefined

  function abs(raw: string | null | undefined) {
    if (!raw || typeof raw !== 'string') {
      return null
    }
    const value = raw.trim().replace(/&amp;/g, '&')
    if (!value || badRe.test(value)) {
      return null
    }
    const cleaned = value.replace(/^url\((['"]?)(.*?)\1\)$/i, '$2')
    try {
      return new URL(cleaned, location.href).href
    } catch {
      return null
    }
  }

  function srcsetUrls(value: string | null) {
    if (!value) {
      return []
    }
    return value
      .split(',')
      .map((part) => abs(part.trim().split(/\s+/)[0]))
      .filter((item): item is string => Boolean(item))
  }

  function temuGoodsIdFromUrl(value: string | null | undefined) {
    if (!value) {
      return null
    }
    let url: URL
    try {
      url = new URL(value, location.href)
    } catch {
      return null
    }
    if (!/(\.|^)temu\.com$/i.test(url.hostname)) {
      return null
    }
    const slugMatch = url.pathname.match(/-g-(\d+)\.html$/i)
    if (slugMatch?.[1]) {
      return slugMatch[1]
    }
    const goodsPathMatch = url.pathname.match(/\/goods\/([^/?#]+)/i)
    if (goodsPathMatch?.[1]) {
      return goodsPathMatch[1]
    }
    return url.searchParams.get('goods_id') ?? url.searchParams.get('goodsId')
  }

  function pageKindFor(platformName: string, pageUrl: string): CollectionImageIndexPageKind {
    if (platformName !== 'temu') {
      return 'platform'
    }
    if (temuGoodsIdFromUrl(pageUrl)) {
      return 'detail'
    }
    let url: URL
    try {
      url = new URL(pageUrl)
    } catch {
      return 'platform'
    }
    const pathname = url.pathname.toLowerCase()
    if (pathname.includes('/search_result.html')) {
      return 'search'
    }
    if (pathname.includes('/channel/')) {
      return 'channel'
    }
    if (pathname === '/' || /^\/[a-z]{2}(?:-[a-z]{2})?\/?$/i.test(url.pathname)) {
      return 'home'
    }
    return 'platform'
  }

  function productGroupKey(platformName: string, pageUrl: string) {
    if (platformName === 'temu') {
      const goodsId = temuGoodsIdFromUrl(pageUrl)
      return goodsId ? `temu-g-${goodsId}` : null
    }
    return null
  }

  function rectOf(element: Element): CollectionImageIndexRect {
    const rect = element.getBoundingClientRect()
    return {
      x: Math.round(rect.left),
      y: Math.round(rect.top),
      width: Math.round(rect.width),
      height: Math.round(rect.height),
      right: Math.round(rect.right),
      bottom: Math.round(rect.bottom),
    }
  }

  function candidateImageUrl(image: HTMLImageElement) {
    return (
      abs(image.currentSrc) ??
      abs(image.src) ??
      abs(image.getAttribute('src')) ??
      abs(image.getAttribute('data-src')) ??
      abs(image.getAttribute('data-original')) ??
      abs(image.getAttribute('data-image-url')) ??
      abs(image.getAttribute('data-lazy-src'))
    )
  }

  function detailGalleryBoundsForPage() {
    if (!isTemuDetailPage) {
      return null
    }
    if (temuDetailGalleryBounds !== undefined) {
      return temuDetailGalleryBounds
    }
    const candidates = Array.from(document.querySelectorAll('img'))
      .map((image) => {
        const img = image as HTMLImageElement
        const url = candidateImageUrl(img)
        if (!url || !productRe.test(url)) {
          return null
        }
        return {
          rect: rectOf(img),
          naturalWidth: img.naturalWidth,
          naturalHeight: img.naturalHeight,
        }
      })
      .filter((item): item is CollectionImageIndexDetailGalleryCandidate => Boolean(item))

    temuDetailGalleryBounds = detailGalleryBounds(candidates, {
      width: innerWidth,
      height: innerHeight,
    })
    return temuDetailGalleryBounds
  }

  function shouldKeepDetailImage(
    source: CollectionImageIndexSource,
    originalUrl: string,
    rect: CollectionImageIndexRect | null,
  ) {
    if (!isTemuDetailPage) {
      return true
    }
    if (source !== 'img' && source !== 'source') {
      return false
    }
    if (!rect || !productRe.test(originalUrl)) {
      return false
    }
    const bounds = detailGalleryBoundsForPage()
    return Boolean(bounds && rectCenterInside(rect, bounds))
  }

  function isVisible(rect: CollectionImageIndexRect | null) {
    return Boolean(
      rect &&
        rect.width > 0 &&
        rect.height > 0 &&
        rect.bottom > 0 &&
        rect.right > 0 &&
        rect.y < innerHeight &&
        rect.x < innerWidth,
    )
  }

  function nearestGoodsLink(element: Element) {
    let current: Element | null = element
    for (let depth = 0; current && depth < 10; depth += 1, current = current.parentElement) {
      if (current.tagName === 'A') {
        const href = abs(current.getAttribute('href'))
        if (href && goodsRe.test(href)) {
          return href
        }
      }
      for (const attr of ['href', 'data-href', 'data-url', 'data-link']) {
        const href = abs(current.getAttribute(attr))
        if (href && goodsRe.test(href)) {
          return href
        }
      }
      const link = current.querySelector?.('a[href*="-g-"],a[href*="goods"]')
      const href = abs(link?.getAttribute('href'))
      if (href && goodsRe.test(href)) {
        return href
      }
    }
    if (goodsRe.test(location.href)) {
      return location.href
    }
    return null
  }

  function score(item: Omit<CollectionImageIndexItem, 'id' | 'score'>) {
    let value = 0
    if (productRe.test(item.originalUrl)) value += 45
    if (item.goodsLink) value += 25
    if (item.visible) value += 10
    if (item.rect && item.rect.width >= 120 && item.rect.height >= 120) value += 15
    if (item.naturalWidth >= 500 || item.naturalHeight >= 500) value += 10
    if (item.source === 'performance') value -= 8
    if (badRe.test(item.originalUrl)) value -= 60
    return value
  }

  const rawItems: Array<Omit<CollectionImageIndexItem, 'id' | 'score'>> = []

  function add(entry: {
    source: CollectionImageIndexSource
    url: string | null | undefined
    rect: CollectionImageIndexRect | null
    naturalWidth?: number | undefined
    naturalHeight?: number | undefined
    goodsLink?: string | null | undefined
    tag?: string | undefined
  }) {
    const displayUrl = abs(entry.url)
    if (!displayUrl) {
      return
    }
    const originalUrl = upgradeTemuImageUrl(displayUrl)
    if (!shouldKeepDetailImage(entry.source, originalUrl, entry.rect)) {
      return
    }
    rawItems.push({
      bucket,
      pageKind,
      source: entry.source,
      displayUrl,
      originalUrl,
      rect: entry.rect,
      visible: isVisible(entry.rect),
      naturalWidth: entry.naturalWidth ?? 0,
      naturalHeight: entry.naturalHeight ?? 0,
      goodsLink: entry.goodsLink ?? null,
      groupKey,
      groupTitle,
      coverUrl: bucket === 'product' ? originalUrl : null,
      tag: entry.tag ?? '',
      sourcePageUrl: location.href,
      sourcePageTitle: document.title,
    })
  }

  for (const image of document.querySelectorAll('img')) {
    const img = image as HTMLImageElement
    const rect = rectOf(img)
    const goodsLink = nearestGoodsLink(img)
    const urls = [
      img.currentSrc,
      img.src,
      img.getAttribute('src'),
      img.getAttribute('data-src'),
      img.getAttribute('data-original'),
      img.getAttribute('data-image-url'),
      img.getAttribute('data-lazy-src'),
      ...srcsetUrls(img.getAttribute('srcset')),
    ]
    for (const url of urls) {
      add({
        source: 'img',
        url,
        rect,
        naturalWidth: img.naturalWidth,
        naturalHeight: img.naturalHeight,
        goodsLink,
        tag: img.className || img.getAttribute('data-js-main-img') || '',
      })
    }
  }

  for (const source of document.querySelectorAll('source[srcset]')) {
    const boxElement = source.closest('picture')?.querySelector('img') ?? source
    for (const url of srcsetUrls(source.getAttribute('srcset'))) {
      add({
        source: 'source',
        url,
        rect: rectOf(boxElement),
        goodsLink: nearestGoodsLink(source),
        tag: 'source',
      })
    }
  }

  for (const element of Array.from(document.querySelectorAll('body *')).slice(0, 8000)) {
    const background = getComputedStyle(element).backgroundImage
    if (!background || background === 'none' || !background.includes('url(')) {
      continue
    }
    for (const match of background.matchAll(/url\((['"]?)(.*?)\1\)/g)) {
      add({
        source: 'background',
        url: match[2],
        rect: rectOf(element),
        goodsLink: nearestGoodsLink(element),
        tag: String((element as HTMLElement).className || element.id || '').slice(0, 120),
      })
    }
  }

  for (const url of performance
    .getEntriesByType('resource')
    .map((entry) => entry.name)
    .filter((url) => /\.(avif|webp|png|jpe?g)(\?|$)|img\.kwcdn\.com/i.test(url))) {
    add({ source: 'performance', url, rect: null })
  }

  const topGalleryUrl = new URLSearchParams(location.search).get('top_gallery_url')
  if (topGalleryUrl) {
    add({ source: 'url_param', url: topGalleryUrl, rect: null })
  }

  const uniqueItems = new Map<string, CollectionImageIndexItem>()
  for (const item of rawItems) {
    const key = item.originalUrl.replace(/\?.*$/, '')
    const candidate = {
      ...item,
      id: '',
      score: score(item),
    }
    const existing = uniqueItems.get(key)
    if (!existing || candidate.score > existing.score || (candidate.visible && !existing.visible)) {
      uniqueItems.set(key, candidate)
    }
  }

  const indexed = Array.from(uniqueItems.values())
    .sort((left, right) => right.score - left.score)
    .map((item, index) => ({ ...item, id: `img_${String(index + 1).padStart(3, '0')}` }))
  const collectable = indexed.filter((item) => item.score >= collectableThreshold)
  const limit = Math.max(0, itemLimit)
  return {
    href: location.href,
    title: document.title,
    imageCount: document.images.length,
    indexedCount: indexed.length,
    collectableCount: collectable.length,
    sourceCounts: indexed.reduce<Record<string, number>>((counts, item) => {
      counts[item.source] = (counts[item.source] ?? 0) + 1
      return counts
    }, {}),
    items: limit > 0 ? collectable.slice(0, limit) : collectable,
  }
}
