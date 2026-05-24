import type { ListingItem } from '@tengyu-aipod/shared'
import { describe, expect, it } from 'vitest'
import { TEMU_POP_WORKFLOW_STAGES, selectTemuPopUploadImageFiles } from './workflow'

const REAL_CLOTHING_MATERIAL = '/Users/macmini/Desktop/服装素材摆放举例/GzG0005/T70286.jpg'
const REAL_CLOTHING_SKU = '/Users/macmini/Desktop/服装素材摆放举例/GzG0005/白色/1_07.jpg'
const REAL_GENERAL_PREVIEW = '/Users/macmini/Desktop/素材文件夹/GzG0114/Gz0010_09.jpg'
const REAL_GENERAL_CAROUSEL = '/Users/macmini/Desktop/素材文件夹/GzG0114/Gz0010_08.jpg'

describe('Temu PopTemu workflow contract', () => {
  it('keeps the required 12-stage sequence', () => {
    expect(TEMU_POP_WORKFLOW_STAGES).toEqual([
      'enter_page',
      'page_ready',
      'confirm_shop_context',
      'fill_title_and_sku',
      'upload_material_images',
      'upload_video',
      'process_color_skc',
      'reuse_size_chart',
      'generate_sku_code',
      'process_description',
      'submit_publish',
      'publish_result',
    ])
  })

  it('selects image upload files by Temu template priority using real material paths', async () => {
    expect(
      selectTemuPopUploadImageFiles(
        createItem('temu-clothing', {
          material: [REAL_CLOTHING_MATERIAL],
          carousel: [REAL_GENERAL_CAROUSEL],
          sku: [REAL_CLOTHING_SKU],
          preview: [REAL_GENERAL_PREVIEW],
          description: [],
        }),
      ),
    ).toEqual([
      REAL_CLOTHING_MATERIAL,
      REAL_GENERAL_CAROUSEL,
      REAL_CLOTHING_SKU,
      REAL_GENERAL_PREVIEW,
    ])

    expect(
      selectTemuPopUploadImageFiles(
        createItem('temu-general', {
          material: [REAL_CLOTHING_MATERIAL],
          carousel: [REAL_GENERAL_CAROUSEL],
          sku: [REAL_CLOTHING_SKU],
          preview: [REAL_GENERAL_PREVIEW],
          description: [],
        }),
      ),
    ).toEqual([
      REAL_GENERAL_PREVIEW,
      REAL_GENERAL_CAROUSEL,
      REAL_CLOTHING_MATERIAL,
      REAL_CLOTHING_SKU,
    ])
  })
})

function createItem(
  templateKey: ListingItem['templateKey'],
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
    sku: 'SKU-1',
    title: 'Listing title',
    platform: 'temu-pop',
    templateKey,
    editUrl: 'https://www.dianxiaomi.com/web/popTemu/edit?id=128935194833519551',
    materialRootDir: '/Users/macmini/Desktop/素材文件夹',
    targetShopName: 'JoyCatVI',
    imageGroups,
    variantGroups: [],
    videoPaths: [],
  }
}
