import { createHash, randomUUID } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { access, readFile, writeFile } from 'node:fs/promises'
import { basename, join, resolve } from 'node:path'
import {
  AppErrorClass,
  type PhotoshopClipMode,
  type PsdBounds,
  type PsdClipArea,
  type PsdGuides,
  type PsdLayerInfo,
  type PsdSmartObject,
  type PsdTemplate,
  type PsdTextLayer,
  type SmartObjectMode,
} from '@tengyu-aipod/shared'
import { type TempFileManager, tempFileManager } from '../lib/temp-file-manager'
import { type PhotoshopComAdapter, photoshopComAdapter } from './com-adapter'
import { renderPsdScanJsx } from './psd-scan-jsx'
import { type PsdTemplateCache, psdTemplateCache } from './psd-template-cache'

type TextReader = (path: string, encoding: BufferEncoding) => Promise<string>
type TextWriter = (path: string, data: string, encoding: BufferEncoding) => Promise<void>

interface PsdScannerOptions {
  platform?: NodeJS.Platform
  comAdapter?: Pick<PhotoshopComAdapter, 'runJsxFile'>
  tempFiles?: Pick<TempFileManager, 'createTaskDir' | 'cleanupTask'>
  cache?: PsdTemplateCache
  now?: () => number
  hashFile?: (path: string) => Promise<string>
  readTextFile?: TextReader
  writeTextFile?: TextWriter
  taskIdFactory?: (fileHash: string) => string
}

interface RawPsdScanResult {
  ok?: boolean
  error?: string
  file?: string
  doc_size?: { w?: unknown; h?: unknown }
  smart_objects?: unknown
  guides?: unknown
  clip_areas?: unknown
  layers?: unknown
  text_layers?: unknown
}

const FULL_AREA_FLAG = 'full'

export async function hashFile(path: string): Promise<string> {
  return new Promise((resolveHash, reject) => {
    const hash = createHash('sha256')
    const stream = createReadStream(path)
    stream.on('error', reject)
    stream.on('data', (chunk) => hash.update(chunk))
    stream.on('end', () => resolveHash(hash.digest('hex')))
  })
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message
  }
  return String(error)
}

function asFiniteNumber(value: unknown, label: string): number {
  const number = Number(value)
  if (!Number.isFinite(number)) {
    throw new AppErrorClass('TEMPLATE_SCAN_FAILED', `PSD 扫描结果字段无效：${label}`, false, {
      value,
    })
  }
  return number
}

function asBounds(value: unknown, label: string): PsdBounds {
  if (!Array.isArray(value) || value.length !== 4) {
    throw new AppErrorClass('TEMPLATE_SCAN_FAILED', `PSD 图层 bounds 无效：${label}`, false, {
      value,
    })
  }
  return [
    asFiniteNumber(value[0], `${label}[0]`),
    asFiniteNumber(value[1], `${label}[1]`),
    asFiniteNumber(value[2], `${label}[2]`),
    asFiniteNumber(value[3], `${label}[3]`),
  ]
}

function normalizeSmartObjectName(name: string): string {
  return name
    .replace(/\s+copy(\s+\d+)?$/i, '')
    .replace(/\s+\d+$/i, '')
    .trim()
    .toLowerCase()
}

function sharedIndicatorFor(name: string, bounds: PsdBounds): string {
  return createHash('sha1')
    .update(`${normalizeSmartObjectName(name)}|${bounds.join(',')}`)
    .digest('hex')
    .slice(0, 16)
}

export function detectSmartObjectMode(smartObjects: PsdSmartObject[]): SmartObjectMode {
  if (smartObjects.length === 0) {
    return 'none'
  }
  if (smartObjects.length === 1) {
    return 'single'
  }
  const uniqueIndicators = new Set(smartObjects.map((smartObject) => smartObject.shared_indicator))
  return uniqueIndicators.size < smartObjects.length ? 'shared' : 'independent'
}

export function representativeSoCount(
  smartObjects: PsdSmartObject[],
  range: 'auto' | 'top' | 'all' = 'auto',
): number {
  const topLevel = smartObjects.filter((smartObject) => smartObject.is_top_level)
  if (range === 'top') {
    return topLevel.length
  }
  if (range === 'all') {
    return new Set(smartObjects.map((smartObject) => smartObject.shared_indicator)).size
  }
  return topLevel.length > 0
    ? topLevel.length
    : new Set(smartObjects.map((smartObject) => smartObject.shared_indicator)).size
}

