import { stat } from 'node:fs/promises'
import {
  ListingActionError,
  type ListingActionErrorOptions,
  type ListingSelector,
} from '@tengyu-aipod/shared'
import type { Locator, Page } from 'playwright'
import { handleFileChooserWithRetry } from '../_commons/file-upload'
import { locateBySelectorsWithFallback } from '../_commons/page-locator'
import { waitForState as waitForParsedState } from '../_commons/page-wait'
import { type SheinDraftPageState, type SheinTextFieldState, parseDraftPage } from './page-parser'
import { SHEIN_SELECTORS } from './selectors'

export { ListingActionError }
export type { ListingActionErrorOptions }

export type SheinActionName =
  | 'replaceShopName'
  | 'fillTitle'
  | 'fillSku'
  | 'replaceImages'
  | 'uploadVariantImages'
  | 'uploadDetailImages'
  | 'uploadVideo'
  | 'generateSkuCode'

export type UploadActionResult = {
  action: 'uploaded'
  files: string[]
  beforeCount: number
  afterCount: number
  selector: string
}

export type ReplaceImagesResult = {
  variantImages: UploadActionResult | null
  detailImages: UploadActionResult | null
}

export type MutationOptions = {
  allowMutation?: boolean
}

const DEFAULT_ACTION_TIMEOUT_MS = 10_000
const UPLOAD_SETTLE_MS = 2_000

export async function replaceShopName(
  page: Page,
  targetShopName: string,
  options: MutationOptions = {},
): Promise<SheinDraftPageState> {
  const target = normalizeRequiredValue(targetShopName, 'replaceShopName')
  return runWithActionError(page, 'replaceShopName', async () => {
    const before = await requireEditablePage(page, 'replaceShopName')
    requireTextField(before.shop_field, 'replaceShopName', '店铺账号', before)
    if (before.shop_field.current_value === target) {
      return before
    }
    if (!options.allowMutation) {
      throw actionFailure({
        action: 'replaceShopName',
        code: 'FIELD_VALUE_MISMATCH',
        message: '切换真实店铺账号需要 allowMutation=true',
        selector: before.shop_field.selector,
        beforeState: before,
      })
    }

    const hit = await locateFirst(page, SHEIN_SELECTORS.shop_name_control, 'replaceShopName')
    await hit.locator.click({ timeout: DEFAULT_ACTION_TIMEOUT_MS })
    const searchInput = activeSelectSearchInput(page)
    await searchInput.fill(target).catch(() => undefined)
    await selectVisibleOption(page, target, 'replaceShopName')
    const after = await waitForState(
      page,
      (state) => state.shop_field.current_value === target,
      DEFAULT_ACTION_TIMEOUT_MS,
    )
    if (after.shop_field.current_value !== target) {
      throw actionFailure({
        action: 'replaceShopName',
        code: 'FIELD_VALUE_MISMATCH',
        message: `店铺名称未切换到目标值：${target}`,
        selector: hit.selector,
        beforeState: before,
        afterState: after,
      })
    }
    return after
  })
}

export async function fillTitle(page: Page, title: string): Promise<SheinDraftPageState> {
  return fillTextField(page, 'fillTitle', title, SHEIN_SELECTORS.title_input, 'title_field')
}

export async function fillSku(page: Page, sku: string): Promise<SheinDraftPageState> {
  return fillTextField(page, 'fillSku', sku, SHEIN_SELECTORS.sku_input, 'sku_field')
}

export async function replaceImages(
  page: Page,
  files: readonly string[],
  options: MutationOptions = {},
): Promise<ReplaceImagesResult> {
  const variantImages = await uploadVariantImages(page, files, options)
  const detailImages = await uploadDetailImages(page, files, options)
  return { variantImages, detailImages }
}

