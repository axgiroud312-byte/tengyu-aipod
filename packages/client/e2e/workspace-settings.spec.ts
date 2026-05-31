import { mkdtemp, rm, stat } from 'node:fs/promises'
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
    if (url.pathname === '/api/status') {
      sendJson(response, {
        ok: true,
        data: {
          status: 'active',
          days_remaining: 30,
          max_devices: 2,
          used_devices: 1,
          device_name: 'E2E Mac',
          customer: { name: 'E2E', has_contact: true },
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

async function expectDirectory(path: string) {
  await expect(stat(path).then((info) => info.isDirectory())).resolves.toBe(true)
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

    app = await electron.launch({
      args: ['out/main/index.js'],
      cwd: process.cwd(),
      timeout: 30_000,
      env: {
        ...process.env,
        NODE_ENV: 'development',
        TENGYU_DEV_SKIP_ACTIVATION: '1',
        TENGYU_SERVER_URL: mockServer.baseUrl,
        ELECTRON_DISABLE_SECURITY_WARNINGS: 'true',
        TENGYU_ELECTRON_USER_DATA_DIR: userDataDir,
      },
    })
    const page = await app.firstWindow()

    await expect(page.getByRole('heading', { name: '请先选择工作区' })).toBeVisible()
    await page.getByRole('button', { name: '去设置页选择工作区' }).click()
    await expect(
      page.getByText('选择后会在本地自动创建采集、印花、检测和上架工作区。'),
    ).toBeVisible()
    await expect(page.getByText('素材总目录')).toHaveCount(0)

    await page.getByRole('textbox', { name: /选择工作区/ }).fill(workspaceRoot)
    await page.getByRole('button', { name: '保存工作区' }).click()
    await expect(page.getByText('工作区已保存，目录已自动创建')).toBeVisible()

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
