import type {
  CollectionImageIndexItem,
  CollectionImageIndexScanResult,
} from '../../../../main/lib/collection-image-index-service'

export type CollectionImagePoolMergeResult = {
  items: CollectionImageIndexItem[]
  addedItems: CollectionImageIndexItem[]
  existingCount: number
  updatedCount: number
}

export type CollectionImagePoolProductGroup = {
  key: string
  title: string
  coverUrl: string
  items: CollectionImageIndexItem[]
}

export type CollectionImagePoolGroups = {
  looseItems: CollectionImageIndexItem[]
  productGroups: CollectionImagePoolProductGroup[]
}

type CollectionImagePoolKeyItem = Pick<CollectionImageIndexItem, 'originalUrl'> &
  Partial<Pick<CollectionImageIndexItem, 'bucket' | 'goodsLink' | 'groupKey' | 'sourcePageUrl'>>

export function collectionImagePoolKey(item: CollectionImagePoolKeyItem) {
  const url = imageUrlKey(item.originalUrl)
  if (item.bucket === 'product') {
    return `product:${item.groupKey ?? item.sourcePageUrl ?? item.goodsLink ?? 'ungrouped'}:${url}`
  }
  return `loose:${url}`
}

function imageUrlKey(value: string) {
  try {
    const url = new URL(value)
    url.search = ''
    url.hash = ''
    return url.href
  } catch {
    return value.replace(/[?#].*$/, '')
  }
}

export function collectionImagePoolId(item: CollectionImagePoolKeyItem) {
  let hash = 0
  for (const char of collectionImagePoolKey(item)) {
    hash = (hash * 31 + char.charCodeAt(0)) >>> 0
  }
  return `pool-${hash.toString(36)}`
}

export function collectionImagePoolItemWithSource(
  item: CollectionImageIndexItem,
  scan: CollectionImageIndexScanResult,
  scannedAt: number,
): CollectionImageIndexItem {
  const pageKind = item.pageKind ?? pageKindFromUrl(scan.pageUrl)
  const bucket = item.bucket ?? (pageKind === 'detail' ? 'product' : 'loose')
  const groupKey =
    bucket === 'product' ? (item.groupKey ?? productGroupKeyFromUrl(scan.pageUrl)) : null
  const groupTitle =
    bucket === 'product' ? (item.groupTitle ?? scan.title ?? item.sourcePageTitle ?? null) : null
  const coverUrl = bucket === 'product' ? (item.coverUrl ?? item.originalUrl) : null
  const nextItem = {
    ...item,
    bucket,
    pageKind,
    groupKey,
    groupTitle,
    coverUrl,
    sourcePageUrl: scan.pageUrl,
    sourcePageTitle: scan.title,
    scannedAt,
  }
  return {
    ...nextItem,
    id: collectionImagePoolId(nextItem),
  }
}

export function mergeCollectionImagePoolItems(
  currentItems: CollectionImageIndexItem[],
  scanItems: CollectionImageIndexItem[],
  scan: CollectionImageIndexScanResult,
  scannedAt: number,
): CollectionImagePoolMergeResult {
  const items = [...currentItems]
  const indexesByKey = new Map(
    currentItems.map((item, index) => [collectionImagePoolKey(item), index]),
  )
  const addedItems: CollectionImageIndexItem[] = []
  let existingCount = 0
  let updatedCount = 0

  for (const rawItem of scanItems) {
    const incoming = collectionImagePoolItemWithSource(rawItem, scan, scannedAt)
    const key = collectionImagePoolKey(incoming)
    const existingIndex = indexesByKey.get(key)
    if (existingIndex === undefined) {
      indexesByKey.set(key, items.length)
      items.push(incoming)
      addedItems.push(incoming)
      continue
    }

    existingCount += 1
    const existing = items[existingIndex]
    if (!existing) {
      continue
    }
    const merged = mergeExistingImagePoolItem(existing, incoming)
    if (merged !== existing) {
      items[existingIndex] = merged
      updatedCount += 1
    }
  }

  return { items, addedItems, existingCount, updatedCount }
}

function mergeExistingImagePoolItem(
  existing: CollectionImageIndexItem,
  incoming: CollectionImageIndexItem,
) {
  const preferIncoming =
    incoming.score > existing.score ||
    imageWidthHint(incoming.originalUrl) > imageWidthHint(existing.originalUrl) ||
    (isGoodsPageUrl(incoming.sourcePageUrl) && !isGoodsPageUrl(existing.sourcePageUrl))
  const base = preferIncoming
    ? { ...incoming, id: existing.id, localPath: existing.localPath ?? incoming.localPath }
    : { ...existing }
  let changed = preferIncoming

  if (!base.localPath && incoming.localPath) {
    base.localPath = incoming.localPath
    changed = true
  }
  if (!base.goodsLink && incoming.goodsLink) {
    base.goodsLink = incoming.goodsLink
    changed = true
  }
  if (!base.groupKey && incoming.groupKey) {
    base.groupKey = incoming.groupKey
    changed = true
  }
  if (!base.groupTitle && incoming.groupTitle) {
    base.groupTitle = incoming.groupTitle
    changed = true
  }
  if (!base.coverUrl && incoming.coverUrl) {
    base.coverUrl = incoming.coverUrl
    changed = true
  }
  if (incoming.sourcePageUrl && base.sourcePageUrl !== incoming.sourcePageUrl) {
    if (!base.sourcePageUrl || isGoodsPageUrl(incoming.sourcePageUrl)) {
      base.sourcePageUrl = incoming.sourcePageUrl
      changed = true
    }
  }
  if (incoming.sourcePageTitle && base.sourcePageTitle !== incoming.sourcePageTitle) {
    if (!base.sourcePageTitle || base.sourcePageUrl === incoming.sourcePageUrl) {
      base.sourcePageTitle = incoming.sourcePageTitle
      changed = true
    }
  }
  if (incoming.scannedAt && base.scannedAt !== incoming.scannedAt && preferIncoming) {
    base.scannedAt = incoming.scannedAt
    changed = true
  }

  return changed ? base : existing
}

export function groupCollectionImagePoolItems(
  items: CollectionImageIndexItem[],
): CollectionImagePoolGroups {
  const looseItems: CollectionImageIndexItem[] = []
  const productGroupsByKey = new Map<string, CollectionImagePoolProductGroup>()

  for (const item of items) {
    if (item.bucket !== 'product') {
      looseItems.push(item)
      continue
    }

    const key = item.groupKey ?? item.sourcePageUrl ?? item.goodsLink ?? item.id
    const existing = productGroupsByKey.get(key)
    if (existing) {
      existing.items.push(item)
      if (!existing.coverUrl && item.originalUrl) {
        existing.coverUrl = item.originalUrl
      }
      continue
    }

    productGroupsByKey.set(key, {
      key,
      title: item.groupTitle ?? item.sourcePageTitle ?? key,
      coverUrl: item.coverUrl ?? item.originalUrl,
      items: [item],
    })
  }

  return {
    looseItems,
    productGroups: Array.from(productGroupsByKey.values()),
  }
}

function pageKindFromUrl(value: string | null | undefined) {
  if (!value) {
    return 'platform'
  }
  if (value.includes('/search_result.html')) {
    return 'search'
  }
  if (isTemuShopPageUrl(value)) {
    return 'shop'
  }
  if (isGoodsPageUrl(value)) {
    return 'detail'
  }
  if (value.includes('/channel/')) {
    return 'channel'
  }
  return 'platform'
}

function productGroupKeyFromUrl(value: string | null | undefined) {
  if (!value) {
    return null
  }
  const match = value.match(/-g-(\d+)\.html/i)
  if (match?.[1]) {
    return `temu-g-${match[1]}`
  }
  try {
    const url = new URL(value)
    const goodsId = url.searchParams.get('goods_id') ?? url.searchParams.get('goodsId')
    return goodsId ? `temu-g-${goodsId}` : null
  } catch {
    return null
  }
}

function imageWidthHint(value: string) {
  const match = value.match(/\/w\/(\d+)/i)
  return match?.[1] ? Number(match[1]) : 0
}

function isGoodsPageUrl(value: string | null | undefined) {
  return Boolean(
    value && /(?:-g-\d+\.html|\/goods(?:\/|\.html|$)|[?&](?:goods_id|goodsId)=)/i.test(value),
  )
}

function isTemuShopPageUrl(value: string | null | undefined) {
  if (!value) {
    return false
  }
  try {
    const url = new URL(value)
    const pathname = url.pathname.toLowerCase()
    return (
      pathname.endsWith('/mall.html') ||
      /-m-\d+\.html$/i.test(pathname) ||
      (url.searchParams.has('mall_id') && !isGoodsPageUrl(value))
    )
  } catch {
    return false
  }
}