export async function uploadVariantImages(
  page: Page,
  files: readonly string[],
  options: MutationOptions = {},
): Promise<UploadActionResult> {
  return uploadImages(
    page,
    files,
    'uploadVariantImages',
    'variant_images',
    SHEIN_SELECTORS.variant_image_upload_button,
    options,
  )
}

export async function uploadDetailImages(
  page: Page,
  files: readonly string[],
  options: MutationOptions = {},
): Promise<UploadActionResult> {
  return uploadImages(
    page,
    files,
    'uploadDetailImages',
    'detail_images',
    SHEIN_SELECTORS.detail_image_upload_button,
    options,
  )
}

async function uploadImages(
  page: Page,
  files: readonly string[],
  action: Extract<SheinActionName, 'uploadVariantImages' | 'uploadDetailImages'>,
  stateKey: 'variant_images' | 'detail_images',
  triggerSelectors: readonly ListingSelector[],
  options: MutationOptions,
): Promise<UploadActionResult> {
  const existingFiles = await requireExistingFiles(files, action)
  return runWithActionError(page, action, async () => {
    const before = await requireEditablePage(page, action)
    if (!options.allowMutation) {
      throw actionFailure({
        action,
        code: 'UPLOAD_COUNT_MISMATCH',
        message: '上传真实图片需要 allowMutation=true',
        selector: before[stateKey].selector,
        beforeState: before,
      })
    }
    if (!before[stateKey].found || !before[stateKey].upload_button_found) {
      throw actionFailure({
        action,
        code: 'SELECTOR_NOT_FOUND',
        message: '未找到可用的 Shein 图片上传入口',
        beforeState: before,
        selector: before[stateKey].selector,
      })
    }

    const trigger = await locateFirst(page, triggerSelectors, action)
    await setFilesThroughUploadControl(
      page,
      trigger.locator,
      ['本地图片', '本地上传'],
      existingFiles,
      action,
    )
    const after = await waitForState(
      page,
      (state) =>
        state[stateKey].image_count > before[stateKey].image_count || state.failure_toast.found,
      30_000,
    )
    if (after.failure_toast.found) {
      throw actionFailure({
        action,
        code: 'UPLOAD_COUNT_MISMATCH',
        message: after.failure_toast.message ?? 'Shein 图片上传后页面出现失败提示',
        selector: trigger.selector,
        beforeState: before,
        afterState: after,
      })
    }
    if (after[stateKey].image_count <= before[stateKey].image_count) {
      throw actionFailure({
        action,
        code: 'UPLOAD_COUNT_MISMATCH',
        message: 'Shein 图片上传后数量未增加',
        selector: trigger.selector,
        beforeState: before,
        afterState: after,
      })
    }
    return {
      action: 'uploaded',
      files: existingFiles,
      beforeCount: before[stateKey].image_count,
      afterCount: after[stateKey].image_count,
      selector: trigger.selector,
    }
  })
}

