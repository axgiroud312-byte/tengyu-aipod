export type ListingSelector =
  | `css=${string}`
  | `text=${string}`
  | `label=${string}`
  | `placeholder=${string}`
  | `role=${string}`

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
  shein: 'https://www.dianxiaomi.com/web/sheinProduct/edit?id=128935201966452551',
} as const

export const SHEIN_SELECTORS = {
  page_root: [
    'css=.nav-index[routename="sheinProductEdit"]',
    'css=#productBasicInfo',
    'css=#productInfo',
    'text=SHEIN>在线产品>编辑',
  ],
  shop_context: [
    'text=SHEIN>在线产品>编辑',
    'css=.nav-index[routename="sheinProductEdit"]',
    'css=#productBasicInfo',
  ],
  shop_name_control: [
    'css=#productBasicInfo .ant-form-item:has(label[title="店铺账号"]) .ant-select-selector',
    'css=#productBasicInfo .ant-form-item:has-text("店铺账号") .ant-select-selector',
    'label=店铺账号',
  ],
  category_control: [
    'css=#productBasicInfo .category-item .ant-select-selector',
    'css=#productBasicInfo .ant-form-item:has(label[title="产品分类"]) .ant-select-selector',
    'role=button[name="选择分类"]',
  ],
  product_info_section: ['css=#productInfo', 'text=产品信息'],
  title_input: [
    'css=#productInfo .sheinProductName input[name="productTitleBuyer"]',
    'css=#productInfo .sheinProductName input:not([type="hidden"]):not([type="file"])',
    'css=#productInfo .ant-form-item:has-text("产品标题") input:not([type="hidden"]):not([type="file"])',
  ],
  sku_input: [
    'css=#productInfo input[name="productItemNumber"]',
    'css=#productInfo .ant-form-item:has-text("货号") input:not([type="hidden"]):not([type="file"])',
    'css=#productInfo input[name*="itemNumber" i]',
  ],
  description_input: [
    'css=#productInfo .sheinProductDesc textarea',
    'css=#productInfo .sheinProductDesc [contenteditable="true"]',
    'css=#productInfo .ant-form-item:has-text("产品描述") textarea',
  ],
  image_info_section: ['css=#imageInfo', 'text=图片信息'],
  variant_attribute_section: ['css=#skuAttrsInfo', 'text=变种主题'],
  sku_table: ['css=#skuDataInfo table', 'css=#skuDataInfo', 'text=变种信息'],
  sku_input_cells: ['css=#skuDataInfo input[name="sku"]', 'css=#skuDataInfo tbody tr input'],
  one_click_sku_button: [
    'css=#skuDataInfo span:has-text("一键生成")',
    'css=#skuDataInfo button:has-text("一键生成")',
    'text=一键生成',
  ],
  sku_generate_modal: [
    'css=.ant-modal-content:has(input[name="skuPrefix"])',
    'css=.ant-modal-content:has-text("编码前缀")',
    'css=.ant-modal-content:has-text("SKU")',
  ],
  sku_prefix_input: [
    'css=input[name="skuPrefix"]',
    'placeholder=编码前缀',
    'css=.ant-modal-content input:not([type="hidden"]):not([type="file"])',
  ],
  variant_image_section: ['css=#skuImageInfo', 'text=变种图片'],
  variant_image_table: ['css=#skuImageInfo table', 'css=#skuImageInfo'],
  variant_image_upload_button: [
    'css=#skuImageInfo button:has-text("选择图片")',
    'css=#skuImageInfo .ant-upload button',
    'role=button[name="选择图片"]',
  ],
  detail_image_section: ['css=#skuDescInfo', 'text=详情图'],
  detail_image_table: ['css=#skuDescInfo table', 'css=#skuDescInfo'],
  detail_image_upload_button: [
    'css=#skuDescInfo button:has-text("选择图片")',
    'css=#skuDescInfo .ant-upload button',
    'role=button[name="选择图片"]',
  ],
  local_image_upload_input: ['css=#localFileUploadInp', 'css=input[type="file"]'],
  video_uploader: [
    'css=#productInfo .ant-form-item:has-text("视频")',
    'css=#imageInfo .ant-form-item:has-text("视频")',
    'text=视频',
  ],
  video_upload_button: [
    'css=#productInfo button:has-text("上传视频")',
    'css=#imageInfo button:has-text("上传视频")',
    'role=button[name="上传视频"]',
    'text=上传视频',
  ],
  sales_info_section: ['css=#skuSellInfo', 'text=销售信息'],
  save_button: [
    'css=#dxmInfo button:has-text("保存")',
    'css=button:has-text("保存")',
    'role=button[name="保存"]',
  ],
  publish_button: ['css=button:has-text("发布")', 'role=button[name="发布"]', 'text=发布'],
  success_toast: [
    'css=.ant-message-success',
    'css=.ant-notification-notice-success',
    'css=.ant-message-notice:has-text("成功")',
  ],
  failure_toast: [
    'css=.ant-message-error',
    'css=.ant-notification-notice-error',
    'css=.ant-message-notice:has-text("失败")',
  ],
  login_indicators: [
    'text=欢迎登录 简单生意就在店小秘',
    'text=拖动下方拼图完成验证',
    'text=找回密码',
  ],
  loading_indicators: ['css=#dPageLoading', 'css=.d-module-loading', 'text=加载中'],
  blocking_modal: ['css=.ant-modal-root .ant-modal', 'css=.ant-drawer', 'css=.ant-popover'],
} as const satisfies Record<SheinSelectorKey, readonly ListingSelector[]>

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

export function selectorToLocator(selector: ListingSelector) {
  const separatorIndex = selector.indexOf('=')
  const type = selector.slice(0, separatorIndex)
  const value = selector.slice(separatorIndex + 1)
  return { type, value }
}
