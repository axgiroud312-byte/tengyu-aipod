import { mkdtemp, rm } from 'node:fs/promises'
import { type IncomingMessage, type ServerResponse, createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { type ElectronApplication, _electron as electron, expect, test } from '@playwright/test'

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
            id: 'cus_e2e',
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
  const app = await electron.launch({
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
  const page = await app.firstWindow()
  return { app, page }
}

async function loginByPhone(page: Awaited<ReturnType<typeof launchApp>>['page']) {
  await page.getByRole('textbox', { name: '手机号' }).fill('13800000000')
  await page.getByRole('button', { name: '发送验证码' }).click()
  await page.getByRole('textbox', { name: '验证码' }).fill('123456')
  await page.getByRole('button', { name: '验证登录' }).click()
  await expect(page.getByRole('button', { name: '全部跳过' })).toBeVisible()
}

test.describe('tutorial page', () => {
  let tempRoot = ''
  let app: ElectronApplication | null = null
  let closeMockServer: (() => Promise<void>) | null = null

  test.beforeEach(async () => {
    tempRoot = await mkdtemp(join(tmpdir(), 'tengyu-tutorial-e2e-'))
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

  test('opens from the sidebar before a workspace is selected', async () => {
    const mockServer = await startMockServer()
    closeMockServer = mockServer.close
    const launched = await launchApp({
      serverUrl: mockServer.baseUrl,
      userDataDir: join(tempRoot, 'user-data-sidebar'),
    })
    app = launched.app
    const page = launched.page

    await loginByPhone(page)
    await page.getByRole('button', { name: '全部跳过' }).click()
    await page.getByRole('button', { name: '开始使用' }).click()
    await expect(page.getByRole('heading', { name: '请先选择工作区' })).toBeVisible()

    await page.getByRole('link', { name: '教程' }).click()

    await expect(page.getByRole('heading', { name: '教程' })).toBeVisible()
    await expect(page.getByRole('button', { name: /开始前准备/ })).toBeVisible()
    await expect(page.getByRole('button', { name: /Temu 采集/ })).toBeVisible()
    await expect(page.getByRole('button', { name: /生图常用三项/ })).toBeVisible()
    await expect(page.getByRole('button', { name: /PS 套版/ })).toBeVisible()
    await expect(page.getByRole('heading', { name: '请先选择工作区' })).toHaveCount(0)
  })

  test('opens from onboarding and loads markdown images', async () => {
    const mockServer = await startMockServer()
    closeMockServer = mockServer.close
    const launched = await launchApp({
      serverUrl: mockServer.baseUrl,
      userDataDir: join(tempRoot, 'user-data-onboarding'),
    })
    app = launched.app
    const page = launched.page

    await loginByPhone(page)
    await page.getByRole('button', { name: '全部跳过' }).click()
    await page.getByRole('button', { name: '查看操作教程' }).click()

    await expect(page.getByRole('heading', { name: '教程' })).toBeVisible()
    await expect(page.getByRole('heading', { level: 1, name: '开始前准备' })).toBeVisible()
    const tutorialImage = page.getByRole('img', { name: '工作区与模块入口概览' })
    await expect
      .poll(() =>
        tutorialImage.evaluate((node) => {
          const image = node as HTMLImageElement
          return image.complete && image.naturalWidth > 0 && image.naturalHeight > 0
        }),
      )
      .toBe(true)
  })
})
