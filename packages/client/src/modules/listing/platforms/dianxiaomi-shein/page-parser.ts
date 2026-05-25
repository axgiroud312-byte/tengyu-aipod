import type { Locator, Page } from 'playwright'
import {
  type ListingSelector,
  SHEIN_SELECTORS,
  SHEIN_TEMPLATE_URLS,
  selectorToLocator,
} from './selectors'

export type SheinTemplateKey = keyof typeof SHEIN_TEMPLATE_URLS

export type SheinShopContext = 'dianxiaomi-shein' | 'login' | 'unknown'
export type SheinWorkflowStep = 'login_required' | 'loading' | 'blocked' | 'editing' | 'unknown'

export type SheinTextFieldState = {
  found: boolean
  current_value: string | null
  is_disabled: boolean
  selector: ListingSelector | null
}

export type SheinControlState = {
  found: boolean
  enabled: boolean
  text: string | null
  selector: ListingSelector | null
}

export type SheinImageSectionState = {
  found: boolean
  image_count: number
  upload_button_found: boolean
  upload_button_enabled: boolean
  selector: ListingSelector | null
}

export type SheinSkuTableState = {
  found: boolean
  table_count: number
  row_count: number
  sku_input_count: number
  selector: ListingSelector | null
}

export type SheinToastState = {
  found: boolean
  message: string | null
  selector: ListingSelector | null
}

export type SheinDraftPageState = {
  url: string
  page_title: string
  template_key: SheinTemplateKey | 'unknown'
  shop_context: SheinShopContext
  workflow_step: SheinWorkflowStep
  is_login_required: boolean
  is_loading: boolean
  is_blocking_modal: boolean
  shop_field: SheinTextFieldState
  category_field: SheinTextFieldState
  title_field: SheinTextFieldState
  sku_field: SheinTextFieldState
  description_field: SheinTextFieldState
  product_info_section: SheinControlState
  image_info_section: SheinControlState
  variant_attribute_section: SheinControlState
  sku_table: SheinSkuTableState
  one_click_sku: SheinControlState
  variant_images: SheinImageSectionState
  detail_images: SheinImageSectionState
  video_section: SheinImageSectionState
  sales_info_section: SheinControlState
  save_button: SheinControlState
  publish_button: SheinControlState
  success_toast: SheinToastState
  failure_toast: SheinToastState
}

export async function parseDraftPage(page: Page): Promise<SheinDraftPageState> {
  const url = page.url()
  const pageTitle = await page.title()
  const isLoginRequired = await hasAnySelector(page, SHEIN_SELECTORS.login_indicators)
  const isLoading = await hasVisibleSelector(page, SHEIN_SELECTORS.loading_indicators)
  const isBlockingModal = await hasVisibleSelector(page, SHEIN_SELECTORS.blocking_modal)
  const pageRoot = await findFirst(page, SHEIN_SELECTORS.page_root)
  const shopContext: SheinShopContext = isLoginRequired
    ? 'login'
    : pageRoot
      ? 'dianxiaomi-shein'
      : 'unknown'
  const workflowStep = readWorkflowStep({
    isLoginRequired,
    isLoading,
    isBlockingModal,
    hasPageRoot: pageRoot !== null,
  })

  return {
    url,
    page_title: pageTitle,
    template_key: detectTemplateKey(url),
    shop_context: shopContext,
    workflow_step: workflowStep,
    is_login_required: isLoginRequired,
    is_loading: isLoading,
    is_blocking_modal: isBlockingModal,
    shop_field: await readSelectLikeField(page, SHEIN_SELECTORS.shop_name_control),
    category_field: await readSelectLikeField(page, SHEIN_SELECTORS.category_control),
    title_field: await readInputField(page, SHEIN_SELECTORS.title_input),
    sku_field: await readInputField(page, SHEIN_SELECTORS.sku_input),
    description_field: await readInputField(page, SHEIN_SELECTORS.description_input),
    product_info_section: await readControl(page, SHEIN_SELECTORS.product_info_section),
    image_info_section: await readControl(page, SHEIN_SELECTORS.image_info_section),
    variant_attribute_section: await readControl(page, SHEIN_SELECTORS.variant_attribute_section),
    sku_table: await readSkuTable(page),
    one_click_sku: await readControl(page, SHEIN_SELECTORS.one_click_sku_button),
    variant_images: await readImageSection(
      page,
      SHEIN_SELECTORS.variant_image_section,
      SHEIN_SELECTORS.variant_image_upload_button,
    ),
    detail_images: await readImageSection(
      page,
      SHEIN_SELECTORS.detail_image_section,
      SHEIN_SELECTORS.detail_image_upload_button,
    ),
    video_section: await readImageSection(
      page,
      SHEIN_SELECTORS.video_uploader,
      SHEIN_SELECTORS.video_upload_button,
    ),
    sales_info_section: await readControl(page, SHEIN_SELECTORS.sales_info_section),
    save_button: await readControl(page, SHEIN_SELECTORS.save_button),
    publish_button: await readControl(page, SHEIN_SELECTORS.publish_button),
    success_toast: await readToast(page, SHEIN_SELECTORS.success_toast),
    failure_toast: await readToast(page, SHEIN_SELECTORS.failure_toast),
  }
}

