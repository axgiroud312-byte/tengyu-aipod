import { randomUUID } from 'node:crypto'
import { constants } from 'node:fs'
import { access, readdir, rm, stat } from 'node:fs/promises'
import { basename, join } from 'node:path'
import {
  AppErrorClass,
  type Skill,
  type SkillSummary,
} from '@tengyu-aipod/shared'
import { BrowserWindow, dialog, ipcMain, shell } from 'electron'
import ExcelJS from 'exceljs'
import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions'
import { readAppConfig } from '../onboarding'
import { AliyunBailianAdapter, type VisionResponse } from './aliyun-bailian-adapter'
import { BAILIAN_VISION_MODELS } from './generation-local-config'
import { getSecret } from './keychain'
import {
  type PreprocessFormat,
  type PreprocessOptions,
  SharpPreprocessPool,
} from './preprocess-pool'
import { skillCacheManager } from './skill-cache'
import { type SqliteDatabase, openSqliteDatabase } from './sqlite'
import { tempFileManager } from './temp-file-manager'

export type ExistingTitleStrategy = 'skip' | 'regenerate'

export type TitleBatchConfig = {
  batchDir: string
  platform: string
  language: string
  model: string
  imageIndex?: number
  extraRequirement?: string
  existingStrategy?: ExistingTitleStrategy
  maxRetries?: number
  concurrency?: number
  preprocess?: {
    maxSize?: number
    compression?: boolean
    format?: PreprocessFormat
    quality?: number
  }
  taskId?: string
  skuCodes?: string[]
}

export type TitleProgress = {
  task_id: string
  processed: number
  total: number
  succeeded: number
  failed: number
  skipped: number
}

export type TitleSkuResult =
  | {
      skuCode: string
      status: 'success'
      title: string
      imagePath: string
      warning?: string
    }
  | {
      skuCode: string
      status: 'failed'
      error: string
      imagePath?: string
      warning?: string
    }
  | {
      skuCode: string
      status: 'skipped'
      title: string
    }

export type TitleBatchResult = {
  taskId: string
  xlsxPath: string
  total: number
  succeeded: number
  failed: number
  skipped: number
  results: TitleSkuResult[]
}

export type TitleTaskEvent =
  | { ok: true; result: TitleBatchResult }
  | { ok: false; taskId: string; error: string }

export type TitleScanResult = {
  skuCount: number
  existingTitles: Record<string, string>
}

type TitleServiceDependencies = {
  skillCache?: Pick<typeof skillCacheManager, 'listSkills' | 'getSkill'>
  createBailianAdapter?: (apiKey: string) => Pick<AliyunBailianAdapter, 'visionCompletion'>
  preprocessPool?: Pick<SharpPreprocessPool, 'process' | 'close'>
  readConfig?: typeof readAppConfig
  getSecret?: typeof getSecret
  openDatabase?: (workbenchRoot: string) => Pick<SqliteDatabase, 'exec' | 'prepare' | 'close'>
  tempFileManager?: TitleTempFileManager
  emitProgress?: (progress: TitleProgress) => void
}

type TitleTempFileManager = {
  createTaskDir(module: 'title', taskId: string): Promise<string>
  cleanupTask(module: 'title', taskId: string, options?: { keepIfFailed?: boolean }): Promise<void>
}

type SkuFolder = {
  skuCode: string
  path: string
}

type ImageSelection =
  | {
      imagePath: string
      warning?: string
    }
  | {
      imagePath: null
    }

const IMAGE_EXTENSIONS = /\.(?:jpe?g|png|webp)$/i
const DEFAULT_MODEL = 'qwen3-vl-plus'
const PLATFORM_TITLE_MAX_LEN: Record<string, number> = {
  temu_pop: 150,
  temu_full: 130,
  shein: 200,
  tiktok: 250,
  shopee: 120,
  amazon: 200,
  ozon: 200,
  mercado: 60,
  generic: 150,
}

const PLATFORM_OPTIONS = [
  { key: 'temu_pop', label: 'Temu PopTemu' },
  { key: 'temu_full', label: 'Temu Full' },
  { key: 'shein', label: 'Shein' },
  { key: 'tiktok', label: 'TikTok Shop' },
  { key: 'shopee', label: 'Shopee' },
  { key: 'amazon', label: 'Amazon' },
  { key: 'ozon', label: 'Ozon' },
  { key: 'mercado', label: 'Mercado Libre' },
]

