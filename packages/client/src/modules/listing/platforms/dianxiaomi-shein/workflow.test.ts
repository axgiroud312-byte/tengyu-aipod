import type { ListingItem } from '@tengyu-aipod/shared'
import { describe, expect, it } from 'vitest'
import { SHEIN_WORKFLOW_STAGES, selectSheinUploadImageFiles } from './workflow'

const REAL_SHEIN_SKU = '/Users/macmini/Desktop/服装素材摆放举例/GzG0001/白色/1_07.jpg'
const REAL_SHEIN_CAROUSEL = '/Users/macmini/Desktop/服装素材摆放举例/GzG0001/GzG0001_01.jpg'
const REAL_SHEIN_VARIANT = '/Users/macmini/Desktop/服装素材摆放举例/GzG0001/黑色/1_07.jpg'

describe('Shein workflow contract', () => {
  it('keeps the required stage sequence for the v1 Shein draft flow', () => {
    expect(SHEIN_WORKFLOW_STAGES).toEqual([
      'enter_page',
      'page_ready',
      'confirm_shop_context',
      'fill_title_and_sku',
      'replace_images',
      'upload_video',
      'generate_sku_code',
      'process_description',
      'submit_publish',
      'publish_result',
    ])
  })

  it('selects Shein image files by sku images first, then fallback groups and variants', () => {
    expect(
      selectSheinUploadImageFiles(
        createItem({
          sku: [REAL_SHEIN_SKU],
          carousel: [REAL_SHEIN_CAROUSEL],
          material: [],
          preview: [REAL_SHEIN_CAROUSEL],
          description: [],
        }),
      ),
    ).toEqual([REAL_SHEIN_SKU, REAL_SHEIN_CAROUSEL, REAL_SHEIN_VARIANT])
  })
})

function createItem(
  imageGroups: ListingItem['imageGroups'] = {
    sku: [],
    carousel: [],
    material: [],
    preview: [],
    description: [],
  },
): ListingItem {
  return {
    id: 'item-1',
    sku: 'GzG0001',
    title: 'Listing title',
    platform: 'shein',
    templateKey: 'shein',
    editUrl: 'https://www.dianxiaomi.com/web/sheinProduct/edit?id=128935201966452551',
    materialRootDir: '/Users/macmini/Desktop/服装素材摆放举例/GzG0001',
    targetShopName: 'Shein Shop',
    imageGroups,
    variantGroups: [{ id: 'black', name: '黑色', imagePaths: [REAL_SHEIN_VARIANT] }],
    videoPaths: [],
  }
}
