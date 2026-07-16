import type { PhotoshopBatchOutputGroup } from '@tengyu-aipod/shared'

export type PhotoshopResultFilter = 'all' | 'done' | 'skipped'

export interface PhotoshopSkuCard {
  skuFolder: string
  coverPath: string
  folderPath: string | null
  imageCount: number
  templates: string[]
  status: PhotoshopBatchOutputGroup['status']
  outputs: string[]
}

function resultGroupKey(group: PhotoshopBatchOutputGroup) {
  return `${group.template_id}:${group.group_index}:${group.sku_folder}`
}

export function mergePhotoshopResultGroup(
  groups: PhotoshopBatchOutputGroup[],
  nextGroup: PhotoshopBatchOutputGroup,
): PhotoshopBatchOutputGroup[] {
  const nextKey = resultGroupKey(nextGroup)
  const existingIndex = groups.findIndex((group) => resultGroupKey(group) === nextKey)
  if (existingIndex === -1) {
    return [...groups, nextGroup]
  }
  return groups.map((group, index) => (index === existingIndex ? nextGroup : group))
}

export function skuFolderPathFromOutputs(outputs: string[]): string | null {
  const firstOutput = outputs[0]
  if (!firstOutput) {
    return null
  }
  const slashIndex = Math.max(firstOutput.lastIndexOf('/'), firstOutput.lastIndexOf('\\'))
  return slashIndex >= 0 ? firstOutput.slice(0, slashIndex) : null
}

function uniquePush(items: string[], value: string) {
  if (!items.includes(value)) {
    items.push(value)
  }
}

export function photoshopSkuCards(groups: PhotoshopBatchOutputGroup[]): PhotoshopSkuCard[] {
  const bySku = new Map<string, PhotoshopSkuCard>()
  for (const group of groups) {
    if (group.outputs.length === 0) {
      continue
    }
    const existing = bySku.get(group.sku_folder)
    if (!existing) {
      bySku.set(group.sku_folder, {
        skuFolder: group.sku_folder,
        coverPath: group.outputs[0] ?? '',
        folderPath: skuFolderPathFromOutputs(group.outputs),
        imageCount: group.outputs.length,
        templates: [group.template_name],
        status: group.status,
        outputs: [...group.outputs],
      })
      continue
    }
    uniquePush(existing.templates, group.template_name)
    for (const output of group.outputs) {
      uniquePush(existing.outputs, output)
    }
    existing.imageCount = existing.outputs.length
    existing.status =
      existing.status === 'completed' || group.status === 'completed' ? 'completed' : 'skipped'
    if (!existing.folderPath) {
      existing.folderPath = skuFolderPathFromOutputs(group.outputs)
    }
  }
  return [...bySku.values()]
}

export function filterPhotoshopSkuCards(
  cards: PhotoshopSkuCard[],
  filter: PhotoshopResultFilter,
): PhotoshopSkuCard[] {
  if (filter === 'all') {
    return cards
  }
  if (filter === 'done') {
    return cards.filter((card) => card.status === 'completed')
  }
  return cards.filter((card) => card.status === 'skipped')
}
