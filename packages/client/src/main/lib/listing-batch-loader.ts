import { readFile, readdir } from 'node:fs/promises'
import { extname, join, resolve } from 'node:path'
import {
  type ListingImageGroup,
  type ListingImageGroups,
  type ListingItem,
  type ListingMaterialScanItem,
  type ListingMaterialScanResult,
  type ListingTemplateConfig,
  type ListingVariantGroup,
  SLICE_8_LISTING_TEMPLATES,
} from '@tengyu-aipod/shared'
import { readExistingTitles } from './title-service'

export type ListingBatchLoaderOptions = {
  template?: ListingTemplateConfig
  excludedFolderNames?: string[]
}

export type ListingBatchLoadResult = ListingMaterialScanResult & {
  listingItems: ListingItem[]
  skuFolderCount: number
  titledSkuCount: number
}

type CollectedMaterialFiles = {
  imageGroups: ListingImageGroups
  variantGroups: ListingVariantGroup[]
  videoPaths: string[]
  descriptionText?: string
}

const IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp'])
const VIDEO_EXTENSIONS = new Set(['.mp4', '.mov', '.webm'])
const DESCRIPTION_TEXT_FILE_NAMES = ['产品描述.txt', '描述.txt', 'description.txt']
const GROUP_NAME_ALIASES: Record<ListingImageGroup, string[]> = {
  sku: ['sku', 'skc', '变种', '规格'],
  carousel: ['carousel', '轮播', '主图', '首页图', 'main'],
  material: ['material', '素材', '详情素材', 'source'],
  preview: ['preview', '预览', '效果图'],
  description: ['description', '产品描述', '描述图', '详情图', '描述', '详情'],
}

export async function loadBatchAsListingItems(
  batchDir: string,
  options: ListingBatchLoaderOptions = {},
): Promise<ListingBatchLoadResult> {
  const template = options.template ?? inferTemplate(batchDir)
  const excludedFolderNames = new Set([
    ...template.excludedFolderNames,
    ...(options.excludedFolderNames ?? []),
  ])
  const titles = await readExistingTitles(join(batchDir, 'titles.xlsx'))
  const folders = await scanSkuFolders(batchDir, excludedFolderNames)
  const items: ListingMaterialScanItem[] = []
  const listingItems: ListingItem[] = []
  const warnings: string[] = []

  if (titles.size === 0) {
    warnings.push(`批次目录缺少 titles.xlsx 或标题为空：${join(batchDir, 'titles.xlsx')}`)
  }

  for (const folder of folders) {
    const title = titles.get(folder.name)
    if (!title) {
      warnings.push(`货号 ${folder.name} 在 titles.xlsx 中无标题，跳过`)
      continue
    }

    const material = await collectMaterialFiles(folder.path)
    if (!hasAnyImage(material.imageGroups)) {
      warnings.push(`货号 ${folder.name} 文件夹没有可上架图片，跳过`)
      continue
    }

    const scanItem: ListingMaterialScanItem = {
      id: sanitizeMaterialItemId(folder.name),
      sku: folder.name,
      title,
      folderName: folder.name,
      folderPath: folder.path,
      templateKey: template.key,
      imageGroups: material.imageGroups,
      variantGroups: material.variantGroups,
      videoPaths: material.videoPaths,
      ...(material.descriptionText ? { descriptionText: material.descriptionText } : {}),
    }
    items.push(scanItem)
    listingItems.push(toListingItem(batchDir, template, scanItem))
  }

  return {
    rootDir: batchDir,
    templateKey: template.key,
    items,
    listingItems,
    warnings,
    skuFolderCount: folders.length,
    titledSkuCount: folders.filter((folder) => titles.has(folder.name)).length,
  }
}

function inferTemplate(batchDir: string): ListingTemplateConfig {
  const resolvedBatchDir = resolve(batchDir)
  const template = SLICE_8_LISTING_TEMPLATES.find(
    (candidate) => resolve(candidate.materialRootDir) === resolvedBatchDir,
  )
  return template ?? SLICE_8_LISTING_TEMPLATES[0]
}

async function scanSkuFolders(batchDir: string, excludedFolderNames: Set<string>) {
  const entries = await readdir(batchDir, { withFileTypes: true })
  return entries
    .filter((entry) => entry.isDirectory())
    .filter((entry) => !excludedFolderNames.has(entry.name))
    .map((entry) => ({
      name: entry.name,
      path: join(batchDir, entry.name),
    }))
    .sort((left, right) => naturalCompare(left.name, right.name))
}