function detectTemplateKey(url: string): SheinTemplateKey | 'unknown' {
  for (const [key, templateUrl] of Object.entries(SHEIN_TEMPLATE_URLS)) {
    if (url.includes(new URL(templateUrl).search)) {
      return key as SheinTemplateKey
    }
  }
  return 'unknown'
}

function readWorkflowStep(args: {
  isLoginRequired: boolean
  isLoading: boolean
  isBlockingModal: boolean
  hasPageRoot: boolean
}): SheinWorkflowStep {
  if (args.isLoginRequired) {
    return 'login_required'
  }
  if (args.isLoading) {
    return 'loading'
  }
  if (args.isBlockingModal) {
    return 'blocked'
  }
  if (args.hasPageRoot) {
    return 'editing'
  }
  return 'unknown'
}

async function readInputField(
  page: Page,
  selectors: readonly ListingSelector[],
): Promise<SheinTextFieldState> {
  const hit = await findFirst(page, selectors)
  if (!hit) {
    return missingTextField()
  }

  const value = await hit.locator
    .evaluate((node) => {
      if (node instanceof HTMLInputElement || node instanceof HTMLTextAreaElement) {
        return node.value
      }
      return node.textContent?.trim() || null
    })
    .catch(() => null)
  return {
    found: true,
    current_value: value,
    is_disabled: await readDisabled(hit.locator),
    selector: hit.selector,
  }
}

async function readSelectLikeField(
  page: Page,
  selectors: readonly ListingSelector[],
): Promise<SheinTextFieldState> {
  const hit = await findFirst(page, selectors)
  if (!hit) {
    return missingTextField()
  }

  return {
    found: true,
    current_value: await readText(hit.locator),
    is_disabled: await readDisabled(hit.locator),
    selector: hit.selector,
  }
}

async function readControl(
  page: Page,
  selectors: readonly ListingSelector[],
): Promise<SheinControlState> {
  const hit = await findFirst(page, selectors)
  if (!hit) {
    return {
      found: false,
      enabled: false,
      text: null,
      selector: null,
    }
  }

  const isDisabled = await readDisabled(hit.locator)
  return {
    found: true,
    enabled: !isDisabled,
    text: await readText(hit.locator),
    selector: hit.selector,
  }
}

async function readImageSection(
  page: Page,
  sectionSelectors: readonly ListingSelector[],
  uploadSelectors: readonly ListingSelector[],
): Promise<SheinImageSectionState> {
  const section = await findFirst(page, sectionSelectors)
  const uploadButton = await findFirst(page, uploadSelectors)
  const root = section?.locator ?? page.locator('body')
  const imageCount = await root
    .locator('.single-image, .img-item, .sku-image, .ant-upload-list-item, img')
    .count()
    .catch(() => 0)

  return {
    found: section !== null,
    image_count: imageCount,
    upload_button_found: uploadButton !== null,
    upload_button_enabled: uploadButton ? !(await readDisabled(uploadButton.locator)) : false,
    selector: section?.selector ?? null,
  }
}

