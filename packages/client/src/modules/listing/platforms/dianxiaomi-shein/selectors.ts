import type { ListingSelector, SelectorRecord } from '@tengyu-aipod/shared'
import { selectorRecordMap } from '../_commons/page-locator'

export type { ListingSelector } from '@tengyu-aipod/shared'

export type SheinSelectorKey =
  | 'page_root'
  | 'shop_context'
  | 'shop_name_control'
  | 'category_control'
  | 'product_info_section'
  | 'title_input'
  | 'sku_input'
  | 'description_input'
  | 'image_info_section'
  | 'variant_attribute_section'
  | 'sku_table'
  | 'sku_input_cells'
  | 'one_click_sku_button'
  | 'sku_generate_modal'
  | 'sku_prefix_input'
  | 'variant_image_section'
  | 'variant_image_table'
  | 'variant_image_upload_button'
  | 'detail_image_section'
  | 'detail_image_table'
  | 'detail_image_upload_button'
  | 'local_image_upload_input'
  | 'video_uploader'
  | 'video_upload_button'
  | 'sales_info_section'
  | 'save_button'
  | 'publish_button'
  | 'success_toast'
  | 'failure_toast'
  | 'login_indicators'
  | 'loading_indicators'
  | 'blocking_modal'

export const SHEIN_TEMPLATE_URLS = {
  shein: 'https://www.dianxiaomi.com/web/sheinProduct/edit',
} as const

const SELECTOR_RECORD_VERSION = '1.0.0'
const SELECTOR_RECORD_CREATED_AT = '2026-05-26T00:00:00.000Z'

function selectorRecord<TKey extends SheinSelectorKey>(
  key: TKey,
  name: string,
  selectors: readonly [ListingSelector, ...ListingSelector[]],
): SelectorRecord<TKey> {
  const [primary, ...fallbacks] = selectors
  return {
    key,
    name,
    primary,
    fallbacks,
    version: SELECTOR_RECORD_VERSION,
    createdAt: SELECTOR_RECORD_CREATED_AT,
  }
}

