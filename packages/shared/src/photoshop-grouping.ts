import type {
  PhotoshopClipMode,
  PhotoshopExportFormat,
  PhotoshopInnerFitMode,
  PhotoshopJob,
  PhotoshopOutputLayout,
  PhotoshopPrintAsset,
  PhotoshopReplaceRange,
  PhotoshopSmartObjectReplaceMode,
  PhotoshopSoReplacement,
  PhotoshopTaskGroup,
  PsdSmartObject,
  PsdTemplate,
} from './photoshop'

export interface GroupPhotoshopTasksOptions {
  taskId: string
  outputRoot: string
  replaceRange?: PhotoshopReplaceRange
  clipMode?: PhotoshopClipMode
  format?: PhotoshopExportFormat
  jpgQuality?: number
  outputLayout?: PhotoshopOutputLayout
  smartObjectReplaceMode?: PhotoshopSmartObjectReplaceMode
  smartObjectInnerFitMode?: PhotoshopInnerFitMode
}

function splitNatural(value: string): Array<string | number> {
  return value
    .toLowerCase()
    .split(/(\d+)/)
    .filter((part) => part.length > 0)
    .map((part) => {
      const parsed = Number(part)
      return Number.isNaN(parsed) ? part : parsed
    })
}

export function sortAlphaNum(a: string, b: string): number {
  const left = splitNatural(a)
  const right = splitNatural(b)
  const count = Math.min(left.length, right.length)
  for (let i = 0; i < count; i += 1) {
    const leftPart = left[i]
    const rightPart = right[i]
    if (typeof leftPart === 'number' && typeof rightPart === 'number') {
      if (leftPart !== rightPart) {
        return leftPart - rightPart
      }
      continue
    }
    const result = String(leftPart).localeCompare(String(rightPart))
    if (result !== 0) {
      return result
    }
  }
  return left.length - right.length
}

export function representativeSoCount(
  template: Pick<PsdTemplate, 'smart_objects' | 'representative_so_count'>,
  range: PhotoshopReplaceRange = 'auto',
): number {
  const hasTopmost = Boolean(topmostSmartObject(template.smart_objects))
  const topLevelCount = template.smart_objects.filter(
    (smartObject) => smartObject.is_top_level,
  ).length
  if (range === 'topmost') {
    return hasTopmost ? 1 : 0
  }
  if (range === 'top') {
    return topLevelCount
  }
  if (range === 'all') {
    return template.representative_so_count
  }
  return hasTopmost ? 1 : template.representative_so_count
}

function chunkPrintAssets(
  printAssets: PhotoshopPrintAsset[],
  groupSize: number,
): PhotoshopPrintAsset[][] {
  if (groupSize <= 0) {
    return []
  }
  const groups: PhotoshopPrintAsset[][] = []
  for (let index = 0; index < printAssets.length; index += groupSize) {
    groups.push(printAssets.slice(index, index + groupSize))
  }
  return groups
}

