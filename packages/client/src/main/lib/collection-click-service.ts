import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { extname, join } from 'node:path'
import { AppErrorClass, WORKBENCH_DIRECTORIES } from '@tengyu-aipod/shared'
import type { BrowserWindow, ipcMain } from 'electron'
import type { Page } from 'playwright'
import { z } from 'zod'
import { cdpClient } from './cdp-client'
import type { CollectionBindingPayload } from './cdp-client'
import { collectionFolderLock } from './collection-folder-lock'
import type { CollectionPlatformRule } from './collection-injected-script'
import {
  COLLECTION_RECORD_LIST_LIMIT_MAX,
  type CollectionRecordInput,
  type CollectionRecordRow,
  deleteCollectionRecord,
  getCollectionRecord,
  insertCollectionRecord,
  listCollectionRecords,
  openCollectionDatabase,
  updateCollectionRecord,
} from './collection-record-store'
import {
  type CollectionDebugLogLevel,
  type CollectionSession,
  type CollectionSessionEvent,
  type CollectionSessionManager,
  collectionSessionManager,
} from './collection-session-manager'
import type { SqliteDatabase } from './sqlite'

const nodeRequire = createRequire(import.meta.url)

export type CollectionClickEvent = {
  kind: 'click'
  img: string
  goodsLink?: string | undefined
  page: string
  platform?: string | undefined
}

export type CollectionScrollEvent = {
  kind: 'scroll'
  img: string
  goodsLink?: string | undefined
  page: string
  platform?: string | undefined
  width?: number | undefined
  height?: number | undefined
}

export type CollectionClickResult =
  | {
      status: 'success'
      record: CollectionRecordInput
      savedPath: string
    }
  | {
      status: 'skipped'
      record: CollectionRecordInput
      savedPath: string
      reason: string
    }
  | {
      status: 'pending_sku'
      goodsLink: string
    }
  | {
      status: 'failed'
      record: CollectionRecordInput
      error: string
    }

export type CollectionScrollResult = Exclude<CollectionClickResult, { status: 'pending_sku' }>

type CollectionSavedResult = CollectionScrollResult
type CollectionImageEvent = CollectionClickEvent | CollectionScrollEvent
type CollectionImageEventKind = CollectionImageEvent['kind']
type CollectionImageBuffer = {
  buffer: Buffer
  extension?: '.png' | undefined
}
type CollectionRuntimeEventKeyInput = {
  sessionId: string
  kind: CollectionImageEventKind
  img: string
  page: string
}

export type CollectionDispatchContext = {
  platformRule: CollectionPlatformRule
  mode: CollectionSession['mode']
}

export type CollectionClickServiceDependencies = {
  sessionManager?: Pick<
    CollectionSessionManager,
    'assignSessionSku' | 'getActiveSession' | 'getSessionSku' | 'requestSku'
  >
  downloadImage?: (url: string) => Promise<Buffer>
  captureImageWithBrowser?: (profileId: string, url: string, pageUrl: string) => Promise<Buffer>
  openDatabase?: (workbenchRoot: string) => Pick<SqliteDatabase, 'exec' | 'prepare' | 'close'>
  emitEvent?: (event: CollectionSessionEvent) => void
  randomId?: () => string
  now?: () => number
  readFile?: typeof readFile
  readdir?: typeof readdir
  writeFile?: typeof writeFile
  stat?: typeof stat
  mkdir?: typeof mkdir
  rm?: typeof rm
}

const RUNTIME_EVENT_DEDUPE_MS = 1_000

export class CollectionClickService {
  private readonly sessionManager: Pick<
    CollectionSessionManager,
    'assignSessionSku' | 'getActiveSession' | 'getSessionSku' | 'requestSku'
  >
  private readonly downloadImage: (url: string) => Promise<Buffer>
  private readonly captureImageWithBrowser: (
    profileId: string,
    url: string,
    pageUrl: string,
  ) => Promise<Buffer>
  private readonly openDatabase: (
    workbenchRoot: string,
  ) => Pick<SqliteDatabase, 'exec' | 'prepare' | 'close'>
  private readonly emitEvent: ((event: CollectionSessionEvent) => void) | undefined
  private readonly randomId: () => string
  private readonly now: () => number
  private readonly readFile: typeof readFile
  private readonly readdir: typeof readdir
  private readonly writeFile: typeof writeFile
  private readonly stat: typeof stat
  private readonly mkdir: typeof mkdir
  private readonly rm: typeof rm
  private debugSequence = 0
  private readonly pendingGoodsClicks = new Map<
    string,
    Array<{ event: CollectionClickEvent; platformRule: CollectionPlatformRule }>
  >()
  private readonly recentRuntimeEvents = new Map<string, number>()

