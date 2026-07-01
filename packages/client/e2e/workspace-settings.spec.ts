import { mkdir, mkdtemp, rm, stat, writeFile } from 'node:fs/promises'
import { type IncomingMessage, type ServerResponse, createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import {
  type ElectronApplication,
  type Page,
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

  test('blocks production modules until a workspace is selected in settings', async () => {
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

    await loginByPhone(page)
    await page.getByRole('button', { name: '全部跳过' }).click()
    await page.getByRole('button', { name: '开始使用' }).click()
    await expect(page.getByRole('heading', { name: '请先选择工作区' })).toBeVisible()
    await page.getByRole('button', { name: '去设置页选择工作区' }).click()
    await expect(
      page.getByText('选择后会在本地自动创建采集、印花、检测和上架工作区。'),
    ).toBeVisible()
    await expect(page.getByText('素材总目录')).toHaveCount(0)
    await expect(page.getByText('Skill 缓存')).toBeVisible()
    await expect(page.getByText('1 条')).toBeVisible()
    await expect(page.getByText('尚未手动同步')).toHaveCount(0)

    await page.getByRole('textbox', { name: /选择工作区/ }).fill(workspaceRoot)
    await page.getByRole('button', { name: '保存工作区' }).click()
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
