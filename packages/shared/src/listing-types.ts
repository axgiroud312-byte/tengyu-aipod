import { type AppErrorClass, ErrorCode } from './errors'

export type ListingPlatformKey = 'temu-pop' | 'shein'

export type ListingTemplateKey = 'temu-clothing' | 'temu-general' | 'shein'

export type ListingImageGroup = 'sku' | 'carousel' | 'material' | 'preview' | 'description'

export type ListingSubmitMode = 'save-draft' | 'publish'

export type ListingSkuMode = 'manual' | 'one-click-generate'

export type ListingStatus = 'pending' | 'uploading' | 'success' | 'failed' | 'skipped'

export type ListingWorkspaceStatus = 'idle' | 'running' | 'paused' | 'failed' | 'completed'

export type ListingTaskStatus = 'queued' | 'running' | 'paused' | 'completed' | 'failed'

export type ListingStage =
  | 'enter_page'
  | 'page_ready'
  | 'confirm_shop_context'
  | 'fill_title_and_sku'
  | 'upload_material_images'
  | 'upload_video'
  | 'process_color_skc'
  | 'reuse_size_chart'
  | 'generate_sku_code'
  | 'process_description'
  | 'submit_publish'
  | 'publish_result'
  | 'replace_shop_name'
  | 'replace_title'
  | 'replace_images'
  | 'generate_sku'
  | 'save_or_publish'
  | 'verify_result'

export type ListingErrorCode =
  | 'TIMEOUT'
  | 'BLOCKING_MODAL'
  | 'PAGE_NOT_READY'
  | 'FILE_CHOOSER_TIMEOUT'
  | 'FIELD_VALUE_MISMATCH'
  | 'LOGIN_REQUIRED'
  | 'SELECTOR_NOT_FOUND'
  | 'DRAFT_NOT_FOUND'
  | 'PUBLISH_FAILED'
  | 'PROFILE_LOCKED'
  | 'BROWSER_NOT_CONNECTED'
  | 'CONSECUTIVE_FAILURES'
  | 'MATERIAL_FILE_MISSING'
  | 'UPLOAD_COUNT_MISMATCH'
  | 'UNKNOWN'

export const LISTING_RETRYABLE_ERROR_CODES = [
  'TIMEOUT',
  'BLOCKING_MODAL',
  'PAGE_NOT_READY',
  'FILE_CHOOSER_TIMEOUT',
  'FIELD_VALUE_MISMATCH',
  'UPLOAD_COUNT_MISMATCH',
  'UNKNOWN',
] as const satisfies readonly ListingErrorCode[]

export const LISTING_ERROR_CODE_TO_APP_ERROR_CODE = {
  TIMEOUT: ErrorCode.NETWORK_TIMEOUT,
  BLOCKING_MODAL: ErrorCode.PAGE_NOT_READY,
  PAGE_NOT_READY: ErrorCode.PAGE_NOT_READY,
  FILE_CHOOSER_TIMEOUT: ErrorCode.PAGE_NOT_READY,
  FIELD_VALUE_MISMATCH: ErrorCode.PAGE_NOT_READY,
  LOGIN_REQUIRED: ErrorCode.LOGIN_REQUIRED,
  SELECTOR_NOT_FOUND: ErrorCode.SELECTOR_NOT_FOUND,
  DRAFT_NOT_FOUND: ErrorCode.DRAFT_NOT_FOUND,
  PUBLISH_FAILED: ErrorCode.HTTP_4XX,
  PROFILE_LOCKED: ErrorCode.PROFILE_LOCKED,
  BROWSER_NOT_CONNECTED: ErrorCode.BROWSER_NOT_CONNECTED,
  CONSECUTIVE_FAILURES: ErrorCode.HTTP_5XX,
  MATERIAL_FILE_MISSING: ErrorCode.HTTP_4XX,
  UPLOAD_COUNT_MISMATCH: ErrorCode.PAGE_NOT_READY,
  UNKNOWN: ErrorCode.HTTP_5XX,
} as const satisfies Record<ListingErrorCode, (typeof ErrorCode)[keyof typeof ErrorCode]>