  constructor(dependencies: CollectionClickServiceDependencies = {}) {
    this.sessionManager = dependencies.sessionManager ?? collectionSessionManager
    this.downloadImage = dependencies.downloadImage ?? defaultDownloadImage
    this.captureImageWithBrowser =
      dependencies.captureImageWithBrowser ?? defaultCaptureImageWithBrowser
    this.openDatabase = dependencies.openDatabase ?? openCollectionDatabase
    this.emitEvent = dependencies.emitEvent
    this.randomId = dependencies.randomId ?? randomUUID
    this.now = dependencies.now ?? Date.now
    this.readFile = dependencies.readFile ?? readFile
    this.readdir = dependencies.readdir ?? readdir
    this.writeFile = dependencies.writeFile ?? writeFile
    this.stat = dependencies.stat ?? stat
    this.mkdir = dependencies.mkdir ?? mkdir
    this.rm = dependencies.rm ?? rm
  }

  async dispatch(
    payload: CollectionBindingPayload,
    context: CollectionDispatchContext,
  ): Promise<CollectionClickResult | CollectionScrollResult | null> {
    if (payload.kind === 'debug') {
      this.debug(payload.message ?? '页面采集脚本日志', payload.level ?? 'debug', {
        page_url: payload.page,
        ...(payload.details ?? {}),
      })
      return null
    }
    if (payload.kind !== context.mode) {
      this.debug('采集事件模式不匹配，已跳过', 'debug', {
        expected_mode: context.mode,
        payload_kind: payload.kind,
        page_url: payload.page,
        image_url: payload.img ?? null,
      })
      return null
    }
    if (!payload.img) {
      this.debug('采集事件缺少图片 URL，已跳过', 'warn', {
        payload_kind: payload.kind,
        page_url: payload.page,
      })
      return null
    }
    if (this.isDuplicateRuntimeEvent(payload)) {
      this.debug('重复采集事件，已跳过', 'debug', {
        payload_kind: payload.kind,
        page_url: payload.page,
        image_url: payload.img,
      })
      return null
    }

    if (payload.kind === 'click') {
      return this.handleClick(
        {
          kind: 'click',
          img: payload.img,
          page: payload.page,
          ...(payload.goodsLink ? { goodsLink: payload.goodsLink } : {}),
          ...(typeof payload.platform === 'string' ? { platform: payload.platform } : {}),
        },
        context.platformRule,
      )
    }

    return this.handleScroll(
      {
        kind: 'scroll',
        img: payload.img,
        page: payload.page,
        ...(payload.goodsLink ? { goodsLink: payload.goodsLink } : {}),
        ...(typeof payload.platform === 'string' ? { platform: payload.platform } : {}),
        ...(typeof payload.width === 'number' ? { width: payload.width } : {}),
        ...(typeof payload.height === 'number' ? { height: payload.height } : {}),
      },
      context.platformRule,
    )
  }

  async handleClick(event: CollectionClickEvent, platformRule: CollectionPlatformRule) {
    const session = this.sessionManager.getActiveSession()
    if (!session || session.status !== 'active') {
      throw new AppErrorClass('HTTP_4XX', '当前没有活动采集会话', false, {
        kind: 'state_conflict',
      })
    }
    if (session.mode !== 'click') {
      throw new AppErrorClass('HTTP_4XX', '当前采集会话不是点击模式', false, {
        kind: 'state_conflict',
        mode: session.mode,
      })
    }

    const goodsLink = event.goodsLink?.trim() || null
    const skuCode = goodsLink ? this.sessionManager.getSessionSku(goodsLink) : null
    const isGoodsPage = matchesGoodsPage(event.page, platformRule)
    this.debug('处理点击采集图片', 'info', {
      session_id: session.id,
      page_url: event.page,
      image_url: event.img,
      goods_link: goodsLink,
      is_goods_page: isGoodsPage,
      has_sku: Boolean(skuCode),
    })

    if (isGoodsPage && goodsLink && !skuCode) {
      const pendingClicks = this.pendingGoodsClicks.get(goodsLink) ?? []
      pendingClicks.push({ event, platformRule })
      this.pendingGoodsClicks.set(goodsLink, pendingClicks)
      if (pendingClicks.length === 1) {
        this.sessionManager.requestSku(goodsLink, event.img)
      }
      this.debug('商品页图片等待货号后再保存', 'warn', {
        session_id: session.id,
        goods_link: goodsLink,
        image_url: event.img,
      })
      return { status: 'pending_sku', goodsLink } satisfies CollectionClickResult
    }

    const createdAt = this.now()
    const target = targetForClick({ session, skuCode, platformRule, isGoodsPage, createdAt })
    return this.saveImage({
      session,
      event,
      skuCode: target.skuCode,
      targetDir: target.targetDir,
      fileBase: target.fileBase,
      createdAt,
      ...(target.reason ? { reason: target.reason } : {}),
    })
  }

