import { mkdir, mkdtemp, rm, stat, writeFile } from 'node:fs/promises'
import { type IncomingMessage, type ServerResponse, createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import {
  type ElectronApplication,
  type Page,
  type TestInfo,
  _electron as electron,
  expect,
  test,
} from '@playwright/test'

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
            id: 'cus_workspace_e2e',
            nickname: 'E2E 客户',
            phone: '13800000000',
            php_uid: 10001,
          },
          status: 'active',
        },
      })
      return
    }

    if (url.pathname === '/api/skills') {
      sendJson(response, {
        ok: true,
        data: [
          {
            id: 'txt2img-local-print',
            module: 'generation',
            category: 'txt2img',
            platform: null,
            language: null,
            version: '1.0.0',
            enabled: true,
            recommendedModel: null,
            notes: null,
          },
        ],
      })
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

async function expectDirectory(path: string) {
  await expect(stat(path).then((info) => info.isDirectory())).resolves.toBe(true)
}

function localImageUrl(path: string) {
  return `tengyu-local-image://image/${encodeURIComponent(path)}`
}

async function expectImageLoads(page: Page, path: string) {
  const result = await page.evaluate(
    (src) =>
      new Promise<{ ok: boolean; width: number; height: number }>((resolve) => {
        const image = new Image()
        image.onload = () =>
          resolve({ ok: true, width: image.naturalWidth, height: image.naturalHeight })
        image.onerror = () => resolve({ ok: false, width: 0, height: 0 })
        image.src = src
      }),
    localImageUrl(path),
  )
  expect(result).toEqual({ ok: true, width: 1, height: 1 })
}

async function attachSettingsScreenshot(page: Page, testInfo: TestInfo, name: string) {
  const path = testInfo.outputPath(`${name}.png`)
  await page.screenshot({ path, fullPage: true })
  await testInfo.attach(name, { path, contentType: 'image/png' })
  const horizontalOverflow = await page
    .getByRole('main')
    .evaluate((element) => element.scrollWidth - element.clientWidth)
  expect(horizontalOverflow).toBeLessThanOrEqual(1)
}

async function loginByPhone(page: Page) {
  await page.getByRole('textbox', { name: '手机号' }).fill('13800000000')
  await page.getByRole('button', { name: '发送验证码' }).click()
  await page.getByRole('textbox', { name: '验证码' }).fill('123456')
  await page.getByRole('button', { name: '验证登录' }).click()
  await expect(page.getByRole('button', { name: '全部跳过' })).toBeVisible()
}

test.describe('workspace settings', () => {
  let tempRoot = ''
  let app: ElectronApplication | null = null
  let closeMockServer: (() => Promise<void>) | null = null

  test.beforeEach(async () => {
    tempRoot = await mkdtemp(join(tmpdir(), 'tengyu-workspace-e2e-'))
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

  test('organizes three state-preserving settings views before unlocking production', async () => {
    const testInfo = test.info()
    const mockServer = await startMockServer()
    closeMockServer = mockServer.close
    const userDataDir = join(tempRoot, 'user-data')
    const workspaceRoot = join(tempRoot, 'selected-workspace')
    const previewImagePath = join(workspaceRoot, '02-印花工作区', '文生图', 'preview.png')
    await mkdir(dirname(previewImagePath), { recursive: true })
    await writeFile(
      previewImagePath,
      Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=',
        'base64',
      ),
    )

    app = await electron.launch({
      args: ['out/main/index.js'],
      cwd: process.cwd(),
      timeout: 30_000,
      env: {
        ...process.env,
        NODE_ENV: 'development',
        TENGYU_SERVER_URL: mockServer.baseUrl,
        TENGYU_PHP_AUTH_BASE_URL: mockServer.baseUrl,
        ELECTRON_DISABLE_SECURITY_WARNINGS: 'true',
        TENGYU_ELECTRON_USER_DATA_DIR: userDataDir,
      },
    })
    const page = await app.firstWindow()
    await page.setViewportSize({ width: 1440, height: 900 })

    await loginByPhone(page)
    await page.getByRole('button', { name: '全部跳过' }).click()
    await page.getByRole('button', { name: '开始使用' }).click()
    await expect(page.getByRole('heading', { name: '请先选择工作区' })).toBeVisible()
    await page.getByRole('button', { name: '去设置页选择工作区' }).click()
    const settings = page.getByRole('region', { name: '本机设置' })
    const settingsNavigation = settings.getByRole('tablist', { name: '设置分类' })
    const generalTab = settingsNavigation.getByRole('tab', { name: '常规' })
    const modelsTab = settingsNavigation.getByRole('tab', { name: '模型与工作流' })
    const chenyuTab = settingsNavigation.getByRole('tab', { name: '晨羽智云' })
    await expect(generalTab).toHaveAttribute('aria-selected', 'true')
    await expect(modelsTab).toBeVisible()
    await expect(chenyuTab).toBeVisible()
    const generalPanel = settings.getByRole('tabpanel', { name: '常规' })
    await expect(generalPanel).toBeVisible()
    await generalTab.focus()
    await page.keyboard.press('ArrowRight')
    await expect(modelsTab).toHaveAttribute('aria-selected', 'true')
    await expect(settings.getByRole('tabpanel', { name: '模型与工作流' })).toBeVisible()
    await page.keyboard.press('ArrowLeft')
    await expect(generalTab).toHaveAttribute('aria-selected', 'true')
    await expect(generalPanel).toBeVisible()

    const generalSettings = generalPanel.getByRole('region', { name: '常规设置' })
    await expect(generalSettings.getByText('工作区', { exact: true })).toBeVisible()
    await expect(generalSettings.getByText('比特浏览器', { exact: true })).toBeVisible()
    await expect(generalSettings.getByText('日志', { exact: true })).toBeVisible()
    await attachSettingsScreenshot(page, testInfo, 'settings-general')
    await generalSettings.getByLabel('服务地址').fill('http://127.0.0.1:54346')
    await generalSettings.getByRole('button', { name: '保存地址' }).click()
    await expect(settings.getByText('比特浏览器地址已保存')).toBeVisible()

    await generalSettings.getByLabel('选择工作区').fill(workspaceRoot)
    await modelsTab.click()
    await expect(modelsTab).toHaveAttribute('aria-selected', 'true')
    const modelPanel = settings.getByRole('tabpanel', { name: '模型与工作流' })
    await expect(modelPanel).toBeVisible()
    const modelSettings = modelPanel.getByRole('region', { name: '模型与工作流设置' })
    await expect(modelSettings.getByText('本地生图设置', { exact: true })).toBeVisible()
    await expect(modelSettings.getByText('云端 Skill 同步', { exact: true })).toBeVisible()
    await expect(modelSettings.getByText('本地 Workflow', { exact: true })).toBeVisible()
    await expect(modelSettings.getByText('Skill 缓存', { exact: true })).toBeVisible()
    await expect(modelSettings.getByText('1 条')).toBeVisible()
    await attachSettingsScreenshot(page, testInfo, 'settings-models-and-workflows')
    await modelSettings.getByLabel('Grsai API Key').fill('grsai-settings-e2e')
    await modelSettings.getByLabel('Workflow 文件夹').fill(join(tempRoot, 'workflow-draft'))

    await chenyuTab.click()
    await expect(chenyuTab).toHaveAttribute('aria-selected', 'true')
    const chenyuPanel = settings.getByRole('tabpanel', { name: '晨羽智云' })
    await expect(chenyuPanel).toBeVisible()
    const chenyuSettings = chenyuPanel.getByRole('region', { name: '晨羽智云设置' })
    await expect(chenyuSettings.getByText('连接信息', { exact: true })).toBeVisible()
    await expect(chenyuSettings.getByText('创建云机', { exact: true })).toBeVisible()
    await expect(chenyuSettings.getByText('实例管理', { exact: true })).toBeVisible()
    await expect(chenyuSettings.getByText('高级设置', { exact: true })).toBeVisible()
    await attachSettingsScreenshot(page, testInfo, 'settings-chenyu-cloud')
    await chenyuSettings.getByLabel('晨羽 API Key').fill('chenyu-unsaved-draft')

    await modelsTab.click()
    await expect(modelsTab).toHaveAttribute('aria-selected', 'true')
    await expect(modelSettings.getByLabel('Grsai API Key')).toHaveValue('grsai-settings-e2e')
    await expect(modelSettings.getByLabel('Workflow 文件夹')).toHaveValue(
      join(tempRoot, 'workflow-draft'),
    )
    await modelSettings.getByRole('button', { name: '保存本地设置' }).click()
    await expect(settings.getByText('本地生图设置已保存')).toBeVisible()

    await chenyuTab.click()
    await expect(chenyuTab).toHaveAttribute('aria-selected', 'true')
    await expect(chenyuSettings.getByLabel('晨羽 API Key')).toHaveValue('chenyu-unsaved-draft')
    await generalTab.click()
    await expect(generalTab).toHaveAttribute('aria-selected', 'true')
    await expect(generalSettings.getByLabel('服务地址')).toHaveValue('http://127.0.0.1:54346')
    await expect(generalSettings.getByLabel('选择工作区')).toHaveValue(workspaceRoot)

    await expect(
      page.getByText('选择后会在本地自动创建采集、印花、检测和上架工作区。'),
    ).toBeVisible()
    await expect(page.getByText('素材总目录')).toHaveCount(0)
    await expect(page.getByText('尚未手动同步')).toHaveCount(0)

    await generalSettings.getByRole('button', { name: '保存工作区' }).click()
    await expect(page.getByText('工作区已保存，目录已自动创建')).toBeVisible()
    await expectImageLoads(page, previewImagePath)

    await expectDirectory(join(workspaceRoot, '01-采集工作区'))
    await expectDirectory(join(workspaceRoot, '02-印花工作区', '文生图'))
    await expectDirectory(join(workspaceRoot, '02-印花工作区', '图生图'))
    await expectDirectory(join(workspaceRoot, '02-印花工作区', '提取'))
    await expectDirectory(join(workspaceRoot, '02-印花工作区', '抠图'))
    await expectDirectory(join(workspaceRoot, '03-检测工作区'))
    await expectDirectory(join(workspaceRoot, '04-上架工作区'))
    await expectDirectory(join(workspaceRoot, '.workbench'))

    await page.getByRole('link', { name: '标题生成' }).click()
    await expect(page.getByRole('heading', { name: '请先选择工作区' })).toHaveCount(0)
    await expect(page.getByText('标题生成模块')).toBeVisible()
  })
})