const LANGUAGE_OPTIONS = [
  { key: 'en', label: '英语' },
  { key: 'zh', label: '中文' },
  { key: 'es', label: '西班牙语' },
  { key: 'pt', label: '葡萄牙语' },
  { key: 'de', label: '德语' },
  { key: 'fr', label: '法语' },
  { key: 'ja', label: '日语' },
  { key: 'ko', label: '韩语' },
  { key: 'ru', label: '俄语' },
  { key: 'ar', label: '阿拉伯语' },
]

function createDefaultBailianAdapter(apiKey: string) {
  return new AliyunBailianAdapter({
    apiKey,
    region: 'cn',
    maxRetries: 0,
  })
}

async function listBailianProviderModels(
  recommendedFor: 'detection' | 'title' | 'prompt',
  needsVision: boolean,
) {
  const models = BAILIAN_VISION_MODELS.map((model) => ({
    id: model.id,
    label: model.label,
    modalities: [needsVision ? 'vision' : 'text'],
    recommendedFor: [recommendedFor],
  }))
  return models
}

function naturalCompare(left: string, right: string) {
  return left.localeCompare(right, undefined, { numeric: true, sensitivity: 'base' })
}

function clampInt(value: number | undefined, min: number, max: number, fallback: number) {
  if (!Number.isFinite(value)) {
    return fallback
  }
  return Math.max(min, Math.min(max, Math.floor(value as number)))
}

async function exists(path: string) {
  try {
    await access(path, constants.F_OK)
    return true
  } catch {
    return false
  }
}

function cellText(value: ExcelJS.CellValue) {
  if (value === null || value === undefined) {
    return ''
  }
  if (typeof value === 'object') {
    if ('text' in value && typeof value.text === 'string') {
      return value.text.trim()
    }
    if ('richText' in value && Array.isArray(value.richText)) {
      return value.richText
        .map((part) => part.text)
        .join('')
        .trim()
    }
    if ('result' in value) {
      return String(value.result ?? '').trim()
    }
    if ('hyperlink' in value && 'text' in value && typeof value.text === 'string') {
      return value.text.trim()
    }
  }
  return String(value).trim()
}

function isTitleHeader(sku: string, title: string) {
  const normalizedSku = sku.toLowerCase()
  const normalizedTitle = title.toLowerCase()
  return (
    ['sku', 'sku code', '货号'].includes(normalizedSku) &&
    ['title', '标题'].includes(normalizedTitle)
  )
}

export async function scanSkuFolders(batchDir: string): Promise<SkuFolder[]> {
  const entries = await readdir(batchDir, { withFileTypes: true })
  return entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => ({
      skuCode: entry.name,
      path: join(batchDir, entry.name),
    }))
    .sort((left, right) => naturalCompare(left.skuCode, right.skuCode))
}

export async function getNthImageFromSkuFolder(
  folder: string,
  imageIndex = 1,
): Promise<ImageSelection> {
  const files = (await readdir(folder, { withFileTypes: true }))
    .filter((entry) => entry.isFile() && IMAGE_EXTENSIONS.test(entry.name))
    .map((entry) => entry.name)
    .sort(naturalCompare)

  if (files.length === 0) {
    return { imagePath: null }
  }

  const normalizedIndex = clampInt(imageIndex, 1, Number.MAX_SAFE_INTEGER, 1)
  const selectedIndex = Math.min(normalizedIndex, files.length) - 1
  const selected = files[selectedIndex]
  if (!selected) {
    return { imagePath: null }
  }
  const imagePath = join(folder, selected)

  if (normalizedIndex > files.length) {
    return {
      imagePath,
      warning: `货号 ${basename(folder)} 只有 ${files.length} 张图，已使用第 ${files.length} 张`,
    }
  }

  return { imagePath }
}