  async assignSkuAndSavePending(goodsLink: string, skuCode: string) {
    this.sessionManager.assignSessionSku(goodsLink, skuCode)
    const pendingClicks = this.pendingGoodsClicks.get(goodsLink) ?? []
    this.pendingGoodsClicks.delete(goodsLink)
    const results: CollectionClickResult[] = []
    for (const pending of pendingClicks) {
      results.push(await this.handleClick(pending.event, pending.platformRule))
    }
    return { ok: true, results }
  }

  async handleScroll(
    event: CollectionScrollEvent,
    platformRule: CollectionPlatformRule,
  ): Promise<CollectionScrollResult> {
    const session = this.sessionManager.getActiveSession()
    if (!session || session.status !== 'active') {
      throw new AppErrorClass('HTTP_4XX', '当前没有活动采集会话', false, {
        kind: 'state_conflict',
      })
    }
    if (session.mode !== 'scroll') {
      throw new AppErrorClass('HTTP_4XX', '当前采集会话不是滚动模式', false, {
        kind: 'state_conflict',
        mode: session.mode,
      })
    }

    const createdAt = this.now()
    this.debug('处理滚动采集图片', 'info', {
      session_id: session.id,
      page_url: event.page,
      image_url: event.img,
      width: event.width ?? null,
      height: event.height ?? null,
    })
    return this.saveImage({
      session,
      event,
      skuCode: null,
      targetDir: session.output_dir,
      fileBase: `${platformRule.key}-${timestampSlug(createdAt)}`,
      createdAt,
    })
  }

  listRecords(input: {
    sessionId: string
    status?: 'success' | 'skipped' | 'failed'
    limit?: number
  }) {
    const session = this.sessionManager.getActiveSession()
    const workbenchRoot = session ? workbenchRootFromOutput(session.output_dir) : null
    if (!workbenchRoot) {
      throw new AppErrorClass('HTTP_4XX', '当前没有活动采集会话', false, {
        kind: 'state_conflict',
      })
    }
    if (session?.id !== input.sessionId) {
      throw new AppErrorClass('HTTP_4XX', '只能查看当前采集会话记录', false, {
        kind: 'state_conflict',
      })
    }
    const db = this.openDatabase(workbenchRoot)
    try {
      return listCollectionRecords(db, input)
    } finally {
      db.close()
    }
  }

  async retryRecord(recordId: string): Promise<CollectionSavedResult> {
    const session = this.sessionManager.getActiveSession()
    if (!session || session.status !== 'active') {
      throw new AppErrorClass('HTTP_4XX', '当前没有活动采集会话', false, {
        kind: 'state_conflict',
      })
    }
    const workbenchRoot = workbenchRootFromOutput(session.output_dir)
    const db = this.openDatabase(workbenchRoot)
    try {
      const record = getCollectionRecord(db, recordId)
      if (!record || record.sessionId !== session.id) {
        throw new AppErrorClass('HTTP_4XX', '采集记录不存在', false, {
          kind: 'not_found',
          recordId,
        })
      }
      const result = await this.retryStoredRecord(session, record)
      updateCollectionRecord(db, result.record)
      return result
    } finally {
      db.close()
    }
  }

  async deleteRecord(recordId: string) {
    const session = this.sessionManager.getActiveSession()
    if (!session) {
      throw new AppErrorClass('HTTP_4XX', '当前没有采集会话', false, {
        kind: 'state_conflict',
      })
    }

    const workbenchRoot = workbenchRootFromOutput(session.output_dir)
    const db = this.openDatabase(workbenchRoot)
    let savedPath: string | null = null
    try {
      const record = getCollectionRecord(db, recordId)
      if (!record || record.sessionId !== session.id) {
        throw new AppErrorClass('HTTP_4XX', '采集记录不存在', false, {
          kind: 'not_found',
          recordId,
        })
      }
      savedPath = record.savedPath ?? null
      deleteCollectionRecord(db, recordId)
    } finally {
      db.close()
    }

    if (savedPath) {
      await this.rm(savedPath, { force: true }).catch(() => undefined)
    }
    return { ok: true, record_id: recordId }
  }

