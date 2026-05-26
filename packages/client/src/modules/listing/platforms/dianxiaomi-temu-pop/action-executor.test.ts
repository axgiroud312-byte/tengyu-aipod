import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  control,
  imageSection,
  createState as mergeState,
  textField,
  toast,
} from '../_commons/test-helpers'
import { ListingActionError, replaceShopName, uploadMaterialImages } from './action-executor'
import type { TemuPopDraftPageState } from './page-parser'

const parser = vi.hoisted(() => ({
  parseDraftPage: vi.fn<() => Promise<TemuPopDraftPageState>>(),
}))

vi.mock('./page-parser', () => parser)

let tempDir: string | null = null

afterEach(async () => {
  parser.parseDraftPage.mockReset()
  if (tempDir) {
    await rm(tempDir, { recursive: true, force: true })
    tempDir = null
  }
})

describe('Temu PopTemu action executor contract', () => {
  it('exposes structured listing action errors without Playwright page fixtures', () => {
    const error = new ListingActionError({
      action: 'fillTitle',
      code: 'FIELD_VALUE_MISMATCH',
      message: 'title mismatch',
      selector: 'css=input[name="title"]',
      pageText: '店小秘 Temu 编辑页',
    })

    expect(error).toMatchObject({
      name: 'ListingActionError',
      action: 'fillTitle',
      code: 'FIELD_VALUE_MISMATCH',
      retryable: true,
      selector: 'css=input[name="title"]',
      pageText: '店小秘 Temu 编辑页',
    })
  })

  it('rejects upload actions before touching a page when real files are absent', async () => {
    await expect(uploadMaterialImages({} as never, [])).rejects.toMatchObject({
      action: 'uploadMaterialImages',
      code: 'MATERIAL_FILE_MISSING',
      retryable: false,
    })
    expect(parser.parseDraftPage).not.toHaveBeenCalled()
  })

  it('guards image uploads before touching upload controls unless mutation is explicit', async () => {
    const file = await createTempFile()
    parser.parseDraftPage.mockResolvedValue(createState())
    const page = createPage()

    await expect(uploadMaterialImages(page as never, [file])).rejects.toMatchObject({
      action: 'uploadMaterialImages',
      code: 'UPLOAD_COUNT_MISMATCH',
      retryable: true,
    })

    expect(page.locator).toHaveBeenCalledWith('body')
    expect(page.locator).not.toHaveBeenCalledWith('#localFileUploadInp')
  })

  it('allows same-shop replacement without opening the shop dropdown', async () => {
    const state = createState({ shop_field: textField('JoyCatVI') })
    parser.parseDraftPage.mockResolvedValue(state)
    const page = createPage()

    const result = await replaceShopName(page as never, 'JoyCatVI')

    expect(result.shop_field.current_value).toBe('JoyCatVI')
    expect(page.locator).not.toHaveBeenCalled()
  })
})

async function createTempFile() {
  tempDir = await mkdtemp(join(tmpdir(), 'temu-executor-'))
  const file = join(tempDir, 'image.png')
  await writeFile(file, 'fake image')
  return file
}

function createState(overrides: Partial<TemuPopDraftPageState> = {}): TemuPopDraftPageState {
  const state: TemuPopDraftPageState = {
    url: 'https://www.dianxiaomi.com/web/popTemu/edit?id=128935194843933515',
    page_title: '店小秘--编辑Temu半托管产品',
    template_key: 'clothing',
    shop_context: 'dianxiaomi-temu-pop',
    workflow_step: 'editing',
    is_login_required: false,
    is_loading: false,
    is_blocking_modal: false,
    shop_field: textField('JoyCatVI'),
    category_field: textField('日晷钟'),
    title_field: textField('Original title'),
    english_title_field: textField('Original English title'),
    sku_field: textField('SKU-1'),
    carousel_images: imageSection(5),
    material_images: imageSection(1),
    preview_images: imageSection(1),
    description_images: imageSection(1),
    variant_attribute_section: control('变种属性'),
    one_click_sku: control('一键生成'),
    sku_table: {
      found: true,
      table_count: 1,
      row_count: 1,
      selector: 'css=#skuDataInfo table.myj-table',
    },
    sku_category_batch: control('(批量)'),
    packing_list_batch: control('(批量)'),
    video_section: {
      found: true,
      upload_button_found: true,
      upload_button_enabled: true,
      current_video_count: 1,
      selector: 'css=#productProductInfo .ant-form-item:has(label[title="产品视频"])',
    },
    shipping_template: textField('通用'),
    save_button: control('保存'),
    publish_button: control('发布'),
    success_toast: toast(null),
    failure_toast: toast(null),
  }
  return mergeState(state, overrides)
}

function createPage() {
  return {
    locator: vi.fn(() => ({
      evaluate: vi.fn(async () => ''),
    })),
    waitForTimeout: vi.fn(async () => undefined),
  }
}
