import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
  type ListingConfig,
  type ListingFailure,
  type ListingItem,
  type ListingResult,
  type ListingStage,
  type StageResult,
  createListingFailure,
} from '@tengyu-aipod/shared'
import type { Page } from 'playwright'
import {
  type ListingActionError,
  fillSku,
  fillTitle,
  generateSkuCode,
  replaceImages,
  replaceShopName,
  uploadVideo,
} from './action-executor'
import { type SheinDraftPageState, parseDraftPage } from './page-parser'

export const SHEIN_WORKFLOW_STAGES = [
  'enter_page',
  'page_ready',
  'confirm_shop_context',
  'fill_title_and_sku',
  'replace_images',
  'upload_video',
  'generate_sku_code',
  'process_description',
  'submit_publish',
  'publish_result',
] as const satisfies readonly ListingStage[]

export type SheinWorkflowStage = (typeof SHEIN_WORKFLOW_STAGES)[number]

export type SheinWorkflowDependencies = {
  now?: () => number
  actions?: Partial<SheinWorkflowActions>
  allowMutation?: boolean
  allowPublish?: boolean
}

export type SheinWorkflowActions = {
  replaceShopName: typeof replaceShopName
  fillTitle: typeof fillTitle
  fillSku: typeof fillSku
  replaceImages: typeof replaceImages
  uploadVideo: typeof uploadVideo
  generateSkuCode: typeof generateSkuCode
}

const DEFAULT_ACTIONS: SheinWorkflowActions = {
  replaceShopName,
  fillTitle,
  fillSku,
  replaceImages,
  uploadVideo,
  generateSkuCode,
}

const DOM_SNAPSHOT_MAX_CHARS = 200_000

export async function runListingItem(
  page: Page,
  item: ListingItem,
  config: ListingConfig,
  dependencies: SheinWorkflowDependencies = {},
): Promise<ListingResult> {
  const now = dependencies.now ?? Date.now
  const startedAt = now()
  const stages: StageResult[] = []
  const actions = { ...DEFAULT_ACTIONS, ...dependencies.actions }

  for (const stage of SHEIN_WORKFLOW_STAGES) {
    const result = await runStage({
      page,
      item,
      config,
      stage,
      actions,
      allowMutation: dependencies.allowMutation === true,
      allowPublish: dependencies.allowPublish === true,
      now,
    })
    stages.push(result)
    if (!result.ok) {
      const failure =
        result.error ??
        createListingFailure({
          code: 'UNKNOWN',
          message: `Shein workflow failed at ${stage}`,
          stage,
        })
      throw failure
    }
  }

  return {
    itemId: item.id,
    sku: item.sku,
    status: 'success',
    attemptCount: 1,
    startedAt,
    endedAt: now(),
    stages,
    editUrl: item.editUrl,
    evidenceDir: config.evidenceDir,
  }
}

async function runStage(args: {
  page: Page
  item: ListingItem
  config: ListingConfig
  stage: SheinWorkflowStage
  actions: SheinWorkflowActions
  allowMutation: boolean
  allowPublish: boolean
  now: () => number
}): Promise<StageResult> {
  const startedAt = args.now()
  try {
    const details = await executeStage(args)
    const evidence = await saveStageEvidence(args.page, args.config.evidenceDir, args.stage, 'ok')
    return {
      stage: args.stage,
      ok: true,
      startedAt,
      endedAt: args.now(),
      ...evidence,
      details,
    }
  } catch (error) {
    const failure = failureFromUnknown(error, args.stage)
    const evidence = await saveStageEvidence(
      args.page,
      args.config.evidenceDir,
      args.stage,
      'failed',
    )
    return {
      stage: args.stage,
      ok: false,
      startedAt,
      endedAt: args.now(),
      ...evidence,
      error: {
        ...failure,
        screenshotPath: evidence.screenshotPath ?? failure.screenshotPath,
        domSnapshotPath: evidence.domSnapshotPath ?? failure.domSnapshotPath,
      },
    }
  }
}

