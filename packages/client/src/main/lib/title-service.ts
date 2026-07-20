import { randomUUID } from 'node:crypto'
import { constants } from 'node:fs'
import { access, mkdir, readdir, rename, rm, stat } from 'node:fs/promises'
import { basename, dirname, join, resolve } from 'node:path'
import {
  type AppError,
  AppErrorClass,
  type Skill,
  type SkillSummary,
  WORKBENCH_DIRECTORIES,
} from '@tengyu-aipod/shared'
import { BrowserWindow, dialog, ipcMain, shell } from 'electron'
import ExcelJS from 'exceljs'
import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions'
import { z } from 'zod'
import { readAppConfig } from '../onboarding'
import { AliyunBailianAdapter, type VisionResponse } from './aliyun-bailian-adapter'
import {
  type DiagnosticLogWriter,
  createOptionalDiagnosticLogWriter,
  errorForDiagnosticLog,
  fileDiagnosticMetadata,
} from './diagnostic-log-service'
import { BAILIAN_VISION_MODELS } from './generation-local-config'
import { getSecret } from './keychain'
import {
  type PreprocessFormat,
  type PreprocessOptions,
  SharpPreprocessPool,
} from './preprocess-pool'
import { skillCacheManager } from './skill-cache'
import type { SqliteDatabase } from './sqlite'
import { tempFileManager } from './temp-file-manager'
import {
  openWorkbenchDatabase as openWorkbenchDatabaseFile,
  workbenchDatabasePath,
} from './workbench-db'
import { assertPathInsideWorkbench } from './workbench-path-guard'

export type ExistingTitleStrategy = 'skip' | 'regenerate'

export type TitleKeywordGroup = {
  prefix?: string | undefined
  suffix?: string | undefined
}

export type TitleKeywordGroupAssignment = {
  groupIndex: number
  group: TitleKeywordGroup
}

export type TitleBatchConfig = {
  batchDir: string
  titleFileName?: string | undefined
  platform: string
  language: string
  model: string
  imageIndex?: number | undefined
  extraRequirement?: string | undefined
  keywordGroups?: TitleKeywordGroup[] | undefined
  keywordGroupSeparator?: string | undefined
  existingStrategy?: ExistingTitleStrategy | undefined
  maxRetries?: number | undefined
  concurrency?: number | undefined
  preprocess?:
    | {
        maxSize?: number | undefined
        compression?: boolean | undefined
        format?: PreprocessFormat | undefined
        quality?: number | undefined
      }
    | undefined
  taskId?: string | undefined
  skuCodes?: string[] | undefined
}

export type TitleProgress = {
  task_id: string
  processed: number
  total: number
  succeeded: number
  failed: number
  skipped: number
  diagnosticsLogPath?: string | undefined
  status?: 'running' | 'cancelled' | undefined
}

export type TitleSkuResult =
  | {
      skuCode: string
      status: 'success'
      title: string
      baseTitle?: string | undefined
      imagePath: string
      warning?: string | undefined
    }
  | {
      skuCode: string
      status: 'failed'
      error: string
      imagePath?: string | undefined
      warning?: string | undefined
      fatal?: boolean | undefined
      appErrorCode?: AppError['code'] | undefined
      retryable?: boolean | undefined
      errorDetails?: Record<string, unknown> | undefined
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
  cancelled?: boolean | undefined
  diagnosticsLogPath?: string | undefined
}

export type TitleTaskEvent =
  | { ok: true; result: TitleBatchResult }
  | { ok: false; taskId: string; error: string }

export type TitleScanResult = {
  skuCount: number
  skuCodes: string[]
  existingTitles: Record<string, string>
}