function uniqueSorted(values: number[], maxValue: number): number[] {
  return [...new Set(values.map(Math.round).filter((value) => value > 0 && value < maxValue))].sort(
    (a, b) => a - b,
  )
}

function fullClipArea(docSize: { w: number; h: number }): PsdClipArea {
  return { x: 0, y: 0, w: docSize.w, h: docSize.h, is_full: true }
}

function deriveClipAreasFromGuides(
  guides: PsdGuides,
  docSize: { w: number; h: number },
): PsdClipArea[] {
  const vertical = uniqueSorted(guides.vertical, docSize.w)
  const horizontal = uniqueSorted(guides.horizontal, docSize.h)
  if (vertical.length === 0 && horizontal.length === 0) {
    return []
  }

  const xs = [0, ...vertical, docSize.w]
  const ys = [0, ...horizontal, docSize.h]
  const areas: PsdClipArea[] = []
  for (let y = 0; y < ys.length - 1; y += 1) {
    for (let x = 0; x < xs.length - 1; x += 1) {
      const left = xs[x] ?? 0
      const top = ys[y] ?? 0
      const right = xs[x + 1] ?? docSize.w
      const bottom = ys[y + 1] ?? docSize.h
      const width = right - left
      const height = bottom - top
      if (width > 0 && height > 0) {
        areas.push({ x: left, y: top, w: width, h: height, is_full: false })
      }
    }
  }
  return areas
}

function areaFromBounds(bounds: PsdBounds): PsdClipArea | null {
  const [left, top, right, bottom] = bounds
  const width = right - left
  const height = bottom - top
  if (width <= 0 || height <= 0) {
    return null
  }
  return { x: left, y: top, w: width, h: height, is_full: false }
}

function deriveClipAreasFromSoAncestors(
  smartObjects: PsdSmartObject[],
  layers: PsdLayerInfo[] = [],
): PsdClipArea[] {
  const groupLayers = layers.filter((layer) => layer.is_group && layer.bounds)
  const areas: PsdClipArea[] = []

  for (const smartObject of smartObjects) {
    const ancestors = groupLayers
      .filter((layer) => smartObject.path.startsWith(`${layer.path}/`))
      .sort((left, right) => right.path.length - left.path.length)
    const nearestBounds = ancestors[0]?.bounds
    if (!nearestBounds) {
      continue
    }
    const area = areaFromBounds(nearestBounds)
    if (!area) {
      continue
    }
    const isDuplicate = areas.some(
      (existing) =>
        existing.x === area.x &&
        existing.y === area.y &&
        existing.w === area.w &&
        existing.h === area.h,
    )
    if (!isDuplicate) {
      areas.push(area)
    }
  }

  return areas
}

interface ClipAreaSource {
  doc_size: { w: number; h: number }
  guides: PsdGuides
  smart_objects?: PsdSmartObject[]
  layers?: PsdLayerInfo[]
}

export function deriveClipAreas(
  scanResult: ClipAreaSource,
  mode: PhotoshopClipMode = 'auto',
): PsdClipArea[] {
  if (mode === 'none') {
    return [fullClipArea(scanResult.doc_size)]
  }

  const guideAreas = deriveClipAreasFromGuides(scanResult.guides, scanResult.doc_size)
  if (guideAreas.length > 0) {
    return guideAreas
  }

  if (mode === 'auto') {
    const ancestorAreas = deriveClipAreasFromSoAncestors(
      scanResult.smart_objects ?? [],
      scanResult.layers ?? [],
    )
    if (ancestorAreas.length > 0) {
      return ancestorAreas
    }
  }

  return [fullClipArea(scanResult.doc_size)]
}

function normalizeGuides(value: unknown): PsdGuides {
  if (!value || typeof value !== 'object') {
    return { horizontal: [], vertical: [] }
  }
  const guides = value as { horizontal?: unknown; vertical?: unknown }
  return {
    horizontal: Array.isArray(guides.horizontal)
      ? guides.horizontal.map((item, index) => asFiniteNumber(item, `guides.horizontal[${index}]`))
      : [],
    vertical: Array.isArray(guides.vertical)
      ? guides.vertical.map((item, index) => asFiniteNumber(item, `guides.vertical[${index}]`))
      : [],
  }
}

