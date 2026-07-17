import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import {
  API_PATHS,
  AppErrorClass,
  CACHE_REFRESH_INTERVAL_MINUTES,
  type Skill,
  type SkillModule,
  type SkillSummary,
} from '@tengyu-aipod/shared'
import { app, ipcMain } from 'electron'
import { z } from 'zod'
import { readAppConfig } from '../onboarding'
import { CustomerAuthService } from './customer-auth'
import { serverUrl } from './server-base-url'

const REFRESH_INTERVAL_MS = CACHE_REFRESH_INTERVAL_MINUTES * 60 * 1000
const CACHE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000
const SKILL_INDEX_FILE_NAME = 'index.json'
const SKILL_CACHE_SEGMENT_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._+-]{0,127}$/

export type SkillListFilter = {
  module?: SkillModule | undefined
  category?: string | undefined
  platform?: string | undefined
  language?: string | undefined
}

const rawSkillListFilterSchema = z
  .object({
    module: z.enum(['generation', 'detection', 'title']).optional(),
    category: z.string().optional(),
    platform: z.string().optional(),
    language: z.string().optional(),
  })
  .optional()
const skillListFilterSchema = rawSkillListFilterSchema.transform((filter): SkillListFilter => {
  const result: SkillListFilter = {}
  if (filter?.module !== undefined) {
    result.module = filter.module
  }
  if (filter?.category !== undefined) {
    result.category = filter.category
  }
  if (filter?.platform !== undefined) {
    result.platform = filter.platform
  }
  if (filter?.language !== undefined) {
    result.language = filter.language
  }
  return result
})
const skillGetInputSchema = z.object({
  id: z.string().min(1),
  version: z.string().optional(),
})

function parseSkillIpcInput<T>(schema: z.ZodType<T>, input: unknown, message: string): T {
  const parsed = schema.safeParse(input)
  if (!parsed.success) {
    throw new AppErrorClass('INVALID_INPUT', message, false, {
      issues: parsed.error.issues,
    })
  }
  return parsed.data
}

interface SkillIndexFile {
  refreshed_at: number
  items: SkillSummary[]
}

interface ApiResponse<T> {
  ok: boolean
  data?: T
  error?: { code: string; message?: string }
}

async function skillCacheDir() {
  const config = await readAppConfig()
  const root = config.workbench_root ?? app.getPath('userData')
  return join(root, '.workbench', 'cache', 'skills')
}

function skillFilePath(root: string, id: string, version: string) {
  return join(
    root,
    validateSkillCacheSegment(id, 'Skill 标识'),
    `${validateSkillCacheSegment(version, 'Skill 版本')}.json`,
  )
}

function validateSkillCacheSegment(value: string, label: string) {
  if (!SKILL_CACHE_SEGMENT_PATTERN.test(value)) {
    throw new AppErrorClass('INVALID_INPUT', `${label}不正确`, false, { value })
  }
  return value
}

function indexFilePath(root: string) {
  return join(root, SKILL_INDEX_FILE_NAME)
}

function normalizeFilter(filter: SkillListFilter = {}) {
  return {
    ...(filter.module ? { module: filter.module } : {}),
    ...(filter.category ? { category: filter.category } : {}),
    ...(filter.platform ? { platform: filter.platform } : {}),
    ...(filter.language ? { language: filter.language } : {}),
  } satisfies SkillListFilter
}

function matchesFilter(skill: SkillSummary, filter: SkillListFilter) {
  return (
    (!filter.module || skill.module === filter.module) &&
    (!filter.category || skill.category === filter.category) &&
    (!filter.platform || skill.platform === filter.platform) &&
    (!filter.language || skill.language === filter.language)
  )
}

function titleFallbackFilters(filter: SkillListFilter) {
  if (filter.module !== 'title' || !filter.platform || !filter.language) {
    return [filter]
  }

  return [
    filter,
    { ...filter, platform: 'generic' },
    { ...filter, platform: 'generic', language: 'generic' },
  ]
}

