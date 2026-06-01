import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises'
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
import sharp from 'sharp'
import { openSqliteDatabase } from '../src/main/lib/sqlite'

type MockState = {
  bailianCalls: number
  bailianBodies: unknown[]
  grsaiCalls: Array<{ node: 'cn' | 'global'; body: GrsaiRequestBody }>
  skillIndexCalls: number
  skillDetailIds: string[]
  activeGrsaiRequests: number
  maxActiveGrsaiRequests: number
  failFirstCnWith429: boolean
  cn429Count: number
}

type GrsaiRequestBody = {
  prompt?: string
  images?: string[]
  model?: string
  aspectRatio?: string
  imageSize?: string
  replyType?: string
}

type ArtifactRow = {
  id: string
  step: string
  provider: string
  source_artifact_ids: string
  file_path: string
  prompt_snapshot: string | null
}

const txt2imgSkill = {
  id: 'txt2img-local-print',
  module: 'generation',
  category: 'txt2img-local-print',
  platform: null,
  language: null,
  version: '1.0.0',
  enabled: true,
  recommendedModel: null,
  notes: null,
  systemPrompt: 'E2E_TXT2IMG_SKILL Return JSON prompts for text to image.',
  variables: [],
}

const img2imgSkill = {
  id: 'img2img-local-reference',
  module: 'generation',
  category: 'img2img-local-reference',
  platform: null,
  language: null,
  version: '1.0.0',
  enabled: true,
  recommendedModel: null,
  notes: null,
  systemPrompt: 'E2E_IMG2IMG_SKILL Return JSON prompts for image to image.',
  variables: [],
}

const extractSkill = {
  id: 'extract-paid-model',
  module: 'generation',
  category: 'extract-paid-model',
  platform: null,
  language: null,
  version: '1.0.0',
  enabled: true,
  recommendedModel: 'qwen3-vl-plus',
  notes: null,
  systemPrompt:
    'E2E_EXTRACT_SKILL Return JSON prompts for extracting a print from the source image.',
  variables: [
    {
      key: 'printAreaPreference',
      label: '印花区域偏好',
      type: 'select',
      default: 'auto',
      options: [{ value: 'auto', label: '自动识别' }],
    },
    {
      key: 'allowMultiplePrints',
      label: '允许多印花',
      type: 'checkbox',
      default: true,
    },
  ],
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

function sendPng(response: ServerResponse, body: Buffer) {
  response.writeHead(200, { 'content-type': 'image/png' })
  response.end(body)
}

function promptsForCall(call: number) {
  if (call === 1) {
    return [
      'txt2img prompt 1',
      'txt2img prompt 2',
      'txt2img prompt 3',
      'txt2img prompt 4',
      'txt2img prompt 5',
    ]
  }
  if (call === 2) {
    return ['img2img style prompt 1', 'img2img style prompt 2', 'img2img style prompt 3']
  }
  return ['extract centered print prompt']
}

async function startMockServer(state: MockState) {
  const png = await sharp({
    create: {
      width: 12,
      height: 12,
      channels: 4,
      background: { r: 40, g: 120, b: 220, alpha: 1 },
    },
  })
    .png()
    .toBuffer()

  const server = createServer(async (request, response) => {
    const url = new URL(request.url ?? '/', 'http://127.0.0.1')

    if (url.pathname === '/api/skills') {
      state.skillIndexCalls += 1
      const category = url.searchParams.get('category')
      const skills = [txt2imgSkill, img2imgSkill, extractSkill].filter(
        (skill) => !category || skill.category === category,
      )
      sendJson(response, { ok: true, data: skills })
      return
    }

    const skill = [txt2imgSkill, img2imgSkill, extractSkill].find(
      (item) => url.pathname === `/api/skills/${item.id}`,
    )
    if (skill) {
      state.skillDetailIds.push(skill.id)
      sendJson(response, { ok: true, data: skill })
      return
    }

    if (url.pathname === '/compatible-mode/v1/chat/completions') {
      state.bailianCalls += 1
      state.bailianBodies.push(await jsonBody(request))
      sendJson(response, {
        id: `chatcmpl-generation-e2e-${state.bailianCalls}`,
        object: 'chat.completion',
        created: Date.now(),
        model: 'qwen3-vl-plus',
        choices: [
          {
            index: 0,
            message: {
              role: 'assistant',
              content: JSON.stringify({ prompts: promptsForCall(state.bailianCalls) }),
            },
            finish_reason: 'stop',
            logprobs: null,
          },
        ],
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
      })
      return
    }

    if (url.pathname === '/cn/v1/api/generate' || url.pathname === '/global/v1/api/generate') {
      const node = url.pathname.startsWith('/cn/') ? 'cn' : 'global'
      const body = (await jsonBody(request)) as GrsaiRequestBody
      state.grsaiCalls.push({ node, body })

      if (node === 'cn' && state.failFirstCnWith429 && state.cn429Count === 0) {
        state.cn429Count += 1
        sendJson(response, { error: { message: 'rate limited' } }, 429)
        return
      }

      state.activeGrsaiRequests += 1
      state.maxActiveGrsaiRequests = Math.max(
        state.maxActiveGrsaiRequests,
        state.activeGrsaiRequests,
      )
      await new Promise((resolve) => setTimeout(resolve, 80))
      state.activeGrsaiRequests -= 1

      sendJson(response, {
        id: `task_${state.grsaiCalls.length}`,
        status: 'succeeded',
        progress: 100,
        results: [{ url: `${mockBaseUrl(server)}/image/${state.grsaiCalls.length}.png` }],
        error: '',
      })
      return
    }

    if (url.pathname.startsWith('/image/')) {
      sendPng(response, png)
      return
    }

    sendJson(response, { ok: false, error: { code: 'NOT_FOUND' } }, 404)
  })

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  return {
    baseUrl: mockBaseUrl(server),
    close: () =>
      new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      ),
  }
}