export const SHEIN_SELECTOR_RECORDS = [
  selectorRecord('page_root', '页面根节点', [
    'css=.nav-index[routename="sheinProductEdit"]',
    'css=#productBasicInfo',
    'css=#productInfo',
    'text=SHEIN>在线产品>编辑',
  ]),
  selectorRecord('shop_context', '店铺上下文', [
    'text=SHEIN>在线产品>编辑',
    'css=.nav-index[routename="sheinProductEdit"]',
    'css=#productBasicInfo',
  ]),
  selectorRecord('shop_name_control', '店铺账号控件', [
    'css=#productBasicInfo .ant-form-item:has(label[title="店铺账号"]) .ant-select-selector',
    'css=#productBasicInfo .ant-form-item:has-text("店铺账号") .ant-select-selector',
    'label=店铺账号',
  ]),
  selectorRecord('category_control', '产品分类控件', [
    'css=#productBasicInfo .category-item .ant-select-selector',
    'css=#productBasicInfo .ant-form-item:has(label[title="产品分类"]) .ant-select-selector',
    'role=button[name="选择分类"]',
  ]),
  selectorRecord('product_info_section', '产品信息区域', ['css=#productInfo', 'text=产品信息']),
  selectorRecord('title_input', '产品标题输入框', [
    'css=#productInfo .sheinProductName input[name="productTitleBuyer"]',
    'css=#productInfo .sheinProductName input:not([type="hidden"]):not([type="file"])',
    'css=#productInfo .ant-form-item:has-text("产品标题") input:not([type="hidden"]):not([type="file"])',
  ]),
  selectorRecord('sku_input', '产品货号输入框', [
    'css=#productInfo input[name="productItemNumber"]',
    'css=#productInfo .ant-form-item:has-text("货号") input:not([type="hidden"]):not([type="file"])',
    'css=#productInfo input[name*="itemNumber" i]',
  ]),
  selectorRecord('description_input', '产品描述输入框', [
    'css=#productInfo .sheinProductDesc textarea',
    'css=#productInfo .sheinProductDesc [contenteditable="true"]',
    'css=#productInfo .ant-form-item:has-text("产品描述") textarea',
  ]),
  selectorRecord('image_info_section', '图片信息区域', ['css=#imageInfo', 'text=图片信息']),
  selectorRecord('variant_attribute_section', '变种主题区域', [
    'css=#skuAttrsInfo',
    'text=变种主题',
  ]),
  selectorRecord('sku_table', 'SKU 表格', [
    'css=#skuDataInfo table',
    'css=#skuDataInfo',
    'text=变种信息',
  ]),
  selectorRecord('sku_input_cells', 'SKU 输入单元格', [
    'css=#skuDataInfo input[name="sku"]',
    'css=#skuDataInfo tbody tr input',
  ]),
  selectorRecord('one_click_sku_button', '一键生成 SKU 按钮', [
    'css=#skuDataInfo span:has-text("一键生成")',
    'css=#skuDataInfo button:has-text("一键生成")',
    'text=一键生成',
  ]),
  selectorRecord('sku_generate_modal', 'SKU 生成弹窗', [
    'css=.ant-modal-content:has(input[name="skuPrefix"])',
    'css=.ant-modal-content:has-text("编码前缀")',
    'css=.ant-modal-content:has-text("SKU")',
  ]),
  selectorRecord('sku_prefix_input', 'SKU 前缀输入框', [
    'css=input[name="skuPrefix"]',
    'placeholder=编码前缀',
    'css=.ant-modal-content input:not([type="hidden"]):not([type="file"])',
  ]),
  selectorRecord('variant_image_section', '变种图片区域', ['css=#skuImageInfo', 'text=变种图片']),
  selectorRecord('variant_image_table', '变种图片表格', [
    'css=#skuImageInfo table',
    'css=#skuImageInfo',
  ]),
  selectorRecord('variant_image_upload_button', '变种图片上传按钮', [
    'css=#skuImageInfo button:has-text("选择图片")',
    'css=#skuImageInfo .ant-upload button',
    'role=button[name="选择图片"]',
  ]),
  selectorRecord('detail_image_section', '详情图区域', ['css=#skuDescInfo', 'text=详情图']),
  selectorRecord('detail_image_table', '详情图表格', [
    'css=#skuDescInfo table',
    'css=#skuDescInfo',
  ]),
  selectorRecord('detail_image_upload_button', '详情图上传按钮', [
    'css=#skuDescInfo button:has-text("选择图片")',
    'css=#skuDescInfo .ant-upload button',
    'role=button[name="选择图片"]',
  ]),
  selectorRecord('local_image_upload_input', '本地图片上传 input', [
    'css=#localFileUploadInp',
    'css=input[type="file"]',
  ]),
  selectorRecord('video_uploader', '视频区域', [
    'css=#productInfo .ant-form-item:has-text("视频")',
    'css=#imageInfo .ant-form-item:has-text("视频")',
    'text=视频',
  ]),
  selectorRecord('video_upload_button', '视频上传按钮', [
    'css=#productInfo button:has-text("上传视频")',
    'css=#imageInfo button:has-text("上传视频")',
    'role=button[name="上传视频"]',
    'text=上传视频',
  ]),
  selectorRecord('sales_info_section', '销售信息区域', ['css=#skuSellInfo', 'text=销售信息']),
  selectorRecord('save_button', '保存按钮', [
    'css=#dxmInfo button:has-text("保存")',
    'css=button:has-text("保存")',
    'role=button[name="保存"]',
  ]),
  selectorRecord('publish_button', '发布按钮', [
    'css=button:has-text("发布")',
    'role=button[name="发布"]',
    'text=发布',
  ]),
  selectorRecord('success_toast', '成功提示', [
    'css=.ant-message-success',
    'css=.ant-notification-notice-success',
    'css=.ant-message-notice:has-text("成功")',
  ]),
  selectorRecord('failure_toast', '失败提示', [
    'css=.ant-message-error',
    'css=.ant-notification-notice-error',
    'css=.ant-message-notice:has-text("失败")',
  ]),
  selectorRecord('login_indicators', '登录状态特征', [
    'text=欢迎登录 简单生意就在店小秘',
    'text=拖动下方拼图完成验证',
    'text=找回密码',
  ]),
  selectorRecord('loading_indicators', '加载中特征', [
    'css=#dPageLoading',
    'css=.d-module-loading',
    'text=加载中',
  ]),
  selectorRecord('blocking_modal', '阻塞弹窗', [
    'css=.ant-modal-root .ant-modal',
    'css=.ant-drawer',
    'css=.ant-popover',
  ]),
] satisfies readonly SelectorRecord<SheinSelectorKey>[]

export const SHEIN_SELECTORS = selectorRecordMap(SHEIN_SELECTOR_RECORDS)

export const SHEIN_REQUIRED_REAL_SELECTOR_KEYS = [
  'page_root',
  'shop_context',
  'shop_name_control',
  'category_control',
  'product_info_section',
  'title_input',
  'sku_input',
  'description_input',
  'variant_attribute_section',
  'sku_table',
  'sku_input_cells',
  'one_click_sku_button',
  'variant_image_section',
  'variant_image_table',
  'detail_image_section',
  'detail_image_table',
  'sales_info_section',
  'save_button',
] as const satisfies readonly SheinSelectorKey[]
