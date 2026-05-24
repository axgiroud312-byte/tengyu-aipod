import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises'
import { extname, join } from 'node:path'
import { AppErrorClass } from '@tengyu-aipod/shared'
import type Database from 'better-sqlite3'
import { BrowserWindow, ipcMain } from 'electron'
import { z } from 'zod'
import type { CollectionPlatformRule } from './collection-injected-script'
import {
  type CollectionRecordInput,
  insertCollectionRecord,
  openCollectionDatabase,
} from './collection-record-store'
import {
  type CollectionSession,
  type CollectionSessionManager,
  collectionSessionManager,
} from './collection-session-manager'

export type CollectionClickEvent = {
  kind: 'click'
  img: string
  goodsLink?: string | undefined
  page: string
  platform?: string | undefined
}

export type CollectionClickResult =
  | {
      status: 'success'
      record: CollectionRecordInput
      savedPath: string
    }
  | {
      status: 'skipped'
      record: CollectionRecordInput
      savedPath: string
      reason: string
    }
  | {
      status: 'pending_sku'
      goodsLink: string
    }
  | {
      status: 'failed'
      record: CollectionRecordInput
      error: string
    }

export type CollectionClickServiceDependencies = {
  sessionManager?: Pick<
    CollectionSessionManager,
    'assignSessionSku' | 'getActiveSession' | 'getSessionSku' | 'requestSku'
  >
  downloadImage?: (url: string) => Promise<Buffer>
  openDatabase?: (workbenchRoot: string) => Pick<Database.Database, 'exec' | 'prepare' | 'close'>
  randomId?: () => string
  now?: () => number
  readFile?: typeof readFile
  readdir?: typeof readdir
  writeFile?: typeof writeFile
  stat?: typeof stat
  mkdir?: typeof mkdir
}

export class CollectionClickService {
  private readonly sessionManager: Pick<
    CollectionSessionManager,
    'assignSessionSku' | 'getActiveSession' | 'getSessionSku' | 'requestSku'
  >
  private readonly downloadImage: (url: string) => Promise<Buffer>
  private readonly openDatabase: (
    workbenchRoot: string,
  ) => Pick<Database.Database, 'exec' | 'prepare' | 'close'>
  private readonly randomId: () => string
  private readonly now: () => number
  private readonly readFile: typeof readFile
  private readonly readdir: typeof readdir
  private readonly writeFile: typeof writeFile
  private readonly stat: typeof stat
  private readonly mkdir: typeof mkdir
  private readonly pendingGoodsClicks = new Map<
    string,
    Array<{ event: CollectionClickEvent; platformRule: CollectionPlatformRule }>
  >()

  constructor(dependencies: CollectionClickServiceDependencies = {}) {
    this.sessionManager = dependencies.sessionManager ?? collectionSessionManager
    this.downloadImage = dependencies.downloadImage ?? defaultDownloadImage
    this.openDatabase = dependencies.openDatabase ?? openCollectionDatabase
    this.randomId = dependencies.randomId ?? randomUUID
    this.now = dependencies.now ?? Date.now
    this.readFile = dependencies.readFile ?? readFile
    this.readdir = dependencies.readdir ?? readdir
    this.writeFile = dependencies.writeFile ?? writeFile
    this.stat = dependencies.stat ?? stat
    this.mkdir = dependencies.mkdir ?? mkdir
  }

