import type { Skill, SkillSummary } from '@tengyu-aipod/shared'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  PromptGeneratorService,
  createPromptMessages,
  injectVariables,
  parsePrompts,
} from './prompt-generator-service'

function skill(overrides: Partial<Skill> = {}): Skill {
  return {
    id: 'txt2img-print-prompt-v3',
    module: 'generation',
    category: 'txt2img',
    platform: null,
    language: null,
    version: '3.0.1',
    enabled: true,
    recommendedModel: 'qwen3.6-flash',
    notes: null,
    systemPrompt: 'Output JSON prompts for {{printMode}}. Requirement: {requirement}',
    variables: [],
    ...overrides,
  }
}

function summary(overrides: Partial<SkillSummary> = {}): SkillSummary {
  return {
    id: 'txt2img-print-prompt-v3',
    module: 'generation',
    category: 'txt2img',
    platform: null,
    language: null,
    version: '3.0.1',
    enabled: true,
    recommendedModel: 'qwen3.6-flash',
    notes: null,
    ...overrides,
  }
}

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('parsePrompts', () => {
  it('parses JSON arrays and object prompt arrays', () => {
    expect(parsePrompts('["A", "B", "C"]', 2)).toEqual(['A', 'B'])
    expect(parsePrompts('{"prompts":["A","B"]}', 5)).toEqual(['A', 'B'])
    expect(
      parsePrompts('{"prompts":[{"index":2,"prompt":"B"},{"index":1,"prompt":"A"}]}', 5),
    ).toEqual(['A', 'B'])
  })

  it('parses JSON arrays from markdown code blocks', () => {
    expect(parsePrompts('```json\n["Vintage bear", "Floral border"]\n```', 5)).toEqual([
      'Vintage bear',
      'Floral border',
    ])
  })

  it('falls back to numbered lines', () => {
    expect(parsePrompts('1. Cozy bear\n2、Vintage flower\n- Retro ribbon\n', 10)).toEqual([
      'Cozy bear',
      'Vintage flower',
      'Retro ribbon',
    ])
  })
})

