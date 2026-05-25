import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ListingActionError, replaceShopName, uploadVariantImages } from './action-executor'
import type { SheinDraftPageState } from './page-parser'

const parser = vi.hoisted(() => ({
  parseDraftPage: vi.fn<() => Promise<SheinDraftPageState>>(),
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

describe('Dianxiaomi Shein action executor contract', () => {
  it('exposes structured listing action errors', () => {
    const error = new ListingActionError({
      action: 'fillTitle',
      code: 'FIELD_VALUE_MISMATCH',
      message: 'title mismatch',
      selector: 'css=#productInfo input',
      pageText: '店小秘 Shein 编辑页',
    })

    expect(error).toMatchObject({
      name: 'ListingActionError',
      action: 'fillTitle',
      code: 'FIELD_VALUE_MISMATCH',
      retryable: true,
      selector: 'css=#productInfo input',
      pageText: '店小秘 Shein 编辑页',
    })
  })

  it('rejects upload actions before touching a page when real files are absent', async () => {
    await expect(uploadVariantImages({} as never, [])).rejects.toMatchObject({
      action: 'uploadVariantImages',
      code: 'MATERIAL_FILE_MISSING',
      retryable: false,
    })
    expect(parser.parseDraftPage).not.toHaveBeenCalled()
  })

  it('guards image uploads before touching upload controls unless mutation is explicit', async () => {
    const file = await createTempFile()
    parser.parseDraftPage.mockResolvedValue(createState())
    const page = createPage()

    await expect(uploadVariantImages(page as never, [file])).rejects.toMatchObject({
      action: 'uploadVariantImages',
      code: 'UPLOAD_COUNT_MISMATCH',
      retryable: true,
    })

    expect(page.locator).toHaveBeenCalledWith('body')
    expect(page.locator).not.toHaveBeenCalledWith('#localFileUploadInp, input[type="file"]')
  })

  it('allows same-shop replacement without opening the shop dropdown', async () => {
    const state = createState({ shop_field: textField('Shein Shop') })
    parser.parseDraftPage.mockResolvedValue(state)
    const page = createPage()

    const result = await replaceShopName(page as never, 'Shein Shop')

    expect(result.shop_field.current_value).toBe('Shein Shop')
    expect(page.locator).not.toHaveBeenCalled()
  })
})

async function createTempFile() {
  tempDir = await mkdtemp(join(tmpdir(), 'shein-executor-'))
  const file = join(tempDir, 'image.png')
  await writeFile(file, 'fake image')
  return file
}

function createState(overrides: Partial<SheinDraftPageState> = {}): SheinDraftPageState {
  const state: SheinDraftPageState = {
    url: 'https://www.dianxiaomi.com/web/sheinProduct/edit?id=128935201966452551',
    page_title: '店小秘--编辑SHEIN产品',
    template_key: 'shein',
    shop_context: 'dianxiaomi-shein',
    workflow_step: 'editing',
    is_login_required: false,
    is_loading: false,
    is_blocking_modal: false,
    shop_field: textField('Shein Shop'),
    category_field: textField('Women Blouses & Shirts'),
    title_field: textField('Original title'),
    sku_field: textField('GzG0001'),
    description_field: textField('Description'),
    product_info_section: control('产品信息'),
    image_info_section: control('图片信息'),
    variant_attribute_section: control('变种主题'),
    sku_table: {
      found: true,
      table_count: 1,
      row_count: 1,
      sku_input_count: 1,
      selector: 'css=#skuDataInfo table',
    },
    one_click_sku: control('一键生成'),
    variant_images: imageSection(3),
    detail_images: imageSection(4),
    video_section: imageSection(0),
    sales_info_section: control('销售信息'),
    save_button: control('保存'),
    publish_button: control('发布'),
    success_toast: toast(null),
    failure_toast: toast(null),
  }
  return { ...state, ...overrides }
}

function textField(value: string) {
  return {
    found: true,
    current_value: value,
    is_disabled: false,
    selector: 'css=.example',
  } as const
}

function control(text: string) {
  return {
    found: true,
    enabled: true,
    text,
    selector: 'css=.example',
  } as const
}

function imageSection(imageCount: number) {
  return {
    found: true,
    image_count: imageCount,
    upload_button_found: true,
    upload_button_enabled: true,
    selector: 'css=.example',
  } as const
}

function toast(message: string | null) {
  return {
    found: message !== null,
    message,
    selector: message === null ? null : ('css=.example' as const),
  }
}

function createPage() {
  return {
    locator: vi.fn(() => ({
      evaluate: vi.fn(async () => ''),
    })),
    waitForTimeout: vi.fn(async () => undefined),
  }
}
