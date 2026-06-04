import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Page } from 'playwright'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  type CollectionImageIndexItem,
  chooseCollectionCurrentPage,
  collectionImageIndexChooseTemuSeeMoreCandidateIndex,
  collectionImageIndexDetailGalleryBounds,
  collectionImageIndexExtractTemuShopImagesFromSsr,
  collectionImageIndexIsTemuShopPageUrl,
  collectionImageIndexIsTemuVerificationPageUrl,
  collectionImageIndexItemTargetDir,
  collectionImageIndexOpenPageTargetIndex,
  collectionImageIndexPageKind,
  collectionImageIndexProductFolderName,
  collectionImageIndexRectCenterInside,
  collectionImageIndexSearchSeeMoreClicks,
  collectionImageIndexShouldRetryTemuSearchSeeMore,
  collectionImageIndexTemuSearchSeeMoreMissRecovery,
  collectionImageIndexUpgradeTemuImageUrl,
  downloadCollectionImageIndexItems,
} from './collection-image-index-service'

let mockWorkbenchRoot = ''

vi.mock('../onboarding', () => ({
  readAppConfig: async () => ({ workbench_root: mockWorkbenchRoot }),
}))

afterEach(() => {
  vi.unstubAllGlobals()
  mockWorkbenchRoot = ''
})

const COLLECTION_TASK_DIR = '/tmp/output/temu-20260531-120000'

describe('collection image index product folders', () => {
  it('detects Temu regional goods detail URLs from -g-id slugs', () => {
    const folderName = collectionImageIndexProductFolderName(
      'temu',
      'https://www.temu.com/ca/happy-face-painting-gifts-g-601101959736135.html',
      { goodsLink: null },
    )

    expect(folderName).toBe('temu-g-601101959736135')
  })

  it('keeps Temu search page goods images in the task folder', () => {
    const targetDir = collectionImageIndexItemTargetDir(
      COLLECTION_TASK_DIR,
      'temu',
      'https://www.temu.com/search_result.html?search_key=six%20seven',
      {
        goodsLink: 'https://www.temu.com/ca/example-product-g-606267330393299.html',
      },
    )

    expect(targetDir).toBe(COLLECTION_TASK_DIR)
  })

  it('uses the item source detail page for product folders', () => {
    const targetDir = collectionImageIndexItemTargetDir(
      COLLECTION_TASK_DIR,
      'temu',
      'https://www.temu.com/search_result.html?search_key=six%20seven',
      {
        goodsLink: null,
        sourcePageUrl: 'https://www.temu.com/ca/source-product-g-601099697798918.html',
      },
    )

    expect(targetDir).toBe(`${COLLECTION_TASK_DIR}/商品页/temu-g-601099697798918`)
  })

  it('uses an explicit product group key for product folders', () => {
    const targetDir = collectionImageIndexItemTargetDir(
      COLLECTION_TASK_DIR,
      'temu',
      'https://www.temu.com/search_result.html?search_key=six%20seven',
      {
        bucket: 'product',
        groupKey: 'temu-g-606267330393299',
        goodsLink: null,
      },
    )

    expect(targetDir).toBe(`${COLLECTION_TASK_DIR}/商品页/temu-g-606267330393299`)
  })

  it('keeps non-product Temu images in the task folder', () => {
    const targetDir = collectionImageIndexItemTargetDir(
      COLLECTION_TASK_DIR,
      'temu',
      'https://www.temu.com/search_result.html?search_key=six%20seven',
      { goodsLink: null },
    )

    expect(targetDir).toBe(COLLECTION_TASK_DIR)
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
    expect(
      collectionImageIndexPageKind(
        'temu',
        'https://www.temu.com/mall.html?mall_id=634418228197396',
      ),
    ).toBe('shop')
    expect(
      collectionImageIndexPageKind(
        'temu',
        'https://www.temu.com/mall.html?mall_id=634418228197396&goods_id=605661857420796',
      ),
    ).toBe('shop')
    expect(
      collectionImageIndexPageKind(
        'temu',
        'https://www.temu.com/ca/al-garments-m-634418228197396.html',
      ),
    ).toBe('shop')
  })
})

