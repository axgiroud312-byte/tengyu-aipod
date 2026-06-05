import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { type IncomingMessage, type ServerResponse, createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  type ElectronApplication,
  type Page,
  _electron as electron,
  expect,
  test,
} from '@playwright/test'
import ExcelJS from 'exceljs'
import sharp from 'sharp'

const titleSkill = {
  id: 'title-temu-en-e2e',
  module: 'title',
  category: null,
  platform: 'temu_pop',
  language: 'en',
  version: '1.0.0',
  enabled: true,
  recommendedModel: 'qwen3.6-flash',
  notes: null,
  systemPrompt: 'Write a marketplace title. Output only the title.',
  variables: [],
}

type MockState = {
  bailianCalls: number
  failFirstBailianCall: boolean
}

async function jsonBody(request: IncomingMessage) {
  const chunks: Buffer[] = []
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  }
  return chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : null
}

function sendJson(response: ServerResponse, body: unknown, status = 200) {
  response.writeHead(status, { 'content-type': 'application/json' })
  response.end(JSON.stringify(body))
}

async function startMockServer(state: MockState) {
  const server = createServer(async (request, response) => {
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
            id: 'cus_title_e2e',
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
      sendJson(response, { ok: true, data: [titleSkill] })
      return
    }

    if (url.pathname === `/api/skills/${titleSkill.id}`) {
      sendJson(response, { ok: true, data: titleSkill })
      return
    }

    if (url.pathname === '/compatible-mode/v1/chat/completions') {
      state.bailianCalls += 1
      const body = await jsonBody(request)
      if (state.failFirstBailianCall && state.bailianCalls === 1) {
        sendJson(response, { error: { message: 'temporary bailian failure' } }, 500)
        return
      }
      const text = `Mock Title ${state.bailianCalls} ${body?.model ?? 'unknown'}`
      sendJson(response, {
        id: `chatcmpl-e2e-${state.bailianCalls}`,
        object: 'chat.completion',
        created: Date.now(),
        model: body?.model ?? 'qwen3.6-flash',
        choices: [
          {
            index: 0,
            message: { role: 'assistant', content: text },
            finish_reason: 'stop',
            logprobs: null,
          },
        ],
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
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

async function createWorkbook(path: string, rows: Array<[string, string]>) {
  const workbook = new ExcelJS.Workbook()
  const sheet = workbook.addWorksheet('Titles')
  sheet.addRow(['货号', '标题'])
  for (const row of rows) {
    sheet.addRow(row)
  }
  await workbook.xlsx.writeFile(path)
}

async function readWorkbookRows(path: string) {
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.readFile(path)
  const sheet = workbook.worksheets[0]
  if (!sheet) {
    throw new Error('titles worksheet missing')
  }
  return (
    sheet
      .getRows(1, sheet.rowCount)
      ?.map((row) => [String(row.getCell(1).value ?? ''), String(row.getCell(2).value ?? '')]) ?? []
  )
}

async function createSku(batchDir: string, skuCode: string) {
  const skuDir = join(batchDir, skuCode)
  await mkdir(skuDir, { recursive: true })
  await sharp({
    create: {
      width: 8,
      height: 8,
      channels: 4,
      background: { r: 255, g: 255, b: 255, alpha: 0.5 },
    },
  })
    .png()
    .toFile(join(skuDir, '1.png'))
}

async function setupBatch(root: string) {
  const batchDir = join(root, '04-上架工作区', 'title-e2e-batch')
  await createSku(batchDir, 'SKU001')
  await createSku(batchDir, 'SKU002')
  await createSku(batchDir, 'SKU003')
  await createWorkbook(join(batchDir, '标题.xlsx'), [['SKU002', 'Existing SKU002 Title']])
  return batchDir
}

async function launchApp(mockBaseUrl: string, userDataDir: string) {
  return electron.launch({
    args: ['out/main/index.js'],
    cwd: process.cwd(),
    timeout: 30_000,
    env: {
      ...process.env,
      NODE_ENV: 'development',
      TENGYU_SERVER_URL: mockBaseUrl,
      TENGYU_PHP_AUTH_BASE_URL: mockBaseUrl,
      TENGYU_BAILIAN_BASE_URL: `${mockBaseUrl}/compatible-mode/v1`,
      TENGYU_SKIP_TITLE_DB_REGISTER: '1',
      ELECTRON_DISABLE_SECURITY_WARNINGS: 'true',
      TENGYU_ELECTRON_USER_DATA_DIR: userDataDir,
    },
  })
}

async function prepareApp(page: Page, workbenchRoot: string) {
  await page.evaluate(async (root) => {
    await window.api.customerAuth.loginByPhone({ phone: '13800000000', code: '123456' })
    await window.api.onboarding.saveWorkbenchRoot(root)
    await window.api.onboarding.saveApiKeys({ bailian: 'sk-e2e' })
    await window.api.generationSettings.save({
      config: { default_concurrency: 1, grsai_concurrency: 1 },
    })
    await window.api.onboarding.complete()
  }, workbenchRoot)
}

async function openTitlePage(page: Page) {
  await page.getByRole('link', { name: '标题生成' }).click()
  await expect(page.getByRole('heading', { name: '标题生成模块' })).toBeVisible()
}

test.describe('title module E2E', () => {
  let tempRoot = ''
  let app: ElectronApplication | null = null
  let closeMockServer: (() => Promise<void>) | null = null

  test.beforeEach(async () => {
    tempRoot = await mkdtemp(join(tmpdir(), 'tengyu-title-e2e-'))
  })

  test.afterEach(async () => {
    await app?.close().catch(() => null)
    app = null
    await closeMockServer?.().catch(() => null)
    closeMockServer = null
    await rm(tempRoot, { recursive: true, force: true })
  })

  test('generates titles, skips existing rows, emits progress, and writes xlsx', async () => {
    const state: MockState = { bailianCalls: 0, failFirstBailianCall: true }
    const mockServer = await startMockServer(state)
    closeMockServer = mockServer.close
    const workbenchRoot = join(tempRoot, 'workbench')
    const batchDir = await setupBatch(workbenchRoot)

    app = await launchApp(mockServer.baseUrl, join(tempRoot, 'user-data'))
    const page = await app.firstWindow()
    await prepareApp(page, workbenchRoot)
    await page.reload()
    await openTitlePage(page)

    await page.getByPlaceholder('选择货号文件夹所在的父目录').fill(batchDir)
    await page.getByRole('button', { name: '高级参数' }).click()
    await page.getByRole('button', { name: '扫描' }).click()
    await expect(page.getByText('生成', { exact: true }).locator('..')).toContainText('2')

    await page.evaluate(() => {
      window.__titleProgressEvents = []
      window.api.title.onProgress((progress) => {
        window.__titleProgressEvents.push(progress)
      })
    })

    await page.getByRole('button', { name: '开始生成标题' }).click()
    await expect(page.getByText('成功 2 个，失败 0 个，跳过 1 个')).toBeVisible({
      timeout: 30_000,
    })

    const progressEvents = await page.evaluate(() => window.__titleProgressEvents)
    expect(progressEvents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ processed: 1, total: 3, skipped: 1 }),
        expect.objectContaining({ processed: 3, total: 3, succeeded: 2, skipped: 1, failed: 0 }),
      ]),
    )
    expect(state.bailianCalls).toBe(3)

    const rows = await readWorkbookRows(join(batchDir, '标题.xlsx'))
    expect(rows).toEqual([
      ['货号', '标题'],
      ['SKU001', 'Mock Title 2 qwen3.6-flash'],
      ['SKU002', 'Existing SKU002 Title'],
      ['SKU003', 'Mock Title 3 qwen3.6-flash'],
    ])
  })

  test('retries failed rows from the result panel', async () => {
    const state: MockState = { bailianCalls: 0, failFirstBailianCall: false }
    const mockServer = await startMockServer(state)
    closeMockServer = mockServer.close
    const workbenchRoot = join(tempRoot, 'workbench')
    const batchDir = await setupBatch(workbenchRoot)

    app = await launchApp(mockServer.baseUrl, join(tempRoot, 'user-data'))
    const page = await app.firstWindow()
    await prepareApp(page, workbenchRoot)
    await page.reload()
    await openTitlePage(page)

    await rm(join(batchDir, 'SKU003', '1.png'))
    await page.getByPlaceholder('选择货号文件夹所在的父目录').fill(batchDir)
    await page.getByRole('button', { name: '高级参数' }).click()
    await page.getByRole('button', { name: '扫描' }).click()
    await page.getByRole('button', { name: '开始生成标题' }).click()
    await expect(page.getByText('成功 1 个，失败 1 个，跳过 1 个')).toBeVisible({
      timeout: 30_000,
    })

    await createSku(batchDir, 'SKU003')
    await page.getByRole('button', { name: '重试失败' }).click()
    await expect(page.getByText('失败重试中')).toBeVisible()
    await expect(page.getByText('成功 1 个，失败 0 个，跳过 0 个')).toBeVisible({
      timeout: 30_000,
    })

    const rows = await readWorkbookRows(join(batchDir, '标题.xlsx'))
    expect(rows).toEqual([
      ['货号', '标题'],
      ['SKU001', 'Mock Title 1 qwen3.6-flash'],
      ['SKU002', 'Existing SKU002 Title'],
      ['SKU003', 'Mock Title 2 qwen3.6-flash'],
    ])
  })
})

declare global {
  interface Window {
    __titleProgressEvents: unknown[]
  }
}
