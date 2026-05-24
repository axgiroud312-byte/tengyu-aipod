import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises'
import { type ServerResponse, createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { type Browser, type Page, chromium, expect, test } from '@playwright/test'
import { BrowserProfileLockManager } from '../src/main/lib/browser-profile-lock'
import { CDPClient, type CollectionBindingPayload } from '../src/main/lib/cdp-client'
import { CollectionClickService } from '../src/main/lib/collection-click-service'
import {
  type CollectionPlatformRule,
  createCollectionInjectedScript,
} from '../src/main/lib/collection-injected-script'
import { CollectionSessionManager } from '../src/main/lib/collection-session-manager'

const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=',
  'base64',
)

type Runtime = {
  browser: Browser
  cdp: CDPClient
  manager: CollectionSessionManager
  service: CollectionClickService
  workbenchRoot: string
  outputDir: string
  bitBrowserCalls: {
    opened: string[]
    closed: string[]
  }
}

type CapturedResult = {
  payload: CollectionBindingPayload
  result: Awaited<
    ReturnType<CollectionClickService['handleClick'] | CollectionClickService['handleScroll']>
  >
}

async function startMockProductServer() {
  const imageHits = new Map<string, number>()
  const server = createServer((request, response) => {
    const url = new URL(request.url ?? '/', 'http://127.0.0.1')

    if (url.pathname === '/goods/click') {
      sendHtml(
        response,
        productPage({
          title: 'Click product',
          imageAlt: 'Hero product',
          imagePath: '/images/click_thumb.png',
          fillerBefore: 0,
        }),
      )
      return
    }

    if (url.pathname === '/goods/scroll') {
      sendHtml(
        response,
        productPage({
          title: 'Scroll product',
          imageAlt: 'Scroll product',
          imagePath: '/images/scroll_thumb.png',
          fillerBefore: 1400,
        }),
      )
      return
    }

    if (url.pathname === '/goods/retry') {
      sendHtml(
        response,
        productPage({
          title: 'Retry product',
          imageAlt: 'Retry product',
          imagePath: '/images/flaky_thumb.png',
          fillerBefore: 1400,
        }),
      )
      return
    }

    if (url.pathname.startsWith('/images/')) {
      const hits = imageHits.get(url.pathname) ?? 0
      imageHits.set(url.pathname, hits + 1)
      if (url.pathname === '/images/flaky_original.png' && hits === 0) {
        sendText(response, 'temporary image failure', 500)
        return
      }
      sendPng(response, png)
      return
    }

    sendText(response, 'not found', 404)
  })

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') {
    throw new Error('mock product server did not expose a TCP port')
  }

  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    imageHits,
    close: () =>
      new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      ),
  }
}

function productPage(input: {
  title: string
  imageAlt: string
  imagePath: string
  fillerBefore: number
}) {
  const goodsPath =
    input.title === 'Retry product'
      ? '/goods/retry'
      : input.title === 'Scroll product'
        ? '/goods/scroll'
        : '/goods/click'

  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>${input.title}</title>
    <style>
      body { margin: 0; font-family: sans-serif; }
      .filler { height: ${input.fillerBefore}px; }
      a { display: block; width: 240px; margin: 24px; }
      img { display: block; width: 240px; height: 180px; object-fit: cover; }
    </style>
  </head>
  <body>
    <div class="filler"></div>
    <a href="${goodsPath}">
      <img alt="${input.imageAlt}" src="${input.imagePath}" width="240" height="180" />
    </a>
  </body>
</html>`
}

function sendHtml(response: ServerResponse, body: string) {
  response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
  response.end(body)
}

function sendPng(response: ServerResponse, body: Buffer) {
  response.writeHead(200, { 'content-type': 'image/png' })
  response.end(body)
}

function sendText(response: ServerResponse, body: string, status = 200) {
  response.writeHead(status, { 'content-type': 'text/plain; charset=utf-8' })
  response.end(body)
}

function platformRule(baseUrl: string): CollectionPlatformRule {
  return {
    key: 'temu',
    name: 'Temu mock',
    allowed_domains: ['127.0.0.1'],
    entry_url: baseUrl,
    goods_url_patterns: ['/goods/'],
    login_check: { indicators: [] },
    original_image_resolver: {
      type: 'src_replace',
      config: { from: '_thumb', to: '_original' },
    },
  }
}

async function createRuntime(input: {
  tempRoot: string
  mode: 'click' | 'scroll'
  profileId?: string
  browser?: Browser
  locks?: BrowserProfileLockManager
}) {
  const workbenchRoot = join(input.tempRoot, `workbench-${input.profileId ?? input.mode}`)
  const outputDir = join(workbenchRoot, '01-采集')
  await mkdir(join(workbenchRoot, '.workbench'), { recursive: true })
  await mkdir(outputDir, { recursive: true })

  const browser = input.browser ?? (await chromium.launch({ headless: true, channel: 'chrome' }))
  const bitBrowserCalls = { opened: [] as string[], closed: [] as string[] }
  const cdp = new CDPClient({
    bitBrowser: {
      openProfile: async (profileId) => {
        bitBrowserCalls.opened.push(profileId)
        return {
          http: `http://mock-cdp/${profileId}`,
          ws: `ws://mock-cdp/${profileId}`,
        }
      },
      closeProfile: async (profileId) => {
        bitBrowserCalls.closed.push(profileId)
      },
    },
    chromium: {
      connectOverCDP: async () => browser,
    },
  })

  let recordIndex = 0
  const manager = new CollectionSessionManager({
    readConfig: async () => ({ workbench_root: workbenchRoot }) as never,
    cdp,
    locks: input.locks ?? new BrowserProfileLockManager(),
    randomId: () => `session-${input.profileId ?? input.mode}`,
    now: () => 1_779_610_000_000,
  })
  const service = new CollectionClickService({
    sessionManager: manager,
    randomId: () => `record-${++recordIndex}`,
    now: () => 1_779_610_000_000 + recordIndex,
  })

  await manager.startSession({
    platform: 'temu',
    profile_id: input.profileId ?? `profile-${input.mode}`,
    mode: input.mode,
    output_dir: outputDir,
  })

  return {
    browser,
    cdp,
    manager,
    service,
    workbenchRoot,
    outputDir,
    bitBrowserCalls,
  } satisfies Runtime
}