describe('collection image index Temu See more chooser', () => {
  it('allows more than ten search see more clicks up to the shared cap', () => {
    expect(collectionImageIndexSearchSeeMoreClicks(99)).toBe(50)
  })

  it('retries one failed Temu search see more miss before giving up', () => {
    expect(collectionImageIndexShouldRetryTemuSearchSeeMore(0)).toBe(true)
    expect(collectionImageIndexShouldRetryTemuSearchSeeMore(1)).toBe(true)
    expect(collectionImageIndexShouldRetryTemuSearchSeeMore(2)).toBe(false)
  })

  it('nudges the Temu search page once after a miss before retrying', async () => {
    const calls: string[] = []
    const page = {
      evaluate: async () => {
        calls.push('evaluate')
        return null
      },
      waitForTimeout: async (timeoutMs: number) => {
        calls.push(`wait:${timeoutMs}`)
      },
    } as Pick<Page, 'evaluate' | 'waitForTimeout'>

    await collectionImageIndexTemuSearchSeeMoreMissRecovery(page)

    expect(calls).toEqual(['evaluate', 'wait:650'])
  })

  it('prefers aria-label See more items candidates', () => {
    const index = collectionImageIndexChooseTemuSeeMoreCandidateIndex([
      {
        label: 'See more',
        text: 'See more',
        ariaLabel: '',
        area: 1600,
        visible: true,
      },
      {
        label: 'See more items See more',
        text: 'See more',
        ariaLabel: 'See more items',
        area: 3200,
        visible: true,
      },
    ])

    expect(index).toBe(1)
  })

  it('uses the smallest visible text candidate when aria-label is missing', () => {
    const index = collectionImageIndexChooseTemuSeeMoreCandidateIndex([
      {
        label: 'See more',
        text: 'See more',
        ariaLabel: '',
        area: 12_000,
        visible: true,
      },
      {
        label: 'See more',
        text: 'See more',
        ariaLabel: '',
        area: 800,
        visible: true,
      },
      {
        label: 'See more',
        text: 'See more',
        ariaLabel: '',
        area: 200,
        visible: false,
      },
    ])

    expect(index).toBe(1)
  })

  it('ignores unrelated candidates', () => {
    expect(
      collectionImageIndexChooseTemuSeeMoreCandidateIndex([
        {
          label: 'Download app',
          text: 'Download app',
          ariaLabel: '',
          area: 1200,
          visible: true,
        },
      ]),
    ).toBeNull()
  })
})

