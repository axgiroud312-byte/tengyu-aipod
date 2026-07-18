import type { ListingWorkspaceRecord } from '@tengyu-aipod/shared'
import { describe, expect, it } from 'vitest'
import type { BitBrowserProfile } from '../../../main/lib/bit-browser-client'
import type { ListingStatusRow } from '../../../modules/listing/runner'
import {
  type WorkspaceProgress,
  createListingOperationalRows,
} from './listing-workbench-view-model'

const profile: BitBrowserProfile = {
  id: 'profile-1',
  name: 'Temu 店铺 A',
}

const workspace: ListingWorkspaceRecord = {
  id: 'workspace-1',
  profile_id: 'profile-1',
  profile_name: 'Temu 店铺 A',
  platform: 'temu-pop',
  status: 'running',
  current_task_id: 'task-1',
  created_at: 1,
  updated_at: 1,
}

const statusRow: ListingStatusRow = {
  id: 'status-1',
  batch_path: 'C:/workspace/04-上架工作区/套版-001',
  sku_code: 'SKU-001',
  platform: 'temu-pop',
  workspace_id: 'profile-1',
  status: 'uploading',
  draft_template_id: '123',
  retry_count: 0,
  last_attempted_at: 1,
  last_error: null,
  evidence_dir: null,
  created_at: 1,
}

describe('listing workbench operational rows', () => {
  it('combines a persisted status row with its live workspace stage', () => {
    const workspaceProgress: Record<string, WorkspaceProgress> = {
      'profile-1': {
        status: 'uploading',
        currentSku: 'SKU-001',
        currentStage: 'upload_material_images',
        finishedCount: 2,
        totalCount: 6,
        lastError: '图片上传正在重试',
      },
    }

    expect(
      createListingOperationalRows({
        profiles: [profile],
        statusRows: [statusRow],
        workspaceProgress,
        workspaces: [workspace],
      }),
    ).toEqual([
      {
        key: 'profile-1-SKU-001',
        environment: 'Temu 店铺 A',
        profileId: 'profile-1',
        sku: 'SKU-001',
        stage: '替换图片',
        status: '运行中',
        reason: '图片上传正在重试',
        source: statusRow,
      },
    ])
  })

  it('adds the currently running SKU before persisted status arrives', () => {
    const workspaceProgress: Record<string, WorkspaceProgress> = {
      'profile-1': {
        status: 'cancelled',
        currentSku: 'SKU-002',
        finishedCount: 5,
        totalCount: 6,
      },
    }

    expect(
      createListingOperationalRows({
        profiles: [profile],
        statusRows: [],
        workspaceProgress,
        workspaces: [workspace],
      }),
    ).toEqual([
      {
        key: 'live-profile-1-SKU-002',
        environment: 'Temu 店铺 A',
        profileId: 'profile-1',
        sku: 'SKU-002',
        stage: '—',
        status: '已取消',
        reason: null,
        source: null,
      },
    ])
  })
})
