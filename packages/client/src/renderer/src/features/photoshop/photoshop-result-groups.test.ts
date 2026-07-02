import type { PhotoshopBatchOutputGroup } from '@tengyu-aipod/shared'
import { describe, expect, it } from 'vitest'
import {
  filterPhotoshopSkuCards,
  mergePhotoshopResultGroup,
  photoshopSkuCards,
  skuFolderPathFromOutputs,
} from './photoshop-result-groups'

function group(input: {
  templateId: string
  templateName: string
  groupIndex: number
  skuFolder: string
  outputs: string[]
  status?: PhotoshopBatchOutputGroup['status']
}): PhotoshopBatchOutputGroup {
  return {
    template_id: input.templateId,
    template_name: input.templateName,
    group_index: input.groupIndex,
    sku_folder: input.skuFolder,
    print_ids: [input.skuFolder],
    outputs: input.outputs,
    status: input.status ?? 'completed',
  }
}

describe('photoshop result groups', () => {
  it('upserts realtime groups without duplicating final results', () => {
    const first = group({
      templateId: 'tpl-1',
      templateName: 'front',
      groupIndex: 0,
      skuFolder: 'SKU-001',
      outputs: ['C:\\work\\04-上架工作区\\batch\\SKU-001\\front-01.jpg'],
    })
    const updated = group({
      templateId: 'tpl-1',
      templateName: 'front',
      groupIndex: 0,
      skuFolder: 'SKU-001',
      outputs: [
        'C:\\work\\04-上架工作区\\batch\\SKU-001\\front-01.jpg',
        'C:\\work\\04-上架工作区\\batch\\SKU-001\\front-02.jpg',
      ],
    })

    expect(mergePhotoshopResultGroup([], first)).toEqual([first])
    expect(mergePhotoshopResultGroup([first], updated)).toEqual([updated])
  })

  it('groups multiple template outputs into one sku card using the first image as cover', () => {
    const cards = photoshopSkuCards([
      group({
        templateId: 'tpl-1',
        templateName: 'front',
        groupIndex: 0,
        skuFolder: 'SKU-001',
        outputs: ['C:\\work\\batch\\SKU-001\\front-01.jpg'],
      }),
      group({
        templateId: 'tpl-2',
        templateName: 'back',
        groupIndex: 0,
        skuFolder: 'SKU-001',
        outputs: ['C:\\work\\batch\\SKU-001\\back-01.jpg'],
      }),
    ])

    expect(cards).toEqual([
      {
        skuFolder: 'SKU-001',
        coverPath: 'C:\\work\\batch\\SKU-001\\front-01.jpg',
        folderPath: 'C:\\work\\batch\\SKU-001',
        imageCount: 2,
        templates: ['front', 'back'],
        status: 'completed',
        outputs: [
          'C:\\work\\batch\\SKU-001\\front-01.jpg',
          'C:\\work\\batch\\SKU-001\\back-01.jpg',
        ],
      },
    ])
  })

  it('filters sku cards by result status', () => {
    const cards = photoshopSkuCards([
      group({
        templateId: 'tpl-1',
        templateName: 'front',
        groupIndex: 0,
        skuFolder: 'SKU-001',
        outputs: ['C:\\work\\batch\\SKU-001\\front-01.jpg'],
      }),
      group({
        templateId: 'tpl-1',
        templateName: 'front',
        groupIndex: 1,
        skuFolder: 'SKU-002',
        outputs: ['C:\\work\\batch\\SKU-002\\front-01.jpg'],
        status: 'skipped',
      }),
    ])

    expect(filterPhotoshopSkuCards(cards, 'all').map((card) => card.skuFolder)).toEqual([
      'SKU-001',
      'SKU-002',
    ])
    expect(filterPhotoshopSkuCards(cards, 'done').map((card) => card.skuFolder)).toEqual([
      'SKU-001',
    ])
    expect(filterPhotoshopSkuCards(cards, 'skipped').map((card) => card.skuFolder)).toEqual([
      'SKU-002',
    ])
    expect(filterPhotoshopSkuCards(cards, 'failed')).toEqual([])
  })

  it('derives the sku folder path from the first output path', () => {
    expect(
      skuFolderPathFromOutputs(['C:\\work\\04-上架工作区\\套版-20260701\\SKU-001\\front-01.jpg']),
    ).toBe('C:\\work\\04-上架工作区\\套版-20260701\\SKU-001')
    expect(skuFolderPathFromOutputs([])).toBeNull()
  })
})