export async function uploadVideo(
  page: Page,
  files: readonly string[],
  options: MutationOptions = {},
): Promise<UploadActionResult> {
  const existingFiles = await requireExistingFiles(files, 'uploadVideo')
  return runWithActionError(page, 'uploadVideo', async () => {
    const before = await requireEditablePage(page, 'uploadVideo')
    if (!options.allowMutation) {
      throw actionFailure({
        action: 'uploadVideo',
        code: 'UPLOAD_COUNT_MISMATCH',
        message: '上传真实视频需要 allowMutation=true',
        selector: before.video_section.selector,
        beforeState: before,
      })
    }
    if (!before.video_section.upload_button_found || !before.video_section.upload_button_enabled) {
      throw actionFailure({
        action: 'uploadVideo',
        code: 'SELECTOR_NOT_FOUND',
        message: '未找到可用的 Shein 视频上传入口',
        beforeState: before,
        selector: before.video_section.selector,
      })
    }

    const trigger = await locateFirst(page, SHEIN_SELECTORS.video_upload_button, 'uploadVideo')
    await setFilesThroughUploadControl(
      page,
      trigger.locator,
      ['本地上传', '本地视频'],
      existingFiles,
      'uploadVideo',
    )
    const after = await waitForState(
      page,
      (state) =>
        state.video_section.image_count > before.video_section.image_count ||
        state.failure_toast.found,
      30_000,
    )
    if (after.failure_toast.found) {
      throw actionFailure({
        action: 'uploadVideo',
        code: 'UPLOAD_COUNT_MISMATCH',
        message: after.failure_toast.message ?? 'Shein 视频上传后页面出现失败提示',
        selector: trigger.selector,
        beforeState: before,
        afterState: after,
      })
    }
    if (after.video_section.image_count <= before.video_section.image_count) {
      throw actionFailure({
        action: 'uploadVideo',
        code: 'UPLOAD_COUNT_MISMATCH',
        message: 'Shein 视频上传后数量未增加',
        selector: trigger.selector,
        beforeState: before,
        afterState: after,
      })
    }
    return {
      action: 'uploaded',
      files: existingFiles,
      beforeCount: before.video_section.image_count,
      afterCount: after.video_section.image_count,
      selector: trigger.selector,
    }
  })
}

export async function generateSkuCode(
  page: Page,
  skuPrefix: string,
  options: MutationOptions = {},
): Promise<SheinDraftPageState> {
  const prefix = normalizeRequiredValue(skuPrefix, 'generateSkuCode')
  return runWithActionError(page, 'generateSkuCode', async () => {
    const before = await requireEditablePage(page, 'generateSkuCode')
    if (!options.allowMutation) {
      throw actionFailure({
        action: 'generateSkuCode',
        code: 'FIELD_VALUE_MISMATCH',
        message: '一键生成真实 SKU 需要 allowMutation=true',
        selector: before.one_click_sku.selector,
        beforeState: before,
      })
    }
    if (!before.one_click_sku.found || !before.one_click_sku.enabled) {
      throw actionFailure({
        action: 'generateSkuCode',
        code: 'SELECTOR_NOT_FOUND',
        message: '未找到可用的一键生成 SKU 入口',
        beforeState: before,
        selector: before.one_click_sku.selector,
      })
    }

    const trigger = await locateFirst(page, SHEIN_SELECTORS.one_click_sku_button, 'generateSkuCode')
    await trigger.locator.click({ timeout: DEFAULT_ACTION_TIMEOUT_MS })
    const modal = await locateFirst(page, SHEIN_SELECTORS.sku_generate_modal, 'generateSkuCode')
    await modal.locator.waitFor({ state: 'visible', timeout: DEFAULT_ACTION_TIMEOUT_MS })
    const input = await locateFirst(page, SHEIN_SELECTORS.sku_prefix_input, 'generateSkuCode')
    await input.locator.fill(prefix)
    await modal.locator
      .getByRole('button', { name: /设置|确定|确认/ })
      .click({ timeout: DEFAULT_ACTION_TIMEOUT_MS })
    await modal.locator.waitFor({ state: 'hidden', timeout: DEFAULT_ACTION_TIMEOUT_MS })
    await waitForState(page, (state) => state.sku_table.found, DEFAULT_ACTION_TIMEOUT_MS)
    const tableText = await readSkuTableText(page)
    if (!normalizeText(tableText).includes(normalizeText(prefix))) {
      const after = await parseDraftPage(page)
      throw actionFailure({
        action: 'generateSkuCode',
        code: 'FIELD_VALUE_MISMATCH',
        message: `Shein SKU 表格未出现目标前缀：${prefix}`,
        selector: trigger.selector,
        beforeState: before,
        afterState: after,
      })
    }
    return parseDraftPage(page)
  })
}