  private async saveImage(input: {
    session: CollectionSession
    event: CollectionImageEvent
    skuCode: string | null
    targetDir: string
    fileBase: string
    reason?: string
    createdAt: number
  }): Promise<CollectionSavedResult> {
    this.debug('开始保存采集图片', 'info', {
      session_id: input.session.id,
      page_url: input.event.page,
      image_url: input.event.img,
      target_dir: input.targetDir,
      file_base: input.fileBase,
    })
    try {
      collectionFolderLock.assertWritable(input.targetDir)
      const image = await this.imageBuffer(input.session, input.event)
      const buffer = image.buffer
      this.debug('图片下载完成', 'debug', {
        session_id: input.session.id,
        image_url: input.event.img,
        bytes: buffer.byteLength,
        extension: image.extension ?? imageExtension(input.event),
      })
      const hash = sha256(buffer)
      await this.mkdir(input.targetDir, { recursive: true })
      const existing = await findExistingImageByHash(
        input.targetDir,
        hash,
        this.readdir,
        this.readFile,
      )
      if (existing) {
        this.debug('图片内容重复，跳过写入新文件', 'warn', {
          session_id: input.session.id,
          image_url: input.event.img,
          saved_path: existing,
        })
        const record = this.record({
          session: input.session,
          event: input.event,
          skuCode: input.skuCode,
          savedPath: existing,
          status: 'skipped',
          reason: 'dedup',
          fileSize: buffer.byteLength,
          createdAt: input.createdAt,
        })
        return { status: 'skipped', record, savedPath: existing, reason: 'dedup' }
      }

      const savedPath = await nextImagePath(
        input.targetDir,
        input.fileBase,
        image.extension ?? imageExtension(input.event),
        this.stat,
      )
      await this.writeFile(savedPath, buffer)
      this.debug('图片文件写入完成', 'info', {
        session_id: input.session.id,
        image_url: input.event.img,
        saved_path: savedPath,
      })
      const info = await this.stat(savedPath)
      const record = this.record({
        session: input.session,
        event: input.event,
        skuCode: input.skuCode,
        savedPath,
        status: 'success',
        fileSize: info.size,
        createdAt: input.createdAt,
        ...(input.reason ? { reason: input.reason } : {}),
      })
      return { status: 'success', record, savedPath }
    } catch (error) {
      this.debug('采集图片保存失败', 'error', {
        session_id: input.session.id,
        page_url: input.event.page,
        image_url: input.event.img,
        error: appErrorMessage(error),
      })
      const record = this.record({
        session: input.session,
        event: input.event,
        skuCode: input.skuCode,
        savedPath: null,
        status: 'failed',
        reason: appErrorMessage(error),
        fileSize: null,
        createdAt: input.createdAt,
      })
      return { status: 'failed', record, error: appErrorMessage(error) }
    }
  }

  private async retryStoredRecord(
    session: CollectionSession,
    record: CollectionRecordRow,
  ): Promise<CollectionSavedResult> {
    const target = targetForStoredRecord(session, record, this.now())
    try {
      collectionFolderLock.assertWritable(target.targetDir)
      const buffer = await this.downloadImage(record.sourceUrl)
      const hash = sha256(buffer)
      await this.mkdir(target.targetDir, { recursive: true })
      const existing = await findExistingImageByHash(
        target.targetDir,
        hash,
        this.readdir,
        this.readFile,
      )
      if (existing) {
        const updated = replaceRecord(record, {
          savedPath: existing,
          status: 'skipped',
          reason: 'dedup',
          fileSize: buffer.byteLength,
          createdAt: this.now(),
        })
        return { status: 'skipped', record: updated, savedPath: existing, reason: 'dedup' }
      }
      const savedPath = await nextImagePath(
        target.targetDir,
        target.fileBase,
        imageExtension(record.sourceUrl),
        this.stat,
      )
      await this.writeFile(savedPath, buffer)
      const info = await this.stat(savedPath)
      const updated = replaceRecord(record, {
        savedPath,
        status: 'success',
        reason: null,
        fileSize: info.size,
        createdAt: this.now(),
      })
      return { status: 'success', record: updated, savedPath }
    } catch (error) {
      const updated = replaceRecord(record, {
        savedPath: null,
        status: 'failed',
        reason: appErrorMessage(error),
        fileSize: null,
        createdAt: this.now(),
      })
      return { status: 'failed', record: updated, error: appErrorMessage(error) }
    }
  }

  private record(input: {
    session: CollectionSession
    event: CollectionImageEvent
    skuCode: string | null
    savedPath: string | null
    status: 'success' | 'skipped' | 'failed'
    reason?: string | null
    fileSize?: number | null
    createdAt: number
  }) {
    const record: CollectionRecordInput = {
      id: this.randomId(),
      sessionId: input.session.id,
      skuCode: input.skuCode,
      sourceUrl: input.event.img,
      goodsLink: input.event.goodsLink ?? null,
      pageUrl: input.event.page,
      savedPath: input.savedPath,
      status: input.status,
      reason: input.reason ?? null,
      fileSize: input.fileSize ?? null,
      createdAt: input.createdAt,
    }
    const db = this.openDatabase(workbenchRootFromOutput(input.session.output_dir))
    try {
      insertCollectionRecord(db, record)
      this.debug('采集记录已写入数据库', 'debug', {
        session_id: input.session.id,
        record_id: record.id,
        status: record.status,
        reason: record.reason,
        saved_path: record.savedPath,
      })
    } finally {
      db.close()
    }
    return record
  }

