import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { type SqliteDatabase, openSqliteDatabase } from '../../main/lib/sqlite'
import { SqliteListingTaskStore } from './task-store'

let tempDir: string
let db: SqliteDatabase
let store: SqliteListingTaskStore

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), 'tengyu-listing-task-store-'))
  db = openSqliteDatabase(join(tempDir, 'workbench.db'))
  store = new SqliteListingTaskStore(db)
})

afterEach(async () => {
  store.close()
  await rm(tempDir, { force: true, recursive: true })
})

describe('SqliteListingTaskStore', () => {
  it('persists listing workspaces by profile and platform', () => {
    const first = store.upsertWorkspace({
      profile_id: 'profile-a',
      profile_name: '主店',
      platform: 'temu-pop',
    })

    const second = store.upsertWorkspace({
      profile_id: 'profile-a',
      profile_name: '主店更新',
      platform: 'temu-pop',
    })

    expect(second.id).toBe(first.id)
    expect(store.listWorkspaces()).toMatchObject([
      {
        id: first.id,
        profile_id: 'profile-a',
        profile_name: '主店更新',
        platform: 'temu-pop',
        status: 'idle',
      },
    ])
  })

  it('persists task definitions under a workspace', () => {
    const workspace = store.upsertWorkspace({
      profile_id: 'profile-a',
      profile_name: '主店',
      platform: 'temu-pop',
    })

    const task = store.createTask({
      workspace_id: workspace.id,
      platform: 'temu-pop',
      template_key: 'temu-clothing',
      draft_template_id: '128935194843933515',
      shop_name: '店铺 A',
      batch_dir: '/tmp/04-上架工作区/模板A',
      sku_mode: 'one-click-generate',
      submit_mode: 'save-draft',
      max_attempts: 2,
      fail_streak_limit: 3,
      resume: true,
    })

    expect(store.listTasks({ workspaceId: workspace.id })).toMatchObject([
      {
        id: task.id,
        workspace_id: workspace.id,
        platform: 'temu-pop',
        template_key: 'temu-clothing',
        draft_template_id: '128935194843933515',
        shop_name: '店铺 A',
        batch_dir: '/tmp/04-上架工作区/模板A',
        resume: true,
        status: 'queued',
      },
    ])
  })

  it('updates workspace and task run status', () => {
    const workspace = store.upsertWorkspace({
      profile_id: 'profile-a',
      profile_name: '主店',
      platform: 'temu-pop',
    })
    const task = store.createTask({
      workspace_id: workspace.id,
      platform: 'temu-pop',
      template_key: 'temu-general',
      draft_template_id: '128935194833519551',
      shop_name: '店铺 A',
      batch_dir: '/tmp/batch',
      sku_mode: 'manual',
      submit_mode: 'publish',
      max_attempts: 1,
      fail_streak_limit: 1,
      resume: false,
    })

    expect(store.updateTaskStatus(task.id, 'running', 'run-1')).toMatchObject({
      status: 'running',
      last_run_task_id: 'run-1',
    })
    expect(store.updateWorkspaceStatus(workspace.id, 'running', task.id)).toMatchObject({
      status: 'running',
      current_task_id: task.id,
    })
  })

  it('deletes saved tasks without removing the workspace', () => {
    const workspace = store.upsertWorkspace({
      profile_id: 'profile-a',
      profile_name: '主店',
      platform: 'shein',
    })
    const task = store.createTask({
      workspace_id: workspace.id,
      platform: 'shein',
      template_key: 'shein',
      draft_template_id: '128935194833519552',
      shop_name: '店铺 B',
      batch_dir: '/tmp/batch',
      sku_mode: 'manual',
      submit_mode: 'save-draft',
      max_attempts: 1,
      fail_streak_limit: 1,
      resume: true,
    })

    store.deleteTask(task.id)

    expect(store.listTasks({ workspaceId: workspace.id })).toEqual([])
    expect(store.listWorkspaces()).toMatchObject([{ id: workspace.id }])
  })
})
