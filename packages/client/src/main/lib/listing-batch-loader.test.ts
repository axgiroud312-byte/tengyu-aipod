import { mkdir, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { SLICE_8_LISTING_TEMPLATES } from '@tengyu-aipod/shared'
import ExcelJS from 'exceljs'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { loadBatchAsListingItems } from './listing-batch-loader'

let tempRoot = ''

async function createWorkbook(path: string, rows: Array<[string, string]>) {
  await mkdir(dirname(path), { recursive: true })
  const workbook = new ExcelJS.Workbook()
  const sheet = workbook.addWorksheet('Titles')
  sheet.addRow(['货号', '标题'])
  for (const row of rows) {
    sheet.addRow(row)
  }
  await workbook.xlsx.writeFile(path)
}

async function pathExists(path: string) {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}

async function createFiles(folder: string, files: string[]) {
  await mkdir(folder, { recursive: true })
  for (const file of files) {
    await writeFile(join(folder, file), 'content')
  }
}

beforeEach(async () => {
  const { mkdtemp } = await import('node:fs/promises')
  tempRoot = await mkdtemp(join(tmpdir(), 'tengyu-listing-batch-loader-'))
})

afterEach(async () => {
  await rm(tempRoot, { recursive: true, force: true })
})

describe('listing batch loader', () => {
  it('loads titled sku folders as listing items with natural image ordering', async () => {
    const batchDir = join(tempRoot, 'batch')
    await createWorkbook(join(batchDir, '标题.xlsx'), [
      ['SKU2', 'Second product'],
      ['SKU10', 'Excluded product'],
      ['SKU-MISSING-IMAGE', 'Missing image product'],
    ])
    await createFiles(join(batchDir, 'SKU2'), ['10.jpg', '1.png', '2.webp', 'note.txt'])
    await createFiles(join(batchDir, 'SKU10'), ['1.jpg'])
    await mkdir(join(batchDir, 'SKU-MISSING-IMAGE'), { recursive: true })
    await createFiles(join(batchDir, 'SKU-NO-TITLE'), ['1.jpg'])

    const result = await loadBatchAsListingItems(batchDir, {
      template: SLICE_8_LISTING_TEMPLATES[0],
      excludedFolderNames: ['SKU10'],
    })

    expect(result.items.map((item) => item.sku)).toEqual(['SKU2'])
    expect(result.listingItems).toHaveLength(1)
    expect(result.listingItems[0]).toMatchObject({
      id: 'temu-clothing-SKU2',
      sku: 'SKU2',
      title: 'Second product',
      platform: 'temu-pop',
      templateKey: 'temu-clothing',
      editUrl: SLICE_8_LISTING_TEMPLATES[0].editUrl,
      materialRootDir: batchDir,
      targetShopName: '',
    })
    expect(result.listingItems[0]?.imageGroups.material).toEqual([
      join(batchDir, 'SKU2', '1.png'),
      join(batchDir, 'SKU2', '2.webp'),
      join(batchDir, 'SKU2', '10.jpg'),
    ])
    expect(result.warnings).toEqual([
      '货号 SKU-MISSING-IMAGE 文件夹没有可上架图片，跳过',
      '货号 SKU-NO-TITLE 在 标题.xlsx 中无标题，跳过',
    ])
  })

  it('maps nested color folders to variant groups and sku image group', async () => {
    const batchDir = join(tempRoot, 'shein')
    await createWorkbook(join(batchDir, '标题.xlsx'), [['GzG0001', 'Shein product']])
    await createFiles(join(batchDir, 'GzG0001'), ['cover.jpg', 'video.mp4', '产品描述.txt'])
    await createFiles(join(batchDir, 'GzG0001', '蓝色'), ['2.jpg', '1.jpg'])
    await createFiles(join(batchDir, 'GzG0001', '红色'), ['1.png'])

    const result = await loadBatchAsListingItems(batchDir, {
      template: SLICE_8_LISTING_TEMPLATES[2],
    })

    expect(result.listingItems).toHaveLength(1)
    expect(result.listingItems[0]?.variantGroups).toEqual([
      {
        id: '红色',
        name: '红色',
        imagePaths: [join(batchDir, 'GzG0001', '红色', '1.png')],
      },
      {
        id: '蓝色',
        name: '蓝色',
        imagePaths: [
          join(batchDir, 'GzG0001', '蓝色', '1.jpg'),
          join(batchDir, 'GzG0001', '蓝色', '2.jpg'),
        ],
      },
    ])
    expect(result.listingItems[0]?.imageGroups.material).toEqual([
      join(batchDir, 'GzG0001', 'cover.jpg'),
    ])
    expect(result.listingItems[0]?.imageGroups.sku).toEqual([
      join(batchDir, 'GzG0001', '红色', '1.png'),
      join(batchDir, 'GzG0001', '蓝色', '1.jpg'),
      join(batchDir, 'GzG0001', '蓝色', '2.jpg'),
    ])
    expect(result.listingItems[0]?.videoPaths).toEqual([join(batchDir, 'GzG0001', 'video.mp4')])
    expect(result.listingItems[0]?.descriptionText).toBe('content')
  })

  it('falls back to legacy titles.xlsx when 标题.xlsx is missing', async () => {
    const batchDir = join(tempRoot, 'legacy')
    await createWorkbook(join(batchDir, 'titles.xlsx'), [['SKU1', 'Legacy product']])
    await createFiles(join(batchDir, 'SKU1'), ['1.jpg'])

    const result = await loadBatchAsListingItems(batchDir, {
      template: SLICE_8_LISTING_TEMPLATES[0],
    })

    expect(result.listingItems[0]).toMatchObject({
      sku: 'SKU1',
      title: 'Legacy product',
    })
    expect(result.warnings).toEqual([])
  })

  it('scans real Slice 8 material roots when they exist', async () => {
    for (const template of SLICE_8_LISTING_TEMPLATES) {
      if (!(await pathExists(template.materialRootDir))) {
        continue
      }

      const result = await loadBatchAsListingItems(template.materialRootDir, { template })

      expect(result.rootDir).toBe(template.materialRootDir)
      expect(result.templateKey).toBe(template.key)
      expect(Array.isArray(result.warnings)).toBe(true)
      if (template.key === 'temu-clothing') {
        expect(result.warnings.some((warning) => warning.includes('GzG00010'))).toBe(false)
      }
    }
  })
})
