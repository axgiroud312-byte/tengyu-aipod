import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  type CollectionImageIndexItem,
  chooseCollectionCurrentPage,
  collectionImageIndexDetailGalleryBounds,
  collectionImageIndexItemTargetDir,
  collectionImageIndexPageKind,
  collectionImageIndexProductFolderName,
  collectionImageIndexRectCenterInside,
  collectionImageIndexUpgradeTemuImageUrl,
  downloadCollectionImageIndexItems,
} from './collection-image-index-service'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('collection image index product folders', () => {
  it('detects Temu regional goods detail URLs from -g-id slugs', () => {
    const folderName = collectionImageIndexProductFolderName(
      'temu',
      'https://www.temu.com/ca/happy-face-painting-gifts-g-601101959736135.html',
      { goodsLink: null },
    )

    expect(folderName).toBe('temu-g-601101959736135')
  })

  it('keeps Temu search page goods images in the loose image folder', () => {
    const targetDir = collectionImageIndexItemTargetDir(
      '/tmp/output/图池采集',
      'temu',
      'https://www.temu.com/search_result.html?search_key=six%20seven',
      {
        goodsLink: 'https://www.temu.com/ca/example-product-g-606267330393299.html',
      },
    )

    expect(targetDir).toBe('/tmp/output/图池采集/散图池')
  })

  it('uses the item source detail page for product folders', () => {
    const targetDir = collectionImageIndexItemTargetDir(
      '/tmp/output/图池采集',
      'temu',
      'https://www.temu.com/search_result.html?search_key=six%20seven',
      {
        goodsLink: null,
        sourcePageUrl: 'https://www.temu.com/ca/source-product-g-601099697798918.html',
      },
    )

    expect(targetDir).toBe('/tmp/output/图池采集/商品页/temu-g-601099697798918')
  })

  it('uses an explicit product group key for product folders', () => {
    const targetDir = collectionImageIndexItemTargetDir(
      '/tmp/output/图池采集',
      'temu',
      'https://www.temu.com/search_result.html?search_key=six%20seven',
      {
        bucket: 'product',
        groupKey: 'temu-g-606267330393299',
        goodsLink: null,
      },
    )

    expect(targetDir).toBe('/tmp/output/图池采集/商品页/temu-g-606267330393299')
  })

  it('keeps non-product Temu images in the loose image folder', () => {
    const targetDir = collectionImageIndexItemTargetDir(
      '/tmp/output/图池采集',
      'temu',
      'https://www.temu.com/search_result.html?search_key=six%20seven',
      { goodsLink: null },
    )

    expect(targetDir).toBe('/tmp/output/图池采集/散图池')
  })

  it('does not apply Temu folder rules to other platforms', () => {
    const folderName = collectionImageIndexProductFolderName(
      'ozon',
      'https://www.temu.com/ca/example-product-g-606267330393299.html',
      { goodsLink: null },
    )

    expect(folderName).toBeNull()
  })

  it('classifies Temu page kinds from the page URL', () => {
    expect(
      collectionImageIndexPageKind(
        'temu',
        'https://www.temu.com/search_result.html?search_key=bag',
      ),
    ).toBe('search')
    expect(
      collectionImageIndexPageKind(
        'temu',
        'https://www.temu.com/ca/example-product-g-606267330393299.html',
      ),
    ).toBe('detail')
  })
})

describe('collection image index Temu image URL upgrade', () => {
  it('upgrades Temu thumbnail URLs to high resolution download URLs', () => {
    expect(
      collectionImageIndexUpgradeTemuImageUrl(
        'https://img.kwcdn.com/product/fancy/a.jpg?imageView2/2/w/180/q/70/format/avif',
      ),
    ).toBe('https://img.kwcdn.com/product/fancy/a.jpg?imageView2/2/w/1300/q/90/format/avif')
  })

  it('adds imageView2 high resolution params when a Temu product URL has no sizing query', () => {
    expect(
      collectionImageIndexUpgradeTemuImageUrl('https://img.kwcdn.com/product/fancy/a.jpg'),
    ).toBe('https://img.kwcdn.com/product/fancy/a.jpg?imageView2/2/w/1300/q/90/format/webp')
  })
})

describe('collection image index detail gallery bounds', () => {
  it('keeps the top product gallery and excludes reviews or right-side product widgets', () => {
    const bounds = collectionImageIndexDetailGalleryBounds(
      [
        candidateRect(118, 260, 48, 48),
        candidateRect(118, 318, 48, 48),
        candidateRect(180, 260, 430, 430),
        candidateRect(660, 480, 72, 72),
        candidateRect(118, 780, 120, 120),
      ],
      { width: 1200, height: 900 },
    )

    if (!bounds) {
      throw new Error('expected detail gallery bounds')
    }
    expect(collectionImageIndexRectCenterInside(rect(118, 260, 48, 48), bounds)).toBe(true)
    expect(collectionImageIndexRectCenterInside(rect(180, 260, 430, 430), bounds)).toBe(true)
    expect(collectionImageIndexRectCenterInside(rect(660, 480, 72, 72), bounds)).toBe(false)
    expect(collectionImageIndexRectCenterInside(rect(118, 780, 120, 120), bounds)).toBe(false)
  })
})

