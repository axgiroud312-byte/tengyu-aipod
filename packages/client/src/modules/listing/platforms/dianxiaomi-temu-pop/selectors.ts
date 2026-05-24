export type ListingSelector =
  | `css=${string}`
  | `text=${string}`
  | `label=${string}`
  | `placeholder=${string}`
  | `role=${string}`

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
  clothing: 'https://www.dianxiaomi.com/web/popTemu/edit?id=128935194843933515',
  general: 'https://www.dianxiaomi.com/web/popTemu/edit?id=128935194833519551',
} as const

export const TEMU_POP_SELECTORS = {
  page_root: [
    'css=.product-add-layout',
    'text=Temu半托管产品>创建产品',
    'css=[routename="popTemuProductEdit"]',
  ],
  shop_context: [
    'text=Temu半托管产品>创建产品',
    'css=[routename="popTemuProductEdit"]',
    'css=.product-add-layout',
  ],
  shop_name_control: [
    'css=.ant-form-item:has(label[title="店铺账号"]) .ant-select-selector',
    'label=店铺账号',
    'text=店铺账号',
  ],
  category_control: [
    'css=.category-item .ant-select-selector',
    'css=.ant-form-item:has(label[title="产品分类"]) .ant-select-selector',
    'role=button[name="选择分类"]',
  ],
  title_input: [
    'css=#productProductInfo .ant-form-item:has(label[title="产品标题"]) input.ant-input',
    'css=.ant-form-item:has(label[title="产品标题"]) input[maxlength="500"]',
    'label=产品标题',
  ],
  english_title_input: [
    'css=#productProductInfo .ant-form-item:has(label[title="英文标题"]) input.ant-input',
    'css=.ant-form-item:has(label[title="英文标题"]) input[maxlength="500"]',
    'label=英文标题',
  ],
  sku_input: [
    'placeholder=产品货号不能包含中文和中文符号',
    'css=#productProductInfo input.productNumber',
    'css=.ant-form-item:has(label[title="产品货号"]) input',
  ],
  carousel_images: [
    'css=#productProductInfo .ant-form-item.mainImage .img-list .single-image',
    'css=#productProductInfo .ant-form-item:has(label[title="产品轮播图"]) .img-list .img-item',
    'text=产品轮播图',
  ],
  carousel_upload_button: [
    'css=#productProductInfo .ant-form-item.mainImage button:has-text("选择图片")',
    'css=#productProductInfo .ant-form-item:has(label[title="产品轮播图"]) button:has-text("选择图片")',
    'role=button[name="选择图片"]',
  ],
  material_images: [
    'css=#productProductInfo .material-img-module .single-image',
    'css=#productProductInfo .ant-form-item:has(label[title="产品素材图"]) .material-img-module',
    'text=产品素材图',
  ],
  preview_images: [
    'css=#skuDataInfo th:has-text("预览图")',
    'css=#skuDataInfo .img-options',
    'text=预览图',
  ],
  video_uploader: [
    'css=#productProductInfo .ant-form-item:has(label[title="产品视频"])',
    'css=#productProductInfo .video-operate-box',
    'text=产品视频',
  ],
  video_upload_button: [
    'css=#productProductInfo .ant-form-item:has(label[title="产品视频"]) button:has-text("添加视频")',
    'role=button[name="添加视频"]',
    'text=添加视频',
  ],
  variant_attribute_section: ['css=#skuAttrsInfo', 'css=.skuAttrModule', 'text=变种属性'],
  color_skc: [
    'css=#skuAttrsInfo .ant-form-item:has(label[title*="颜色"])',
    'css=#skuAttrsInfo .ant-form-item:has-text("颜色")',
    'text=颜色',
  ],
  size_chart_dropdown: [
    'css=#skuAttrsInfo .ant-form-item:has-text("尺码") .ant-select-selector',
    'css=#skuAttrsInfo .ant-form-item:has-text("尺寸") .ant-select-selector',
    'text=尺码',
  ],
  one_click_sku_button: [
    'css=#skuDataInfo th:has-text("SKU货号") .link:has-text("一键生成")',
    'css=#skuDataInfo span.link:has-text("一键生成")',
    'text=一键生成',
  ],
  sku_table: [
    'css=#skuDataInfo table.myj-table',
    'css=#skuDataInfo .sku-data-table',
    'text=变种信息',
  ],
  sku_category_batch: [
    'css=#skuDataInfo th:has-text("SKU分类") .link',
    'css=#skuDataInfo table:has-text("SKU分类") th:has-text("SKU分类")',
    'text=SKU分类',
  ],
  packing_list_batch: [
    'css=#skuDataInfo th:has-text("包装清单") .link',
    'css=#skuDataInfo table:has-text("包装清单") th:has-text("包装清单")',
    'text=包装清单',
  ],
  description_section: ['css=#describeInfo', 'css=#wirelessDescBox', 'text=产品描述'],
  description_images: [
    'css=#wirelessDescContentBox img',
    'css=#describeInfo .details-box-all img',
    'css=#describeInfo img[referrerpolicy="no-referrer"]',
  ],
  description_editor_button: [
    'css=#describeInfo button:has-text("编辑描述")',
    'css=#baiduStatisticsSmtNewEditorEditClickNum button',
    'role=button[name="编辑描述"]',
  ],
  shipping_template_dropdown: [
    'css=#shipmentInfo .ant-form-item:has(label[title="运费模板"]) .ant-select-selector',
    'label=运费模板',
    'text=运费模板',
  ],
  save_button: [
    'css=.footer .btn-box button:has-text("保存")',
    'role=button[name="保存"]',
    'text=保存',
  ],
  publish_button: [
    'css=.footer .btn-box button:has-text("发布")',
    'role=button[name="发布"]',
    'text=发布',
  ],
  success_toast: [
    'css=.ant-message-success',
    'css=.ant-notification-notice-success',
    'text=发布成功',
  ],
  failure_toast: ['css=.ant-message-error', 'css=.ant-notification-notice-error', 'text=发布失败'],
  login_indicators: [
    'text=欢迎登录 简单生意就在店小秘',
    'text=拖动下方拼图完成验证',
    'text=找回密码',
  ],
  loading_indicators: ['css=#dPageLoading', 'css=.d-module-loading', 'text=加载中'],
  blocking_modal: ['css=.ant-modal-root .ant-modal', 'css=.ant-drawer', 'css=.ant-popover'],
} as const satisfies Record<TemuPopSelectorKey, readonly ListingSelector[]>

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

export function selectorToLocator(selector: ListingSelector) {
  const separatorIndex = selector.indexOf('=')
  const type = selector.slice(0, separatorIndex)
  const value = selector.slice(separatorIndex + 1)
  return { type, value }
}
