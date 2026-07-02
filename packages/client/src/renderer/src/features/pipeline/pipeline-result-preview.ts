import type {
  PipelineProgress,
  PipelineResultImage,
  PipelineResultSection,
  PipelineRunConfig,
} from '@tengyu-aipod/shared'

export type PipelineFinalResult =
  | { mode: 'groups'; section: PipelineResultSection }
  | { mode: 'images'; section: PipelineResultSection }

export type PipelineResultStat = {
  key: 'source' | 'matting' | 'detection' | 'photoshop' | 'title'
  label: string
  value: string
  detail: string
}

const FINAL_SECTION_BY_PRIORITY: Array<PipelineResultSection['key']> = [
  'print_products',
  'detection_passed',
  'image_processing',
  'source_images',
  'reference_images',
]

export function sourceMetricLabel(config: PipelineRunConfig) {
  if (config.source.mode === 'txt2img') {
    return '文生图产出'
  }
  if (config.source.mode === 'img2img') {
    return '图生图产出'
  }
  if (config.source.mode === 'collection') {
    return '提取印花'
  }
  return '已有印花'
}

function findSection(
  progress: PipelineProgress | null,
  key: PipelineResultSection['key'],
): PipelineResultSection | null {
  return progress?.result_sections?.find((section) => section.key === key) ?? null
}

function hasSuccessfulItems(section: PipelineResultSection | null) {
  return Boolean(section?.items.some((item) => item.status === 'success'))
}

function hasGroups(section: PipelineResultSection | null) {
  return Boolean(section?.groups?.length)
}

export function finalPipelineResult(
  config: PipelineRunConfig,
  progress: PipelineProgress | null,
): PipelineFinalResult | null {
  const printProducts = findSection(progress, 'print_products')
  if (config.photoshop.enabled && printProducts) {
    if (hasGroups(printProducts)) {
      return { mode: 'groups', section: printProducts }
    }
    if (hasSuccessfulItems(printProducts)) {
      return { mode: 'images', section: printProducts }
    }
  }

  if (config.detection.enabled) {
    const detectionPassed = findSection(progress, 'detection_passed')
    if (detectionPassed && hasSuccessfulItems(detectionPassed)) {
      return { mode: 'images', section: detectionPassed }
    }
  }

  for (const key of FINAL_SECTION_BY_PRIORITY) {
    const section = findSection(progress, key)
    if (!section) {
      continue
    }
    if (hasGroups(section)) {
      return { mode: 'groups', section }
    }
    if (hasSuccessfulItems(section)) {
      return { mode: 'images', section }
    }
  }

  return null
}

export function sectionItemsForLightbox(section: PipelineResultSection): PipelineResultImage[] {
  if (section.groups?.length) {
    return section.groups.flatMap((group) => group.items)
  }
  return section.items
}

export function pipelineResultStats(
  config: PipelineRunConfig,
  progress: PipelineProgress | null,
): PipelineResultStat[] {
  const stats = progress?.stats
  const sourceValue = String(stats?.prints || stats?.sourceImages || 0)
  const result: PipelineResultStat[] = [
    {
      key: 'source',
      label: sourceMetricLabel(config),
      value: sourceValue,
      detail: '当前起点产物',
    },
  ]

  if (config.matting.enabled) {
    const mattingSection = findSection(progress, 'image_processing')
    result.push({
      key: 'matting',
      label: '抠图',
      value: String(mattingSection?.completed ?? 0),
      detail: mattingSection?.failed ? `失败 ${mattingSection.failed}` : '已完成抠图',
    })
  }

  if (config.detection.enabled) {
    result.push({
      key: 'detection',
      label: '侵权检测',
      value: `${stats?.detectionPass ?? 0} / ${stats?.detectionReview ?? 0} / ${
        stats?.detectionBlock ?? 0
      }`,
      detail: '通过 / 疑似 / 拦截',
    })
  }

  if (config.photoshop.enabled) {
    const printProducts = findSection(progress, 'print_products')
    const folderCount = printProducts?.groups?.length ?? stats?.photoshopGroups ?? 0
    const imageCount = printProducts?.items.filter((item) => item.status === 'success').length ?? 0
    result.push({
      key: 'photoshop',
      label: 'PS 套版',
      value: String(imageCount || folderCount),
      detail: `${folderCount} 个文件夹`,
    })
  }

  if (config.title.enabled) {
    result.push({
      key: 'title',
      label: '标题',
      value: String(stats?.titleSucceeded ?? 0),
      detail: stats?.titleFailed ? `失败 ${stats.titleFailed}` : '已生成标题',
    })
  }

  return result
}
