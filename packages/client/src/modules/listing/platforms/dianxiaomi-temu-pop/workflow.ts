import {
  type ListingConfig,
  type ListingItem,
  type ListingResult,
  type ListingStage,
  type StageResult,
  createListingFailure,
} from '@tengyu-aipod/shared'
import type { Page } from 'playwright'
import { saveStageEvidence } from '../../evidence'
import { failureFromUnknown } from '../_commons/error-utils'
import { waitForEditorReady } from '../_commons/page-wait'
import {
  fillSku,
  fillTitle,
  generateSkuCode,
  replaceShopName,
  uploadMaterialImages,
  uploadVideo,
} from './action-executor'
import { type TemuPopDraftPageState, parseDraftPage } from './page-parser'

export const TEMU_POP_WORKFLOW_STAGES = [
  'enter_page',
  'page_ready',
  'confirm_shop_context',
  'fill_title_and_sku',
  'upload_material_images',
  'upload_video',
  'process_color_skc',
  'reuse_size_chart',
  'generate_sku_code',
  'process_description',
  'submit_publish',
  'publish_result',
] as const satisfies readonly ListingStage[]

export type TemuPopWorkflowStage = (typeof TEMU_POP_WORKFLOW_STAGES)[number]

export type TemuPopWorkflowDependencies = {
  now?: () => number
  actions?: Partial<TemuPopWorkflowActions>
  allowMutation?: boolean
  allowPublish?: boolean
}

export type TemuPopWorkflowActions = {
  replaceShopName: typeof replaceShopName
  fillTitle: typeof fillTitle
  fillSku: typeof fillSku
  uploadMaterialImages: typeof uploadMaterialImages
  uploadVideo: typeof uploadVideo
  generateSkuCode: typeof generateSkuCode
}

const DEFAULT_ACTIONS: TemuPopWorkflowActions = {
  replaceShopName,
  fillTitle,
  fillSku,
  uploadMaterialImages,
  uploadVideo,
  generateSkuCode,
}

