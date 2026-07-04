import type { ListingSelector, SelectorRecord } from '@tengyu-aipod/shared'
import { selectorRecordMap } from '../_commons/page-locator'

export type { ListingSelector } from '@tengyu-aipod/shared'

export type TemuPopSelectorKey =
  | 'page_root'
  | 'shop_context'
  | 'shop_name_control'
  | 'category_control'
  | 'title_input'
  | 'english_title_input'
  | 'sku_input'
  | 'carousel_images'
  | 'carousel_upload_button'
  | 'material_images'
  | 'preview_images'
  | 'video_uploader'
  | 'video_upload_button'
  | 'variant_attribute_section'
  | 'color_skc'
  | 'size_chart_dropdown'
  | 'one_click_sku_button'
  | 'sku_table'
  | 'sku_category_batch'
  | 'packing_list_batch'
  | 'description_section'
  | 'description_images'
  | 'description_editor_button'
  | 'shipping_template_dropdown'
  | 'save_button'
  | 'publish_button'
  | 'success_toast'
  | 'failure_toast'
  | 'login_indicators'
  | 'loading_indicators'
  | 'blocking_modal'

export const TEMU_POP_TEMPLATE_URLS = {
  clothing: 'https://www.dianxiaomi.com/web/popTemu/edit',
  general: 'https://www.dianxiaomi.com/web/popTemu/edit',
} as const

const SELECTOR_RECORD_VERSION = '1.0.0'
const SELECTOR_RECORD_CREATED_AT = '2026-05-26T00:00:00.000Z'

