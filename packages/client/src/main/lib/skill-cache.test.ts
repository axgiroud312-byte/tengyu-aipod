import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Skill, SkillSummary } from '@tengyu-aipod/shared'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

let userDataDir = ''
let workbenchRoot = ''
let activationToken: string | null = 'token'

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

vi.mock('./keychain', () => ({
  getSecret: () => activationToken,
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
    recommendedModel: 'qwen3-vl-plus',
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
  activationToken = 'token'
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
    expect(fetch).toHaveBeenCalledWith('http://localhost:3000/api/skills?module=title', {
      headers: { authorization: 'Bearer token' },
    })
  })

  it('falls back to local cached summaries while cache is fresh enough', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(okResponse([summary()]))
      .mockRejectedValue(new Error('offline'))
    const manager = new SkillCacheManager()

    await manager.listSkills({ module: 'title' })

    await expect(manager.listSkills({ module: 'title', platform: 'temu_pop' })).resolves.toEqual([
      summary(),
    ])
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
})
