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
})