  private async imageBuffer(
    session: CollectionSession,
    event: CollectionImageEvent,
  ): Promise<CollectionImageBuffer> {
    try {
      this.debug('开始直接下载图片', 'debug', {
        session_id: session.id,
        image_url: event.img,
      })
      return await normalizeDownloadedImage(await this.downloadImage(event.img))
    } catch (error) {
      this.debug('直接下载失败，尝试浏览器截图兜底', 'warn', {
        session_id: session.id,
        image_url: event.img,
        error: appErrorMessage(error),
      })
      try {
        const buffer = await this.captureImageWithBrowser(session.profile_id, event.img, event.page)
        this.debug('浏览器截图兜底成功', 'info', {
          session_id: session.id,
          image_url: event.img,
          bytes: buffer.byteLength,
        })
        return { buffer, extension: '.png' }
      } catch (fallbackError) {
        this.debug('浏览器截图兜底失败', 'error', {
          session_id: session.id,
          image_url: event.img,
          error: appErrorMessage(fallbackError),
        })
        throw error
      }
    }
  }

  private isDuplicateRuntimeEvent(payload: CollectionBindingPayload) {
    if (!payload.img) {
      return false
    }
    const session = this.sessionManager.getActiveSession()
    if (!session || session.status !== 'active') {
      return false
    }

    const now = this.now()
    const key = runtimeEventKey({
      sessionId: session.id,
      kind: payload.kind as CollectionImageEventKind,
      img: payload.img,
      page: payload.page,
    })
    for (const [itemKey, timestamp] of this.recentRuntimeEvents) {
      if (now - timestamp > RUNTIME_EVENT_DEDUPE_MS) {
        this.recentRuntimeEvents.delete(itemKey)
      }
    }
    const previous = this.recentRuntimeEvents.get(key)
    if (previous !== undefined && now - previous <= RUNTIME_EVENT_DEDUPE_MS) {
      return true
    }
    this.recentRuntimeEvents.set(key, now)
    return false
  }

  private debug(
    message: string,
    level: CollectionDebugLogLevel = 'info',
    details?: Record<string, string | number | boolean | null | undefined>,
  ) {
    this.emitEvent?.({
      type: 'debug-log',
      entry: {
        id: `${Date.now()}-${++this.debugSequence}`,
        timestamp: Date.now(),
        level,
        message,
        ...(details ? { details: compactLogDetails(details) } : {}),
      },
    })
  }
}

function targetForClick(input: {
  session: CollectionSession
  skuCode: string | null
  platformRule: CollectionPlatformRule
  isGoodsPage: boolean
  createdAt: number
}) {
  if (input.isGoodsPage && input.skuCode) {
    return {
      skuCode: input.skuCode,
      targetDir: join(input.session.output_dir, '商品页', input.skuCode),
      fileBase: input.skuCode,
    }
  }

  return {
    skuCode: null,
    targetDir: input.session.output_dir,
    fileBase: `${input.platformRule.key}-${timestampSlug(input.createdAt)}`,
    reason: input.isGoodsPage ? 'sku_required' : 'not_goods_page',
  }
}

function targetForStoredRecord(
  session: CollectionSession,
  record: CollectionRecordRow,
  createdAt: number,
) {
  if (record.skuCode) {
    return {
      targetDir: join(session.output_dir, '商品页', record.skuCode),
      fileBase: record.skuCode,
    }
  }
  return {
    targetDir: session.output_dir,
    fileBase: `${session.platform}-${timestampSlug(createdAt)}`,
  }
}

function replaceRecord(
  record: CollectionRecordRow,
  patch: {
    savedPath: string | null
    status: 'success' | 'skipped' | 'failed'
    reason?: string | null
    fileSize?: number | null
    createdAt: number
  },
): CollectionRecordInput {
  return {
    ...record,
    savedPath: patch.savedPath,
    status: patch.status,
    reason: patch.reason ?? null,
    fileSize: patch.fileSize ?? null,
    createdAt: patch.createdAt,
  }
}

function matchesGoodsPage(pageUrl: string, platformRule: CollectionPlatformRule) {
  return platformRule.goods_url_patterns.some((pattern) => {
    try {
      return new RegExp(pattern).test(pageUrl)
    } catch {
      return pageUrl.includes(pattern)
    }
  })
}

async function defaultDownloadImage(url: string) {
  if (url.startsWith('file://')) {
    return readFile(new URL(url))
  }
  const response = await fetch(url)
  if (!response.ok) {
    throw new AppErrorClass('HTTP_5XX', '下载采集原图失败', true, {
      status: response.status,
      url,
    })
  }
  return Buffer.from(await response.arrayBuffer())
}

