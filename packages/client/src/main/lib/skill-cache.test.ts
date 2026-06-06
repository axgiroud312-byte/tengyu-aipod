import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Skill, SkillSummary } from '@tengyu-aipod/shared'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

let userDataDir = ''
let workbenchRoot = ''

vi.mock('electron', () => ({
  app: {
    getPath: (name: string) => {
      if (name !== 'userData') {
        throw new Error(`unexpected path: ${name}`)
      }
      return userDataDir
    },
  },
  ipcMain: {
    handle: vi.fn(),
  },
}))

vi.mock('../onboarding', () => ({
  readAppConfig: () => ({ workbench_root: workbenchRoot }),
}))

const { SkillCacheManager } = await import('./skill-cache')

function summary(overrides: Partial<SkillSummary> = {}): SkillSummary {
  return {
    id: 'title-temu-en',
    module: 'title',
    category: null,
    platform: 'temu_pop',
    language: 'en',
    version: '3.0.1',
    enabled: true,
    recommendedModel: 'qwen3.6-flash',
    notes: null,
    ...overrides,
  }
}

function skill(overrides: Partial<Skill> = {}): Skill {
  return {
    ...summary(),
    systemPrompt: 'Write a title.',
    variables: [],
    ...overrides,
  }
}

function okResponse<T>(data: T) {
  return new Response(JSON.stringify({ ok: true, data }), { status: 200 })
}

beforeEach(async () => {
  userDataDir = await mkdtemp(join(tmpdir(), 'tengyu-skill-cache-'))
  workbenchRoot = await mkdtemp(join(tmpdir(), 'tengyu-workbench-'))
  vi.useRealTimers()
  vi.stubGlobal('fetch', vi.fn())
})

afterEach(async () => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
  await rm(userDataDir, { recursive: true, force: true })
  await rm(workbenchRoot, { recursive: true, force: true })
})

