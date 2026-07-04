import { randomUUID } from 'node:crypto'
import { mkdir } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { AppErrorClass, WORKBENCH_DIRECTORIES } from '@tengyu-aipod/shared'
import type { BrowserWindow, ipcMain } from 'electron'
import type { Browser, BrowserContext, Page } from 'playwright'
import { z } from 'zod'
import {
  type BitBrowserClient,
  type BitBrowserProfileWithStatus,
  bitBrowserClient,
} from './bit-browser-client'
import {
  type BrowserProfileLockHandle,
  type BrowserProfileLockManager,
  browserProfileLocks,
} from './browser-profile-lock'
import { type CDPClient, type CollectionBindingPayload, cdpClient } from './cdp-client'
import {
  COLLECTION_INJECTED_SCRIPT_VERSION,
  type CollectionPlatformRule,
  type SizeFilter,
  createCollectionInjectedScript,
} from './collection-injected-script'
import { getPlatformRule, listPlatformRules } from './collection-platform-rules'
import { exportCollectionManifest } from './collection-record-store'
import type { SqliteDatabase } from './sqlite'
import {
  openWorkbenchDatabase as openWorkbenchDatabaseFile,
  workbenchDatabasePath,
} from './workbench-db'
import { assertPathInsideWorkbench } from './workbench-path-guard'

const nodeRequire = createRequire(import.meta.url)

export type CollectionMode = 'click' | 'scroll'
export type CollectionSessionStatus =
  | 'starting'
  | 'active'
  | 'paused'
  | 'stopping'
  | 'completed'
  | 'failed'
export type CollectionPauseReason = 'manual_intervention' | 'browser_closed' | 'window_closed'

export type CollectionSessionConfig = {
  platform: string
  profile_id: string
  mode: CollectionMode
  output_dir?: string | undefined
  size_filter?: SizeFilter
}

export type CollectionSession = {
  id: string
  platform: string
  profile_id: string
  mode: CollectionMode
  status: CollectionSessionStatus
  output_dir: string
  started_at: number
  ended_at?: number
  pause_reason?: CollectionPauseReason
}

export type CollectionDebugLogLevel = 'debug' | 'info' | 'warn' | 'error'

export type CollectionDebugLogEntry = {
  id: string
  timestamp: number
  level: CollectionDebugLogLevel
  message: string
  details?: Record<string, string | number | boolean | null>
}

export type CollectionSessionEvent =
  | { type: 'session-started'; session: CollectionSession }
  | { type: 'session-paused'; session: CollectionSession; reason: CollectionPauseReason }
  | { type: 'session-resumed'; session: CollectionSession }
  | { type: 'session-stopped'; session: CollectionSession }
  | { type: 'manifest-exported'; session: CollectionSession; manifest_path: string }
  | { type: 'sku-required'; session: CollectionSession; goods_link: string; image_url: string }
  | { type: 'image-saved'; record: unknown }
  | { type: 'debug-log'; entry: CollectionDebugLogEntry }

type CollectionDatabase = Pick<SqliteDatabase, 'exec' | 'prepare' | 'close'>
type ReadAppConfig = () => Promise<{ workbench_root?: string | undefined }>
type DispatchCollectionEvent = (
  payload: CollectionBindingPayload,
  context: { platformRule: CollectionPlatformRule; mode: CollectionMode },
) => Promise<unknown> | unknown
type SessionSizeFilterInput = {
  min_width?: number | undefined
  max_width?: number | undefined
  min_height?: number | undefined
  max_height?: number | undefined
}

export type CollectionSessionManagerDependencies = {
  readConfig?: ReadAppConfig
  openDatabase?: (workbenchRoot: string) => CollectionDatabase
  cdp?: Pick<CDPClient, 'connectToProfile' | 'disconnect' | 'injectPageScript'>
  bitBrowser?: Pick<BitBrowserClient, 'listProfiles' | 'listOpenProfileIds' | 'openProfile'>
  locks?: BrowserProfileLockManager
  emitEvent?: (event: CollectionSessionEvent) => void
  dispatchCollectionEvent?: DispatchCollectionEvent
  getPlatformRule?: (key: string) => CollectionPlatformRule
  randomId?: () => string
  now?: () => number
}