async function fillTextField(
  page: Page,
  action: Extract<SheinActionName, 'fillTitle' | 'fillSku'>,
  value: string,
  selectors: readonly ListingSelector[],
  stateKey: 'title_field' | 'sku_field',
): Promise<SheinDraftPageState> {
  const target = normalizeRequiredValue(value, action)
  return runWithActionError(page, action, async () => {
    const before = await requireEditablePage(page, action)
    requireTextField(before[stateKey], action, stateKey, before)
    const hit = await locateFirst(page, selectors, action)
    await hit.locator.fill('')
    await hit.locator.fill(target)
    await hit.locator.dispatchEvent('change').catch(() => undefined)
    await hit.locator.blur().catch(() => undefined)
    const after = await waitForState(
      page,
      (state) => state[stateKey].current_value === target,
      DEFAULT_ACTION_TIMEOUT_MS,
    )
    if (after[stateKey].current_value !== target) {
      throw actionFailure({
        action,
        code: 'FIELD_VALUE_MISMATCH',
        message: `${stateKey} 未填入目标值`,
        selector: hit.selector,
        beforeState: before,
        afterState: after,
      })
    }
    return after
  })
}

async function requireEditablePage(
  page: Page,
  action: SheinActionName,
): Promise<SheinDraftPageState> {
  const state = await parseDraftPage(page)
  if (state.is_login_required) {
    throw actionFailure({
      action,
      code: 'LOGIN_REQUIRED',
      message: '店小秘页面需要登录',
      beforeState: state,
    })
  }
  if (state.is_loading) {
    throw actionFailure({
      action,
      code: 'PAGE_NOT_READY',
      message: '店小秘页面仍在加载',
      beforeState: state,
    })
  }
  if (state.is_blocking_modal) {
    throw actionFailure({
      action,
      code: 'BLOCKING_MODAL',
      message: '店小秘页面有阻塞弹窗',
      beforeState: state,
    })
  }
  if (state.workflow_step !== 'editing') {
    throw actionFailure({
      action,
      code: 'PAGE_NOT_READY',
      message: `店小秘页面不在编辑状态：${state.workflow_step}`,
      beforeState: state,
    })
  }
  return state
}

function requireTextField(
  state: SheinTextFieldState,
  action: SheinActionName,
  label: string,
  beforeState?: SheinDraftPageState,
): void {
  if (!state.found || state.is_disabled) {
    throw actionFailure({
      action,
      code: 'SELECTOR_NOT_FOUND',
      message: `未找到可编辑字段：${label}`,
      selector: state.selector,
      ...(beforeState ? { beforeState } : {}),
    })
  }
}

async function locateFirst(
  page: Page,
  selectors: readonly ListingSelector[],
  action: SheinActionName,
): Promise<{ selector: ListingSelector; locator: Locator }> {
  const hit = await locateBySelectorsWithFallback(page, selectors)
  if (hit) {
    return hit
  }
  throw new ListingActionError({
    action,
    code: 'SELECTOR_NOT_FOUND',
    message: `选择器未命中：${selectors.join(', ')}`,
    selector: selectors[0] ?? null,
  })
}

async function setFilesThroughUploadControl(
  page: Page,
  trigger: Locator,
  localMenuTexts: readonly string[],
  files: string[],
  action: Extract<SheinActionName, 'uploadVariantImages' | 'uploadDetailImages' | 'uploadVideo'>,
): Promise<void> {
  try {
    await handleFileChooserWithRetry(page, trigger, files, {
      menuTexts: localMenuTexts,
      globalInputSelector: '#localFileUploadInp, input[type="file"]',
      actionTimeoutMs: DEFAULT_ACTION_TIMEOUT_MS,
      settleMs: UPLOAD_SETTLE_MS,
    })
  } catch (error) {
    throw actionFailure({
      action,
      code: 'FILE_CHOOSER_TIMEOUT',
      message: '未打开文件选择器，也未找到全局本地上传 input',
      pageText: await pageTextExcerpt(page),
      cause: error,
    })
  }
}