async function executeStage(args: {
  page: Page
  item: ListingItem
  config: ListingConfig
  stage: SheinWorkflowStage
  actions: SheinWorkflowActions
  allowMutation: boolean
  allowPublish: boolean
}): Promise<Record<string, string | number | boolean | null>> {
  const { actions, config, item, page, stage } = args
  if (stage === 'enter_page') {
    const beforeUrl = page.url()
    await page.goto(item.editUrl, { waitUntil: 'domcontentloaded', timeout: config.timeoutMs })
    return stageContract({
      observedState: beforeUrl || 'blank',
      targetState: item.editUrl,
      transition: 'navigate_to_edit_url',
      successEvidence: page.url(),
      extra: { url: item.editUrl },
    })
  }
  if (stage === 'page_ready') {
    const state = await waitForEditableDraftPage(page, config.timeoutMs)
    if (state.workflow_step !== 'editing') {
      throw createListingFailure({
        code: state.is_login_required ? 'LOGIN_REQUIRED' : 'PAGE_NOT_READY',
        message: `Shein page is not editable: ${state.workflow_step}`,
        stage,
        url: state.url,
      })
    }
    return stageContract({
      observedState: state.workflow_step,
      targetState: 'editing',
      transition: 'parse_draft_page',
      successEvidence: state.shop_context,
      extra: { workflow_step: state.workflow_step, template_key: state.template_key },
    })
  }
  if (stage === 'confirm_shop_context') {
    const before = await parseDraftPage(page)
    const state = await actions.replaceShopName(page, item.targetShopName, {
      allowMutation: args.allowMutation,
    })
    return stageContract({
      observedState: before.shop_field.current_value ?? 'missing_shop',
      targetState: item.targetShopName,
      transition: 'replace_shop_name',
      successEvidence: state.shop_field.current_value ?? 'missing_shop',
      extra: { shop: state.shop_field.current_value },
    })
  }
  if (stage === 'fill_title_and_sku') {
    const before = await parseDraftPage(page)
    const titleState = await actions.fillTitle(page, item.title)
    const skuState = await actions.fillSku(page, item.sku)
    return stageContract({
      observedState: `${before.title_field.current_value ?? ''}|${before.sku_field.current_value ?? ''}`,
      targetState: `${item.title}|${item.sku}`,
      transition: 'fill_title_and_sku',
      successEvidence: `${titleState.title_field.current_value ?? ''}|${skuState.sku_field.current_value ?? ''}`,
      extra: {
        title: titleState.title_field.current_value,
        sku: skuState.sku_field.current_value,
      },
    })
  }
  if (stage === 'replace_images') {
    const before = await parseDraftPage(page)
    const files = selectSheinUploadImageFiles(item)
    if (!args.allowMutation) {
      return stageContract({
        observedState: `${before.variant_images.image_count}|${before.detail_images.image_count}`,
        targetState: 'image_upload_guarded',
        transition: 'skip_without_allowMutation',
        successEvidence: 'allowMutation=false',
        extra: { skipped: true, reason: 'allowMutation=false', file_count: files.length },
      })
    }
    const result = await actions.replaceImages(page, files, { allowMutation: true })
    const variantUploaded = result.variantImages
      ? result.variantImages.afterCount - result.variantImages.beforeCount
      : 0
    const detailUploaded = result.detailImages
      ? result.detailImages.afterCount - result.detailImages.beforeCount
      : 0
    return stageContract({
      observedState: `${before.variant_images.image_count}|${before.detail_images.image_count}`,
      targetState: `variant:${result.variantImages?.afterCount ?? before.variant_images.image_count}|detail:${result.detailImages?.afterCount ?? before.detail_images.image_count}`,
      transition: 'upload_real_shein_images',
      successEvidence: `uploaded:${variantUploaded + detailUploaded}`,
      extra: {
        variant_uploaded: variantUploaded,
        detail_uploaded: detailUploaded,
        file_count: files.length,
      },
    })
  }
  if (stage === 'upload_video') {
    const before = await parseDraftPage(page)
    if (!config.template.uploadVideo) {
      return stageContract({
        observedState: String(before.video_section.image_count),
        targetState: 'video_upload_disabled',
        transition: 'skip_by_template_config',
        successEvidence: 'template.uploadVideo=false',
        extra: { skipped: true, reason: 'template_upload_video=false' },
      })
    }
    if (!args.allowMutation) {
      return stageContract({
        observedState: String(before.video_section.image_count),
        targetState: 'video_upload_guarded',
        transition: 'skip_without_allowMutation',
        successEvidence: 'allowMutation=false',
        extra: { skipped: true, reason: 'allowMutation=false', file_count: item.videoPaths.length },
      })
    }
    if (item.videoPaths.length === 0) {
      throw createListingFailure({
        code: 'MATERIAL_FILE_MISSING',
        message: 'Shein workflow 启用真实变更时缺少真实视频文件',
        stage,
        url: before.url,
      })
    }
    const result = await actions.uploadVideo(page, item.videoPaths, { allowMutation: true })
    return stageContract({
      observedState: String(result.beforeCount),
      targetState: String(result.afterCount),
      transition: 'upload_real_video',
      successEvidence: `uploaded:${result.afterCount - result.beforeCount}`,
      extra: {
        uploaded: result.afterCount - result.beforeCount,
        file_count: item.videoPaths.length,
      },
    })
  }
  if (stage === 'generate_sku_code') {
    const before = await parseDraftPage(page)
    if (config.template.skuMode !== 'one-click-generate') {
      return stageContract({
        observedState: String(before.sku_table.row_count),
        targetState: 'manual_sku_mode',
        transition: 'skip_by_template_config',
        successEvidence: config.template.skuMode,
        extra: { skipped: true, reason: 'manual_sku_mode' },
      })
    }
    if (!args.allowMutation) {
      return stageContract({
        observedState: String(before.sku_table.row_count),
        targetState: 'sku_generation_guarded',
        transition: 'skip_without_allowMutation',
        successEvidence: 'allowMutation=false',
        extra: { skipped: true, reason: 'allowMutation=false' },
      })
    }
    const state = await actions.generateSkuCode(page, item.sku, { allowMutation: true })
    return stageContract({
      observedState: String(before.sku_table.row_count),
      targetState: String(state.sku_table.row_count),
      transition: 'one_click_generate_sku_code',
      successEvidence: `sku_rows:${state.sku_table.row_count}`,
      extra: { sku_rows: state.sku_table.row_count },
    })
  }
  if (stage === 'process_description') {
    const state = await parseDraftPage(page)
    const reason = item.descriptionText ? 'executor_not_available' : 'no_description'
    return stageContract({
      observedState: state.description_field.current_value ?? 'no_description_value',
      targetState: 'not_required_for_mvp_core_actions',
      transition: 'observe_or_skip_description',
      successEvidence: reason,
      extra: { skipped: true, reason },
    })
  }
  if (stage === 'submit_publish') {
    const state = await parseDraftPage(page)
    const reason =
      config.submitMode === 'save-draft'
        ? 'save_draft_mode'
        : args.allowPublish
          ? 'submit_executor_not_available'
          : 'allowPublish=false'
    return stageContract({
      observedState: state.publish_button.enabled ? 'publish_enabled' : 'publish_disabled',
      targetState: config.submitMode,
      transition: 'skip_publish_in_workflow_v1',
      successEvidence: reason,
      extra: { skipped: true, reason, submit_mode: config.submitMode },
    })
  }
  const state = await parseDraftPage(page)
  return stageContract({
    observedState: state.success_toast.found ? 'success_toast_found' : 'no_success_toast',
    targetState: config.submitMode === 'save-draft' ? 'draft_preserved' : 'publish_result',
    transition: 'verify_result_observe_only',
    successEvidence:
      config.submitMode === 'save-draft'
        ? 'save_draft_mode'
        : (state.success_toast.message ?? 'publish_not_verified'),
    extra: {
      skipped: true,
      reason: config.submitMode === 'save-draft' ? 'save_draft_mode' : 'publish_not_verified',
      submit_mode: config.submitMode,
    },
  })
}

