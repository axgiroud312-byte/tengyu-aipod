import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { type IncomingMessage, type ServerResponse, createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  type ElectronApplication,
  type Page,
  type TestInfo,
  _electron as electron,
  expect,
  test,
} from '@playwright/test'
import type { PipelineProgress, PipelineTaskEvent } from '@tengyu-aipod/shared'
import sharp from 'sharp'
import { openCollectionDatabase as openWorkbenchDatabase } from '../src/main/lib/collection-record-store'

function sendJson(response: ServerResponse, body: unknown, status = 200) {
  response.writeHead(status, { 'content-type': 'application/json' })
  response.end(JSON.stringify(body))
}

async function attachScreenshot(page: Page, testInfo: TestInfo, name: string, fullPage = false) {
  const path = testInfo.outputPath(`${name}.png`)
  await page.screenshot({ path, fullPage })
  await testInfo.attach(name, { path, contentType: 'image/png' })
}

async function startMockServer() {
  const previewImages = await Promise.all([
    sharp({
      create: { width: 480, height: 360, channels: 3, background: '#2563eb' },
    })
      .png()
      .toBuffer(),
    sharp({
      create: { width: 480, height: 360, channels: 3, background: '#e85d3f' },
    })
      .png()
      .toBuffer(),
  ])
  const server = createServer((request: IncomingMessage, response: ServerResponse) => {
    const url = new URL(request.url ?? '/', 'http://127.0.0.1')
    if (url.pathname === '/user/public/send_login_sms') {
      sendJson(response, { status: 1, info: 'ok', data: {} })
      return
    }
    if (url.pathname === '/user/public/login') {
      sendJson(response, { status: 1, info: 'ok', data: { secret: 'e2e-secret', uid: 10001 } })
      return
    }
    if (url.pathname === '/api/customer-auth/verify') {
      sendJson(response, {
        ok: true,
        data: {
          customer: {
            account: 'e2e',
            avatar_url: null,
            expires_at: '2099-12-31T00:00:00.000Z',
            id: 'cus_workbench_shell_e2e',
            nickname: 'E2E Customer',
            phone: '13800000000',
            php_uid: 10001,
          },
          status: 'active',
        },
      })
      return
    }
    if (url.pathname === '/api/skills') {
      sendJson(response, { ok: true, data: [] })
      return
    }
    if (url.pathname.startsWith('/image/')) {
      const imageIndex = Number.parseInt(url.pathname.split('/').at(-1) ?? '1', 10) - 1
      response.writeHead(200, { 'content-type': 'image/png' })
      response.end(previewImages[Math.max(0, imageIndex) % previewImages.length] ?? Buffer.alloc(0))
      return
    }
    sendJson(response, { ok: false, error: { code: 'NOT_FOUND' } }, 404)
  })

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') {
    throw new Error('mock server did not expose a TCP port')
  }
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: () =>
      new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      ),
  }
}

async function launchApp(input: { serverUrl: string; userDataDir: string }) {
  return electron.launch({
    args: ['out/main/index.js'],
    cwd: process.cwd(),
    timeout: 30_000,
    env: {
      ...process.env,
      NODE_ENV: 'development',
      TENGYU_SERVER_URL: input.serverUrl,
      TENGYU_PHP_AUTH_BASE_URL: input.serverUrl,
      ELECTRON_DISABLE_SECURITY_WARNINGS: 'true',
      TENGYU_ELECTRON_USER_DATA_DIR: input.userDataDir,
    },
  })
}

async function enterPreparedWorkbench(
  page: Awaited<ReturnType<ElectronApplication['firstWindow']>>,
  workbenchRoot: string,
  beforeReload?: () => Promise<void> | void,
) {
  await page.getByRole('textbox', { name: '手机号' }).fill('13800000000')
  await page.getByRole('button', { name: '发送验证码' }).click()
  await page.getByRole('textbox', { name: '验证码' }).fill('123456')
  await page.getByRole('button', { name: '验证登录' }).click()
  await expect(page.getByRole('button', { name: '全部跳过' })).toBeVisible()
  await page.evaluate(async (root) => {
    await window.api.onboarding.saveWorkbenchRoot(root)
    await window.api.onboarding.complete()
  }, workbenchRoot)
  await beforeReload?.()
  await page.reload()
  await expect(page.getByRole('heading', { name: '完整任务', exact: true })).toBeVisible()
}

async function installPipelineEventHarness(app: ElectronApplication) {
  await app.evaluate(({ ipcMain }) => {
    const state = globalThis as typeof globalThis & {
      __pipelineCancelCalls?: number
      __pipelineResumeCalls?: number
    }
    ipcMain.removeHandler('pipeline:cancel')
    ipcMain.handle('pipeline:cancel', () => {
      state.__pipelineCancelCalls = (state.__pipelineCancelCalls ?? 0) + 1
      return { ok: true }
    })
    ipcMain.removeHandler('pipeline:resume')
    ipcMain.handle('pipeline:resume', (_event, input: { run_id: string }) => {
      state.__pipelineResumeCalls = (state.__pipelineResumeCalls ?? 0) + 1
      return input.run_id
    })
  })
}

async function installDetectionWorkspaceHarness(
  app: ElectronApplication,
  imagePaths: [string, string, string],
) {
  await app.evaluate(
    ({ ipcMain }, input) => {
      const skill = {
        id: 'infringement-detection',
        module: 'detection',
        category: null,
        platform: null,
        language: 'zh-CN',
        version: 'e2e-v1',
        enabled: true,
        recommendedModel: 'qwen3.6-flash',
        notes: null,
        systemPrompt: 'Classify infringement risk.',
        variables: [
          {
            key: 'focus',
            label: '关注重点',
            type: 'select',
            options: [
              { value: 'logo', label: '品牌标识' },
              { value: 'character', label: '角色形象' },
            ],
            default: 'logo',
          },
        ],
      }
      const images = ['pass', 'review', 'block'].map((risk, index) => ({
        id: `source-${risk}`,
        path: input.imagePaths[index] ?? '',
        name: `${risk}.png`,
        relativePath: `${risk}.png`,
        sizeBytes: 1024 + index,
        modifiedAt: 1_700_000_000_000 + index,
        thumbnailUrl: '',
      }))
      const sourceFolder = input.imagePaths[0].replace(/[\\/][^\\/]+$/, '')

      ipcMain.removeHandler('skill:list')
      ipcMain.handle('skill:list', () => [skill])
      ipcMain.removeHandler('skill:get')
      ipcMain.handle('skill:get', () => skill)
      ipcMain.removeHandler('detection:list-models')
      ipcMain.handle('detection:list-models', () => ['qwen3.6-flash', 'qwen3-vl-plus'])
      ipcMain.removeHandler('detection:get-config')
      ipcMain.handle('detection:get-config', () => ({
        threshold: { passMax: 20, reviewMax: 60 },
        skillId: skill.id,
        skillVersion: skill.version,
        model: 'qwen3.6-flash',
        variables: { focus: 'logo' },
      }))
      ipcMain.removeHandler('detection:save-config')
      ipcMain.handle('detection:save-config', (_event, config) => config)
      ipcMain.removeHandler('detection:list-input-sources')
      ipcMain.handle('detection:list-input-sources', () => ({
        dirs: [sourceFolder],
        counts: { [sourceFolder]: images.length },
        sources: [
          {
            key: 'generation-extract',
            label: '02-印花工作区 / 提取',
            folder: sourceFolder,
            count: images.length,
          },
        ],
      }))
      ipcMain.removeHandler('detection:scan-paths')
      ipcMain.handle('detection:scan-paths', () => images)
      ipcMain.removeHandler('detection:run')
      ipcMain.handle('detection:run', () => 'detection-ui-run')
      ipcMain.removeHandler('detection:cancel')
      ipcMain.handle('detection:cancel', () => ({ ok: true }))
      ipcMain.removeHandler('detection:promote-to-matting')
      ipcMain.handle(
        'detection:promote-to-matting',
        (_event, value: { artifact_ids: string[] }) => value.artifact_ids.length,
      )
      ipcMain.removeHandler('detection:delete-result')
      ipcMain.handle('detection:delete-result', () => 1)
      ipcMain.removeHandler('detection:retest')
      ipcMain.handle('detection:retest', () => 'detection-retest-1')
    },
    { imagePaths },
  )
}