  async handleClick(event: CollectionClickEvent, platformRule: CollectionPlatformRule) {
    const session = this.sessionManager.getActiveSession()
    if (!session || session.status !== 'active') {
      throw new AppErrorClass('HTTP_4XX', '当前没有活动采集会话', false, {
        kind: 'state_conflict',
      })
    }
    if (session.mode !== 'click') {
      throw new AppErrorClass('HTTP_4XX', '当前采集会话不是点击模式', false, {
        kind: 'state_conflict',
        mode: session.mode,
      })
    }

    const goodsLink = event.goodsLink?.trim() || null
    const skuCode = goodsLink ? this.sessionManager.getSessionSku(goodsLink) : null
    const isGoodsPage = matchesGoodsPage(event.page, platformRule)

    if (isGoodsPage && goodsLink && !skuCode) {
      const pendingClicks = this.pendingGoodsClicks.get(goodsLink) ?? []
      pendingClicks.push({ event, platformRule })
      this.pendingGoodsClicks.set(goodsLink, pendingClicks)
      if (pendingClicks.length === 1) {
        this.sessionManager.requestSku(goodsLink, event.img)
      }
      return { status: 'pending_sku', goodsLink } satisfies CollectionClickResult
    }

    const createdAt = this.now()
    const target = targetForClick({ session, skuCode, platformRule, isGoodsPage, createdAt })
    return this.saveImage({
      session,
      event,
      skuCode: target.skuCode,
      targetDir: target.targetDir,
      fileBase: target.fileBase,
      createdAt,
      ...(target.reason ? { reason: target.reason } : {}),
    })
  }

  async assignSkuAndSavePending(goodsLink: string, skuCode: string) {
    this.sessionManager.assignSessionSku(goodsLink, skuCode)
    const pendingClicks = this.pendingGoodsClicks.get(goodsLink) ?? []
    this.pendingGoodsClicks.delete(goodsLink)
    const results: CollectionClickResult[] = []
    for (const pending of pendingClicks) {
      results.push(await this.handleClick(pending.event, pending.platformRule))
    }
    return { ok: true, results }
  }

  private async saveImage(input: {
    session: CollectionSession
    event: CollectionClickEvent
    skuCode: string | null
    targetDir: string
    fileBase: string
    reason?: string
    createdAt: number
  }): Promise<CollectionClickResult> {
    try {
      const buffer = await this.downloadImage(input.event.img)
      const hash = sha256(buffer)
      await this.mkdir(input.targetDir, { recursive: true })
      const existing = await findExistingImageByHash(
        input.targetDir,
        hash,
        this.readdir,
        this.readFile,
      )
      if (existing) {
        const record = this.record({
          session: input.session,
          event: input.event,
          skuCode: input.skuCode,
          savedPath: existing,
          status: 'skipped',
          reason: 'dedup',
          fileSize: buffer.byteLength,
          createdAt: input.createdAt,
        })
        return { status: 'skipped', record, savedPath: existing, reason: 'dedup' }
      }

      const savedPath = await nextImagePath(
        input.targetDir,
        input.fileBase,
        imageExtension(input.event.img),
        this.stat,
      )
      await this.writeFile(savedPath, buffer)
      const info = await this.stat(savedPath)
      const record = this.record({
        session: input.session,
        event: input.event,
        skuCode: input.skuCode,
        savedPath,
        status: 'success',
        fileSize: info.size,
        createdAt: input.createdAt,
        ...(input.reason ? { reason: input.reason } : {}),
      })
      return { status: 'success', record, savedPath }
    } catch (error) {
      const record = this.record({
        session: input.session,
        event: input.event,
        skuCode: input.skuCode,
        savedPath: null,
        status: 'failed',
        reason: appErrorMessage(error),
        fileSize: null,
        createdAt: input.createdAt,
      })
      return { status: 'failed', record, error: appErrorMessage(error) }
    }
  }

  private record(input: {
    session: CollectionSession
    event: CollectionClickEvent
    skuCode: string | null
    savedPath: string | null
    status: 'success' | 'skipped' | 'failed'
    reason?: string | null
    fileSize?: number | null
    createdAt: number
  }) {
    const record: CollectionRecordInput = {
      id: this.randomId(),
      sessionId: input.session.id,
      skuCode: input.skuCode,
      sourceUrl: input.event.img,
      goodsLink: input.event.goodsLink ?? null,
      pageUrl: input.event.page,
      savedPath: input.savedPath,
      status: input.status,
      reason: input.reason ?? null,
      fileSize: input.fileSize ?? null,
      createdAt: input.createdAt,
    }
    const db = this.openDatabase(workbenchRootFromOutput(input.session.output_dir))
    try {
      insertCollectionRecord(db, record)
    } finally {
      db.close()
    }
    return record
  }
}

