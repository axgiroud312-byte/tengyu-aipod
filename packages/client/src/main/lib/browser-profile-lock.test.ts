import { describe, expect, it } from 'vitest'
import { BrowserProfileLockManager } from './browser-profile-lock'

describe('BrowserProfileLockManager', () => {
  it('allows one module to hold a profile lock until release', () => {
    const manager = new BrowserProfileLockManager()
    const lock = manager.acquire('profile-1', 'collection', 'session-1')

    expect(manager.status('profile-1')).toMatchObject({
      profileId: 'profile-1',
      module: 'collection',
      taskId: 'session-1',
    })
    expect(() => manager.acquire('profile-1', 'listing', 'task-2')).toThrow(
      '比特浏览器 profile 已被占用',
    )

    lock.release()
    expect(manager.status('profile-1')).toBeNull()
  })

  it('ignores duplicate release calls', () => {
    const manager = new BrowserProfileLockManager()
    const lock = manager.acquire('profile-1', 'collection', 'session-1')

    lock.release()
    lock.release()

    expect(manager.list()).toEqual([])
  })

  it('blocks listing while collection holds the same profile', () => {
    const manager = new BrowserProfileLockManager()
    manager.acquire('profile-1', 'collection', 'session-1')

    expect(() => manager.acquire('profile-1', 'listing', 'listing-task-1')).toThrow(
      expect.objectContaining({
        code: 'PROFILE_LOCKED',
        details: expect.objectContaining({
          kind: 'resource_lock',
          profileId: 'profile-1',
          module: 'collection',
          taskId: 'session-1',
        }),
      }),
    )

    expect(manager.list()).toEqual([
      expect.objectContaining({
        profileId: 'profile-1',
        module: 'collection',
        taskId: 'session-1',
        acquiredAt: expect.any(Number),
      }),
    ])
  })

  it('allows listing to acquire the profile after collection releases it', () => {
    const manager = new BrowserProfileLockManager()
    const collectionLock = manager.acquire('profile-1', 'collection', 'session-1')

    collectionLock.release()
    const listingLock = manager.acquire('profile-1', 'listing', 'listing-task-1')

    expect(listingLock.holder).toMatchObject({
      profileId: 'profile-1',
      module: 'listing',
      taskId: 'listing-task-1',
    })
    expect(manager.status('profile-1')).toMatchObject({
      module: 'listing',
      taskId: 'listing-task-1',
    })
  })

  it('clears all profile locks during shutdown cleanup', () => {
    const manager = new BrowserProfileLockManager()
    manager.acquire('profile-1', 'collection', 'session-1')
    manager.acquire('profile-2', 'listing', 'listing-task-1')

    manager.clear()

    expect(manager.list()).toEqual([])
  })
})