export function sanitizeTemplateName(psdPath: string): string {
  const filename = psdPath.split(/[\\/]/).pop() ?? psdPath
  const withoutExtension = filename.replace(/\.[^.]+$/, '')
  const sanitized = withoutExtension
    .replace(/[<>:"/\\|?*]/g, '_')
    .trim()
    .slice(0, 60)
  return sanitized.length > 0 ? sanitized : 'template'
}

function buildJob(
  template: PsdTemplate,
  groupIndex: number,
  skuFolder: string,
  templateName: string,
  printAssets: PhotoshopPrintAsset[],
  options: Required<GroupPhotoshopTasksOptions>,
): PhotoshopJob {
  const clipAreas = template.clip_areas
  const extension = options.format === 'jpg' ? 'jpg' : 'png'
  const outputFolder =
    options.outputLayout === 'sku_flat'
      ? `${options.outputRoot}/${skuFolder}`
      : options.outputLayout === 'sku_first'
        ? `${options.outputRoot}/${skuFolder}/${templateName}`
        : `${options.outputRoot}/${templateName}/${printAssets[0]?.id ?? 'group'}`
  const outputPaths = clipAreas.map((_, clipIndex) =>
    options.outputLayout === 'sku_flat'
      ? `${outputFolder}/${templateName}-${String(clipIndex + 1).padStart(2, '0')}.${extension}`
      : `${outputFolder}/${String(clipIndex + 1).padStart(2, '0')}.${extension}`,
  )
  const soReplacements: PhotoshopSoReplacement[] = selectSmartObjects(
    template,
    options.replaceRange,
  ).map((smartObject, smartObjectIndex) => ({
    layer_path: smartObject.path,
    input_image: printAssets[smartObjectIndex % printAssets.length]?.file_path ?? '',
    replace_mode: options.smartObjectReplaceMode,
    inner_fit_mode: options.smartObjectInnerFitMode,
  }))

  return {
    task_id: options.taskId,
    group_index: groupIndex,
    mockup_path: template.file_path,
    smart_object_replace_mode: options.smartObjectReplaceMode,
    so_replacements: soReplacements,
    clip_mode: options.clipMode,
    clip_areas: clipAreas,
    output_paths: outputPaths,
    format: options.format,
    jpg_quality: options.jpgQuality,
    result_file_path: '',
  }
}

function selectSmartObjects(template: PsdTemplate, range: PhotoshopReplaceRange) {
  const topLevel = template.smart_objects.filter((smartObject) => smartObject.is_top_level)
  const topmost = topmostSmartObject(template.smart_objects)
  if (range === 'topmost') {
    return topmost ? [topmost] : []
  }
  if (range === 'top') {
    return topLevel
  }
  if (range === 'auto') {
    return topmost ? [topmost] : template.smart_objects
  }
  return template.smart_objects
}

function topmostSmartObject(smartObjects: PsdSmartObject[]) {
  return smartObjects.find((smartObject) => smartObject.is_top_level) ?? smartObjects[0]
}

function skuFolderForGroup(
  printAssets: PhotoshopPrintAsset[],
  groupIndex: number,
  outputLayout: PhotoshopOutputLayout,
): string {
  if ((outputLayout === 'sku_first' || outputLayout === 'sku_flat') && printAssets.length > 1) {
    return `group-${String(groupIndex + 1).padStart(3, '0')}`
  }
  return printAssets[0]?.id ?? `group-${String(groupIndex + 1).padStart(3, '0')}`
}

export function groupTasks(
  printAssets: PhotoshopPrintAsset[],
  template: PsdTemplate,
  options: GroupPhotoshopTasksOptions,
): PhotoshopTaskGroup[] {
  const resolvedOptions: Required<GroupPhotoshopTasksOptions> = {
    replaceRange: options.replaceRange ?? 'auto',
    clipMode: options.clipMode ?? 'auto',
    format: options.format ?? 'jpg',
    jpgQuality: options.jpgQuality ?? 12,
    outputLayout: options.outputLayout ?? 'template_first',
    smartObjectReplaceMode: options.smartObjectReplaceMode ?? 'replaceContents',
    smartObjectInnerFitMode: options.smartObjectInnerFitMode ?? 'fill',
    outputRoot: options.outputRoot,
    taskId: options.taskId,
  }
  const sortedPrintAssets = [...printAssets].sort((left, right) => sortAlphaNum(left.id, right.id))
  const groupSize = representativeSoCount(template, resolvedOptions.replaceRange)
  if (groupSize <= 0) {
    return []
  }

  const chunks = chunkPrintAssets(sortedPrintAssets, groupSize)
  const templateName = sanitizeTemplateName(template.file_path)
  return chunks.map((chunk, index) => {
    const skuFolder = skuFolderForGroup(chunk, index, resolvedOptions.outputLayout)
    return {
      group_index: index,
      sku_folder: skuFolder,
      template_name: templateName,
      print_assets: chunk,
      job: buildJob(template, index, skuFolder, templateName, chunk, resolvedOptions),
    }
  })
}
