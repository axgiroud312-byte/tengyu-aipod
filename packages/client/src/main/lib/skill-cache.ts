import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import {
  API_PATHS,
  CACHE_REFRESH_INTERVAL_MINUTES,
  type Skill,
  type SkillModule,
  type SkillSummary,
} from '@tengyu-aipod/shared'
import { app, ipcMain } from 'electron'
import { readAppConfig } from '../onboarding'
import { getSecret } from './keychain'

const SERVER_BASE_URL = process.env.TENGYU_SERVER_URL ?? 'http://localhost:3000'
const REFRESH_INTERVAL_MS = CACHE_REFRESH_INTERVAL_MINUTES * 60 * 1000
const CACHE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000
const SKILL_INDEX_FILE_NAME = 'index.json'

export type SkillListFilter = {
  module?: SkillModule
  category?: string
  platform?: string
  language?: string
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
  return join(root, id, `${version}.json`)
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

async function readJson<T>(path: string) {
  return JSON.parse(await readFile(path, 'utf8')) as T
}

async function writeJson(path: string, value: unknown) {
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, JSON.stringify(value, null, 2), 'utf8')
}

export class SkillCacheManager {
  private intervalId: NodeJS.Timeout | null = null
  private lastRefreshAt = 0

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

    if (Date.now() - this.lastRefreshAt > REFRESH_INTERVAL_MS) {
      await this.refresh(normalized).catch(() => null)
    }

    try {
      const fresh = await this.fetchSkillSummaries(normalized)
      await this.saveIndex(fresh)
      return fresh
    } catch {
      return this.readCachedSummaries(normalized)
    }
  }

  async getSkill(id: string, version?: string): Promise<Skill> {
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
    const summaries = await this.fetchSkillSummaries(normalizeFilter(filter))
    await this.saveIndex(summaries)
    this.lastRefreshAt = Date.now()
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
    const url = `${SERVER_BASE_URL}${API_PATHS.skills}${query ? `?${query}` : ''}`
    const result = await this.fetchJson<SkillSummary[]>(url)
    return result
  }

  private async fetchSkill(id: string, version?: string) {
    const searchParams = new URLSearchParams()
    if (version) {
      searchParams.set('version', version)
    }
    const query = searchParams.toString()
    return this.fetchJson<Skill>(
      `${SERVER_BASE_URL}${API_PATHS.skills}/${encodeURIComponent(id)}${query ? `?${query}` : ''}`,
    )
  }

  private async fetchJson<T>(url: string) {
    const token = await getSecret('activation_token')
    const response = await fetch(url, {
      headers: token ? { authorization: `Bearer ${token}` } : {},
    })
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

  private async readCachedSummaries(filter: SkillListFilter) {
    try {
      const index = await readJson<SkillIndexFile>(indexFilePath(await this.rootDir()))
      if (Date.now() - index.refreshed_at > CACHE_MAX_AGE_MS) {
        return []
      }
      return index.items.filter((skill) => matchesFilter(skill, filter))
    } catch {
      return []
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
  ipcMain.handle('skill:list', (_event, filter?: SkillListFilter) =>
    skillCacheManager.listSkills(filter),
  )
  ipcMain.handle('skill:get', (_event, input: { id: string; version?: string }) =>
    skillCacheManager.getSkill(input.id, input.version),
  )
}