export async function runListingItem(
  page: Page,
  item: ListingItem,
  config: ListingConfig,
  dependencies: TemuPopWorkflowDependencies = {},
): Promise<ListingResult> {
  const now = dependencies.now ?? Date.now
  const startedAt = now()
  const stages: StageResult[] = []
  const actions = { ...DEFAULT_ACTIONS, ...dependencies.actions }
  const allowMutation = dependencies.allowMutation ?? config.allowMutation === true
  const allowPublish = dependencies.allowPublish ?? config.allowPublish === true

  for (const [stageIndex, stage] of TEMU_POP_WORKFLOW_STAGES.entries()) {
    const result = await runStage({
      page,
      item,
      config,
      stage,
      stageIndex: stageIndex + 1,
      actions,
      allowMutation,
      allowPublish,
      now,
    })
    stages.push(result)
    if (!result.ok) {
      const failure =
        result.error ??
        createListingFailure({
          code: 'UNKNOWN',
          message: `Temu workflow failed at ${stage}`,
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
  stage: TemuPopWorkflowStage
  stageIndex: number
  actions: TemuPopWorkflowActions
  allowMutation: boolean
  allowPublish: boolean
  now: () => number
}): Promise<StageResult> {
  const startedAt = args.now()
  try {
    const details = await executeStage(args)
    const result: StageResult = {
      stage: args.stage,
      ok: true,
      startedAt,
      endedAt: args.now(),
      details,
    }
    const evidence = await saveStageEvidence(
      args.page,
      args.config.evidenceDir,
      args.stage,
      result,
      {
        stageIndex: args.stageIndex,
      },
    )
    return {
      ...result,
      ...evidence,
    }
  } catch (error) {
    const failure = failureFromUnknown(error, args.stage)
    const result: StageResult = {
      stage: args.stage,
      ok: false,
      startedAt,
      endedAt: args.now(),
      error: failure,
    }
    const evidence = await saveStageEvidence(
      args.page,
      args.config.evidenceDir,
      args.stage,
      result,
      {
        stageIndex: args.stageIndex,
      },
    )
    return {
      ...result,
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
  stage: TemuPopWorkflowStage
  actions: TemuPopWorkflowActions
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
        message: `Temu page is not editable: ${state.workflow_step}`,
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
  if (stage === 'upload_material_images') {
    const before = await parseDraftPage(page)
    const files = selectTemuPopUploadImageFiles(item)
    if (!args.allowMutation) {
      return stageContract({
        observedState: String(before.carousel_images.count),
        targetState: 'image_upload_guarded',
        transition: 'skip_without_allowMutation',
        successEvidence: 'allowMutation=false',
        extra: { skipped: true, reason: 'allowMutation=false', file_count: files.length },
      })
    }
    const result = await actions.uploadMaterialImages(page, files, { allowMutation: true })
    return stageContract({
      observedState: String(result.beforeCount),
      targetState: String(result.afterCount),
      transition: 'upload_real_images',
      successEvidence: `uploaded:${result.afterCount - result.beforeCount}`,
      extra: { uploaded: result.afterCount - result.beforeCount, file_count: files.length },
    })
  }
  if (stage === 'upload_video') {
    const before = await parseDraftPage(page)
    if (!config.template.uploadVideo) {
      return stageContract({
        observedState: String(before.video_section.current_video_count),
        targetState: 'video_upload_disabled',
        transition: 'skip_by_template_config',
        successEvidence: 'template.uploadVideo=false',
        extra: { skipped: true, reason: 'template_upload_video=false' },
      })
    }
    if (!args.allowMutation) {
      return stageContract({
        observedState: String(before.video_section.current_video_count),
        targetState: 'video_upload_guarded',
        transition: 'skip_without_allowMutation',
        successEvidence: 'allowMutation=false',
        extra: { skipped: true, reason: 'allowMutation=false', file_count: item.videoPaths.length },
      })
    }
    if (item.videoPaths.length === 0) {
      throw createListingFailure({
        code: 'MATERIAL_FILE_MISSING',
        message: 'Temu workflow 启用真实变更时缺少真实视频文件',
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
  if (stage === 'process_color_skc') {
    const state = await parseDraftPage(page)
    return stageContract({
      observedState: state.preview_images.found ? 'preview_images_found' : 'preview_images_missing',
      targetState: 'not_required_for_mvp_core_actions',
      transition: 'observe_only',
      successEvidence: `preview_count:${state.preview_images.count}`,
      extra: { skipped: true, reason: 'executor_not_available' },
    })
  }
  if (stage === 'reuse_size_chart') {
    const state = await parseDraftPage(page)
    return stageContract({
      observedState: state.variant_attribute_section.found
        ? 'variant_section_found'
        : 'variant_section_missing',
      targetState: 'not_required_for_mvp_core_actions',
      transition: 'observe_only',
      successEvidence: state.variant_attribute_section.text ?? 'no_variant_section_text',
      extra: { skipped: true, reason: 'executor_not_available' },
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
      observedState: String(state.description_images.count),
      targetState: 'not_required_for_mvp_core_actions',
      transition: 'observe_or_skip_description',
      successEvidence: reason,
      extra: { skipped: true, reason },
    })
  }
  if (stage === 'submit_publish') {
    const state = await parseDraftPage(page)
    if (config.submitMode === 'publish' && args.allowPublish) {
      throw createListingFailure({
        code: 'PUBLISH_FAILED',
        message: 'Temu workflow 缺少真实发布执行器，不能标记为发布成功',
        stage,
        url: state.url,
      })
    }
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
): Promise<TemuPopDraftPageState> {
  return waitForEditorReady(page, () => parseDraftPage(page), timeoutMs)
}

export function selectTemuPopUploadImageFiles(item: ListingItem): string[] {
  const ordered =
    item.templateKey === 'temu-clothing'
      ? [
          ...item.imageGroups.material,
          ...item.imageGroups.carousel,
          ...item.imageGroups.sku,
          ...item.imageGroups.preview,
        ]
      : [
          ...item.imageGroups.preview,
          ...item.imageGroups.carousel,
          ...item.imageGroups.material,
          ...item.imageGroups.sku,
        ]
  return Array.from(new Set(ordered.map((file) => file.trim()).filter(Boolean)))
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

export const temuPopWorkflow = {
  runListingItem,
}
