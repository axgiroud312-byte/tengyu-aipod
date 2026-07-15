import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
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
import type { PipelineRunConfig } from '@tengyu-aipod/shared'
import { openSqliteDatabase } from '../src/main/lib/sqlite'
import type { PipelineExecutionPlanDocument } from '../src/renderer/src/features/pipeline/pipeline-execution-plans'

type MockState = {
  bailianCalls: number
  queuedPrompts: Array<{ promptId: string; workflow: Record<string, unknown> }>
}

type StoredPrompt = {
  outputs: Array<{ filename: string; subfolder: string; type: 'output' }>
}

function sendJson(response: ServerResponse, body: unknown, status = 200) {
  response.writeHead(status, { 'content-type': 'application/json' })
  response.end(JSON.stringify(body))
}

async function jsonBody(request: IncomingMessage) {
  const chunks: Buffer[] = []
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  }
  return chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : null
}

async function startMockServer(state: MockState) {
  const storedPrompts = new Map<string, StoredPrompt>()
  let promptSequence = 0
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
            id: 'cus_pipeline_e2e',
            nickname: 'Pipeline E2E',
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
            id: 'extract-comfyui',
            module: 'generation',
            category: 'extract-comfyui-workflow',
            platform: null,
            language: null,
            version: '1.0.0',
            enabled: true,
            recommendedModel: 'qwen3-vl-plus',
            notes: 'ComfyUI 提取',
          },
          {
            id: 'txt2img-local-print',
            module: 'generation',
            category: 'txt2img-local-print',
            platform: null,
            language: null,
            version: '1.0.0',
            enabled: true,
            recommendedModel: 'qwen3-vl-plus',
            notes: null,
          },
          {
            id: 'infringement-v2',
            module: 'detection',
            category: null,
            platform: null,
            language: null,
            version: '1.0.0',
            enabled: true,
            recommendedModel: 'qwen3-vl-flash',
            notes: null,
          },
        ],
      })
      return
    }

    if (url.pathname === '/api/skills/extract-comfyui') {
      sendJson(response, {
        ok: true,
        data: {
          id: 'extract-comfyui',
          module: 'generation',
          category: 'extract-comfyui-workflow',
          platform: null,
          language: null,
          version: '1.0.0',
          enabled: true,
          recommendedModel: 'qwen3-vl-plus',
          notes: 'ComfyUI 提取',
          systemPrompt: 'Extract the print from the source product image.',
          variables: [],
        },
      })
      return
    }

    if (url.pathname === '/api/skills/txt2img-local-print') {
      sendJson(response, {
        ok: true,
        data: {
          id: 'txt2img-local-print',
          module: 'generation',
          category: 'txt2img-local-print',
          platform: null,
          language: null,
          version: '1.0.0',
          enabled: true,
          recommendedModel: 'qwen3-vl-plus',
          notes: null,
          systemPrompt: 'Return JSON with prompts only.',
          variables: [],
        },
      })
      return
    }

    if (url.pathname === '/api/skills/infringement-v2') {
      sendJson(response, {
        ok: true,
        data: {
          id: 'infringement-v2',
          module: 'detection',
          category: null,
          platform: null,
          language: null,
          version: '1.0.0',
          enabled: true,
          recommendedModel: 'qwen3-vl-flash',
          notes: null,
          systemPrompt: 'Detect infringement.',
          variables: [],
        },
      })
      return
    }

    if (url.pathname === '/api/open/v2/instance/info') {
      sendJson(response, {
        instance_uuid: 'inst-local',
        status: 2,
        title: 'Pipeline E2E Instance',
        server_url: [`${mockBaseUrl(server)}/comfy`],
        server_map: [
          {
            title: 'ComfyUI',
            url: `${mockBaseUrl(server)}/comfy`,
            port_type: 'http',
            protocol: 'http',
          },
        ],
      })
      return
    }

    if (url.pathname === '/compatible-mode/v1/chat/completions') {
      state.bailianCalls += 1
      await jsonBody(request)
      sendJson(response, {
        id: `chatcmpl-pipeline-${state.bailianCalls}`,
        object: 'chat.completion',
        created: Date.now(),
        model: 'qwen3-vl-plus',
        choices: [
          {
            index: 0,
            message: {
              role: 'assistant',
              content: JSON.stringify({
                prompts: ['pipeline comfy prompt 1', 'pipeline comfy prompt 2'],
              }),
            },
            finish_reason: 'stop',
            logprobs: null,
          },
        ],
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
      })
      return
    }

    if (url.pathname === '/comfy/upload/image') {
      sendJson(response, {
        name: 'uploaded-image.png',
        subfolder: '',
        type: 'input',
      })
      return
    }

    if (url.pathname === '/comfy/prompt') {
      promptSequence += 1
      const promptId = `prompt-${promptSequence}`
      const body = (await jsonBody(request)) as { prompt?: Record<string, unknown> } | null
      const workflow = body?.prompt ?? {}
      state.queuedPrompts.push({ promptId, workflow })

      const batchSize = readBatchSize(workflow)
      const outputs = Array.from({ length: batchSize }, (_item, index) => ({
        filename: `${promptId}-${index + 1}.png`,
        subfolder: 'outputs',
        type: 'output' as const,
      }))
      storedPrompts.set(promptId, { outputs })

      sendJson(response, {
        prompt_id: promptId,
        number: promptSequence,
        node_errors: {},
      })
      return
    }

    if (url.pathname.startsWith('/comfy/history/')) {
      const promptId = url.pathname.split('/').at(-1) ?? ''
      const stored = storedPrompts.get(promptId)
      if (!stored) {
        sendJson(response, {}, 404)
        return
      }
      sendJson(response, {
        [promptId]: {
          status: { completed: true },
          outputs: {
            '9': {
              images: stored.outputs,
            },
          },
        },
      })
      return
    }

    if (url.pathname === '/comfy/view') {
      const filename = url.searchParams.get('filename') ?? 'unknown.png'
      response.writeHead(200, { 'content-type': 'image/png' })
      response.end(Buffer.from(`image:${filename}`))
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

function readBatchSize(workflow: Record<string, unknown>) {
  for (const value of Object.values(workflow)) {
    if (!value || typeof value !== 'object') {
      continue
    }
    const inputs =
      'inputs' in value && value.inputs && typeof value.inputs === 'object'
        ? (value.inputs as Record<string, unknown>)
        : null
    if (!inputs) {
      continue
    }
    const candidate = inputs.batch_size ?? inputs.batchSize
    if (typeof candidate === 'number' && Number.isFinite(candidate) && candidate > 0) {
      return Math.floor(candidate)
    }
  }
  return 1
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
      TENGYU_BAILIAN_BASE_URL: `${input.serverUrl}/compatible-mode/v1`,
      ELECTRON_DISABLE_SECURITY_WARNINGS: 'true',
      TENGYU_ELECTRON_USER_DATA_DIR: input.userDataDir,
    },
  })
}

function fieldTextbox(page: Page, label: string) {
  return page.getByText(label, { exact: true }).locator('xpath=..').getByRole('textbox')
}

function fieldCombobox(page: Page, label: string) {
  return page.getByText(label, { exact: true }).locator('xpath=..').getByRole('combobox')
}

async function prepareApp(page: Page, workbenchRoot: string) {
  await page.evaluate(async (root) => {
    await window.api.customerAuth.loginByPhone({ phone: '13800000000', code: '123456' })
    await window.api.onboarding.saveWorkbenchRoot(root)
    await window.api.onboarding.saveApiKeys({ bailian: 'sk-bailian-e2e', chenyu: 'sk-chenyu-e2e' })
    await window.api.onboarding.complete()
  }, workbenchRoot)
}

