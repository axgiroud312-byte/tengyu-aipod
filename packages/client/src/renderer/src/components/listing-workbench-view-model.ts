import { t } from '@/locale/t'
import type {
  ListingPlatformKey,
  ListingProgress,
  ListingStage,
  ListingTaskRecord,
  ListingWorkspaceRecord,
} from '@tengyu-aipod/shared'
import type { BitBrowserProfile } from '../../../main/lib/bit-browser-client'
import type { BrowserProfileHolder } from '../../../main/lib/browser-profile-lock'
import type { ListingStatusRow } from '../../../modules/listing/runner'

export type WorkspaceProgress = {
  status: ListingProgress['status']
  currentSku?: string
  currentStage?: NonNullable<ListingProgress['currentStage']>
  finishedCount: number
  totalCount: number
  lastError?: string
}

export type ListingOperationalRow = {
  key: string
  environment: string
  profileId: string
  sku: string
  stage: string
  status: string
  reason: string | null
  source: ListingStatusRow | null
}

export const listingPlatformLabels: Record<ListingPlatformKey, string> = {
  'temu-pop': 'Temu',
  shein: 'Shein',
}

export const listingStageLabels: Record<ListingStage, string> = {
  enter_page: '打开编辑页',
  page_ready: '等待页面可编辑',
  confirm_shop_context: '替换店铺名称',
  fill_title_and_sku: '替换标题',
  upload_material_images: '替换图片',
  upload_video: '一键上传视频',
  process_color_skc: '处理颜色与 SKC',
  reuse_size_chart: '复用尺码表',
  generate_sku_code: '一键生成货号',
  process_description: '处理描述',
  submit_publish: '保存草稿',
  publish_result: '验证结果',
  replace_shop_name: '替换店铺名称',
  replace_title: '替换标题',
  replace_images: '替换图片',
  generate_sku: '生成货号',
  save_or_publish: '保存或发布',
  verify_result: '验证结果',
}

export const listingWorkspaceStatusLabels: Record<ListingWorkspaceRecord['status'], string> = {
  idle: '空闲',
  running: '运行中',
  paused: '已暂停',
  failed: '失败',
  completed: '完成',
}

export const listingTaskStatusLabels: Record<ListingTaskRecord['status'], string> = {
  queued: '队列',
  running: '运行中',
  paused: '已暂停',
  completed: '完成',
  failed: '失败',
}

const listingStatusLabels: Record<ListingProgress['status'], string> = {
  pending: '等待',
  uploading: '运行中',
  success: '完成',
  failed: '失败',
  skipped: '跳过',
  cancelled: t('已取消'),
}

export function profileStatusLabel(
  profile: BitBrowserProfile,
  lock: BrowserProfileHolder | undefined,
) {
  if (lock) {
    return lock.module === 'collection' ? '被采集占用' : '被上架占用'
  }
  if (profile.status === 1 || profile.status === '1') {
    return '已登录'
  }
  if (profile.status === 0 || profile.status === '0') {
    return '未登录'
  }
  return '可用'
}

export function createListingOperationalRows({
  profiles,
  statusRows,
  workspaceProgress,
  workspaces,
}: {
  profiles: BitBrowserProfile[]
  statusRows: ListingStatusRow[]
  workspaceProgress: Record<string, WorkspaceProgress>
  workspaces: ListingWorkspaceRecord[]
}): ListingOperationalRow[] {
  const workspaceByProfileId = new Map(
    workspaces.map((workspace) => [workspace.profile_id, workspace]),
  )
  const profileById = new Map(profiles.map((profile) => [profile.id, profile]))
  const environmentName = (profileId: string) =>
    workspaceByProfileId.get(profileId)?.profile_name ??
    profileById.get(profileId)?.name ??
    profileId
  const rows: ListingOperationalRow[] = statusRows.map((row) => {
    const runtime = workspaceProgress[row.workspace_id]
    const isCurrentSku = runtime?.currentSku === row.sku_code
    return {
      key: `${row.workspace_id}-${row.sku_code}`,
      environment: environmentName(row.workspace_id),
      profileId: row.workspace_id,
      sku: row.sku_code,
      stage:
        isCurrentSku && runtime.currentStage
          ? (listingStageLabels[runtime.currentStage] ?? runtime.currentStage)
          : '—',
      status: listingStatusLabels[row.status],
      reason: row.last_error ?? (isCurrentSku ? (runtime.lastError ?? null) : null),
      source: row,
    }
  })
  const persistedKeys = new Set(rows.map((row) => `${row.profileId}-${row.sku}`))
  for (const [profileId, runtime] of Object.entries(workspaceProgress)) {
    if (!runtime.currentSku || persistedKeys.has(`${profileId}-${runtime.currentSku}`)) {
      continue
    }
    rows.unshift({
      key: `live-${profileId}-${runtime.currentSku}`,
      environment: environmentName(profileId),
      profileId,
      sku: runtime.currentSku,
      stage: runtime.currentStage
        ? (listingStageLabels[runtime.currentStage] ?? runtime.currentStage)
        : '—',
      status: listingStatusLabels[runtime.status],
      reason: runtime.lastError ?? null,
      source: null,
    })
  }
  return rows
}