export async function readExistingTitles(xlsxPath: string): Promise<Map<string, string>> {
  if (!(await exists(xlsxPath))) {
    return new Map()
  }

  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.readFile(xlsxPath)
  const sheet = workbook.worksheets[0]
  const titles = new Map<string, string>()
  if (!sheet) {
    return titles
  }

  sheet.eachRow((row, rowNumber) => {
    const sku = cellText(row.getCell(1).value)
    const title = cellText(row.getCell(2).value)
    if (rowNumber === 1 && isTitleHeader(sku, title)) {
      return
    }
    if (sku && title) {
      titles.set(sku, title)
    }
  })

  return titles
}

export async function writeTitlesXlsx(
  xlsxPath: string,
  generatedTitles: Map<string, string>,
  existingTitles: Map<string, string>,
) {
  try {
    const workbook = new ExcelJS.Workbook()
    const sheet = workbook.addWorksheet('Titles')
    sheet.columns = [
      { header: '货号', key: 'sku', width: 25 },
      { header: '标题', key: 'title', width: 60 },
    ]

    const merged = new Map(existingTitles)
    for (const [sku, title] of generatedTitles) {
      merged.set(sku, title)
    }

    const rows = Array.from(merged.entries()).sort(([left], [right]) => naturalCompare(left, right))
    for (const [sku, title] of rows) {
      sheet.addRow({ sku, title })
    }

    await workbook.xlsx.writeFile(xlsxPath)
  } catch (error) {
    throw toXlsxWriteError(error)
  }
}

export function toXlsxWriteError(error: unknown) {
  const code = typeof error === 'object' && error !== null && 'code' in error ? error.code : null
  const message = error instanceof Error ? error.message : String(error)
  if (
    code === 'EBUSY' ||
    code === 'EPERM' ||
    code === 'EACCES' ||
    /EBUSY|EPERM|EACCES/i.test(message)
  ) {
    return new AppErrorClass(
      'XLSX_LOCKED',
      '标题文件被 Excel 占用，请关闭后重试',
      false,
      undefined,
      error,
    )
  }
  return error
}

export function parseTitle(text: string, language: string, platform = 'generic') {
  const prefixPattern =
    /^(?:Title|标题|titre|título|titulo|titel|タイトル|제목|العنوان|заголовок)\s*[:：]\s*/i
  let title = text
    .trim()
    .replace(/^```[a-z]*\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim()

  const firstMeaningfulLine = title
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean)
  title = firstMeaningfulLine ?? ''
  title = title.replace(/^(?:[-*]|\d+[.)])\s*/, '')
  title = title.replace(/^["'“”‘’「『]+|["'“”‘’」』]+$/g, '').trim()
  title = title.replace(prefixPattern, '')
  title = title.replace(/^["'“”‘’「『]+|["'“”‘’」』]+$/g, '').trim()

  const maxLen = PLATFORM_TITLE_MAX_LEN[platform] ?? 150
  if (title.length > maxLen) {
    title = title.slice(0, maxLen).trim()
  }

  return title
}

function buildUserPrompt(extraRequirement?: string) {
  const trimmed = extraRequirement?.trim()
  if (!trimmed) {
    return '请根据图片生成一个适合跨境电商上架的标题。只输出最终标题。'
  }
  return `请根据图片生成一个适合跨境电商上架的标题。只输出最终标题。\n额外要求：${trimmed}`
}

function createVisionMessages(
  skill: Skill,
  dataUrl: string,
  extraRequirement?: string,
): ChatCompletionMessageParam[] {
  return [
    {
      role: 'system',
      content: skill.systemPrompt,
    },
    {
      role: 'user',
      content: [
        { type: 'image_url', image_url: { url: dataUrl } },
        { type: 'text', text: buildUserPrompt(extraRequirement) },
      ],
    },
  ]
}

async function selectTitleSkill(
  skillCache: Pick<typeof skillCacheManager, 'listSkills' | 'getSkill'>,
  platform: string,
  language: string,
) {
  const summaries = await skillCache.listSkills({ module: 'title', platform, language })
  const selected = summaries[0]
  if (!selected) {
    throw new AppErrorClass('HTTP_4XX', '未找到标题生成 Skill，请先在后台配置', false)
  }
  return skillCache.getSkill(selected.id, selected.version)
}

function appErrorMessage(error: unknown) {
  if (error instanceof AppErrorClass) {
    return error.message
  }
  if (error instanceof Error) {
    return error.message
  }
  return String(error)
}

function canRetry(error: unknown) {
  if (error instanceof AppErrorClass) {
    return error.retryable
  }
  return true
}

async function withRetries<T>(maxRetries: number, operation: () => Promise<T>) {
  let attempt = 0
  let lastError: unknown = null

  while (attempt <= maxRetries) {
    try {
      return await operation()
    } catch (error) {
      lastError = error
      if (attempt >= maxRetries || !canRetry(error)) {
        break
      }
      attempt += 1
    }
  }

  throw lastError
}

async function runWithConcurrency<T>(
  items: T[],
  concurrency: number,
  worker: (item: T) => Promise<void>,
) {
  let nextIndex = 0
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (nextIndex < items.length) {
      const current = items[nextIndex]
      nextIndex += 1
      if (current !== undefined) {
        await worker(current)
      }
    }
  })
  await Promise.all(workers)
}

function workbenchDbPath(workbenchRoot: string) {
  return join(workbenchRoot, '.workbench', 'workbench.db')
}

function openWorkbenchDatabase(workbenchRoot: string) {
  return openSqliteDatabase(workbenchDbPath(workbenchRoot))
}

function ensureSkuTable(db: Pick<SqliteDatabase, 'exec'>) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS skus (
      code TEXT PRIMARY KEY,
      template_batch TEXT,
      title TEXT,
      language TEXT,
      platform TEXT,
      title_skill_id TEXT,
      title_skill_version TEXT,
      title_model TEXT,
      title_generated_at INTEGER,
      created_at INTEGER NOT NULL
    );
  `)
}

