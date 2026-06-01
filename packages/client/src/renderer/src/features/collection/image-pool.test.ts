import { describe, expect, it } from 'vitest'
import type {
  CollectionImageIndexItem,
  CollectionImageIndexScanResult,
} from '../../../../main/lib/collection-image-index-service'
import {
  collectionImagePoolKey,
  groupCollectionImagePoolItems,
  mergeCollectionImagePoolItems,
} from './image-pool'

describe('collection image pool merge', () => {
  it('dedupes image URLs after query params', () => {
    expect(
      collectionImagePoolKey(
        imageItem('https://img.kwcdn.com/product/open/a.jpg?imageView2/2/w/800/q/90'),
      ),
    ).toBe('loose:https://img.kwcdn.com/product/open/a.jpg')
  })

  it('adds new scanned images to the pool', () => {
    const scan = scanResult('https://www.temu.com/search_result.html?search_key=a')
    const result = mergeCollectionImagePoolItems(
      [],
      [imageItem('https://img.kwcdn.com/a.jpg')],
      scan,
      1,
    )

    expect(result.items).toHaveLength(1)
    expect(result.addedItems).toHaveLength(1)
    expect(result.existingCount).toBe(0)
    expect(result.items[0]?.sourcePageUrl).toBe(scan.pageUrl)
  })

  it('keeps the same image as separate loose and product entries', () => {
    const searchScan = scanResult('https://www.temu.com/search_result.html?search_key=mask')
    const first = mergeCollectionImagePoolItems(
      [],
      [imageItem('https://img.kwcdn.com/product/open/a.jpg?imageView2/2/w/800/q/90')],
      searchScan,
      1,
    )
    const detailScan = scanResult(
      'https://www.temu.com/ca/kamenrid-fashionable-backpack-bundle-pocket-g-601104383327406.html',
    )
    const second = mergeCollectionImagePoolItems(
      first.items,
      [productImageItem('https://img.kwcdn.com/product/open/a.jpg?imageView2/2/w/1300/q/90')],
      detailScan,
      2,
    )

    expect(second.items).toHaveLength(2)
    expect(second.addedItems).toHaveLength(1)
    expect(second.existingCount).toBe(0)
    expect(second.items[0]?.bucket).toBe('loose')
    expect(second.items[1]?.bucket).toBe('product')
    expect(second.items[1]?.groupKey).toBe('temu-g-601104383327406')
    expect(second.items[1]?.id).not.toBe(first.items[0]?.id)
  })

  it('merges duplicate images inside the same product group', () => {
    const detailScan = scanResult(
      'https://www.temu.com/ca/kamenrid-fashionable-backpack-bundle-pocket-g-601104383327406.html',
    )
    const first = mergeCollectionImagePoolItems(
      [],
      [productImageItem('https://img.kwcdn.com/product/open/a.jpg?imageView2/2/w/800/q/90')],
      detailScan,
      1,
    )
    const second = mergeCollectionImagePoolItems(
      first.items,
      [productImageItem('https://img.kwcdn.com/product/open/a.jpg?imageView2/2/w/1300/q/90')],
      detailScan,
      2,
    )

    expect(second.items).toHaveLength(1)
    expect(second.addedItems).toHaveLength(0)
    expect(second.existingCount).toBe(1)
    expect(second.updatedCount).toBe(1)
    expect(second.items[0]?.bucket).toBe('product')
    expect(second.items[0]?.id).toBe(first.items[0]?.id)
  })

  it('groups product entries separately from loose images for preview', () => {
    const searchScan = scanResult('https://www.temu.com/search_result.html?search_key=mask')
    const detailScan = scanResult(
      'https://www.temu.com/ca/kamenrid-fashionable-backpack-bundle-pocket-g-601104383327406.html',
    )
    const first = mergeCollectionImagePoolItems(
      [],
      [imageItem('https://img.kwcdn.com/product/open/a.jpg')],
      searchScan,
      1,
    )
    const second = mergeCollectionImagePoolItems(
      first.items,
      [
        productImageItem('https://img.kwcdn.com/product/open/b.jpg'),
        productImageItem('https://img.kwcdn.com/product/open/c.jpg'),
      ],
      detailScan,
      2,
    )
    const grouped = groupCollectionImagePoolItems(second.items)

    expect(grouped.looseItems).toHaveLength(1)
    expect(grouped.productGroups).toHaveLength(1)
    expect(grouped.productGroups[0]?.key).toBe('temu-g-601104383327406')
    expect(grouped.productGroups[0]?.items).toHaveLength(2)
  })

  it('keeps Temu shop preview images in product groups', () => {
    const shopScan = scanResult('https://www.temu.com/mall.html?mall_id=634418228197396')
    const result = mergeCollectionImagePoolItems(
      [],
      [
        shopImageItem(
          'https://img.kwcdn.com/product/open/a.jpg?imageView2/2/w/1300/q/90/format/webp',
          'temu-g-606533735830828',
        ),
        shopImageItem(
          'https://img.kwcdn.com/product/open/b.jpg?imageView2/2/w/1300/q/90/format/webp',
          'temu-g-606533735830828',
        ),
      ],
      shopScan,
      1,
    )
    const grouped = groupCollectionImagePoolItems(result.items)

    expect(grouped.looseItems).toHaveLength(0)
    expect(grouped.productGroups).toHaveLength(1)
    expect(grouped.productGroups[0]?.key).toBe('temu-g-606533735830828')
    expect(grouped.productGroups[0]?.items).toHaveLength(2)
  })
})

function scanResult(pageUrl: string): CollectionImageIndexScanResult {
  return {
    pageUrl,
    title: 'Temu page',
    imageCount: 1,
    indexedCount: 1,
    collectableCount: 1,
    sourceCounts: { img: 1 },
    items: [],
    scannedPages: [],
  }
}

function productImageItem(originalUrl: string): CollectionImageIndexItem {
  return imageItem(originalUrl, {
    bucket: 'product',
    pageKind: 'detail',
    groupKey: 'temu-g-601104383327406',
    groupTitle: 'Temu page',
    coverUrl: originalUrl,
  })
}

function shopImageItem(originalUrl: string, groupKey: string): CollectionImageIndexItem {
  return imageItem(originalUrl, {
    bucket: 'product',
    pageKind: 'shop',
    source: 'ssr',
    goodsLink: 'https://www.temu.com/ca/example-g-606533735830828.html',
    groupKey,
    groupTitle: 'Temu shop item',
    coverUrl: originalUrl,
  })
}

function imageItem(
  originalUrl: string,
  overrides: Partial<CollectionImageIndexItem> = {},
): CollectionImageIndexItem {
  return {
    id: 'img_001',
    bucket: 'loose',
    pageKind: 'search',
    source: 'img',
    displayUrl: originalUrl,
    originalUrl,
    score: 105,
    visible: true,
    rect: { x: 0, y: 0, width: 200, height: 200, right: 200, bottom: 200 },
    naturalWidth: 800,
    naturalHeight: 800,
    goodsLink: null,
    groupKey: null,
    groupTitle: null,
    coverUrl: null,
    tag: 'img',
    ...overrides,
  }
}
