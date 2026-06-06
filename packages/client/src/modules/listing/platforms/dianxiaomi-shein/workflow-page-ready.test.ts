import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  type ListingConfig,
  type ListingItem,
  SLICE_8_LISTING_TEMPLATES,
} from '@tengyu-aipod/shared'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  control,
  imageSection,
  createState as mergeState,
  textField,
  toast,
} from '../_commons/test-helpers'
import type { SheinDraftPageState } from './page-parser'
import { SHEIN_WORKFLOW_STAGES, type SheinWorkflowActions, runListingItem } from './workflow'

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

describe('Shein workflow page_ready', () => {
  it('waits until page_ready observes an editable draft page', async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'shein-workflow-'))
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
    expect(result.stages.map((stage) => stage.stage)).toEqual(SHEIN_WORKFLOW_STAGES)
    expect(
      result.stages.every(
        (stage) =>
          typeof stage.details?.observed_state === 'string' &&
          typeof stage.details?.target_state === 'string' &&
          typeof stage.details?.transition === 'string' &&
          typeof stage.details?.success_evidence === 'string',
      ),
    ).toBe(true)
  })

  it('fails production publish mode when the submit executor is not available', async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'shein-workflow-'))
    parser.parseDraftPage.mockResolvedValue(createState())
    const page = createPage()

    await expect(
      runListingItem(page as never, createItem(), createConfig({ submitMode: 'publish' }), {
        actions: createActions(),
        allowMutation: true,
        allowPublish: true,
        now: createClock(),
      }),
    ).rejects.toMatchObject({
      code: 'PUBLISH_FAILED',
      retryable: false,
      stage: 'submit_publish',
    })
  })
})

function createItem(): ListingItem {
  return {
    id: 'item-1',
    sku: 'GzG0001',
    title: 'Listing title',
    platform: 'shein',
    templateKey: 'shein',
    editUrl: 'https://www.dianxiaomi.com/web/sheinProduct/edit?id=128935201966452551',
    materialRootDir: '/Users/macmini/Desktop/服装素材摆放举例/GzG0001',
    targetShopName: 'Shein Shop',
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

function createConfig(overrides: Partial<ListingConfig> = {}): ListingConfig {
  if (!tempDir) {
    throw new Error('tempDir must be created before createConfig')
  }
  return {
    batchId: 'batch-1',
    profileId: '2-1111',
    template: {
      ...SLICE_8_LISTING_TEMPLATES[2],
      uploadVideo: false,
      skuMode: 'manual',
    },
    submitMode: 'save-draft',
    maxAttempts: 1,
    timeoutMs: 1_000,
    evidenceDir: tempDir,
    ...overrides,
  }
}

function createPage() {
  return {
    url: vi.fn(() => 'about:blank'),
    goto: vi.fn(async () => undefined),
    waitForTimeout: vi.fn(async () => undefined),
    screenshot: vi.fn(async () => undefined),
    content: vi.fn(async () => '<html><body>shein</body></html>'),
    evaluate: vi.fn(async () => '<html><body>shein</body></html>'),
  }
}

function createActions(): SheinWorkflowActions {
  return {
    replaceShopName: vi.fn(async () => createState()),
    fillTitle: vi.fn(async () => createState({ title_field: textField('Listing title') })),
    fillSku: vi.fn(async () => createState({ sku_field: textField('GzG0001') })),
    replaceImages: vi.fn(async () => ({
      variantImages: null,
      detailImages: null,
    })),
    uploadVideo: vi.fn(async () => ({
      action: 'uploaded' as const,
      files: [],
      beforeCount: 0,
      afterCount: 1,
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
    title_field: textField('Listing title'),
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
    variant_images: imageSection(3, { kind: 'upload' }),
    detail_images: imageSection(4, { kind: 'upload' }),
    video_section: imageSection(0, { kind: 'upload' }),
    sales_info_section: control('销售信息'),
    save_button: control('保存'),
    publish_button: control('发布'),
    success_toast: toast(null),
    failure_toast: toast(null),
  }
  return mergeState(state, overrides)
}