function registerSkuTitles(
  db: Pick<SqliteDatabase, 'exec' | 'prepare'>,
  input: {
    templateBatch: string
    titles: Map<string, string>
    language: string
    platform: string
    skill: SkillSummary
    model: string
    generatedAt: number
  },
) {
  ensureSkuTable(db)
  const statement = db.prepare(`
    INSERT INTO skus (
      code,
      template_batch,
      title,
      language,
      platform,
      title_skill_id,
      title_skill_version,
      title_model,
      title_generated_at,
      created_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(code) DO UPDATE SET
      template_batch = excluded.template_batch,
      title = excluded.title,
      language = excluded.language,
      platform = excluded.platform,
      title_skill_id = excluded.title_skill_id,
      title_skill_version = excluded.title_skill_version,
      title_model = excluded.title_model,
      title_generated_at = excluded.title_generated_at
  `)
  const now = Date.now()
  for (const [skuCode, title] of input.titles) {
    statement.run(
      skuCode,
      input.templateBatch,
      title,
      input.language,
      input.platform,
      input.skill.id,
      input.skill.version,
      input.model,
      input.generatedAt,
      now,
    )
  }
}

function readSkuTitle(
  db: Pick<SqliteDatabase, 'exec' | 'prepare'>,
  input: { skuCode: string; batchDir: string },
) {
  ensureSkuTable(db)
  const row = db
    .prepare(
      `
        SELECT
          code,
          template_batch AS templateBatch,
          title,
          language,
          platform,
          title_skill_id AS titleSkillId,
          title_skill_version AS titleSkillVersion,
          title_model AS titleModel,
          title_generated_at AS titleGeneratedAt
        FROM skus
        WHERE code = ? AND template_batch = ?
      `,
    )
    .get(input.skuCode, basename(input.batchDir)) as
    | {
        code: string
        templateBatch: string
        title: string | null
        language: string | null
        platform: string | null
        titleSkillId: string | null
        titleSkillVersion: string | null
        titleModel: string | null
        titleGeneratedAt: number | null
      }
    | undefined

  return row ?? null
}

export class TitleService {
  private readonly completedTasks = new Map<
    string,
    { config: TitleBatchConfig; result: TitleBatchResult }
  >()

  listPlatforms() {
    return PLATFORM_OPTIONS
  }

  listLanguages() {
    return LANGUAGE_OPTIONS
  }

  async listModels() {
    return (await listBailianProviderModels('title', true)).map((model) => ({
      key: model.id,
      label: model.label ?? model.id,
    }))
  }

