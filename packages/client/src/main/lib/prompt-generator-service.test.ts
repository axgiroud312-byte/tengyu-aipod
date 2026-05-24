import type { Skill, SkillSummary } from '@tengyu-aipod/shared'
import { describe, expect, it, vi } from 'vitest'
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
    recommendedModel: 'qwen3-vl-plus',
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
    recommendedModel: 'qwen3-vl-plus',
    notes: null,
    ...overrides,
  }
}

describe('parsePrompts', () => {
  it('parses JSON arrays and object prompt arrays', () => {
    expect(parsePrompts('["A", "B", "C"]', 2)).toEqual(['A', 'B'])
    expect(parsePrompts('{"prompts":["A","B"]}', 5)).toEqual(['A', 'B'])
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
    const chatCompletion = vi.fn().mockResolvedValue({ text: '["Prompt A","Prompt B"]' })
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
          createBailianAdapter: () => ({
            chatCompletion,
            visionCompletion: vi.fn(),
          }),
        },
      ),
    ).resolves.toEqual(['Prompt A', 'Prompt B'])

    expect(chatCompletion).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'qwen3-vl-plus',
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
  })

  it('uses vision completion and data URLs when reference images are present', async () => {
    const visionCompletion = vi.fn().mockResolvedValue({
      text: '1. Use only art style\n2. New floral motif',
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
              { type: 'text', text: 'Use only art style' },
            ],
          }),
        ],
      }),
    )
  })

  it('resolves the first matching generation skill by category', async () => {
    const chatCompletion = vi.fn().mockResolvedValue({ text: 'Prompt from cache' })
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
          createBailianAdapter: () => ({ chatCompletion, visionCompletion: vi.fn() }),
        },
      ),
    ).resolves.toEqual(['Prompt from cache'])

    expect(listSkills).toHaveBeenCalledWith({ module: 'generation', category: 'txt2img' })
    expect(getSkill).toHaveBeenCalledWith('cached-skill', '1.0.0')
  })

  it('throws when prompts cannot be parsed', async () => {
    const service = new PromptGeneratorService()

    await expect(
      service.generatePrompts(
        { skill: skill(), count: 2 },
        {
          getSecret: async () => 'sk-test',
          createBailianAdapter: () => ({
            chatCompletion: vi.fn().mockResolvedValue({ text: '' }),
            visionCompletion: vi.fn(),
          }),
        },
      ),
    ).rejects.toMatchObject({
      code: 'HTTP_5XX',
      retryable: true,
      details: { kind: 'llm_parse_failed' },
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
