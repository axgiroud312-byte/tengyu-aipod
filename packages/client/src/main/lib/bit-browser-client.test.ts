import type { AppErrorClass } from '@tengyu-aipod/shared'
import { http, HttpResponse } from 'msw'
import { setupServer } from 'msw/node'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { BIT_BROWSER_DEFAULT_BASE_URL, BitBrowserClient } from './bit-browser-client'

const server = setupServer()

beforeAll(() => {
  server.listen({ onUnhandledRequest: 'error' })
})

afterEach(() => {
  server.resetHandlers()
})

afterAll(() => {
  server.close()
})

describe('BitBrowserClient', () => {
  it('lists profiles through the real BitBrowser browser/list contract', async () => {
    let body: unknown = null
    server.use(
      http.post(`${BIT_BROWSER_DEFAULT_BASE_URL}/browser/list`, async ({ request }) => {
        body = await request.json()
        return HttpResponse.json({
          success: true,
          data: {
            list: [
              {
                id: 'profile-1',
                name: 'Temu 主店',
                seq: 101,
                status: 1,
                platform: 'https://www.temu.com',
                url: 'https://www.temu.com',
                userName: 'hidden-user',
                password: 'hidden-password',
              },
            ],
          },
        })
      }),
    )

    const client = new BitBrowserClient()

    await expect(client.listProfiles()).resolves.toEqual([
      {
        id: 'profile-1',
        name: 'Temu 主店',
        seq: 101,
        status: 1,
        platform: 'https://www.temu.com',
        url: 'https://www.temu.com',
      },
    ])
    expect(body).toEqual({ page: 0, pageSize: 100 })
  })

  it('opens a profile and returns HTTP and WebSocket CDP endpoints', async () => {
    let body: unknown = null
    server.use(
      http.post(`${BIT_BROWSER_DEFAULT_BASE_URL}/browser/open`, async ({ request }) => {
        body = await request.json()
        return HttpResponse.json({
          success: true,
          data: {
            http: '127.0.0.1:9222',
            ws: 'ws://127.0.0.1:9222/devtools/browser/abc',
            debug_port: '9222',
            coreVersion: '120',
            driver: '/tmp/chromedriver',
          },
        })
      }),
    )

    const client = new BitBrowserClient()

    await expect(client.openProfile('profile-1')).resolves.toEqual({
      http: 'http://127.0.0.1:9222',
      ws: 'ws://127.0.0.1:9222/devtools/browser/abc',
      debugPort: 9222,
      coreVersion: '120',
      driverPath: '/tmp/chromedriver',
    })
    expect(body).toEqual({ id: 'profile-1' })
  })

  it('lists currently open profile ids through browser/pids/all', async () => {
    server.use(
      http.post(`${BIT_BROWSER_DEFAULT_BASE_URL}/browser/pids/all`, () =>
        HttpResponse.json({
          success: true,
          data: {
            'profile-1': 1234,
            'profile-2': 5678,
          },
        }),
      ),
    )

    const client = new BitBrowserClient()

    await expect(client.listOpenProfileIds()).resolves.toEqual(['profile-1', 'profile-2'])
  })

  it('reads CDP endpoints for already-open profiles through browser/ports', async () => {
    let body: unknown = null
    server.use(
      http.post(`${BIT_BROWSER_DEFAULT_BASE_URL}/browser/ports`, async ({ request }) => {
        body = await request.json()
        return HttpResponse.json({
          success: true,
          data: {
            http: '127.0.0.1:9333',
            ws: 'ws://127.0.0.1:9333/devtools/browser/open',
            debug_port: 9333,
          },
        })
      }),
    )

    const client = new BitBrowserClient()

    await expect(client.getCdpEndpoint('profile-open')).resolves.toEqual({
      http: 'http://127.0.0.1:9333',
      ws: 'ws://127.0.0.1:9333/devtools/browser/open',
      debugPort: 9333,
    })
    expect(body).toEqual({ id: 'profile-open' })
  })

  it('reads already-open profile CDP ports when BitBrowser returns a profile-id map', async () => {
    server.use(
      http.post(`${BIT_BROWSER_DEFAULT_BASE_URL}/browser/ports`, () =>
        HttpResponse.json({
          success: true,
          data: {
            'profile-open': '9333',
          },
        }),
      ),
    )

    const client = new BitBrowserClient()

    await expect(client.getCdpEndpoint('profile-open')).resolves.toEqual({
      http: 'http://127.0.0.1:9333',
      ws: '',
      debugPort: 9333,
    })
  })

  it('closes a profile through browser/close', async () => {
    let body: unknown = null
    server.use(
      http.post(`${BIT_BROWSER_DEFAULT_BASE_URL}/browser/close`, async ({ request }) => {
        body = await request.json()
        return HttpResponse.json({ success: true, data: {} })
      }),
    )

    const client = new BitBrowserClient()

    await expect(client.closeProfile('profile-1')).resolves.toBeUndefined()
    expect(body).toEqual({ id: 'profile-1' })
  })

  it('reads profile status through browser/detail', async () => {
    server.use(
      http.post(`${BIT_BROWSER_DEFAULT_BASE_URL}/browser/detail`, () =>
        HttpResponse.json({
          success: true,
          data: {
            id: 'profile-1',
            name: 'Temu 主店',
            status: 0,
            remark: '备用',
          },
        }),
      ),
    )

    const client = new BitBrowserClient()

    await expect(client.getProfileStatus('profile-1')).resolves.toEqual({
      id: 'profile-1',
      name: 'Temu 主店',
      status: 0,
      remark: '备用',
    })
  })

  it('maps local connection failures to BROWSER_NOT_CONNECTED', async () => {
    server.use(
      http.post(`${BIT_BROWSER_DEFAULT_BASE_URL}/browser/list`, () => HttpResponse.error()),
    )

    const client = new BitBrowserClient()

    await expect(client.listProfiles()).rejects.toMatchObject({
      code: 'BROWSER_NOT_CONNECTED',
      retryable: true,
      details: {
        kind: 'network',
        provider: 'bit-browser',
        path: '/browser/list',
      },
    } satisfies Partial<AppErrorClass>)
  })

  it('maps missing profiles to PROFILE_NOT_FOUND', async () => {
    server.use(
      http.post(`${BIT_BROWSER_DEFAULT_BASE_URL}/browser/open`, () =>
        HttpResponse.json({ success: false, msg: 'browser not found' }),
      ),
    )

    const client = new BitBrowserClient()

    await expect(client.openProfile('missing')).rejects.toMatchObject({
      code: 'PROFILE_NOT_FOUND',
      retryable: false,
      details: {
        kind: 'failed',
        provider: 'bit-browser',
        profileId: 'missing',
      },
    } satisfies Partial<AppErrorClass>)
  })

  it('rejects open responses without both CDP endpoints', async () => {
    server.use(
      http.post(`${BIT_BROWSER_DEFAULT_BASE_URL}/browser/open`, () =>
        HttpResponse.json({ success: true, data: { http: '127.0.0.1:9222' } }),
      ),
    )

    const client = new BitBrowserClient()

    await expect(client.openProfile('profile-1')).rejects.toMatchObject({
      code: 'HTTP_5XX',
      retryable: true,
      details: {
        kind: 'protocol',
        provider: 'bit-browser',
        profileId: 'profile-1',
      },
    } satisfies Partial<AppErrorClass>)
  })
})
