import type { AppErrorClass } from '@tengyu-aipod/shared'
import { http, HttpResponse } from 'msw'
import { setupServer } from 'msw/node'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import {
  CHENYU_BASE_URL,
  ChenyuCloudClient,
  ChenyuInstanceStatus,
  chenyuStatusName,
} from './chenyu-cloud-client'

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

function ok<T>(data: T) {
  return HttpResponse.json({ code: 0, msg: '成功', data })
}

describe('ChenyuCloudClient', () => {
  it('sends bearer auth and lists pods with query params', async () => {
    let authorization: string | null = null
    let query = ''
    server.use(
      http.get(`${CHENYU_BASE_URL}/pod/list`, ({ request }) => {
        authorization = request.headers.get('authorization')
        const url = new URL(request.url)
        query = url.search
        return ok({
          pod_list: [{ title: 'ComfyUI Default', uuid: 'pod-1' }],
          total: 1,
        })
      }),
    )
    const client = new ChenyuCloudClient('cy-test')

    await expect(client.listPods({ page: 2, page_size: 10, name: 'ComfyUI' })).resolves.toEqual({
      items: [{ title: 'ComfyUI Default', uuid: 'pod-1' }],
      total: 1,
    })
    expect(authorization).toBe('Bearer cy-test')
    expect(query).toBe('?page=2&page_size=10&name=ComfyUI')
  })

  it('lists gpus, images, and instances through their documented endpoints', async () => {
    const calls: string[] = []
    server.use(
      http.get(`${CHENYU_BASE_URL}/gpu/list`, () => {
        calls.push('/gpu/list')
        return ok({ gpu_list: [{ gpu_name: 'RTX 4090', gpu_uuid: 'gpu-1', status: 1 }], total: 1 })
      }),
      http.get(`${CHENYU_BASE_URL}/image/market/list`, () => {
        calls.push('/image/market/list')
        return ok({ image_list: [{ image_uuid: 'image-1' }], total: 1 })
      }),
      http.get(`${CHENYU_BASE_URL}/instance/list`, () => {
        calls.push('/instance/list')
        return ok({ instance_list: [{ instance_uuid: 'inst-1', status: 2 }], total: 1 })
      }),
    )
    const client = new ChenyuCloudClient('cy-test')

    await expect(client.listGpus()).resolves.toMatchObject({
      items: [{ gpu_uuid: 'gpu-1' }],
      total: 1,
    })
    await expect(client.listImages()).resolves.toMatchObject({
      items: [{ image_uuid: 'image-1' }],
      total: 1,
    })
    await expect(client.listInstances()).resolves.toMatchObject({
      items: [{ instance_uuid: 'inst-1' }],
      total: 1,
    })
    expect(calls).toEqual(['/gpu/list', '/image/market/list', '/instance/list'])
  })

  it('creates by pod and defaults gpu_nums to 1', async () => {
    let body: unknown = null
    server.use(
      http.post(`${CHENYU_BASE_URL}/instance/create_by_pod`, async ({ request }) => {
        body = await request.json()
        return ok({ instance_uuid: 'inst-1', status: ChenyuInstanceStatus.Initializing })
      }),
    )
    const client = new ChenyuCloudClient('cy-test')

    await expect(
      client.createByPod({ pod_uuid: 'pod-1', pod_tag: 'latest', gpu_uuid: 'gpu-1' }),
    ).resolves.toMatchObject({ instance_uuid: 'inst-1', status: 1 })
    expect(body).toEqual({
      pod_uuid: 'pod-1',
      pod_tag: 'latest',
      gpu_uuid: 'gpu-1',
      gpu_nums: 1,
    })
  })

  it('wraps instance lifecycle endpoints', async () => {
    const requests: Array<{ path: string; body: unknown }> = []
    for (const path of [
      '/instance/startup',
      '/instance/shutdown',
      '/instance/restart',
      '/instance/shutdown_timer',
      '/instance/destroy',
    ]) {
      server.use(
        http.post(`${CHENYU_BASE_URL}${path}`, async ({ request }) => {
          requests.push({ path, body: await request.json() })
          return ok({ instance_uuid: 'inst-1', status: ChenyuInstanceStatus.Running })
        }),
      )
    }
    server.use(
      http.get(`${CHENYU_BASE_URL}/instance/info`, ({ request }) => {
        expect(new URL(request.url).searchParams.get('instance_uuid')).toBe('inst-1')
        return ok({
          instance_uuid: 'inst-1',
          status: ChenyuInstanceStatus.Running,
          server_map: [{ title: 'ComfyUI', port_type: 'http', url: 'https://comfy.example' }],
        })
      }),
    )
    const client = new ChenyuCloudClient('cy-test')

    await expect(client.getInstanceInfo('inst-1')).resolves.toMatchObject({
      instance_uuid: 'inst-1',
      server_map: [{ url: 'https://comfy.example' }],
    })
    await client.startup({ instance_uuid: 'inst-1', gpu_uuid: 'gpu-2', gpu_nums: 2 })
    await client.shutdown('inst-1')
    await client.restart('inst-1')
    await client.setShutdownTimer({
      instance_uuid: 'inst-1',
      enable: true,
      shutdown_time: 1_703_232_000,
    })
    await client.destroy('inst-1')

    expect(requests).toEqual([
      {
        path: '/instance/startup',
        body: { instance_uuid: 'inst-1', gpu_uuid: 'gpu-2', gpu_nums: 2 },
      },
      { path: '/instance/shutdown', body: { instance_uuid: 'inst-1' } },
      { path: '/instance/restart', body: { instance_uuid: 'inst-1' } },
      {
        path: '/instance/shutdown_timer',
        body: { instance_uuid: 'inst-1', enable: true, shutdown_time: 1_703_232_000 },
      },
      { path: '/instance/destroy', body: { instance_uuid: 'inst-1' } },
    ])
  })

  it('gets balance info', async () => {
    server.use(
      http.get(`${CHENYU_BASE_URL}/balance/info`, () => ok({ balance: 1250.5, card_balance: 500 })),
    )
    const client = new ChenyuCloudClient('cy-test')

    await expect(client.getBalance()).resolves.toEqual({ balance: 1250.5, card_balance: 500 })
  })

  it('throws non-zero business code responses as AppError', async () => {
    server.use(
      http.get(`${CHENYU_BASE_URL}/balance/info`, () =>
        HttpResponse.json({ code: 1001, msg: '余额不足', data: null }),
      ),
    )
    const client = new ChenyuCloudClient('cy-test')

    await expect(client.getBalance()).rejects.toMatchObject({
      code: 'HTTP_4XX',
      retryable: false,
      details: {
        provider: 'comfyui-chenyu',
        chenyuCode: 1001,
        message: '余额不足',
      },
    } satisfies Partial<AppErrorClass>)
  })

  it('retries 429 responses with Retry-After delay', async () => {
    const sleeps: number[] = []
    let calls = 0
    server.use(
      http.get(`${CHENYU_BASE_URL}/balance/info`, () => {
        calls += 1
        if (calls === 1) {
          return HttpResponse.json(
            { code: 429, msg: 'rate limited' },
            { status: 429, headers: { 'Retry-After': '2' } },
          )
        }
        return ok({ balance: 1, card_balance: 2 })
      }),
    )
    const client = new ChenyuCloudClient('cy-test', {
      sleep: async (ms) => {
        sleeps.push(ms)
      },
    })

    await expect(client.getBalance()).resolves.toEqual({ balance: 1, card_balance: 2 })
    expect(calls).toBe(2)
    expect(sleeps).toEqual([2000])
  })

  it('maps auth and server errors', async () => {
    server.use(
      http.get(`${CHENYU_BASE_URL}/balance/info`, () =>
        HttpResponse.json({ msg: 'unauthorized' }, { status: 401 }),
      ),
    )
    const client = new ChenyuCloudClient('cy-test')

    await expect(client.getBalance()).rejects.toMatchObject({
      code: 'HTTP_4XX',
      retryable: false,
      details: {
        provider: 'comfyui-chenyu',
        status: 401,
      },
    } satisfies Partial<AppErrorClass>)

    server.use(
      http.get(`${CHENYU_BASE_URL}/balance/info`, () =>
        HttpResponse.json({ msg: 'bad gateway' }, { status: 500 }),
      ),
    )
    const retryless = new ChenyuCloudClient('cy-test', { maxRetries: 0 })

    await expect(retryless.getBalance()).rejects.toMatchObject({
      code: 'HTTP_5XX',
      retryable: true,
      details: {
        provider: 'comfyui-chenyu',
        status: 500,
      },
    } satisfies Partial<AppErrorClass>)
  })

  it('maps instance status codes to stable names', () => {
    expect(chenyuStatusName(ChenyuInstanceStatus.Initializing)).toBe('initializing')
    expect(chenyuStatusName(ChenyuInstanceStatus.Running)).toBe('running')
    expect(chenyuStatusName(ChenyuInstanceStatus.ShuttingDown)).toBe('shutting_down')
    expect(chenyuStatusName(ChenyuInstanceStatus.Stopped)).toBe('stopped')
    expect(chenyuStatusName(999)).toBe('unknown')
  })
})
