import { AppErrorClass } from '@tengyu-aipod/shared'
import { type Browser, type Page, chromium } from 'playwright'
import { type BitBrowserClient, bitBrowserClient } from './bit-browser-client'

export type CollectionBindingPayload = {
  kind: 'click' | 'scroll' | 'debug'
  img?: string
  images?: string[]
  goodsLink?: string
  page: string
  level?: 'debug' | 'info' | 'warn' | 'error'
  message?: string
  details?: Record<string, string | number | boolean | null>
  [key: string]: unknown
}

export type CollectionBindingHandler = (data: CollectionBindingPayload) => void | Promise<void>

export type InjectPageScriptOptions = {
  script: string
  bindingName?: string
  onEvent?: CollectionBindingHandler
}

export type CDPClientDependencies = {
  bitBrowser?: Pick<BitBrowserClient, 'openProfile' | 'closeProfile'> &
    Partial<Pick<BitBrowserClient, 'getCdpEndpoint' | 'listOpenProfileIds'>>
  chromium?: Pick<typeof chromium, 'connectOverCDP'>
}

type BrowserEntry = {
  browser: Browser
  endpoint: string
}

const DEFAULT_BINDING_NAME = '__poseidonSendToHost'
const PLAYWRIGHT_BROWSER_CLOSE_TIMEOUT_MS = 5_000

export class CDPClient {
  private readonly browsers = new Map<string, BrowserEntry>()
  private readonly pendingConnections = new Map<string, Promise<Browser>>()
  private readonly bitBrowser: Pick<BitBrowserClient, 'openProfile' | 'closeProfile'> &
    Partial<Pick<BitBrowserClient, 'getCdpEndpoint' | 'listOpenProfileIds'>>
  private readonly chromium: Pick<typeof chromium, 'connectOverCDP'>

  constructor(dependencies: CDPClientDependencies = {}) {
    this.bitBrowser = dependencies.bitBrowser ?? bitBrowserClient
    this.chromium = dependencies.chromium ?? chromium
  }

  async connectToProfile(profileId: string): Promise<Browser> {
    const cached = this.browsers.get(profileId)
    if (cached?.browser.isConnected()) {
      return cached.browser
    }
    if (cached) {
      this.browsers.delete(profileId)
    }

    const pending = this.pendingConnections.get(profileId)
    if (pending) {
      return pending
    }

    const connecting = this.connectFreshProfile(profileId)
    this.pendingConnections.set(profileId, connecting)
    try {
      return await connecting
    } finally {
      if (this.pendingConnections.get(profileId) === connecting) {
        this.pendingConnections.delete(profileId)
      }
    }
  }

  private async connectFreshProfile(profileId: string): Promise<Browser> {
    const endpoint = await this.resolveCdpEndpoint(profileId)
    try {
      const browser = await this.chromium.connectOverCDP(endpoint.http)
      this.browsers.set(profileId, { browser, endpoint: endpoint.http })
      browser.on('disconnected', () => {
        if (this.browsers.get(profileId)?.browser === browser) {
          this.browsers.delete(profileId)
        }
      })
      return browser
    } catch (error) {
      throw new AppErrorClass(
        'BROWSER_NOT_CONNECTED',
        '无法通过 CDP 连接比特浏览器 profile',
        true,
        {
          kind: 'network',
          provider: 'playwright-cdp',
          profileId,
          endpoint: endpoint.http,
        },
        error,
      )
    }
  }

  private async resolveCdpEndpoint(profileId: string) {
    if (this.bitBrowser.listOpenProfileIds && this.bitBrowser.getCdpEndpoint) {
      const openProfileIds = await this.bitBrowser.listOpenProfileIds()
      if (openProfileIds.includes(profileId)) {
        return this.bitBrowser.getCdpEndpoint(profileId)
      }
    }
    return this.bitBrowser.openProfile(profileId)
  }

  async reconnect(profileId: string): Promise<Browser> {
    await this.disconnect(profileId)
    return this.connectToProfile(profileId)
  }

  async disconnect(profileId: string): Promise<void> {
    const entry = this.browsers.get(profileId)
    this.pendingConnections.delete(profileId)
    this.browsers.delete(profileId)
    if (entry?.browser.isConnected()) {
      await closePlaywrightBrowser(entry.browser).catch(() => undefined)
    }
    await this.bitBrowser.closeProfile(profileId)
  }

  async injectPageScript(page: Page, options: InjectPageScriptOptions): Promise<void> {
    const bindingName = options.bindingName ?? DEFAULT_BINDING_NAME
    await page.exposeBinding(bindingName, async (_source, data: unknown) => {
      if (!options.onEvent) {
        return
      }
      await options.onEvent(readBindingPayload(data))
    })
    await page.addInitScript(options.script)
    await page.evaluate(options.script).catch(() => null)
  }

  async getOrReconnect(profileId: string): Promise<Browser> {
    const cached = this.browsers.get(profileId)
    if (cached?.browser.isConnected()) {
      return cached.browser
    }
    return this.reconnect(profileId)
  }

  getCachedEndpoint(profileId: string): string | null {
    return this.browsers.get(profileId)?.endpoint ?? null
  }
}

function readBindingPayload(value: unknown): CollectionBindingPayload {
  if (!isRecord(value)) {
    throw new AppErrorClass('HTTP_4XX', '采集脚本回调数据格式不正确', false, {
      kind: 'validation',
      provider: 'playwright-cdp',
    })
  }

  const kind = value.kind
  const page = value.page
  if ((kind !== 'click' && kind !== 'scroll' && kind !== 'debug') || typeof page !== 'string') {
    throw new AppErrorClass('HTTP_4XX', '采集脚本回调缺少必要字段', false, {
      kind: 'validation',
      provider: 'playwright-cdp',
    })
  }
  if (kind === 'debug' && typeof value.message !== 'string') {
    throw new AppErrorClass('HTTP_4XX', '采集脚本回调缺少必要字段', false, {
      kind: 'validation',
      provider: 'playwright-cdp',
    })
  }

  return {
    ...value,
    kind,
    page,
    ...(typeof value.img === 'string' ? { img: value.img } : {}),
    ...(Array.isArray(value.images) && value.images.every((item) => typeof item === 'string')
      ? { images: value.images }
      : {}),
    ...(typeof value.goodsLink === 'string' ? { goodsLink: value.goodsLink } : {}),
    ...(isDebugLogLevel(value.level) ? { level: value.level } : {}),
    ...(typeof value.message === 'string' ? { message: value.message } : {}),
    ...(isLogDetails(value.details) ? { details: value.details } : {}),
  }
}

async function closePlaywrightBrowser(browser: Browser): Promise<void> {
  await withTimeout(browser.close(), PLAYWRIGHT_BROWSER_CLOSE_TIMEOUT_MS)
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Timed out after ${timeoutMs}ms`))
    }, timeoutMs)
    promise.then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      (error: unknown) => {
        clearTimeout(timer)
        reject(error)
      },
    )
  })
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isDebugLogLevel(value: unknown): value is 'debug' | 'info' | 'warn' | 'error' {
  return value === 'debug' || value === 'info' || value === 'warn' || value === 'error'
}

function isLogDetails(value: unknown): value is Record<string, string | number | boolean | null> {
  if (!isRecord(value)) {
    return false
  }
  return Object.values(value).every((item) => {
    return item === null || ['string', 'number', 'boolean'].includes(typeof item)
  })
}

export const cdpClient = new CDPClient()