async function readSkuTable(page: Page): Promise<SheinSkuTableState> {
  const hit = await findFirst(page, SHEIN_SELECTORS.sku_table)
  if (!hit) {
    return {
      found: false,
      table_count: 0,
      row_count: 0,
      sku_input_count: 0,
      selector: null,
    }
  }
  const tableCount = await locatorForSelector(page, hit.selector)
    .count()
    .catch(() => 0)
  const rowCount = await page
    .locator('#skuDataInfo tbody tr')
    .count()
    .catch(() => 0)
  const skuInputCount = await page
    .locator('#skuDataInfo input[name="sku"]')
    .count()
    .catch(() => 0)

  return {
    found: true,
    table_count: tableCount,
    row_count: rowCount,
    sku_input_count: skuInputCount,
    selector: hit.selector,
  }
}

async function readToast(
  page: Page,
  selectors: readonly ListingSelector[],
): Promise<SheinToastState> {
  const hit = await findFirst(page, selectors)
  if (!hit) {
    return {
      found: false,
      message: null,
      selector: null,
    }
  }

  return {
    found: true,
    message: await readText(hit.locator),
    selector: hit.selector,
  }
}

async function hasAnySelector(page: Page, selectors: readonly ListingSelector[]) {
  for (const selector of selectors) {
    const count = await locatorForSelector(page, selector)
      .count()
      .catch(() => 0)
    if (count > 0) {
      return true
    }
  }
  return false
}

async function hasVisibleSelector(page: Page, selectors: readonly ListingSelector[]) {
  for (const selector of selectors) {
    const locator = locatorForSelector(page, selector).first()
    const visible = await locator.isVisible().catch(() => false)
    if (visible) {
      return true
    }
  }
  return false
}

async function findFirst(
  page: Page,
  selectors: readonly ListingSelector[],
): Promise<{ selector: ListingSelector; locator: Locator } | null> {
  for (const selector of selectors) {
    const locator = locatorForSelector(page, selector)
    const count = await locator.count().catch(() => 0)
    if (count > 0) {
      return { selector, locator: locator.first() }
    }
  }
  return null
}

function locatorForSelector(page: Page, selector: ListingSelector): Locator {
  const { type, value } = selectorToLocator(selector)
  if (type === 'css') {
    return page.locator(value)
  }
  if (type === 'text') {
    return page.getByText(value)
  }
  if (type === 'label') {
    return page.getByLabel(value)
  }
  if (type === 'placeholder') {
    return page.getByPlaceholder(value)
  }
  if (type === 'role') {
    const match = value.match(/^([a-z]+)(?:\[name="(.+)"\])?$/)
    const role = match?.[1] ?? value
    const name = match?.[2]
    return page.getByRole(role as Parameters<Page['getByRole']>[0], name ? { name } : undefined)
  }
  return page.locator(value)
}

async function readDisabled(locator: Locator): Promise<boolean> {
  return locator
    .evaluate((node) => {
      if (
        node instanceof HTMLInputElement ||
        node instanceof HTMLTextAreaElement ||
        node instanceof HTMLButtonElement ||
        node instanceof HTMLSelectElement
      ) {
        return node.disabled || node.hasAttribute('readonly')
      }
      const element = node as HTMLElement
      return (
        element.getAttribute('aria-disabled') === 'true' ||
        element.classList.contains('ant-select-disabled') ||
        element.classList.contains('ant-input-disabled') ||
        element.closest('.ant-select-disabled, .ant-input-disabled') !== null
      )
    })
    .catch(() => false)
}

async function readText(locator: Locator): Promise<string | null> {
  return locator
    .evaluate((node) => node.textContent?.replace(/\s+/g, ' ').trim() || null)
    .catch(() => null)
}

function missingTextField(): SheinTextFieldState {
  return {
    found: false,
    current_value: null,
    is_disabled: false,
    selector: null,
  }
}