function targetForClick(input: {
  session: CollectionSession
  skuCode: string | null
  platformRule: CollectionPlatformRule
  isGoodsPage: boolean
  createdAt: number
}) {
  if (input.isGoodsPage && input.skuCode) {
    return {
      skuCode: input.skuCode,
      targetDir: join(input.session.output_dir, input.skuCode),
      fileBase: input.skuCode,
    }
  }

  return {
    skuCode: null,
    targetDir: join(input.session.output_dir, '散图池'),
    fileBase: `${input.platformRule.key}-${timestampSlug(input.createdAt)}`,
    reason: input.isGoodsPage ? 'sku_required' : 'not_goods_page',
  }
}

function matchesGoodsPage(pageUrl: string, platformRule: CollectionPlatformRule) {
  return platformRule.goods_url_patterns.some((pattern) => {
    try {
      return new RegExp(pattern).test(pageUrl)
    } catch {
      return pageUrl.includes(pattern)
    }
  })
}

async function defaultDownloadImage(url: string) {
  if (url.startsWith('file://')) {
    return readFile(new URL(url))
  }
  const response = await fetch(url)
  if (!response.ok) {
    throw new AppErrorClass('HTTP_5XX', '下载采集原图失败', true, {
      status: response.status,
      url,
    })
  }
  return Buffer.from(await response.arrayBuffer())
}

async function findExistingImageByHash(
  folder: string,
  hash: string,
  readdirFn: typeof readdir,
  readFileFn: typeof readFile,
) {
  const entries = await readdirFn(folder, { withFileTypes: true }).catch(() => [])
  for (const entry of entries) {
    if (!entry.isFile() || !/\.(?:jpe?g|png|webp)$/i.test(entry.name)) {
      continue
    }
    const candidate = join(folder, entry.name)
    try {
      const buffer = await readFileFn(candidate)
      if (sha256(buffer) === hash) {
        return candidate
      }
    } catch {}
  }
  return null
}

async function nextImagePath(folder: string, baseName: string, ext: string, statFn: typeof stat) {
  for (let index = 1; index <= 9999; index += 1) {
    const candidate = join(folder, `${baseName}-${String(index).padStart(3, '0')}${ext}`)
    try {
      await statFn(candidate)
    } catch {
      return candidate
    }
  }
  throw new AppErrorClass('HTTP_4XX', '采集文件序号已达上限', false, { folder })
}

function imageExtension(url: string) {
  const pathname = url.includes('://') ? new URL(url).pathname : url
  const ext = extname(pathname).toLowerCase()
  return ['.jpg', '.jpeg', '.png', '.webp'].includes(ext) ? ext : '.jpg'
}

function sha256(buffer: Buffer) {
  return createHash('sha256').update(buffer).digest('hex')
}