function normalizeSmartObjects(value: unknown): PsdSmartObject[] {
  if (!Array.isArray(value)) {
    return []
  }

  return value.map((item, index) => {
    if (!item || typeof item !== 'object') {
      throw new AppErrorClass('TEMPLATE_SCAN_FAILED', 'PSD 智能对象扫描结果无效', false, {
        index,
      })
    }
    const smartObject = item as Record<string, unknown>
    const name = String(smartObject.name ?? '')
    const bounds = asBounds(smartObject.bounds, `smart_objects[${index}].bounds`)
    return {
      name,
      path: String(smartObject.path ?? name),
      sort_order: Number.isInteger(smartObject.sort_order) ? Number(smartObject.sort_order) : index,
      is_top_level: Boolean(smartObject.is_top_level),
      bounds,
      shared_indicator: sharedIndicatorFor(name, bounds),
    }
  })
}

function normalizeClipAreas(value: unknown, scanResult: ClipAreaSource) {
  if (!Array.isArray(value) || value.length === 0) {
    return deriveClipAreas(scanResult, 'auto')
  }

  return value.map((item, index) => {
    if (!item || typeof item !== 'object') {
      throw new AppErrorClass('TEMPLATE_SCAN_FAILED', 'PSD 裁切区扫描结果无效', false, { index })
    }
    const area = item as Record<string, unknown>
    return {
      x: asFiniteNumber(area.x, `clip_areas[${index}].x`),
      y: asFiniteNumber(area.y, `clip_areas[${index}].y`),
      w: asFiniteNumber(area.w, `clip_areas[${index}].w`),
      h: asFiniteNumber(area.h, `clip_areas[${index}].h`),
      is_full:
        area.is_full === true ||
        `${area.x},${area.y},${area.w},${area.h}` ===
          `0,0,${scanResult.doc_size.w},${scanResult.doc_size.h}` ||
        area.name === FULL_AREA_FLAG,
    }
  })
}

function normalizeLayers(value: unknown): PsdLayerInfo[] {
  if (!Array.isArray(value)) {
    return []
  }
  return value.map((item, index) => {
    const layer = item as Record<string, unknown>
    const normalized: PsdLayerInfo = {
      name: String(layer.name ?? ''),
      path: String(layer.path ?? layer.name ?? ''),
      typename: String(layer.typename ?? ''),
      is_group: Boolean(layer.is_group),
      is_smart_object: Boolean(layer.is_smart_object),
      is_text: Boolean(layer.is_text),
    }
    if (Array.isArray(layer.bounds)) {
      normalized.bounds = asBounds(layer.bounds, `layers[${index}].bounds`)
    }
    return normalized
  })
}

function normalizeTextLayers(value: unknown): PsdTextLayer[] {
  if (!Array.isArray(value)) {
    return []
  }
  return value.map((item, index) => {
    const layer = item as Record<string, unknown>
    const normalized: PsdTextLayer = {
      name: String(layer.name ?? ''),
      path: String(layer.path ?? layer.name ?? ''),
      text: String(layer.text ?? ''),
    }
    if (Array.isArray(layer.bounds)) {
      normalized.bounds = asBounds(layer.bounds, `text_layers[${index}].bounds`)
    }
    return normalized
  })
}

export function buildPsdTemplateFromScanResult(
  raw: RawPsdScanResult,
  options: { psdPath: string; fileHash: string; scannedAt: number },
): PsdTemplate {
  if (raw.ok === false || raw.error) {
    throw new AppErrorClass(
      'TEMPLATE_SCAN_FAILED',
      `PSD 模板扫描失败：${raw.error ?? '未知错误'}`,
      false,
      { psd_path: options.psdPath },
    )
  }

  const docSize = {
    w: asFiniteNumber(raw.doc_size?.w, 'doc_size.w'),
    h: asFiniteNumber(raw.doc_size?.h, 'doc_size.h'),
  }
  const smartObjects = normalizeSmartObjects(raw.smart_objects)
  const guides = normalizeGuides(raw.guides)
  const layers = normalizeLayers(raw.layers)
  const clipAreas = normalizeClipAreas(raw.clip_areas, {
    doc_size: docSize,
    guides,
    smart_objects: smartObjects,
    layers,
  })
  const mode = detectSmartObjectMode(smartObjects)

  return {
    id: `psd_${options.fileHash.slice(0, 24)}`,
    file_path: options.psdPath,
    file_hash: options.fileHash,
    doc_size: docSize,
    smart_objects: smartObjects,
    guides,
    clip_areas: clipAreas,
    mode,
    representative_so_count: representativeSoCount(smartObjects),
    scanned_at: options.scannedAt,
    layers,
    text_layers: normalizeTextLayers(raw.text_layers),
  }
}

