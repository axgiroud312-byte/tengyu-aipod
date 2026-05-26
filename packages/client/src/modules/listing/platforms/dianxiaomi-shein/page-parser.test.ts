import { describe, expect, it } from 'vitest'
import { control, imageSection, textField, toast } from '../_commons/test-helpers'
import type { SheinDraftPageState } from './page-parser'

describe('Dianxiaomi Shein page parser contract', () => {
  it('keeps parser state serializable for executor/workflow boundaries', () => {
    const state = {
      url: 'https://www.dianxiaomi.com/web/sheinProduct/edit?id=128935201966452551',
      page_title: '店小秘--编辑SHEIN产品',
      template_key: 'shein',
      shop_context: 'dianxiaomi-shein',
      workflow_step: 'editing',
      is_login_required: false,
      is_loading: false,
      is_blocking_modal: false,
      shop_field: textField('GS1811060-墨西哥本土'),
      category_field: textField('女士衬衫(Women Blouses & Shirts)'),
      title_field: textField('Shein title'),
      sku_field: textField('GzG0001'),
      description_field: textField('Description'),
      product_info_section: control('产品信息'),
      image_info_section: control('图片信息'),
      variant_attribute_section: control('变种主题'),
      sku_table: {
        found: true,
        table_count: 1,
        row_count: 24,
        sku_input_count: 24,
        selector: 'css=#skuDataInfo table',
      },
      one_click_sku: control('一键生成'),
      variant_images: imageSection(11, { kind: 'upload' }),
      detail_images: imageSection(10, { kind: 'upload' }),
      video_section: imageSection(0, { kind: 'upload' }),
      sales_info_section: control('销售信息'),
      save_button: control('保存'),
      publish_button: control('发布'),
      success_toast: toast(null),
      failure_toast: toast(null),
    } satisfies SheinDraftPageState

    expect(JSON.parse(JSON.stringify(state))).toEqual(state)
  })
})