function timestampSlug(value: number) {
  const date = new Date(value)
  const pad = (item: number) => String(item).padStart(2, '0')
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`
}

function appErrorMessage(error: unknown) {
  if (error instanceof Error) {
    return error.message
  }
  return String(error)
}

function workbenchRootFromOutput(outputDir: string) {
  return outputDir.endsWith('/01-采集') || outputDir.endsWith('\\01-采集')
    ? outputDir.slice(0, -'01-采集'.length - 1)
    : outputDir
}

export const collectionClickService = new CollectionClickService()

const CollectionClickIpcSchema = z.object({
  event: z.object({
    kind: z.literal('click'),
    img: z.string().min(1),
    goodsLink: z.string().optional(),
    page: z.string().min(1),
    platform: z.string().optional(),
  }),
  platformRule: z.object({
    key: z.string().min(1),
    name: z.string().min(1),
    allowed_domains: z.array(z.string()),
    entry_url: z.string(),
    goods_url_patterns: z.array(z.string()),
    login_check: z
      .object({
        indicators: z.array(z.string()),
        inverse: z.array(z.string()).optional(),
      })
      .optional(),
    original_image_resolver: z.union([
      z.object({
        type: z.literal('src_replace'),
        config: z.object({ from: z.string().optional(), to: z.string().optional() }),
      }),
      z.object({
        type: z.literal('data_attr'),
        config: z.object({ attr: z.string().optional() }),
      }),
      z.object({
        type: z.literal('srcset_largest'),
        config: z.record(z.unknown()).optional(),
      }),
    ]),
  }),
})

function emitCollectionEvent(event: unknown) {
  for (const window of BrowserWindow.getAllWindows()) {
    window.webContents.send('collection:event', event)
  }
}

const CollectionSkuInputSchema = z.object({
  goods_link: z.string().min(1),
  sku_code: z.string().min(1),
})

export function registerCollectionClickIpc() {
  ipcMain.handle('collection:set-sku', async (_event, input: unknown) => {
    const parsed = CollectionSkuInputSchema.safeParse(input)
    if (!parsed.success) {
      throw new AppErrorClass('HTTP_4XX', '货号参数不正确', false, {
        kind: 'validation',
        issues: parsed.error.issues,
      })
    }
    const result = await collectionClickService.assignSkuAndSavePending(
      parsed.data.goods_link,
      parsed.data.sku_code,
    )
    for (const item of result.results) {
      if ('record' in item) {
        emitCollectionEvent({ type: 'image-saved', record: item.record })
      }
    }
    return result
  })

  ipcMain.handle('collection:handle-click', async (_event, input: unknown) => {
    const parsed = CollectionClickIpcSchema.safeParse(input)
    if (!parsed.success) {
      throw new AppErrorClass('HTTP_4XX', '点击采集参数不正确', false, {
        kind: 'validation',
        issues: parsed.error.issues,
      })
    }
    const rawEvent = parsed.data.event
    const rawRule = parsed.data.platformRule
    const platformRule: CollectionPlatformRule = normalizePlatformRule(rawRule)
    const result = await collectionClickService.handleClick(
      {
        kind: rawEvent.kind,
        img: rawEvent.img,
        page: rawEvent.page,
        ...(rawEvent.goodsLink ? { goodsLink: rawEvent.goodsLink } : {}),
        ...(rawEvent.platform ? { platform: rawEvent.platform } : {}),
      },
      platformRule,
    )
    if ('record' in result) {
      emitCollectionEvent({ type: 'image-saved', record: result.record })
    }
    return result
  })
}

function normalizePlatformRule(rawRule: z.infer<typeof CollectionClickIpcSchema>['platformRule']) {
  return {
    key: rawRule.key,
    name: rawRule.name,
    allowed_domains: rawRule.allowed_domains,
    entry_url: rawRule.entry_url,
    goods_url_patterns: rawRule.goods_url_patterns,
    original_image_resolver: normalizeOriginalImageResolver(rawRule.original_image_resolver),
    ...(rawRule.login_check ? { login_check: normalizeLoginCheck(rawRule.login_check) } : {}),
  } satisfies CollectionPlatformRule
}

function normalizeLoginCheck(
  loginCheck: NonNullable<z.infer<typeof CollectionClickIpcSchema>['platformRule']['login_check']>,
) {
  return {
    indicators: loginCheck.indicators,
    ...(loginCheck.inverse ? { inverse: loginCheck.inverse } : {}),
  } satisfies CollectionPlatformRule['login_check']
}

function normalizeOriginalImageResolver(
  resolver: z.infer<typeof CollectionClickIpcSchema>['platformRule']['original_image_resolver'],
) {
  if (resolver.type === 'src_replace') {
    return {
      type: resolver.type,
      config: {
        ...(resolver.config.from ? { from: resolver.config.from } : {}),
        ...(resolver.config.to ? { to: resolver.config.to } : {}),
      },
    } satisfies CollectionPlatformRule['original_image_resolver']
  }
  if (resolver.type === 'data_attr') {
    return {
      type: resolver.type,
      config: {
        ...(resolver.config.attr ? { attr: resolver.config.attr } : {}),
      },
    } satisfies CollectionPlatformRule['original_image_resolver']
  }
  return {
    type: resolver.type,
    ...(resolver.config ? { config: resolver.config } : {}),
  } satisfies CollectionPlatformRule['original_image_resolver']
}