async function reloadPipelinePageWithOptionMocks(page: Page) {
  await page.reload()
  await page.getByRole('link', { name: '完整任务', exact: true }).click()
  await expect(page.getByRole('heading', { name: '完整任务', exact: true })).toBeVisible()
  await expect(page.getByText(/部分配置加载失败：/)).toHaveCount(0)
}

async function installChenyuInstanceIpcMock(app: ElectronApplication) {
  await app.evaluate(({ ipcMain }) => {
    ipcMain.removeHandler('chenyu:list-instances')
    ipcMain.handle('chenyu:list-instances', async () => [
      {
        instanceUuid: 'inst-ui',
        title: 'UI 晨羽实例',
        status: 2,
        statusName: 'running',
        imageName: null,
        podUuid: null,
        podTag: null,
        gpuUuid: null,
        gpuName: null,
        comfyuiUrl: 'http://127.0.0.1:39999/comfy',
        serverUrls: ['http://127.0.0.1:39999/comfy'],
        isCurrent: true,
        isFixedPod: false,
        raw: { instance_uuid: 'inst-ui', status: 2 },
      },
    ])
    ipcMain.removeHandler('generation:list-comfyui-matting-workflows')
    ipcMain.handle('generation:list-comfyui-matting-workflows', async () => [
      {
        id: 'wf-ui-matting',
        version: '1.0.0',
        name: 'UI 抠图工作流',
        capability: 'matting',
        requiredModels: [],
        detection: {
          imageInputs: 1,
          promptInputs: 0,
          sizeInputs: 2,
          batchInputs: 1,
          outputImages: 1,
          status: 'ready',
          warnings: [],
        },
      },
    ])
  })
}

async function installPipelineLaunchIpcMock(app: ElectronApplication) {
  await app.evaluate(({ ipcMain }) => {
    const state = globalThis as typeof globalThis & { __pipelineLaunchConfigs?: unknown[] }
    state.__pipelineLaunchConfigs = []
    ipcMain.removeHandler('pipeline:run')
    ipcMain.handle('pipeline:run', async (_event, config: unknown) => {
      const configs = state.__pipelineLaunchConfigs ?? []
      configs.push(structuredClone(config))
      state.__pipelineLaunchConfigs = configs
      return `run-ui-${configs.length}`
    })
  })
}

async function readPipelineLaunchConfig(app: ElectronApplication, index: number) {
  return app.evaluate((_electron, configIndex) => {
    const state = globalThis as typeof globalThis & { __pipelineLaunchConfigs?: unknown[] }
    return state.__pipelineLaunchConfigs?.[configIndex]
  }, index) as Promise<PipelineRunConfig | undefined>
}

async function importWorkflow(
  page: Page,
  input: {
    name: string
    capability: 'txt2img' | 'img2img' | 'extract' | 'matting'
    workflowJson: Record<string, unknown>
  },
) {
  return page.evaluate(
    async (payload) =>
      window.api.workflow.importLocal({
        name: payload.name,
        capability: payload.capability,
        workflowJsonText: JSON.stringify(payload.workflowJson),
      }),
    input,
  )
}