type SessionRuntime = {
  session: CollectionSession
  lock: BrowserProfileLockHandle
  workbenchRoot: string
  goodsSku: Map<string, string>
  platformRule: CollectionPlatformRule
  sizeFilter: SizeFilter
  wiredPages: WeakSet<Page>
  browser: Browser | undefined
  contextHandlers: Map<BrowserContext, (page: Page) => void>
}

const CollectionSessionConfigSchema = z
  .object({
    platform: z.string().min(1),
    profile_id: z.string().min(1),
    mode: z.enum(['click', 'scroll']),
    output_dir: z.string().min(1).optional(),
    size_filter: z
      .object({
        min_width: z.number().int().nonnegative().optional(),
        max_width: z.number().int().nonnegative().optional(),
        min_height: z.number().int().nonnegative().optional(),
        max_height: z.number().int().nonnegative().optional(),
      })
      .optional(),
  })
  .transform((value): CollectionSessionConfig => {
    const outputDir = value.output_dir
    return {
      platform: value.platform,
      profile_id: value.profile_id,
      mode: value.mode,
      ...(outputDir ? { output_dir: outputDir } : {}),
      size_filter: normalizeSessionSizeFilter(value.size_filter),
    }
  })

export class CollectionSessionManager {
  private active: SessionRuntime | null = null
  private readonly readConfig: ReadAppConfig
  private readonly openDatabase: (workbenchRoot: string) => CollectionDatabase
  private readonly cdp: Pick<CDPClient, 'connectToProfile' | 'disconnect' | 'injectPageScript'>
  private readonly bitBrowser: Pick<
    BitBrowserClient,
    'listProfiles' | 'listOpenProfileIds' | 'openProfile'
  >
  private readonly locks: BrowserProfileLockManager
  private readonly emitEvent: ((event: CollectionSessionEvent) => void) | undefined
  private readonly dispatchCollectionEvent: DispatchCollectionEvent
  private readonly findPlatformRule: (key: string) => CollectionPlatformRule
  private readonly randomId: () => string
  private readonly now: () => number
  private debugSequence = 0

  constructor(dependencies: CollectionSessionManagerDependencies = {}) {
    this.readConfig = dependencies.readConfig ?? readAppConfig
    this.openDatabase = dependencies.openDatabase ?? openWorkbenchDatabase
    this.cdp = dependencies.cdp ?? cdpClient
    this.bitBrowser = dependencies.bitBrowser ?? bitBrowserClient
    this.locks = dependencies.locks ?? browserProfileLocks
    this.emitEvent = dependencies.emitEvent
    this.dispatchCollectionEvent = dependencies.dispatchCollectionEvent ?? dispatchCollectionPayload
    this.findPlatformRule = dependencies.getPlatformRule ?? getPlatformRule
    this.randomId = dependencies.randomId ?? randomUUID
    this.now = dependencies.now ?? Date.now
  }

  async startSession(config: CollectionSessionConfig): Promise<CollectionSession> {
    if (this.active && this.active.session.status !== 'completed') {
      throw new AppErrorClass('HTTP_4XX', '同一时刻只能有一个采集会话', false, {
        kind: 'state_conflict',
        activeSessionId: this.active.session.id,
      })
    }

    this.debug('请求开始采集会话', 'info', {
      platform: config.platform,
      profile_id: config.profile_id,
      mode: config.mode,
      output_dir: config.output_dir ?? null,
    })
    const workbenchRoot = await readWorkbenchRoot(this.readConfig)
    const platformRule = this.findPlatformRule(config.platform)
    const sessionId = this.randomId()
    const defaultOutputDir = join(
      workbenchRoot,
      WORKBENCH_DIRECTORIES.collection,
      `${config.platform}-${timestampSlug(this.now())}`,
    )
    const outputDir = config.output_dir ?? defaultOutputDir
    if (config.output_dir) {
      await assertPathInsideWorkbench(workbenchRoot, outputDir, {
        domain: 'collection',
        label: '采集输出目录',
      })
    }
    const session: CollectionSession = {
      id: sessionId,
      platform: config.platform,
      profile_id: config.profile_id,
      mode: config.mode,
      status: 'starting',
      output_dir: outputDir,
      started_at: this.now(),
    }
    await mkdir(session.output_dir, { recursive: true })
    const lock = this.locks.acquire(config.profile_id, 'collection', session.id)
    this.debug('已锁定比特浏览器环境', 'debug', {
      session_id: session.id,
      profile_id: config.profile_id,
    })
    this.active = {
      session,
      lock,
      workbenchRoot,
      goodsSku: new Map(),
      platformRule,
      sizeFilter: normalizeSessionSizeFilter(config.size_filter),
      wiredPages: new WeakSet(),
      browser: undefined,
      contextHandlers: new Map(),
    }

    try {
      writeSession(workbenchRoot, this.openDatabase, session)
      await this.connectAndWire(this.active)
      const activeSession = this.updateActiveSession({ status: 'active' })
      writeSession(workbenchRoot, this.openDatabase, activeSession)
      this.debug('采集会话已进入监听状态', 'info', {
        session_id: activeSession.id,
        output_dir: activeSession.output_dir,
      })
      this.emit({ type: 'session-started', session: activeSession })
      return activeSession
    } catch (error) {
      this.debug('启动采集会话失败', 'error', {
        profile_id: config.profile_id,
        error: appErrorMessage(error),
      })
      const failedSession = { ...session, ended_at: this.now(), status: 'failed' as const }
      writeSession(workbenchRoot, this.openDatabase, failedSession)
      await this.cdp.disconnect(config.profile_id).catch(() => null)
      lock.release()
      this.active = null
      throw error
    }
  }