function selectorRecord<TKey extends TemuPopSelectorKey>(
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

export const TEMU_POP_SELECTOR_RECORDS = [
  selectorRecord('page_root', '页面根节点', [
    'css=.product-add-layout',
    'text=Temu半托管产品>创建产品',
    'css=[routename="popTemuProductEdit"]',
  ]),
  selectorRecord('shop_context', '店铺上下文', [
    'text=Temu半托管产品>创建产品',
    'css=[routename="popTemuProductEdit"]',
    'css=.product-add-layout',
  ]),
  selectorRecord('shop_name_control', '店铺账号控件', [
    'css=.ant-form-item:has(label[title="店铺账号"]) .ant-select-selector',
    'label=店铺账号',
    'text=店铺账号',
  ]),
  selectorRecord('category_control', '产品分类控件', [
    'css=.category-item .ant-select-selector',
    'css=.ant-form-item:has(label[title="产品分类"]) .ant-select-selector',
    'role=button[name="选择分类"]',
  ]),
  selectorRecord('title_input', '产品标题输入框', [
    'css=#productProductInfo .ant-form-item:has(label[title="产品标题"]) input.ant-input',
    'css=.ant-form-item:has(label[title="产品标题"]) input[maxlength="500"]',
    'label=产品标题',
  ]),
  selectorRecord('english_title_input', '英文标题输入框', [
    'css=#productProductInfo .ant-form-item:has(label[title="英文标题"]) input.ant-input',
    'css=.ant-form-item:has(label[title="英文标题"]) input[maxlength="500"]',
    'label=英文标题',
  ]),
  selectorRecord('sku_input', '产品货号输入框', [
    'placeholder=产品货号不能包含中文和中文符号',
    'css=#productProductInfo input.productNumber',
    'css=.ant-form-item:has(label[title="产品货号"]) input',
  ]),
  selectorRecord('carousel_images', '产品轮播图', [
    'css=#productProductInfo .ant-form-item.mainImage .img-list .single-image',
    'css=#productProductInfo .ant-form-item:has(label[title="产品轮播图"]) .img-list .img-item',
    'text=产品轮播图',
  ]),
  selectorRecord('carousel_upload_button', '轮播图上传按钮', [
    'css=#productProductInfo .ant-form-item.mainImage button:has-text("选择图片")',
    'css=#productProductInfo .ant-form-item:has(label[title="产品轮播图"]) button:has-text("选择图片")',
    'role=button[name="选择图片"]',
  ]),
  selectorRecord('material_images', '产品素材图', [
    'css=#productProductInfo .material-img-module .single-image',
    'css=#productProductInfo .ant-form-item:has(label[title="产品素材图"]) .material-img-module',
    'text=产品素材图',
  ]),
  selectorRecord('preview_images', '预览图', [
    'css=#skuDataInfo th:has-text("预览图")',
    'css=#skuDataInfo .img-options',
    'text=预览图',
  ]),
  selectorRecord('video_uploader', '产品视频区域', [
    'css=#productProductInfo .ant-form-item:has(label[title="产品视频"])',
    'css=#productProductInfo .video-operate-box',
    'text=产品视频',
  ]),
  selectorRecord('video_upload_button', '视频上传按钮', [
    'css=#productProductInfo .ant-form-item:has(label[title="产品视频"]) button:has-text("添加视频")',
    'role=button[name="添加视频"]',
    'text=添加视频',
  ]),
  selectorRecord('variant_attribute_section', '变种属性区域', [
    'css=#skuAttrsInfo',
    'css=.skuAttrModule',
    'text=变种属性',
  ]),
  selectorRecord('color_skc', '颜色 SKC 区域', [
    'css=#skuAttrsInfo .ant-form-item:has(label[title*="颜色"])',
    'css=#skuAttrsInfo .ant-form-item:has-text("颜色")',
    'text=颜色',
  ]),
  selectorRecord('size_chart_dropdown', '尺码表下拉', [
    'css=#skuAttrsInfo .ant-form-item:has-text("尺码") .ant-select-selector',
    'css=#skuAttrsInfo .ant-form-item:has-text("尺寸") .ant-select-selector',
    'text=尺码',
  ]),
  selectorRecord('one_click_sku_button', '一键生成 SKU 按钮', [
    'css=#skuDataInfo th:has-text("SKU货号") .link:has-text("一键生成")',
    'css=#skuDataInfo span.link:has-text("一键生成")',
    'text=一键生成',
  ]),
  selectorRecord('sku_table', 'SKU 表格', [
    'css=#skuDataInfo table.myj-table',
    'css=#skuDataInfo .sku-data-table',
    'text=变种信息',
  ]),
  selectorRecord('sku_category_batch', 'SKU 分类批量入口', [
    'css=#skuDataInfo th:has-text("SKU分类") .link',
    'css=#skuDataInfo table:has-text("SKU分类") th:has-text("SKU分类")',
    'text=SKU分类',
  ]),
  selectorRecord('packing_list_batch', '包装清单批量入口', [
    'css=#skuDataInfo th:has-text("包装清单") .link',
    'css=#skuDataInfo table:has-text("包装清单") th:has-text("包装清单")',
    'text=包装清单',
  ]),
  selectorRecord('description_section', '产品描述区域', [
    'css=#describeInfo',
    'css=#wirelessDescBox',
    'text=产品描述',
  ]),
  selectorRecord('description_images', '产品描述图片', [
    'css=#wirelessDescContentBox img',
    'css=#describeInfo .details-box-all img',
    'css=#describeInfo img[referrerpolicy="no-referrer"]',
  ]),
  selectorRecord('description_editor_button', '描述编辑按钮', [
    'css=#describeInfo button:has-text("编辑描述")',
    'css=#baiduStatisticsSmtNewEditorEditClickNum button',
    'role=button[name="编辑描述"]',
  ]),
  selectorRecord('shipping_template_dropdown', '运费模板下拉', [
    'css=#shipmentInfo .ant-form-item:has(label[title="运费模板"]) .ant-select-selector',
    'label=运费模板',
    'text=运费模板',
  ]),
  selectorRecord('save_button', '保存按钮', [
    'css=.footer .btn-box button:has-text("保存")',
    'role=button[name="保存"]',
    'text=保存',
  ]),
  selectorRecord('publish_button', '发布按钮', [
    'css=.footer .btn-box button:has-text("发布")',
    'role=button[name="发布"]',
    'text=发布',
  ]),
  selectorRecord('success_toast', '成功提示', [
    'css=.ant-message-success',
    'css=.ant-notification-notice-success',
    'css=.ant-message-notice:has-text("发布成功")',
  ]),
  selectorRecord('failure_toast', '失败提示', [
    'css=.ant-message-error',
    'css=.ant-notification-notice-error',
    'css=.ant-message-notice:has-text("发布失败")',
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
] satisfies readonly SelectorRecord<TemuPopSelectorKey>[]

export const TEMU_POP_SELECTORS = selectorRecordMap(TEMU_POP_SELECTOR_RECORDS)

export const TEMU_POP_REQUIRED_REAL_SELECTOR_KEYS = [
  'page_root',
  'shop_context',
  'shop_name_control',
  'category_control',
  'title_input',
  'english_title_input',
  'sku_input',
  'carousel_images',
  'carousel_upload_button',
  'material_images',
  'video_uploader',
  'video_upload_button',
  'variant_attribute_section',
  'one_click_sku_button',
  'sku_table',
  'sku_category_batch',
  'packing_list_batch',
  'description_section',
  'description_images',
  'description_editor_button',
  'shipping_template_dropdown',
  'save_button',
  'publish_button',
] as const satisfies readonly TemuPopSelectorKey[]