async function installPhotoshopWorkspaceHarness(
  app: ElectronApplication,
  input: {
    printPaths: [string, string]
    outputPaths: [string, string, string]
    templatePaths: [string, string]
  },
) {
  await app.evaluate(({ ipcMain }, fixture) => {
    let statusCheckCount = 0
    const prints = fixture.printPaths.map((filePath, index) => ({
      id: `SKU-00${index + 1}`,
      file_path: filePath,
      thumbnail_url: `tengyu-local-image://image/${encodeURIComponent(filePath)}`,
    }))
    const resultGroups = [
      {
        template_id: 'template-front',
        template_name: 'front',
        group_index: 0,
        sku_folder: 'SKU-001',
        print_ids: ['SKU-001'],
        outputs: [fixture.outputPaths[0]],
        status: 'completed',
      },
      {
        template_id: 'template-back',
        template_name: 'back',
        group_index: 0,
        sku_folder: 'SKU-001',
        print_ids: ['SKU-001'],
        outputs: [fixture.outputPaths[1]],
        status: 'completed',
      },
      {
        template_id: 'template-front',
        template_name: 'front',
        group_index: 1,
        sku_folder: 'SKU-002',
        print_ids: ['SKU-002'],
        outputs: [fixture.outputPaths[2]],
        status: 'completed',
      },
    ] as const

    ipcMain.removeHandler('photoshop:get-status')
    ipcMain.handle('photoshop:get-status', () => {
      statusCheckCount += 1
      return statusCheckCount === 1
        ? {
            installed: true,
            running: false,
            com_connected: false,
            version: '2025',
            last_check_at: Date.now(),
            error_code: 'PS_NOT_RUNNING',
          }
        : {
            installed: true,
            running: true,
            com_connected: true,
            version: '2025',
            last_check_at: Date.now(),
          }
    })
    ipcMain.removeHandler('photoshop:choose-templates')
    ipcMain.handle('photoshop:choose-templates', () => ({
      ok: true,
      data: { paths: fixture.templatePaths },
    }))
    ipcMain.removeHandler('photoshop:scan-print-folder')
    ipcMain.handle('photoshop:scan-print-folder', () => ({
      folder: fixture.printPaths[0].replace(/[\\/][^\\/]+$/, ''),
      prints,
    }))
    ipcMain.removeHandler('photoshop:scan-template')
    ipcMain.handle('photoshop:scan-template', (_event, value: { psd_path: string }) => ({
      id: value.psd_path.includes('front') ? 'template-front' : 'template-back',
      file_path: value.psd_path,
      file_hash: value.psd_path,
      doc_size: { w: 1200, h: 1200 },
      smart_objects: [
        {
          name: 'Artwork',
          path: 'Artwork',
          sort_order: 0,
          is_top_level: true,
          bounds: [0, 0, 1200, 1200],
          shared_indicator: 'artwork',
        },
      ],
      guides: { horizontal: [], vertical: [] },
      clip_areas: [{ x: 0, y: 0, w: 1200, h: 1200, is_full: true }],
      mode: 'single',
      representative_so_count: 1,
      scanned_at: Date.now(),
      layers: [],
      text_layers: [],
    }))
    ipcMain.removeHandler('photoshop:run-batch')
    ipcMain.handle('photoshop:run-batch', (event) => {
      const taskId = 'photoshop-ui-run'
      event.sender.send('photoshop:progress', {
        task_id: taskId,
        total_groups: 4,
        completed: 1,
        failed: 0,
        skipped: 0,
        current_group: 2,
        current_stage: 'group_start',
        verified_outputs: 1,
        result_group: resultGroups[0],
      })
      event.sender.send('photoshop:log', {
        ts: Date.now(),
        level: 'error',
        stage: 'group_complete',
        task_id: taskId,
        template_name: 'back',
        group: 1,
        sku_folder: 'SKU-002',
        message: '导出失败，请检查智能对象',
        error: 'JSX_EXEC_FAILED',
      })
      event.sender.send('photoshop:progress', {
        task_id: taskId,
        total_groups: 4,
        completed: 3,
        failed: 1,
        skipped: 0,
        current_group: null,
        current_stage: 'task_complete',
        verified_outputs: 3,
        result_group: resultGroups[2],
      })
      return {
        ok: true,
        task_id: taskId,
        output_layout: 'sku_flat',
        log_path: fixture.outputPaths[0].replace(/[\\/][^\\/]+$/, '\\photoshop-ui-run.log'),
        templates_total: 2,
        groups_total: 4,
        groups_completed: 3,
        outputs: fixture.outputPaths,
        templates: [
          {
            template_id: 'template-front',
            template_name: 'front',
            groups_total: 2,
            groups_completed: 2,
            outputs: [fixture.outputPaths[0], fixture.outputPaths[2]],
          },
          {
            template_id: 'template-back',
            template_name: 'back',
            groups_total: 2,
            groups_completed: 1,
            outputs: [fixture.outputPaths[1]],
          },
        ],
        result_groups: resultGroups,
      }
    })
    ipcMain.removeHandler('photoshop:cancel')
    ipcMain.handle('photoshop:cancel', () => ({ ok: true }))
  }, input)
}

async function emitPipelineProgress(app: ElectronApplication, progress: PipelineProgress) {
  await app.evaluate(({ BrowserWindow }, value) => {
    const target = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
    target?.webContents.send('pipeline:progress', value)
  }, progress)
}

async function emitPipelineCompleted(app: ElectronApplication, event: PipelineTaskEvent) {
  await app.evaluate(({ BrowserWindow }, value) => {
    const target = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
    target?.webContents.send('pipeline:completed', value)
  }, event)
}

async function emitPublicModuleEvent(app: ElectronApplication, channel: string, payload: unknown) {
  await app.evaluate(
    ({ BrowserWindow }, input) => {
      const target = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
      target?.webContents.send(input.channel, input.payload)
    },
    { channel, payload },
  )
}

async function installListingWorkspaceHarness(app: ElectronApplication, batchDir: string) {
  await app.evaluate(
    ({ ipcMain }, fixture) => {
      const state = globalThis as typeof globalThis & {
        __listingEvidenceOpenCalls?: number
        __listingStatusRows?: unknown[]
        __listingTasks?: unknown[]
      }
      state.__listingEvidenceOpenCalls = 0
      state.__listingStatusRows = []
      state.__listingTasks = []

      const template = {
        key: 'temu-general',
        platform: 'temu-pop',
        label: 'Temu 百货',
        editUrl: 'https://www.dianxiaomi.com/web/popTemu/edit?id=123456',
        materialRootDir: fixture.batchDir,
        excludedFolderNames: [],
        skuMode: 'one-click-generate',
        uploadVideo: true,
        requiredImageGroups: ['preview'],
      }
      const sheinTemplate = {
        ...template,
        key: 'shein',
        platform: 'shein',
        label: 'Shein',
        editUrl: 'https://www.dianxiaomi.com/web/shein/edit?id=654321',
      }
      const workspace = {
        id: 'workspace-profile-7',
        profile_id: 'profile-7',
        profile_name: 'Temu 主店',
        platform: 'temu-pop',
        status: 'idle',
        current_task_id: null,
        created_at: 1_700_000_000_000,
        updated_at: 1_700_000_000_000,
      }
      const imageGroups = {
        sku: [],
        carousel: [],
        material: [],
        preview: ['C:\\fixtures\\preview.png'],
        description: [],
      }
      const listingItems = ['SKU001', 'SKU002'].map((sku) => ({
        id: `item-${sku}`,
        sku,
        title: `Title ${sku}`,
        platform: 'temu-pop',
        templateKey: 'temu-general',
        editUrl: template.editUrl,
        materialRootDir: fixture.batchDir,
        targetShopName: '',
        imageGroups,
        variantGroups: [],
        videoPaths: [],
      }))

      ipcMain.removeHandler('listing:list-templates')
      ipcMain.handle('listing:list-templates', () => [template, sheinTemplate])
      ipcMain.removeHandler('listing:list-profiles')
      ipcMain.handle('listing:list-profiles', () => [
        { id: 'profile-7', name: 'Temu 主店', seq: 7, status: 1 },
        { id: 'profile-locked', name: '被占用店铺', seq: 8, status: 1 },
      ])
      ipcMain.removeHandler('browser-profile-lock:list')
      ipcMain.handle('browser-profile-lock:list', () => [
        {
          profileId: 'profile-locked',
          module: 'collection',
          taskId: 'collection-lock-1',
          acquiredAt: 1_700_000_000_000,
        },
      ])
      ipcMain.removeHandler('listing:list-saved-workspaces')
      ipcMain.handle('listing:list-saved-workspaces', () => [workspace])
      ipcMain.removeHandler('listing:list-tasks')
      ipcMain.handle('listing:list-tasks', () => state.__listingTasks ?? [])
      ipcMain.removeHandler('listing:save-workspace')
      ipcMain.handle('listing:save-workspace', () => workspace)
      ipcMain.removeHandler('listing:create-task')
      ipcMain.handle('listing:create-task', (_event, input) => {
        const task = {
          id: 'listing-plan-task-1',
          workspace_id: workspace.id,
          platform: 'temu-pop',
          template_key: 'temu-general',
          draft_template_id: '123456',
          shop_name: 'Tengyu Shop',
          batch_dir: fixture.batchDir,
          sku_mode: 'one-click-generate',
          submit_mode: 'save-draft',
          max_attempts: 2,
          fail_streak_limit: 3,
          resume: true,
          status: 'running',
          last_run_task_id: 'listing-ui-run',
          created_at: 1_700_000_000_000,
          updated_at: 1_700_000_000_000,
          ...(typeof input === 'object' && input !== null ? input : {}),
        }
        state.__listingTasks = [task]
        return task
      })
      ipcMain.removeHandler('listing:scan-batch-dir')
      ipcMain.handle('listing:scan-batch-dir', () => ({
        rootDir: fixture.batchDir,
        templateKey: 'temu-general',
        items: listingItems.map((item) => ({
          id: item.id,
          sku: item.sku,
          title: item.title,
          folderName: item.sku,
          folderPath: `${fixture.batchDir}\\${item.sku}`,
          templateKey: 'temu-general',
          imageGroups,
          variantGroups: [],
          videoPaths: [],
        })),
        warnings: [],
        listingItems,
        skuFolderCount: 2,
        titledSkuCount: 2,
      }))
      ipcMain.removeHandler('listing:list-status')
      ipcMain.handle('listing:list-status', () => state.__listingStatusRows ?? [])
      ipcMain.removeHandler('listing:run')
      ipcMain.handle('listing:run', () => 'listing-ui-run')
      ipcMain.removeHandler('listing:open-path')
      ipcMain.handle('listing:open-path', () => {
        state.__listingEvidenceOpenCalls = (state.__listingEvidenceOpenCalls ?? 0) + 1
        return { ok: true }
      })
    },
    { batchDir },
  )
}

async function setListingStatusRows(app: ElectronApplication, rows: unknown[]) {
  await app.evaluate((_electron, nextRows) => {
    const state = globalThis as typeof globalThis & { __listingStatusRows?: unknown[] }
    state.__listingStatusRows = nextRows
  }, rows)
}

async function delayListingStatusResponse(app: ElectronApplication) {
  await app.evaluate(({ ipcMain }) => {
    const state = globalThis as typeof globalThis & {
      __listingStatusPending?: boolean
      __listingStatusRows?: unknown[]
      __resolveListingStatus?: () => void
    }
    ipcMain.removeHandler('listing:list-status')
    ipcMain.handle(
      'listing:list-status',
      () =>
        new Promise((resolve) => {
          state.__listingStatusPending = true
          state.__resolveListingStatus = () => {
            state.__listingStatusPending = false
            resolve(state.__listingStatusRows ?? [])
          }
        }),
    )
  })
}

async function resolveListingStatusResponse(app: ElectronApplication) {
  await app.evaluate(() => {
    const state = globalThis as typeof globalThis & { __resolveListingStatus?: () => void }
    state.__resolveListingStatus?.()
  })
}

