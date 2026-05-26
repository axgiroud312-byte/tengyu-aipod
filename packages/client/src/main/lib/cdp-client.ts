import { AppErrorClass } from '@tengyu-aipod/shared'
import { type Browser, type Page, chromium } from 'playwright'
import { type BitBrowserClient, bitBrowserClient } from './bit-browser-client'

export type CollectionBindingPayload = {
  kind: 'click' | 'scroll'
  img?: string
  images?: string[]
  goodsLink?: string
  page: string
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

export class CDPClient {
  private readonly browsers = new Map<string, BrowserEntry>()
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
    this.browsers.delete(profileId)
    if (entry?.browser.isConnected()) {
      await entry.browser.close()
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
  if ((kind !== 'click' && kind !== 'scroll') || typeof page !== 'string') {
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
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export const cdpClient = new CDPClient()