async function seedCurrentComfyuiInstance(workbenchRoot: string, comfyuiUrl: string) {
  const db = openSqliteDatabase(join(workbenchRoot, '.workbench', 'workbench.db'))
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS comfyui_instances (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        provider TEXT NOT NULL,
        instance_uuid TEXT NOT NULL,
        comfyui_url TEXT NOT NULL,
        pod_uuid TEXT,
        gpu_uuid TEXT,
        gpu_name TEXT,
        status TEXT NOT NULL,
        pod_price_hour REAL NOT NULL DEFAULT 0,
        gpu_price_hour REAL NOT NULL DEFAULT 0,
        auto_shutdown_at INTEGER,
        created_at INTEGER NOT NULL,
        last_used_at INTEGER
      );
    `)
    db.prepare(
      `
        INSERT OR REPLACE INTO comfyui_instances (
          id,
          provider,
          instance_uuid,
          comfyui_url,
          pod_uuid,
          gpu_uuid,
          gpu_name,
          status,
          pod_price_hour,
          gpu_price_hour,
          auto_shutdown_at,
          created_at,
          last_used_at
        ) VALUES (1, ?, ?, ?, NULL, NULL, NULL, ?, 0, 0, NULL, ?, ?)
      `,
    ).run('chenyu', 'inst-local', comfyuiUrl, 'running', Date.now(), Date.now())
  } finally {
    db.close()
  }
}

async function createImage(path: string, content: string) {
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, content)
}

async function runPipeline(page: Page, input: Parameters<Window['api']['pipeline']['run']>[0]) {
  return page.evaluate(async (runInput) => {
    return new Promise<Awaited<ReturnType<Window['api']['pipeline']['getRun']>>>(
      (resolve, reject) => {
        let runId = ''
        const timer = window.setTimeout(() => {
          offCompleted()
          reject(new Error('pipeline task timed out'))
        }, 60_000)
        const offCompleted = window.api.pipeline.onCompleted((event) => {
          const eventRunId = event.ok ? event.result.run.id : event.run_id
          if (runId && eventRunId !== runId) {
            return
          }
          window.clearTimeout(timer)
          offCompleted()
          if (event.ok) {
            resolve(event.result)
            return
          }
          reject(new Error(event.error))
        })
        window.api.pipeline
          .run(runInput)
          .then((nextRunId) => {
            runId = nextRunId
          })
          .catch((error) => {
            window.clearTimeout(timer)
            offCompleted()
            reject(error)
          })
      },
    )
  }, input)
}

async function resumePipeline(page: Page, runId: string) {
  return page.evaluate(async (inputRunId) => {
    return new Promise<Awaited<ReturnType<Window['api']['pipeline']['getRun']>>>(
      (resolve, reject) => {
        const timer = window.setTimeout(() => {
          offCompleted()
          reject(new Error('pipeline resume timed out'))
        }, 60_000)
        const offCompleted = window.api.pipeline.onCompleted((event) => {
          const eventRunId = event.ok ? event.result.run.id : event.run_id
          if (eventRunId !== inputRunId) {
            return
          }
          window.clearTimeout(timer)
          offCompleted()
          if (event.ok) {
            resolve(event.result)
            return
          }
          reject(new Error(event.error))
        })
        window.api.pipeline.resume({ run_id: inputRunId }).catch((error) => {
          window.clearTimeout(timer)
          offCompleted()
          reject(error)
        })
      },
    )
  }, runId)
}

function markRunInterruptedAfterFirstSource(workbenchRoot: string, runId: string) {
  const db = openSqliteDatabase(join(workbenchRoot, '.workbench', 'workbench.db'))
  try {
    const sourceItems = db
      .prepare(
        `
          SELECT item_key
          FROM pipeline_items
          WHERE run_id = ? AND step_key = 'source' AND status = 'completed'
          ORDER BY created_at ASC
        `,
      )
      .all(runId) as Array<{ item_key: string }>
    for (const item of sourceItems.slice(1)) {
      db.prepare(
        `
          DELETE FROM pipeline_items
          WHERE run_id = ? AND item_key = ?
        `,
      ).run(runId, item.item_key)
    }
    db.prepare(
      `
        UPDATE pipeline_steps
        SET status = 'interrupted',
            output_count = 1,
            completed_at = ?,
            updated_at = ?
        WHERE run_id = ? AND step_key = 'source'
      `,
    ).run(Date.now(), Date.now(), runId)
    db.prepare(
      `
        UPDATE pipeline_runs
        SET status = 'interrupted',
            error_summary = '完整任务已中断，已完成产物已保留',
            completed_at = ?
        WHERE id = ?
      `,
    ).run(Date.now(), runId)
  } finally {
    db.close()
  }
}

function txt2imgWorkflowJson() {
  return {
    '1': {
      class_type: 'CLIPTextEncode',
      inputs: { text: 'default txt2img prompt' },
      _meta: { title: 'Prompt' },
    },
    '2': {
      class_type: 'EmptyImage',
      inputs: { width: 1024, height: 1024, batch_size: 1 },
      _meta: { title: 'Canvas' },
    },
    '9': { class_type: 'SaveImage', inputs: {}, _meta: { title: 'Save' } },
  }
}

function img2imgWorkflowJson() {
  return {
    '1': { class_type: 'LoadImage', inputs: { image: '' }, _meta: { title: 'Source Image' } },
    '2': {
      class_type: 'CLIPTextEncode',
      inputs: { text: 'workflow default prompt' },
      _meta: { title: 'Prompt' },
    },
    '3': {
      class_type: 'EmptyImage',
      inputs: { width: 1024, height: 1024, batch_size: 1 },
      _meta: { title: 'Canvas' },
    },
    '9': { class_type: 'SaveImage', inputs: {}, _meta: { title: 'Save' } },
  }
}

function extractWorkflowJson() {
  return {
    '1': { class_type: 'LoadImage', inputs: { image: '' }, _meta: { title: 'Source Image' } },
    '2': {
      class_type: 'CLIPTextEncode',
      inputs: { text: 'extract default prompt' },
      _meta: { title: 'Prompt' },
    },
    '3': {
      class_type: 'EmptyImage',
      inputs: { width: 1024, height: 1024, batch_size: 1 },
      _meta: { title: 'Canvas' },
    },
    '9': { class_type: 'SaveImage', inputs: {}, _meta: { title: 'Save' } },
  }
}

function mattingWorkflowJson() {
  return {
    '1': { class_type: 'LoadImage', inputs: { image: '' }, _meta: { title: 'Source Image' } },
    '2': {
      class_type: 'CLIPTextEncode',
      inputs: { text: 'Remove the background and output transparent PNG.' },
      _meta: { title: 'Prompt' },
    },
    '3': {
      class_type: 'EmptyImage',
      inputs: { width: 1024, height: 1024, batch_size: 1 },
      _meta: { title: 'Canvas' },
    },
    '9': { class_type: 'SaveImage', inputs: {}, _meta: { title: 'Save' } },
  }
}

test.describe('pipeline comfyui real probe', () => {
  let tempRoot = ''
  let app: ElectronApplication | null = null
  let closeMockServer: (() => Promise<void>) | null = null

  test.beforeEach(async () => {
    tempRoot = await mkdtemp(join(tmpdir(), 'tengyu-pipeline-e2e-'))
  })

  test.afterEach(async () => {
    await app?.close().catch(() => null)
    app = null
    await closeMockServer?.().catch(() => null)
    closeMockServer = null
    await rm(tempRoot, { recursive: true, force: true })
  })

  test('keeps four source drafts and launches each source through its provider controls', async () => {
    const state: MockState = { bailianCalls: 0, queuedPrompts: [] }
    const mockServer = await startMockServer(state)
    closeMockServer = mockServer.close

    const workbenchRoot = join(tempRoot, 'workbench-ui')
    app = await launchApp({
      serverUrl: mockServer.baseUrl,
      userDataDir: join(tempRoot, 'user-data-ui'),
    })
    const page = await app.firstWindow()
    await installChenyuInstanceIpcMock(app)
    await installPipelineLaunchIpcMock(app)
    await page.addInitScript(() => {
      const patch = () => {
        if (!window.api) {
          window.setTimeout(patch, 0)
          return
        }
        window.api.chenyu.listInstances = async () =>
          [
            {
              instanceUuid: 'inst-ui',
              title: 'UI 晨羽实例',
              status: 2,
              statusName: 'running',
              imageName: null,
              podUuid: null,
              podTag: null,
              gpuUuid: null,
              gpuName: null,
              comfyuiUrl: 'http://127.0.0.1:39999/comfy',
              serverUrls: ['http://127.0.0.1:39999/comfy'],
              isCurrent: true,
              isFixedPod: false,
              raw: { instance_uuid: 'inst-ui', status: 2 },
            },
          ] as Awaited<ReturnType<Window['api']['chenyu']['listInstances']>>
        window.api.generation.listComfyuiTxt2imgWorkflows = async () =>
          [
            {
              id: 'wf-ui-txt2img',
              version: '1.0.0',
              name: 'UI 文生图工作流',
              capability: 'txt2img',
              requiredModels: [],
              detection: {
                imageInputs: 0,
                promptInputs: 1,
                sizeInputs: 2,
                batchInputs: 1,
                outputImages: 1,
                status: 'ready',
                warnings: [],
              },
            },
          ] as Awaited<ReturnType<Window['api']['generation']['listComfyuiTxt2imgWorkflows']>>
        window.api.generation.listComfyuiImg2imgWorkflows = async () =>
          [
            {
              id: 'wf-ui-img2img',
              version: '1.0.0',
              name: 'UI 图生图工作流',
              capability: 'img2img',
              requiredModels: [],
              detection: {
                imageInputs: 1,
                promptInputs: 1,
                sizeInputs: 2,
                batchInputs: 1,
                outputImages: 1,
                status: 'ready',
                warnings: [],
              },
            },
          ] as Awaited<ReturnType<Window['api']['generation']['listComfyuiImg2imgWorkflows']>>
        window.api.generation.listComfyuiExtractWorkflows = async () =>
          [
            {
              id: 'wf-ui-extract',
              version: '1.0.0',
              name: 'UI 提取工作流',
              capability: 'extract',
              requiredModels: [],
              detection: {
                imageInputs: 1,
                promptInputs: 1,
                sizeInputs: 2,
                batchInputs: 1,
                outputImages: 1,
                status: 'ready',
                warnings: [],
              },
            },
          ] as Awaited<ReturnType<Window['api']['generation']['listComfyuiExtractWorkflows']>>
        window.api.generation.listComfyuiMattingWorkflows = async () =>
          [
            {
              id: 'wf-ui-matting',
              version: '1.0.0',
              name: 'UI 抠图工作流',
              capability: 'matting',
              requiredModels: [],
              detection: {
                imageInputs: 1,
                promptInputs: 1,
                sizeInputs: 2,
                batchInputs: 1,
                outputImages: 1,
                status: 'ready',
                warnings: [],
              },
            },
          ] as Awaited<ReturnType<Window['api']['generation']['listComfyuiMattingWorkflows']>>
        window.api.title.listPlatforms = async () => [{ key: 'temu', label: 'Temu' }]
        window.api.title.listLanguages = async () => [{ key: 'en', label: 'English' }]
        window.api.title.listModels = async () => [{ key: 'qwen3.6-flash', label: 'qwen3.6-flash' }]
        window.api.generationSettings.get = async () => ({
          defaultConcurrency: 1,
          grsaiModels: [
            {
              id: 'gpt-image-2',
              label: 'gpt-image-2',
              sizes: ['1024x1024'],
              allowCustomSize: false,
            },
          ],
          bailianTextModels: [{ id: 'qwen3-vl-plus', label: 'qwen3-vl-plus', modality: 'text' }],
          bailianVisionModels: [
            { id: 'qwen3-vl-plus', label: 'qwen3-vl-plus', modality: 'vision' },
          ],
        })
        window.api.pipeline.listRuns = async () => []
        window.api.detection.getConfig = async () => null
        window.api.detection.listModels = async () => ['qwen3-vl-flash']
      }
      patch()
    })
    await prepareApp(page, workbenchRoot)
    await reloadPipelinePageWithOptionMocks(page)

    for (const stage of ['任务起点', '抠图', '侵权检测', 'PS 套版', '标题生成']) {
      await expect(page.getByRole('group', { name: `${stage}阶段` })).toBeVisible()
    }
    await expect(page.getByRole('group', { name: '任务起点阶段' }).getByRole('switch')).toHaveCount(
      0,
    )
    await expect(page.getByRole('switch', { name: '启用抠图' })).toBeVisible()
    await page.getByRole('button', { name: '编辑侵权检测' }).focus()
    await page.keyboard.press('Enter')
    await expect(page.getByRole('heading', { name: '侵权检测设置' })).toBeVisible()
    await expect(page.getByRole('tab', { name: '采集 + 提取' })).toHaveCount(0)
    await fieldCombobox(page, '通过要求').click()
    await page.getByRole('option', { name: '仅无风险通过' }).click()
    const detectionSwitch = page.getByRole('switch', { name: '启用侵权检测' })
    await detectionSwitch.focus()
    await page.keyboard.press('Space')
    await expect(detectionSwitch).not.toBeChecked()
    await page.keyboard.press('Space')
    await expect(detectionSwitch).toBeChecked()
    await expect(fieldCombobox(page, '通过要求')).toContainText('仅无风险通过')

    const photoshopSwitch = page.getByRole('switch', { name: '启用 PS 套版' })
    const titleSwitch = page.getByRole('switch', { name: '启用标题生成' })
    await photoshopSwitch.click()
    await titleSwitch.click()
    await photoshopSwitch.click()
    await expect(titleSwitch).toBeDisabled()
    await expect(titleSwitch).not.toBeChecked()
    await photoshopSwitch.click()
    await expect(titleSwitch).toBeEnabled()
    await expect(titleSwitch).toBeChecked()

    await page.getByRole('button', { name: '编辑任务起点' }).click()
    await expect(page.getByRole('tab', { name: '采集 + 提取' })).toBeVisible()
    await expect(page.getByText(/任务起点缺少 \d+ 项配置/)).toBeVisible()

    await page.getByRole('tab', { name: '采集 + 提取' }).click()
    await fieldTextbox(page, '任务名').fill('采集任务')
    await fieldTextbox(page, '印花货号').fill('COL')
    await fieldTextbox(page, '分隔符').fill('_')
    await fieldTextbox(page, '采集文件夹').fill('C:\\source\\collection')
    await fieldCombobox(page, '印花类型').click()
    await page.getByRole('option', { name: '满印' }).click()
    await fieldCombobox(page, '提取方式').click()
    await page.getByRole('option', { name: '晨羽智云' }).click()
    await expect(page.getByText('晨羽工作流', { exact: true })).toBeVisible()
    await expect(
      page.getByText('提取 Skill', { exact: true }).locator('xpath=..').getByRole('combobox'),
    ).toBeVisible()
    await expect(page.getByText('晨羽实例', { exact: true }).first()).toBeVisible()
    await expect(page.getByText('晨羽路径要先配好运行云机和工作流。')).toBeVisible()

    await page.getByRole('tab', { name: '文生图' }).click()
    await expect(fieldTextbox(page, '任务名')).toHaveValue('')
    await expect(page.getByRole('button', { name: '点击填写印花要求' })).toBeVisible()
    await fieldTextbox(page, '任务名').fill('文生图任务')
    await fieldTextbox(page, '印花货号').fill('TXT')
    await fieldTextbox(page, '分隔符').fill('+')
    await fieldCombobox(page, '生图方式').click()
    await page.getByRole('option', { name: '晨羽智云' }).click()
    await expect(page.getByText('提示词先走百炼，再送入晨羽文生图工作流。')).toBeVisible()
    await expect(page.getByText('文生图工作流', { exact: true })).toBeVisible()
    await expect(page.getByText('晨羽实例', { exact: true }).first()).toBeVisible()
    await page.getByRole('button', { name: '点击填写印花要求' }).click()
    await page.getByPlaceholder('例如：圣诞元素、不要文字、适合儿童 T 恤').fill('文生图印花要求')
    await page.getByRole('button', { name: '收起' }).click()

    await page.getByRole('tab', { name: '图生图' }).click()
    await expect(fieldTextbox(page, '任务名')).toHaveValue('')
    await expect(page.getByRole('button', { name: '点击填写印花要求' })).toBeVisible()
    await fieldTextbox(page, '任务名').fill('图生图任务')
    await fieldTextbox(page, '印花货号').fill('IMG')
    await fieldTextbox(page, '分隔符').fill('~')
    await fieldCombobox(page, '印花类型').click()
    await page.getByRole('option', { name: '满印' }).click()
    await page
      .locator('input[type="file"][accept="image/*"]')
      .last()
      .setInputFiles({
        name: 'reference.png',
        mimeType: 'image/png',
        buffer: Buffer.from('reference-image'),
      })
    await page.getByRole('button', { name: '点击填写印花要求' }).click()
    await page.getByPlaceholder('例如：圣诞元素、不要文字、适合儿童 T 恤').fill('图生图印花要求')
    await page.getByRole('button', { name: '收起' }).click()
    await fieldCombobox(page, '生图方式').click()
    await page.getByRole('option', { name: '晨羽智云' }).click()
    await expect(page.getByText('选择图片文件夹、工作流、晨羽实例和每张生成数量。')).toBeVisible()
    await expect(page.getByText('图片文件夹', { exact: true }).first()).toBeVisible()
    await fieldTextbox(page, '图片文件夹').fill('C:\\source\\img2img')
    await expect(page.locator('input[type="number"][min="1"][max="8"]').last()).toBeVisible()
    await expect(
      page.getByText('提示词方式', { exact: true }).locator('xpath=..').getByRole('combobox'),
    ).toBeVisible()

    await page.getByRole('tab', { name: '已有印花' }).click()
    await expect(fieldTextbox(page, '任务名')).toHaveValue('')
    await fieldTextbox(page, '任务名').fill('已有印花任务')
    await fieldTextbox(page, '印花货号').fill('OLD')
    await fieldTextbox(page, '分隔符').fill('.')
    await expect(page.getByText('已有印花文件夹', { exact: true }).first()).toBeVisible()
    await fieldTextbox(page, '已有印花文件夹').fill('C:\\source\\prints')
    await expect(page.getByText('起始步骤', { exact: true })).toBeVisible()
    await expect(page.getByText('当前起始步骤在抠图之后，抠图会跳过。')).toBeVisible()
    await expect(page.getByText('当前起始步骤在侵权检测之后，检测会跳过。')).toBeVisible()
    await expect(page.getByRole('switch', { name: '启用抠图' })).toBeDisabled()
    await expect(page.getByRole('switch', { name: '启用侵权检测' })).toBeDisabled()
    await expect(page.getByRole('switch', { name: '启用 PS 套版' })).toBeDisabled()
    await page
      .getByText('起始步骤', { exact: true })
      .locator('xpath=..')
      .getByRole('combobox')
      .click()
    await page.getByRole('option', { name: '从侵权检测开始' }).click()
    await expect(page.getByRole('switch', { name: '启用侵权检测' })).toBeDisabled()
    await page
      .getByText('起始步骤', { exact: true })
      .locator('xpath=..')
      .getByRole('combobox')
      .click()
    await page.getByRole('option', { name: '从抠图开始' }).click()
    await expect(page.getByRole('switch', { name: '启用抠图' })).toBeDisabled()
    await expect(page.getByRole('switch', { name: '启用侵权检测' })).toBeEnabled()
    await expect(page.getByRole('switch', { name: '启用侵权检测' })).not.toBeChecked()
    await page.getByRole('button', { name: '编辑抠图' }).click()
    await page.locator('summary').filter({ hasText: '抠图设置' }).click()
    await expect(page.getByText('抠图工作流', { exact: true }).last()).toBeVisible()
    await expect(page.getByText('需要先配置运行云机和抠图工作流。')).toBeVisible()

    await reloadPipelinePageWithOptionMocks(page)
    await expect(page.getByRole('heading', { name: '完整任务', exact: true })).toBeVisible()
    await expect(fieldTextbox(page, '任务名')).toHaveValue('已有印花任务')
    await expect(fieldTextbox(page, '已有印花文件夹')).toHaveValue('C:\\source\\prints')
    await expect(fieldTextbox(page, '分隔符')).toHaveValue('.')
    await expect(fieldCombobox(page, '起始步骤')).toContainText('从抠图开始')

    await page.getByRole('tab', { name: '采集 + 提取' }).click()
    await expect(fieldTextbox(page, '任务名')).toHaveValue('采集任务')
    await expect(fieldTextbox(page, '印花货号')).toHaveValue('COL')
    await expect(fieldTextbox(page, '分隔符')).toHaveValue('_')
    await expect(fieldTextbox(page, '采集文件夹')).toHaveValue('C:\\source\\collection')
    await expect(fieldCombobox(page, '印花类型')).toContainText('满印')

    await page.getByRole('tab', { name: '文生图' }).click()
    await expect(fieldTextbox(page, '任务名')).toHaveValue('文生图任务')
    await expect(fieldTextbox(page, '印花货号')).toHaveValue('TXT')
    await expect(fieldTextbox(page, '分隔符')).toHaveValue('+')
    await expect(fieldCombobox(page, '印花类型')).toContainText('局部印花')
    await expect(page.getByRole('button', { name: '文生图印花要求' })).toBeVisible()

    await page.getByRole('tab', { name: '图生图' }).click()
    await expect(fieldTextbox(page, '任务名')).toHaveValue('图生图任务')
    await expect(fieldTextbox(page, '印花货号')).toHaveValue('IMG')
    await expect(fieldTextbox(page, '分隔符')).toHaveValue('~')
    await expect(fieldCombobox(page, '印花类型')).toContainText('满印')
    await expect(fieldTextbox(page, '图片文件夹')).toHaveValue('C:\\source\\img2img')
    await fieldCombobox(page, '生图方式').click()
    await page.getByRole('option', { name: 'Grsai' }).click()
    await expect(page.getByAltText('reference.png')).toBeVisible()
    await expect(page.getByRole('button', { name: '图生图印花要求' })).toBeVisible()

    await page.getByRole('tab', { name: '已有印花' }).click()
    await expect(fieldTextbox(page, '任务名')).toHaveValue('已有印花任务')
    await expect(fieldTextbox(page, '印花货号')).toHaveValue('OLD')
    await expect(fieldTextbox(page, '分隔符')).toHaveValue('.')
    await expect(fieldCombobox(page, '印花类型')).toContainText('局部印花')
    await expect(fieldTextbox(page, '已有印花文件夹')).toHaveValue('C:\\source\\prints')

    await page.getByRole('tab', { name: '采集 + 提取' }).click()
    await fieldTextbox(page, '方案名称').fill('不完整方案')
    await page.getByRole('button', { name: '保存执行方案' }).click()
    await expect(page.getByText(/执行方案只能保存完整的稳定配置：/)).toBeVisible()
    await expect(page.getByText('已保存 0/5 套执行方案')).toBeVisible()

    await fieldCombobox(page, '提取方式').click()
    await page.getByRole('option', { name: '付费模型' }).click()
    for (const switchName of ['启用抠图', '启用侵权检测', '启用 PS 套版'] as const) {
      const stageSwitch = page.getByRole('switch', { name: switchName })
      if (await stageSwitch.isChecked()) {
        await stageSwitch.click()
      }
    }

    const launchCurrentSource = async (
      expectedMode: 'collection' | 'txt2img' | 'img2img' | 'existing_prints',
      expectedName: string,
    ) => {
      const summary = page.getByRole('region', { name: '本次执行摘要' })
      await expect(summary).toBeVisible()
      const startButton = page.getByRole('button', { name: '启动完整任务' })
      await expect(startButton).toBeEnabled()
      await startButton.click()
      if (!app) {
        throw new Error('Electron application closed before pipeline launch assertion')
      }
      const launchIndex = ['collection', 'txt2img', 'img2img', 'existing_prints'].indexOf(
        expectedMode,
      )
      const launchedConfig = await readPipelineLaunchConfig(app, launchIndex)
      expect(launchedConfig?.source.mode).toBe(expectedMode)
      expect(launchedConfig?.name).toBe(expectedName)

      await page.getByRole('button', { name: '编辑任务起点' }).click()
      await fieldTextbox(page, '任务名').fill(`${expectedName}-草稿已修改`)
      await expect(summary.getByText(expectedName, { exact: true })).toBeVisible()
      await expect(summary.getByText(`${expectedName}-草稿已修改`, { exact: true })).toHaveCount(0)

      await reloadPipelinePageWithOptionMocks(page)
    }

    await launchCurrentSource('collection', '采集任务')
    await page.getByRole('tab', { name: '文生图' }).click()
    await fieldCombobox(page, '生图方式').click()
    await page.getByRole('option', { name: 'Grsai' }).click()
    await launchCurrentSource('txt2img', '文生图任务')
    await page.getByRole('tab', { name: '图生图' }).click()
    await fieldCombobox(page, '生图方式').click()
    await page.getByRole('option', { name: 'Grsai' }).click()
    await launchCurrentSource('img2img', '图生图任务')
    await page.getByRole('tab', { name: '已有印花' }).click()
    const existingTitleSwitch = page.getByRole('switch', { name: '启用标题生成' })
    if ((await existingTitleSwitch.isEnabled()) && (await existingTitleSwitch.isChecked())) {
      await existingTitleSwitch.click()
    }
    for (const switchName of ['启用侵权检测', '启用 PS 套版'] as const) {
      const stageSwitch = page.getByRole('switch', { name: switchName })
      if ((await stageSwitch.isEnabled()) && (await stageSwitch.isChecked())) {
        await stageSwitch.click()
      }
    }
    await page.getByRole('button', { name: '编辑抠图' }).click()
    await page.locator('summary').filter({ hasText: '抠图设置' }).click()
    await fieldCombobox(page, '抠图工作流').click()
    await page.getByRole('option', { name: /UI 抠图工作流/ }).click()
    await page
      .getByText('晨羽实例', { exact: true })
      .filter({ visible: true })
      .locator('xpath=../..')
      .getByRole('combobox')
      .click()
    await page.getByRole('option', { name: /UI 晨羽实例/ }).click()
    await launchCurrentSource('existing_prints', '已有印花任务')

    const blockedTitleSwitch = page.getByRole('switch', { name: '启用标题生成' })
    if ((await blockedTitleSwitch.isEnabled()) && (await blockedTitleSwitch.isChecked())) {
      await blockedTitleSwitch.click()
    }
    const blockedPhotoshopSwitch = page.getByRole('switch', { name: '启用 PS 套版' })
    if (await blockedPhotoshopSwitch.isChecked()) {
      await blockedPhotoshopSwitch.click()
    }
    await fieldTextbox(page, '已有印花文件夹').fill('')
    await expect(page.getByRole('button', { name: '启动完整任务' })).toBeDisabled()
    await expect(page.getByText('请先选择已有印花文件夹').last()).toBeVisible()
    await page.getByRole('button', { name: '前往 任务起点配置' }).click()
    await expect(page.getByRole('button', { name: '编辑任务起点' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )

    await page.getByRole('tab', { name: '采集 + 提取' }).click()
    await fieldTextbox(page, '方案名称').fill('标准生产')
    await page.getByRole('button', { name: '保存执行方案' }).click()
    await expect(fieldCombobox(page, '执行方案')).toContainText('标准生产')
    await expect(page.getByText('已保存 1/5 套执行方案')).toBeVisible()
    await page.getByRole('button', { name: '应用执行方案' }).click()
    await expect(page.getByText('当前已应用：标准生产')).toBeVisible()

    await fieldTextbox(page, '任务名').fill('保存后的采集任务')
    await fieldTextbox(page, '印花货号').fill('AFTER-COL')
    await fieldTextbox(page, '采集文件夹').fill('C:\\source\\after-collection')
    await page.getByRole('tab', { name: '文生图' }).click()
    await fieldTextbox(page, '任务名').fill('保存后的文生图任务')
    await fieldTextbox(page, '印花货号').fill('AFTER-TXT')
    await page.getByRole('tab', { name: '采集 + 提取' }).click()
    await fieldTextbox(page, '方案名称').fill('待选方案')
    await page.getByRole('button', { name: '保存执行方案' }).click()
    await expect(fieldCombobox(page, '执行方案')).toContainText('待选方案')
    await expect(page.getByText('当前已应用：标准生产')).toBeVisible()
    await fieldCombobox(page, '提取方式').click()
    await page.getByRole('option', { name: '晨羽智云' }).click()

    await reloadPipelinePageWithOptionMocks(page)
    await expect(fieldCombobox(page, '执行方案')).toContainText('标准生产')
    await page.getByRole('button', { name: '应用执行方案' }).click()

    await expect(page.getByRole('tab', { name: '采集 + 提取' })).toHaveAttribute(
      'data-state',
      'active',
    )
    await expect(fieldCombobox(page, '提取方式')).toContainText('付费模型')
    await expect(fieldTextbox(page, '任务名')).toHaveValue('保存后的采集任务')
    await expect(fieldTextbox(page, '印花货号')).toHaveValue('AFTER-COL')
    await expect(fieldTextbox(page, '采集文件夹')).toHaveValue('C:\\source\\after-collection')

    await page.getByRole('tab', { name: '文生图' }).click()
    await expect(fieldTextbox(page, '任务名')).toHaveValue('保存后的文生图任务')
    await expect(fieldTextbox(page, '印花货号')).toHaveValue('AFTER-TXT')

    await page.getByRole('tab', { name: '采集 + 提取' }).click()
    for (let index = 3; index <= 5; index += 1) {
      await fieldTextbox(page, '方案名称').fill(`标准生产 ${index}`)
      await page.getByRole('button', { name: '保存执行方案' }).click()
    }
    await expect(
      page.getByText('已保存 5/5 套执行方案，已达到上限，请先维护现有方案。'),
    ).toBeVisible()
    await fieldTextbox(page, '方案名称').fill('第六套方案')
    await expect(page.getByRole('button', { name: '保存执行方案' })).toBeDisabled()

    await fieldCombobox(page, '执行方案').click()
    await page.getByRole('option', { name: '标准生产', exact: true }).click()
    const overwriteDetectionSwitch = page.getByRole('switch', { name: '启用侵权检测' })
    if (!(await overwriteDetectionSwitch.isChecked())) {
      await overwriteDetectionSwitch.click()
    }
    await page.getByRole('button', { name: '覆盖保存' }).click()
    await expect(page.getByText('已覆盖执行方案：标准生产').first()).toBeVisible()
    await expect(page.getByText(/已保存 5\/5 套执行方案/)).toBeVisible()
    await overwriteDetectionSwitch.click()
    await page.getByRole('button', { name: '应用执行方案' }).click()
    await expect(overwriteDetectionSwitch).toBeChecked()

    await fieldTextbox(page, '方案名称').fill('标准生产重命名')
    await page.getByRole('button', { name: '重命名' }).click()
    await expect(fieldCombobox(page, '执行方案')).toContainText('标准生产重命名')
    await expect(page.getByText('当前已应用：标准生产重命名')).toBeVisible()

    await fieldTextbox(page, '任务名').fill('删除时保留的任务')
    await fieldTextbox(page, '印花货号').fill('KEEP-DRAFT')
    await fieldTextbox(page, '采集文件夹').fill('C:\\source\\keep-draft')
    await fieldCombobox(page, '执行方案').click()
    await page.getByRole('option', { name: '待选方案' }).click()
    await page.getByRole('button', { name: '删除执行方案' }).click()
    await expect(page.getByRole('alertdialog', { name: '删除当前执行方案' })).toHaveCount(0)
    await expect(page.getByText('当前已应用：标准生产重命名')).toBeVisible()
    await expect(fieldTextbox(page, '任务名')).toHaveValue('删除时保留的任务')

    await fieldCombobox(page, '执行方案').click()
    await page.getByRole('option', { name: '标准生产重命名' }).click()
    await page.getByRole('button', { name: '删除执行方案' }).click()
    const deleteDialog = page.getByRole('alertdialog', { name: '删除当前执行方案' })
    await expect(deleteDialog).toBeVisible()
    await expect(deleteDialog).toContainText('当前页面草稿会完整保留')
    await deleteDialog.getByRole('button', { name: '取消' }).click()
    await expect(page.getByText('当前已应用：标准生产重命名')).toBeVisible()
    await page.getByRole('button', { name: '删除执行方案' }).click()
    await deleteDialog.getByRole('button', { name: '确认删除' }).click()
    await expect(page.getByText('当前尚未应用执行方案')).toBeVisible()
    await expect(fieldTextbox(page, '任务名')).toHaveValue('删除时保留的任务')
    await expect(fieldTextbox(page, '印花货号')).toHaveValue('KEEP-DRAFT')
    await expect(fieldTextbox(page, '采集文件夹')).toHaveValue('C:\\source\\keep-draft')

    const recoverableDocument = await page.evaluate(() =>
      window.localStorage.getItem('tengyu-aipod:pipeline-execution-plans'),
    )
    expect(recoverableDocument).toBeTruthy()
    const invalidStorageCases = [
      {
        raw: '{broken',
        message: '执行方案数据已损坏，无法解析。请删除损坏数据后重新保存方案。',
      },
      {
        raw: JSON.stringify({ schema_version: 2, plans: [] }),
        message: '执行方案数据版本 2 不受支持，请升级 Workbench 或删除后重新保存。',
      },
      {
        raw: JSON.stringify({ schema_version: 1, plans: [{ id: 'broken' }] }),
        message: '执行方案数据结构无效，请删除损坏数据后重新保存方案。',
      },
    ]
    await page.evaluate((rawDocument) => {
      const document = JSON.parse(rawDocument ?? '') as PipelineExecutionPlanDocument
      const plan = document.plans[0]
      if (!plan) {
        throw new Error('Expected a saved execution plan')
      }
      plan.id = 'stale-plan'
      plan.name = '失效引用方案'
      plan.config.sourceMode = 'img2img'
      plan.config.source.img2imgProvider = 'comfyui-chenyu'
      plan.config.source.img2imgComfyuiPromptMode = 'workflow'
      plan.config.source.img2imgComfyuiWorkflowId = 'wf-removed'
      plan.config.source.img2imgComfyuiInstanceUuid = 'machine-removed'
      plan.config.stages = { matting: true, detection: true, photoshop: true, title: true }
      plan.config.matting = { workflowId: 'wf-matting-removed', instanceUuid: 'machine-removed' }
      plan.config.detection.model = 'detection-model-removed'
      plan.config.detection.skillKey = 'detection-skill-removed@@1.0.0'
      plan.config.photoshop.templatePaths = ['C:\\mockups\\removed.psd']
      plan.config.title.model = 'title-model-removed'
      document.plans = [plan]
      window.localStorage.setItem('tengyu-aipod:pipeline-execution-plans', JSON.stringify(document))
      window.localStorage.setItem('tengyu-aipod:pipeline-execution-plans:last-used', 'stale-plan')
    }, recoverableDocument)
    await reloadPipelinePageWithOptionMocks(page)
    await expect(fieldCombobox(page, '执行方案')).toContainText('失效引用方案')
    await page.getByRole('button', { name: '应用执行方案' }).click()
    await expect(page.getByText(/发现 8 个失效资源/).first()).toBeVisible()
    await expect(
      page.getByText('图生图工作流 wf-removed 已不可用，请重新选择。').first(),
    ).toBeVisible()
    await expect(
      page.getByText('图生图运行云机 machine-removed 已不可用，请重新选择。'),
    ).toBeVisible()
    await fieldCombobox(page, '生图方式').click()
    await page.getByRole('option', { name: 'Grsai' }).click()
    await expect(page.getByText(/图生图工作流 wf-removed 已不可用/)).toHaveCount(0)
    await expect(page.getByText(/图生图运行云机 machine-removed 已不可用/)).toHaveCount(0)

    await page.getByRole('button', { name: '编辑抠图' }).click()
    await expect(
      page.getByText('抠图工作流 wf-matting-removed 已不可用，请重新选择。').first(),
    ).toBeVisible()
    await expect(
      page.getByText('抠图运行云机 machine-removed 已不可用，请重新选择。'),
    ).toBeVisible()
    await page.getByRole('switch', { name: '启用抠图' }).click()
    await expect(page.getByText(/抠图工作流 wf-matting-removed 已不可用/)).toHaveCount(0)
    await expect(page.getByText(/抠图运行云机 machine-removed 已不可用/)).toHaveCount(0)

    for (const invalidStorage of invalidStorageCases) {
      await page.evaluate((value) => {
        window.localStorage.setItem('tengyu-aipod:pipeline-execution-plans', value)
      }, invalidStorage.raw)
      await reloadPipelinePageWithOptionMocks(page)
      await expect(page.getByText(invalidStorage.message)).toBeVisible()
      await expect(page.getByRole('button', { name: '保存执行方案' })).toBeDisabled()
    }
    await page.getByRole('button', { name: '清除损坏方案数据' }).click()
    await expect(page.getByText(invalidStorageCases[2]?.message ?? '')).toHaveCount(0)
    await expect(page.getByText('已保存 0/5 套执行方案')).toBeVisible()
  })

  test('runs txt2img and img2img comfyui complete tasks through electron IPC', async () => {
    const state: MockState = { bailianCalls: 0, queuedPrompts: [] }
    const mockServer = await startMockServer(state)
    closeMockServer = mockServer.close

    const workbenchRoot = join(tempRoot, 'workbench-run')
    const img2imgSourceRoot = join(tempRoot, 'img2img-source')
    await createImage(join(img2imgSourceRoot, 'a.png'), 'img-a')
    await createImage(join(img2imgSourceRoot, 'b.png'), 'img-b')
    await seedCurrentComfyuiInstance(workbenchRoot, `${mockServer.baseUrl}/comfy`)

    app = await launchApp({
      serverUrl: mockServer.baseUrl,
      userDataDir: join(tempRoot, 'user-data-run'),
    })
    const page = await app.firstWindow()
    await prepareApp(page, workbenchRoot)

    const txtWorkflow = await importWorkflow(page, {
      name: 'Pipeline Txt2img Workflow',
      capability: 'txt2img',
      workflowJson: txt2imgWorkflowJson(),
    })
    const imgWorkflow = await importWorkflow(page, {
      name: 'Pipeline Img2img Workflow',
      capability: 'img2img',
      workflowJson: img2imgWorkflowJson(),
    })

    expect(txtWorkflow.id).toBeTruthy()
    expect(imgWorkflow.id).toBeTruthy()

    const txt2imgResult = await runPipeline(page, {
      name: 'pipeline-comfyui-txt2img',
      printMode: 'local',
      source: {
        mode: 'txt2img',
        provider: 'comfyui-chenyu',
        prompt: {
          mode: 'ai',
          requirement: 'cute bear print',
          count: 2,
          model: 'qwen3-vl-plus',
          skillId: 'txt2img-local-print',
          skillVersion: '1.0.0',
        },
        comfyui: {
          workflowId: txtWorkflow.id,
          width: 1024,
          height: 1024,
          concurrency: 1,
        },
      },
      matting: { enabled: false, mode: 'comfyui' },
      detection: { enabled: false },
      photoshop: { enabled: false, templates: [] },
      title: {
        enabled: false,
        platform: 'temu',
        language: 'en',
        model: 'qwen3.6-flash',
      },
    })

    expect(txt2imgResult?.run.status).toBe('completed')
    expect(state.bailianCalls).toBe(1)
    expect(state.queuedPrompts).toHaveLength(2)
    const txtPromptNode = state.queuedPrompts[0]?.workflow['1'] as
      | { inputs?: { text?: string } }
      | undefined
    expect(txtPromptNode?.inputs?.text).toBe('pipeline comfy prompt 1')

    state.queuedPrompts.length = 0

    const img2imgResult = await runPipeline(page, {
      name: 'pipeline-comfyui-img2img',
      printMode: 'local',
      source: {
        mode: 'img2img',
        provider: 'comfyui-chenyu',
        sourceFolder: img2imgSourceRoot,
        comfyui: {
          workflowId: imgWorkflow.id,
          width: 1024,
          height: 1024,
          batchSize: 3,
        },
      },
      matting: { enabled: false, mode: 'comfyui' },
      detection: { enabled: false },
      photoshop: { enabled: false, templates: [] },
      title: {
        enabled: false,
        platform: 'temu',
        language: 'en',
        model: 'qwen3.6-flash',
      },
    })

    expect(img2imgResult?.run.status).toBe('completed')
    expect(state.bailianCalls).toBe(1)
    expect(state.queuedPrompts).toHaveLength(2)
    const firstImg2imgWorkflow = state.queuedPrompts[0]?.workflow
    const imgPromptNode = firstImg2imgWorkflow?.['2'] as { inputs?: { text?: string } } | undefined
    const imgBatchNode = firstImg2imgWorkflow?.['3'] as
      | { inputs?: { batch_size?: number } }
      | undefined
    expect(imgPromptNode?.inputs?.text).toBe('workflow default prompt')
    expect(imgBatchNode?.inputs?.batch_size).toBe(3)
    expect(
      (img2imgResult?.result_sections ?? []).find((section) => section.key === 'image_processing'),
    ).toMatchObject({
      total: 6,
      completed: 6,
    })

    const firstGeneratedPath =
      (img2imgResult?.result_sections ?? []).find((section) => section.key === 'image_processing')
        ?.items[0]?.local_path ?? ''
    expect(firstGeneratedPath).toContain(join('02-印花工作区', '图生图'))
    expect(await readFile(firstGeneratedPath, 'utf8')).toContain('image:')
  })

  test('resumes interrupted txt2img comfyui runs without resubmitting completed prompts', async () => {
    const state: MockState = { bailianCalls: 0, queuedPrompts: [] }
    const mockServer = await startMockServer(state)
    closeMockServer = mockServer.close

    const workbenchRoot = join(tempRoot, 'workbench-resume')
    await seedCurrentComfyuiInstance(workbenchRoot, `${mockServer.baseUrl}/comfy`)

    app = await launchApp({
      serverUrl: mockServer.baseUrl,
      userDataDir: join(tempRoot, 'user-data-resume'),
    })
    const page = await app.firstWindow()
    await prepareApp(page, workbenchRoot)

    const txtWorkflow = await importWorkflow(page, {
      name: 'Pipeline Resume Txt2img Workflow',
      capability: 'txt2img',
      workflowJson: txt2imgWorkflowJson(),
    })

    const initialResult = await runPipeline(page, {
      name: 'pipeline-comfyui-resume',
      printMode: 'local',
      source: {
        mode: 'txt2img',
        provider: 'comfyui-chenyu',
        prompt: {
          mode: 'manual',
          prompts: ['resume prompt 1', 'resume prompt 2'],
        },
        comfyui: {
          workflowId: txtWorkflow.id,
          width: 1024,
          height: 1024,
          concurrency: 1,
        },
      },
      matting: { enabled: false, mode: 'comfyui' },
      detection: { enabled: false },
      photoshop: { enabled: false, templates: [] },
      title: {
        enabled: false,
        platform: 'temu',
        language: 'en',
        model: 'qwen3.6-flash',
      },
    })

    expect(initialResult?.run.status).toBe('completed')
    expect(state.queuedPrompts).toHaveLength(2)

    const runId = initialResult?.run.id
    if (!runId) {
      throw new Error('resume e2e did not create a run id')
    }
    markRunInterruptedAfterFirstSource(workbenchRoot, runId)
    state.queuedPrompts.length = 0

    const resumedResult = await resumePipeline(page, runId)

    expect(resumedResult?.run.status).toBe('completed')
    expect(state.queuedPrompts).toHaveLength(1)
    const resumedPromptNode = state.queuedPrompts[0]?.workflow['1'] as
      | { inputs?: { text?: string } }
      | undefined
    expect(resumedPromptNode?.inputs?.text).toBe('resume prompt 2')
  })

  test('runs collection extract and existing prints matting complete tasks through electron IPC', async () => {
    const state: MockState = { bailianCalls: 0, queuedPrompts: [] }
    const mockServer = await startMockServer(state)
    closeMockServer = mockServer.close

    const workbenchRoot = join(tempRoot, 'workbench-stages')
    const collectionRoot = join(workbenchRoot, '01-采集工作区', 'collection-source')
    const existingPrintRoot = join(workbenchRoot, '02-印花工作区', 'existing-source')
    await createImage(join(collectionRoot, 'source-a.png'), 'source-a')
    await createImage(join(collectionRoot, 'source-b.png'), 'source-b')
    await createImage(join(existingPrintRoot, 'print-a.png'), 'print-a')
    await createImage(join(existingPrintRoot, 'print-b.png'), 'print-b')
    await seedCurrentComfyuiInstance(workbenchRoot, `${mockServer.baseUrl}/comfy`)

    app = await launchApp({
      serverUrl: mockServer.baseUrl,
      userDataDir: join(tempRoot, 'user-data-stages'),
    })
    const page = await app.firstWindow()
    await prepareApp(page, workbenchRoot)

    const extractWorkflow = await importWorkflow(page, {
      name: 'Pipeline Extract Workflow',
      capability: 'extract',
      workflowJson: extractWorkflowJson(),
    })
    const mattingWorkflow = await importWorkflow(page, {
      name: 'Pipeline Matting Workflow',
      capability: 'matting',
      workflowJson: mattingWorkflowJson(),
    })

    expect(extractWorkflow.id).toBeTruthy()
    expect(mattingWorkflow.id).toBeTruthy()

    const collectionResult = await runPipeline(page, {
      name: 'pipeline-comfyui-collection-extract',
      printMode: 'local',
      source: {
        mode: 'collection',
        sourceFolder: collectionRoot,
        extract: {
          provider: 'comfyui-chenyu',
          skillId: 'extract-comfyui',
          skillVersion: '1.0.0',
          comfyui: {
            workflowId: extractWorkflow.id,
            width: 1024,
            height: 1024,
            concurrency: 1,
          },
        },
      },
      matting: { enabled: false, mode: 'comfyui' },
      detection: { enabled: false },
      photoshop: { enabled: false, templates: [] },
      title: {
        enabled: false,
        platform: 'temu',
        language: 'en',
        model: 'qwen3.6-flash',
      },
    })

    expect(collectionResult?.run.status).toBe('completed')
    expect(state.bailianCalls).toBe(0)
    expect(state.queuedPrompts).toHaveLength(2)
    expect(
      (collectionResult?.result_sections ?? []).find(
        (section) => section.key === 'image_processing',
      ),
    ).toMatchObject({
      total: 2,
      completed: 2,
    })
    const extractPromptNode = state.queuedPrompts[0]?.workflow['2'] as
      | { inputs?: { text?: string } }
      | undefined
    expect(extractPromptNode?.inputs?.text).toBe('Extract the print from the source product image.')

    state.queuedPrompts.length = 0

    const existingPrintResult = await runPipeline(page, {
      name: 'pipeline-existing-prints-matting',
      printMode: 'local',
      source: {
        mode: 'existing_prints',
        printFolder: existingPrintRoot,
        startStep: 'matting',
      },
      matting: {
        enabled: true,
        mode: 'comfyui',
        workflowId: mattingWorkflow.id,
        width: 1024,
        height: 1024,
      },
      detection: { enabled: false },
      photoshop: { enabled: false, templates: [] },
      title: {
        enabled: false,
        platform: 'temu',
        language: 'en',
        model: 'qwen3.6-flash',
      },
    })

    expect(existingPrintResult?.run.status).toBe('completed')
    expect(state.bailianCalls).toBe(0)
    expect(state.queuedPrompts).toHaveLength(2)
    const mattingPromptNode = state.queuedPrompts[0]?.workflow['2'] as
      | { inputs?: { text?: string } }
      | undefined
    expect(mattingPromptNode?.inputs?.text).toBe(
      'Remove the background and output transparent PNG.',
    )
    expect(
      (existingPrintResult?.result_sections ?? []).find(
        (section) => section.key === 'image_processing',
      ),
    ).toMatchObject({
      total: 2,
      completed: 2,
    })
  })
})