  async scanBatchDir(batchDir: string): Promise<TitleScanResult> {
    const skuFolders = await scanSkuFolders(batchDir)
    const existingTitles = await readExistingTitles(join(batchDir, 'titles.xlsx'))
    return {
      skuCount: skuFolders.length,
      existingTitles: Object.fromEntries(existingTitles),
    }
  }

  startBatch(
    config: TitleBatchConfig,
    emitProgress?: (progress: TitleProgress) => void,
    emitCompleted?: (event: TitleTaskEvent) => void,
  ) {
    const taskId = config.taskId ?? randomUUID()
    const dependencies = emitProgress ? { emitProgress } : {}
    void this.runTitleBatch({ ...config, taskId }, dependencies)
      .then((result) => {
        this.completedTasks.set(taskId, { config: { ...config, taskId }, result })
        emitCompleted?.({ ok: true, result })
      })
      .catch((error) => {
        emitCompleted?.({ ok: false, taskId, error: appErrorMessage(error) })
      })
    return taskId
  }

  retryFailed(
    taskId: string,
    emitProgress?: (progress: TitleProgress) => void,
    emitCompleted?: (event: TitleTaskEvent) => void,
  ) {
    const task = this.completedTasks.get(taskId)
    if (!task) {
      throw new AppErrorClass('HTTP_4XX', '未找到可重试的标题任务', false)
    }
    const failedSkuCodes = task.result.results
      .filter(
        (item): item is Extract<TitleSkuResult, { status: 'failed' }> => item.status === 'failed',
      )
      .map((item) => item.skuCode)
    if (failedSkuCodes.length === 0) {
      throw new AppErrorClass('HTTP_4XX', '没有失败的标题任务可重试', false)
    }
    return this.startBatch(
      {
        ...task.config,
        taskId: randomUUID(),
        existingStrategy: 'regenerate',
        skuCodes: failedSkuCodes,
      },
      emitProgress,
      emitCompleted,
    )
  }

  async getResult(input: { sku_code: string; batch_dir: string }) {
    const config = await readAppConfig()
    if (!config.workbench_root) {
      throw new Error('workbench_root is required before title results can be read')
    }
    const db = openWorkbenchDatabase(config.workbench_root)
    try {
      return readSkuTitle(db, { skuCode: input.sku_code, batchDir: input.batch_dir })
    } finally {
      db.close()
    }
  }

