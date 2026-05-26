import { randomUUID } from 'node:crypto'
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
  type CollectionPlatformRule,
  createCollectionInjectedScript,
} from './collection-injected-script'
import { getPlatformRule, listPlatformRules } from './collection-platform-rules'
import { exportCollectionManifest } from './collection-record-store'
import { type SqliteDatabase, openSqliteDatabase } from './sqlite'

const nodeRequire = createRequire(import.meta.url)

export type CollectionMode = 'click' | 'scroll'
export type CollectionSessionStatus = 'starting' | 'active' | 'paused' | 'stopping' | 'completed'
export type CollectionPauseReason = 'manual_intervention' | 'browser_closed' | 'window_closed'

export type CollectionSessionConfig = {
  platform: string
  profile_id: string
  mode: CollectionMode
  output_dir?: string | undefined
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

export type CollectionSessionEvent =
  | { type: 'session-started'; session: CollectionSession }
  | { type: 'session-paused'; session: CollectionSession; reason: CollectionPauseReason }
  | { type: 'session-resumed'; session: CollectionSession }
  | { type: 'session-stopped'; session: CollectionSession }
  | { type: 'manifest-exported'; session: CollectionSession; manifest_path: string }
  | { type: 'sku-required'; session: CollectionSession; goods_link: string; image_url: string }
  | { type: 'image-saved'; record: unknown }

type CollectionDatabase = Pick<SqliteDatabase, 'exec' | 'prepare' | 'close'>
type ReadAppConfig = () => Promise<{ workbench_root?: string | undefined }>
type DispatchCollectionEvent = (
  payload: CollectionBindingPayload,
  context: { platformRule: CollectionPlatformRule; mode: CollectionMode },
) => Promise<unknown> | unknown

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
  wiredPages: WeakSet<Page>
  browser: Browser | undefined
  context: BrowserContext | undefined
  pageHandler: ((page: Page) => void) | undefined
}

