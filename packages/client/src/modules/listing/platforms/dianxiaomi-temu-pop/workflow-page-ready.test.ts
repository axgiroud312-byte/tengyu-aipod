import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  type ListingConfig,
  type ListingItem,
  SLICE_8_LISTING_TEMPLATES,
} from '@tengyu-aipod/shared'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { TemuPopDraftPageState } from './page-parser'
import { TEMU_POP_WORKFLOW_STAGES, type TemuPopWorkflowActions, runListingItem } from './workflow'

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

describe('Temu PopTemu workflow page_ready', () => {
  it('waits until page_ready observes an editable draft page', async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'temu-workflow-'))
    parser.parseDraftPage
      .mockResolvedValueOnce(createState({ workflow_step: 'loading', is_loading: true }))
      .mockResolvedValue(createState())
    const page = createPage()

    const result = await runListingItem(page as never, createItem(), createConfig(), {
      actions: createActions(),
      now: createClock(),
    })

    expect(result.status).toBe('success')
    expect(page.waitForTimeout).toHaveBeenCalledWith(250)
    expect(result.stages.map((stage) => stage.stage)).toEqual(TEMU_POP_WORKFLOW_STAGES)
  })
})

function createItem(): ListingItem {
  return {
    id: 'item-1',
    sku: 'SKU-1',
    title: 'Listing title',
    platform: 'temu-pop',
    templateKey: 'temu-general',
    editUrl: 'https://www.dianxiaomi.com/web/popTemu/edit?id=128935194833519551',
    materialRootDir: '/Users/macmini/Desktop/素材文件夹',
    targetShopName: 'JoyCatVI',
    imageGroups: {
      sku: [],
      carousel: [],
      material: [],
      preview: [],
      description: [],
    },
    variantGroups: [],
    videoPaths: [],
  }
}

function createConfig(): ListingConfig {
  if (!tempDir) {
    throw new Error('tempDir must be created before createConfig')
  }
  return {
    batchId: 'batch-1',
    profileId: '2-1111',
    template: SLICE_8_LISTING_TEMPLATES[1],
    submitMode: 'save-draft',
    maxAttempts: 1,
    timeoutMs: 1_000,
    evidenceDir: tempDir,
  }
}

function createPage() {
  return {
    url: vi.fn(() => 'about:blank'),
    goto: vi.fn(async () => undefined),
    waitForTimeout: vi.fn(async () => undefined),
    screenshot: vi.fn(async () => undefined),
    content: vi.fn(async () => '<html><body>temu</body></html>'),
    evaluate: vi.fn(async () => '<html><body>temu</body></html>'),
  }
}

function createActions(): TemuPopWorkflowActions {
  return {
    replaceShopName: vi.fn(async () => createState()),
    fillTitle: vi.fn(async () => createState({ title_field: textField('Listing title') })),
    fillSku: vi.fn(async () => createState({ sku_field: textField('SKU-1') })),
    uploadMaterialImages: vi.fn(async () => ({
      action: 'uploaded' as const,
      files: [],
      beforeCount: 1,
      afterCount: 2,
      selector: 'css=.upload',
    })),
    uploadVideo: vi.fn(async () => ({
      action: 'uploaded' as const,
      files: [],
      beforeCount: 1,
      afterCount: 2,
      selector: 'css=.video',
    })),
    generateSkuCode: vi.fn(async () => createState()),
  }
}

function createClock() {
  let value = 1_000
  return () => {
    value += 1
    return value
  }
}

function createState(overrides: Partial<TemuPopDraftPageState> = {}): TemuPopDraftPageState {
  return {
    url: 'https://www.dianxiaomi.com/web/popTemu/edit?id=128935194833519551',
    page_title: '店小秘--编辑Temu半托管产品',
    template_key: 'general',
    shop_context: 'dianxiaomi-temu-pop',
    workflow_step: 'editing',
    is_login_required: false,
    is_loading: false,
    is_blocking_modal: false,
    shop_field: textField('JoyCatVI'),
    category_field: textField('户外帐篷'),
    title_field: textField('Listing title'),
    english_title_field: textField('Listing title'),
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
    ...overrides,
  }
}

function textField(value: string) {
  return {
    found: true,
    current_value: value,
    is_disabled: false,
    selector: 'css=.example',
  } as const
}

function imageSection(count: number) {
  return {
    found: true,
    count,
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

function toast(message: string | null) {
  return {
    found: message !== null,
    message,
    selector: message === null ? null : ('css=.example' as const),
  }
}
