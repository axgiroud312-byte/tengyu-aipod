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

  it('lists and deletes private images', async () => {
    let deleteBody: unknown = null
    server.use(
      http.get(`${CHENYU_BASE_URL}/image/private/list`, () =>
        ok({
          image_list: [{ uuid: 'img-1', title: 'My ComfyUI', save_image_status: 2 }],
          total: 1,
        }),
      ),
      http.post(`${CHENYU_BASE_URL}/image/private/delete`, async ({ request }) => {
        deleteBody = await request.json()
        return HttpResponse.json({ code: 0, msg: 'success' })
      }),
    )
    const client = new ChenyuCloudClient('cy-test')

    await expect(client.listPrivateImages()).resolves.toEqual({
      items: [{ uuid: 'img-1', title: 'My ComfyUI', save_image_status: 2 }],
      total: 1,
    })
    await expect(client.deletePrivateImage('img-1')).resolves.toEqual({ ok: true })
    expect(deleteBody).toEqual({ image_uuid: 'img-1' })
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

  it('creates by image and wraps new instance management actions', async () => {
    const requests: Array<{ path: string; body: unknown }> = []
    for (const path of [
      '/instance/create_by_image',
      '/instance/update_title',
      '/instance/set_idle_close',
      '/instance/save_image',
    ]) {
      server.use(
        http.post(`${CHENYU_BASE_URL}${path}`, async ({ request }) => {
          requests.push({ path, body: await request.json() })
          if (path === '/instance/create_by_image') {
            return ok({ instance_uuid: 'inst-image', status: ChenyuInstanceStatus.Initializing })
          }
          return HttpResponse.json({ code: 0, msg: 'success' })
        }),
      )
    }
    const client = new ChenyuCloudClient('cy-test')

    await expect(
      client.createByImage({ image_uuid: 'img-1', gpu_uuid: 'gpu-1' }),
    ).resolves.toMatchObject({ instance_uuid: 'inst-image', status: 1 })
    await client.updateTitle({ instance_uuid: 'inst-image', title: 'ComfyUI 生产实例' })
    await client.setIdleClose({ instance_uuid: 'inst-image', idle_period_minutes: 30 })
    await client.saveImage('inst-image')

    expect(requests).toEqual([
      {
        path: '/instance/create_by_image',
        body: { image_uuid: 'img-1', gpu_uuid: 'gpu-1', gpu_nums: 1 },
      },
      {
        path: '/instance/update_title',
        body: { instance_uuid: 'inst-image', title: 'ComfyUI 生产实例' },
      },
      {
        path: '/instance/set_idle_close',
        body: { instance_uuid: 'inst-image', idle_period_minutes: 30 },
      },
      { path: '/instance/save_image', body: { instance_uuid: 'inst-image' } },
    ])
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
          return HttpResponse.json({ code: 0, msg: 'success' })
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
    await expect(
      client.startup({ instance_uuid: 'inst-1', gpu_uuid: 'gpu-2', gpu_nums: 2 }),
    ).resolves.toEqual({ ok: true })
    await expect(client.shutdown('inst-1')).resolves.toEqual({ ok: true })
    await expect(client.restart('inst-1')).resolves.toEqual({ ok: true })
    await expect(
      client.setShutdownTimer({
        instance_uuid: 'inst-1',
        enable: true,
        shutdown_time: 1_703_232_000,
      }),
    ).resolves.toEqual({ ok: true })
    await expect(client.destroy('inst-1')).resolves.toEqual({ ok: true })

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

  it('wraps workflow market, details, submit, and execution endpoints', async () => {
    const calls: Array<{ path: string; query?: string; body?: unknown }> = []
    server.use(
      http.get(`${CHENYU_BASE_URL}/workflow/market/list`, ({ request }) => {
        const query = new URL(request.url).search
        calls.push({ path: '/workflow/market/list', query })
        return ok({
          items: [{ workflow_id: 'wf-1', revision_id: 'rev-1', title: '文生图' }],
          total: 1,
          page: 1,
          page_size: 20,
        })
      }),
      http.get(`${CHENYU_BASE_URL}/workflow/market/info`, ({ request }) => {
        calls.push({
          path: '/workflow/market/info',
          query: new URL(request.url).search,
        })
        return ok({
          workflow_id: 'wf-1',
          revision_id: 'rev-1',
          title: '文生图',
          editable_parameter_manifest: [{ key: 'n6_text', type: 'string' }],
          candidate_output_manifest: [{ key: 'n9_images', type: 'image' }],
        })
      }),
      http.post(`${CHENYU_BASE_URL}/workflow/run/submit`, async ({ request }) => {
        calls.push({ path: '/workflow/run/submit', body: await request.json() })
        return ok({ run_order_id: 'wfrun-1', workflow_id: 'wf-1', run_status: 'queued' })
      }),
      http.get(`${CHENYU_BASE_URL}/workflow/run/execution`, ({ request }) => {
        calls.push({
          path: '/workflow/run/execution',
          query: new URL(request.url).search,
        })
        return ok({
          task_id: 'task-1',
          workflow_id: 'wf-1',
          status: 'succeeded',
          progress_percent: 100,
          outputs: { n9_images: 'https://file.example/output.png' },
          error: null,
        })
      }),
    )
    const client = new ChenyuCloudClient('cy-test')

    await expect(client.listWorkflowMarket({ keyword: '文生图', page: 1 })).resolves.toMatchObject({
      items: [{ workflow_id: 'wf-1' }],
      total: 1,
    })
    await expect(client.getWorkflowMarketInfo('wf-1')).resolves.toMatchObject({
      workflow_id: 'wf-1',
      editable_parameter_manifest: [{ key: 'n6_text', type: 'string' }],
    })
    await expect(
      client.submitWorkflowRun({
        workflow_id: 'wf-1',
        revision_id: 'rev-1',
        inputs: { n6_text: 'prompt' },
        idempotency_key: 'idem-1',
      }),
    ).resolves.toMatchObject({ run_order_id: 'wfrun-1' })
    await expect(client.getWorkflowRunExecution('wfrun-1')).resolves.toMatchObject({
      status: 'succeeded',
      outputs: { n9_images: 'https://file.example/output.png' },
    })

    expect(calls).toEqual([
      { path: '/workflow/market/list', query: '?keyword=%E6%96%87%E7%94%9F%E5%9B%BE&page=1' },
      { path: '/workflow/market/info', query: '?workflow_id=wf-1' },
      {
        path: '/workflow/run/submit',
        body: {
          workflow_id: 'wf-1',
          revision_id: 'rev-1',
          inputs: { n6_text: 'prompt' },
          idempotency_key: 'idem-1',
        },
      },
      { path: '/workflow/run/execution', query: '?run_order_id=wfrun-1' },
    ])
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
    expect(chenyuStatusName(ChenyuInstanceStatus.Created)).toBe('created')
    expect(chenyuStatusName(ChenyuInstanceStatus.Initializing)).toBe('initializing')
    expect(chenyuStatusName(ChenyuInstanceStatus.Running)).toBe('running')
    expect(chenyuStatusName(ChenyuInstanceStatus.Stopping)).toBe('shutting_down')
    expect(chenyuStatusName(ChenyuInstanceStatus.ShuttingDown)).toBe('shutting_down')
    expect(chenyuStatusName(ChenyuInstanceStatus.StoppedLegacy)).toBe('stopped')
    expect(chenyuStatusName(ChenyuInstanceStatus.Stopped)).toBe('stopped')
    expect(chenyuStatusName(ChenyuInstanceStatus.AbnormalStopped)).toBe('abnormal_stopped')
    expect(chenyuStatusName(ChenyuInstanceStatus.Starting)).toBe('starting')
    expect(chenyuStatusName(ChenyuInstanceStatus.Restarting)).toBe('restarting')
    expect(chenyuStatusName(999)).toBe('unknown')
  })
})