async function collectMaterialFiles(folderPath: string): Promise<CollectedMaterialFiles> {
  const entries = await readdir(folderPath, { withFileTypes: true })
  const imageGroups = emptyImageGroups()
  const looseImages: string[] = []
  const variantGroups: ListingVariantGroup[] = []
  const videoPaths: string[] = []
  const descriptionTexts: string[] = []

  for (const entry of entries.sort((left, right) => naturalCompare(left.name, right.name))) {
    const entryPath = join(folderPath, entry.name)
    if (entry.isDirectory()) {
      if (isVideoFolderName(entry.name)) {
        videoPaths.push(...(await collectFilesByType(entryPath, isVideoFile)))
        continue
      }

      const nestedImages = await collectFilesByType(entryPath, isImageFile)
      const group = detectGroupName(entry.name)
      if (group) {
        imageGroups[group].push(...nestedImages)
        descriptionTexts.push(...(await readDescriptionTexts(entryPath)))
        continue
      }

      if (nestedImages.length > 0) {
        variantGroups.push({
          id: sanitizeMaterialItemId(entry.name),
          name: entry.name,
          imagePaths: nestedImages,
        })
        imageGroups.sku.push(...nestedImages)
      }
      continue
    }

    if (!entry.isFile()) {
      continue
    }
    if (isVideoFile(entry.name)) {
      videoPaths.push(entryPath)
      continue
    }
    if (isDescriptionTextFile(entry.name)) {
      descriptionTexts.push(await readFile(entryPath, 'utf8'))
      continue
    }
    if (!isImageFile(entry.name)) {
      continue
    }
    const group = detectGroupName(entry.name)
    if (group) {
      imageGroups[group].push(entryPath)
    } else {
      looseImages.push(entryPath)
    }
  }

  imageGroups.material.push(...looseImages)
  const descriptionText = mergeDescriptionTexts(descriptionTexts)
  return {
    imageGroups: sortImageGroups(imageGroups),
    variantGroups,
    videoPaths: sortPaths(videoPaths),
    ...(descriptionText ? { descriptionText } : {}),
  }
}

async function collectFilesByType(
  directoryPath: string,
  predicate: (fileName: string) => boolean,
): Promise<string[]> {
  const entries = await readdir(directoryPath, { withFileTypes: true })
  const paths: string[] = []
  for (const entry of entries.sort((left, right) => naturalCompare(left.name, right.name))) {
    const entryPath = join(directoryPath, entry.name)
    if (entry.isDirectory()) {
      paths.push(...(await collectFilesByType(entryPath, predicate)))
      continue
    }
    if (entry.isFile() && predicate(entry.name)) {
      paths.push(entryPath)
    }
  }
  return sortPaths(paths)
}

async function readDescriptionTexts(directoryPath: string): Promise<string[]> {
  const entries = await readdir(directoryPath, { withFileTypes: true })
  const texts: string[] = []
  for (const entry of entries) {
    if (entry.isFile() && isDescriptionTextFile(entry.name)) {
      texts.push(await readFile(join(directoryPath, entry.name), 'utf8'))
    }
  }
  return texts
}

function toListingItem(
  batchDir: string,
  template: ListingTemplateConfig,
  item: ListingMaterialScanItem,
): ListingItem {
  const listingItem: ListingItem = {
    id: `${template.key}-${item.sku}`,
    sku: item.sku,
    title: item.title,
    platform: template.platform,
    templateKey: template.key,
    editUrl: template.editUrl,
    materialRootDir: batchDir,
    folderPath: item.folderPath,
    targetShopName: '',
    imageGroups: item.imageGroups,
    variantGroups: item.variantGroups,
    videoPaths: item.videoPaths,
  }
  if (item.descriptionText) {
    listingItem.descriptionText = item.descriptionText
  }
  return listingItem
}

function emptyImageGroups(): ListingImageGroups {
  return {
    sku: [],
    carousel: [],
    material: [],
    preview: [],
    description: [],
  }
}

function sortImageGroups(groups: ListingImageGroups): ListingImageGroups {
  return {
    sku: sortPaths(groups.sku),
    carousel: sortPaths(groups.carousel),
    material: sortPaths(groups.material),
    preview: sortPaths(groups.preview),
    description: sortPaths(groups.description),
  }
}

function hasAnyImage(groups: ListingImageGroups) {
  return Object.values(groups).some((paths) => paths.length > 0)
}

function isImageFile(fileName: string) {
  return IMAGE_EXTENSIONS.has(extname(fileName).toLowerCase())
}

function isVideoFile(fileName: string) {
  return VIDEO_EXTENSIONS.has(extname(fileName).toLowerCase())
}

function isVideoFolderName(folderName: string) {
  return normalizeName(folderName).includes('视频') || normalizeName(folderName).includes('video')
}

function isDescriptionTextFile(fileName: string) {
  return DESCRIPTION_TEXT_FILE_NAMES.some(
    (candidate) => normalizeName(candidate) === normalizeName(fileName),
  )
}

function detectGroupName(name: string): ListingImageGroup | null {
  const normalized = normalizeName(name)
  for (const [group, aliases] of Object.entries(GROUP_NAME_ALIASES) as Array<
    [ListingImageGroup, string[]]
  >) {
    if (aliases.some((alias) => normalized.includes(normalizeName(alias)))) {
      return group
    }
  }
  return null
}

function normalizeName(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[\s_-]+/g, '')
}

function mergeDescriptionTexts(texts: string[]) {
  const merged = texts
    .map((text) => text.trim())
    .filter(Boolean)
    .join('\n\n')
  return merged || undefined
}

function sanitizeMaterialItemId(value: string) {
  const normalized = value.replace(/[^\p{L}\p{N}_-]+/gu, '-').replace(/-+/g, '-')
  const trimmed = normalized.replace(/^-|-$/g, '')
  return trimmed || `item-${Date.now()}`
}

function sortPaths(paths: string[]) {
  return [...paths].sort((left, right) => naturalCompare(left, right))
}

function naturalCompare(left: string, right: string) {
  return left.localeCompare(right, 'zh-CN', { numeric: true, sensitivity: 'base' })
}
