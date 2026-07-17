import { mkdtemp, rm } from 'node:fs/promises'
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

  test('keeps login, pending authorization, and two-step onboarding accessible', async () => {
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
    await expect(login.getByRole('button', { name: '退出登录' })).toBeVisible()
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
    await expect(onboarding).toContainText('第 1 步，共 2 步')
    await expect(onboarding.locator('[style*="entrance-hero"]')).toHaveCount(0)
    await expect(onboarding.getByRole('button', { name: '测试连接' })).toHaveCount(0)
    const chenyuKey = onboarding.getByLabel('晨羽智云密钥')
    await chenyuKey.focus()
    await expect(chenyuKey).toBeFocused()
    await expectReadableContrast(onboarding.getByRole('heading', { name: '首次设置' }))
    await expectNoHorizontalOverflow(page)
    await attachScreenshot(page, testInfo, 'onboarding-step-one-neutral')

    await onboarding.getByRole('button', { name: '全部跳过' }).click()
    await expect(onboarding).toContainText('第 2 步，共 2 步')
    await expect(onboarding.getByRole('heading', { name: '设置已完成' })).toBeVisible()
    await expect(onboarding).toContainText('进入后默认打开完整任务')
    await onboarding.getByRole('button', { name: '开始使用' }).click()
    await expect(page).toHaveURL(/#\/pipeline$/)
    await expect(page.getByText('完整任务', { exact: true }).first()).toBeVisible()
  })
})