describe('collection image index Temu shop page SSR parser', () => {
  it('detects Temu shop URLs', () => {
    expect(
      collectionImageIndexIsTemuShopPageUrl(
        'https://www.temu.com/mall.html?mall_id=634418228197396',
      ),
    ).toBe(true)
    expect(
      collectionImageIndexIsTemuShopPageUrl(
        'https://www.temu.com/mall.html?mall_id=634418228197396&goods_id=605661857420796',
      ),
    ).toBe(true)
    expect(
      collectionImageIndexIsTemuShopPageUrl(
        'https://www.temu.com/ca/al-garments-m-634418228197396.html',
      ),
    ).toBe(true)
    expect(
      collectionImageIndexIsTemuShopPageUrl(
        'https://www.temu.com/ca/product-g-606267330393299.html',
      ),
    ).toBe(false)
  })

  it('detects Temu verification URLs so they are not scanned as image pools', () => {
    expect(
      collectionImageIndexIsTemuVerificationPageUrl(
        'https://www.temu.com/bgn_verification.html?from=https%3A%2F%2Fwww.temu.com%2Fsearch_result.html',
      ),
    ).toBe(true)
    expect(
      collectionImageIndexIsTemuVerificationPageUrl(
        'https://www.temu.com/mall.html?mall_id=634418228197396',
      ),
    ).toBe(false)
  })

  it('extracts product-related shop images from Temu rawData and skips decorations', () => {
    const rawData = {
      store: {
        categoryStore: {
          goodsList: [
            {
              data: {
                image: {
                  url: 'https://img.kwcdn.com/product/open/a-goods.jpeg',
                  width: 1340,
                  height: 1785,
                },
                goodsId: 606533735830828,
                title: 'First shirt',
                seoLinkUrl: '/ca/first-shirt-g-606533735830828.html',
              },
            },
            {
              data: {
                image: {
                  url: 'https://aimg.kwcdn.com/upload_aimg/iconphoto/icon.png',
                  width: 64,
                  height: 64,
                },
                goodsId: 111,
                title: 'Decoration',
              },
            },
            {
              data: {
                image: {
                  url: 'https://img.kwcdn.com/product/open/a-goods.jpeg',
                  width: 1340,
                  height: 1785,
                },
                goodsId: 606533735830828,
                title: 'Duplicate shirt',
              },
            },
          ],
          topItemsList: [
            {
              topItemsGoodsSimpleInfoList: [
                {
                  goodsId: 606039814538424,
                  imageUrl: 'https://img.kwcdn.com/product/fancy/b.jpg',
                  title: 'Second shirt',
                  linkUrl: 'goods.html?goods_id=606039814538424',
                },
              ],
            },
          ],
        },
      },
    }
    const result = collectionImageIndexExtractTemuShopImagesFromSsr(
      [`window.__CHUNK_DATA__={};window.rawData=${JSON.stringify(rawData)};`],
      'https://www.temu.com/mall.html?mall_id=634418228197396',
    )

    expect(result).toEqual([
      {
        displayUrl: 'https://img.kwcdn.com/product/open/a-goods.jpeg',
        goodsId: '606533735830828',
        goodsLink: 'https://www.temu.com/ca/first-shirt-g-606533735830828.html',
        groupTitle: 'First shirt',
        naturalWidth: 1340,
        naturalHeight: 1785,
      },
      {
        displayUrl: 'https://img.kwcdn.com/product/fancy/b.jpg',
        goodsId: '606039814538424',
        goodsLink: 'https://www.temu.com/goods.html?goods_id=606039814538424',
        groupTitle: 'Second shirt',
        naturalWidth: 0,
        naturalHeight: 0,
      },
    ])
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

  it('does not mark Temu mall URLs with goods_id query as goods detail pages', () => {
    const result = chooseCollectionCurrentPage(
      'temu',
      [
        {
          pageUrl:
            'https://www.temu.com/mall.html?mall_id=634418228197396&goods_id=605661857420796',
          title: 'Temu shop',
          visible: true,
          focused: true,
          lastActivityAt: 100,
          detectedAt: 1000,
        },
      ],
      undefined,
    )

    expect(result).toMatchObject({
      pageUrl: 'https://www.temu.com/mall.html?mall_id=634418228197396&goods_id=605661857420796',
      status: 'active',
      isGoodsPage: false,
      goodsId: null,
    })
  })

  it('chooses the focused visible page as the open-page navigation target', () => {
    const index = collectionImageIndexOpenPageTargetIndex([
      {
        pageUrl: 'https://www.temu.com/search_result.html?search_key=a',
        title: 'Search',
        visible: true,
        focused: false,
        lastActivityAt: 500,
        detectedAt: 1000,
      },
      {
        pageUrl: 'https://www.temu.com/ca/example-g-606267330393299.html',
        title: 'Goods',
        visible: true,
        focused: true,
        lastActivityAt: 100,
        detectedAt: 1000,
      },
    ])

    expect(index).toBe(1)
  })

  it('returns no open-page navigation target when no page is active', () => {
    const index = collectionImageIndexOpenPageTargetIndex([
      {
        pageUrl: 'https://www.temu.com/search_result.html?search_key=a',
        title: 'Search',
        visible: false,
        focused: false,
        lastActivityAt: 500,
        detectedAt: 1000,
      },
    ])

    expect(index).toBeNull()
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
    const workbenchRoot = await mkdtemp(join(tmpdir(), 'collection-debug-success-'))
    mockWorkbenchRoot = workbenchRoot
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
      await rm(workbenchRoot, { recursive: true, force: true })
    }
  })

  it('emits per-image failure logs and keeps failed results', async () => {
    const workbenchRoot = await mkdtemp(join(tmpdir(), 'collection-debug-failed-'))
    mockWorkbenchRoot = workbenchRoot
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
      await rm(workbenchRoot, { recursive: true, force: true })
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