function theaterProgress(input: {
  baseUrl: string
  imageCount: number
  status?: PipelineProgress['status']
}): PipelineProgress {
  const now = Date.now()
  return {
    run_id: 'run-most-recently-updated',
    status: input.status ?? 'running',
    current_step: 'matting',
    message: input.status === 'completed' ? '完整任务已完成' : '完整任务流式处理中',
    stats: {
      sourceImages: 0,
      prints: input.imageCount,
      detectionPass: 0,
      detectionReview: 0,
      detectionBlock: 0,
      photoshopGroups: 0,
      titleSucceeded: 0,
      titleFailed: 0,
    },
    steps: [
      {
        id: 'source-running',
        run_id: 'run-most-recently-updated',
        step_key: 'source',
        module: 'pipeline',
        label: '任务起点',
        status: input.status === 'completed' ? 'completed' : 'running',
        input_count: input.imageCount,
        output_count: input.imageCount,
        output_json: null,
        error_json: null,
        started_at: now - 2_000,
        completed_at: input.status === 'completed' ? now : null,
        updated_at: now,
      },
      {
        id: 'matting-running',
        run_id: 'run-most-recently-updated',
        step_key: 'matting',
        module: 'pipeline',
        label: '抠图',
        status: input.status === 'completed' ? 'completed' : 'running',
        input_count: input.imageCount,
        output_count: input.imageCount,
        output_json: null,
        error_json: null,
        started_at: now - 1_000,
        completed_at: input.status === 'completed' ? now : null,
        updated_at: now,
      },
    ],
    items: [
      ...Array.from({ length: input.imageCount }, (_, index) => ({
        id: `print-${index + 1}`,
        run_id: 'run-most-recently-updated',
        item_key: `print-${index + 1}`,
        step_key: 'matting' as const,
        status: 'completed' as const,
        source_path: null,
        output_path: `C:/prints/print-${index + 1}.png`,
        artifact_id: null,
        print_id: `pri_${index + 1}`,
        source_artifact_ids_json: null,
        error_message: null,
        created_at: now - 1_000,
        updated_at: now,
        completed_at: now,
      })),
      {
        id: 'print-failed',
        run_id: 'run-most-recently-updated',
        item_key: 'print-failed',
        step_key: 'matting' as const,
        status: 'failed' as const,
        source_path: 'C:/prints/broken.png',
        output_path: null,
        artifact_id: null,
        print_id: 'pri_failed',
        source_artifact_ids_json: null,
        error_message: '抠图云机拒绝了这一张，请检查工作流输入',
        created_at: now - 1_000,
        updated_at: now,
        completed_at: now,
      },
    ],
    result_sections: [
      {
        key: 'image_processing',
        title: '印花产物',
        total: input.imageCount,
        completed: input.imageCount,
        collapsible: true,
        default_collapsed: false,
        paginated: false,
        items: Array.from({ length: input.imageCount }, (_, index) => ({
          id: `result-${index + 1}`,
          status: 'success' as const,
          step_key: 'matting' as const,
          label: `印花 ${index + 1}`,
          url: `${input.baseUrl}/image/${index + 1}.png`,
        })),
      },
    ],
    logs: Array.from({ length: 4 }, (_, index) => ({
      id: `log-${index + 1}`,
      created_at: now + index,
      level: 'info' as const,
      message: `关键记录 ${index + 1}`,
    })),
  }
}

function completeTaskFixtureConfig(name = 'Most recently updated task') {
  return {
    name,
    printMode: 'local',
    source: {
      mode: 'txt2img',
      provider: 'grsai',
      prompt: { mode: 'ai', requirement: 'fixture prompt', count: 1 },
      grsai: { model: 'gpt-image-2', aspectRatio: '1:1', concurrency: 7 },
    },
    matting: { enabled: true, mode: 'comfyui' },
    detection: { enabled: false },
    photoshop: { enabled: false, templates: [] },
    title: { enabled: false, platform: 'temu', language: 'en', model: 'qwen3.6-flash' },
  } as const
}

function seedRunningCompleteTasks(workbenchRoot: string) {
  const db = openWorkbenchDatabase(workbenchRoot)
  try {
    const insertRun = db.prepare(`
      INSERT INTO pipeline_runs (
        id, name, source_mode, status, config_json, stats_json,
        result_sections_json, logs_json, error_summary, created_at, started_at, completed_at
      ) VALUES (?, ?, 'txt2img', 'running', ?, '{}', '[]', '[]', NULL, ?, ?, NULL)
    `)
    insertRun.run(
      'run-newer-created',
      'Later created task',
      JSON.stringify(completeTaskFixtureConfig('Later created task')),
      200,
      200,
    )
    insertRun.run(
      'run-most-recently-updated',
      'Most recently updated task',
      JSON.stringify(completeTaskFixtureConfig()),
      100,
      100,
    )
    db.prepare(`
      INSERT INTO pipeline_runs (
        id, name, source_mode, status, config_json, stats_json,
        result_sections_json, logs_json, error_summary, created_at, started_at, completed_at
      ) VALUES (?, ?, 'txt2img', 'interrupted', ?, '{}', '[]', '[]', ?, ?, ?, ?)
    `).run(
      'run-interrupted',
      'Interrupted task',
      JSON.stringify(completeTaskFixtureConfig('Interrupted task')),
      'Workbench 退出，已完成产物已保留',
      50,
      50,
      80,
    )
    const insertStep = db.prepare(`
      INSERT INTO pipeline_steps (
        id, run_id, step_key, module, label, status,
        input_count, output_count, output_json, error_json,
        started_at, completed_at, updated_at
      ) VALUES (?, ?, 'source', 'pipeline', '任务起点', 'running', 1, 0, NULL, NULL, ?, NULL, ?)
    `)
    insertStep.run('step-newer-created', 'run-newer-created', 200, 300)
    insertStep.run('step-most-recently-updated', 'run-most-recently-updated', 100, 500)
  } finally {
    db.close()
  }
}