function filterSkillSummaries(items: SkillSummary[], filter: SkillListFilter) {
  for (const candidate of titleFallbackFilters(filter)) {
    const matches = items.filter((skill) => matchesFilter(skill, candidate))
    if (matches.length > 0) {
      return matches
    }
  }

  return []
}

async function readJson<T>(path: string) {
  return JSON.parse(await readFile(path, 'utf8')) as T
}

async function writeJson(path: string, value: unknown) {
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, JSON.stringify(value, null, 2), 'utf8')
}

export class SkillCacheManager {
  private intervalId: NodeJS.Timeout | null = null
  private readonly customerAuth: Pick<CustomerAuthService, 'getAuthorizedServerRequestHeaders'>
  private readonly fetcher: typeof fetch

  constructor(
    options: {
      customerAuth?: Pick<CustomerAuthService, 'getAuthorizedServerRequestHeaders'>
      fetcher?: typeof fetch
    } = {},
  ) {
    this.customerAuth = options.customerAuth ?? new CustomerAuthService()
    this.fetcher = options.fetcher ?? fetch
  }

  start() {
    if (this.intervalId) {
      return
    }

    void this.refresh()
    this.intervalId = setInterval(() => {
      void this.refresh()
    }, REFRESH_INTERVAL_MS)
  }

  stop() {
    if (!this.intervalId) {
      return
    }

    clearInterval(this.intervalId)
    this.intervalId = null
  }

  async listSkills(filter: SkillListFilter = {}): Promise<SkillSummary[]> {
    const normalized = normalizeFilter(filter)
    const cachedIndex = await this.readCachedIndex(REFRESH_INTERVAL_MS)
    if (cachedIndex) {
      return filterSkillSummaries(cachedIndex.items, normalized)
    }

    try {
      return await this.refresh(normalized)
    } catch {
      return this.readCachedSummaries(normalized)
    }
  }

  async getSkill(id: string, version?: string): Promise<Skill> {
    validateSkillCacheSegment(id, 'Skill 标识')
    if (version) {
      validateSkillCacheSegment(version, 'Skill 版本')
    }

    if (version) {
      const cached = await this.readCachedSkill(id, version)
      if (cached) {
        return cached
      }
    }

    try {
      const skill = await this.fetchSkill(id, version)
      await this.saveSkill(skill)
      return skill
    } catch (error) {
      const cached = version
        ? await this.readCachedSkill(id, version)
        : await this.readLatestCachedSkill(id)
      if (cached) {
        return cached
      }
      throw error
    }
  }

  async refresh(filter: SkillListFilter = {}) {
    const normalizedFilter = normalizeFilter(filter)
    const summaries = await this.fetchSkillSummaries(normalizedFilter)
    await this.saveIndex(summaries)
    await this.refreshSkillDetails(summaries)
    if (!Object.keys(normalizedFilter).length) {
      await this.cleanupMissingSkillDetails(summaries)
    }
    return summaries
  }

  private async rootDir() {
    return skillCacheDir()
  }

  private async fetchSkillSummaries(filter: SkillListFilter) {
    const searchParams = new URLSearchParams()
    for (const [key, value] of Object.entries(filter)) {
      if (value) {
        searchParams.set(key, value)
      }
    }
    const query = searchParams.toString()
    const url = serverUrl(`${API_PATHS.skills}${query ? `?${query}` : ''}`)
    const result = await this.fetchJson<SkillSummary[]>(url)
    return result
  }

  private async fetchSkill(id: string, version?: string) {
    validateSkillCacheSegment(id, 'Skill 标识')
    if (version) {
      validateSkillCacheSegment(version, 'Skill 版本')
    }

    const searchParams = new URLSearchParams()
    if (version) {
      searchParams.set('version', version)
    }
    const query = searchParams.toString()
    return this.fetchJson<Skill>(
      serverUrl(`${API_PATHS.skills}/${encodeURIComponent(id)}${query ? `?${query}` : ''}`),
    )
  }

