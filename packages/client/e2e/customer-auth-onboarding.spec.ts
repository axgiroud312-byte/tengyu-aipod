import { access, mkdtemp, rm } from 'node:fs/promises'
import { type IncomingMessage, type ServerResponse, createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  type ElectronApplication,
  type Locator,
  type Page,
  type TestInfo,
  _electron as electron,
  expect,
  test,
} from '@playwright/test'

type AuthorizationStatus = 'pending' | 'active'

function sendJson(response: ServerResponse, body: unknown, status = 200) {
  response.writeHead(status, { 'content-type': 'application/json' })
  response.end(JSON.stringify(body))
}

async function startMockServer() {
  let authorizationStatus: AuthorizationStatus = 'pending'
  let verificationDelayMs = 0
  const server = createServer((request: IncomingMessage, response: ServerResponse) => {
    const url = new URL(request.url ?? '/', 'http://127.0.0.1')
    if (url.pathname === '/user/public/send_login_sms') {
      sendJson(response, { status: 1, info: '验证码已发送', data: {} })
      return
    }
    if (url.pathname === '/user/public/login') {
      sendJson(response, {
        status: 1,
        info: 'ok',
        data: { secret: 'php-secret-must-stay-in-main', uid: 10001 },
      })
      return
    }
    if (url.pathname === '/api/customer-auth/verify') {
      const delay = verificationDelayMs
      verificationDelayMs = 0
      const sendVerification = () =>
        sendJson(response, {
          ok: true,
          data: {
            customer: {
              account: 'e2e',
              avatar_url: null,
              expires_at: '2099-12-31T00:00:00.000Z',
              id: 'cus_auth_e2e',
              nickname: 'E2E 客户',
              phone: '13800000000',
              php_uid: 10001,
            },
            status: authorizationStatus,
          },
        })
      if (delay > 0) {
        setTimeout(sendVerification, delay)
      } else {
        sendVerification()
      }
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
    authorize: () => {
      authorizationStatus = 'active'
    },
    delayNextVerification: (delayMs: number) => {
      verificationDelayMs = delayMs
    },
  }
}

async function installWechatHarness(app: ElectronApplication) {
  await app.evaluate(({ ipcMain }) => {
    const state = globalThis as typeof globalThis & {
      __resolveWechatStart?: () => void
      __wechatCheckCalls?: number
    }
    state.__wechatCheckCalls = 0
    ipcMain.removeHandler('customerAuth:startWechatLogin')
    ipcMain.handle(
      'customerAuth:startWechatLogin',
      () =>
        new Promise((resolve) => {
          state.__resolveWechatStart = () =>
            resolve({
              qrcode_url: 'https://open.weixin.qq.com/connect/qrconnect?state=e2e',
              token: 'wechat-e2e-token',
            })
        }),
    )
    ipcMain.removeHandler('customerAuth:checkWechatLogin')
    ipcMain.handle('customerAuth:checkWechatLogin', () => {
      state.__wechatCheckCalls = (state.__wechatCheckCalls ?? 0) + 1
      return { customer: null, message: '等待微信确认', status: 'anonymous' }
    })
  })
}

async function resolveWechatStart(app: ElectronApplication) {
  await app.evaluate(() => {
    const state = globalThis as typeof globalThis & { __resolveWechatStart?: () => void }
    state.__resolveWechatStart?.()
  })
}

async function installOnboardingHarness(app: ElectronApplication, selectedRoot: string) {
  await app.evaluate(({ ipcMain }, root) => {
    ipcMain.removeHandler('onboarding:choose-workbench-root')
    ipcMain.handle('onboarding:choose-workbench-root', () => ({
      ok: true,
      data: { path: root },
    }))
    ipcMain.removeHandler('onboarding:test-bit-browser')
    ipcMain.handle('onboarding:test-bit-browser', () => ({ ok: true, profile_count: 2 }))
  }, selectedRoot)
}

async function attachScreenshot(page: Page, testInfo: TestInfo, name: string) {
  const path = testInfo.outputPath(`${name}.png`)
  await page.screenshot({ path, fullPage: true })
  await testInfo.attach(name, { path, contentType: 'image/png' })
}

async function expectNoHorizontalOverflow(page: Page) {
  const hasOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
  )
  expect(hasOverflow).toBe(false)
}

async function expectReadableContrast(locator: Locator) {
  const ratio = await locator.evaluate((element) => {
    function rgba(value: string) {
      const parts = value.match(/[\d.]+/g)?.map(Number) ?? []
      if (value.startsWith('oklch')) {
        const [lightness = 0, chroma = 0, hue = 0, alpha = 1] = parts
        const hueRadians = (hue * Math.PI) / 180
        const a = chroma * Math.cos(hueRadians)
        const b = chroma * Math.sin(hueRadians)
        const lRoot = lightness + 0.3963377774 * a + 0.2158037573 * b
        const mRoot = lightness - 0.1055613458 * a - 0.0638541728 * b
        const sRoot = lightness - 0.0894841775 * a - 1.291485548 * b
        const l = lRoot ** 3
        const m = mRoot ** 3
        const s = sRoot ** 3
        const linear = [
          4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
          -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
          -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
        ]
        const srgb = linear.map((channel) => {
          const encoded =
            channel <= 0.0031308 ? 12.92 * channel : 1.055 * channel ** (1 / 2.4) - 0.055
          return Math.min(1, Math.max(0, encoded)) * 255
        })
        return { r: srgb[0] ?? 0, g: srgb[1] ?? 0, b: srgb[2] ?? 0, a: alpha }
      }
      return {
        r: parts[0] ?? 0,
        g: parts[1] ?? 0,
        b: parts[2] ?? 0,
        a: parts[3] ?? 1,
      }
    }
    function luminance(channel: number) {
      const value = channel / 255
      return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
    }
    const foreground = rgba(getComputedStyle(element).color)
    let current: Element | null = element
    let background = { r: 255, g: 255, b: 255, a: 1 }
    while (current) {
      const candidate = rgba(getComputedStyle(current).backgroundColor)
      if (candidate.a >= 0.99) {
        background = candidate
        break
      }
      current = current.parentElement
    }
    const foregroundLuminance =
      0.2126 * luminance(foreground.r) +
      0.7152 * luminance(foreground.g) +
      0.0722 * luminance(foreground.b)
    const backgroundLuminance =
      0.2126 * luminance(background.r) +
      0.7152 * luminance(background.g) +
      0.0722 * luminance(background.b)
    return (
      (Math.max(foregroundLuminance, backgroundLuminance) + 0.05) /
      (Math.min(foregroundLuminance, backgroundLuminance) + 0.05)
    )
  })
  expect(ratio).toBeGreaterThanOrEqual(4.5)
}

test.describe('customer auth and onboarding', () => {
  let app: ElectronApplication | null = null
  let closeMockServer: (() => Promise<void>) | null = null
  let tempRoot = ''

  test.beforeEach(async () => {
    tempRoot = await mkdtemp(join(tmpdir(), 'tengyu-auth-onboarding-e2e-'))
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

  test('keeps login, pending authorization, and three-step onboarding accessible', async () => {
    const testInfo = test.info()
    const mockServer = await startMockServer()
    closeMockServer = mockServer.close
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
        TENGYU_ELECTRON_USER_DATA_DIR: join(tempRoot, 'user-data'),
      },
    })
    const page = await app.firstWindow()
    const selectedWorkbenchRoot = join(tempRoot, 'selected-workbench')
    await installOnboardingHarness(app, selectedWorkbenchRoot)
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.emulateMedia({ reducedMotion: 'reduce' })

    const login = page.getByRole('main', { name: '客户登录' })
    await expect(login.getByRole('heading', { name: '客户登录' })).toBeVisible()
    await installWechatHarness(app)
    await expect(login.locator('[style*="entrance-hero"]')).toHaveCount(0)
    await expect(login.getByRole('button', { name: '打开微信登录页' })).toBeVisible()
    await expect(login.getByRole('textbox', { name: '手机号' })).toBeVisible()
    await expectReadableContrast(login.getByRole('heading', { name: '客户登录' }))
    await expectNoHorizontalOverflow(page)
    await attachScreenshot(page, testInfo, 'customer-login-neutral')

    const wechatButton = login.getByRole('button', { name: '打开微信登录页' })
    await wechatButton.focus()
    await expect(wechatButton).toBeFocused()
    await wechatButton.click()
    const wechatSpinner = wechatButton.locator('.animate-spin')
    await expect(wechatSpinner).toBeVisible()
    await expect
      .poll(() => wechatSpinner.evaluate((element) => getComputedStyle(element).animationName))
      .toBe('none')
    await resolveWechatStart(app)
    await expect(login.getByText(/等待微信确认/)).toBeVisible()
    await expect
      .poll(() =>
        app?.evaluate(() => {
          const state = globalThis as typeof globalThis & { __wechatCheckCalls?: number }
          return state.__wechatCheckCalls ?? 0
        }),
      )
      .toBeGreaterThan(0)

    await login.getByRole('textbox', { name: '手机号' }).fill('13800000000')
    await login.getByRole('button', { name: '发送验证码' }).click()
    await expect(login.getByText('验证码已发送', { exact: true })).toBeVisible()
    await login.getByRole('textbox', { name: '验证码' }).fill('123456')
    await login.getByRole('button', { name: '验证登录', exact: true }).click()

    const authorization = login.getByRole('status', { name: '账号授权状态' })
    await expect(authorization.getByText('等待开通', { exact: true })).toBeVisible()
    await expect(authorization).toContainText('页面会自动检查')
    await expectReadableContrast(authorization)
    const retryButton = login.getByRole('button', { name: '重新校验' })
    const logoutButton = login.getByRole('button', { name: '退出登录' })
    await retryButton.focus()
    await expect(retryButton).toBeFocused()
    await page.keyboard.press('Tab')
    await expect(logoutButton).toBeFocused()
    mockServer.delayNextVerification(250)
    await retryButton.click()
    const pendingSpinner = authorization.locator('.animate-spin')
    await expect(pendingSpinner).toBeVisible()
    await expect
      .poll(() => pendingSpinner.evaluate((element) => getComputedStyle(element).animationName))
      .toBe('none')
    await expect(pendingSpinner).toBeHidden()
    await expect(page.locator('body')).not.toContainText('php-secret-must-stay-in-main')
    const rendererState = await page.evaluate(() => window.api.customerAuth.getState())
    expect(JSON.stringify(rendererState)).not.toContain('php-secret-must-stay-in-main')
    await expectNoHorizontalOverflow(page)
    await attachScreenshot(page, testInfo, 'customer-authorization-pending')

    mockServer.authorize()
    const onboarding = page.getByRole('main', { name: '首次设置' })
    await expect(onboarding.getByRole('heading', { name: '首次设置' })).toBeVisible({
      timeout: 7_000,
    })
    await expect(onboarding).toContainText('第 1 步，共 3 步')
    await expect(onboarding.locator('[style*="entrance-hero"]')).toHaveCount(0)
    await expect(onboarding.getByRole('button', { name: '测试连接' })).toHaveCount(0)
    const onboardingProgress = onboarding.getByRole('progressbar', { name: '设置进度' })
    await expect(onboardingProgress).toHaveAttribute('aria-valuenow', '33')
    await expect
      .poll(() =>
        onboardingProgress
          .locator(':scope > div')
          .evaluate((element) => getComputedStyle(element).transitionProperty),
      )
      .toBe('none')
    const saveWorkspaceButton = onboarding.getByRole('button', { name: '保存并继续' })
    await expect(saveWorkspaceButton).toBeDisabled()
    await expect(onboarding.getByRole('button', { name: '选择工作区' })).toBeVisible()
    await onboarding.getByRole('button', { name: '选择工作区' }).click()
    await expect(onboarding.getByText(selectedWorkbenchRoot, { exact: true })).toBeVisible()
    await expect(saveWorkspaceButton).toBeEnabled()
    await expectNoHorizontalOverflow(page)
    await attachScreenshot(page, testInfo, 'onboarding-step-one-workspace')
    await saveWorkspaceButton.click()

    await expect(onboarding).toContainText('第 2 步，共 3 步')
    await expect(onboardingProgress).toHaveAttribute('aria-valuenow', '67')
    await expect(onboarding).toContainText('第 2 步，共 3 步 · 服务连接')
    const stepRail = onboarding.getByRole('complementary', { name: '设置步骤' })
    await expect(stepRail).not.toContainText('共 3 步')
    await expect(stepRail.getByText('服务连接', { exact: true })).toBeVisible()
    await expect(onboarding.getByRole('group', { name: 'AI 服务' })).toBeVisible()
    await expect(onboarding.getByRole('group', { name: '浏览器连接' })).toBeVisible()
    await expect(onboarding.getByRole('button', { name: /^跳过/ })).toHaveCount(0)
    await expect(onboarding.getByRole('button', { name: '全部跳过' })).toHaveCount(0)
    await expect(onboarding.getByRole('button', { name: '稍后设置' })).toBeVisible()
    const bitBrowserUrl = onboarding.getByLabel('比特浏览器地址', { exact: true })
    await bitBrowserUrl.fill('http://127.0.0.1:54345')
    await onboarding.getByRole('button', { name: '测试连接' }).click()
    await expect(
      onboarding.getByText('连接成功，已读取 2 个浏览器档案', { exact: true }),
    ).toBeVisible()
    const chenyuKey = onboarding.getByLabel('晨羽智云密钥', { exact: true })
    await chenyuKey.fill('sk-must-be-discarded')
    await chenyuKey.focus()
    await expect(chenyuKey).toBeFocused()
    const currentStep = stepRail.locator('[aria-current="step"]')
    await expect
      .poll(() => currentStep.evaluate((element) => getComputedStyle(element).transitionProperty))
      .toBe('none')
    await expectReadableContrast(onboarding.getByRole('heading', { name: '首次设置' }))
    await expectNoHorizontalOverflow(page)
    await attachScreenshot(page, testInfo, 'onboarding-step-two-neutral')

    await onboarding.getByRole('button', { name: '稍后设置' }).click()
    await expect(onboarding).toContainText('第 3 步，共 3 步')
    await expect(onboarding.getByRole('heading', { name: '设置已完成' })).toBeVisible()
    await expect(onboarding).toContainText('进入后默认打开完整任务')
    await expect.poll(() => page.evaluate(() => window.api.keychain.has('chenyu'))).toBe(false)
    await expect
      .poll(() => page.evaluate(() => window.api.keychain.has('bit_browser_url')))
      .toBe(false)

    await page.goBack()
    await expect(onboarding).toContainText('第 2 步，共 3 步')
    await expect(onboarding.getByLabel('晨羽智云密钥', { exact: true })).toHaveValue('')
    await expect(onboarding.getByLabel('比特浏览器地址', { exact: true })).toHaveValue('')
    await onboarding.getByLabel('Grsai 密钥', { exact: true }).fill('sk-grsai-e2e')
    await onboarding.getByRole('button', { name: '保存并继续' }).click()
    await expect(onboarding).toContainText('第 3 步，共 3 步')
    await expect.poll(() => page.evaluate(() => window.api.keychain.has('grsai'))).toBe(true)

    const onboardingState = await page.evaluate(() => window.api.onboarding.getState())
    expect(onboardingState.workbench_root).toBe(selectedWorkbenchRoot)
    await Promise.all(
      [
        '01-采集工作区',
        '02-印花工作区',
        '03-检测工作区',
        '04-上架工作区',
        '05-视频工作区',
        '.workbench',
      ].map((directory) => access(join(selectedWorkbenchRoot, directory))),
    )
    await onboarding.getByRole('button', { name: '开始使用' }).click()
    await expect(page).toHaveURL(/#\/pipeline$/)
    await expect(page.getByText('完整任务', { exact: true }).first()).toBeVisible()
  })
})