export interface ListingImageGroups {
  sku: string[]
  carousel: string[]
  material: string[]
  preview: string[]
  description: string[]
}

export interface ListingVariantGroup {
  id: string
  name: string
  imagePaths: string[]
}

export interface ListingMaterialScanItem {
  id: string
  sku: string
  title: string
  folderName: string
  folderPath: string
  templateKey: ListingTemplateKey
  imageGroups: ListingImageGroups
  variantGroups: ListingVariantGroup[]
  videoPaths: string[]
  descriptionText?: string
  warning?: string
}

export interface ListingMaterialScanResult {
  rootDir: string
  templateKey: ListingTemplateKey
  items: ListingMaterialScanItem[]
  warnings: string[]
}

export interface ListingItem {
  id: string
  sku: string
  title: string
  platform: ListingPlatformKey
  templateKey: ListingTemplateKey
  editUrl: string
  materialRootDir: string
  folderPath?: string
  targetShopName: string
  currentShopName?: string
  imageGroups: ListingImageGroups
  variantGroups: ListingVariantGroup[]
  videoPaths: string[]
  descriptionText?: string
}

export interface ListingTemplateConfig {
  key: ListingTemplateKey
  platform: ListingPlatformKey
  label: string
  editUrl: string
  materialRootDir: string
  excludedFolderNames: string[]
  skuMode: ListingSkuMode
  uploadVideo: boolean
  requiredImageGroups: ListingImageGroup[]
}

export interface ListingWorkspaceRecord {
  id: string
  profile_id: string
  profile_name: string
  platform: ListingPlatformKey
  status: ListingWorkspaceStatus
  current_task_id: string | null
  created_at: number
  updated_at: number
}

export interface ListingWorkspaceInput {
  profile_id: string
  profile_name: string
  platform: ListingPlatformKey
}

export interface ListingTaskRecord {
  id: string
  workspace_id: string
  platform: ListingPlatformKey
  template_key: ListingTemplateKey
  draft_template_id: string
  shop_name: string
  batch_dir: string
  sku_mode: ListingSkuMode
  submit_mode: ListingSubmitMode
  max_attempts: number
  fail_streak_limit: number
  resume: boolean
  status: ListingTaskStatus
  last_run_task_id: string | null
  created_at: number
  updated_at: number
}

export interface ListingTaskInput {
  workspace_id: string
  platform: ListingPlatformKey
  template_key: ListingTemplateKey
  draft_template_id: string
  shop_name: string
  batch_dir: string
  sku_mode: ListingSkuMode
  submit_mode: ListingSubmitMode
  max_attempts: number
  fail_streak_limit: number
  resume: boolean
}

export interface ListingConfig {
  batchId: string
  profileId: string
  template: ListingTemplateConfig
  submitMode: ListingSubmitMode
  maxAttempts: number
  timeoutMs: number
  evidenceDir: string
}

export interface StageResult {
  stage: ListingStage
  ok: boolean
  startedAt: number
  endedAt: number
  screenshotPath?: string
  domSnapshotPath?: string
  stateSnapshotPath?: string
  details?: Record<string, string | number | boolean | null>
  error?: ListingFailure
}

export interface ListingFailure {
  code: ListingErrorCode
  appErrorCode: keyof typeof ErrorCode
  message: string
  retryable: boolean
  stage: ListingStage
  selector?: string
  url?: string
  screenshotPath?: string
  domSnapshotPath?: string
  cause?: string
}

export interface ListingResult {
  itemId: string
  sku: string
  status: ListingStatus
  attemptCount: number
  startedAt: number
  endedAt: number
  stages: StageResult[]
  editUrl: string
  evidenceDir?: string
  failure?: ListingFailure
}

export interface WorkspaceResult {
  profileId: string
  platform: ListingPlatformKey
  templateKey: ListingTemplateKey
  totalCount: number
  successCount: number
  failedCount: number
  skippedCount: number
  results: ListingResult[]
}

