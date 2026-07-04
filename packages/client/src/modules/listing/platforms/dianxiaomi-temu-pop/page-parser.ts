import type { ListingSelector } from '@tengyu-aipod/shared'
import type { Locator, Page } from 'playwright'
import { readToast } from '../_commons/page-feedback'
import { locateBySelectorsWithFallback, locatorForSelector } from '../_commons/page-locator'
import { TEMU_POP_SELECTORS, TEMU_POP_TEMPLATE_URLS } from './selectors'

export type TemuPopTemplateKey = keyof typeof TEMU_POP_TEMPLATE_URLS

export type TemuPopShopContext = 'dianxiaomi-temu-pop' | 'login' | 'unknown'
export type TemuPopWorkflowStep = 'login_required' | 'loading' | 'blocked' | 'editing' | 'unknown'

export type TemuPopTextFieldState = {
  found: boolean
  current_value: string | null
  is_disabled: boolean
  selector: ListingSelector | null
}

export type TemuPopControlState = {
  found: boolean
  enabled: boolean
  text: string | null
  selector: ListingSelector | null
}

export type TemuPopImageSectionState = {
  found: boolean
  count: number
  selector: ListingSelector | null
}

export type TemuPopSkuTableState = {
  found: boolean
  table_count: number
  row_count: number
  selector: ListingSelector | null
}

export type TemuPopVideoSectionState = {
  found: boolean
  upload_button_found: boolean
  upload_button_enabled: boolean
  current_video_count: number
  selector: ListingSelector | null
}

export type TemuPopToastState = {
  found: boolean
  message: string | null
  selector: ListingSelector | null
}

export type TemuPopDraftPageState = {
  url: string
  page_title: string
  template_key: TemuPopTemplateKey | 'unknown'
  shop_context: TemuPopShopContext
  workflow_step: TemuPopWorkflowStep
  is_login_required: boolean
  is_loading: boolean
  is_blocking_modal: boolean
  shop_field: TemuPopTextFieldState
  category_field: TemuPopTextFieldState
  title_field: TemuPopTextFieldState
  english_title_field: TemuPopTextFieldState
  sku_field: TemuPopTextFieldState
  carousel_images: TemuPopImageSectionState
  material_images: TemuPopImageSectionState
  preview_images: TemuPopImageSectionState
  description_images: TemuPopImageSectionState
  variant_attribute_section: TemuPopControlState
  one_click_sku: TemuPopControlState
  sku_table: TemuPopSkuTableState
  sku_category_batch: TemuPopControlState
  packing_list_batch: TemuPopControlState
  video_section: TemuPopVideoSectionState
  shipping_template: TemuPopTextFieldState
  save_button: TemuPopControlState
  publish_button: TemuPopControlState
  success_toast: TemuPopToastState
  failure_toast: TemuPopToastState
}

export async function parseDraftPage(page: Page): Promise<TemuPopDraftPageState> {
  const url = page.url()
  const pageTitle = await page.title()
  const isLoginRequired = await hasAnySelector(page, TEMU_POP_SELECTORS.login_indicators)
  const isLoading = await hasVisibleSelector(page, TEMU_POP_SELECTORS.loading_indicators)
  const isBlockingModal = await hasVisibleSelector(page, TEMU_POP_SELECTORS.blocking_modal)
  const pageRoot = await findFirst(page, TEMU_POP_SELECTORS.page_root)

  const shopContext: TemuPopShopContext = isLoginRequired
    ? 'login'
    : pageRoot
      ? 'dianxiaomi-temu-pop'
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
    shop_field: await readSelectLikeField(page, TEMU_POP_SELECTORS.shop_name_control),
    category_field: await readSelectLikeField(page, TEMU_POP_SELECTORS.category_control),
    title_field: await readInputField(page, TEMU_POP_SELECTORS.title_input),
    english_title_field: await readInputField(page, TEMU_POP_SELECTORS.english_title_input),
    sku_field: await readInputField(page, TEMU_POP_SELECTORS.sku_input),
    carousel_images: await readCountSection(page, TEMU_POP_SELECTORS.carousel_images),
    material_images: await readCountSection(page, TEMU_POP_SELECTORS.material_images),
    preview_images: await readCountSection(page, TEMU_POP_SELECTORS.preview_images),
    description_images: await readCountSection(page, TEMU_POP_SELECTORS.description_images),
    variant_attribute_section: await readControl(
      page,
      TEMU_POP_SELECTORS.variant_attribute_section,
    ),
    one_click_sku: await readControl(page, TEMU_POP_SELECTORS.one_click_sku_button),
    sku_table: await readSkuTable(page),
    sku_category_batch: await readControl(page, TEMU_POP_SELECTORS.sku_category_batch),
    packing_list_batch: await readControl(page, TEMU_POP_SELECTORS.packing_list_batch),
    video_section: await readVideoSection(page),
    shipping_template: await readSelectLikeField(
      page,
      TEMU_POP_SELECTORS.shipping_template_dropdown,
    ),
    save_button: await readControl(page, TEMU_POP_SELECTORS.save_button),
    publish_button: await readControl(page, TEMU_POP_SELECTORS.publish_button),
    success_toast: await readToast(page, TEMU_POP_SELECTORS.success_toast),
    failure_toast: await readToast(page, TEMU_POP_SELECTORS.failure_toast),
  }
}