export type TitleServiceDependencies = {
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

export type TitleGeneratedSkuResult =
  | {
      skuCode: string
      status: 'success'
      baseTitle: string
      imagePath: string
      warning?: string | undefined
    }
  | {
      skuCode: string
      status: 'failed'
      error: string
      imagePath?: string | undefined
      warning?: string | undefined
      fatal?: boolean | undefined
      appErrorCode?: AppError['code'] | undefined
      retryable?: boolean | undefined
      errorDetails?: Record<string, unknown> | undefined
    }

type TitleProcessingResources = {
  config: TitleBatchConfig
  taskId: string
  model: string
  skill: Skill
  adapter: Pick<AliyunBailianAdapter, 'visionCompletion'>
  maxRetries: number
  imageIndex: number
  workbenchRoot: string
  preprocessPool: Pick<SharpPreprocessPool, 'process'>
  diagnostics: DiagnosticLogWriter | null
}

export type TitleProcessingSession = {
  taskId: string
  model: string
  skill: Skill
  workbenchRoot: string
  diagnosticsLogPath?: string | undefined
  appendDiagnosticLog: (
    event: Parameters<NonNullable<DiagnosticLogWriter>['append']>[0],
  ) => Promise<void>
  generateSku: (input: {
    skuCode: string
    skuFolder: string
    keywordGroup?: TitleKeywordGroupAssignment | undefined
  }) => Promise<TitleGeneratedSkuResult>
  close: (options?: { keepFailedTemp?: boolean | undefined }) => Promise<void>
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
const DEFAULT_MODEL = 'qwen3.6-flash'
const DEFAULT_TITLE_FILE_BASENAME = '标题'
const LEGACY_TITLE_FILE_BASENAME = 'titles'
const titleXlsxWriteQueues = new Map<string, Promise<void>>()
const PLATFORM_TITLE_MAX_LEN: Record<string, number> = {
  temu: 150,
  shein: 200,
  tiktok: 250,
  shopee: 120,
  amazon: 200,
  ozon: 200,
  mercado: 60,
  generic: 150,
}

const PLATFORM_OPTIONS = [
  { key: 'temu', label: 'Temu' },
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

const rawTitlePreprocessSchema = z.object({
  maxSize: z.number().optional(),
  compression: z.boolean().optional(),
  format: z.enum(['jpg', 'png']).optional(),
  quality: z.number().optional(),
})
const titleKeywordGroupSchema = z.object({
  prefix: z.string().optional(),
  suffix: z.string().optional(),
})
const titlePreprocessSchema = rawTitlePreprocessSchema.transform(
  (preprocess): NonNullable<TitleBatchConfig['preprocess']> => {
    const result: NonNullable<TitleBatchConfig['preprocess']> = {}
    if (preprocess.maxSize !== undefined) {
      result.maxSize = preprocess.maxSize
    }
    if (preprocess.compression !== undefined) {
      result.compression = preprocess.compression
    }
    if (preprocess.format !== undefined) {
      result.format = preprocess.format
    }
    if (preprocess.quality !== undefined) {
      result.quality = preprocess.quality
    }
    return result
  },
)
const rawTitleBatchConfigSchema = z.object({
  batchDir: z.string(),
  titleFileName: z.string().optional(),
  platform: z.string(),
  language: z.string(),
  model: z.string(),
  imageIndex: z.number().optional(),
  extraRequirement: z.string().optional(),
  keywordGroups: z.array(titleKeywordGroupSchema).optional(),
  keywordGroupSeparator: z.string().optional(),
  existingStrategy: z.enum(['skip', 'regenerate']).optional(),
  maxRetries: z.number().optional(),
  concurrency: z.number().optional(),
  preprocess: titlePreprocessSchema.optional(),
  taskId: z.string().optional(),
  skuCodes: z.array(z.string()).optional(),
})
const titleBatchConfigSchema = rawTitleBatchConfigSchema.transform((config): TitleBatchConfig => {
  const result: TitleBatchConfig = {
    batchDir: config.batchDir,
    platform: config.platform,
    language: config.language,
    model: config.model,
  }
  if (config.titleFileName !== undefined) {
    result.titleFileName = config.titleFileName
  }
  if (config.imageIndex !== undefined) {
    result.imageIndex = config.imageIndex
  }
  if (config.extraRequirement !== undefined) {
    result.extraRequirement = config.extraRequirement
  }
  if (config.keywordGroups !== undefined) {
    result.keywordGroups = config.keywordGroups
  }
  if (config.keywordGroupSeparator !== undefined) {
    result.keywordGroupSeparator = config.keywordGroupSeparator
  }
  if (config.existingStrategy !== undefined) {
    result.existingStrategy = config.existingStrategy
  }
  if (config.maxRetries !== undefined) {
    result.maxRetries = config.maxRetries
  }
  if (config.concurrency !== undefined) {
    result.concurrency = config.concurrency
  }
  if (config.preprocess !== undefined) {
    result.preprocess = config.preprocess
  }
  if (config.taskId !== undefined) {
    result.taskId = config.taskId
  }
  if (config.skuCodes !== undefined) {
    result.skuCodes = config.skuCodes
  }
  return result
})
const titleScanBatchDirInputSchema = z.object({
  batchDir: z.string(),
  titleFileName: z.string().optional(),
})
const titleTaskIdInputSchema = z.object({ task_id: z.string() })
const titleGetResultInputSchema = z.object({
  sku_code: z.string(),
  batch_dir: z.string(),
})
const titleOpenPathInputSchema = z.object({ path: z.string() })

function parseTitleIpcInput<T>(schema: z.ZodType<T>, input: unknown, message: string): T {
  const parsed = schema.safeParse(input)
  if (!parsed.success) {
    throw new AppErrorClass('INVALID_INPUT', message, false, {
      issues: parsed.error.issues,
    })
  }
  return parsed.data
}

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

export function normalizeTitleFileBaseName(value?: string) {
  const withoutExtension = (value ?? DEFAULT_TITLE_FILE_BASENAME)
    .trim()
    .replace(/\.xlsx$/i, '')
    .trim()
  const safeName = withoutExtension
    .replace(/[<>:"/\\|?*]/g, '_')
    .split('')
    .map((character) => (character.charCodeAt(0) < 32 ? '_' : character))
    .join('')
    .replace(/^\.+$/, '')
    .trim()
  return safeName || DEFAULT_TITLE_FILE_BASENAME
}

export function titleXlsxPath(batchDir: string, titleFileName?: string) {
  return join(batchDir, `${normalizeTitleFileBaseName(titleFileName)}.xlsx`)
}

export async function resolveTitleXlsxPath(batchDir: string, titleFileName?: string) {
  const preferredPath = titleXlsxPath(batchDir, titleFileName)
  if (normalizeTitleFileBaseName(titleFileName) !== DEFAULT_TITLE_FILE_BASENAME) {
    return preferredPath
  }
  if (await exists(preferredPath)) {
    return preferredPath
  }
  const legacyPath = join(batchDir, `${LEGACY_TITLE_FILE_BASENAME}.xlsx`)
  if (await exists(legacyPath)) {
    return legacyPath
  }
  return preferredPath
}

export function normalizeTitleKeywordGroups(groups?: TitleKeywordGroup[]) {
  const normalized: TitleKeywordGroup[] = []
  for (const group of groups ?? []) {
    const prefix = group.prefix?.trim() ?? ''
    const suffix = group.suffix?.trim() ?? ''
    if (!prefix && !suffix) {
      continue
    }
    const nextGroup: TitleKeywordGroup = {}
    if (prefix) {
      nextGroup.prefix = prefix
    }
    if (suffix) {
      nextGroup.suffix = suffix
    }
    normalized.push(nextGroup)
  }
  return normalized
}

export function assignTitleKeywordGroups(skuCodes: string[], groups: TitleKeywordGroup[]) {
  const assignments = new Map<string, TitleKeywordGroupAssignment>()
  if (skuCodes.length === 0 || groups.length === 0) {
    return assignments
  }

  const baseSize = Math.floor(skuCodes.length / groups.length)
  const remainder = skuCodes.length % groups.length
  let offset = 0

  for (const [index, group] of groups.entries()) {
    const groupSize = baseSize + (index < remainder ? 1 : 0)
    for (let i = 0; i < groupSize; i += 1) {
      const skuCode = skuCodes[offset + i]
      if (skuCode) {
        assignments.set(skuCode, { groupIndex: index + 1, group })
      }
    }
    offset += groupSize
  }

  return assignments
}

export function joinTitleWithKeywordGroup(
  title: string,
  assignment: TitleKeywordGroupAssignment | undefined,
  separator: string | undefined,
) {
  if (!assignment) {
    return title.trim()
  }
  const delimiter = separator === undefined ? ' ' : separator
  return [
    assignment.group.prefix?.trim() ?? '',
    title.trim(),
    assignment.group.suffix?.trim() ?? '',
  ]
    .filter((part) => part.length > 0)
    .join(delimiter)
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

function titleXlsxWriteLockKey(xlsxPath: string) {
  const absolutePath = resolve(xlsxPath)
  return process.platform === 'win32' ? absolutePath.toLowerCase() : absolutePath
}

async function withTitleXlsxWriteLock<T>(xlsxPath: string, operation: () => Promise<T>) {
  const key = titleXlsxWriteLockKey(xlsxPath)
  const previous = titleXlsxWriteQueues.get(key) ?? Promise.resolve()
  let release: () => void = () => undefined
  const current = new Promise<void>((resolveCurrent) => {
    release = resolveCurrent
  })
  const tail = previous.then(() => current)
  titleXlsxWriteQueues.set(key, tail)

  await previous
  try {
    return await operation()
  } finally {
    release()
    if (titleXlsxWriteQueues.get(key) === tail) {
      titleXlsxWriteQueues.delete(key)
    }
  }
}

export async function writeTitlesXlsx(
  xlsxPath: string,
  generatedTitles: Map<string, string>,
  existingTitles: Map<string, string>,
  _workbenchRoot: string,
  xlsxTempFiles: TitleTempFileManager = tempFileManager,
) {
  return withTitleXlsxWriteLock(xlsxPath, async () => {
    const temporaryTaskId = `xlsx-${randomUUID()}`
    let temporaryDirectory = ''
    let temporaryDirectoryCreated = false
    let replacingTarget = false
    let operationFailed = false
    let operationError: unknown
    try {
      temporaryDirectory = await xlsxTempFiles.createTaskDir('title', temporaryTaskId)
      temporaryDirectoryCreated = true
      const temporaryPath = join(temporaryDirectory, basename(xlsxPath))
      const workbook = new ExcelJS.Workbook()
      const sheet = workbook.addWorksheet('Sheet')
      sheet.columns = [
        { header: '货号', key: 'sku', width: 30 },
        { header: '标题', key: 'title', width: 60 },
      ]

      const merged = new Map(existingTitles)
      for (const [sku, title] of await readExistingTitles(xlsxPath)) {
        merged.set(sku, title)
      }
      for (const [sku, title] of generatedTitles) {
        merged.set(sku, title)
      }

      const rows = Array.from(merged.entries()).sort(([left], [right]) =>
        naturalCompare(left, right),
      )
      for (const [sku, title] of rows) {
        sheet.addRow({ sku, title })
      }

      await workbook.xlsx.writeFile(temporaryPath)
      await mkdir(dirname(xlsxPath), { recursive: true })
      replacingTarget = true
      await rename(temporaryPath, xlsxPath)
    } catch (error) {
      operationFailed = true
      operationError = replacingTarget ? toXlsxWriteError(error) : error
    }
    if (temporaryDirectoryCreated) {
      try {
        await xlsxTempFiles.cleanupTask('title', temporaryTaskId)
      } catch (error) {
        if (!operationFailed) {
          operationFailed = true
          operationError = error
        }
      }
    }
    if (operationFailed) {
      throw operationError
    }
  })
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

function optionLabel(options: Array<{ key: string; label: string }>, key: string) {
  const label = options.find((item) => item.key === key)?.label
  return label ? `${label} (${key})` : key
}

function buildUserPrompt(platform: string, language: string, extraRequirement?: string) {
  const trimmed = extraRequirement?.trim()
  const lines = [
    `平台：${optionLabel(PLATFORM_OPTIONS, platform)}`,
    `标题语言：${optionLabel(LANGUAGE_OPTIONS, language)}`,
    '请根据图片生成一个适合跨境电商上架的标题。只输出最终标题。',
  ]
  if (!trimmed) {
    return lines.join('\n')
  }
  return [...lines, `额外要求：${trimmed}`].join('\n')
}

function createVisionMessages(
  skill: Skill,
  dataUrl: string,
  platform: string,
  language: string,
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
        { type: 'text', text: buildUserPrompt(platform, language, extraRequirement) },
      ],
    },
  ]
}

export async function selectTitleSkill(
  skillCache: Pick<typeof skillCacheManager, 'listSkills' | 'getSkill'>,
  platform: string,
  language: string,
) {
  const platformCandidates = platform === 'temu' ? ['temu', 'temu_pop', 'temu_full'] : [platform]
  const candidates = platformCandidates.map((candidate) => ({ platform: candidate, language }))
  if (
    !candidates.some(
      (candidate) => candidate.platform === 'generic' && candidate.language === 'generic',
    )
  ) {
    candidates.push({ platform: 'generic', language: 'generic' })
  }
  for (const candidate of candidates) {
    const summaries = await skillCache.listSkills({
      module: 'title',
      platform: candidate.platform,
      language: candidate.language,
    })
    const selected = summaries[0]
    if (selected) {
      return skillCache.getSkill(selected.id, selected.version)
    }
  }
  throw new AppErrorClass('HTTP_4XX', '未找到标题生成 Skill，请先在后台配置', false)
}

export function appErrorMessage(error: unknown) {
  if (error instanceof AppErrorClass) {
    return error.message
  }
  if (error instanceof Error) {
    return error.message
  }
  return String(error)
}

async function appendDiagnosticLog(
  diagnostics: DiagnosticLogWriter | null,
  event: Parameters<DiagnosticLogWriter['append']>[0],
) {
  await diagnostics?.append(event).catch(() => null)
}

export async function registerSkuTitle(
  db: Pick<SqliteDatabase, 'exec' | 'prepare'>,
  input: {
    batchDir: string
    skuCode: string
    title: string
    language: string
    platform: string
    skill: SkillSummary
    model: string
    generatedAt: number
  },
) {
  registerSkuTitles(db, {
    templateBatch: basename(input.batchDir),
    titles: new Map([[input.skuCode, input.title]]),
    language: input.language,
    platform: input.platform,
    skill: input.skill,
    model: input.model,
    generatedAt: input.generatedAt,
  })
}

function canRetry(error: unknown) {
  if (error instanceof AppErrorClass) {
    return error.retryable
  }
  return true
}

function isFatalTitleProviderError(error: unknown) {
  if (!(error instanceof AppErrorClass)) {
    return false
  }
  const status = error.details?.status
  return (
    error.code === 'BAILIAN_QUOTA_EXCEEDED' ||
    (error.code === 'HTTP_4XX' &&
      (status === undefined || (typeof status === 'number' && status >= 400 && status < 500)))
  )
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
  shouldContinue: () => boolean = () => true,
) {
  let nextIndex = 0
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (nextIndex < items.length && shouldContinue()) {
      const current = items[nextIndex]
      nextIndex += 1
      if (current !== undefined && shouldContinue()) {
        await worker(current)
      }
    }
  })
  await Promise.all(workers)
}

function openWorkbenchDatabase(workbenchRoot: string) {
  return openWorkbenchDatabaseFile(workbenchDatabasePath(workbenchRoot))
}

export function registerSkuTitles(
  db: Pick<SqliteDatabase, 'exec' | 'prepare'>,
  input: {
    templateBatch: string
    titles: Map<string, string>
    language: string
    platform: string
    skill: Pick<SkillSummary, 'id' | 'version'>
    model: string
    generatedAt: number
  },
) {
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
  private readonly activeTasks = new Set<string>()
  private readonly cancelledTasks = new Set<string>()

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

  async scanBatchDir(batchDir: string, titleFileName?: string): Promise<TitleScanResult> {
    const skuFolders = await scanSkuFolders(batchDir)
    const existingTitles = await readExistingTitles(
      await resolveTitleXlsxPath(batchDir, titleFileName),
    )
    return {
      skuCount: skuFolders.length,
      skuCodes: skuFolders.map((folder) => folder.skuCode),
      existingTitles: Object.fromEntries(existingTitles),
    }
  }

  cancelTask(taskId: string) {
    if (!this.activeTasks.has(taskId)) {
      return false
    }
    this.cancelledTasks.add(taskId)
    return true
  }

  private isCancelled(taskId: string) {
    return this.cancelledTasks.has(taskId)
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

  async createProcessingSession(
    config: TitleBatchConfig,
    dependencies: TitleServiceDependencies = {},
  ): Promise<TitleProcessingSession> {
    const taskId = config.taskId ?? randomUUID()
    this.activeTasks.add(taskId)
    this.cancelledTasks.delete(taskId)
    const ownsPool = !dependencies.preprocessPool
    let tempDirCreated = false
    let cleanedUp = false
    const resolved = {
      skillCache: dependencies.skillCache ?? skillCacheManager,
      createBailianAdapter: dependencies.createBailianAdapter,
      preprocessPool: dependencies.preprocessPool ?? new SharpPreprocessPool(),
      readConfig: dependencies.readConfig ?? readAppConfig,
      getSecret: dependencies.getSecret ?? getSecret,
      tempFileManager: dependencies.tempFileManager ?? tempFileManager,
    }

    const close = async (options?: { keepFailedTemp?: boolean | undefined }) => {
      if (cleanedUp) {
        return
      }
      cleanedUp = true
      if (ownsPool && 'close' in resolved.preprocessPool) {
        await resolved.preprocessPool.close()
      }
      if (tempDirCreated) {
        await resolved.tempFileManager.cleanupTask(
          'title',
          taskId,
          options?.keepFailedTemp !== undefined
            ? { keepIfFailed: options.keepFailedTemp }
            : undefined,
        )
      }
      this.activeTasks.delete(taskId)
      this.cancelledTasks.delete(taskId)
    }

    try {
      const workbenchConfig = await resolved.readConfig()
      if (!workbenchConfig.workbench_root) {
        throw new Error('workbench_root is required before title generation can run')
      }
      const workbenchRoot = workbenchConfig.workbench_root
      const diagnostics = await createOptionalDiagnosticLogWriter({
        module: 'title',
        taskId,
        workbenchRoot,
        meta: {
          batchDir: config.batchDir,
          titleFileName: config.titleFileName ?? null,
          platform: config.platform,
          language: config.language,
          model: config.model || DEFAULT_MODEL,
          imageIndex: config.imageIndex ?? 1,
          existingStrategy: config.existingStrategy ?? 'skip',
          maxRetries: config.maxRetries ?? null,
          concurrency: config.concurrency ?? null,
          preprocess: config.preprocess ?? null,
          keywordGroups: normalizeTitleKeywordGroups(config.keywordGroups),
          keywordGroupSeparator: config.keywordGroupSeparator ?? ' ',
        },
      })

      await resolved.tempFileManager.createTaskDir('title', taskId)
      tempDirCreated = true

      const skill = await selectTitleSkill(resolved.skillCache, config.platform, config.language)
      const model = config.model || skill.recommendedModel || DEFAULT_MODEL
      const apiKey = await resolved.getSecret('bailian')
      if (!apiKey) {
        throw new AppErrorClass('HTTP_4XX', '缺少阿里云百炼 API Key，请先在设置中填写', false)
      }
      const adapter = resolved.createBailianAdapter?.(apiKey) ?? createDefaultBailianAdapter(apiKey)
      const maxRetries = clampInt(config.maxRetries, 0, 5, 2)
      const imageIndex = clampInt(config.imageIndex, 1, Number.MAX_SAFE_INTEGER, 1)

      await appendDiagnosticLog(diagnostics, {
        type: 'config_resolved',
        provider: 'aliyun-bailian',
        operation: 'batch',
        data: {
          model,
          skill: {
            id: skill.id,
            version: skill.version,
            recommendedModel: skill.recommendedModel ?? null,
            platform: skill.platform ?? null,
            language: skill.language ?? null,
            systemPrompt: skill.systemPrompt,
            variables: skill.variables,
          },
          maxRetries,
          concurrency: config.concurrency ?? null,
          imageIndex,
          pendingCount: 1,
          keywordGroups: normalizeTitleKeywordGroups(config.keywordGroups),
          keywordGroupSeparator: config.keywordGroupSeparator ?? ' ',
        },
      })

      const resources: TitleProcessingResources = {
        config,
        taskId,
        model,
        skill,
        adapter,
        maxRetries,
        imageIndex,
        workbenchRoot,
        preprocessPool: resolved.preprocessPool,
        diagnostics,
      }

      return {
        taskId,
        model,
        skill,
        workbenchRoot,
        ...(diagnostics ? { diagnosticsLogPath: diagnostics.path } : {}),
        appendDiagnosticLog: async (event) => appendDiagnosticLog(diagnostics, event),
        generateSku: async (input) => {
          const result = await this.processSku({
            skuFolder: {
              skuCode: input.skuCode,
              path: input.skuFolder,
            },
            keywordGroup: input.keywordGroup,
            ...resources,
          })
          if (result.status === 'success') {
            return {
              skuCode: result.skuCode,
              status: 'success',
              baseTitle: parseTitle(result.title, config.language, config.platform),
              imagePath: result.imagePath,
              ...(result.warning ? { warning: result.warning } : {}),
            }
          }
          return result
        },
        close,
      }
    } catch (error) {
      await close({ keepFailedTemp: false })
      throw error
    }
  }

  async runTitleBatch(
    config: TitleBatchConfig,
    dependencies: TitleServiceDependencies = {},
  ): Promise<TitleBatchResult> {
    const taskId = config.taskId ?? randomUUID()
    this.activeTasks.add(taskId)
    this.cancelledTasks.delete(taskId)
    const ownsPool = !dependencies.preprocessPool
    let tempDirCreated = false
    let keepFailedTemp = false
    let diagnostics: DiagnosticLogWriter | null = null
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
      const workbenchRoot = workbenchConfig.workbench_root
      diagnostics = await createOptionalDiagnosticLogWriter({
        module: 'title',
        taskId,
        workbenchRoot,
        meta: {
          batchDir: config.batchDir,
          titleFileName: config.titleFileName ?? null,
          platform: config.platform,
          language: config.language,
          model: config.model || DEFAULT_MODEL,
          imageIndex: config.imageIndex ?? 1,
          existingStrategy: config.existingStrategy ?? 'skip',
          maxRetries: config.maxRetries ?? null,
          concurrency: config.concurrency ?? null,
          preprocess: config.preprocess ?? null,
          keywordGroups: normalizeTitleKeywordGroups(config.keywordGroups),
          keywordGroupSeparator: config.keywordGroupSeparator ?? ' ',
        },
      })

      await resolved.tempFileManager.createTaskDir('title', taskId)
      tempDirCreated = true

      const batchDirInfo = await stat(config.batchDir)
      if (!batchDirInfo.isDirectory()) {
        throw new Error('batchDir must be a directory')
      }

      const xlsxPath = await resolveTitleXlsxPath(config.batchDir, config.titleFileName)
      const existingTitles = await readExistingTitles(xlsxPath)
      const existingStrategy = config.existingStrategy ?? 'skip'
      const skuFilter = config.skuCodes ? new Set(config.skuCodes) : null
      const allSkuFolders = await scanSkuFolders(config.batchDir)
      const keywordGroups = normalizeTitleKeywordGroups(config.keywordGroups)
      const keywordAssignments = assignTitleKeywordGroups(
        allSkuFolders.map((folder) => folder.skuCode),
        keywordGroups,
      )
      const skuFolders = skuFilter
        ? allSkuFolders.filter((folder) => skuFilter.has(folder.skuCode))
        : allSkuFolders
      const total = skuFolders.length
      const results: TitleSkuResult[] = []
      const generatedTitles = new Map<string, string>()
      const progress: TitleProgress = {
        task_id: taskId,
        processed: 0,
        total,
        succeeded: 0,
        failed: 0,
        skipped: 0,
        ...(diagnostics ? { diagnosticsLogPath: diagnostics.path } : {}),
        status: 'running',
      }
      const emitProgress = () => dependencies.emitProgress?.({ ...progress })

      const pending: SkuFolder[] = []

      for (const skuFolder of skuFolders) {
        const existing = existingTitles.get(skuFolder.skuCode)
        if (existingStrategy === 'skip' && existing) {
          await appendDiagnosticLog(diagnostics, {
            type: 'decision',
            operation: 'skip_existing_title',
            itemKey: skuFolder.skuCode,
            data: {
              reason: 'existingStrategy=skip and title already exists',
              title: existing,
            },
          })
          results.push({ skuCode: skuFolder.skuCode, status: 'skipped', title: existing })
          progress.skipped += 1
          progress.processed += 1
          continue
        }
        pending.push(skuFolder)
      }

      emitProgress()

      if (pending.length === 0 || this.isCancelled(taskId)) {
        const cancelled = this.isCancelled(taskId)
        progress.status = cancelled ? 'cancelled' : 'running'
        emitProgress()
        await writeTitlesXlsx(
          xlsxPath,
          generatedTitles,
          existingTitles,
          workbenchConfig.workbench_root,
        )
        const emptyResult: TitleBatchResult = {
          taskId,
          xlsxPath,
          total,
          succeeded: 0,
          failed: 0,
          skipped: progress.skipped,
          results: results.sort((left, right) => naturalCompare(left.skuCode, right.skuCode)),
          ...(cancelled ? { cancelled } : {}),
          ...(diagnostics ? { diagnosticsLogPath: diagnostics.path } : {}),
        }
        await appendDiagnosticLog(diagnostics, {
          type: 'task_completed',
          operation: 'batch',
          data: emptyResult,
        })
        return emptyResult
      }

      const skill = await selectTitleSkill(resolved.skillCache, config.platform, config.language)
      const model = config.model || skill.recommendedModel || DEFAULT_MODEL
      const apiKey = await resolved.getSecret('bailian')
      if (!apiKey) {
        throw new AppErrorClass('HTTP_4XX', '缺少阿里云百炼 API Key，请先在设置中填写', false)
      }
      const adapter = resolved.createBailianAdapter?.(apiKey) ?? createDefaultBailianAdapter(apiKey)
      const maxRetries = clampInt(config.maxRetries, 0, 5, 2)
      const concurrency = clampInt(config.concurrency, 1, 20, 20)
      const imageIndex = clampInt(config.imageIndex, 1, Number.MAX_SAFE_INTEGER, 1)
      await appendDiagnosticLog(diagnostics, {
        type: 'config_resolved',
        provider: 'aliyun-bailian',
        operation: 'batch',
        data: {
          model,
          skill: {
            id: skill.id,
            version: skill.version,
            recommendedModel: skill.recommendedModel ?? null,
            platform: skill.platform ?? null,
            language: skill.language ?? null,
            systemPrompt: skill.systemPrompt,
            variables: skill.variables,
          },
          maxRetries,
          concurrency,
          imageIndex,
          pendingCount: pending.length,
          keywordGroups,
          keywordGroupSeparator: config.keywordGroupSeparator ?? ' ',
        },
      })

      await runWithConcurrency(
        pending,
        concurrency,
        async (skuFolder) => {
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
            diagnostics,
            keywordGroup: keywordAssignments.get(skuFolder.skuCode),
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
        },
        () => !this.isCancelled(taskId),
      )

      keepFailedTemp = progress.failed > 0
      const cancelled = this.isCancelled(taskId)
      progress.status = cancelled ? 'cancelled' : 'running'
      if (cancelled) {
        emitProgress()
      }
      const orderedGeneratedTitles = new Map(
        Array.from(generatedTitles.entries()).sort(([left], [right]) =>
          naturalCompare(left, right),
        ),
      )
      await writeTitlesXlsx(
        xlsxPath,
        orderedGeneratedTitles,
        existingTitles,
        workbenchConfig.workbench_root,
      )

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

      const finalResult: TitleBatchResult = {
        taskId,
        xlsxPath,
        total,
        succeeded: progress.succeeded,
        failed: progress.failed,
        skipped: progress.skipped,
        results: results.sort((left, right) => naturalCompare(left.skuCode, right.skuCode)),
        ...(cancelled ? { cancelled } : {}),
        ...(diagnostics ? { diagnosticsLogPath: diagnostics.path } : {}),
      }
      await appendDiagnosticLog(diagnostics, {
        type: 'task_completed',
        provider: 'aliyun-bailian',
        operation: 'batch',
        data: {
          total: finalResult.total,
          succeeded: finalResult.succeeded,
          failed: finalResult.failed,
          skipped: finalResult.skipped,
          cancelled: finalResult.cancelled ?? false,
          xlsxPath,
        },
      })
      return finalResult
    } catch (error) {
      await appendDiagnosticLog(diagnostics, {
        type: 'task_failed',
        provider: 'aliyun-bailian',
        operation: 'batch',
        error: errorForDiagnosticLog(error),
      })
      throw error
    } finally {
      if (ownsPool && 'close' in resolved.preprocessPool) {
        await resolved.preprocessPool.close()
      }

      if (tempDirCreated) {
        await resolved.tempFileManager.cleanupTask('title', taskId, {
          keepIfFailed: keepFailedTemp,
        })
      }
      this.activeTasks.delete(taskId)
      this.cancelledTasks.delete(taskId)
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
    diagnostics: DiagnosticLogWriter | null
    keywordGroup: TitleKeywordGroupAssignment | undefined
  }): Promise<Exclude<TitleSkuResult, { status: 'skipped' }>> {
    const selection = await getNthImageFromSkuFolder(input.skuFolder.path, input.imageIndex)
    if (!selection.imagePath) {
      await appendDiagnosticLog(input.diagnostics, {
        type: 'item_failed',
        provider: 'aliyun-bailian',
        operation: 'title',
        itemKey: input.skuFolder.skuCode,
        error: {
          code: 'NO_IMAGE',
          message: '货号文件夹没有可用图片',
        },
      })
      return {
        skuCode: input.skuFolder.skuCode,
        status: 'failed',
        error: 'NO_IMAGE',
      }
    }

    try {
      await appendDiagnosticLog(input.diagnostics, {
        type: 'item_started',
        provider: 'aliyun-bailian',
        operation: 'title',
        itemKey: input.skuFolder.skuCode,
        data: {
          skuFolder: input.skuFolder.path,
          imageIndex: input.imageIndex,
          warning: selection.warning ?? null,
          selectedImage: await fileDiagnosticMetadata(selection.imagePath).catch(() => ({
            path: selection.imagePath,
            name: basename(selection.imagePath),
          })),
          keywordGroup: input.keywordGroup ?? null,
        },
      })
      let attempt = 0
      const generated = await withRetries(input.maxRetries, async () => {
        attempt += 1
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
        try {
          await appendDiagnosticLog(input.diagnostics, {
            type: 'preprocess_request',
            provider: 'aliyun-bailian',
            operation: 'title',
            itemKey: input.skuFolder.skuCode,
            attempt,
            data: { options: preprocessOptions },
          })
          const preprocessed = await input.preprocessPool.process(preprocessOptions)
          const messages = createVisionMessages(
            input.skill,
            preprocessed.dataUrl,
            input.config.platform,
            input.config.language,
            input.config.extraRequirement,
          )
          await appendDiagnosticLog(input.diagnostics, {
            type: 'request',
            provider: 'aliyun-bailian',
            operation: 'title',
            itemKey: input.skuFolder.skuCode,
            attempt,
            data: {
              model: input.model,
              messages,
              preprocess: {
                output: await fileDiagnosticMetadata(preprocessed.outputPath).catch(() => ({
                  path: preprocessed.outputPath,
                  name: basename(preprocessed.outputPath),
                })),
                mimeType: preprocessed.mimeType,
                dataUrl: preprocessed.dataUrl,
              },
            },
          })
          let response: VisionResponse
          try {
            response = await input.adapter.visionCompletion({
              model: input.model,
              messages,
            })
          } finally {
            await rm(preprocessed.outputPath, { force: true }).catch(() => null)
          }
          await appendDiagnosticLog(input.diagnostics, {
            type: 'response',
            provider: 'aliyun-bailian',
            operation: 'title',
            itemKey: input.skuFolder.skuCode,
            attempt,
            data: {
              raw: response,
            },
          })

          const baseTitle = parseTitle(response.text, input.config.language, input.config.platform)
          if (!baseTitle) {
            await appendDiagnosticLog(input.diagnostics, {
              type: 'parse_failed',
              provider: 'aliyun-bailian',
              operation: 'title',
              itemKey: input.skuFolder.skuCode,
              attempt,
              data: {
                rawText: response.text,
              },
            })
            throw new AppErrorClass('HTTP_5XX', '模型返回空标题', true)
          }
          const title = joinTitleWithKeywordGroup(
            baseTitle,
            input.keywordGroup,
            input.config.keywordGroupSeparator,
          )
          await appendDiagnosticLog(input.diagnostics, {
            type: 'parse_result',
            provider: 'aliyun-bailian',
            operation: 'title',
            itemKey: input.skuFolder.skuCode,
            attempt,
            data: {
              rawText: response.text,
              title,
              keywordGroup: input.keywordGroup ?? null,
            },
          })
          return { title, baseTitle }
        } catch (error) {
          await appendDiagnosticLog(input.diagnostics, {
            type: 'attempt_failed',
            provider: 'aliyun-bailian',
            operation: 'title',
            itemKey: input.skuFolder.skuCode,
            attempt,
            error: errorForDiagnosticLog(error),
          })
          throw error
        }
      })
      await appendDiagnosticLog(input.diagnostics, {
        type: 'item_completed',
        provider: 'aliyun-bailian',
        operation: 'title',
        itemKey: input.skuFolder.skuCode,
        data: {
          title: generated.title,
          imagePath: selection.imagePath,
          warning: selection.warning ?? null,
        },
      })

      return {
        skuCode: input.skuFolder.skuCode,
        status: 'success',
        title: generated.title,
        baseTitle: generated.baseTitle,
        imagePath: selection.imagePath,
        ...(selection.warning ? { warning: selection.warning } : {}),
      }
    } catch (error) {
      await appendDiagnosticLog(input.diagnostics, {
        type: 'item_failed',
        provider: 'aliyun-bailian',
        operation: 'title',
        itemKey: input.skuFolder.skuCode,
        error: errorForDiagnosticLog(error),
      })
      const fatal = isFatalTitleProviderError(error)
      return {
        skuCode: input.skuFolder.skuCode,
        status: 'failed',
        error: appErrorMessage(error),
        imagePath: selection.imagePath,
        ...(selection.warning ? { warning: selection.warning } : {}),
        ...(fatal ? { fatal: true } : {}),
        ...(fatal && error instanceof AppErrorClass
          ? {
              appErrorCode: error.code,
              retryable: error.retryable,
              ...(error.details ? { errorDetails: error.details } : {}),
            }
          : {}),
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
  const config = await readAppConfig()
  if (!config.workbench_root) {
    throw new AppErrorClass('HTTP_4XX', '请先在设置里选择工作区', false)
  }
  await assertPathInsideWorkbench(config.workbench_root, path, {
    domain: 'visible-workbench',
    label: '标题打开路径',
  })
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
    const config = await readAppConfig()
    const result = await dialog.showOpenDialog({
      ...(config.workbench_root
        ? { defaultPath: join(config.workbench_root, WORKBENCH_DIRECTORIES.listing) }
        : {}),
      properties: ['openDirectory'],
      title: '选择货号父目录',
    })
    if (result.canceled || !result.filePaths[0]) {
      return { ok: false, error: { code: 'CANCELLED', message: '已取消选择目录' } }
    }
    return { ok: true, data: { path: result.filePaths[0] } }
  })
  ipcMain.handle('title:scan-batch-dir', async (_event, input: unknown) => {
    const parsed = parseTitleIpcInput(titleScanBatchDirInputSchema, input, '标题扫描目录参数不正确')
    const config = await readAppConfig()
    if (!config.workbench_root) {
      throw new AppErrorClass('HTTP_4XX', '请先在设置里选择工作区', false)
    }
    await assertPathInsideWorkbench(config.workbench_root, parsed.batchDir, {
      domain: 'listing',
      label: '标题批次目录',
    })
    return titleService.scanBatchDir(parsed.batchDir, parsed.titleFileName)
  })
  ipcMain.handle('title:run', async (_event, input: unknown) => {
    const parsed = parseTitleIpcInput(titleBatchConfigSchema, input, '标题任务参数不正确')
    const config = await readAppConfig()
    if (!config.workbench_root) {
      throw new AppErrorClass('HTTP_4XX', '请先在设置里选择工作区', false)
    }
    await assertPathInsideWorkbench(config.workbench_root, parsed.batchDir, {
      domain: 'listing',
      label: '标题批次目录',
    })
    return titleService.startBatch(parsed, emitTitleProgress, emitTitleCompleted)
  })
  ipcMain.handle('title:cancel', (_event, input: unknown) => ({
    ok: titleService.cancelTask(
      parseTitleIpcInput(titleTaskIdInputSchema, input, '标题取消参数不正确').task_id,
    ),
  }))
  ipcMain.handle('title:retry-failed', (_event, input: unknown) =>
    titleService.retryFailed(
      parseTitleIpcInput(titleTaskIdInputSchema, input, '标题重试参数不正确').task_id,
      emitTitleProgress,
      emitTitleCompleted,
    ),
  )
  ipcMain.handle('title:get-result', (_event, input: unknown) =>
    titleService.getResult(
      parseTitleIpcInput(titleGetResultInputSchema, input, '标题结果查询参数不正确'),
    ),
  )
  ipcMain.handle('title:open-path', (_event, input: unknown) =>
    openPath(parseTitleIpcInput(titleOpenPathInputSchema, input, '标题打开路径参数不正确').path),
  )
}