  async runTitleBatch(
    config: TitleBatchConfig,
    dependencies: TitleServiceDependencies = {},
  ): Promise<TitleBatchResult> {
    const taskId = config.taskId ?? randomUUID()
    const ownsPool = !dependencies.preprocessPool
    let tempDirCreated = false
    let keepFailedTemp = false
    const resolved = {
      skillCache: dependencies.skillCache ?? skillCacheManager,
      createBailianAdapter: dependencies.createBailianAdapter,
      preprocessPool: dependencies.preprocessPool ?? new SharpPreprocessPool(),
      readConfig: dependencies.readConfig ?? readAppConfig,
      getSecret: dependencies.getSecret ?? getSecret,
      openDatabase: dependencies.openDatabase ?? openWorkbenchDatabase,
      tempFileManager: dependencies.tempFileManager ?? tempFileManager,
    }

    try {
      const workbenchConfig = await resolved.readConfig()
      if (!workbenchConfig.workbench_root) {
        throw new Error('workbench_root is required before title generation can run')
      }

      await resolved.tempFileManager.createTaskDir('title', taskId)
      tempDirCreated = true

      const batchDirInfo = await stat(config.batchDir)
      if (!batchDirInfo.isDirectory()) {
        throw new Error('batchDir must be a directory')
      }

      const xlsxPath = join(config.batchDir, 'titles.xlsx')
      const existingTitles = await readExistingTitles(xlsxPath)
      const existingStrategy = config.existingStrategy ?? 'skip'
      const skuFilter = config.skuCodes ? new Set(config.skuCodes) : null
      const allSkuFolders = await scanSkuFolders(config.batchDir)
      const skuFolders = skuFilter
        ? allSkuFolders.filter((folder) => skuFilter.has(folder.skuCode))
        : allSkuFolders
      const total = skuFolders.length
      const results: TitleSkuResult[] = []
      const generatedTitles = new Map<string, string>()
      const workbenchRoot = workbenchConfig.workbench_root
      const progress: TitleProgress = {
        task_id: taskId,
        processed: 0,
        total,
        succeeded: 0,
        failed: 0,
        skipped: 0,
      }
      const emitProgress = () => dependencies.emitProgress?.({ ...progress })

      const pending: SkuFolder[] = []

      for (const skuFolder of skuFolders) {
        const existing = existingTitles.get(skuFolder.skuCode)
        if (existingStrategy === 'skip' && existing) {
          results.push({ skuCode: skuFolder.skuCode, status: 'skipped', title: existing })
          progress.skipped += 1
          progress.processed += 1
          continue
        }
        pending.push(skuFolder)
      }

      emitProgress()

      if (pending.length === 0) {
        await writeTitlesXlsx(xlsxPath, generatedTitles, existingTitles)
        return {
          taskId,
          xlsxPath,
          total,
          succeeded: 0,
          failed: 0,
          skipped: progress.skipped,
          results: results.sort((left, right) => naturalCompare(left.skuCode, right.skuCode)),
        }
      }

      const skillSummaries = await resolved.skillCache.listSkills({
        module: 'title',
        platform: config.platform,
        language: config.language,
      })
      const selectedSkill = skillSummaries[0]
      const skill = selectedSkill
        ? await resolved.skillCache.getSkill(selectedSkill.id, selectedSkill.version)
        : await selectTitleSkill(resolved.skillCache, config.platform, config.language)
      const model = config.model || skill.recommendedModel || DEFAULT_MODEL
      const apiKey = await resolved.getSecret('bailian')
      if (!apiKey) {
        throw new AppErrorClass('HTTP_4XX', '缺少阿里云百炼 API Key，请先在设置中填写', false)
      }
      const adapter =
        resolved.createBailianAdapter?.(apiKey) ??
        createDefaultBailianAdapter(apiKey)
      const maxRetries = clampInt(config.maxRetries, 0, 5, 2)
      const concurrency = clampInt(config.concurrency, 1, 10, 3)
      const imageIndex = clampInt(config.imageIndex, 1, Number.MAX_SAFE_INTEGER, 1)

      await runWithConcurrency(pending, concurrency, async (skuFolder) => {
        const result = await this.processSku({
          skuFolder,
          config,
          taskId,
          model,
          skill,
          adapter,
          maxRetries,
          imageIndex,
          workbenchRoot,
          preprocessPool: resolved.preprocessPool,
        })

        results.push(result)
        progress.processed += 1
        if (result.status === 'success') {
          generatedTitles.set(result.skuCode, result.title)
          progress.succeeded += 1
        } else {
          progress.failed += 1
        }
        emitProgress()
      })

      keepFailedTemp = progress.failed > 0
      const orderedGeneratedTitles = new Map(
        Array.from(generatedTitles.entries()).sort(([left], [right]) =>
          naturalCompare(left, right),
        ),
      )
      await writeTitlesXlsx(xlsxPath, orderedGeneratedTitles, existingTitles)

      if (orderedGeneratedTitles.size > 0 && process.env.TENGYU_SKIP_TITLE_DB_REGISTER !== '1') {
        const db = resolved.openDatabase(workbenchConfig.workbench_root)
        try {
          registerSkuTitles(db, {
            templateBatch: basename(config.batchDir),
            titles: orderedGeneratedTitles,
            language: config.language,
            platform: config.platform,
            skill,
            model,
            generatedAt: Date.now(),
          })
        } finally {
          db.close()
        }
      }

      return {
        taskId,
        xlsxPath,
        total,
        succeeded: progress.succeeded,
        failed: progress.failed,
        skipped: progress.skipped,
        results: results.sort((left, right) => naturalCompare(left.skuCode, right.skuCode)),
      }
    } finally {
      if (ownsPool && 'close' in resolved.preprocessPool) {
        await resolved.preprocessPool.close()
      }

      if (tempDirCreated) {
        await resolved.tempFileManager.cleanupTask('title', taskId, {
          keepIfFailed: keepFailedTemp,
        })
      }
    }
  }