  async stopSession(): Promise<CollectionSession | null> {
    if (!this.active) {
      return null
    }

    const runtime = this.active
    const stopping = this.updateActiveSession({ status: 'stopping' })
    this.debug('请求停止采集会话', 'info', {
      session_id: stopping.id,
      profile_id: stopping.profile_id,
    })
    writeSession(runtime.workbenchRoot, this.openDatabase, stopping)
    this.detachPageHandler(runtime)
    await this.cdp.disconnect(runtime.session.profile_id).catch(() => null)
    this.debug('已断开采集浏览器连接', 'debug', {
      session_id: stopping.id,
      profile_id: stopping.profile_id,
    })
    runtime.lock.release()

    const completed = this.updateActiveSession({ status: 'completed', ended_at: this.now() })
    writeSession(runtime.workbenchRoot, this.openDatabase, completed)
    const manifestPath = await exportManifest(
      runtime.workbenchRoot,
      this.openDatabase,
      completed.output_dir,
      completed.id,
    )
    this.debug('采集清单已导出', 'info', {
      session_id: completed.id,
      manifest_path: manifestPath,
    })
    this.active = null
    this.emit({ type: 'session-stopped', session: completed })
    this.emit({ type: 'manifest-exported', session: completed, manifest_path: manifestPath })
    return completed
  }

  getActiveSession() {
    if (!this.active || this.active.session.status === 'completed') {
      return null
    }
    return this.active.session
  }

  assignSessionSku(goodsLink: string, skuCode: string) {
    if (!this.active) {
      throw new AppErrorClass('HTTP_4XX', '当前没有采集会话', false, { kind: 'state_conflict' })
    }
    if (!goodsLink.trim() || !skuCode.trim()) {
      throw new AppErrorClass('HTTP_4XX', '商品链接和货号不能为空', false, {
        kind: 'validation',
      })
    }
    this.active.goodsSku.set(goodsLink, skuCode)
  }

  getSessionSku(goodsLink: string) {
    return this.active?.goodsSku.get(goodsLink) ?? null
  }

  requestSku(goodsLink: string, imageUrl: string) {
    if (!this.active) {
      return
    }
    this.debug('等待用户填写商品货号', 'warn', {
      session_id: this.active.session.id,
      goods_link: goodsLink,
      image_url: imageUrl,
    })
    this.emit({
      type: 'sku-required',
      session: this.active.session,
      goods_link: goodsLink,
      image_url: imageUrl,
    })
  }

  pause(reason: CollectionPauseReason): CollectionSession | null {
    if (!this.active || this.active.session.status !== 'active') {
      return null
    }
    const paused = this.updateActiveSession({ status: 'paused', pause_reason: reason })
    this.debug('采集会话已暂停', 'warn', {
      session_id: paused.id,
      reason,
    })
    writeSession(this.active.workbenchRoot, this.openDatabase, paused)
    this.emit({ type: 'session-paused', session: paused, reason })
    return paused
  }

