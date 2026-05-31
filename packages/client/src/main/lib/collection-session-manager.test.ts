import { EventEmitter } from 'node:events'
import type { AppErrorClass } from '@tengyu-aipod/shared'
import { describe, expect, it, vi } from 'vitest'
import { BrowserProfileLockManager } from './browser-profile-lock'
import {
  type CollectionSession,
  type CollectionSessionEvent,
  CollectionSessionManager,
} from './collection-session-manager'

type InsertedSession = CollectionSession & { task_id: string | null }

function localTimestampSlug(value: number) {
  const date = new Date(value)
  const pad = (item: number) => String(item).padStart(2, '0')
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`
}

class FakePage {
  bindings = new Map<string, (_source: unknown, data: unknown) => Promise<unknown>>()
  scripts: string[] = []
  gotos: Array<{ url: string; options: unknown }> = []
  reloads = 0
  bringToFronts = 0
  closed = false

  constructor(private currentUrl = 'about:blank') {}

  isClosed() {
    return this.closed
  }

  url() {
    return this.currentUrl
  }

  async exposeBinding(
    name: string,
    callback: (_source: unknown, data: unknown) => Promise<unknown>,
  ) {
    this.bindings.set(name, callback)
  }

  async addInitScript(script: string) {
    this.scripts.push(script)
  }

  async reload() {
    this.reloads += 1
  }

  async goto(url: string, options: unknown) {
    this.currentUrl = url
    this.gotos.push({ url, options })
  }

  async bringToFront() {
    this.bringToFronts += 1
  }
}

class FakeContext extends EventEmitter {
  constructor(private readonly pageList: FakePage[] = []) {
    super()
  }

  pages() {
    return this.pageList
  }

  async newPage() {
    const page = new FakePage()
    this.pageList.push(page)
    this.emit('page', page)
    return page
  }
}

class FakeBrowser extends EventEmitter {
  private connected = true

  constructor(private readonly contextList: FakeContext[] = []) {
    super()
  }

  contexts() {
    return this.contextList
  }

  async newContext() {
    const context = new FakeContext()
    this.contextList.push(context)
    return context
  }

  isConnected() {
    return this.connected
  }

  disconnectOnly() {
    this.connected = false
    this.emit('disconnected')
  }
}

class FakeStatement {
  constructor(
    private readonly options: {
      run?: (...values: unknown[]) => void
      all?: (...values: unknown[]) => unknown[]
    },
  ) {}

  run(...values: unknown[]) {
    this.options.run?.(...values)
    return { changes: 1 }
  }

  all(...values: unknown[]) {
    return this.options.all?.(...values) ?? []
  }
}

class FakeDb {
  execCalls: string[] = []
  rows = new Map<string, InsertedSession>()

  exec(sql: string) {
    this.execCalls.push(sql)
  }

  prepare(sql: string) {
    return new FakeStatement({
      run: (...values) => {
        if (!sql.includes('INSERT INTO collection_sessions')) {
          return
        }
        const row: InsertedSession = {
          id: String(values[0]),
          platform: String(values[1]),
          profile_id: String(values[2]),
          mode: values[3] as CollectionSession['mode'],
          status: values[4] as CollectionSession['status'],
          output_dir: String(values[5]),
          started_at: Number(values[6]),
          ...(typeof values[7] === 'number' ? { ended_at: values[7] } : {}),
          task_id: values[8] === null ? null : String(values[8]),
        }
        this.rows.set(row.id, row)
      },
      all: () => [],
    })
  }

  close() {}
}

function createManager(overrides: Partial<Parameters<typeof createManagerBase>[0]> = {}) {
  return createManagerBase(overrides)
}

function createManagerBase(
  options: {
    workbenchRoot?: string
    cdp?: {
      connectToProfile: ReturnType<typeof vi.fn>
      disconnect: ReturnType<typeof vi.fn>
      injectPageScript: ReturnType<typeof vi.fn>
    }
    browser?: FakeBrowser
    bitBrowser?: {
      listProfiles: ReturnType<typeof vi.fn>
      listOpenProfileIds: ReturnType<typeof vi.fn>
      openProfile: ReturnType<typeof vi.fn>
    }
    locks?: BrowserProfileLockManager
    db?: FakeDb
    events?: CollectionSessionEvent[]
    dispatch?: ReturnType<typeof vi.fn>
    now?: () => number
    randomId?: () => string
  } = {},
) {
  const db = options.db ?? new FakeDb()
  const events = options.events ?? []
  const browser = options.browser ?? new FakeBrowser([new FakeContext()])
  const cdp = options.cdp ?? {
    connectToProfile: vi.fn().mockResolvedValue(browser),
    disconnect: vi.fn().mockResolvedValue(undefined),
    injectPageScript: vi.fn(
      async (
        page: FakePage,
        input: { script: string; onEvent?: (payload: unknown) => unknown | Promise<unknown> },
      ) => {
        await page.exposeBinding('__poseidonSendToHost', async (_source, data) => {
          if (input.onEvent) {
            return input.onEvent(data)
          }
          return undefined
        })
        await page.addInitScript(input.script)
        return undefined
      },
    ),
  }
  const manager = new CollectionSessionManager({
    readConfig: vi.fn().mockResolvedValue({ workbench_root: options.workbenchRoot ?? '/tmp/wb' }),
    openDatabase: () => db as never,
    cdp: cdp as never,
    ...(options.bitBrowser ? { bitBrowser: options.bitBrowser as never } : {}),
    locks: options.locks ?? new BrowserProfileLockManager(),
    emitEvent: (event) => events.push(event),
    dispatchCollectionEvent: options.dispatch ?? vi.fn().mockResolvedValue(null),
    randomId: options.randomId ?? (() => 'session-1'),
    now: options.now ?? (() => 1000),
  })
  return { manager, db, events, cdp, browser }
}

describe('CollectionSessionManager', () => {
  it('starts a session, locks the profile, connects CDP, and stores active state', async () => {
    const { manager, db, cdp, events } = createManager()

    await expect(
      manager.startSession({
        platform: 'temu',
        profile_id: 'profile-1',
        mode: 'click',
      }),
    ).resolves.toMatchObject({
      id: 'session-1',
      platform: 'temu',
      profile_id: 'profile-1',
      mode: 'click',
      status: 'active',
      output_dir: `/tmp/wb/01-采集工作区/temu-${localTimestampSlug(1000)}`,
      started_at: 1000,
    })

    expect(cdp.connectToProfile).toHaveBeenCalledWith('profile-1')
    expect(db.execCalls[0]).toContain('CREATE TABLE IF NOT EXISTS collection_sessions')
    expect(db.rows.get('session-1')).toMatchObject({ status: 'active' })
    expect(events.filter((event) => event.type !== 'debug-log')).toEqual([
      {
        type: 'session-started',
        session: expect.objectContaining({ id: 'session-1', status: 'active' }),
      },
    ])
    expect(events).toContainEqual({
      type: 'debug-log',
      entry: expect.objectContaining({ message: '采集会话已进入监听状态' }),
    })
  })

  it('reuses an allowed current page without reloading other tabs, wires existing and new tabs, and pauses on disconnect', async () => {
    const currentPage = new FakePage('https://temu.com/goods/1')
    const unrelatedPage = new FakePage('https://www.dianxiaomi.com/dashboard')
    const context = new FakeContext([unrelatedPage, currentPage])
    const browser = new FakeBrowser([context])
    const dispatch = vi.fn().mockResolvedValue(null)
    const { manager, cdp, events } = createManager({ browser, dispatch })

    await manager.startSession({
      platform: 'temu',
      profile_id: 'profile-1',
      mode: 'click',
    })

    expect(cdp.injectPageScript).toHaveBeenCalledWith(
      currentPage,
      expect.objectContaining({
        script: expect.stringContaining('__poseidonSendToHost'),
      }),
    )
    expect(currentPage.reloads).toBe(0)
    expect(currentPage.gotos).toEqual([])
    expect(currentPage.bringToFronts).toBe(1)
    expect(unrelatedPage.reloads).toBe(0)
    expect(cdp.injectPageScript).toHaveBeenCalledWith(
      unrelatedPage,
      expect.objectContaining({
        script: expect.stringContaining('__poseidonSendToHost'),
      }),
    )

    await currentPage.bindings.get('__poseidonSendToHost')?.(
      {},
      {
        kind: 'click',
        img: 'https://img.temu.com/a.jpg',
        page: 'https://temu.com/goods/1',
      },
    )
    expect(dispatch).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'click', img: 'https://img.temu.com/a.jpg' }),
      expect.objectContaining({
        mode: 'click',
        platformRule: expect.objectContaining({ key: 'temu' }),
      }),
    )

    const newPage = new FakePage('https://www.temu.com/goods/2')
    context.emit('page', newPage)
    await Promise.resolve()
    await Promise.resolve()
    expect(cdp.injectPageScript).toHaveBeenCalledWith(
      newPage,
      expect.objectContaining({
        script: expect.stringContaining('__poseidonSendToHost'),
      }),
    )
    expect(newPage.reloads).toBe(0)

    const blankNewPage = new FakePage('about:blank')
    context.emit('page', blankNewPage)
    await Promise.resolve()
    await Promise.resolve()
    expect(cdp.injectPageScript).toHaveBeenCalledWith(
      blankNewPage,
      expect.objectContaining({
        script: expect.stringContaining('__poseidonSendToHost'),
      }),
    )

    browser.disconnectOnly()
    expect(manager.getActiveSession()).toMatchObject({
      status: 'paused',
      pause_reason: 'browser_closed',
    })
    expect(events.at(-1)).toMatchObject({
      type: 'session-paused',
      reason: 'browser_closed',
    })
  })

  it('emits image-saved when an injected page event creates a collection record', async () => {
    const currentPage = new FakePage('https://temu.com/goods/1')
    const context = new FakeContext([currentPage])
    const browser = new FakeBrowser([context])
    const record = {
      id: 'record-1',
      sessionId: 'session-1',
      sourceUrl: 'https://img.temu.com/a.jpg',
    }
    const dispatch = vi.fn().mockResolvedValue({ status: 'success', record })
    const { manager, events } = createManager({ browser, dispatch })

    await manager.startSession({
      platform: 'temu',
      profile_id: 'profile-1',
      mode: 'click',
    })

    await currentPage.bindings.get('__poseidonSendToHost')?.(
      {},
      {
        kind: 'click',
        img: 'https://img.temu.com/a.jpg',
        page: 'https://temu.com/goods/1',
      },
    )

    expect(events).toContainEqual({ type: 'image-saved', record })
  })

  it('finds existing allowed pages across every browser context without opening a new entry page', async () => {
    const unrelatedPage = new FakePage('https://www.dianxiaomi.com/dashboard')
    const firstContext = new FakeContext([unrelatedPage])
    const temuPage = new FakePage('https://www.temu.com/goods/1')
    const secondContext = new FakeContext([temuPage])
    const browser = new FakeBrowser([firstContext, secondContext])
    const { manager, cdp } = createManager({ browser })

    await manager.startSession({
      platform: 'temu',
      profile_id: 'profile-1',
      mode: 'click',
    })

    expect(firstContext.pages()).toEqual([unrelatedPage])
    expect(secondContext.pages()).toEqual([temuPage])
    expect(cdp.injectPageScript).toHaveBeenCalledWith(
      temuPage,
      expect.objectContaining({
        script: expect.stringContaining('__poseidonSendToHost'),
      }),
    )
    expect(temuPage.bringToFronts).toBe(1)
  })

  it('wires existing allowed pages across multiple browser contexts', async () => {
    const firstTemuPage = new FakePage('https://www.temu.com/goods/1')
    const secondTemuPage = new FakePage('https://www.temu.com/goods/2')
    const browser = new FakeBrowser([
      new FakeContext([firstTemuPage]),
      new FakeContext([secondTemuPage]),
    ])
    const { manager, cdp } = createManager({ browser })

    await manager.startSession({
      platform: 'temu',
      profile_id: 'profile-1',
      mode: 'click',
    })

    expect(cdp.injectPageScript).toHaveBeenCalledWith(firstTemuPage, expect.anything())
    expect(cdp.injectPageScript).toHaveBeenCalledWith(secondTemuPage, expect.anything())
  })

  it('opens one entry page when no existing tab matches the platform domains', async () => {
    const unrelatedPage = new FakePage('https://www.dianxiaomi.com/dashboard')
    const context = new FakeContext([unrelatedPage])
    const otherContext = new FakeContext([new FakePage('https://seller.ozon.ru/dashboard')])
    const browser = new FakeBrowser([context, otherContext])
    const { manager, cdp } = createManager({ browser })

    await manager.startSession({
      platform: 'temu',
      profile_id: 'profile-1',
      mode: 'click',
    })

    expect(context.pages()).toHaveLength(2)
    const targetPage = context.pages()[1]
    if (!targetPage) {
      throw new Error('expected a new collection page')
    }
    expect(targetPage.gotos).toEqual([
      { url: 'https://www.temu.com', options: { waitUntil: 'domcontentloaded' } },
    ])
    expect(targetPage.reloads).toBe(0)
    expect(targetPage.bringToFronts).toBe(1)
    expect(unrelatedPage.reloads).toBe(0)
    expect(cdp.injectPageScript).toHaveBeenCalledWith(
      targetPage,
      expect.objectContaining({
        script: expect.stringContaining('__poseidonSendToHost'),
      }),
    )
  })

  it('passes the session size filter into the injected collection script', async () => {
    const { manager, cdp } = createManager()

    await manager.startSession({
      platform: 'temu',
      profile_id: 'profile-1',
      mode: 'scroll',
      size_filter: {
        min_width: 500,
        max_width: 1200,
        min_height: 400,
        max_height: 900,
      },
    })

    expect(cdp.injectPageScript).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        script: expect.stringContaining(
          'const sizeFilter = {"minWidth":500,"maxWidth":1200,"minHeight":400,"maxHeight":900};',
        ),
      }),
    )
  })

  it('lists real BitBrowser profiles with online status joined from open profile ids', async () => {
    const bitBrowser = {
      listProfiles: vi.fn().mockResolvedValue([
        { id: 'profile-1', name: 'Temu 主店' },
        { id: 'profile-2', name: '备用环境' },
      ]),
      listOpenProfileIds: vi.fn().mockResolvedValue(['profile-2']),
      openProfile: vi.fn(),
    }
    const { manager } = createManager({ bitBrowser })

    await expect(manager.listProfiles()).resolves.toEqual([
      { id: 'profile-1', name: 'Temu 主店', online: false },
      { id: 'profile-2', name: '备用环境', online: true },
    ])
  })

  it('rejects a second active session', async () => {
    const { manager } = createManager()
    await manager.startSession({ platform: 'temu', profile_id: 'profile-1', mode: 'click' })

    await expect(
      manager.startSession({ platform: 'ozon', profile_id: 'profile-2', mode: 'scroll' }),
    ).rejects.toMatchObject({
      code: 'HTTP_4XX',
      details: { kind: 'state_conflict', activeSessionId: 'session-1' },
    } satisfies Partial<AppErrorClass>)
  })

  it('releases the profile lock if CDP connection fails', async () => {
    const locks = new BrowserProfileLockManager()
    const cdp = {
      connectToProfile: vi.fn().mockRejectedValue(new Error('CDP down')),
      disconnect: vi.fn().mockResolvedValue(undefined),
      injectPageScript: vi.fn(),
    }
    const { manager } = createManager({ locks, cdp })

    await expect(
      manager.startSession({ platform: 'temu', profile_id: 'profile-1', mode: 'click' }),
    ).rejects.toThrow('CDP down')
    expect(locks.status('profile-1')).toBeNull()
  })

  it('pauses and resumes active sessions with IPC-friendly events', async () => {
    const { manager, events, db } = createManager()
    await manager.startSession({ platform: 'temu', profile_id: 'profile-1', mode: 'click' })

    expect(manager.handleLeftAllowedDomain()).toMatchObject({
      status: 'paused',
      pause_reason: 'manual_intervention',
    })
    await expect(manager.resume()).resolves.toMatchObject({
      status: 'active',
    })
    expect(manager.getActiveSession()).not.toHaveProperty('pause_reason')

    expect(db.rows.get('session-1')).toMatchObject({ status: 'active' })
    expect(events.filter((event) => event.type !== 'debug-log').map((event) => event.type)).toEqual(
      ['session-started', 'session-paused', 'session-resumed'],
    )
  })

  it('stops a session, disconnects CDP, releases the lock, and stores completed state', async () => {
    const nowValues = [1000, 2000]
    const locks = new BrowserProfileLockManager()
    const { manager, cdp, db, events } = createManager({
      locks,
      now: () => nowValues.shift() ?? 2000,
    })
    await manager.startSession({ platform: 'temu', profile_id: 'profile-1', mode: 'scroll' })

    await expect(manager.stopSession()).resolves.toMatchObject({
      id: 'session-1',
      status: 'completed',
      ended_at: 2000,
    })

    expect(cdp.disconnect).toHaveBeenCalledWith('profile-1')
    expect(locks.status('profile-1')).toBeNull()
    expect(db.rows.get('session-1')).toMatchObject({ status: 'completed', ended_at: 2000 })
    expect(events.map((event) => event.type)).toContain('session-stopped')
    expect(events.at(-1)).toMatchObject({
      type: 'manifest-exported',
      session: expect.objectContaining({ status: 'completed' }),
    })
  })

  it('returns null when stop is called without an active session', async () => {
    const { manager } = createManager()

    await expect(manager.stopSession()).resolves.toBeNull()
  })
})
