import {
  AppErrorClass,
  type ListingConfig,
  type ListingItem,
  type ListingTemplateConfig,
} from '@tengyu-aipod/shared'
import { describe, expect, it, vi } from 'vitest'
import { BrowserProfileLockManager } from '../../main/lib/browser-profile-lock'
import type { CDPClient } from '../../main/lib/cdp-client'
import {
  type ListingRunConfig,
  type ListingStatusRow,
  type ListingStatusStore,
  runLocalListingBatch,
} from './runner'

class FakeStatusStore implements ListingStatusStore {
  readonly rows = new Map<string, ListingStatusRow>()
  closed = false

  constructor(initialRows: ListingStatusRow[] = []) {
    for (const row of initialRows) {
      this.rows.set(this.key(row), row)
    }
  }

  find(input: Parameters<ListingStatusStore['find']>[0]) {
    return this.rows.get(this.key(input)) ?? null
  }

  upsert(record: Parameters<ListingStatusStore['upsert']>[0]) {
    const existing = this.rows.get(this.key(record))
    this.rows.set(this.key(record), {
      id: existing?.id ?? this.key(record),
      batch_path: record.batchPath,
      sku_code: record.sku,
      platform: record.platform,
      workspace_id: record.workspaceId,
      status: record.status,
      draft_template_id: record.draftTemplateId ?? null,
      retry_count: record.retryCount,
      last_attempted_at: record.lastAttemptedAt,
      last_error: record.lastError ?? null,
      evidence_dir: record.evidenceDir ?? null,
      created_at: existing?.created_at ?? 1,
    })
  }

  close() {
    this.closed = true
  }

  private key(input: {
    batchPath?: string
    batch_path?: string
    sku?: string
    sku_code?: string
    platform: string
    workspaceId?: string
    workspace_id?: string
  }) {
    return [
      input.batchPath ?? input.batch_path,
      input.sku ?? input.sku_code,
      input.platform,
      input.workspaceId ?? input.workspace_id,
    ].join('::')
  }
}

function createPage() {
  return {
    setDefaultTimeout: vi.fn(),
    isClosed: vi.fn(() => false),
    close: vi.fn().mockResolvedValue(undefined),
  }
}

function createBrowserRuntime() {
  const pages: ReturnType<typeof createPage>[] = []
  const newPage = vi.fn(async () => {
    const page = createPage()
    pages.push(page)
    return page
  })
  const cdp = {
    connectToProfile: vi.fn(async () => ({
      contexts: () => [
        {
          newPage,
        },
      ],
      newContext: vi.fn(async () => ({ newPage })),
      isConnected: vi.fn(() => true),
      close: vi.fn().mockResolvedValue(undefined),
    })),
    disconnect: vi.fn().mockResolvedValue(undefined),
  } as unknown as Pick<CDPClient, 'connectToProfile' | 'disconnect'>
  return { cdp, pages }
}

function createItem(sku: string): ListingItem {
  return {
    id: `item-${sku}`,
    sku,
    title: `Title ${sku}`,
    platform: 'temu-pop',
    templateKey: 'temu-general',
    editUrl: `https://example.test/edit/${sku}`,
    materialRootDir: '/tmp/materials',
    targetShopName: 'shop',
    imageGroups: {
      sku: [],
      carousel: [],
      material: [],
      preview: [],
      description: [],
    },
    variantGroups: [],
    videoPaths: [],
  }
}

const template: ListingTemplateConfig = {
  key: 'temu-general',
  platform: 'temu-pop',
  label: 'Temu general',
  editUrl: 'https://example.test/edit',
  materialRootDir: '/tmp/materials',
  excludedFolderNames: [],
  skuMode: 'one-click-generate',
  uploadVideo: true,
  requiredImageGroups: ['preview'],
}

function createConfig(overrides: Partial<ListingRunConfig> = {}): ListingRunConfig {
  return {
    task_id: 'task-1',
    batch_id: 'batch-1',
    batch_dir: '/tmp/batch',
    platform: 'temu-pop',
    template,
    submit_mode: 'save-draft',
    workspaces: [{ profile_id: 'profile-a' }, { profile_id: 'profile-b' }],
    max_attempts: 2,
    fail_streak_limit: 2,
    resume: false,
    timeout_ms: 1000,
    ...overrides,
  }
}

function successResult(item: ListingItem, config: ListingConfig, attemptCount = 1) {
  return {
    itemId: item.id,
    sku: item.sku,
    status: 'success' as const,
    attemptCount,
    startedAt: 1000,
    endedAt: 1001,
    stages: [
      {
        stage: 'enter_page' as const,
        ok: true,
        startedAt: 1000,
        endedAt: 1001,
      },
    ],
    editUrl: item.editUrl,
    evidenceDir: config.evidenceDir,
  }
}