async function wireCollectionPage(input: {
  page: Page
  runtime: Runtime
  rule: CollectionPlatformRule
  mode: 'click' | 'scroll'
}) {
  const results: CapturedResult[] = []
  await input.runtime.cdp.injectPageScript(input.page, {
    script: createCollectionInjectedScript({ platformRule: input.rule }),
    onEvent: async (payload) => {
      if (payload.kind !== input.mode || !payload.img) {
        return
      }
      if (payload.kind === 'click') {
        const result = await input.runtime.service.handleClick(
          {
            kind: 'click',
            img: payload.img,
            page: payload.page,
            ...(payload.goodsLink ? { goodsLink: payload.goodsLink } : {}),
            ...(typeof payload.platform === 'string' ? { platform: payload.platform } : {}),
          },
          input.rule,
        )
        results.push({ payload, result })
        return
      }
      const result = await input.runtime.service.handleScroll(
        {
          kind: 'scroll',
          img: payload.img,
          page: payload.page,
          ...(payload.goodsLink ? { goodsLink: payload.goodsLink } : {}),
          ...(typeof payload.platform === 'string' ? { platform: payload.platform } : {}),
          ...(typeof payload.width === 'number' ? { width: payload.width } : {}),
          ...(typeof payload.height === 'number' ? { height: payload.height } : {}),
        },
        input.rule,
      )
      results.push({ payload, result })
    },
  })
  return results
}

async function sendVisibleScrollImage(page: Page, imageName: string) {
  await page.getByRole('img', { name: imageName }).scrollIntoViewIfNeeded()
  await page.evaluate((name) => {
    const img = document.querySelector(`img[alt="${name}"]`) as HTMLImageElement | null
    if (!img) {
      throw new Error(`image not found: ${name}`)
    }
    const anchor = img.closest('a[href]') as HTMLAnchorElement | null
    const source = img.currentSrc || img.src
    const payload = {
      kind: 'scroll',
      img: new URL(source.replace('_thumb', '_original'), window.location.href).toString(),
      goodsLink: anchor?.href,
      page: window.location.href,
      width: img.naturalWidth || img.width || 0,
      height: img.naturalHeight || img.height || 0,
    }
    void window.__poseidonSendToHost(payload)
  }, imageName)
}