describe('PromptGeneratorService', () => {
  it('injects variables into system prompts and calls chat completion without images', async () => {
    const chatCompletion = vi.fn().mockResolvedValue({
      text: '{"prompts":["Prompt A","Prompt B"]}',
    })
    const service = new PromptGeneratorService()

    await expect(
      service.generatePrompts(
        {
          skill: skill(),
          variables: { printMode: '局部', requirement: '圣诞小熊' },
          count: 2,
        },
        {
          getSecret: async () => 'sk-test',
          readConfig: async () => ({}),
          createBailianAdapter: () => ({
            chatCompletion,
            visionCompletion: vi.fn(),
          }),
        },
      ),
    ).resolves.toEqual(['Prompt A', 'Prompt B'])

    expect(chatCompletion).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'qwen3.6-flash',
        response_format: { type: 'json_object' },
        messages: [
          {
            role: 'system',
            content: 'Output JSON prompts for 局部. Requirement: 圣诞小熊',
          },
          expect.objectContaining({ role: 'user' }),
        ],
      }),
    )
    expect(JSON.stringify(chatCompletion.mock.calls[0]?.[0].messages)).not.toContain(
      '输出格式必须是标准 JSON 对象',
    )
  })

  it('extracts prompt text from indexed prompt objects', async () => {
    const chatCompletion = vi.fn().mockResolvedValue({
      text: '{"prompts":[{"index":2,"prompt":"Prompt B"},{"index":1,"prompt":"Prompt A"}]}',
    })
    const service = new PromptGeneratorService()

    await expect(
      service.generatePrompts(
        {
          skill: skill(),
          count: 2,
        },
        {
          getSecret: async () => 'sk-test',
          readConfig: async () => ({}),
          createBailianAdapter: () => ({
            chatCompletion,
            visionCompletion: vi.fn(),
          }),
        },
      ),
    ).resolves.toEqual(['Prompt A', 'Prompt B'])
  })

  it('uses vision completion and data URLs when reference images are present', async () => {
    const visionCompletion = vi.fn().mockResolvedValue({
      text: '{"prompts":["Use only art style","New floral motif"]}',
    })
    const service = new PromptGeneratorService()

    await expect(
      service.generatePrompts(
        {
          skill: skill({ systemPrompt: 'Return prompt lines.' }),
          refImages: [{ base64: 'iVBORw0KGgo=', mime_type: 'image/png' }],
          count: 2,
          userMessage: 'Use only art style',
        },
        {
          getSecret: async () => 'sk-test',
          readConfig: async () => ({}),
          createBailianAdapter: () => ({
            chatCompletion: vi.fn(),
            visionCompletion,
          }),
        },
      ),
    ).resolves.toEqual(['Use only art style', 'New floral motif'])

    expect(visionCompletion).toHaveBeenCalledWith(
      expect.objectContaining({
        messages: [
          expect.objectContaining({ role: 'system' }),
          expect.objectContaining({
            role: 'user',
            content: [
              { type: 'image_url', image_url: { url: 'data:image/png;base64,iVBORw0KGgo=' } },
              { type: 'text', text: expect.stringContaining('Use only art style') },
            ],
          }),
        ],
      }),
    )
  })

  it('resolves the first matching generation skill by category', async () => {
    const chatCompletion = vi.fn().mockResolvedValue({ text: '{"prompts":["Prompt from cache"]}' })
    const getSkill = vi.fn().mockResolvedValue(skill({ id: 'cached-skill', version: '1.0.0' }))
    const listSkills = vi
      .fn()
      .mockResolvedValue([summary({ id: 'cached-skill', version: '1.0.0' })])
    const service = new PromptGeneratorService()

    await expect(
      service.generatePrompts(
        { category: 'txt2img', count: 1 },
        {
          skillCache: { getSkill, listSkills },
          getSecret: async () => 'sk-test',
          readConfig: async () => ({}),
          createBailianAdapter: () => ({ chatCompletion, visionCompletion: vi.fn() }),
        },
      ),
    ).resolves.toEqual(['Prompt from cache'])

    expect(listSkills).toHaveBeenCalledWith({ module: 'generation', category: 'txt2img' })
    expect(getSkill).toHaveBeenCalledWith('cached-skill', '1.0.0')
  })

  it('chunks large prompt requests and injects each chunk count', async () => {
    const rawResponses: Array<{ chunkIndex: number; chunkTotal: number; expected: number }> = []
    const chatCompletion = vi.fn(async (request) => {
      const systemMessage = request.messages[0]
      const content = typeof systemMessage.content === 'string' ? systemMessage.content : ''
      const count = Number(content.match(/Generate (\d+)/)?.[1] ?? 0)
      return {
        text: JSON.stringify({
          prompts: Array.from({ length: count }, (_, index) => `Prompt ${count}-${index + 1}`),
        }),
        model: 'qwen3.6-flash',
        finishReason: 'stop' as const,
        raw: {} as never,
      }
    })
    const service = new PromptGeneratorService()

    await expect(
      service.generatePrompts(
        {
          skill: skill({ systemPrompt: 'Generate {{count}} JSON prompts for {requirement}.' }),
          variables: { requirement: '圣诞小熊' },
          count: 250,
          onRawResponse: (response) => {
            rawResponses.push({
              chunkIndex: response.chunkIndex,
              chunkTotal: response.chunkTotal,
              expected: response.expected,
            })
          },
        },
        {
          getSecret: async () => 'sk-test',
          readConfig: async () => ({}),
          createBailianAdapter: () => ({ chatCompletion, visionCompletion: vi.fn() }),
        },
      ),
    ).resolves.toHaveLength(250)

    expect(chatCompletion).toHaveBeenCalledTimes(3)
    expect(
      chatCompletion.mock.calls.map(([request]) => {
        const systemMessage = request.messages[0]
        return typeof systemMessage.content === 'string' ? systemMessage.content : ''
      }),
    ).toEqual([
      'Generate 100 JSON prompts for 圣诞小熊.',
      'Generate 100 JSON prompts for 圣诞小熊.',
      'Generate 50 JSON prompts for 圣诞小熊.',
    ])
    expect(rawResponses.sort((a, b) => a.chunkIndex - b.chunkIndex)).toEqual([
      { chunkIndex: 1, chunkTotal: 3, expected: 100 },
      { chunkIndex: 2, chunkTotal: 3, expected: 100 },
      { chunkIndex: 3, chunkTotal: 3, expected: 50 },
    ])
  })

  it('sends explicit per-chunk prompt count instructions to the model', async () => {
    const chatCompletion = vi.fn(async (request) => {
      const userMessage = request.messages[1]
      const content = typeof userMessage.content === 'string' ? userMessage.content : ''
      const count = Number(content.match(/本批必须生成 (\d+) 条/)?.[1] ?? 0)
      return {
        text: JSON.stringify({
          prompts: Array.from({ length: count }, (_, index) => `Prompt ${index + 1}`),
        }),
        model: 'qwen3.6-flash',
        finishReason: 'stop' as const,
        raw: {} as never,
      }
    })
    const service = new PromptGeneratorService()

    await expect(
      service.generatePrompts(
        {
          skill: skill({ systemPrompt: 'Generate JSON prompts.' }),
          count: 50,
        },
        {
          getSecret: async () => 'sk-test',
          readConfig: async () => ({}),
          createBailianAdapter: () => ({ chatCompletion, visionCompletion: vi.fn() }),
        },
      ),
    ).resolves.toHaveLength(50)

    await expect(
      service.generatePrompts(
        {
          skill: skill({ systemPrompt: 'Generate JSON prompts.' }),
          count: 200,
        },
        {
          getSecret: async () => 'sk-test',
          readConfig: async () => ({}),
          createBailianAdapter: () => ({ chatCompletion, visionCompletion: vi.fn() }),
        },
      ),
    ).resolves.toHaveLength(200)

    expect(
      chatCompletion.mock.calls.map(([request]) => {
        const userMessage = request.messages[1]
        return typeof userMessage.content === 'string' ? userMessage.content : ''
      }),
    ).toEqual([
      expect.stringContaining('本批必须生成 50 条 prompts'),
      expect.stringContaining('本批必须生成 100 条 prompts'),
      expect.stringContaining('本批必须生成 100 条 prompts'),
    ])
  })

  it('sends explicit print mode instructions to the model', async () => {
    const chatCompletion = vi.fn().mockResolvedValue({
      text: '{"prompts":["Prompt A","Prompt B"]}',
      model: 'qwen3.6-flash',
      finishReason: 'stop' as const,
      raw: {} as never,
    })
    const service = new PromptGeneratorService()

    await service.generatePrompts(
      {
        skill: skill({ systemPrompt: 'Generate JSON prompts.' }),
        variables: { printMode: '局部' },
        count: 2,
      },
      {
        getSecret: async () => 'sk-test',
        readConfig: async () => ({}),
        createBailianAdapter: () => ({ chatCompletion, visionCompletion: vi.fn() }),
      },
    )
    await service.generatePrompts(
      {
        skill: skill({ systemPrompt: 'Generate JSON prompts.' }),
        variables: { printMode: '满印' },
        count: 2,
      },
      {
        getSecret: async () => 'sk-test',
        readConfig: async () => ({}),
        createBailianAdapter: () => ({ chatCompletion, visionCompletion: vi.fn() }),
      },
    )

    const userMessages = chatCompletion.mock.calls.map(([request]) => {
      const userMessage = request.messages[1]
      return typeof userMessage.content === 'string' ? userMessage.content : ''
    })
    expect(userMessages[0]).toContain('独立局部印花')
    expect(userMessages[0]).toContain('不要做成满印')
    expect(userMessages[1]).toContain('满印印花')
    expect(userMessages[1]).toContain('铺满整个画面')
  })

  it('splits 1000 prompts into ten 100-prompt model calls', async () => {
    const chatCompletion = vi.fn(async (request) => {
      const systemMessage = request.messages[0]
      const content = typeof systemMessage.content === 'string' ? systemMessage.content : ''
      const count = Number(content.match(/Generate (\d+)/)?.[1] ?? 0)
      return {
        text: JSON.stringify({
          prompts: Array.from({ length: count }, (_, index) => `Prompt ${index + 1}`),
        }),
        model: 'qwen3.6-flash',
        finishReason: 'stop' as const,
        raw: {} as never,
      }
    })
    const service = new PromptGeneratorService()

    await expect(
      service.generatePrompts(
        {
          skill: skill({ systemPrompt: 'Generate {{count}} JSON prompts.' }),
          count: 1000,
        },
        {
          getSecret: async () => 'sk-test',
          readConfig: async () => ({}),
          createBailianAdapter: () => ({ chatCompletion, visionCompletion: vi.fn() }),
        },
      ),
    ).resolves.toHaveLength(1000)

    expect(chatCompletion).toHaveBeenCalledTimes(10)
    expect(
      chatCompletion.mock.calls.map(([request]) => {
        const systemMessage = request.messages[0]
        return typeof systemMessage.content === 'string' ? systemMessage.content : ''
      }),
    ).toEqual(Array.from({ length: 10 }, () => 'Generate 100 JSON prompts.'))
  })

  it('uses a smaller prompt chunk size when configured for live stability', async () => {
    vi.stubEnv('TENGYU_BAILIAN_PROMPT_CHUNK_SIZE', '25')
    const chatCompletion = vi.fn(async (request) => {
      const systemMessage = request.messages[0]
      const content = typeof systemMessage.content === 'string' ? systemMessage.content : ''
      const count = Number(content.match(/Generate (\d+)/)?.[1] ?? 0)
      return {
        text: JSON.stringify({
          prompts: Array.from({ length: count }, (_, index) => `Prompt ${index + 1}`),
        }),
        model: 'qwen3.6-flash',
        finishReason: 'stop' as const,
        raw: {} as never,
      }
    })
    const service = new PromptGeneratorService()

    await expect(
      service.generatePrompts(
        {
          skill: skill({ systemPrompt: 'Generate {{count}} JSON prompts.' }),
          count: 60,
        },
        {
          getSecret: async () => 'sk-test',
          readConfig: async () => ({}),
          createBailianAdapter: () => ({ chatCompletion, visionCompletion: vi.fn() }),
        },
      ),
    ).resolves.toHaveLength(60)

    expect(
      chatCompletion.mock.calls.map(([request]) => {
        const systemMessage = request.messages[0]
        return typeof systemMessage.content === 'string' ? systemMessage.content : ''
      }),
    ).toEqual([
      'Generate 25 JSON prompts.',
      'Generate 25 JSON prompts.',
      'Generate 10 JSON prompts.',
    ])
  })

  it('retries a failed LLM prompt chunk before failing the whole request', async () => {
    let failedOnce = false
    const chatCompletion = vi.fn(async (request) => {
      const systemMessage = request.messages[0]
      const content = typeof systemMessage.content === 'string' ? systemMessage.content : ''
      const count = Number(content.match(/Generate (\d+)/)?.[1] ?? 0)
      if (!failedOnce && count === 100) {
        failedOnce = true
        throw new Error('temporary timeout')
      }
      return {
        text: JSON.stringify({
          prompts: Array.from({ length: count }, (_, index) => `Prompt ${index + 1}`),
        }),
        model: 'qwen3.6-flash',
        finishReason: 'stop' as const,
        raw: {} as never,
      }
    })
    const service = new PromptGeneratorService()

    await expect(
      service.generatePrompts(
        {
          skill: skill({ systemPrompt: 'Generate {{count}} JSON prompts.' }),
          count: 250,
        },
        {
          getSecret: async () => 'sk-test',
          readConfig: async () => ({}),
          createBailianAdapter: () => ({ chatCompletion, visionCompletion: vi.fn() }),
        },
      ),
    ).resolves.toHaveLength(250)

    expect(chatCompletion).toHaveBeenCalledTimes(4)
  })

  it('throws when prompts cannot be parsed', async () => {
    const service = new PromptGeneratorService()
    const chatCompletion = vi.fn().mockResolvedValue({ text: '' })

    await expect(
      service.generatePrompts(
        { skill: skill(), count: 2 },
        {
          getSecret: async () => 'sk-test',
          readConfig: async () => ({}),
          createBailianAdapter: () => ({
            chatCompletion,
            visionCompletion: vi.fn(),
          }),
        },
      ),
    ).rejects.toMatchObject({
      code: 'HTTP_5XX',
      retryable: true,
      details: { kind: 'llm_parse_failed', rawResponsePreview: '' },
    })
    expect(chatCompletion).toHaveBeenCalledTimes(3)
  })

  it('throws when strict JSON contains fewer prompt strings than requested', async () => {
    const service = new PromptGeneratorService()

    await expect(
      service.generatePrompts(
        { skill: skill(), count: 3 },
        {
          getSecret: async () => 'sk-test',
          readConfig: async () => ({}),
          createBailianAdapter: () => ({
            chatCompletion: vi.fn().mockResolvedValue({ text: '{"prompts":["Only one"]}' }),
            visionCompletion: vi.fn(),
          }),
        },
      ),
    ).rejects.toMatchObject({
      code: 'HTTP_5XX',
      retryable: true,
      details: {
        kind: 'llm_parse_failed',
        expected: 3,
        actual: 1,
        rawResponsePreview: '{"prompts":["Only one"]}',
      },
    })
  })

  it('throws when strict JSON prompts contain unsupported values', async () => {
    const service = new PromptGeneratorService()

    await expect(
      service.generatePrompts(
        { skill: skill(), count: 1 },
        {
          getSecret: async () => 'sk-test',
          readConfig: async () => ({}),
          createBailianAdapter: () => ({
            chatCompletion: vi.fn().mockResolvedValue({ text: '{"prompts":[123]}' }),
            visionCompletion: vi.fn(),
          }),
        },
      ),
    ).rejects.toMatchObject({
      code: 'HTTP_5XX',
      retryable: true,
      details: {
        kind: 'llm_parse_failed',
        expected: 1,
        actual: 0,
        rawResponsePreview: '{"prompts":[123]}',
      },
    })
  })
})

describe('prompt message helpers', () => {
  it('keeps unknown placeholders and renders variable summaries', () => {
    expect(injectVariables('Hello {{name}} {missing}', { name: 'Tengyu' })).toBe(
      'Hello Tengyu {missing}',
    )
    expect(
      createPromptMessages(skill(), { printMode: '满印' }, [], '生成 3 条提示词')[1],
    ).toMatchObject({
      role: 'user',
      content: '生成 3 条提示词\n\n变量：\nprintMode: 满印',
    })
  })
})