export interface ListingProgress {
  batchId: string
  profileId: string
  status: ListingStatus
  totalCount: number
  finishedCount: number
  currentSku?: string
  currentStage?: ListingStage
  lastError?: ListingFailure
}

export const SLICE_8_LISTING_TEMPLATES = [
  {
    key: 'temu-clothing',
    platform: 'temu-pop',
    label: 'Temu 服装',
    editUrl: 'https://www.dianxiaomi.com/web/popTemu/edit?id=128935194843933515',
    materialRootDir: '/Users/macmini/Desktop/服装素材摆放举例',
    excludedFolderNames: ['GzG00010'],
    skuMode: 'one-click-generate',
    uploadVideo: true,
    requiredImageGroups: ['material', 'sku'],
  },
  {
    key: 'temu-general',
    platform: 'temu-pop',
    label: 'Temu 百货',
    editUrl: 'https://www.dianxiaomi.com/web/popTemu/edit?id=128935194833519551',
    materialRootDir: '/Users/macmini/Desktop/素材文件夹',
    excludedFolderNames: [],
    skuMode: 'one-click-generate',
    uploadVideo: true,
    requiredImageGroups: ['preview'],
  },
  {
    key: 'shein',
    platform: 'shein',
    label: 'Shein',
    editUrl: 'https://www.dianxiaomi.com/web/sheinProduct/edit?id=128935201966452551',
    materialRootDir: '/Users/macmini/Desktop/服装素材摆放举例/GzG0001',
    excludedFolderNames: [],
    skuMode: 'one-click-generate',
    uploadVideo: true,
    requiredImageGroups: ['sku'],
  },
] as const satisfies readonly ListingTemplateConfig[]

export function isListingRetryable(code: ListingErrorCode): boolean {
  return (LISTING_RETRYABLE_ERROR_CODES as readonly ListingErrorCode[]).includes(code)
}

export function createListingFailure(args: {
  code: ListingErrorCode
  message: string
  stage: ListingStage
  selector?: string
  url?: string
  screenshotPath?: string
  domSnapshotPath?: string
  cause?: unknown
}): ListingFailure {
  const failure: ListingFailure = {
    code: args.code,
    appErrorCode: LISTING_ERROR_CODE_TO_APP_ERROR_CODE[args.code],
    message: args.message,
    retryable: isListingRetryable(args.code),
    stage: args.stage,
  }
  if (args.selector) {
    failure.selector = args.selector
  }
  if (args.url) {
    failure.url = args.url
  }
  if (args.screenshotPath) {
    failure.screenshotPath = args.screenshotPath
  }
  if (args.domSnapshotPath) {
    failure.domSnapshotPath = args.domSnapshotPath
  }
  if (args.cause !== undefined) {
    failure.cause = args.cause instanceof Error ? args.cause.message : String(args.cause)
  }
  return failure
}

export function listingFailureFromAppError(
  error: Pick<AppErrorClass, 'code' | 'message' | 'retryable'>,
  stage: ListingStage,
): ListingFailure {
  const listingCode = toListingErrorCode(error.code)
  return {
    code: listingCode,
    appErrorCode: error.code,
    message: error.message,
    retryable: error.retryable,
    stage,
  }
}

function toListingErrorCode(code: keyof typeof ErrorCode): ListingErrorCode {
  switch (code) {
    case 'LOGIN_REQUIRED':
      return 'LOGIN_REQUIRED'
    case 'SELECTOR_NOT_FOUND':
      return 'SELECTOR_NOT_FOUND'
    case 'DRAFT_NOT_FOUND':
      return 'DRAFT_NOT_FOUND'
    case 'PROFILE_LOCKED':
      return 'PROFILE_LOCKED'
    case 'BROWSER_NOT_CONNECTED':
      return 'BROWSER_NOT_CONNECTED'
    case 'PAGE_NOT_READY':
      return 'PAGE_NOT_READY'
    case 'NETWORK_TIMEOUT':
      return 'TIMEOUT'
    default:
      return 'UNKNOWN'
  }
}