const CollectionSessionConfigSchema = z
  .object({
    platform: z.string().min(1),
    profile_id: z.string().min(1),
    mode: z.enum(['click', 'scroll']),
    output_dir: z.string().min(1).optional(),
  })
  .transform((value): CollectionSessionConfig => {
    const outputDir = value.output_dir
    return {
      platform: value.platform,
      profile_id: value.profile_id,
      mode: value.mode,
      ...(outputDir ? { output_dir: outputDir } : {}),
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

    const workbenchRoot = await readWorkbenchRoot(this.readConfig)
    const platformRule = this.findPlatformRule(config.platform)
    const session: CollectionSession = {
      id: this.randomId(),
      platform: config.platform,
      profile_id: config.profile_id,
      mode: config.mode,
      status: 'starting',
      output_dir: config.output_dir ?? join(workbenchRoot, WORKBENCH_DIRECTORIES.collection),
      started_at: this.now(),
    }
    const lock = this.locks.acquire(config.profile_id, 'collection', session.id)
    this.active = {
      session,
      lock,
      workbenchRoot,
      goodsSku: new Map(),
      platformRule,
      wiredPages: new WeakSet(),
      browser: undefined,
      context: undefined,
      pageHandler: undefined,
    }

    try {
      writeSession(workbenchRoot, this.openDatabase, session)
      await this.connectAndWire(this.active)
      const activeSession = this.updateActiveSession({ status: 'active' })
      writeSession(workbenchRoot, this.openDatabase, activeSession)
      this.emit({ type: 'session-started', session: activeSession })
      return activeSession
    } catch (error) {
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
    writeSession(runtime.workbenchRoot, this.openDatabase, stopping)
    this.detachPageHandler(runtime)
    await this.cdp.disconnect(runtime.session.profile_id).catch(() => null)
    runtime.lock.release()

    const completed = this.updateActiveSession({ status: 'completed', ended_at: this.now() })
    writeSession(runtime.workbenchRoot, this.openDatabase, completed)
    const manifestPath = await exportManifest(
      runtime.workbenchRoot,
      this.openDatabase,
      completed.output_dir,
      completed.id,
    )
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
    writeSession(this.active.workbenchRoot, this.openDatabase, paused)
    this.emit({ type: 'session-paused', session: paused, reason })
    return paused
  }

  async resume(): Promise<CollectionSession | null> {
    if (!this.active || this.active.session.status !== 'paused') {
      return null
    }
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
    const browser = await this.cdp.connectToProfile(runtime.session.profile_id)
    runtime.browser = browser
    const context = await firstBrowserContext(browser)
    runtime.context = context

    const targetPage = await this.acquireCollectionPage(context, runtime.platformRule)
    await this.wirePage(runtime, targetPage)
    await targetPage.bringToFront().catch(() => null)

    const pageHandler = (page: Page) => {
      void this.wireIfAllowed(runtime, page).catch(() => null)
    }
    context.on('page', pageHandler)
    runtime.pageHandler = pageHandler

    browser.on('disconnected', () => {
      if (this.active?.session.id === runtime.session.id) {
        this.handleBrowserClosed()
      }
    })
  }

  private async acquireCollectionPage(
    context: BrowserContext,
    rule: CollectionPlatformRule,
  ): Promise<Page> {
    const existing = context
      .pages()
      .find((page) => !page.isClosed() && isAllowedDomain(page.url(), rule.allowed_domains))
    if (existing) {
      return existing
    }

    const page = await context.newPage()
    await page.goto(rule.entry_url, { waitUntil: 'domcontentloaded' }).catch(() => null)
    return page
  }

  private async wireIfAllowed(runtime: SessionRuntime, page: Page): Promise<void> {
    if (!isAllowedDomain(page.url(), runtime.platformRule.allowed_domains)) {
      return
    }
    await this.wirePage(runtime, page)
  }

  private async wirePage(runtime: SessionRuntime, page: Page): Promise<void> {
    if (page.isClosed() || runtime.wiredPages.has(page)) {
      return
    }
    runtime.wiredPages.add(page)
    try {
      await this.cdp.injectPageScript(page, {
        script: createCollectionInjectedScript({ platformRule: runtime.platformRule }),
        onEvent: async (payload) => {
          await this.dispatchCollectionEvent(payload, {
            platformRule: runtime.platformRule,
            mode: runtime.session.mode,
          })
        },
      })
    } catch (error) {
      runtime.wiredPages.delete(page)
      throw error
    }
  }

  private detachPageHandler(runtime: SessionRuntime): void {
    if (runtime.context && runtime.pageHandler) {
      runtime.context.off('page', runtime.pageHandler)
    }
    runtime.pageHandler = undefined
    runtime.context = undefined
  }

  private emit(event: CollectionSessionEvent) {
    this.emitEvent?.(event)
  }
}

function withoutPauseReason(session: CollectionSession): CollectionSession {
  const { pause_reason: _pauseReason, ...rest } = session
  return rest
}

function workbenchDbPath(workbenchRoot: string) {
  return join(workbenchRoot, WORKBENCH_DIRECTORIES.metadata, 'workbench.db')
}

function openWorkbenchDatabase(workbenchRoot: string) {
  return openSqliteDatabase(workbenchDbPath(workbenchRoot))
}

async function readWorkbenchRoot(readConfig: ReadAppConfig) {
  const config = await readConfig()
  if (!config.workbench_root) {
    throw new AppErrorClass('HTTP_4XX', '请先设置素材总目录', false)
  }
  return config.workbench_root
}

async function readAppConfig() {
  return (await import('../onboarding')).readAppConfig()
}

async function firstBrowserContext(browser: Browser): Promise<BrowserContext> {
  return browser.contexts()[0] ?? (await browser.newContext())
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

function ensureCollectionSessionTable(db: Pick<SqliteDatabase, 'exec'>) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS collection_sessions (
      id TEXT PRIMARY KEY,
      platform TEXT NOT NULL,
      profile_id TEXT NOT NULL,
      mode TEXT NOT NULL,
      status TEXT NOT NULL,
      output_dir TEXT NOT NULL,
      started_at INTEGER NOT NULL,
      ended_at INTEGER,
      task_id TEXT
    );
  `)
}

function writeSession(
  workbenchRoot: string,
  openDatabase: (workbenchRoot: string) => CollectionDatabase,
  session: CollectionSession,
) {
  const db = openDatabase(workbenchRoot)
  try {
    ensureCollectionSessionTable(db)
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