test.describe('collection module E2E', () => {
  let tempRoot = ''
  let mockServer: Awaited<ReturnType<typeof startMockProductServer>> | null = null
  const browsers: Browser[] = []

  test.beforeEach(async () => {
    tempRoot = await mkdtemp(join(tmpdir(), 'tengyu-collection-e2e-'))
    mockServer = await startMockProductServer()
  })

  test.afterEach(async () => {
    await Promise.all(browsers.map((browser) => browser.close().catch(() => null)))
    browsers.length = 0
    await mockServer?.close().catch(() => null)
    mockServer = null
    await rm(tempRoot, { recursive: true, force: true })
  })

  test('collects clicked product images after SKU assignment and skips duplicates', async () => {
    if (!mockServer) {
      throw new Error('mock server missing')
    }
    const runtime = await createRuntime({ tempRoot, mode: 'click', profileId: 'profile-click' })
    browsers.push(runtime.browser)
    const rule = platformRule(mockServer.baseUrl)
    const page = await runtime.browser.newPage()
    const results = await wireCollectionPage({ page, runtime, rule, mode: 'click' })

    await page.goto(`${mockServer.baseUrl}/goods/click`)
    const productLink = page.getByRole('link', { name: 'Hero product' })
    await expect(productLink).toHaveAttribute('href', '/goods/click')
    await productLink.click()

    await expect.poll(() => results.length).toBe(1)
    expect(results[0]?.result).toEqual({
      status: 'pending_sku',
      goodsLink: `${mockServer.baseUrl}/goods/click`,
    })

    const assigned = await runtime.service.assignSkuAndSavePending(
      `${mockServer.baseUrl}/goods/click`,
      'SKU-CLICK',
    )
    expect(assigned.results[0]).toMatchObject({
      status: 'success',
      savedPath: join(runtime.outputDir, 'SKU-CLICK', 'SKU-CLICK-001.png'),
    })
    await expect(
      readFile(join(runtime.outputDir, 'SKU-CLICK', 'SKU-CLICK-001.png')),
    ).resolves.toEqual(png)

    await productLink.click()
    await expect.poll(() => results.length).toBe(2)
    expect(results[1]?.result).toMatchObject({
      status: 'skipped',
      savedPath: join(runtime.outputDir, 'SKU-CLICK', 'SKU-CLICK-001.png'),
      reason: 'dedup',
    })
    expect(runtime.bitBrowserCalls.opened).toEqual(['profile-click'])
    expect(runtime.cdp.getCachedEndpoint('profile-click')).toBe('http://mock-cdp/profile-click')
  })

  test('collects visible images while scrolling into the loose image pool', async () => {
    if (!mockServer) {
      throw new Error('mock server missing')
    }
    const runtime = await createRuntime({ tempRoot, mode: 'scroll', profileId: 'profile-scroll' })
    browsers.push(runtime.browser)
    const rule = platformRule(mockServer.baseUrl)
    const page = await runtime.browser.newPage()
    await page.setViewportSize({ width: 800, height: 600 })
    const results = await wireCollectionPage({ page, runtime, rule, mode: 'scroll' })

    await page.goto(`${mockServer.baseUrl}/goods/scroll`)
    await sendVisibleScrollImage(page, 'Scroll product')

    await expect.poll(() => results.length).toBe(1)
    expect(results[0]?.result).toMatchObject({
      status: 'success',
      savedPath: expect.stringContaining(join('01-采集', '散图池')),
    })
    const savedPath = results[0]?.result.status === 'success' ? results[0].result.savedPath : ''
    await expect(readFile(savedPath)).resolves.toEqual(png)
  })

  test('records failed downloads and retries the failed record successfully', async () => {
    if (!mockServer) {
      throw new Error('mock server missing')
    }
    const runtime = await createRuntime({ tempRoot, mode: 'scroll', profileId: 'profile-retry' })
    browsers.push(runtime.browser)
    const rule = platformRule(mockServer.baseUrl)
    const page = await runtime.browser.newPage()
    await page.setViewportSize({ width: 800, height: 600 })
    const results = await wireCollectionPage({ page, runtime, rule, mode: 'scroll' })

    await page.goto(`${mockServer.baseUrl}/goods/retry`)
    await sendVisibleScrollImage(page, 'Retry product')

    await expect.poll(() => results.length).toBe(1)
    expect(results[0]?.result).toMatchObject({
      status: 'failed',
      error: '下载采集原图失败',
    })

    const failed = runtime.service.listRecords({
      sessionId: 'session-profile-retry',
      status: 'failed',
      limit: 10,
    })
    expect(failed).toHaveLength(1)

    await expect(runtime.service.retryRecord(failed[0]?.id ?? '')).resolves.toMatchObject({
      status: 'success',
      savedPath: expect.stringContaining(join('01-采集', '散图池')),
    })
    expect(mockServer.imageHits.get('/images/flaky_original.png')).toBe(2)
  })

  test('rejects profile lock competition for two collection sessions', async () => {
    const locks = new BrowserProfileLockManager()
    const browser = await chromium.launch({ headless: true, channel: 'chrome' })
    browsers.push(browser)
    const first = await createRuntime({
      tempRoot,
      mode: 'click',
      profileId: 'shared-profile',
      browser,
      locks,
    })

    await expect(
      createRuntime({
        tempRoot,
        mode: 'scroll',
        profileId: 'shared-profile',
        browser,
        locks,
      }),
    ).rejects.toMatchObject({
      code: 'PROFILE_LOCKED',
      details: {
        kind: 'resource_lock',
        profileId: 'shared-profile',
        module: 'collection',
        taskId: 'session-shared-profile',
      },
    })

    await first.manager.stopSession()
  })
})