  private async fetchJson<T>(url: string) {
    const headers = await this.customerAuth.getAuthorizedServerRequestHeaders()
    const response = await this.fetcher(url, { headers })
    if (!response.ok) {
      throw new Error(`skill request failed: ${response.status}`)
    }

    const result = (await response.json()) as ApiResponse<T>
    if (!result.ok || !result.data) {
      throw new Error(result.error?.code ?? 'SKILL_REQUEST_FAILED')
    }

    return result.data
  }

  private async saveIndex(items: SkillSummary[]) {
    const root = await this.rootDir()
    await writeJson(indexFilePath(root), {
      refreshed_at: Date.now(),
      items,
    } satisfies SkillIndexFile)
  }

  private async saveSkill(skill: Skill) {
    await writeJson(skillFilePath(await this.rootDir(), skill.id, skill.version), skill)
  }

  private async refreshSkillDetails(items: SkillSummary[]) {
    await Promise.all(
      items.map(async (item) => {
        const skill = await this.fetchSkill(item.id, item.version)
        await this.saveSkill(skill)
      }),
    )
  }

  private async cleanupMissingSkillDetails(items: SkillSummary[]) {
    const root = await this.rootDir()
    const allowedById = new Map<string, Set<string>>()
    for (const item of items) {
      const versions = allowedById.get(item.id) ?? new Set<string>()
      versions.add(item.version)
      allowedById.set(item.id, versions)
    }

    try {
      const entries = await readdir(root, { withFileTypes: true })
      await Promise.all(
        entries
          .filter((entry) => entry.isDirectory())
          .map(async (entry) => {
            const versions = allowedById.get(entry.name)
            const skillDir = join(root, entry.name)
            if (!versions) {
              await rm(skillDir, { recursive: true, force: true })
              return
            }

            const files = await readdir(skillDir)
            await Promise.all(
              files
                .filter((file) => file.endsWith('.json'))
                .filter((file) => !versions.has(file.replace(/\.json$/, '')))
                .map((file) => rm(join(skillDir, file), { force: true })),
            )
          }),
      )
    } catch {
      return
    }
  }

  private async readCachedSummaries(filter: SkillListFilter) {
    const index = await this.readCachedIndex(CACHE_MAX_AGE_MS)
    return index ? filterSkillSummaries(index.items, filter) : []
  }

  private async readCachedIndex(maxAgeMs: number) {
    try {
      const index = await readJson<SkillIndexFile>(indexFilePath(await this.rootDir()))
      if (Date.now() - index.refreshed_at > maxAgeMs) {
        return null
      }
      return index
    } catch {
      return null
    }
  }

  private async readCachedSkill(id: string, version: string) {
    try {
      return await readJson<Skill>(skillFilePath(await this.rootDir(), id, version))
    } catch {
      return null
    }
  }

  private async readLatestCachedSkill(id: string) {
    try {
      const root = await this.rootDir()
      const files = await readdir(join(root, id))
      const skills = await Promise.all(
        files
          .filter((file) => file.endsWith('.json'))
          .map((file) => this.readCachedSkill(id, file.replace(/\.json$/, ''))),
      )
      return (
        skills
          .filter((skill): skill is Skill => Boolean(skill))
          .sort((left, right) =>
            right.version.localeCompare(left.version, undefined, { numeric: true }),
          )[0] ?? null
      )
    } catch {
      return null
    }
  }
}

export const skillCacheManager = new SkillCacheManager()

export function registerSkillCacheIpc() {
  ipcMain.handle('skill:list', (_event, filter: unknown) =>
    skillCacheManager.listSkills(
      parseSkillIpcInput(skillListFilterSchema, filter, 'Skill 列表筛选参数不正确') ?? {},
    ),
  )
  ipcMain.handle('skill:get', (_event, input: unknown) => {
    const parsed = parseSkillIpcInput(skillGetInputSchema, input, 'Skill 查询参数不正确')
    return skillCacheManager.getSkill(parsed.id, parsed.version)
  })
  ipcMain.handle('skill:refresh', async () => {
    try {
      const items = await skillCacheManager.refresh()
      return { ok: true as const, count: items.length }
    } catch (error) {
      return {
        ok: false as const,
        count: 0,
        error: error instanceof Error ? error.message : 'Skill 同步失败',
      }
    }
  })
}
