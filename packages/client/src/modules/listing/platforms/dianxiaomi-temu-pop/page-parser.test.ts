import { describe, expect, it } from 'vitest'
import { control, imageSection, textField, toast } from '../_commons/test-helpers'
import type { TemuPopDraftPageState } from './page-parser'

describe('Temu PopTemu page parser contract', () => {
  it('keeps parser state serializable for executor/workflow boundaries', () => {
    const state = {
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
      title_field: textField('Example title'),
      english_title_field: textField('Example title'),
      sku_field: textField('T061218230080'),
      carousel_images: imageSection(5),
      material_images: imageSection(1),
      preview_images: imageSection(1),
      description_images: imageSection(1),
      variant_attribute_section: control('变种属性'),
      one_click_sku: control('一键生成'),
      sku_table: {
        found: true,
        table_count: 2,
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
    } satisfies TemuPopDraftPageState

    expect(JSON.parse(JSON.stringify(state))).toEqual(state)
  })
})