describe('SkillCacheManager', () => {
  it('lists remote skills and caches summaries', async () => {
    vi.mocked(fetch).mockResolvedValue(okResponse([summary()]))
    const manager = new SkillCacheManager()

    await expect(manager.listSkills({ module: 'title' })).resolves.toEqual([summary()])
    expect(fetch).toHaveBeenCalledWith('https://wechat.tengyuai.com/api/skills?module=title')
  })

  it('falls back to local cached summaries while cache is fresh enough', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(okResponse([summary()]))
      .mockResolvedValueOnce(okResponse(skill()))
      .mockRejectedValue(new Error('offline'))
    const manager = new SkillCacheManager()

    await manager.listSkills({ module: 'title' })

    await expect(manager.listSkills({ module: 'title', platform: 'temu_pop' })).resolves.toEqual([
      summary(),
    ])
    expect(fetch).toHaveBeenCalledTimes(2)
  })

  it('uses generic title fallback from a fresh local index', async () => {
    const exactTitle = summary()
    const genericTitle = summary({
      id: 'title-generic-generic',
      platform: 'generic',
      language: 'generic',
      version: '1.0.0',
    })
    vi.mocked(fetch).mockImplementation(async (url) => {
      const requestUrl = String(url)
      if (requestUrl.endsWith('/api/skills')) {
        return okResponse([genericTitle, exactTitle])
      }
      if (requestUrl.endsWith('/api/skills/title-generic-generic?version=1.0.0')) {
        return okResponse(skill(genericTitle))
      }
      if (requestUrl.endsWith('/api/skills/title-temu-en?version=3.0.1')) {
        return okResponse(skill(exactTitle))
      }
      throw new Error(`unexpected URL: ${requestUrl}`)
    })
    const manager = new SkillCacheManager()

    await manager.refresh()

    await expect(
      manager.listSkills({ module: 'title', platform: 'temu_pop', language: 'en' }),
    ).resolves.toEqual([exactTitle])
    await expect(
      manager.listSkills({ module: 'title', platform: 'shein', language: 'de' }),
    ).resolves.toEqual([genericTitle])
    expect(fetch).toHaveBeenCalledTimes(3)
  })

  it('fetches and caches skill details by version', async () => {
    vi.mocked(fetch).mockResolvedValue(okResponse(skill()))
    const manager = new SkillCacheManager()

    await expect(manager.getSkill('title-temu-en', '3.0.1')).resolves.toMatchObject({
      id: 'title-temu-en',
      version: '3.0.1',
      systemPrompt: 'Write a title.',
    })
    await expect(
      import('node:fs/promises').then(({ readFile }) =>
        readFile(
          join(workbenchRoot, '.workbench', 'cache', 'skills', 'title-temu-en', '3.0.1.json'),
          'utf8',
        ),
      ),
    ).resolves.toContain('Write a title.')
    vi.mocked(fetch).mockRejectedValue(new Error('offline'))

    await expect(manager.getSkill('title-temu-en', '3.0.1')).resolves.toMatchObject({
      id: 'title-temu-en',
      version: '3.0.1',
    })
  })

  it('refreshes generation skills and fetches uncached generation skill details', async () => {
    const generationSummary = summary({
      id: 'txt2img-local-print',
      module: 'generation',
      category: 'txt2img-local-print',
      platform: null,
      language: null,
      version: '1.0.0',
      recommendedModel: null,
    })
    const generationSkill = skill({
      ...generationSummary,
      systemPrompt: 'Generate local print prompts from server skill.',
    })
    vi.mocked(fetch).mockImplementation(async (url) => {
      const requestUrl = String(url)
      if (requestUrl.endsWith('/api/skills')) {
        return okResponse([generationSummary])
      }
      if (requestUrl.endsWith('/api/skills/txt2img-local-print?version=1.0.0')) {
        return okResponse(generationSkill)
      }
      throw new Error(`unexpected URL: ${requestUrl}`)
    })
    const manager = new SkillCacheManager()

    await expect(manager.refresh()).resolves.toEqual([generationSummary])
    await expect(
      manager.listSkills({ module: 'generation', category: 'txt2img-local-print' }),
    ).resolves.toEqual([generationSummary])
    await expect(manager.getSkill('txt2img-local-print', '1.0.0')).resolves.toMatchObject({
      id: 'txt2img-local-print',
      systemPrompt: 'Generate local print prompts from server skill.',
    })
    await expect(
      import('node:fs/promises').then(({ readFile }) =>
        readFile(
          join(workbenchRoot, '.workbench', 'cache', 'skills', 'txt2img-local-print', '1.0.0.json'),
          'utf8',
        ),
      ),
    ).resolves.toContain('Generate local print prompts from server skill.')
  })

  it('overwrites cached skill details from server during refresh', async () => {
    const generationSummary = summary({
      id: 'img2img-local-reference',
      module: 'generation',
      category: 'img2img-local-reference',
      platform: null,
      language: null,
      version: '1.0.0',
      recommendedModel: null,
    })
    const detailPath = join(
      workbenchRoot,
      '.workbench',
      'cache',
      'skills',
      'img2img-local-reference',
      '1.0.0.json',
    )
    await mkdir(join(workbenchRoot, '.workbench', 'cache', 'skills', 'img2img-local-reference'), {
      recursive: true,
    })
    await writeFile(
      detailPath,
      JSON.stringify(skill({ ...generationSummary, systemPrompt: 'Old local prompt.' })),
      'utf8',
    )
    vi.mocked(fetch).mockImplementation(async (url) => {
      const requestUrl = String(url)
      if (requestUrl.endsWith('/api/skills')) {
        return okResponse([generationSummary])
      }
      if (requestUrl.endsWith('/api/skills/img2img-local-reference?version=1.0.0')) {
        return okResponse(skill({ ...generationSummary, systemPrompt: 'Fresh server prompt.' }))
      }
      throw new Error(`unexpected URL: ${requestUrl}`)
    })
    const manager = new SkillCacheManager()

    await manager.refresh()

    await expect(
      import('node:fs/promises').then(({ readFile }) => readFile(detailPath, 'utf8')),
    ).resolves.toContain('Fresh server prompt.')
  })

  it('does not use summary cache older than seven days', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-05-23T00:00:00.000Z'))
    vi.mocked(fetch)
      .mockResolvedValueOnce(okResponse([summary()]))
      .mockRejectedValue(new Error('offline'))
    const manager = new SkillCacheManager()

    await manager.listSkills({ module: 'title' })

    vi.setSystemTime(new Date('2026-06-01T00:00:00.000Z'))
    await expect(manager.listSkills({ module: 'title' })).resolves.toEqual([])
  })

  it('removes cached skill details that disappeared from a full server refresh', async () => {
    const root = join(workbenchRoot, '.workbench', 'cache', 'skills')
    await mkdir(join(root, 'txt2img-print-prompt-v3'), { recursive: true })
    await mkdir(join(root, 'title-temu-en'), { recursive: true })
    await writeFile(join(root, 'txt2img-print-prompt-v3', '3.0.1.json'), '{}', 'utf8')
    await writeFile(join(root, 'title-temu-en', '1.0.0.json'), '{}', 'utf8')
    await writeFile(join(root, 'title-temu-en', '3.0.1.json'), '{}', 'utf8')
    vi.mocked(fetch).mockImplementation(async (url) => {
      const requestUrl = String(url)
      if (requestUrl.endsWith('/api/skills')) {
        return okResponse([summary()])
      }
      if (requestUrl.endsWith('/api/skills/title-temu-en?version=3.0.1')) {
        return okResponse(skill())
      }
      throw new Error(`unexpected URL: ${requestUrl}`)
    })
    const manager = new SkillCacheManager()

    await manager.refresh()

    await expect(readdir(join(root, 'txt2img-print-prompt-v3'))).rejects.toThrow()
    await expect(readdir(join(root, 'title-temu-en'))).resolves.toEqual(['3.0.1.json'])
  })
})