function detectTemplateKey(url: string): TemuPopTemplateKey | 'unknown' {
  for (const [key, templateUrl] of Object.entries(TEMU_POP_TEMPLATE_URLS)) {
    const templateSearch = new URL(templateUrl).search
    if (templateSearch && url.includes(templateSearch)) {
      return key as TemuPopTemplateKey
    }
  }
  return 'unknown'
}

function readWorkflowStep(args: {
  isLoginRequired: boolean
  isLoading: boolean
  isBlockingModal: boolean
  hasPageRoot: boolean
}): TemuPopWorkflowStep {
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
): Promise<TemuPopTextFieldState> {
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
  const isDisabled = await readDisabled(hit.locator)

  return {
    found: true,
    current_value: value,
    is_disabled: isDisabled,
    selector: hit.selector,
  }
}

async function readSelectLikeField(
  page: Page,
  selectors: readonly ListingSelector[],
): Promise<TemuPopTextFieldState> {
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
): Promise<TemuPopControlState> {
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

async function readCountSection(
  page: Page,
  selectors: readonly ListingSelector[],
): Promise<TemuPopImageSectionState> {
  for (const selector of selectors) {
    const locator = locatorForSelector(page, selector)
    const count = await locator.count().catch(() => 0)
    if (count > 0) {
      return { found: true, count, selector }
    }
  }
  return { found: false, count: 0, selector: null }
}

async function readSkuTable(page: Page): Promise<TemuPopSkuTableState> {
  const hit = await findFirst(page, TEMU_POP_SELECTORS.sku_table)
  if (!hit) {
    return {
      found: false,
      table_count: 0,
      row_count: 0,
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
  return {
    found: true,
    table_count: tableCount,
    row_count: rowCount,
    selector: hit.selector,
  }
}

async function readVideoSection(page: Page): Promise<TemuPopVideoSectionState> {
  const section = await findFirst(page, TEMU_POP_SELECTORS.video_uploader)
  const button = await findFirst(page, TEMU_POP_SELECTORS.video_upload_button)
  const currentVideoCount = await page
    .locator('#productProductInfo .video-operate-box, #productProductInfo .video-operate-img')
    .count()
    .catch(() => 0)

  return {
    found: section !== null,
    upload_button_found: button !== null,
    upload_button_enabled: button ? !(await readDisabled(button.locator)) : false,
    current_video_count: currentVideoCount,
    selector: section?.selector ?? null,
  }
}

async function findFirst(
  page: Page,
  selectors: readonly ListingSelector[],
): Promise<{ selector: ListingSelector; locator: Locator } | null> {
  return locateBySelectorsWithFallback(page, selectors)
}

async function hasAnySelector(page: Page, selectors: readonly ListingSelector[]) {
  return (await findFirst(page, selectors)) !== null
}

async function hasVisibleSelector(page: Page, selectors: readonly ListingSelector[]) {
  for (const selector of selectors) {
    const locator = locatorForSelector(page, selector)
    const count = await locator.count().catch(() => 0)
    for (let index = 0; index < count; index += 1) {
      if (
        await locator
          .nth(index)
          .isVisible()
          .catch(() => false)
      ) {
        return true
      }
    }
  }
  return false
}

async function readText(locator: Locator) {
  const text = await locator
    .evaluate((node) => node.textContent?.replace(/\s+/g, ' ').trim() || null)
    .catch(() => null)
  return text && text.length > 0 ? text : null
}

async function readDisabled(locator: Locator) {
  return locator
    .evaluate((node) => {
      if (
        node instanceof HTMLButtonElement ||
        node instanceof HTMLInputElement ||
        node instanceof HTMLSelectElement ||
        node instanceof HTMLTextAreaElement
      ) {
        return node.disabled
      }
      const element = node instanceof HTMLElement ? node : null
      if (!element) {
        return false
      }
      return (
        element.getAttribute('aria-disabled') === 'true' ||
        element.classList.contains('ant-select-disabled') ||
        element.classList.contains('ant-btn-disabled') ||
        element.classList.contains('disabled')
      )
    })
    .catch(() => false)
}

function missingTextField(): TemuPopTextFieldState {
  return {
    found: false,
    current_value: null,
    is_disabled: false,
    selector: null,
  }
}
