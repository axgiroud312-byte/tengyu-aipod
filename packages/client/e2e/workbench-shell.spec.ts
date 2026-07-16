import { mkdtemp, rm } from 'node:fs/promises'
import { type IncomingMessage, type ServerResponse, createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { type ElectronApplication, _electron as electron, expect, test } from '@playwright/test'
import type { PipelineProgress, PipelineTaskEvent } from '@tengyu-aipod/shared'
import sharp from 'sharp'
import { openCollectionDatabase as openWorkbenchDatabase } from '../src/main/lib/collection-record-store'

function sendJson(response: ServerResponse, body: unknown, status = 200) {
  response.writeHead(status, { 'content-type': 'application/json' })
  response.end(JSON.stringify(body))
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
    const attachScreenshot = async (name: string) => {
      const path = testInfo.outputPath(`${name}.png`)
      await page.screenshot({ path })
      await testInfo.attach(name, { path, contentType: 'image/png' })
    }
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
      await attachScreenshot(`run-theater-${viewport.width}x${viewport.height}`)
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
    await attachScreenshot('run-theater-completed-1440x900')
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
    await attachScreenshot('run-theater-create-another-1280x720')

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
    const attachScreenshot = async (name: string) => {
      const path = testInfo.outputPath(`${name}.png`)
      await page.screenshot({ path })
      await testInfo.attach(name, { path, contentType: 'image/png' })
    }
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
      await attachScreenshot(`collection-workspace-${viewport.width}x${viewport.height}`)
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
    const attachScreenshot = async (
      page: Awaited<ReturnType<ElectronApplication['firstWindow']>>,
      name: string,
    ) => {
      const path = testInfo.outputPath(`${name}.png`)
      await page.screenshot({ path })
      await testInfo.attach(name, { path, contentType: 'image/png' })
    }
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
      await attachScreenshot(page, `shell-task-dock-expanded-${viewport.width}x${viewport.height}`)
    }

    await page.getByRole('button', { name: '折叠任务坞' }).click()
    for (const viewport of [
      { width: 1280, height: 720 },
      { width: 1440, height: 900 },
      { width: 1920, height: 1080 },
    ]) {
      await page.setViewportSize(viewport)
      await expect(taskDock).toHaveCSS('width', '44px')
      await attachScreenshot(page, `shell-task-dock-collapsed-${viewport.width}x${viewport.height}`)
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
