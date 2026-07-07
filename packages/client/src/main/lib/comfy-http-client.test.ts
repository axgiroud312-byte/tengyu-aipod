import type { AppErrorClass } from '@tengyu-aipod/shared'
import { http, HttpResponse } from 'msw'
import { setupServer } from 'msw/node'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { ComfyHttpClient } from './comfy-http-client'

const server = setupServer()
const baseUrl = 'https://comfy.example'

beforeAll(() => {
  server.listen({ onUnhandledRequest: 'error' })
})

afterEach(() => {
  server.resetHandlers()
})

afterAll(() => {
  server.close()
})

describe('ComfyHttpClient', () => {
  it('uploads images and returns the ComfyUI filename', async () => {
    let contentType: string | null = null
    let bodyText = ''
    server.use(
      http.post(`${baseUrl}/upload/image`, async ({ request }) => {
        contentType = request.headers.get('content-type')
        bodyText = await request.text()
        return HttpResponse.json({
          name: 'source.png',
          subfolder: '',
          type: 'input',
        })
      }),
    )
    const client = new ComfyHttpClient(baseUrl)

    await expect(client.uploadImage(Buffer.from('image-bytes'), 'source.png')).resolves.toBe(
      'source.png',
    )
    expect(contentType).toContain('multipart/form-data')
    expect(bodyText).toContain('source.png')
  })

  it('queues prompts and returns prompt_id', async () => {
    let body: unknown = null
    server.use(
      http.post(`${baseUrl}/prompt`, async ({ request }) => {
        body = await request.json()
        return HttpResponse.json({
          prompt_id: 'prompt-1',
          number: 1,
          node_errors: {},
        })
      }),
    )
    const client = new ComfyHttpClient(baseUrl)

    await expect(client.queuePrompt({ '1': { inputs: { text: 'print' } } })).resolves.toBe(
      'prompt-1',
    )
    expect(body).toEqual({
      prompt: {
        '1': { inputs: { text: 'print' } },
      },
    })
  })

  it('queues prompts with workflow png metadata when provided', async () => {
    let body: unknown = null
    server.use(
      http.post(`${baseUrl}/prompt`, async ({ request }) => {
        body = await request.json()
        return HttpResponse.json({
          prompt_id: 'prompt-1',
          number: 1,
          node_errors: {},
        })
      }),
    )
    const client = new ComfyHttpClient(baseUrl)

    await expect(
      client.queuePrompt(
        { '1': { inputs: { text: 'print' } } },
        { extraPngInfo: { workflow: { nodes: [{ id: 1, type: 'CLIPTextEncode' }] } } },
      ),
    ).resolves.toBe('prompt-1')
    expect(body).toEqual({
      prompt: {
        '1': { inputs: { text: 'print' } },
      },
      extra_data: {
        extra_pnginfo: {
          workflow: { nodes: [{ id: 1, type: 'CLIPTextEncode' }] },
        },
      },
    })
  })

  it('polls history until the prompt is completed', async () => {
    const statuses = [false, true]
    server.use(
      http.get(`${baseUrl}/history/prompt-1`, () => {
        const completed = statuses.shift()
        return HttpResponse.json({
          'prompt-1': {
            status: { completed },
            outputs: completed ? { '9': { images: [{ filename: 'result.png' }] } } : {},
          },
        })
      }),
    )
    const client = new ComfyHttpClient(baseUrl, { pollIntervalMs: 1 })

    await expect(client.getHistory('prompt-1')).resolves.toMatchObject({
      status: { completed: true },
      outputs: { '9': { images: [{ filename: 'result.png' }] } },
    })
  })

  it('surfaces ComfyUI execution errors instead of waiting for timeout', async () => {
    server.use(
      http.get(`${baseUrl}/history/prompt-1`, () =>
        HttpResponse.json({
          'prompt-1': {
            status: {
              completed: false,
              status_str: 'error',
              messages: [
                [
                  'execution_error',
                  {
                    node_id: '48',
                    node_type: 'easy showAnything',
                    exception_type: 'KeyError',
                    exception_message: "'nodes'\n",
                  },
                ],
              ],
            },
            outputs: {},
          },
        }),
      ),
    )
    const client = new ComfyHttpClient(baseUrl, { pollIntervalMs: 1, pollTimeoutMs: 50 })

    await expect(client.getHistory('prompt-1')).rejects.toMatchObject({
      code: 'HTTP_5XX',
      message: "ComfyUI 工作流执行失败：easy showAnything KeyError: 'nodes'",
      retryable: false,
      details: {
        kind: 'failed',
        provider: 'comfyui-chenyu',
        promptId: 'prompt-1',
        nodeId: '48',
        nodeType: 'easy showAnything',
        exceptionType: 'KeyError',
        exceptionMessage: "'nodes'",
      },
    } satisfies Partial<AppErrorClass>)
  })

  it('downloads view images as Buffer', async () => {
    let filename: string | null = null
    server.use(
      http.get(`${baseUrl}/view`, ({ request }) => {
        filename = new URL(request.url).searchParams.get('filename')
        return new HttpResponse(Buffer.from('png-bytes'))
      }),
    )
    const client = new ComfyHttpClient(baseUrl)

    await expect(client.viewImage('result.png')).resolves.toEqual(Buffer.from('png-bytes'))
    expect(filename).toBe('result.png')
  })

  it('downloads output images with ComfyUI subfolder and type', async () => {
    let requestUrl = ''
    server.use(
      http.get(`${baseUrl}/view`, ({ request }) => {
        requestUrl = request.url
        return new HttpResponse(Buffer.from('png-bytes'))
      }),
    )
    const client = new ComfyHttpClient(baseUrl)

    await expect(
      client.viewImage({
        filename: 'ComfyUI_0001.png',
        subfolder: '2026-05-31',
        type: 'output',
      }),
    ).resolves.toEqual(Buffer.from('png-bytes'))
    const params = new URL(requestUrl).searchParams
    expect(params.get('filename')).toBe('ComfyUI_0001.png')
    expect(params.get('subfolder')).toBe('2026-05-31')
    expect(params.get('type')).toBe('output')
  })

  it('maps queue-full responses to retryable HTTP_429 errors', async () => {
    server.use(
      http.post(`${baseUrl}/prompt`, () =>
        HttpResponse.json({ error: { message: 'queue is full' } }, { status: 429 }),
      ),
    )
    const client = new ComfyHttpClient(baseUrl)

    await expect(client.queuePrompt({})).rejects.toMatchObject({
      code: 'HTTP_429',
      retryable: true,
      details: {
        kind: 'network',
        provider: 'comfyui-chenyu',
        status: 429,
      },
    } satisfies Partial<AppErrorClass>)
  })

  it('maps server errors to retryable HTTP_5XX errors', async () => {
    server.use(
      http.get(`${baseUrl}/view`, () =>
        HttpResponse.json({ error: 'internal error' }, { status: 500 }),
      ),
    )
    const client = new ComfyHttpClient(baseUrl)

    await expect(client.viewImage('broken.png')).rejects.toMatchObject({
      code: 'HTTP_5XX',
      retryable: true,
      details: {
        kind: 'network',
        provider: 'comfyui-chenyu',
        status: 500,
      },
    } satisfies Partial<AppErrorClass>)
  })

  it('times out unfinished history polling', async () => {
    server.use(
      http.get(`${baseUrl}/history/prompt-1`, () =>
        HttpResponse.json({
          'prompt-1': {
            status: { completed: false },
            outputs: {},
          },
        }),
      ),
    )
    const client = new ComfyHttpClient(baseUrl, { pollIntervalMs: 1, pollTimeoutMs: 1 })

    await expect(client.getHistory('prompt-1')).rejects.toMatchObject({
      code: 'NETWORK_TIMEOUT',
      retryable: true,
      details: {
        kind: 'network',
        provider: 'comfyui-chenyu',
        promptId: 'prompt-1',
      },
    } satisfies Partial<AppErrorClass>)
  })
})