describe('listing runner', () => {
  it('runs workspaces in parallel while keeping each workspace queue serial', async () => {
    const store = new FakeStatusStore()
    const locks = new BrowserProfileLockManager()
    const { cdp } = createBrowserRuntime()
    const calls: string[] = []
    const releaseSku = new Map<string, () => void>()
    const workflow = {
      runListingItem: vi.fn(
        (page: unknown, item: ListingItem, config: ListingConfig) =>
          new Promise<ReturnType<typeof successResult>>((resolve) => {
            calls.push(item.sku)
            releaseSku.set(item.sku, () => resolve(successResult(item, config)))
          }),
      ),
    }
    const runPromise = runLocalListingBatch(
      createConfig(),
      [createItem('SKU-1'), createItem('SKU-2'), createItem('SKU-3'), createItem('SKU-4')],
      {
        readConfig: vi.fn().mockResolvedValue({ workbench_root: '/tmp/workbench' }),
        openStatusStore: () => store,
        cdp,
        locks,
        workflows: { 'temu-pop': workflow },
        sleep: vi.fn().mockResolvedValue(undefined),
        now: () => 1000,
      },
    )

    await vi.waitFor(() => {
      expect(calls).toEqual(['SKU-1', 'SKU-2'])
    })

    releaseSku.get('SKU-1')?.()
    await vi.waitFor(() => {
      expect(calls).toEqual(['SKU-1', 'SKU-2', 'SKU-3'])
    })
    expect(calls).not.toContain('SKU-4')

    releaseSku.get('SKU-2')?.()
    await vi.waitFor(() => {
      expect(calls).toEqual(['SKU-1', 'SKU-2', 'SKU-3', 'SKU-4'])
    })
    releaseSku.get('SKU-3')?.()
    releaseSku.get('SKU-4')?.()

    const result = await runPromise

    expect(result.successCount).toBe(4)
    expect(cdp.connectToProfile).toHaveBeenCalledTimes(2)
    expect(locks.list()).toEqual([])
  })

  it('skips successful listing_status rows when resume is enabled', async () => {
    const store = new FakeStatusStore([
      {
        id: 'seed',
        batch_path: '/tmp/batch',
        sku_code: 'SKU-1',
        platform: 'temu-pop',
        workspace_id: 'profile-a',
        status: 'success',
        draft_template_id: null,
        retry_count: 1,
        last_attempted_at: 1,
        last_error: null,
        evidence_dir: null,
        created_at: 1,
      },
    ])
    const { cdp } = createBrowserRuntime()
    const workflow = {
      runListingItem: vi.fn(async (_page: unknown, item: ListingItem, config: ListingConfig) =>
        successResult(item, config),
      ),
    }

    const result = await runLocalListingBatch(
      createConfig({ resume: true, workspaces: [{ profile_id: 'profile-a' }] }),
      [createItem('SKU-1'), createItem('SKU-2')],
      {
        readConfig: vi.fn().mockResolvedValue({ workbench_root: '/tmp/workbench' }),
        openStatusStore: () => store,
        cdp,
        locks: new BrowserProfileLockManager(),
        workflows: { 'temu-pop': workflow },
        sleep: vi.fn().mockResolvedValue(undefined),
        now: () => 1000,
      },
    )

    expect(workflow.runListingItem).toHaveBeenCalledTimes(1)
    expect(workflow.runListingItem).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ sku: 'SKU-2' }),
      expect.anything(),
    )
    expect(result.skippedCount).toBe(1)
    expect(store.rows.get('/tmp/batch::SKU-2::temu-pop::profile-a')).toMatchObject({
      status: 'success',
      retry_count: 1,
    })
  })

  it('retries retryable item failures before marking success', async () => {
    const store = new FakeStatusStore()
    const { cdp } = createBrowserRuntime()
    const workflow = {
      runListingItem: vi
        .fn()
        .mockRejectedValueOnce(new Error('TIMEOUT first attempt'))
        .mockImplementationOnce(async (_page: unknown, item: ListingItem, config: ListingConfig) =>
          successResult(item, config),
        ),
    }
    const sleep = vi.fn().mockResolvedValue(undefined)

    const result = await runLocalListingBatch(
      createConfig({ workspaces: [{ profile_id: 'profile-a' }] }),
      [createItem('SKU-1')],
      {
        readConfig: vi.fn().mockResolvedValue({ workbench_root: '/tmp/workbench' }),
        openStatusStore: () => store,
        cdp,
        locks: new BrowserProfileLockManager(),
        workflows: { 'temu-pop': workflow },
        sleep,
        now: () => 1000,
      },
    )

    expect(workflow.runListingItem).toHaveBeenCalledTimes(2)
    expect(sleep).toHaveBeenCalledWith(2000)
    expect(result.successCount).toBe(1)
    expect(store.rows.get('/tmp/batch::SKU-1::temu-pop::profile-a')).toMatchObject({
      status: 'success',
      retry_count: 2,
    })
  })

  it('does not retry non-retryable workflow failures', async () => {
    const store = new FakeStatusStore()
    const { cdp } = createBrowserRuntime()
    const workflow = {
      runListingItem: vi.fn(async () => {
        throw new AppErrorClass('DRAFT_NOT_FOUND', '草稿模板不存在', false)
      }),
    }
    const sleep = vi.fn().mockResolvedValue(undefined)

    const result = await runLocalListingBatch(
      createConfig({
        workspaces: [{ profile_id: 'profile-a' }],
        max_attempts: 3,
      }),
      [createItem('SKU-1')],
      {
        readConfig: vi.fn().mockResolvedValue({ workbench_root: '/tmp/workbench' }),
        openStatusStore: () => store,
        cdp,
        locks: new BrowserProfileLockManager(),
        workflows: { 'temu-pop': workflow },
        sleep,
        now: () => 1000,
      },
    )

    expect(workflow.runListingItem).toHaveBeenCalledTimes(1)
    expect(sleep).not.toHaveBeenCalled()
    expect(result.failedCount).toBe(1)
    expect(store.rows.get('/tmp/batch::SKU-1::temu-pop::profile-a')).toMatchObject({
      status: 'failed',
      retry_count: 1,
      last_error: '草稿模板不存在',
    })
  })

  it('passes the workspace profile and evidence directory to the workflow and emits progress', async () => {
    const store = new FakeStatusStore()
    const { cdp } = createBrowserRuntime()
    const progress: unknown[] = []
    const workflow = {
      runListingItem: vi.fn(async (_page: unknown, item: ListingItem, config: ListingConfig) =>
        successResult(item, config),
      ),
    }

    const result = await runLocalListingBatch(
      createConfig({
        workspaces: [{ profile_id: 'profile-a' }],
        evidence_dir: '/tmp/evidence',
      }),
      [createItem('SKU-1')],
      {
        readConfig: vi.fn().mockResolvedValue({ workbench_root: '/tmp/workbench' }),
        openStatusStore: () => store,
        cdp,
        locks: new BrowserProfileLockManager(),
        workflows: { 'temu-pop': workflow },
        emitProgress: (item) => progress.push(item),
        sleep: vi.fn().mockResolvedValue(undefined),
        now: () => 1000,
      },
    )

    expect(result.results[0]?.evidenceDir).toBe('/tmp/evidence/profile-a/SKU-1')
    expect(workflow.runListingItem).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ sku: 'SKU-1' }),
      expect.objectContaining({
        profileId: 'profile-a',
        evidenceDir: '/tmp/evidence/profile-a/SKU-1',
      }),
    )
    expect(progress).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ batchId: 'batch-1', status: 'pending' }),
        expect.objectContaining({
          batchId: 'batch-1',
          profileId: 'profile-a',
          status: 'uploading',
          currentSku: 'SKU-1',
        }),
        expect.objectContaining({
          batchId: 'batch-1',
          profileId: 'profile-a',
          status: 'success',
          currentSku: 'SKU-1',
        }),
      ]),
    )
  })

  it('pauses a workspace after the fail streak limit and skips remaining items', async () => {
    const store = new FakeStatusStore()
    const { cdp } = createBrowserRuntime()
    const workflow = {
      runListingItem: vi.fn(async () => {
        throw new Error('SELECTOR_NOT_FOUND missing title')
      }),
    }

    const result = await runLocalListingBatch(
      createConfig({ workspaces: [{ profile_id: 'profile-a' }], max_attempts: 1 }),
      [createItem('SKU-1'), createItem('SKU-2'), createItem('SKU-3')],
      {
        readConfig: vi.fn().mockResolvedValue({ workbench_root: '/tmp/workbench' }),
        openStatusStore: () => store,
        cdp,
        locks: new BrowserProfileLockManager(),
        workflows: { 'temu-pop': workflow },
        sleep: vi.fn().mockResolvedValue(undefined),
        now: () => 1000,
      },
    )

    expect(result.failedCount).toBe(2)
    expect(result.skippedCount).toBe(1)
    expect(workflow.runListingItem).toHaveBeenCalledTimes(2)
    expect(store.rows.get('/tmp/batch::SKU-3::temu-pop::profile-a')).toMatchObject({
      status: 'skipped',
      last_error: '连续 2 次失败，工作区暂停',
    })
  })

  it('releases the profile lock and disconnects CDP when workflow fails', async () => {
    const store = new FakeStatusStore()
    const locks = new BrowserProfileLockManager()
    const { cdp } = createBrowserRuntime()
    const workflow = {
      runListingItem: vi.fn(async () => {
        throw new Error('DRAFT_NOT_FOUND missing draft')
      }),
    }

    const result = await runLocalListingBatch(
      createConfig({
        workspaces: [{ profile_id: 'profile-a' }],
        max_attempts: 1,
        fail_streak_limit: 1,
      }),
      [createItem('SKU-1')],
      {
        readConfig: vi.fn().mockResolvedValue({ workbench_root: '/tmp/workbench' }),
        openStatusStore: () => store,
        cdp,
        locks,
        workflows: { 'temu-pop': workflow },
        sleep: vi.fn().mockResolvedValue(undefined),
        now: () => 1000,
      },
    )

    expect(result.failedCount).toBe(1)
    expect(locks.status('profile-a')).toBeNull()
    expect(cdp.disconnect).toHaveBeenCalledWith('profile-a')
    expect(store.closed).toBe(true)
  })
})
