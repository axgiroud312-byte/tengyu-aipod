import type { AppErrorClass } from '@tengyu-aipod/shared'
import { http, HttpResponse } from 'msw'
import { setupServer } from 'msw/node'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { AliyunBailianAdapter, bailianBaseUrl } from './aliyun-bailian-adapter'

const completionResponse = {
  id: 'chatcmpl_test',
  object: 'chat.completion',
  created: 1_779_552_000,
  model: 'qwen3-vl-plus',
  choices: [
    {
      index: 0,
      message: { role: 'assistant', content: 'Vintage Floral T-Shirt' },
      finish_reason: 'stop',
      logprobs: null,
    },
  ],
  usage: {
    prompt_tokens: 10,
    completion_tokens: 5,
    total_tokens: 15,
  },
}

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

describe('AliyunBailianAdapter', () => {
  it('sends chat completions to the selected region with json response format', async () => {
    let requestBody: unknown = null
    let authorization: string | null = null
    server.use(
      http.post(`${bailianBaseUrl('sg')}/chat/completions`, async ({ request }) => {
        requestBody = await request.json()
        authorization = request.headers.get('authorization')
        return HttpResponse.json(completionResponse)
      }),
    )
    const adapter = new AliyunBailianAdapter({
      apiKey: 'sk-test',
      region: 'sg',
      maxRetries: 0,
    })

    await expect(
      adapter.chatCompletion({
        model: 'qwen3.6-plus',
        messages: [{ role: 'user', content: 'Write a title' }],
        response_format: { type: 'json_object' },
      }),
    ).resolves.toMatchObject({
      text: 'Vintage Floral T-Shirt',
      usage: { total_tokens: 15 },
    })
    expect(authorization).toBe('Bearer sk-test')
    expect(requestBody).toMatchObject({
      model: 'qwen3.6-plus',
      messages: [{ role: 'user', content: 'Write a title' }],
      response_format: { type: 'json_object' },
      enable_thinking: false,
    })
  })

  it('supports vision messages with data URL images', async () => {
    let requestBody: unknown = null
    server.use(
      http.post(`${bailianBaseUrl('cn')}/chat/completions`, async ({ request }) => {
        requestBody = await request.json()
        return HttpResponse.json(completionResponse)
      }),
    )
    const adapter = new AliyunBailianAdapter({
      apiKey: 'sk-test',
      region: 'cn',
      maxRetries: 0,
    })
    const dataUrl = 'data:image/png;base64,iVBORw0KGgo='

    await adapter.visionCompletion({
      model: 'qwen3-vl-plus',
      messages: [
        {
          role: 'user',
          content: [
            { type: 'image_url', image_url: { url: dataUrl } },
            { type: 'text', text: 'Describe this image' },
          ],
        },
      ],
      response_format: { type: 'json_object' },
    })

    expect(requestBody).toMatchObject({
      model: 'qwen3-vl-plus',
      response_format: { type: 'json_object' },
      enable_thinking: false,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'image_url', image_url: { url: dataUrl } },
            { type: 'text', text: 'Describe this image' },
          ],
        },
      ],
    })
  })

  it('allows an explicit base URL for local E2E mocks', async () => {
    let requestBody: unknown = null
    server.use(
      http.post(
        'http://127.0.0.1:41234/compatible-mode/v1/chat/completions',
        async ({ request }) => {
          requestBody = await request.json()
          return HttpResponse.json(completionResponse)
        },
      ),
    )
    const adapter = new AliyunBailianAdapter({
      apiKey: 'sk-test',
      region: 'cn',
      baseURL: 'http://127.0.0.1:41234/compatible-mode/v1',
      maxRetries: 0,
    })

    await expect(
      adapter.chatCompletion({
        model: 'qwen3-vl-plus',
        messages: [{ role: 'user', content: 'Write a title' }],
      }),
    ).resolves.toMatchObject({ text: 'Vintage Floral T-Shirt' })
    expect(requestBody).toMatchObject({ model: 'qwen3-vl-plus', enable_thinking: false })
  })

  it('maps 401 errors to non-retryable AppError', async () => {
    server.use(
      http.post(`${bailianBaseUrl('cn')}/chat/completions`, () =>
        HttpResponse.json({ error: { message: 'invalid api key' } }, { status: 401 }),
      ),
    )
    const adapter = new AliyunBailianAdapter({
      apiKey: 'sk-bad',
      region: 'cn',
      maxRetries: 0,
    })

    await expect(
      adapter.chatCompletion({
        model: 'qwen3.6-plus',
        messages: [{ role: 'user', content: 'Hi' }],
      }),
    ).rejects.toMatchObject({
      code: 'HTTP_4XX',
      retryable: false,
    } satisfies Partial<AppErrorClass>)
  })

  it('maps 429 errors to retryable AppError', async () => {
    server.use(
      http.post(`${bailianBaseUrl('us')}/chat/completions`, () =>
        HttpResponse.json({ error: { message: 'rate limited' } }, { status: 429 }),
      ),
    )
    const adapter = new AliyunBailianAdapter({
      apiKey: 'sk-test',
      region: 'us',
      maxRetries: 0,
    })

    await expect(
      adapter.chatCompletion({
        model: 'qwen3.6-plus',
        messages: [{ role: 'user', content: 'Hi' }],
      }),
    ).rejects.toMatchObject({
      code: 'HTTP_429',
      retryable: true,
    } satisfies Partial<AppErrorClass>)
  })

  it('maps persistent 5xx errors to retryable AppError', async () => {
    server.use(
      http.post(`${bailianBaseUrl('cn')}/chat/completions`, () =>
        HttpResponse.json({ error: { message: 'server failed' } }, { status: 500 }),
      ),
    )
    const adapter = new AliyunBailianAdapter({
      apiKey: 'sk-test',
      region: 'cn',
      maxRetries: 0,
    })

    await expect(
      adapter.chatCompletion({
        model: 'qwen3.6-plus',
        messages: [{ role: 'user', content: 'Hi' }],
      }),
    ).rejects.toMatchObject({
      code: 'HTTP_5XX',
      retryable: true,
    } satisfies Partial<AppErrorClass>)
  })
})