async function waitForEditableDraftPage(
  page: Page,
  timeoutMs: number,
): Promise<SheinDraftPageState> {
  const deadline = Date.now() + timeoutMs
  let state = await parseDraftPage(page)

  while (state.workflow_step !== 'editing' && Date.now() < deadline) {
    await page.waitForTimeout(Math.min(250, Math.max(0, deadline - Date.now())))
    state = await parseDraftPage(page)
  }

  return state
}

async function saveStageEvidence(
  page: Page,
  evidenceDir: string,
  stage: ListingStage,
  status: 'failed' | 'ok',
) {
  const dir = join(evidenceDir, stage)
  await mkdir(dir, { recursive: true })
  const screenshotPath = join(dir, `${status}.png`)
  const domSnapshotPath = join(dir, `${status}.html`)
  await page.screenshot({ path: screenshotPath, fullPage: true }).catch(() => undefined)
  const html = await readCompactDomSnapshot(page)
  await writeFile(domSnapshotPath, html)
  return { screenshotPath, domSnapshotPath }
}

async function readCompactDomSnapshot(page: Page): Promise<string> {
  const html = await page
    .evaluate(() => {
      const clone = document.documentElement.cloneNode(true) as HTMLElement
      for (const node of clone.querySelectorAll('script, style, link, svg, canvas')) {
        node.remove()
      }
      for (const node of clone.querySelectorAll('img')) {
        node.removeAttribute('src')
        node.removeAttribute('srcset')
      }
      return `<!doctype html>\n${clone.outerHTML}`
    })
    .catch(() => page.content().catch(() => ''))

  if (html.length <= DOM_SNAPSHOT_MAX_CHARS) {
    return html
  }

  return `${html.slice(0, DOM_SNAPSHOT_MAX_CHARS)}\n<!-- DOM snapshot truncated at ${DOM_SNAPSHOT_MAX_CHARS} chars -->`
}