async function normalizeDownloadedImage(buffer: Buffer): Promise<CollectionImageBuffer> {
  if (!isAvifBuffer(buffer)) {
    return { buffer }
  }
  const sharp = nodeRequire('sharp') as typeof import('sharp')
  return { buffer: await sharp(buffer).png().toBuffer(), extension: '.png' }
}

function isAvifBuffer(buffer: Buffer) {
  if (buffer.byteLength < 16 || buffer.toString('ascii', 4, 8) !== 'ftyp') {
    return false
  }
  const brandHeader = buffer.toString('ascii', 8, Math.min(buffer.byteLength, 32))
  return brandHeader.includes('avif') || brandHeader.includes('avis')
}

async function defaultCaptureImageWithBrowser(profileId: string, url: string, pageUrl: string) {
  const browser = await cdpClient.getOrReconnect(profileId)
  const pages = browser
    .contexts()
    .flatMap((context) => context.pages())
    .filter((item) => !item.isClosed())
  const page =
    pages.find((item) => sameUrl(item.url(), pageUrl)) ??
    pages.find((item) => sameHost(item.url(), pageUrl)) ??
    pages[0]
  if (!page) {
    throw new Error('没有可用的比特浏览器页面用于兜底下载图片')
  }
  const imageIndex = await renderedImageIndex(page, url)
  if (imageIndex === null) {
    throw new Error('浏览器页面未找到可截图的采集图片')
  }
  return page.locator('img').nth(imageIndex).screenshot({ type: 'png' })
}

function sameUrl(left: string, right: string) {
  return left === right
}

function sameHost(left: string, right: string) {
  try {
    return new URL(left).hostname === new URL(right).hostname
  } catch {
    return false
  }
}

async function renderedImageIndex(page: Page, url: string) {
  return page.evaluate((targetUrl) => {
    function imagePath(value: string) {
      try {
        const parsed = new URL(value, window.location.href)
        return `${parsed.origin}${parsed.pathname}`
      } catch {
        return ''
      }
    }

    const targetPath = imagePath(targetUrl)
    const candidates = Array.from(document.images)
      .map((img, index) => {
        const source = img.currentSrc || img.src || ''
        const rect = img.getBoundingClientRect()
        return {
          index,
          path: imagePath(source),
          visible:
            img.complete &&
            (img.naturalWidth || 0) > 0 &&
            (img.naturalHeight || 0) > 0 &&
            rect.width > 0 &&
            rect.height > 0,
          area: rect.width * rect.height,
        }
      })
      .filter((item) => item.visible && item.path === targetPath)
      .sort((left, right) => right.area - left.area)

    return candidates[0]?.index ?? null
  }, url)
}

async function findExistingImageByHash(
  folder: string,
  hash: string,
  readdirFn: typeof readdir,
  readFileFn: typeof readFile,
) {
  const entries = await readdirFn(folder, { withFileTypes: true }).catch(() => [])
  for (const entry of entries) {
    if (!entry.isFile() || !/\.(?:jpe?g|png|webp)$/i.test(entry.name)) {
      continue
    }
    const candidate = join(folder, entry.name)
    try {
      const buffer = await readFileFn(candidate)
      if (sha256(buffer) === hash) {
        return candidate
      }
    } catch {}
  }
  return null
}

async function nextImagePath(folder: string, baseName: string, ext: string, statFn: typeof stat) {
  for (let index = 1; index <= 9999; index += 1) {
    const candidate = join(folder, `${baseName}-${String(index).padStart(3, '0')}${ext}`)
    try {
      await statFn(candidate)
    } catch {
      return candidate
    }
  }
  throw new AppErrorClass('HTTP_4XX', '采集文件序号已达上限', false, { folder })
}

function imageExtension(input: string | CollectionImageEvent) {
  const url = typeof input === 'string' ? input : input.img
  const pathname = url.includes('://') ? new URL(url).pathname : url
  const ext = extname(pathname).toLowerCase()
  return ['.jpg', '.jpeg', '.png', '.webp'].includes(ext) ? ext : '.jpg'
}

function sha256(buffer: Buffer) {
  return createHash('sha256').update(buffer).digest('hex')
}

function runtimeEventKey(input: CollectionRuntimeEventKeyInput) {
  return [
    input.sessionId,
    input.kind,
    canonicalPageUrl(input.page),
    canonicalImageUrl(input.img),
  ].join('\0')
}

function canonicalPageUrl(value: string) {
  try {
    const parsed = new URL(value)
    return `${parsed.origin}${parsed.pathname}`
  } catch {
    return value
  }
}

