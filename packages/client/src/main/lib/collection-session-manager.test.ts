import type { AppErrorClass } from '@tengyu-aipod/shared'
import { describe, expect, it, vi } from 'vitest'
import { BrowserProfileLockManager } from './browser-profile-lock'
import {
  type CollectionSession,
  type CollectionSessionEvent,
  CollectionSessionManager,
} from './collection-session-manager'

type InsertedSession = CollectionSession & { task_id: string | null }

class FakeStatement {
  constructor(private readonly runFn: (...values: unknown[]) => void) {}

  run(...values: unknown[]) {
    this.runFn(...values)
    return { changes: 1 }
  }
}

class FakeDb {
  execCalls: string[] = []
  rows = new Map<string, InsertedSession>()

  exec(sql: string) {
    this.execCalls.push(sql)
  }

  prepare(sql: string) {
    return new FakeStatement((...values) => {
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
    }
    locks?: BrowserProfileLockManager
    db?: FakeDb
    events?: CollectionSessionEvent[]
    now?: () => number
    randomId?: () => string
  } = {},
) {
  const db = options.db ?? new FakeDb()
  const events = options.events ?? []
  const cdp = options.cdp ?? {
    connectToProfile: vi.fn().mockResolvedValue({}),
    disconnect: vi.fn().mockResolvedValue(undefined),
  }
  const manager = new CollectionSessionManager({
    readConfig: vi.fn().mockResolvedValue({ workbench_root: options.workbenchRoot ?? '/tmp/wb' }),
    openDatabase: () => db as never,
    cdp,
    locks: options.locks ?? new BrowserProfileLockManager(),
    emitEvent: (event) => events.push(event),
    randomId: options.randomId ?? (() => 'session-1'),
    now: options.now ?? (() => 1000),
  })
  return { manager, db, events, cdp }
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
      output_dir: '/tmp/wb/01-采集',
      started_at: 1000,
    })

    expect(cdp.connectToProfile).toHaveBeenCalledWith('profile-1')
    expect(db.execCalls[0]).toContain('CREATE TABLE IF NOT EXISTS collection_sessions')
    expect(db.rows.get('session-1')).toMatchObject({ status: 'active' })
    expect(events).toEqual([
      {
        type: 'session-started',
        session: expect.objectContaining({ id: 'session-1', status: 'active' }),
      },
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
    expect(manager.resume()).toMatchObject({
      status: 'active',
    })
    expect(manager.getActiveSession()).not.toHaveProperty('pause_reason')

    expect(db.rows.get('session-1')).toMatchObject({ status: 'active' })
    expect(events.map((event) => event.type)).toEqual([
      'session-started',
      'session-paused',
      'session-resumed',
    ])
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
    expect(events.at(-1)).toMatchObject({
      type: 'session-stopped',
      session: expect.objectContaining({ status: 'completed' }),
    })
  })

  it('returns null when stop is called without an active session', async () => {
    const { manager } = createManager()

    await expect(manager.stopSession()).resolves.toBeNull()
  })
})
