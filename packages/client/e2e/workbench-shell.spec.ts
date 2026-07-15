import { mkdtemp, rm } from 'node:fs/promises'
import { type IncomingMessage, type ServerResponse, createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { type ElectronApplication, _electron as electron, expect, test } from '@playwright/test'
import { openCollectionDatabase as openWorkbenchDatabase } from '../src/main/lib/collection-record-store'

function sendJson(response: ServerResponse, body: unknown, status = 200) {
  response.writeHead(status, { 'content-type': 'application/json' })
  response.end(JSON.stringify(body))
}

async function startMockServer() {
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

function seedRunningCompleteTasks(workbenchRoot: string) {
  const db = openWorkbenchDatabase(workbenchRoot)
  try {
    const configJson = JSON.stringify({
      printMode: 'local',
      source: {
        mode: 'txt2img',
        provider: 'grsai',
        prompt: { mode: 'ai', requirement: 'fixture prompt', count: 1 },
        grsai: { model: 'gpt-image-2', aspectRatio: '1:1' },
      },
      matting: { enabled: false, mode: 'comfyui' },
      detection: { enabled: false },
      photoshop: { enabled: false, templates: [] },
      title: { enabled: false, platform: 'temu', language: 'en', model: 'qwen3.6-flash' },
    })
    const insertRun = db.prepare(`
      INSERT INTO pipeline_runs (
        id, name, source_mode, status, config_json, stats_json,
        result_sections_json, logs_json, error_summary, created_at, started_at, completed_at
      ) VALUES (?, ?, 'txt2img', 'running', ?, '{}', '[]', '[]', NULL, ?, ?, NULL)
    `)
    insertRun.run('run-newer-created', 'Later created task', configJson, 200, 200)
    insertRun.run('run-most-recently-updated', 'Most recently updated task', configJson, 100, 100)
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
    await expect(page.locator('[data-content-width="wide"]')).toBeVisible()
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            (window as Window & { __workbenchShellResumeCalls?: number })
              .__workbenchShellResumeCalls ?? 0,
        ),
      )
      .toBe(0)
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

  test('persists stable sidebar dimensions and keeps responsive work regions usable', async () => {
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
    await enterPreparedWorkbench(page, join(tempRoot, 'workbench-responsive-shell'))

    const sidebar = page.getByRole('complementary')
    const completeTaskLink = page
      .getByRole('navigation', { name: 'Workbench 主导航' })
      .getByRole('link', { name: '完整任务', exact: true })
    await page.setViewportSize({ width: 1440, height: 900 })
    await expect(sidebar).toHaveCSS('width', '188px')
    await expect(completeTaskLink).toBeVisible()
    const expandedLinkTop = (await completeTaskLink.boundingBox())?.y
    await attachScreenshot(page, 'shell-expanded-1440x900')
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
    await expect(page.getByRole('complementary')).toHaveCSS('width', '56px')
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
          hasHorizontalOverflow: document.documentElement.scrollWidth > window.innerWidth,
        }
      })
      expect(regions.centralWidth).toBeGreaterThan(0)
      expect(regions.dockWidth).toBe(0)
      expect(regions.hasHorizontalOverflow).toBe(false)
      await attachScreenshot(page, `shell-collapsed-${viewport.width}x${viewport.height}`)
    }
  })
})