export function selectSheinUploadImageFiles(item: ListingItem): string[] {
  const ordered = [
    ...item.imageGroups.sku,
    ...item.imageGroups.carousel,
    ...item.imageGroups.material,
    ...item.imageGroups.preview,
    ...item.imageGroups.description,
    ...item.variantGroups.flatMap((group) => group.imagePaths),
  ]
  return Array.from(new Set(ordered.map((file) => file.trim()).filter(Boolean)))
}

function failureFromUnknown(error: unknown, stage: ListingStage): ListingFailure {
  if (isListingFailure(error)) {
    return error
  }
  if (isListingActionError(error)) {
    return createListingFailure({
      code: error.code,
      message: error.message,
      stage,
      ...(error.selector ? { selector: error.selector } : {}),
      ...(error.url ? { url: error.url } : {}),
      ...(error.evidencePath ? { screenshotPath: error.evidencePath } : {}),
      cause: error.cause,
    })
  }
  return createListingFailure({
    code: 'UNKNOWN',
    message: error instanceof Error ? error.message : String(error),
    stage,
    cause: error,
  })
}

function isListingFailure(error: unknown): error is ListingFailure {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    'stage' in error &&
    'retryable' in error
  )
}

function isListingActionError(error: unknown): error is ListingActionError {
  return error instanceof Error && 'action' in error && 'code' in error && 'retryable' in error
}

function stageContract(args: {
  observedState: string
  targetState: string
  transition: string
  successEvidence: string
  extra?: Record<string, string | number | boolean | null>
}): Record<string, string | number | boolean | null> {
  return {
    observed_state: args.observedState,
    target_state: args.targetState,
    transition: args.transition,
    success_evidence: args.successEvidence,
    ...(args.extra ?? {}),
  }
}

export const sheinWorkflow = {
  runListingItem,
}