  private async processSku(input: {
    skuFolder: SkuFolder
    config: TitleBatchConfig
    taskId: string
    model: string
    skill: Skill
    adapter: Pick<AliyunBailianAdapter, 'visionCompletion'>
    maxRetries: number
    imageIndex: number
    workbenchRoot: string
    preprocessPool: Pick<SharpPreprocessPool, 'process'>
  }): Promise<TitleSkuResult> {
    const selection = await getNthImageFromSkuFolder(input.skuFolder.path, input.imageIndex)
    if (!selection.imagePath) {
      return {
        skuCode: input.skuFolder.skuCode,
        status: 'failed',
        error: 'NO_IMAGE',
      }
    }

    try {
      const title = await withRetries(input.maxRetries, async () => {
        const preprocessOptions: PreprocessOptions = {
          module: 'title',
          taskId: input.taskId,
          workbenchRoot: input.workbenchRoot,
          input: selection.imagePath,
          inputName: basename(selection.imagePath),
          ...(input.config.preprocess?.maxSize !== undefined
            ? { maxSize: input.config.preprocess.maxSize }
            : {}),
          ...(input.config.preprocess?.compression !== undefined
            ? { compression: input.config.preprocess.compression }
            : {}),
          ...(input.config.preprocess?.format ? { format: input.config.preprocess.format } : {}),
          ...(input.config.preprocess?.quality !== undefined
            ? { quality: input.config.preprocess.quality }
            : {}),
        }
        const preprocessed = await input.preprocessPool.process(preprocessOptions)
        let response: VisionResponse
        try {
          response = await input.adapter.visionCompletion({
            model: input.model,
            messages: createVisionMessages(
              input.skill,
              preprocessed.dataUrl,
              input.config.extraRequirement,
            ),
          })
        } finally {
          await rm(preprocessed.outputPath, { force: true }).catch(() => null)
        }

        const title = parseTitle(response.text, input.config.language, input.config.platform)
        if (!title) {
          throw new AppErrorClass('HTTP_5XX', '模型返回空标题', true)
        }
        return title
      })

      return {
        skuCode: input.skuFolder.skuCode,
        status: 'success',
        title,
        imagePath: selection.imagePath,
        ...(selection.warning ? { warning: selection.warning } : {}),
      }
    } catch (error) {
      return {
        skuCode: input.skuFolder.skuCode,
        status: 'failed',
        error: appErrorMessage(error),
        imagePath: selection.imagePath,
        ...(selection.warning ? { warning: selection.warning } : {}),
      }
    }
  }
}

export const titleService = new TitleService()

function emitTitleProgress(progress: TitleProgress) {
  for (const window of BrowserWindow.getAllWindows()) {
    window.webContents.send('title:progress', progress)
  }
}

function emitTitleCompleted(event: TitleTaskEvent) {
  for (const window of BrowserWindow.getAllWindows()) {
    window.webContents.send('title:completed', event)
  }
}

async function openPath(path: string) {
  const error = await shell.openPath(path)
  if (error) {
    return { ok: false, error: { code: 'OPEN_PATH_FAILED', message: error } }
  }
  return { ok: true }
}

export function registerTitleIpc() {
  ipcMain.handle('title:list-platforms', () => titleService.listPlatforms())
  ipcMain.handle('title:list-languages', () => titleService.listLanguages())
  ipcMain.handle('title:list-models', () => titleService.listModels())
  ipcMain.handle('title:choose-batch-dir', async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openDirectory'],
      title: '选择货号批次目录',
    })
    if (result.canceled || !result.filePaths[0]) {
      return { ok: false, error: { code: 'CANCELLED', message: '已取消选择目录' } }
    }
    return { ok: true, data: { path: result.filePaths[0] } }
  })
  ipcMain.handle('title:scan-batch-dir', (_event, input: { batchDir: string }) =>
    titleService.scanBatchDir(input.batchDir),
  )
  ipcMain.handle('title:run', (_event, input: TitleBatchConfig) =>
    titleService.startBatch(input, emitTitleProgress, emitTitleCompleted),
  )
  ipcMain.handle('title:retry-failed', (_event, input: { task_id: string }) =>
    titleService.retryFailed(input.task_id, emitTitleProgress, emitTitleCompleted),
  )
  ipcMain.handle('title:get-result', (_event, input: { sku_code: string; batch_dir: string }) =>
    titleService.getResult(input),
  )
  ipcMain.handle('title:open-path', (_event, input: { path: string }) => openPath(input.path))
}