function mockBaseUrl(server: ReturnType<typeof createServer>) {
  const address = server.address()
  if (!address || typeof address === 'string') {
    throw new Error('mock server did not expose a TCP port')
  }
  return `http://127.0.0.1:${address.port}`
}

async function createImage(path: string, background: { r: number; g: number; b: number }) {
  await mkdir(dirname(path), { recursive: true })
  await sharp({
    create: {
      width: 16,
      height: 16,
      channels: 4,
      background: { ...background, alpha: 1 },
    },
  })
    .png()
    .toFile(path)
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
      TENGYU_BAILIAN_BASE_URL: `${mockBaseUrl}/compatible-mode/v1`,
      TENGYU_GRSAI_CN_BASE_URL: `${mockBaseUrl}/cn`,
      TENGYU_GRSAI_GLOBAL_BASE_URL: `${mockBaseUrl}/global`,
      ELECTRON_DISABLE_SECURITY_WARNINGS: 'true',
      TENGYU_ELECTRON_USER_DATA_DIR: userDataDir,
    },
  })
}

async function prepareApp(page: Page, workbenchRoot: string) {
  await page.evaluate(async (root) => {
    await window.api.onboarding.saveWorkbenchRoot(root)
    await window.api.onboarding.saveApiKeys({ bailian: 'sk-bailian-e2e', grsai: 'sk-grsai-e2e' })
    await window.api.onboarding.complete()
    const [hasBailian, hasGrsai] = await Promise.all([
      window.api.keychain.has('bailian'),
      window.api.keychain.has('grsai'),
    ])
    if (!hasBailian || !hasGrsai) {
      throw new Error(`api keys were not saved: bailian=${hasBailian} grsai=${hasGrsai}`)
    }
  }, workbenchRoot)
}