export class PsdScanner {
  private readonly platform: NodeJS.Platform
  private readonly comAdapter: Pick<PhotoshopComAdapter, 'runJsxFile'>
  private readonly tempFiles: Pick<TempFileManager, 'createTaskDir' | 'cleanupTask'>
  private readonly cache: PsdTemplateCache
  private readonly now: () => number
  private readonly hashFile: (path: string) => Promise<string>
  private readonly readTextFile: TextReader
  private readonly writeTextFile: TextWriter
  private readonly taskIdFactory: (fileHash: string) => string

  constructor(options: PsdScannerOptions = {}) {
    this.platform = options.platform ?? process.platform
    this.comAdapter = options.comAdapter ?? photoshopComAdapter
    this.tempFiles = options.tempFiles ?? tempFileManager
    this.cache = options.cache ?? psdTemplateCache
    this.now = options.now ?? Date.now
    this.hashFile = options.hashFile ?? hashFile
    this.readTextFile = options.readTextFile ?? readFile
    this.writeTextFile = options.writeTextFile ?? writeFile
    this.taskIdFactory =
      options.taskIdFactory ??
      ((fileHash) => `scan-${fileHash.slice(0, 12)}-${randomUUID().slice(0, 8)}`)
  }

  async scanPsd(psdPath: string): Promise<PsdTemplate> {
    this.assertWindows()

    const absolutePsdPath = resolve(psdPath)
    await access(absolutePsdPath)
    const fileHash = await this.hashFile(absolutePsdPath)
    const cached = await this.cache.findByHash(fileHash)
    if (cached) {
      return cached
    }

    const taskId = this.taskIdFactory(fileHash)
    const taskDir = await this.tempFiles.createTaskDir('photoshop', taskId)
    const jsxPath = join(taskDir, 'scan.jsx')
    const resultPath = join(taskDir, 'scan-result.json')
    let completed = false

    try {
      await this.writeTextFile(
        jsxPath,
        renderPsdScanJsx({ psdPath: absolutePsdPath, resultFilePath: resultPath }),
        'utf8',
      )
      await this.comAdapter.runJsxFile(jsxPath)
      const result = JSON.parse(await this.readTextFile(resultPath, 'utf8')) as RawPsdScanResult
      const template = buildPsdTemplateFromScanResult(result, {
        psdPath: absolutePsdPath,
        fileHash,
        scannedAt: this.now(),
      })
      await this.cache.save(template)
      completed = true
      return template
    } catch (error) {
      if (error instanceof AppErrorClass) {
        throw error
      }
      throw new AppErrorClass(
        'TEMPLATE_SCAN_FAILED',
        `PSD 模板扫描失败：${getErrorMessage(error)}`,
        false,
        { psd_path: absolutePsdPath, template: basename(absolutePsdPath) },
        error,
      )
    } finally {
      await this.tempFiles
        .cleanupTask('photoshop', taskId, { keepIfFailed: !completed })
        .catch(() => undefined)
    }
  }

  async listCachedTemplates(): Promise<PsdTemplate[]> {
    const templates = await this.cache.list()
    const available = await Promise.all(
      templates.map(async (template) => {
        try {
          await access(template.file_path)
          return true
        } catch {
          return false
        }
      }),
    )
    return templates.filter((_template, index) => available[index])
  }

  private assertWindows(): void {
    if (this.platform !== 'win32') {
      throw new AppErrorClass(
        'PS_UNSUPPORTED_PLATFORM',
        'PS 套版仅支持 Windows，请在 Windows 电脑使用 PSD 扫描功能',
        false,
        { platform: this.platform },
      )
    }
  }
}

export const psdScanner = new PsdScanner()