test.describe('production-first Workbench shell', () => {
  let tempRoot = ''
  let app: ElectronApplication | null = null
  let closeMockServer: (() => Promise<void>) | null = null

  test.beforeEach(async () => {
    tempRoot = await mkdtemp(join(tmpdir(), 'tengyu-workbench-shell-e2e-'))
  })

  test.afterEach(async () => {
    if (app) {
      await app.close()
      app = null
    }
    if (closeMockServer) {
      await closeMockServer()
      closeMockServer = null
    }
    await rm(tempRoot, { recursive: true, force: true })
  })

  test('opens the complete-task quick start after authorization and onboarding', async () => {
    const mockServer = await startMockServer()
    closeMockServer = mockServer.close
    app = await launchApp({
      serverUrl: mockServer.baseUrl,
      userDataDir: join(tempRoot, 'user-data-default-entry'),
    })
    const page = await app.firstWindow()

    await enterPreparedWorkbench(page, join(tempRoot, 'workbench'))

    await expect(page).toHaveURL(/#\/pipeline$/)
    await expect(page.getByRole('heading', { name: '完整任务', exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: '启动完整任务' })).toBeVisible()
    await expect(page.locator('[data-content-width="constrained"]')).toBeVisible()
  })

  test('uses the production entry instead of a previously visited tool route', async () => {
    const mockServer = await startMockServer()
    closeMockServer = mockServer.close
    app = await launchApp({
      serverUrl: mockServer.baseUrl,
      userDataDir: join(tempRoot, 'user-data-previous-route'),
    })
    const page = await app.firstWindow()
    await enterPreparedWorkbench(page, join(tempRoot, 'workbench-previous-route'), () =>
      page.evaluate(() => window.localStorage.setItem('tengyu.ui.lastRoute', '/collection')),
    )

    await expect(page).toHaveURL(/#\/pipeline$/)
  })

  test('opens the most recently updated running complete task without resuming it', async () => {
    const mockServer = await startMockServer()
    closeMockServer = mockServer.close
    app = await launchApp({
      serverUrl: mockServer.baseUrl,
      userDataDir: join(tempRoot, 'user-data-running-entry'),
    })
    const page = await app.firstWindow()
    await page.addInitScript(() => {
      const patchPipelineApi = () => {
        if (!window.api?.pipeline) {
          window.setTimeout(patchPipelineApi, 10)
          return
        }
        const originalResume = window.api.pipeline.resume
        window.api.pipeline.resume = async (input) => {
          const state = window as Window & { __workbenchShellResumeCalls?: number }
          state.__workbenchShellResumeCalls = (state.__workbenchShellResumeCalls ?? 0) + 1
          return originalResume(input)
        }
      }
      patchPipelineApi()
    })

    const workbenchRoot = join(tempRoot, 'workbench-running-entry')
    await enterPreparedWorkbench(page, workbenchRoot, () => seedRunningCompleteTasks(workbenchRoot))

    await expect(page).toHaveURL(/#\/pipeline$/)
    await expect(
      page
        .getByText('Most recently updated task', { exact: true })
        .locator('xpath=..')
        .getByText('当前', { exact: true }),
    ).toBeVisible()
    await expect(page.getByText('文生图产出', { exact: true })).toBeVisible()
    await expect(page.getByRole('heading', { name: '成果剧场' })).toBeVisible()
    await expect(page.getByRole('button', { name: '停止任务' })).toBeVisible()
    await expect(page.getByRole('button', { name: '启动完整任务' })).toHaveCount(0)
    await expect(page.getByRole('button', { name: '保存执行方案' })).toHaveCount(0)
    await expect(page.locator('[data-content-width="wide"]')).toBeVisible()

    const taskDock = page.getByRole('complementary', { name: '任务坞' })
    await expect(taskDock.getByText('Most recently updated task', { exact: true })).toBeVisible()
    await expect(taskDock.getByText('Later created task', { exact: true })).toBeVisible()
    await expect(
      taskDock.getByRole('button', { name: '打开完整任务 Most recently updated task' }),
    ).toHaveAttribute('aria-current', 'true')

    await taskDock.getByRole('button', { name: '打开完整任务 Later created task' }).click()
    await expect(page).toHaveURL(/#\/pipeline$/)
    await expect(
      page
        .getByRole('heading', { name: '成果剧场' })
        .locator('xpath=../..')
        .getByText('Later created task', { exact: true }),
    ).toBeVisible()
    await expect(
      taskDock.getByRole('button', { name: '打开完整任务 Later created task' }),
    ).toHaveAttribute('aria-current', 'true')
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            (window as Window & { __workbenchShellResumeCalls?: number })
              .__workbenchShellResumeCalls ?? 0,
        ),
      )
      .toBe(0)

    await page.getByRole('button', { name: '折叠任务坞' }).click()
    await expect(
      taskDock.getByRole('button', { name: '展开任务坞，2 个运行中，1 个异常' }),
    ).toBeVisible()

    await page.reload()
    await expect(
      page
        .getByRole('complementary', { name: '任务坞' })
        .getByRole('button', { name: '展开任务坞，2 个运行中，1 个异常' }),
    ).toBeVisible()
  })

  test('streams the newest result into the theater while isolating item failures', async () => {
    const testInfo = test.info()
    const mockServer = await startMockServer()
    closeMockServer = mockServer.close
    app = await launchApp({
      serverUrl: mockServer.baseUrl,
      userDataDir: join(tempRoot, 'user-data-streaming-theater'),
    })
    const page = await app.firstWindow()
    const workbenchRoot = join(tempRoot, 'workbench-streaming-theater')
    await enterPreparedWorkbench(page, workbenchRoot, () => seedRunningCompleteTasks(workbenchRoot))
    await installPipelineEventHarness(app)

    const canvas = page.getByRole('region', { name: '最终成果主画布' })
    const firstProgress = theaterProgress({ baseUrl: mockServer.baseUrl, imageCount: 1 })
    await expect
      .poll(async () => {
        await emitPipelineProgress(app, firstProgress)
        return canvas.getByRole('img', { name: '印花 1' }).count()
      })
      .toBe(1)
    await expect(page.getByText('关键记录 1', { exact: true })).toHaveCount(0)
    for (const record of ['关键记录 2', '关键记录 3', '关键记录 4']) {
      await expect(page.getByText(record, { exact: true })).toBeVisible()
    }
    await expect(page.getByText('抠图云机拒绝了这一张，请检查工作流输入')).toBeVisible()
    await expect(page.getByRole('heading', { name: '异常项' })).toBeVisible()
    await expect(page.getByText('运行中', { exact: true }).first()).toBeVisible()
    await expect(
      page.getByRole('group', { name: '任务起点阶段' }).getByText('运行', { exact: true }),
    ).toBeVisible()
    await expect(
      page.getByRole('group', { name: '抠图阶段' }).getByText('运行', { exact: true }),
    ).toBeVisible()

    const secondProgress = theaterProgress({ baseUrl: mockServer.baseUrl, imageCount: 2 })
    await expect
      .poll(async () => {
        await emitPipelineProgress(app, secondProgress)
        return canvas.getByRole('img', { name: '印花 2' }).count()
      })
      .toBe(1)
    await page.getByRole('button', { name: '查看 印花 1', exact: true }).focus()
    await page.keyboard.press('Enter')
    await expect(canvas.getByRole('img', { name: '印花 1' })).toBeVisible()
    await page.getByRole('button', { name: '查看 印花 1', exact: true }).focus()
    for (const viewport of [
      { width: 1280, height: 720 },
      { width: 1440, height: 900 },
      { width: 1920, height: 1080 },
    ]) {
      await page.setViewportSize(viewport)
      await attachScreenshot(page, testInfo, `run-theater-${viewport.width}x${viewport.height}`)
    }

    await page.getByRole('button', { name: '停止任务' }).click()
    await expect(page.getByText('已请求取消，当前步骤结束后停止', { exact: true })).toBeVisible()
    const selectedDockTask = page
      .getByRole('complementary', { name: '任务坞' })
      .getByRole('button', { name: '打开完整任务 Most recently updated task' })
    await expect(selectedDockTask.getByText('正在停止', { exact: true })).toBeVisible()
    await expect
      .poll(() =>
        app.evaluate(
          () =>
            (
              globalThis as typeof globalThis & {
                __pipelineCancelCalls?: number
              }
            ).__pipelineCancelCalls ?? 0,
        ),
      )
      .toBe(1)

    await emitPipelineCompleted(app, {
      ok: false,
      run_id: secondProgress.run_id,
      error: '启动资源已失效，请检查后续跑',
    })
    await expect(page.getByText('运行失败', { exact: true })).toBeVisible()
    await expect(selectedDockTask.getByText('失败', { exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: '按此方案再建任务' })).toHaveCount(0)
    await expect(page.getByRole('button', { name: '停止任务' })).toHaveCount(0)

    const completedProgress = theaterProgress({
      baseUrl: mockServer.baseUrl,
      imageCount: 2,
      status: 'completed',
    })
    const now = Date.now()
    const completedEvent: PipelineTaskEvent = {
      ok: true,
      result: {
        run: {
          id: completedProgress.run_id,
          name: 'Most recently updated task',
          source_mode: 'txt2img',
          status: 'completed',
          config_json: JSON.stringify(completeTaskFixtureConfig()),
          stats_json: JSON.stringify(completedProgress.stats),
          result_sections_json: null,
          logs_json: null,
          error_summary: null,
          created_at: now - 3_000,
          started_at: now - 2_000,
          completed_at: now,
        },
        steps: completedProgress.steps,
        items: completedProgress.items,
        result_sections: completedProgress.result_sections,
        logs: completedProgress.logs,
      },
    }
    await emitPipelineCompleted(app, completedEvent)

    await expect(selectedDockTask.getByText('已完成', { exact: true })).toBeVisible()

    await expect(page.getByText('完成战报', { exact: true }).first()).toBeVisible()
    await expect(page.getByText(/部分配置加载失败/)).toHaveCount(0)
    await page.setViewportSize({ width: 1440, height: 900 })
    await attachScreenshot(page, testInfo, 'run-theater-completed-1440x900')
    await page.getByRole('button', { name: '按此方案再建任务' }).click()
    await expect(page.getByRole('button', { name: '启动完整任务' })).toBeVisible()
    await expect(page.getByRole('tab', { name: '文生图' })).toHaveAttribute('data-state', 'active')
    await expect(page.getByRole('button', { name: '点击填写印花要求' })).toBeVisible()
    await expect(page.getByRole('switch', { name: '启用抠图' })).toBeChecked()
    await expect(
      page.getByText('并发', { exact: true }).locator('xpath=..').getByRole('spinbutton'),
    ).toHaveValue('7')
    await expect
      .poll(() =>
        page.evaluate(() => sessionStorage.getItem('tengyu-aipod:full-task:currentRunId')),
      )
      .toBe('null')
    await page.setViewportSize({ width: 1280, height: 720 })
    await attachScreenshot(page, testInfo, 'run-theater-create-another-1280x720')

    await page.getByRole('button', { name: '从中断处继续' }).click()
    await expect
      .poll(() =>
        app.evaluate(
          () =>
            (
              globalThis as typeof globalThis & {
                __pipelineResumeCalls?: number
              }
            ).__pipelineResumeCalls ?? 0,
        ),
      )
      .toBe(1)
  })

  test('groups production, single-step, and support navigation while preserving module routes', async () => {
    const mockServer = await startMockServer()
    closeMockServer = mockServer.close
    app = await launchApp({
      serverUrl: mockServer.baseUrl,
      userDataDir: join(tempRoot, 'user-data-navigation'),
    })
    const page = await app.firstWindow()
    await enterPreparedWorkbench(page, join(tempRoot, 'workbench-navigation'))

    const navigation = page.getByRole('navigation', { name: 'Workbench 主导航' })
    await expect(navigation.getByText('生产', { exact: true })).toBeVisible()
    await expect(navigation.getByText('单步工具', { exact: true })).toBeVisible()
    await expect(navigation.getByText('支持', { exact: true })).toBeVisible()

    await navigation.getByRole('link', { name: '运行记录', exact: true }).click()
    await expect(page.getByText('历史记录', { exact: true })).toBeVisible()
    await expect(page.locator('[data-content-width="wide"]')).toBeVisible()
    await expect(page.getByText('任务名', { exact: true }).filter({ visible: true })).toHaveCount(0)

    const routes = [
      ['完整任务', '/pipeline'],
      ['运行记录', '/pipeline/runs'],
      ['采集', '/collection'],
      ['生图', '/generation'],
      ['侵权检测', '/detection'],
      ['PS 套版', '/photoshop'],
      ['标题生成', '/title'],
      ['上架', '/listing'],
      ['视频生成', '/video'],
      ['设置', '/settings'],
      ['教程', '/tutorial'],
    ] as const

    for (const [label, path] of routes) {
      await navigation.getByRole('link', { name: label, exact: true }).click()
      await expect(page).toHaveURL(new RegExp(`#${path.replace('/', '\\/')}$`))
    }
  })

  test('presents Collection as an image-pool production workspace', async () => {
    const testInfo = test.info()
    const mockServer = await startMockServer()
    closeMockServer = mockServer.close
    app = await launchApp({
      serverUrl: mockServer.baseUrl,
      userDataDir: join(tempRoot, 'user-data-collection-workspace'),
    })
    const page = await app.firstWindow()
    await enterPreparedWorkbench(page, join(tempRoot, 'workbench-collection-workspace'))
    const collectionSession = {
      id: 'collection-workspace-session',
      platform: 'temu',
      profile_id: 'profile-locked',
      mode: 'click',
      status: 'active',
      output_dir: join(tempRoot, 'collection-output'),
      started_at: Date.now(),
    }
    const collectionRecords = Array.from({ length: 21 }, (_, index) => ({
      id: `collection-record-${index + 1}`,
      sessionId: collectionSession.id,
      sourceUrl: `${mockServer.baseUrl}/image/${(index % 2) + 1}`,
      pageUrl: 'https://www.temu.com/search_result.html?search_key=mock',
      savedPath: null,
      status: index === 20 ? 'failed' : 'success',
      reason: index === 20 ? 'HTTP 404' : null,
      createdAt: Date.now() - index,
    }))
    await app.evaluate(
      ({ ipcMain }, input) => {
        let activeSession: typeof input.session | null = input.session
        ipcMain.removeHandler('collection:get-active-session')
        ipcMain.handle('collection:get-active-session', () => activeSession)
        ipcMain.removeHandler('collection:list-records')
        ipcMain.handle('collection:list-records', () => {
          if (!activeSession) {
            throw new Error('completed collection records must remain renderer evidence')
          }
          return input.records
        })
        ipcMain.removeHandler('collection:stop-session')
        ipcMain.handle('collection:stop-session', () => {
          const completed = { ...input.session, ended_at: Date.now(), status: 'completed' }
          activeSession = null
          return completed
        })
      },
      { records: collectionRecords, session: collectionSession },
    )
    await page.setViewportSize({ width: 1440, height: 900 })
    await page
      .getByRole('navigation', { name: 'Workbench 主导航' })
      .getByRole('link', { name: '采集', exact: true })
      .click()

    const tools = page.getByRole('region', { name: '采集工具' })
    const feedback = page.getByRole('region', { name: '采集运行反馈' })
    const imagePool = page.getByRole('region', { name: '图池工作区' })
    const results = page.getByRole('region', { name: '采集结果与异常' })
    await expect(tools).toBeVisible()
    await expect(feedback).toBeVisible()
    await expect(imagePool).toBeVisible()
    await expect(results).toBeVisible()
    await expect(tools.getByRole('button', { name: '停止采集' })).toBeVisible()
    await expect(tools.getByRole('button', { name: '扫描图池' })).toBeVisible()
    await expect(tools.getByRole('button', { name: '下载选中 0' })).toBeVisible()
    await expect(tools.getByLabel('平台')).toBeDisabled()
    await expect(tools.getByLabel('浏览器环境')).toBeDisabled()
    await expect(page.getByRole('button', { name: '高级设置' })).toBeVisible()
    await expect(page.getByRole('button', { name: '采集日志 0' })).toBeVisible()
    await expect(imagePool.getByText('商品页', { exact: true })).toBeVisible()
    await expect(imagePool.getByText('散图', { exact: true })).toBeVisible()
    await expect(results.getByRole('button', { name: '查看失败 1' })).toBeVisible()

    const poolBox = await imagePool.boundingBox()
    expect(poolBox).not.toBeNull()
    expect(poolBox?.height ?? 0).toBeGreaterThanOrEqual(520)

    for (const viewport of [
      { width: 1280, height: 720 },
      { width: 1440, height: 900 },
      { width: 1920, height: 1080 },
    ]) {
      await page.setViewportSize(viewport)
      await tools.scrollIntoViewIfNeeded()
      await attachScreenshot(
        page,
        testInfo,
        `collection-workspace-${viewport.width}x${viewport.height}`,
      )
    }
    await page.setViewportSize({ width: 1440, height: 900 })

    await results.getByRole('button', { name: '查看失败 1' }).click()
    await expect(results.getByText('HTTP 404', { exact: true })).toBeVisible()
    await expect(results.getByRole('button', { name: '重试' })).toBeVisible()

    await tools.getByRole('button', { name: '停止采集' }).click()
    await expect(tools.getByRole('button', { name: '开始采集会话' })).toBeVisible()
    await expect(tools.getByLabel('平台')).toBeEnabled()
    await expect(tools.getByLabel('浏览器环境')).toBeEnabled()
    await expect(results.getByText('HTTP 404', { exact: true })).toBeVisible()
    await expect(results.getByRole('button', { name: '重试' })).toBeDisabled()

    await tools.getByLabel('搜索关键词').fill('保留采集搜索草稿')
    await emitPublicModuleEvent(app, 'collection:event', {
      type: 'session-started',
      session: collectionSession,
    })
    await page
      .getByRole('navigation', { name: 'Workbench 主导航' })
      .getByRole('link', { name: '设置', exact: true })
      .click()
    await page
      .getByRole('complementary', { name: '任务坞' })
      .getByRole('button', { name: '打开轻量任务 采集任务' })
      .click()
    await expect(page).toHaveURL(/#\/collection$/)
    await expect(page.getByLabel('搜索关键词')).toHaveValue('保留采集搜索草稿')
  })

  test('presents Generation as five capability workspaces with distinct provider paths', async () => {
    const testInfo = test.info()
    const mockServer = await startMockServer()
    closeMockServer = mockServer.close
    app = await launchApp({
      serverUrl: mockServer.baseUrl,
      userDataDir: join(tempRoot, 'user-data-generation-workspace'),
    })
    const page = await app.firstWindow()
    await enterPreparedWorkbench(page, join(tempRoot, 'workbench-generation-workspace'))
    await page
      .getByRole('navigation', { name: 'Workbench 主导航' })
      .getByRole('link', { name: '生图', exact: true })
      .click()

    const capabilities = page.getByRole('region', { name: '生图能力' })
    const workspace = page.getByRole('region', { name: '文生图生产工作区' })
    const results = workspace.getByRole('region', { name: '生图结果' })
    await expect(capabilities).toBeVisible()
    for (const capability of ['文生图', '图生图', '提取', '抠图', '提取后抠图']) {
      await expect(capabilities.getByRole('tab', { name: capability, exact: true })).toBeVisible()
    }
    await expect(workspace).toBeVisible()
    await expect(results).toBeVisible()

    const txt2imgMode = workspace.getByRole('group', { name: '文生图提示词方式' })
    await expect(txt2imgMode.getByRole('button', { name: '智能生成提示词' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    const manualPrompt = txt2imgMode.getByRole('button', { name: '自己写提示词' })
    await manualPrompt.focus()
    await page.keyboard.press('Enter')
    await expect(manualPrompt).toHaveAttribute('aria-pressed', 'true')

    const txt2imgPath = workspace.getByRole('group', { name: '文生图生图路径' })
    const launch = workspace.getByRole('complementary', { name: '生图启动与运行' })
    await expect(txt2imgPath.getByRole('button', { name: 'Grsai', exact: true })).toBeVisible()
    await expect(launch.getByLabel('生图模型')).toBeVisible()
    await page.setViewportSize({ width: 1440, height: 900 })
    await attachScreenshot(page, testInfo, 'generation-grsai-txt2img-1440x900', true)
    await txt2imgPath.getByRole('button', { name: 'ComfyUI 工作流' }).click()
    await expect(txt2imgPath.getByRole('button', { name: 'ComfyUI 工作流' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    await expect(launch.getByLabel('文生图工作流')).toBeVisible()
    await expect(launch.getByRole('button', { name: '刷新工作流' })).toBeVisible()
    const machine = workspace.getByRole('region', { name: '运行云机' })
    await expect(machine).toBeVisible()
    await expect(machine.getByRole('button', { name: '刷新' })).toBeVisible()
    await expect(machine.getByRole('button', { name: /开机|关机/ })).toHaveCount(0)
    await page.setViewportSize({ width: 1280, height: 720 })
    await attachScreenshot(page, testInfo, 'generation-comfyui-txt2img-1280x720', true)

    await capabilities.getByRole('tab', { name: '图生图' }).click()
    const img2imgWorkspace = page.getByRole('region', { name: '图生图生产工作区' })
    const provider = img2imgWorkspace.getByRole('group', { name: '图生图实现方式' })
    await expect(provider.getByRole('button', { name: '付费 Grsai', exact: true })).toBeVisible()
    const img2imgMode = img2imgWorkspace.getByRole('group', { name: '图生图生成模式' })
    await expect(img2imgMode.getByRole('button', { name: '参考构图' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    const referenceStyle = img2imgMode.getByRole('button', { name: '参考风格' })
    await referenceStyle.focus()
    await page.keyboard.press('Enter')
    await expect(referenceStyle).toHaveAttribute('aria-pressed', 'true')
    await expect(img2imgWorkspace.getByText('参考图', { exact: true })).toBeVisible()
    await provider.getByRole('button', { name: 'ComfyUI 晨羽' }).click()
    await expect(provider.getByRole('button', { name: 'ComfyUI 晨羽' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    await expect(img2imgWorkspace.getByRole('heading', { name: '图生图图片文件夹' })).toBeVisible()
    await expect(img2imgWorkspace.getByRole('heading', { name: 'ComfyUI 工作流' })).toBeVisible()
    await expect(img2imgWorkspace.getByRole('region', { name: '生图结果' })).toBeVisible()
    await page.setViewportSize({ width: 1920, height: 1080 })
    await attachScreenshot(page, testInfo, 'generation-comfyui-img2img-1920x1080', true)
  })

  test('runs Detection and exposes three risk result buckets with their actions', async () => {
    const testInfo = test.info()
    const mockServer = await startMockServer()
    closeMockServer = mockServer.close
    const detectionApp = await launchApp({
      serverUrl: mockServer.baseUrl,
      userDataDir: join(tempRoot, 'user-data-detection-workspace'),
    })
    app = detectionApp
    const page = await detectionApp.firstWindow()
    const workbenchRoot = join(tempRoot, 'workbench-detection-workspace')
    const detectionInputDir = join(workbenchRoot, '02-印花工作区', '提取')
    await mkdir(detectionInputDir, { recursive: true })
    const detectionImagePaths = [
      join(detectionInputDir, 'pass.png'),
      join(detectionInputDir, 'review.png'),
      join(detectionInputDir, 'block.png'),
    ] as [string, string, string]
    await Promise.all(
      [
        { path: detectionImagePaths[0], background: '#d1fae5' },
        { path: detectionImagePaths[1], background: '#fef3c7' },
        { path: detectionImagePaths[2], background: '#fee2e2' },
      ].map((image) =>
        sharp({ create: { width: 480, height: 360, channels: 3, background: image.background } })
          .png()
          .toFile(image.path),
      ),
    )
    await enterPreparedWorkbench(page, workbenchRoot, () =>
      installDetectionWorkspaceHarness(detectionApp, detectionImagePaths),
    )
    await page
      .getByRole('navigation', { name: 'Workbench 主导航' })
      .getByRole('link', { name: '侵权检测', exact: true })
      .click()

    const workspace = page.getByRole('region', { name: '侵权检测生产工作区' })
    const inputAndRules = workspace.getByRole('region', { name: '检测输入与规则' })
    const launch = workspace.getByRole('complementary', { name: '检测启动与运行' })
    const results = workspace.getByRole('region', { name: '检测结果' })
    await expect(inputAndRules).toBeVisible()
    await expect(launch).toBeVisible()
    await expect(results).toBeVisible()
    await expect(inputAndRules.getByLabel('检测模型')).toHaveValue('qwen3.6-flash')
    await expect(inputAndRules.getByText('无风险 0-20')).toBeVisible()
    await expect(inputAndRules.getByText('疑似 21-60')).toBeVisible()
    await expect(inputAndRules.getByText('高风险 61-100')).toBeVisible()
    const concurrencyInput = inputAndRules.getByLabel('并发')
    await expect(concurrencyInput).toHaveValue('20')
    await concurrencyInput.fill('50')
    await expect(concurrencyInput).toHaveValue('20')

    await inputAndRules.getByRole('button', { name: /提取.*3 张/ }).click()
    await expect(launch.getByText('运行图片')).toBeVisible()
    await expect(launch.getByText('3', { exact: true })).toBeVisible()
    await launch.getByRole('button', { name: '开始检测' }).click()
    await expect(page.getByText('当前任务 detection-ui-run')).toBeVisible()

    await emitPublicModuleEvent(app, 'detection:progress', {
      task_id: 'detection-ui-run',
      processed: 2,
      total: 3,
      succeeded: 2,
      failed: 0,
      skipped: 0,
      concurrency: 4,
      current_image: 'review.png',
      status: 'running',
    })
    await emitPublicModuleEvent(app, 'detection:completed', {
      ok: true,
      result: {
        taskId: 'detection-ui-run',
        total: 3,
        succeeded: 3,
        failed: 0,
        skipped: 0,
        diagnosticsLogPath: 'C:\\logs\\detection-ui-run.jsonl',
        results: [
          {
            imagePath: detectionImagePaths[0],
            thumbnailUrl: '',
            artifactId: 'artifact-pass',
            printId: 'pri_pass',
            status: 'success',
            riskScore: 12,
            riskLevel: 'pass',
            reason: '未发现品牌或角色元素',
            outputPath: 'C:\\workspace\\03-检测工作区\\detection-ui-run\\无风险\\pass.png',
            cached: false,
          },
          {
            imagePath: detectionImagePaths[1],
            thumbnailUrl: '',
            artifactId: 'artifact-review',
            printId: 'pri_review',
            status: 'success',
            riskScore: 48,
            riskLevel: 'review',
            reason: '可能包含相似角色轮廓',
            outputPath: 'C:\\workspace\\03-检测工作区\\detection-ui-run\\疑似\\review.png',
            cached: false,
          },
          {
            imagePath: detectionImagePaths[2],
            thumbnailUrl: '',
            artifactId: 'artifact-block',
            printId: 'pri_block',
            status: 'success',
            riskScore: 88,
            riskLevel: 'block',
            reason: '检测到明确品牌标识',
            outputPath: 'C:\\workspace\\03-检测工作区\\detection-ui-run\\高风险\\block.png',
            cached: false,
          },
        ],
      },
    })

    for (const bucket of ['无风险结果', '疑似结果', '高风险结果']) {
      await expect(results.getByRole('region', { name: bucket })).toBeVisible()
    }
    await expect(results.getByRole('button', { name: '预览 pass.png' })).toBeVisible()
    await expect(results.getByRole('button', { name: '重测 review.png' })).toBeVisible()
    await expect(results.getByRole('button', { name: '删除 block.png' })).toBeVisible()
    await expect(results.getByText('诊断日志：C:\\logs\\detection-ui-run.jsonl')).toBeVisible()

    for (const viewport of [
      { width: 1280, height: 720 },
      { width: 1440, height: 900 },
      { width: 1920, height: 1080 },
    ]) {
      await page.setViewportSize(viewport)
      await workspace
        .getByRole('heading', { name: '侵权检测', exact: true })
        .scrollIntoViewIfNeeded()
      await attachScreenshot(
        page,
        testInfo,
        `detection-config-${viewport.width}x${viewport.height}`,
        true,
      )
      const horizontalOverflow = await page
        .getByRole('main')
        .evaluate((element) => element.scrollWidth - element.clientWidth)
      expect(horizontalOverflow).toBeLessThanOrEqual(1)
      await results.getByRole('heading', { name: '检测结果', exact: true }).scrollIntoViewIfNeeded()
      await attachScreenshot(
        page,
        testInfo,
        `detection-results-${viewport.width}x${viewport.height}`,
        true,
      )
    }

    await results.getByRole('button', { name: '预览 review.png' }).click()
    await expect(page.getByRole('dialog', { name: '侵权检测预览' })).toBeVisible()
    await page.keyboard.press('Escape')
    await results.getByRole('button', { name: '重测 review.png' }).click()
    await expect(page.getByText('当前任务 detection-retest-1')).toBeVisible()
    await emitPublicModuleEvent(app, 'detection:completed', {
      ok: true,
      result: {
        taskId: 'detection-retest-1',
        total: 1,
        succeeded: 1,
        failed: 0,
        skipped: 0,
        diagnosticsLogPath: 'C:\\logs\\detection-retest-1.jsonl',
        results: [
          {
            imagePath: detectionImagePaths[1],
            thumbnailUrl: '',
            artifactId: 'artifact-review',
            printId: 'pri_review',
            status: 'success',
            riskScore: 52,
            riskLevel: 'review',
            reason: '重测后仍需人工判断',
            outputPath: 'C:\\workspace\\03-检测工作区\\detection-retest-1\\疑似\\review.png',
            cached: false,
          },
        ],
      },
    })
    await expect(results.getByRole('button', { name: '预览 pass.png' })).toBeVisible()
    await expect(results.getByRole('button', { name: '预览 block.png' })).toBeVisible()
    await expect(results.getByText('重测后仍需人工判断')).toBeVisible()
    await results.getByRole('button', { name: '加入套版候选清单' }).click()
    await expect(page.getByText('已加入 1 张无风险图片到套版候选清单')).toBeVisible()
    await results.getByRole('button', { name: '删除 block.png' }).click()
    await expect(results.getByRole('region', { name: '高风险结果' }).getByText('0')).toBeVisible()
    const expandTaskDock = page.getByRole('button', { name: /展开任务坞/ })
    if (await expandTaskDock.isVisible()) {
      await expandTaskDock.click()
    }
    const detectionTasks = page
      .getByRole('complementary', { name: '任务坞' })
      .getByRole('button', { name: '打开轻量任务 侵权检测任务' })
    await expect(detectionTasks).toHaveCount(2)
    await expect(detectionTasks.first()).toBeVisible()
  })

  test('runs Photoshop from readiness through standalone batch and SKU results', async () => {
    const testInfo = test.info()
    const mockServer = await startMockServer()
    closeMockServer = mockServer.close
    const photoshopApp = await launchApp({
      serverUrl: mockServer.baseUrl,
      userDataDir: join(tempRoot, 'user-data-photoshop-workspace'),
    })
    app = photoshopApp
    const page = await photoshopApp.firstWindow()
    const workbenchRoot = join(tempRoot, 'workbench-photoshop-workspace')
    const printDir = join(workbenchRoot, '02-印花工作区', '提取')
    const batchDir = join(workbenchRoot, '04-上架工作区', '套版-e2e')
    const printPaths = [join(printDir, 'SKU-001.png'), join(printDir, 'SKU-002.png')] as [
      string,
      string,
    ]
    const outputPaths = [
      join(batchDir, 'SKU-001', 'front-01.jpg'),
      join(batchDir, 'SKU-001', 'back-01.jpg'),
      join(batchDir, 'SKU-002', 'front-01.jpg'),
    ] as [string, string, string]
    const templatePaths = [
      join(workbenchRoot, 'mockups', 'front.psd'),
      join(workbenchRoot, 'mockups', 'back.psd'),
    ] as [string, string]
    await Promise.all([
      mkdir(printDir, { recursive: true }),
      mkdir(join(batchDir, 'SKU-001'), { recursive: true }),
      mkdir(join(batchDir, 'SKU-002'), { recursive: true }),
    ])
    await Promise.all(
      [...printPaths, ...outputPaths].map((path, index) =>
        sharp({
          create: {
            width: 480,
            height: 360,
            channels: 3,
            background: index % 2 === 0 ? '#2563eb' : '#e85d3f',
          },
        })
          .jpeg()
          .toFile(path),
      ),
    )
    await enterPreparedWorkbench(page, workbenchRoot, () =>
      installPhotoshopWorkspaceHarness(photoshopApp, {
        printPaths,
        outputPaths,
        templatePaths,
      }),
    )
    await page
      .getByRole('navigation', { name: 'Workbench 主导航' })
      .getByRole('link', { name: 'PS 套版', exact: true })
      .click()

    const workspace = page.getByRole('region', { name: 'PS 套版生产工作区' })
    const readiness = workspace.getByRole('region', { name: 'Photoshop 就绪状态' })
    const inputAndSettings = workspace.getByRole('region', { name: '套版输入与设置' })
    const launch = workspace.getByRole('complementary', { name: '套版启动与运行' })
    const results = workspace.getByRole('region', { name: '套版结果与异常' })
    await expect(readiness.getByText('Photoshop 状态：已安装 · 未启动')).toBeVisible()
    await expect(inputAndSettings).toBeVisible()
    await expect(launch).toBeVisible()
    await expect(results).toBeVisible()
    await expect(inputAndSettings.getByLabel('替换范围')).toHaveValue('topmost')
    await expect(inputAndSettings.getByLabel('智能对象替换方式')).toHaveValue('replaceContents')
    await expect(inputAndSettings.getByLabel('内部缩放方式')).toHaveValue('fill')
    await expect(inputAndSettings.getByLabel('裁切模式')).toHaveValue('auto')
    await expect(inputAndSettings.getByLabel('导出格式')).toHaveValue('jpg')
    await expect(inputAndSettings.getByLabel('失败重试')).toHaveValue('1')
    await expect(inputAndSettings.getByLabel('跳过已完成')).toBeChecked()

    for (const viewport of [
      { width: 1280, height: 720 },
      { width: 1440, height: 900 },
      { width: 1920, height: 1080 },
    ]) {
      await page.setViewportSize(viewport)
      await workspace
        .getByRole('heading', { name: '模板批量套版与上架图输出' })
        .scrollIntoViewIfNeeded()
      await attachScreenshot(
        page,
        testInfo,
        `photoshop-config-${viewport.width}x${viewport.height}`,
        true,
      )
      const horizontalOverflow = await page
        .getByRole('main')
        .evaluate((element) => element.scrollWidth - element.clientWidth)
      expect(horizontalOverflow).toBeLessThanOrEqual(1)
    }

    await inputAndSettings.getByRole('button', { name: '选择模板' }).click()
    await expect(launch.getByRole('button', { name: '开始套版' })).toBeDisabled()
    await readiness.getByRole('button', { name: '刷新' }).click()
    await expect(readiness.getByText('Photoshop 状态：已连接 · 版本 2025')).toBeVisible()
    await expect(launch.getByRole('button', { name: '开始套版' })).toBeEnabled()
    await launch.getByRole('button', { name: '扫描模板' }).click()
    await expect(launch.getByText('模板数')).toBeVisible()
    await launch.getByRole('button', { name: '开始套版' }).click()

    const batch = results.getByRole('region', { name: '单次套版批次 套版-e2e' })
    await expect(batch).toBeVisible()
    await expect(batch.getByRole('button', { name: '查看 SKU SKU-001，2 张成品图' })).toBeVisible()
    await expect(batch.getByRole('button', { name: '查看 SKU SKU-002，1 张成品图' })).toBeVisible()
    const failures = results.getByRole('region', { name: '套版异常' })
    await expect(failures.getByText('SKU-002')).toBeVisible()
    await expect(failures.getByText('导出失败，请检查智能对象')).toBeVisible()
    await expect(results.getByRole('button', { name: '失败', exact: true })).toHaveCount(0)

    await batch.getByRole('button', { name: '查看 SKU SKU-001，2 张成品图' }).click()
    const resultDialog = page.getByRole('dialog', { name: 'SKU-001 成品图' })
    await expect(
      resultDialog.getByRole('button', { name: '查看成品图 front-01.jpg' }),
    ).toBeVisible()
    await expect(resultDialog.getByRole('button', { name: '查看成品图 back-01.jpg' })).toBeVisible()
    await page.keyboard.press('Escape')

    const expandTaskDock = page.getByRole('button', { name: /展开任务坞/ })
    if (await expandTaskDock.isVisible()) {
      await expandTaskDock.click()
    }
    const taskDock = page.getByRole('complementary', { name: '任务坞' })
    const task = taskDock.getByRole('button', { name: '打开轻量任务 PS 套版任务' })
    await expect(task.getByText('已完成，有失败', { exact: true })).toBeVisible()
    await expect(task.getByText('4 / 4 · 失败 1', { exact: true })).toBeVisible()

    for (const viewport of [
      { width: 1280, height: 720 },
      { width: 1440, height: 900 },
      { width: 1920, height: 1080 },
    ]) {
      await page.setViewportSize(viewport)
      await results.getByRole('heading', { name: '套版结果与异常' }).scrollIntoViewIfNeeded()
      await attachScreenshot(
        page,
        testInfo,
        `photoshop-results-${viewport.width}x${viewport.height}`,
        true,
      )
      const horizontalOverflow = await page
        .getByRole('main')
        .evaluate((element) => element.scrollWidth - element.clientWidth)
      expect(horizontalOverflow).toBeLessThanOrEqual(1)
    }
  })

  test('runs Listing as a dense shop environment and SKU status workspace', async () => {
    const testInfo = test.info()
    const mockServer = await startMockServer()
    closeMockServer = mockServer.close
    const listingApp = await launchApp({
      serverUrl: mockServer.baseUrl,
      userDataDir: join(tempRoot, 'user-data-listing-workspace'),
    })
    app = listingApp
    const page = await listingApp.firstWindow()
    const workbenchRoot = join(tempRoot, 'workbench-listing-workspace')
    const batchDir = join(workbenchRoot, '04-上架工作区', 'listing-e2e')
    await mkdir(batchDir, { recursive: true })
    await enterPreparedWorkbench(page, workbenchRoot, () =>
      installListingWorkspaceHarness(listingApp, batchDir),
    )
    await page
      .getByRole('navigation', { name: 'Workbench 主导航' })
      .getByRole('link', { name: '上架', exact: true })
      .click()

    const workspace = page.getByRole('region', { name: '上架生产工作区' })
    const environments = workspace.getByRole('region', { name: '店铺环境状态' })
    const settings = workspace.getByRole('region', { name: '上架批次与设置' })
    const status = workspace.getByRole('region', { name: '上架运行状态' })
    await expect(environments.getByText('Temu 主店', { exact: true })).toBeVisible()
    await expect(environments.getByText('被采集占用', { exact: true })).toBeVisible()
    await expect(settings).toBeVisible()
    await expect(status.getByRole('table')).toBeVisible()
    await expect(settings.getByLabel('平台').locator('option')).toHaveText(['Temu', 'Shein'])
    await settings.getByRole('button', { name: '高级配置' }).click()
    await expect(settings.getByLabel('断点续传')).toBeChecked()

    await settings.getByLabel('目标店铺名称').fill('Tengyu Shop')
    await settings.getByRole('button', { name: '扫描' }).click()
    await workspace.getByRole('checkbox', { name: /Temu 主店/ }).check()
    await settings.getByRole('button', { name: '开始上架' }).click()

    await emitPublicModuleEvent(listingApp, 'listing:progress', {
      batchId: 'listing-ui-run',
      profileId: 'profile-7',
      status: 'uploading',
      totalCount: 2,
      finishedCount: 0,
      currentSku: 'SKU001',
      currentStage: 'upload_material_images',
    })
    await expect(
      status.getByRole('row', { name: /Temu 主店.*SKU001.*替换图片.*运行中/ }),
    ).toBeVisible()

    await setListingStatusRows(listingApp, [
      {
        id: 'listing-status-1',
        batch_path: batchDir,
        sku_code: 'SKU001',
        platform: 'temu-pop',
        workspace_id: 'profile-7',
        status: 'failed',
        draft_template_id: '123456',
        retry_count: 2,
        last_attempted_at: 1_700_000_000_000,
        last_error_code: 'UPLOAD_COUNT_MISMATCH',
        last_error: '上传图片数量不一致，请检查素材分组',
        evidence_dir: join(batchDir, '.evidence', 'SKU001'),
        created_at: 1_700_000_000_000,
      },
    ])
    await emitPublicModuleEvent(listingApp, 'listing:progress', {
      batchId: 'listing-ui-run',
      profileId: 'profile-7',
      status: 'failed',
      totalCount: 2,
      finishedCount: 1,
      currentSku: 'SKU001',
      currentStage: 'upload_material_images',
      lastError: {
        code: 'UPLOAD_COUNT_MISMATCH',
        appErrorCode: 'PAGE_NOT_READY',
        message: '上传图片数量不一致，请检查素材分组',
        retryable: true,
        stage: 'upload_material_images',
      },
    })

    const failedRow = status.getByRole('row', {
      name: /Temu 主店.*SKU001.*替换图片.*失败.*上传图片数量不一致，请检查素材分组/,
    })
    await expect(failedRow).toBeVisible()
    await expect(failedRow.getByRole('button', { name: '查看证据' })).toBeEnabled()
    await expect(failedRow.getByRole('button', { name: '重试该货号' })).toBeEnabled()
    for (const viewport of [
      { width: 1280, height: 720 },
      { width: 1440, height: 900 },
      { width: 1920, height: 1080 },
    ]) {
      await page.setViewportSize(viewport)
      await status.getByRole('heading', { name: '店铺环境与货号状态' }).scrollIntoViewIfNeeded()
      await attachScreenshot(
        page,
        testInfo,
        `listing-status-${viewport.width}x${viewport.height}`,
        true,
      )
      const horizontalOverflow = await page
        .getByRole('main')
        .evaluate((element) => element.scrollWidth - element.clientWidth)
      expect(horizontalOverflow).toBeLessThanOrEqual(1)
    }
    await failedRow.getByRole('button', { name: '查看证据' }).click()
    await expect
      .poll(() =>
        listingApp.evaluate(() => {
          const state = globalThis as typeof globalThis & { __listingEvidenceOpenCalls?: number }
          return state.__listingEvidenceOpenCalls ?? 0
        }),
      )
      .toBe(1)
    await delayListingStatusResponse(listingApp)
    await emitPublicModuleEvent(listingApp, 'listing:progress', {
      batchId: 'listing-ui-run',
      profileId: 'profile-7',
      status: 'failed',
      totalCount: 2,
      finishedCount: 1,
      currentSku: 'SKU001',
      currentStage: 'upload_material_images',
    })
    await expect
      .poll(() =>
        listingApp.evaluate(() => {
          const state = globalThis as typeof globalThis & { __listingStatusPending?: boolean }
          return state.__listingStatusPending ?? false
        }),
      )
      .toBe(true)
    await settings.getByLabel('货号批次目录').fill(`${batchDir}-next`)
    await resolveListingStatusResponse(listingApp)
    await expect(failedRow).toBeHidden()
    await emitPublicModuleEvent(listingApp, 'listing:progress', {
      batchId: 'listing-ui-run',
      profileId: 'profile-7',
      status: 'uploading',
      totalCount: 2,
      finishedCount: 1,
      currentSku: 'SKU-OLD-PROGRESS',
      currentStage: 'upload_material_images',
    })
    await expect(status.getByText('SKU001', { exact: true })).toHaveCount(0)
    await expect(status.getByText('SKU-OLD-PROGRESS', { exact: true })).toHaveCount(0)
    await emitPublicModuleEvent(listingApp, 'listing:progress', {
      batchId: 'listing-ui-lock',
      profileId: 'profile-locked',
      status: 'failed',
      totalCount: 2,
      finishedCount: 0,
      lastError: {
        code: 'PROFILE_LOCKED',
        appErrorCode: 'PROFILE_LOCKED',
        message: 'profile occupied',
        retryable: false,
        stage: 'enter_page',
      },
    })
    await expect(
      page
        .getByRole('complementary', { name: '任务坞' })
        .getByRole('button', { name: '打开轻量任务 上架任务' })
        .getByText('比特浏览器环境 profile-locked 被占用，请先结束冲突的采集或上架任务', {
          exact: true,
        }),
    ).toBeVisible()
    await emitPublicModuleEvent(listingApp, 'listing:progress', {
      batchId: 'listing-ui-login',
      profileId: 'profile-7',
      status: 'failed',
      totalCount: 2,
      finishedCount: 0,
      lastError: {
        code: 'LOGIN_REQUIRED',
        appErrorCode: 'LOGIN_REQUIRED',
        message: 'login required',
        retryable: false,
        stage: 'enter_page',
      },
    })
    await expect(
      page
        .getByRole('complementary', { name: '任务坞' })
        .getByText('比特浏览器环境 profile-7 需要重新登录店小秘，请登录后重试上架', {
          exact: true,
        }),
    ).toBeVisible()
  })

  test('aggregates current-session lightweight tasks and returns to their preserved module state', async () => {
    const mockServer = await startMockServer()
    closeMockServer = mockServer.close
    app = await launchApp({
      serverUrl: mockServer.baseUrl,
      userDataDir: join(tempRoot, 'user-data-lightweight-task-dock'),
    })
    const page = await app.firstWindow()
    await enterPreparedWorkbench(page, join(tempRoot, 'workbench-lightweight-task-dock'))

    const collectionSession = {
      id: 'collection-session-1',
      platform: 'temu',
      profile_id: 'profile-1',
      mode: 'click',
      status: 'active',
      output_dir: join(tempRoot, 'collection-output'),
      started_at: Date.now(),
    }
    const taskDock = page.getByRole('complementary', { name: '任务坞' })
    const publicEvents = [
      {
        channel: 'collection:event',
        payload: { type: 'session-started', session: collectionSession },
      },
      {
        channel: 'generation:progress',
        payload: {
          task_id: 'generation-1',
          capability: 'img2img',
          processed: 3,
          total: 8,
          succeeded: 2,
          failed: 1,
        },
      },
      {
        channel: 'detection:progress',
        payload: {
          task_id: 'detection-1',
          processed: 4,
          total: 10,
          succeeded: 3,
          failed: 1,
          skipped: 0,
        },
      },
      {
        channel: 'photoshop:progress',
        payload: {
          task_id: 'photoshop-1',
          total_groups: 6,
          completed: 2,
          failed: 1,
          skipped: 0,
          current_group: 4,
          current_stage: 'group_start',
          verified_outputs: 4,
        },
      },
      {
        channel: 'photoshop:log',
        payload: {
          ts: Date.now(),
          level: 'error',
          stage: 'group_complete',
          task_id: 'photoshop-1',
          message: 'Photoshop execution failed',
        },
      },
      {
        channel: 'title:progress',
        payload: {
          task_id: 'title-1',
          processed: 6,
          total: 12,
          succeeded: 5,
          failed: 1,
          skipped: 0,
        },
      },
      {
        channel: 'listing:progress',
        payload: {
          batchId: 'listing-1',
          profileId: 'profile-7',
          status: 'failed',
          totalCount: 20,
          finishedCount: 3,
          lastError: {
            code: 'PROFILE_LOCKED',
            appErrorCode: 'PROFILE_LOCKED',
            message: 'profile occupied',
            retryable: false,
            stage: 'enter_page',
          },
        },
      },
      {
        channel: 'video:completed',
        payload: {
          ok: false,
          task_id: 'video-1',
          mode: 'reference-to-video',
          error: 'quota exceeded',
        },
      },
      {
        channel: 'collection:event',
        payload: {
          type: 'session-paused',
          session: { ...collectionSession, status: 'paused', pause_reason: 'browser_closed' },
          reason: 'browser_closed',
        },
      },
    ]
    const taskTitles = [
      '采集任务',
      '图生图任务',
      '侵权检测任务',
      'PS 套版任务',
      '标题生成任务',
      '上架任务',
      '参考生视频任务',
    ]
    await expect
      .poll(async () => {
        for (const event of publicEvents) {
          await emitPublicModuleEvent(app, event.channel, event.payload)
        }
        return taskDock.getByRole('button', { name: /^打开轻量任务/ }).count()
      })
      .toBe(taskTitles.length)

    for (const title of taskTitles) {
      await expect(taskDock.getByText(title, { exact: true })).toBeVisible()
    }
    await expect(taskDock.getByText('3 / 8 · 失败 1', { exact: true })).toBeVisible()
    await expect(taskDock.getByText('4 / 10 · 失败 1', { exact: true })).toBeVisible()
    await expect(
      taskDock.getByText('比特浏览器已关闭，请重新打开后继续采集', { exact: true }),
    ).toBeVisible()
    await expect(
      taskDock.getByText('比特浏览器环境 profile-7 被占用，请先结束冲突的采集或上架任务', {
        exact: true,
      }),
    ).toBeVisible()
    await expect(
      taskDock
        .getByRole('button', { name: '打开轻量任务 参考生视频任务' })
        .getByText('失败', { exact: true }),
    ).toBeVisible()
    await expect(
      taskDock
        .getByRole('button', { name: '打开轻量任务 PS 套版任务' })
        .getByText('失败', { exact: true }),
    ).toBeVisible()

    await page
      .getByRole('navigation', { name: 'Workbench 主导航' })
      .getByRole('link', {
        name: '标题生成',
        exact: true,
      })
      .click()
    await page.getByLabel('标题额外要求').fill('保留当前标题页状态')
    await page
      .getByRole('navigation', { name: 'Workbench 主导航' })
      .getByRole('link', {
        name: '完整任务',
        exact: true,
      })
      .click()
    await taskDock.getByRole('button', { name: '打开轻量任务 标题生成任务' }).click()
    await expect(page).toHaveURL(/#\/title$/)
    await expect(page.getByLabel('标题额外要求')).toHaveValue('保留当前标题页状态')

    await page.reload()
    await expect(
      page
        .getByRole('complementary', { name: '任务坞' })
        .getByRole('button', { name: '打开轻量任务 标题生成任务' }),
    ).toHaveCount(0)
  })

  test('keeps Settings in the sidebar without duplicating it in the header', async () => {
    const mockServer = await startMockServer()
    closeMockServer = mockServer.close
    app = await launchApp({
      serverUrl: mockServer.baseUrl,
      userDataDir: join(tempRoot, 'user-data-header'),
    })
    const page = await app.firstWindow()
    await enterPreparedWorkbench(page, join(tempRoot, 'workbench-header'))

    await expect(page.getByRole('link', { name: '设置', exact: true })).toHaveCount(1)
    await expect(
      page.getByRole('banner').getByRole('link', { name: '设置', exact: true }),
    ).toHaveCount(0)
  })

  test('keeps the sidebar and task dock responsive, persistent, and keyboard accessible', async () => {
    const testInfo = test.info()
    const mockServer = await startMockServer()
    closeMockServer = mockServer.close
    app = await launchApp({
      serverUrl: mockServer.baseUrl,
      userDataDir: join(tempRoot, 'user-data-responsive-shell'),
    })
    const page = await app.firstWindow()
    const workbenchRoot = join(tempRoot, 'workbench-responsive-shell')
    await enterPreparedWorkbench(page, workbenchRoot, () => seedRunningCompleteTasks(workbenchRoot))

    const navigation = page.getByRole('navigation', { name: 'Workbench 主导航' })
    const sidebar = navigation.locator('xpath=..')
    const taskDock = page.getByRole('complementary', { name: '任务坞' })
    const central = page.locator('[data-workbench-region="central"]')
    const completeTaskLink = navigation.getByRole('link', { name: '完整任务', exact: true })
    await page.setViewportSize({ width: 1440, height: 900 })
    await expect(sidebar).toHaveCSS('width', '188px')
    await expect(taskDock).toHaveCSS('position', 'static')
    await expect(taskDock).toHaveCSS('width', '310px')
    await expect(central).toHaveCSS('width', '942px')
    await expect(completeTaskLink).toBeVisible()
    const expandedLinkTop = (await completeTaskLink.boundingBox())?.y

    await page.setViewportSize({ width: 1280, height: 720 })
    await expect(taskDock).toHaveCSS('position', 'absolute')
    await expect(taskDock).toHaveCSS('right', '0px')
    await expect(central).toHaveCSS('width', '1092px')
    const stopTaskButton = page.getByRole('button', { name: '停止任务' })
    await expect(stopTaskButton).toBeVisible()
    const [stopTaskBox, narrowDockBox] = await Promise.all([
      stopTaskButton.boundingBox(),
      taskDock.boundingBox(),
    ])
    expect(stopTaskBox).not.toBeNull()
    expect(narrowDockBox).not.toBeNull()
    expect((stopTaskBox?.x ?? 0) + (stopTaskBox?.width ?? 0)).toBeLessThanOrEqual(
      narrowDockBox?.x ?? 0,
    )
    await page.keyboard.press('Escape')
    const expandDockButton = taskDock.getByRole('button', {
      name: '展开任务坞，2 个运行中，1 个异常',
    })
    await expect(expandDockButton).toBeVisible()
    await expandDockButton.focus()
    await page.keyboard.press('Enter')
    await expect(taskDock.getByRole('button', { name: '折叠任务坞' })).toBeVisible()

    await page.emulateMedia({ reducedMotion: 'reduce' })
    await expect(
      taskDock.getByRole('button', { name: '打开完整任务 Most recently updated task' }),
    ).toHaveCSS('transition-property', 'none')

    for (const viewport of [
      { width: 1280, height: 720 },
      { width: 1440, height: 900 },
      { width: 1920, height: 1080 },
    ]) {
      await page.setViewportSize(viewport)
      await attachScreenshot(
        page,
        testInfo,
        `shell-task-dock-expanded-${viewport.width}x${viewport.height}`,
      )
    }

    await page.getByRole('button', { name: '折叠任务坞' }).click()
    for (const viewport of [
      { width: 1280, height: 720 },
      { width: 1440, height: 900 },
      { width: 1920, height: 1080 },
    ]) {
      await page.setViewportSize(viewport)
      await expect(taskDock).toHaveCSS('width', '44px')
      await attachScreenshot(
        page,
        testInfo,
        `shell-task-dock-collapsed-${viewport.width}x${viewport.height}`,
      )
    }

    await taskDock.getByRole('button', { name: '展开任务坞，2 个运行中，1 个异常' }).click()
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.getByRole('button', { name: '折叠', exact: true }).click()
    await expect(sidebar).toHaveCSS('width', '56px')
    await expect(completeTaskLink).toBeVisible()
    const collapsedLinkTop = (await completeTaskLink.boundingBox())?.y
    expect(expandedLinkTop).toBeDefined()
    expect(collapsedLinkTop).toBe(expandedLinkTop)
    await expect
      .poll(() => page.evaluate(() => window.localStorage.getItem('tengyu.ui.sidebar.collapsed')))
      .toBe('true')

    await page.reload()
    await expect(
      page.getByRole('navigation', { name: 'Workbench 主导航' }).locator('xpath=..'),
    ).toHaveCSS('width', '56px')
    await expect(page.getByRole('button', { name: '展开侧边栏' })).toBeVisible()

    for (const viewport of [
      { width: 1280, height: 720 },
      { width: 1440, height: 900 },
      { width: 1920, height: 1080 },
    ]) {
      await page.setViewportSize(viewport)
      const regions = await page.evaluate(() => {
        const central = document.querySelector('[data-workbench-region="central"]')
        const dock = document.querySelector('[data-workbench-region="task-dock"]')
        return {
          centralWidth: central?.getBoundingClientRect().width ?? 0,
          dockWidth: dock?.getBoundingClientRect().width ?? -1,
          dockPosition: dock ? getComputedStyle(dock).position : '',
          hasHorizontalOverflow: document.documentElement.scrollWidth > window.innerWidth,
        }
      })
      expect(regions.centralWidth).toBeGreaterThan(0)
      expect(regions.dockWidth).toBe(310)
      expect(regions.dockPosition).toBe(viewport.width < 1400 ? 'absolute' : 'static')
      expect(regions.hasHorizontalOverflow).toBe(false)
    }
  })
})