async function selectVisibleOption(
  page: Page,
  optionText: string,
  action: SheinActionName,
): Promise<void> {
  const option = page
    .locator('.ant-select-dropdown:not(.ant-select-dropdown-hidden)')
    .getByText(optionText, { exact: true })
    .last()
  const visible = await option.isVisible({ timeout: DEFAULT_ACTION_TIMEOUT_MS }).catch(() => false)
  if (!visible) {
    throw actionFailure({
      action,
      code: 'SELECTOR_NOT_FOUND',
      message: `未找到下拉选项：${optionText}`,
      pageText: await pageTextExcerpt(page),
    })
  }
  await option.click({ timeout: DEFAULT_ACTION_TIMEOUT_MS })
}

function activeSelectSearchInput(page: Page): Locator {
  return page
    .locator('.ant-select-dropdown:not(.ant-select-dropdown-hidden) input, .ant-select-open input')
    .first()
}

async function waitForState(
  page: Page,
  predicate: (state: SheinDraftPageState) => boolean,
  timeoutMs: number,
): Promise<SheinDraftPageState> {
  return waitForParsedState(page, () => parseDraftPage(page), predicate, timeoutMs)
}

async function requireExistingFiles(
  files: readonly string[],
  action: SheinActionName,
): Promise<string[]> {
  const normalized = files.map((file) => file.trim()).filter(Boolean)
  if (normalized.length === 0) {
    throw new ListingActionError({
      action,
      code: 'MATERIAL_FILE_MISSING',
      message: '上传动作缺少真实素材文件路径',
    })
  }
  for (const file of normalized) {
    const result = await stat(file).catch(() => null)
    if (!result?.isFile()) {
      throw new ListingActionError({
        action,
        code: 'MATERIAL_FILE_MISSING',
        message: `素材文件不存在：${file}`,
      })
    }
  }
  return normalized
}

async function runWithActionError<T>(
  page: Page,
  action: SheinActionName,
  run: () => Promise<T>,
): Promise<T> {
  try {
    return await run()
  } catch (error) {
    if (error instanceof ListingActionError) {
      if (error.pageText) {
        throw error
      }
      throw cloneActionError(error, await pageTextExcerpt(page))
    }
    throw new ListingActionError({
      action,
      code: 'UNKNOWN',
      message: error instanceof Error ? error.message : String(error),
      pageText: await pageTextExcerpt(page),
      cause: error,
    })
  }
}

function cloneActionError(error: ListingActionError, pageText: string): ListingActionError {
  const options: ListingActionErrorOptions = {
    action: error.action,
    code: error.code,
    message: error.message,
    pageText,
  }
  if (error.selector) {
    options.selector = error.selector
  }
  if (error.beforeState) {
    options.beforeState = error.beforeState
  }
  if (error.afterState) {
    options.afterState = error.afterState
  }
  if (error.evidencePath) {
    options.evidencePath = error.evidencePath
  }
  if (error.cause !== undefined) {
    options.cause = error.cause
  }
  return new ListingActionError(options)
}

function actionFailure(options: ListingActionErrorOptions): ListingActionError {
  return new ListingActionError(options)
}

async function readSkuTableText(page: Page): Promise<string> {
  return page
    .locator('#skuDataInfo')
    .evaluate((node) => node.textContent ?? '')
    .catch(() => '')
}

async function pageTextExcerpt(page: Page): Promise<string> {
  return page
    .locator('body')
    .evaluate((node) => (node.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 1000))
    .catch(() => '')
}

function normalizeRequiredValue(value: string, action: SheinActionName): string {
  const normalized = value.trim()
  if (!normalized) {
    throw new ListingActionError({
      action,
      code: 'FIELD_VALUE_MISMATCH',
      message: '目标值不能为空',
    })
  }
  return normalized
}

function normalizeText(value: string): string {
  return value.replace(/\s+/g, '').toLowerCase()
}
