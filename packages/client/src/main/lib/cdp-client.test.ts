import { EventEmitter } from 'node:events'
import { AppErrorClass } from '@tengyu-aipod/shared'
import { describe, expect, it, vi } from 'vitest'
import { CDPClient, type CollectionBindingPayload } from './cdp-client'

class FakeBrowser extends EventEmitter {
  private connected = true

  isConnected() {
    return this.connected
  }

  async close() {
    this.connected = false
    this.emit('disconnected')
  }

  disconnectOnly() {
    this.connected = false
    this.emit('disconnected')
  }
}

class FakePage {
  bindings = new Map<string, (_source: unknown, data: unknown) => Promise<void>>()
  scripts: string[] = []
  evaluations: string[] = []

  async exposeBinding(name: string, callback: (_source: unknown, data: unknown) => Promise<void>) {
    this.bindings.set(name, callback)
  }

  async addInitScript(script: string) {
    this.scripts.push(script)
  }

  async evaluate(script: string) {
    this.evaluations.push(script)
    return null
  }
}

describe('CDPClient', () => {
  it('opens the BitBrowser profile and connects through Playwright connectOverCDP', async () => {
    const browser = new FakeBrowser()
    const bitBrowser = {
      openProfile: vi.fn().mockResolvedValue({
        http: 'http://127.0.0.1:9222',
        ws: 'ws://127.0.0.1:9222/devtools/browser/abc',
      }),
      closeProfile: vi.fn().mockResolvedValue(undefined),
    }
    const chromium = {
      connectOverCDP: vi.fn().mockResolvedValue(browser),
    }
    const client = new CDPClient({ bitBrowser, chromium })

    await expect(client.connectToProfile('profile-1')).resolves.toBe(browser)
    expect(bitBrowser.openProfile).toHaveBeenCalledWith('profile-1')
    expect(chromium.connectOverCDP).toHaveBeenCalledWith('http://127.0.0.1:9222')
    expect(client.getCachedEndpoint('profile-1')).toBe('http://127.0.0.1:9222')
  })

  it('uses browser/ports instead of opening profiles that are already online', async () => {
    const browser = new FakeBrowser()
    const bitBrowser = {
      listOpenProfileIds: vi.fn().mockResolvedValue(['profile-1']),
      getCdpEndpoint: vi.fn().mockResolvedValue({
        http: 'http://127.0.0.1:9333',
        ws: 'ws://127.0.0.1:9333/devtools/browser/open',
      }),
      openProfile: vi.fn(),
      closeProfile: vi.fn().mockResolvedValue(undefined),
    }
    const chromium = {
      connectOverCDP: vi.fn().mockResolvedValue(browser),
    }
    const client = new CDPClient({ bitBrowser, chromium })

    await expect(client.connectToProfile('profile-1')).resolves.toBe(browser)
    expect(bitBrowser.getCdpEndpoint).toHaveBeenCalledWith('profile-1')
    expect(bitBrowser.openProfile).not.toHaveBeenCalled()
    expect(chromium.connectOverCDP).toHaveBeenCalledWith('http://127.0.0.1:9333')
  })

  it('reuses a connected browser for the same profile', async () => {
    const browser = new FakeBrowser()
    const bitBrowser = {
      openProfile: vi.fn().mockResolvedValue({
        http: 'http://127.0.0.1:9222',
        ws: 'ws://127.0.0.1:9222/devtools/browser/abc',
      }),
      closeProfile: vi.fn().mockResolvedValue(undefined),
    }
    const chromium = {
      connectOverCDP: vi.fn().mockResolvedValue(browser),
    }
    const client = new CDPClient({ bitBrowser, chromium })

    await client.connectToProfile('profile-1')
    await client.connectToProfile('profile-1')

    expect(bitBrowser.openProfile).toHaveBeenCalledTimes(1)
    expect(chromium.connectOverCDP).toHaveBeenCalledTimes(1)
  })

  it('reconnects when the cached browser disconnects', async () => {
    const firstBrowser = new FakeBrowser()
    const secondBrowser = new FakeBrowser()
    const bitBrowser = {
      openProfile: vi.fn().mockResolvedValue({
        http: 'http://127.0.0.1:9222',
        ws: 'ws://127.0.0.1:9222/devtools/browser/abc',
      }),
      closeProfile: vi.fn().mockResolvedValue(undefined),
    }
    const chromium = {
      connectOverCDP: vi
        .fn()
        .mockResolvedValueOnce(firstBrowser)
        .mockResolvedValueOnce(secondBrowser),
    }
    const client = new CDPClient({ bitBrowser, chromium })

    await client.connectToProfile('profile-1')
    firstBrowser.disconnectOnly()

    await expect(client.getOrReconnect('profile-1')).resolves.toBe(secondBrowser)
    expect(chromium.connectOverCDP).toHaveBeenCalledTimes(2)
  })

  it('disconnects browser and closes the BitBrowser profile', async () => {
    const browser = new FakeBrowser()
    const bitBrowser = {
      openProfile: vi.fn().mockResolvedValue({
        http: 'http://127.0.0.1:9222',
        ws: 'ws://127.0.0.1:9222/devtools/browser/abc',
      }),
      closeProfile: vi.fn().mockResolvedValue(undefined),
    }
    const chromium = {
      connectOverCDP: vi.fn().mockResolvedValue(browser),
    }
    const client = new CDPClient({ bitBrowser, chromium })

    await client.connectToProfile('profile-1')
    await client.disconnect('profile-1')

    expect(browser.isConnected()).toBe(false)
    expect(bitBrowser.closeProfile).toHaveBeenCalledWith('profile-1')
    expect(client.getCachedEndpoint('profile-1')).toBeNull()
  })

  it('injects init script and exposes the collection binding', async () => {
    const page = new FakePage()
    const events: CollectionBindingPayload[] = []
    const client = new CDPClient({
      bitBrowser: {
        openProfile: vi.fn(),
        closeProfile: vi.fn(),
      },
      chromium: {
        connectOverCDP: vi.fn(),
      },
    })

    await client.injectPageScript(page as never, {
      script: 'window.__collection = true',
      onEvent: (event) => {
        events.push(event)
      },
    })
    await page.bindings.get('__poseidonSendToHost')?.(
      {},
      {
        kind: 'click',
        img: 'https://img.example/a.jpg',
        goodsLink: 'https://shop.example/goods/1',
        page: 'https://shop.example/goods/1',
      },
    )

    expect(page.scripts).toEqual(['window.__collection = true'])
    expect(page.evaluations).toEqual(['window.__collection = true'])
    expect(events).toEqual([
      {
        kind: 'click',
        img: 'https://img.example/a.jpg',
        goodsLink: 'https://shop.example/goods/1',
        page: 'https://shop.example/goods/1',
      },
    ])
  })

  it('rejects invalid binding payloads before they reach the handler', async () => {
    const page = new FakePage()
    const handler = vi.fn()
    const client = new CDPClient({
      bitBrowser: {
        openProfile: vi.fn(),
        closeProfile: vi.fn(),
      },
      chromium: {
        connectOverCDP: vi.fn(),
      },
    })

    await client.injectPageScript(page as never, {
      script: 'window.__collection = true',
      onEvent: handler,
    })

    await expect(
      page.bindings.get('__poseidonSendToHost')?.({}, { kind: 'click' }),
    ).rejects.toBeInstanceOf(AppErrorClass)
    expect(handler).not.toHaveBeenCalled()
  })

  it('maps Playwright CDP connection failures to BROWSER_NOT_CONNECTED', async () => {
    const bitBrowser = {
      openProfile: vi.fn().mockResolvedValue({
        http: 'http://127.0.0.1:9222',
        ws: 'ws://127.0.0.1:9222/devtools/browser/abc',
      }),
      closeProfile: vi.fn().mockResolvedValue(undefined),
    }
    const chromium = {
      connectOverCDP: vi.fn().mockRejectedValue(new Error('ECONNREFUSED')),
    }
    const client = new CDPClient({ bitBrowser, chromium })

    await expect(client.connectToProfile('profile-1')).rejects.toMatchObject({
      code: 'BROWSER_NOT_CONNECTED',
      retryable: true,
      details: {
        kind: 'network',
        provider: 'playwright-cdp',
        profileId: 'profile-1',
        endpoint: 'http://127.0.0.1:9222',
      },
    })
  })
})