  async resume(): Promise<CollectionSession | null> {
    if (!this.active || this.active.session.status !== 'paused') {
      return null
    }
    this.debug('请求恢复采集会话', 'info', {
      session_id: this.active.session.id,
      profile_id: this.active.session.profile_id,
    })
    await this.connectAndWire(this.active)
    const active = this.updateActiveSession({ status: 'active' }, { clearPauseReason: true })
    writeSession(this.active.workbenchRoot, this.openDatabase, active)
    this.emit({ type: 'session-resumed', session: active })
    return active
  }

  async listProfiles(): Promise<BitBrowserProfileWithStatus[]> {
    const [profiles, openProfileIds] = await Promise.all([
      this.bitBrowser.listProfiles(),
      this.bitBrowser.listOpenProfileIds(),
    ])
    const openProfileIdSet = new Set(openProfileIds)
    return profiles.map((profile) => ({
      ...profile,
      online: openProfileIdSet.has(profile.id),
    }))
  }

  openProfile(profileId: string) {
    return this.bitBrowser.openProfile(profileId)
  }

  handleBrowserClosed() {
    return this.pause('browser_closed')
  }

  handleWindowClosed() {
    return this.pause('window_closed')
  }

  handleLeftAllowedDomain() {
    return this.pause('manual_intervention')
  }

  private updateActiveSession(
    patch: Partial<CollectionSession>,
    options: { clearPauseReason?: boolean } = {},
  ) {
    if (!this.active) {
      throw new AppErrorClass('HTTP_4XX', '当前没有采集会话', false, { kind: 'state_conflict' })
    }
    const merged = { ...this.active.session, ...patch }
    const next = options.clearPauseReason ? withoutPauseReason(merged) : merged
    this.active = { ...this.active, session: next }
    return next
  }

  private async connectAndWire(runtime: SessionRuntime): Promise<void> {
    this.detachPageHandler(runtime)
    this.debug('连接比特浏览器 CDP', 'info', {
      session_id: runtime.session.id,
      profile_id: runtime.session.profile_id,
    })
    const browser = await this.cdp.connectToProfile(runtime.session.profile_id)
    runtime.browser = browser

    const contexts = await browserContexts(browser)
    this.debug('扫描浏览器页面', 'debug', {
      session_id: runtime.session.id,
      contexts: contexts.length,
      pages: contexts.reduce((total, context) => total + context.pages().length, 0),
    })
    for (const context of contexts) {
      for (const page of context.pages()) {
        await this.wirePage(runtime, page).catch((error) => {
          this.debug('页面脚本注入失败，已跳过该页', 'warn', {
            session_id: runtime.session.id,
            page_url: safePageUrl(page),
            error: appErrorMessage(error),
          })
        })
      }
    }

    const targetPage = await this.acquireCollectionPage(contexts, runtime.platformRule)
    await this.wirePage(runtime, targetPage)
    await targetPage.bringToFront().catch(() => null)

    for (const context of contexts) {
      this.attachPageHandler(runtime, context)
    }

    browser.on('disconnected', () => {
      if (this.active?.session.id === runtime.session.id) {
        this.debug('浏览器连接已断开', 'warn', {
          session_id: runtime.session.id,
          profile_id: runtime.session.profile_id,
        })
        this.handleBrowserClosed()
      }
    })
  }

  private async acquireCollectionPage(
    contexts: BrowserContext[],
    rule: CollectionPlatformRule,
  ): Promise<Page> {
    const existing = contexts
      .flatMap((context) => context.pages())
      .find((page) => !page.isClosed() && isAllowedDomain(page.url(), rule.allowed_domains))
    if (existing) {
      this.debug('复用已打开的平台页面', 'info', {
        page_url: safePageUrl(existing),
      })
      return existing
    }

    const context = contexts[0]
    if (!context) {
      throw new AppErrorClass('BROWSER_NOT_CONNECTED', '无法获取比特浏览器页面上下文', true, {
        kind: 'network',
        provider: 'playwright-cdp',
      })
    }
    const page = await context.newPage()
    this.debug('未找到平台页面，打开入口页', 'info', {
      entry_url: rule.entry_url,
    })
    await page.goto(rule.entry_url, { waitUntil: 'domcontentloaded' }).catch(() => null)
    return page
  }