function canonicalImageUrl(value: string) {
  try {
    const parsed = new URL(value)
    return `${parsed.origin}${parsed.pathname}`
  } catch {
    return value
  }
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

function compactLogDetails(details: Record<string, string | number | boolean | null | undefined>) {
  return Object.fromEntries(
    Object.entries(details).filter((entry): entry is [string, string | number | boolean | null] => {
      return entry[1] !== undefined
    }),
  )
}

function workbenchRootFromOutput(outputDir: string) {
  const normalized = outputDir.replace(/\\/g, '/')
  const marker = `/${WORKBENCH_DIRECTORIES.collection}`
  const index = normalized.indexOf(marker)
  const next = normalized[index + marker.length]
  if (index >= 0 && (next === undefined || next === '/')) {
    return index === 0 ? '/' : outputDir.slice(0, index)
  }
  return outputDir
}

export const collectionClickService = new CollectionClickService({
  emitEvent: emitCollectionEvent,
})

const CollectionClickIpcSchema = z.object({
  event: z.object({
    kind: z.literal('click'),
    img: z.string().min(1),
    goodsLink: z.string().optional(),
    page: z.string().min(1),
    platform: z.string().optional(),
  }),
  platformRule: z.object({
    key: z.string().min(1),
    name: z.string().min(1),
    allowed_domains: z.array(z.string()),
    entry_url: z.string(),
    goods_url_patterns: z.array(z.string()),
    login_check: z
      .object({
        indicators: z.array(z.string()),
        inverse: z.array(z.string()).optional(),
      })
      .optional(),
    original_image_resolver: z.union([
      z.object({
        type: z.literal('src_replace'),
        config: z.object({ from: z.string().optional(), to: z.string().optional() }),
      }),
      z.object({
        type: z.literal('data_attr'),
        config: z.object({ attr: z.string().optional() }),
      }),
      z.object({
        type: z.literal('srcset_largest'),
        config: z.record(z.unknown()).optional(),
      }),
    ]),
  }),
})

const CollectionScrollIpcSchema = CollectionClickIpcSchema.extend({
  event: z.object({
    kind: z.literal('scroll'),
    img: z.string().min(1),
    goodsLink: z.string().optional(),
    page: z.string().min(1),
    platform: z.string().optional(),
    width: z.number().nonnegative().optional(),
    height: z.number().nonnegative().optional(),
  }),
})

function emitCollectionEvent(event: unknown) {
  for (const window of electronBrowserWindow().getAllWindows()) {
    window.webContents.send('collection:event', event)
  }
}

const CollectionSkuInputSchema = z.object({
  goods_link: z.string().min(1),
  sku_code: z.string().min(1),
})

const CollectionRecordListInputSchema = z.object({
  session_id: z.string().min(1),
  status: z.enum(['success', 'skipped', 'failed']).optional(),
  limit: z.number().int().positive().max(COLLECTION_RECORD_LIST_LIMIT_MAX).optional(),
})

const CollectionRetryRecordInputSchema = z.object({
  record_id: z.string().min(1),
})

const CollectionDeleteRecordInputSchema = z.object({
  record_id: z.string().min(1),
})

export function parseCollectionRecordListInput(input: unknown) {
  const parsed = CollectionRecordListInputSchema.safeParse(input)
  if (!parsed.success) {
    throw new AppErrorClass('HTTP_4XX', '采集记录查询参数不正确', false, {
      kind: 'validation',
      issues: parsed.error.issues,
    })
  }
  return {
    sessionId: parsed.data.session_id,
    ...(parsed.data.status ? { status: parsed.data.status } : {}),
    ...(parsed.data.limit ? { limit: parsed.data.limit } : {}),
  }
}

export function registerCollectionClickIpc() {
  const ipcMain = electronIpcMain()
  ipcMain.handle('collection:set-sku', async (_event, input: unknown) => {
    const parsed = CollectionSkuInputSchema.safeParse(input)
    if (!parsed.success) {
      throw new AppErrorClass('HTTP_4XX', '货号参数不正确', false, {
        kind: 'validation',
        issues: parsed.error.issues,
      })
    }
    const result = await collectionClickService.assignSkuAndSavePending(
      parsed.data.goods_link,
      parsed.data.sku_code,
    )
    for (const item of result.results) {
      if ('record' in item) {
        emitCollectionEvent({ type: 'image-saved', record: item.record })
      }
    }
    return result
  })

  ipcMain.handle('collection:handle-click', async (_event, input: unknown) => {
    const parsed = CollectionClickIpcSchema.safeParse(input)
    if (!parsed.success) {
      throw new AppErrorClass('HTTP_4XX', '点击采集参数不正确', false, {
        kind: 'validation',
        issues: parsed.error.issues,
      })
    }
    const rawEvent = parsed.data.event
    const rawRule = parsed.data.platformRule
    const platformRule: CollectionPlatformRule = normalizePlatformRule(rawRule)
    const result = await collectionClickService.handleClick(
      {
        kind: rawEvent.kind,
        img: rawEvent.img,
        page: rawEvent.page,
        ...(rawEvent.goodsLink ? { goodsLink: rawEvent.goodsLink } : {}),
        ...(rawEvent.platform ? { platform: rawEvent.platform } : {}),
      },
      platformRule,
    )
    if ('record' in result) {
      emitCollectionEvent({ type: 'image-saved', record: result.record })
    }
    return result
  })

  ipcMain.handle('collection:handle-scroll', async (_event, input: unknown) => {
    const parsed = CollectionScrollIpcSchema.safeParse(input)
    if (!parsed.success) {
      throw new AppErrorClass('HTTP_4XX', '滚动采集参数不正确', false, {
        kind: 'validation',
        issues: parsed.error.issues,
      })
    }
    const rawEvent = parsed.data.event
    const rawRule = parsed.data.platformRule
    const platformRule: CollectionPlatformRule = normalizePlatformRule(rawRule)
    const result = await collectionClickService.handleScroll(
      {
        kind: rawEvent.kind,
        img: rawEvent.img,
        page: rawEvent.page,
        ...(rawEvent.goodsLink ? { goodsLink: rawEvent.goodsLink } : {}),
        ...(rawEvent.platform ? { platform: rawEvent.platform } : {}),
        ...(rawEvent.width !== undefined ? { width: rawEvent.width } : {}),
        ...(rawEvent.height !== undefined ? { height: rawEvent.height } : {}),
      },
      platformRule,
    )
    emitCollectionEvent({ type: 'image-saved', record: result.record })
    return result
  })

  ipcMain.handle('collection:list-records', (_event, input: unknown) => {
    return collectionClickService.listRecords(parseCollectionRecordListInput(input))
  })

  ipcMain.handle('collection:retry-record', async (_event, input: unknown) => {
    const parsed = CollectionRetryRecordInputSchema.safeParse(input)
    if (!parsed.success) {
      throw new AppErrorClass('HTTP_4XX', '采集重试参数不正确', false, {
        kind: 'validation',
        issues: parsed.error.issues,
      })
    }
    const result = await collectionClickService.retryRecord(parsed.data.record_id)
    emitCollectionEvent({ type: 'image-saved', record: result.record })
    return result
  })

  ipcMain.handle('collection:delete-record', async (_event, input: unknown) => {
    const parsed = CollectionDeleteRecordInputSchema.safeParse(input)
    if (!parsed.success) {
      throw new AppErrorClass('HTTP_4XX', '采集删除参数不正确', false, {
        kind: 'validation',
        issues: parsed.error.issues,
      })
    }
    return collectionClickService.deleteRecord(parsed.data.record_id)
  })
}

function electronIpcMain(): typeof ipcMain {
  return (nodeRequire('electron') as typeof import('electron')).ipcMain
}

function electronBrowserWindow(): typeof BrowserWindow {
  return (nodeRequire('electron') as typeof import('electron')).BrowserWindow
}

function normalizePlatformRule(rawRule: z.infer<typeof CollectionClickIpcSchema>['platformRule']) {
  return {
    key: rawRule.key,
    name: rawRule.name,
    allowed_domains: rawRule.allowed_domains,
    entry_url: rawRule.entry_url,
    goods_url_patterns: rawRule.goods_url_patterns,
    original_image_resolver: normalizeOriginalImageResolver(rawRule.original_image_resolver),
    ...(rawRule.login_check ? { login_check: normalizeLoginCheck(rawRule.login_check) } : {}),
  } satisfies CollectionPlatformRule
}

function normalizeLoginCheck(
  loginCheck: NonNullable<z.infer<typeof CollectionClickIpcSchema>['platformRule']['login_check']>,
) {
  return {
    indicators: loginCheck.indicators,
    ...(loginCheck.inverse ? { inverse: loginCheck.inverse } : {}),
  } satisfies CollectionPlatformRule['login_check']
}

function normalizeOriginalImageResolver(
  resolver: z.infer<typeof CollectionClickIpcSchema>['platformRule']['original_image_resolver'],
) {
  if (resolver.type === 'src_replace') {
    return {
      type: resolver.type,
      config: {
        ...(resolver.config.from ? { from: resolver.config.from } : {}),
        ...(resolver.config.to ? { to: resolver.config.to } : {}),
      },
    } satisfies CollectionPlatformRule['original_image_resolver']
  }
  if (resolver.type === 'data_attr') {
    return {
      type: resolver.type,
      config: {
        ...(resolver.config.attr ? { attr: resolver.config.attr } : {}),
      },
    } satisfies CollectionPlatformRule['original_image_resolver']
  }
  return {
    type: resolver.type,
    ...(resolver.config ? { config: resolver.config } : {}),
  } satisfies CollectionPlatformRule['original_image_resolver']
}
