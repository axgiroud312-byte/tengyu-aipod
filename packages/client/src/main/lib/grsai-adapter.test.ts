import type { AppErrorClass } from '@tengyu-aipod/shared'
import { http, HttpResponse } from 'msw'
import { setupServer } from 'msw/node'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import {
  GRSAI_SUPPORTED_MODELS,
  type GenerateRequest,
  GrsaiAdapter,
  grsaiBaseUrl,
} from './grsai-adapter'

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

function request(overrides: Partial<GenerateRequest> = {}): GenerateRequest {
  return {
    capability: 'txt2img',
    prompt: '生成一张复古花朵印花',
    output: {
      aspect_ratio: '1024x1024',
    },
    ...overrides,
  }
}

function succeededResponse(url = 'https://file.example/test.png') {
  return {
    id: 'task_1',
    status: 'succeeded',
    progress: 100,
    results: [{ url }],
    error: '',
  }
}

describe('GrsaiAdapter', () => {
  it('sends json generation requests to the cn node by default', async () => {
    let requestBody: unknown = null
    let authorization: string | null = null
    server.use(
      http.post(`${grsaiBaseUrl('cn')}/v1/api/generate`, async ({ request }) => {
        requestBody = await request.json()
        authorization = request.headers.get('authorization')
        return HttpResponse.json(succeededResponse())
      }),
    )
    const adapter = new GrsaiAdapter('sk-test')

    await expect(
      adapter.generate(
        request({
          reference_images: [
            { base64: 'data:image/png;base64,iVBORw0KGgo=', mime_type: 'image/png' },
          ],
        }),
      ),
    ).resolves.toMatchObject({
      status: 'succeeded',
      images: [{ url: 'https://file.example/test.png' }],
    })
    expect(authorization).toBe('Bearer sk-test')
    expect(requestBody).toMatchObject({
      model: 'gpt-image-2',
      prompt: '生成一张复古花朵印花',
      images: ['iVBORw0KGgo='],
      aspectRatio: '1024x1024',
      replyType: 'json',
    })
  })

  it('passes all supported model values through unchanged', async () => {
    const seenModels: string[] = []
    server.use(
      http.post(`${grsaiBaseUrl('cn')}/v1/api/generate`, async ({ request }) => {
        const body = (await request.json()) as { model: string }
        seenModels.push(body.model)
        return HttpResponse.json(succeededResponse(`https://file.example/${body.model}.png`))
      }),
    )
    const adapter = new GrsaiAdapter('sk-test', 'cn', { retries: 0 })

    for (const model of GRSAI_SUPPORTED_MODELS) {
      await adapter.generate(request({ model }))
    }

    expect(seenModels).toEqual([...GRSAI_SUPPORTED_MODELS])
  })

  it('caps configured retry count at ten', () => {
    expect(new GrsaiAdapter('sk-test', 'cn', { retries: 99 })).toHaveProperty('retries', 10)
  })

  it('falls back to the other node for retryable node failures', async () => {
    const calls: string[] = []
    server.use(
      http.post(`${grsaiBaseUrl('cn')}/v1/api/generate`, () => {
        calls.push('cn')
        return HttpResponse.json({ error: 'bad gateway' }, { status: 502 })
      }),
      http.post(`${grsaiBaseUrl('global')}/v1/api/generate`, () => {
        calls.push('global')
        return HttpResponse.json(succeededResponse('https://file.example/global.png'))
      }),
    )
    const adapter = new GrsaiAdapter('sk-test')

    await expect(adapter.generate(request())).resolves.toMatchObject({
      status: 'succeeded',
      images: [{ url: 'https://file.example/global.png' }],
    })
    expect(calls).toEqual(['cn', 'global'])
  })

  it('returns violation responses without throwing or retrying', async () => {
    server.use(
      http.post(`${grsaiBaseUrl('cn')}/v1/api/generate`, () =>
        HttpResponse.json({
          id: 'task_1',
          status: 'violation',
          results: [],
          error: 'content policy violation',
        }),
      ),
      http.post(`${grsaiBaseUrl('global')}/v1/api/generate`, () => {
        throw new Error('unexpected fallback')
      }),
    )
    const adapter = new GrsaiAdapter('sk-test')

    await expect(adapter.generate(request())).resolves.toMatchObject({
      status: 'violation',
      images: [],
      error: {
        code: 'GRSAI_VIOLATION',
        retryable: false,
      },
    })
  })

  it('falls back to the other node for failed application outcomes', async () => {
    const calls: string[] = []
    server.use(
      http.post(`${grsaiBaseUrl('cn')}/v1/api/generate`, () => {
        calls.push('cn')
        return HttpResponse.json({
          id: 'task_1',
          status: 'failed',
          results: [],
          error: 'generation failed',
        })
      }),
      http.post(`${grsaiBaseUrl('global')}/v1/api/generate`, () => {
        calls.push('global')
        return HttpResponse.json(succeededResponse('https://file.example/global-after-failed.png'))
      }),
    )
    const adapter = new GrsaiAdapter('sk-test')

    await expect(adapter.generate(request())).resolves.toMatchObject({
      status: 'succeeded',
      images: [{ url: 'https://file.example/global-after-failed.png' }],
    })
    expect(calls).toEqual(['cn', 'global'])
  })

  it('polls async tasks until they finish', async () => {
    const pollStatuses = ['running', 'succeeded']
    server.use(
      http.post(`${grsaiBaseUrl('global')}/v1/api/generate`, async ({ request }) => {
        expect(await request.json()).toMatchObject({ replyType: 'async' })
        return HttpResponse.json({
          id: 'task_async',
          status: 'running',
          progress: 0,
          results: [],
          error: '',
        })
      }),
      http.get(`${grsaiBaseUrl('global')}/v1/api/result`, ({ request }) => {
        expect(new URL(request.url).searchParams.get('id')).toBe('task_async')
        const status = pollStatuses.shift()
        if (status === 'succeeded') {
          return HttpResponse.json(succeededResponse('https://file.example/async.png'))
        }
        return HttpResponse.json({
          id: 'task_async',
          status: 'running',
          progress: 50,
          results: [],
          error: '',
        })
      }),
    )
    const adapter = new GrsaiAdapter('sk-test', 'global', { pollIntervalMs: 1 })

    await expect(
      adapter.generate(request({ options: { replyType: 'async' } })),
    ).resolves.toMatchObject({
      status: 'succeeded',
      images: [{ url: 'https://file.example/async.png' }],
    })
  })

  it('parses stream responses from data events', async () => {
    let requestBody: unknown = null
    server.use(
      http.post(`${grsaiBaseUrl('cn')}/v1/api/generate`, async ({ request }) => {
        requestBody = await request.json()
        return new HttpResponse(
          [
            'data: {"id":"task_stream","status":"running","progress":20,"results":[]}',
            '',
            'data: {"id":"task_stream","status":"succeeded","progress":100,"results":[{"url":"https://file.example/stream.png"}],"error":""}',
            '',
            'data: [DONE]',
            '',
          ].join('\n'),
          {
            headers: { 'content-type': 'text/event-stream' },
          },
        )
      }),
    )
    const adapter = new GrsaiAdapter('sk-test')

    await expect(
      adapter.generate(request({ options: { replyType: 'stream' } })),
    ).resolves.toMatchObject({
      status: 'succeeded',
      images: [{ url: 'https://file.example/stream.png' }],
    })
    expect(requestBody).toMatchObject({ replyType: 'stream' })
  })

  it('sends gpt-image-2 img2img requests to the native generate endpoint', async () => {
    let requestBody: unknown = null
    server.use(
      http.post(`${grsaiBaseUrl('cn')}/v1/api/generate`, async ({ request }) => {
        requestBody = await request.json()
        return HttpResponse.json(succeededResponse('https://file.example/gpt-image.png'))
      }),
    )
    const adapter = new GrsaiAdapter('sk-test', 'cn')

    await expect(
      adapter.generate(
        request({
          capability: 'img2img',
          model: 'gpt-image-2',
          reference_images: [
            { base64: 'data:image/png;base64,iVBORw0KGgo=', mime_type: 'image/png' },
          ],
          output: { aspect_ratio: '1536x1024' },
        }),
      ),
    ).resolves.toMatchObject({
      status: 'succeeded',
      images: [{ url: 'https://file.example/gpt-image.png' }],
    })
    expect(requestBody).toEqual({
      model: 'gpt-image-2',
      prompt: '生成一张复古花朵印花',
      images: ['iVBORw0KGgo='],
      aspectRatio: '1536x1024',
      replyType: 'json',
    })
  })

  it('keeps gpt-image-2-vip on the native generate endpoint', async () => {
    let requestBody: Record<string, unknown> | null = null
    server.use(
      http.post(`${grsaiBaseUrl('cn')}/v1/api/generate`, async ({ request }) => {
        requestBody = (await request.json()) as Record<string, unknown>
        return HttpResponse.json(succeededResponse('https://file.example/gpt-image-vip.png'))
      }),
    )
    const adapter = new GrsaiAdapter('sk-test', 'cn')

    await expect(
      adapter.generate(
        request({
          model: 'gpt-image-2-vip',
          output: { aspect_ratio: '2048x2048' },
        }),
      ),
    ).resolves.toMatchObject({
      status: 'succeeded',
      images: [{ url: 'https://file.example/gpt-image-vip.png' }],
    })
    expect(requestBody).toMatchObject({
      model: 'gpt-image-2-vip',
      aspectRatio: '2048x2048',
      images: [],
      replyType: 'json',
    })
    expect(requestBody).not.toHaveProperty('imageSize')
  })

  it('throws transport errors as retryable AppError after fallback also fails', async () => {
    server.use(
      http.post(`${grsaiBaseUrl('cn')}/v1/api/generate`, () =>
        HttpResponse.json({ error: 'bad gateway' }, { status: 502 }),
      ),
      http.post(`${grsaiBaseUrl('global')}/v1/api/generate`, () =>
        HttpResponse.json({ error: 'bad gateway' }, { status: 503 }),
      ),
    )
    const adapter = new GrsaiAdapter('sk-test', 'cn', { retries: 0 })

    await expect(adapter.generate(request())).rejects.toMatchObject({
      code: 'HTTP_5XX',
      retryable: true,
      details: {
        kind: 'network',
      },
    } satisfies Partial<AppErrorClass>)
  })
})