  private async wirePage(runtime: SessionRuntime, page: Page): Promise<void> {
    if (page.isClosed()) {
      this.debug('跳过已关闭页面', 'debug', {
        session_id: runtime.session.id,
      })
      return
    }
    if (runtime.wiredPages.has(page)) {
      return
    }
    runtime.wiredPages.add(page)
    this.debug('准备监听页面', 'debug', {
      session_id: runtime.session.id,
      page_url: safePageUrl(page),
    })
    try {
      await this.cdp.injectPageScript(page, {
        script: createCollectionInjectedScript({
          platformRule: runtime.platformRule,
          sizeFilter: runtime.sizeFilter,
          mode: runtime.session.mode,
        }),
        onEvent: async (payload) => {
          if (payload.kind === 'debug') {
            this.debug(payload.message ?? '页面采集脚本日志', payload.level ?? 'debug', {
              session_id: runtime.session.id,
              page_url: payload.page,
              ...(payload.details ?? {}),
            })
            return
          }
          this.debug('收到页面采集事件', 'debug', {
            session_id: runtime.session.id,
            kind: payload.kind,
            page_url: payload.page,
            image_url: payload.img ?? null,
          })
          const result = await this.dispatchCollectionEvent(payload, {
            platformRule: runtime.platformRule,
            mode: runtime.session.mode,
          })
          if (!result) {
            this.debug('页面采集事件未产生保存记录', 'debug', {
              session_id: runtime.session.id,
              kind: payload.kind,
              image_url: payload.img ?? null,
            })
          }
          if (hasCollectionRecord(result)) {
            this.debug('采集图片记录已生成，通知前端刷新', 'info', {
              session_id: runtime.session.id,
              kind: payload.kind,
              image_url: payload.img ?? null,
            })
            this.emit({ type: 'image-saved', record: result.record })
          }
        },
      })
      this.debug('页面监听脚本注入成功', 'info', {
        session_id: runtime.session.id,
        page_url: safePageUrl(page),
        script_version: COLLECTION_INJECTED_SCRIPT_VERSION,
        runtime_mode: runtime.session.mode,
      })
    } catch (error) {
      runtime.wiredPages.delete(page)
      this.debug('页面监听脚本注入失败', 'error', {
        session_id: runtime.session.id,
        page_url: safePageUrl(page),
        error: appErrorMessage(error),
      })
      throw error
    }
  }

  private attachPageHandler(runtime: SessionRuntime, context: BrowserContext): void {
    if (runtime.contextHandlers.has(context)) {
      return
    }
    const pageHandler = (page: Page) => {
      void this.wirePage(runtime, page).catch(() => null)
    }
    context.on('page', pageHandler)
    runtime.contextHandlers.set(context, pageHandler)
  }

  private detachPageHandler(runtime: SessionRuntime): void {
    for (const [context, pageHandler] of runtime.contextHandlers) {
      context.off('page', pageHandler)
    }
    runtime.contextHandlers.clear()
  }

  private emit(event: CollectionSessionEvent) {
    this.emitEvent?.(event)
  }