describe('collection current page chooser', () => {
  it('prefers the focused platform page over other open platform pages', () => {
    const result = chooseCollectionCurrentPage(
      'temu',
      [
        {
          pageUrl: 'https://www.temu.com/search_result.html?search_key=a',
          title: 'Search',
          visible: true,
          focused: false,
          lastActivityAt: 100,
          detectedAt: 1000,
        },
        {
          pageUrl: 'https://www.temu.com/ca/example-g-606267330393299.html',
          title: 'Goods',
          visible: true,
          focused: true,
          lastActivityAt: 90,
          detectedAt: 1000,
        },
      ],
      undefined,
    )

    expect(result).toMatchObject({
      pageUrl: 'https://www.temu.com/ca/example-g-606267330393299.html',
      status: 'active',
      isGoodsPage: true,
      goodsId: '606267330393299',
    })
  })

  it('falls back to the previous valid page when no platform page is active', () => {
    const result = chooseCollectionCurrentPage(
      'temu',
      [
        {
          pageUrl: 'https://www.temu.com/search_result.html?search_key=a',
          title: 'Search',
          visible: false,
          focused: false,
          lastActivityAt: 100,
          detectedAt: 1000,
        },
      ],
      {
        pageUrl: 'https://www.temu.com/ca/previous-g-601101959736135.html',
        title: 'Previous',
        status: 'active',
        isGoodsPage: true,
        goodsId: '601101959736135',
        lastDetectedAt: 900,
      },
    )

    expect(result).toMatchObject({
      pageUrl: 'https://www.temu.com/ca/previous-g-601101959736135.html',
      status: 'last_valid',
      goodsId: '601101959736135',
    })
  })

  it('returns no page when no active or previous platform page exists', () => {
    const result = chooseCollectionCurrentPage('temu', [], undefined)

    expect(result).toEqual({
      pageUrl: '',
      title: '',
      status: 'none',
      isGoodsPage: false,
      goodsId: null,
      lastDetectedAt: null,
    })
  })
})

describe('collection image index download logs', () => {
  it('emits per-image success logs with bytes and duration', async () => {
    const outputDir = await mkdtemp(join(tmpdir(), 'collection-debug-success-'))
    const logs: Array<{
      message: string
      level: string
      details?: Record<string, string | number | boolean | null | undefined>
    }> = []
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(new Uint8Array(2048), {
          status: 200,
          headers: { 'content-type': 'image/jpeg' },
        }),
      ),
    )

    try {
      const result = await downloadCollectionImageIndexItems({
        platform: 'temu',
        profileId: 'profile-1',
        outputDir,
        items: [downloadItem('item-1', 'https://img.kwcdn.com/product/a.jpg')],
        debug: (message, level, details) => {
          logs.push({
            message,
            level: level ?? 'info',
            ...(details ? { details } : {}),
          })
        },
      })

      expect(result.saved).toHaveLength(1)
      expect(logs.some((item) => item.message === '开始下载图池图片')).toBe(true)
      expect(
        logs.some(
          (item) =>
            item.message === '第 1/1 张成功' &&
            item.details?.bytes === 2048 &&
            typeof item.details?.durationMs === 'number',
        ),
      ).toBe(true)
      expect(
        logs.some(
          (item) =>
            item.message === '图池下载完成' &&
            item.details?.saved === 1 &&
            item.details?.failed === 0,
        ),
      ).toBe(true)
    } finally {
      await rm(outputDir, { recursive: true, force: true })
    }
  })

  it('emits per-image failure logs and keeps failed results', async () => {
    const outputDir = await mkdtemp(join(tmpdir(), 'collection-debug-failed-'))
    const logs: Array<{
      message: string
      level: string
      details?: Record<string, string | number | boolean | null | undefined>
    }> = []
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('forbidden', { status: 403 })))

    try {
      const result = await downloadCollectionImageIndexItems({
        platform: 'temu',
        profileId: 'profile-1',
        outputDir,
        items: [downloadItem('item-1', 'https://img.kwcdn.com/product/a.jpg')],
        debug: (message, level, details) => {
          logs.push({
            message,
            level: level ?? 'info',
            ...(details ? { details } : {}),
          })
        },
      })

      expect(result.saved).toHaveLength(0)
      expect(result.failed).toHaveLength(1)
      expect(
        logs.some(
          (item) =>
            item.message === '第 1/1 张失败' &&
            item.level === 'error' &&
            typeof item.details?.durationMs === 'number' &&
            typeof item.details.error === 'string',
        ),
      ).toBe(true)
      expect(
        logs.some(
          (item) =>
            item.message === '图池下载完成' && item.level === 'warn' && item.details?.failed === 1,
        ),
      ).toBe(true)
    } finally {
      await rm(outputDir, { recursive: true, force: true })
    }
  })
})

function candidateRect(x: number, y: number, width: number, height: number) {
  return {
    rect: rect(x, y, width, height),
    naturalWidth: width,
    naturalHeight: height,
  }
}

function rect(x: number, y: number, width: number, height: number) {
  return {
    x,
    y,
    width,
    height,
    right: x + width,
    bottom: y + height,
  }
}

function downloadItem(id: string, originalUrl: string): CollectionImageIndexItem {
  return {
    id,
    bucket: 'loose',
    pageKind: 'search',
    source: 'img',
    displayUrl: originalUrl,
    originalUrl,
    score: 100,
    visible: true,
    rect: null,
    naturalWidth: 1300,
    naturalHeight: 1300,
    goodsLink: null,
    groupKey: null,
    groupTitle: null,
    coverUrl: null,
    tag: 'img',
    sourcePageUrl: 'https://www.temu.com/search_result.html?search_key=bag',
    sourcePageTitle: 'Search',
  }
}