async function runTxt2imgThroughIpc(
  page: Page,
  input: Parameters<Window['api']['generation']['runTxt2img']>[0],
) {
  return page.evaluate(async (runInput) => {
    return new Promise<Awaited<ReturnType<Window['api']['generation']['runExtract']>>>(
      (resolve, reject) => {
        let taskId = ''
        const timer = window.setTimeout(() => {
          offCompleted()
          reject(new Error('generation task timed out'))
        }, 60_000)
        const offCompleted = window.api.generation.onCompleted((event) => {
          const eventTaskId = event.ok ? event.result.taskId : event.taskId
          if (taskId && eventTaskId !== taskId) {
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
        window.api.generation
          .runTxt2img(runInput)
          .then((nextTaskId) => {
            taskId = nextTaskId
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

async function runExtractThroughIpc(
  page: Page,
  input: Parameters<Window['api']['generation']['runExtract']>[0],
) {
  return page.evaluate(async (runInput) => {
    return new Promise<Awaited<ReturnType<Window['api']['generation']['runExtract']>>>(
      (resolve, reject) => {
        let taskId = ''
        const timer = window.setTimeout(() => {
          offCompleted()
          reject(new Error('extract task timed out'))
        }, 60_000)
        const offCompleted = window.api.generation.onCompleted((event) => {
          const eventTaskId = event.ok ? event.result.taskId : event.taskId
          if (taskId && eventTaskId !== taskId) {
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
        window.api.generation
          .runExtract(runInput)
          .then((nextTaskId) => {
            taskId = nextTaskId
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

function readArtifactRows(workbenchRoot: string) {
  const db = openSqliteDatabase(join(workbenchRoot, '.workbench', 'workbench.db'))
  try {
    return db
      .prepare(
        `
          SELECT id, step, provider, source_artifact_ids, file_path, prompt_snapshot
          FROM artifacts
          ORDER BY created_at ASC
        `,
      )
      .all() as unknown as ArtifactRow[]
  } finally {
    db.close()
  }
}

test.describe('generation Grsai E2E', () => {
  let tempRoot = ''
  let app: ElectronApplication | null = null
  let closeMockServer: (() => Promise<void>) | null = null

  test.beforeEach(async () => {
    tempRoot = await mkdtemp(join(tmpdir(), 'tengyu-generation-e2e-'))
  })

  test.afterEach(async () => {
    await app?.close().catch(() => null)
    app = null
    await closeMockServer?.().catch(() => null)
    closeMockServer = null
    await rm(tempRoot, { recursive: true, force: true })
  })

  test('runs txt2img, img2img style, and extract through mocked Grsai and records extract source artifacts', async () => {
    const state: MockState = {
      bailianCalls: 0,
      bailianBodies: [],
      grsaiCalls: [],
      skillIndexCalls: 0,
      skillDetailIds: [],
      activeGrsaiRequests: 0,
      maxActiveGrsaiRequests: 0,
      failFirstCnWith429: true,
      cn429Count: 0,
    }
    const mockServer = await startMockServer(state)
    closeMockServer = mockServer.close

    const workbenchRoot = join(tempRoot, 'workbench')
    const sourcePath = join(
      workbenchRoot,
      '01-采集工作区',
      'temu-20260531-120000',
      '商品页',
      'sku-a',
      'source.png',
    )
    const referencePath = join(tempRoot, 'reference-style.png')
    await createImage(sourcePath, { r: 220, g: 80, b: 60 })
    await createImage(referencePath, { r: 40, g: 180, b: 120 })
    const referenceBase64 = (await readFile(referencePath)).toString('base64')

    app = await launchApp(mockServer.baseUrl, join(tempRoot, 'user-data'))
    const page = await app.firstWindow()
    await prepareApp(page, workbenchRoot)

    const skillProbe = await page.evaluate(async () => {
      const refresh = await window.api.skill.refresh()
      const generationSkills = await window.api.skill.list({ module: 'generation' })
      const detail = await window.api.skill.get({ id: 'txt2img-local-print', version: '1.0.0' })
      return {
        refresh,
        ids: generationSkills.map((skill) => skill.id),
        detailPrompt: detail.systemPrompt,
      }
    })
    expect(skillProbe.refresh).toEqual({ ok: true, count: 3 })
    expect(skillProbe.ids).toEqual([
      'txt2img-local-print',
      'img2img-local-reference',
      'extract-paid-model',
    ])
    expect(skillProbe.detailPrompt).toContain('E2E_TXT2IMG_SKILL')

    const txtDrafts = await page.evaluate(() =>
      window.api.generation.generatePrompts({
        capability: 'txt2img',
        printMode: 'local',
        requirement: 'christmas teddy bear print',
        count: 5,
        model: 'qwen3-vl-plus',
      }),
    )
    expect(txtDrafts.map((draft) => draft.text)).toEqual([
      'txt2img prompt 1',
      'txt2img prompt 2',
      'txt2img prompt 3',
      'txt2img prompt 4',
      'txt2img prompt 5',
    ])
    const txtResult = await runTxt2imgThroughIpc(page, {
      capability: 'txt2img',
      prompts: txtDrafts.map((draft) => draft.text),
      model: 'gpt-image-2',
      aspectRatio: '1024x1024',
      concurrency: 3,
    })
    expect(txtResult).toMatchObject({ total: 5, succeeded: 5, failed: 0 })

    const imgDrafts = await page.evaluate(
      (referenceImage) =>
        window.api.generation.generatePrompts({
          capability: 'img2img',
          printMode: 'local',
          requirement: 'new floral print in reference style',
          count: 3,
          model: 'qwen3-vl-plus',
          modeInstruction: 'Use only the art style from the reference image. Create new content.',
          referenceImages: [referenceImage],
        }),
      { base64: referenceBase64, mime_type: 'image/png' },
    )
    expect(imgDrafts.map((draft) => draft.text)).toEqual([
      'img2img style prompt 1',
      'img2img style prompt 2',
      'img2img style prompt 3',
    ])
    const imgResult = await runTxt2imgThroughIpc(page, {
      capability: 'img2img',
      prompts: imgDrafts.map((draft) => draft.text),
      model: 'gpt-image-2',
      aspectRatio: '1024x1024',
      concurrency: 3,
    })
    expect(imgResult).toMatchObject({ total: 3, succeeded: 3, failed: 0 })

    const imgWithReferenceResult = await runTxt2imgThroughIpc(page, {
      capability: 'img2img',
      prompts: [`${imgDrafts[0]?.text ?? 'img2img style prompt 1'} with image reference`],
      model: 'gpt-image-2',
      aspectRatio: '1024x1024',
      referenceImages: [{ base64: referenceBase64, mime_type: 'image/png' }],
      concurrency: 1,
    })
    expect(imgWithReferenceResult).toMatchObject({ total: 1, succeeded: 1, failed: 0 })

    const sources = await page.evaluate(() => window.api.generation.listExtractSources())
    expect(sources.images.map((source) => source.path)).toContain(sourcePath)
    const extractResult = await runExtractThroughIpc(page, {
      sourceImagePaths: [sourcePath],
      skillId: 'extract-paid-model',
      skillVersion: '1.0.0',
      variables: { printAreaPreference: 'auto', allowMultiplePrints: true },
      promptCount: 1,
      llmModel: 'qwen3-vl-plus',
      model: 'gpt-image-2',
      aspectRatio: '1024x1024',
      concurrency: 3,
    })
    expect(extractResult).toMatchObject({ total: 1, succeeded: 1, failed: 0 })

    expect(state.skillIndexCalls).toBeGreaterThanOrEqual(1)
    expect(state.skillDetailIds).toEqual(
      expect.arrayContaining([
        'txt2img-local-print',
        'img2img-local-reference',
        'extract-paid-model',
      ]),
    )
    expect(state.bailianCalls).toBe(3)
    expect(JSON.stringify(state.bailianBodies[0])).toContain('E2E_TXT2IMG_SKILL')
    expect(JSON.stringify(state.bailianBodies[1])).toContain('E2E_IMG2IMG_SKILL')
    expect(JSON.stringify(state.bailianBodies[2])).toContain('E2E_EXTRACT_SKILL')
    expect(JSON.stringify(state.bailianBodies[1])).toContain('image_url')
    expect(state.grsaiCalls).toHaveLength(11)
    expect(state.cn429Count).toBe(1)
    expect(state.grsaiCalls[0]?.node).toBe('cn')
    expect(state.grsaiCalls.some((call) => call.node === 'global')).toBe(true)
    expect(state.maxActiveGrsaiRequests).toBeLessThanOrEqual(3)
    const img2imgGenerateCalls = state.grsaiCalls.filter((call) =>
      call.body.prompt?.startsWith('img2img style prompt'),
    )
    const img2imgDefaultCalls = img2imgGenerateCalls.filter(
      (call) => !call.body.prompt?.includes('with image reference'),
    )
    const img2imgWithReferenceCalls = img2imgGenerateCalls.filter((call) =>
      call.body.prompt?.includes('with image reference'),
    )
    expect(img2imgDefaultCalls).toHaveLength(3)
    expect(img2imgDefaultCalls.every((call) => !call.body.images?.length)).toBe(true)
    expect(img2imgWithReferenceCalls).toHaveLength(1)
    expect(img2imgWithReferenceCalls[0]?.body.images).toHaveLength(1)

    const rows = readArtifactRows(workbenchRoot)
    const sourceArtifact = rows.find((row) => row.step === 'manual-import')
    const extractArtifact = rows.find((row) => row.step === 'extract')
    expect(sourceArtifact).toBeTruthy()
    expect(extractArtifact).toMatchObject({
      step: 'extract',
      provider: 'grsai',
      prompt_snapshot: 'extract centered print prompt',
    })
    expect(JSON.parse(extractArtifact?.source_artifact_ids ?? '[]')).toEqual([sourceArtifact?.id])
    expect(extractArtifact?.file_path).toContain(join('02-印花工作区', '提取'))
  })
})