  private debug(
    message: string,
    level: CollectionDebugLogLevel = 'info',
    details?: Record<string, string | number | boolean | null | undefined>,
  ) {
    this.emit({
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

function withoutPauseReason(session: CollectionSession): CollectionSession {
  const { pause_reason: _pauseReason, ...rest } = session
  return rest
}

function normalizeSessionSizeFilter(filter: SessionSizeFilterInput | undefined): SizeFilter {
  return {
    min_width: nonNegativeInteger(filter?.min_width),
    max_width: nonNegativeInteger(filter?.max_width),
    min_height: nonNegativeInteger(filter?.min_height),
    max_height: nonNegativeInteger(filter?.max_height),
  }
}

function nonNegativeInteger(value: number | undefined) {
  return Number.isFinite(value) && value && value > 0 ? Math.floor(value) : 0
}

function openWorkbenchDatabase(workbenchRoot: string) {
  return openWorkbenchDatabaseFile(workbenchDatabasePath(workbenchRoot))
}

async function readWorkbenchRoot(readConfig: ReadAppConfig) {
  const config = await readConfig()
  if (!config.workbench_root) {
    throw new AppErrorClass('HTTP_4XX', '请先在设置里选择工作区', false)
  }
  return config.workbench_root
}

function timestampSlug(value: number) {
  const date = new Date(value)
  const pad = (item: number) => String(item).padStart(2, '0')
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`
}

async function readAppConfig() {
  return (await import('../onboarding')).readAppConfig()
}

async function browserContexts(browser: Browser): Promise<BrowserContext[]> {
  const contexts = browser.contexts()
  return contexts.length > 0 ? contexts : [await browser.newContext()]
}

function isAllowedDomain(url: string, allowedDomains: string[]): boolean {
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

function safePageUrl(page: Page) {
  try {
    return page.url()
  } catch {
    return 'unknown'
  }
}

function writeSession(
  workbenchRoot: string,
  openDatabase: (workbenchRoot: string) => CollectionDatabase,
  session: CollectionSession,
) {
  const db = openDatabase(workbenchRoot)
  try {
    db.prepare(`
      INSERT INTO collection_sessions (
        id,
        platform,
        profile_id,
        mode,
        status,
        output_dir,
        started_at,
        ended_at,
        task_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        platform = excluded.platform,
        profile_id = excluded.profile_id,
        mode = excluded.mode,
        status = excluded.status,
        output_dir = excluded.output_dir,
        started_at = excluded.started_at,
        ended_at = excluded.ended_at,
        task_id = excluded.task_id
    `).run(
      session.id,
      session.platform,
      session.profile_id,
      session.mode,
      session.status,
      session.output_dir,
      session.started_at,
      session.ended_at ?? null,
      session.id,
    )
  } finally {
    db.close()
  }
}

async function exportManifest(
  workbenchRoot: string,
  openDatabase: (workbenchRoot: string) => CollectionDatabase,
  outputDir: string,
  sessionId: string,
) {
  const db = openDatabase(workbenchRoot)
  try {
    return await exportCollectionManifest(db, outputDir, sessionId)
  } finally {
    db.close()
  }
}

function emitCollectionEvent(event: CollectionSessionEvent) {
  for (const window of electronBrowserWindow().getAllWindows()) {
    window.webContents.send('collection:event', event)
  }
}

async function dispatchCollectionPayload(
  payload: CollectionBindingPayload,
  context: { platformRule: CollectionPlatformRule; mode: CollectionMode },
) {
  const { collectionClickService } = await import('./collection-click-service')
  return collectionClickService.dispatch(payload, context)
}

function hasCollectionRecord(value: unknown): value is { record: unknown } {
  return Boolean(value && typeof value === 'object' && 'record' in value)
}

function compactLogDetails(details: Record<string, string | number | boolean | null | undefined>) {
  return Object.fromEntries(
    Object.entries(details).filter((entry): entry is [string, string | number | boolean | null] => {
      return entry[1] !== undefined
    }),
  )
}

function appErrorMessage(error: unknown) {
  if (error instanceof Error) {
    return error.message
  }
  return String(error)
}

export const collectionSessionManager = new CollectionSessionManager({
  emitEvent: emitCollectionEvent,
})

const CollectionProfileInputSchema = z.object({
  profile_id: z.string().min(1),
})

export function registerCollectionSessionIpc() {
  const ipcMain = electronIpcMain()
  ipcMain.handle('collection:list-platforms', () => listPlatformRules())
  ipcMain.handle('collection:list-profiles', () => collectionSessionManager.listProfiles())
  ipcMain.handle('collection:start-session', (_event, input: unknown) => {
    const parsed = CollectionSessionConfigSchema.safeParse(input)
    if (!parsed.success) {
      throw new AppErrorClass('HTTP_4XX', '采集会话参数不正确', false, {
        kind: 'validation',
        issues: parsed.error.issues,
      })
    }
    return collectionSessionManager.startSession(parsed.data)
  })
  ipcMain.handle('collection:stop-session', () => collectionSessionManager.stopSession())
  ipcMain.handle('collection:resume-session', () => collectionSessionManager.resume())
  ipcMain.handle('collection:get-active-session', () => collectionSessionManager.getActiveSession())
  ipcMain.handle('collection:open-profile', (_event, input: unknown) => {
    const parsed = CollectionProfileInputSchema.safeParse(input)
    if (!parsed.success) {
      throw new AppErrorClass('HTTP_4XX', '比特浏览器环境参数不正确', false, {
        kind: 'validation',
        issues: parsed.error.issues,
      })
    }
    return collectionSessionManager.openProfile(parsed.data.profile_id)
  })
}

function electronIpcMain(): typeof ipcMain {
  return (nodeRequire('electron') as typeof import('electron')).ipcMain
}

function electronBrowserWindow(): typeof BrowserWindow {
  return (nodeRequire('electron') as typeof import('electron')).BrowserWindow
}
