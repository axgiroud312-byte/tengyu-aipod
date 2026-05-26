import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import type { Skill } from '@tengyu-aipod/shared'
import { http, HttpResponse } from 'msw'
import { setupServer } from 'msw/node'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { CHENYU_BASE_URL, ChenyuCloudClient, ChenyuInstanceStatus } from './chenyu-cloud-client'
import { ComfyHttpClient } from './comfy-http-client'
import { ComfyuiChenyuAdapter } from './comfyui-chenyu-adapter'
import { ComfyuiInstanceManager } from './comfyui-instance-manager'
import type { CachedComfyuiWorkflow, ComfyuiWorkflowCategory } from './comfyui-workflow-cache'
import {
  runComfyuiExtractBatch,
  runComfyuiImg2imgBatch,
  runComfyuiMattingBatch,
  runMixedMattingBatch,
} from './generation-service'
import type { SqliteDatabase } from './sqlite'

type TestDatabase = Pick<SqliteDatabase, 'exec' | 'prepare' | 'close'>
type ArtifactRow = {
  id: string
  task_id?: string
  print_id: string
  step: string
  provider?: string
  model_or_workflow?: string
  source_artifact_ids?: string
  file_path: string
  file_size?: number
  file_hash?: string
  prompt_snapshot?: string
  params_snapshot?: string
  created_at?: number
}
type ComfyInstanceRow = {
  provider: 'chenyu'
  instanceUuid: string
  comfyuiUrl: string
  podUuid: string | null
  gpuUuid: string | null
  gpuName: string | null
  status: string
  podPriceHour: number
  gpuPriceHour: number
  autoShutdownAt: number | null
  createdAt: number
  lastUsedAt: number | null
}

const server = setupServer()
const comfyBaseUrl = 'https://comfy.example'

let tempRoot = ''
let workbenchRoot = ''
let uploadedNames: string[] = []
let queuedPrompts: unknown[] = []
let viewedFilenames: string[] = []
let historyNodeId = '9'
let historyFilename = 'result.png'

vi.mock('electron', () => ({
  BrowserWindow: {
    getAllWindows: () => [],
  },
  ipcMain: {
    handle: vi.fn(),
  },
}))

vi.mock('../onboarding', () => ({
  readAppConfig: () => ({ workbench_root: workbenchRoot }),
}))

class FakeDb {
  artifacts: ArtifactRow[] = []
  instance: ComfyInstanceRow = {
    provider: 'chenyu',
    instanceUuid: 'inst-e2e',
    comfyuiUrl: comfyBaseUrl,
    podUuid: null,
    gpuUuid: null,
    gpuName: null,
    status: 'running',
    podPriceHour: 0,
    gpuPriceHour: 0,
    autoShutdownAt: null,
    createdAt: 1_700_000_000_000,
    lastUsedAt: 1_700_000_000_000,
  }
  exec = vi.fn()
  close = vi.fn()

  prepare(sql: string) {
    if (sql.includes('INSERT INTO artifacts')) {
      return {
        run: (...values: unknown[]) => {
          this.artifacts.push(artifactFromInsert(values))
        },
      }
    }

    if (sql.includes('SELECT id, print_id, file_path, step FROM artifacts WHERE id = ?')) {
      return {
        get: (id: string) => this.artifacts.find((row) => row.id === id),
      }
    }

    if (sql.includes('SELECT comfyui_url FROM comfyui_instances')) {
      return {
        get: () => ({ comfyui_url: this.instance.comfyuiUrl }),
      }
    }

    if (sql.includes('FROM comfyui_instances')) {
      return {
        get: () => this.instance,
      }
    }

    if (sql.includes('INSERT INTO comfyui_instances')) {
      return {
        run: (...values: unknown[]) => {
          this.instance = {
            provider: values[0] as 'chenyu',
            instanceUuid: String(values[1]),
            comfyuiUrl: String(values[2]),
            podUuid: nullableString(values[3]),
            gpuUuid: nullableString(values[4]),
            gpuName: nullableString(values[5]),
            status: String(values[6]),
            podPriceHour: Number(values[7]),
            gpuPriceHour: Number(values[8]),
            autoShutdownAt: nullableNumber(values[9]),
            createdAt: Number(values[10]),
            lastUsedAt: nullableNumber(values[11]),
          }
        },
      }
    }

    return {
      all: () => [],
      get: () => undefined,
      run: vi.fn(),
    }
  }
}

function nullableString(value: unknown) {
  return value === null || value === undefined ? null : String(value)
}

function nullableNumber(value: unknown) {
  return value === null || value === undefined ? null : Number(value)
}

function artifactFromInsert(values: unknown[]): ArtifactRow {
  if (values.length === 10) {
    return {
      id: String(values[0]),
      task_id: String(values[1]),
      print_id: String(values[2]),
      step: String(values[3]),
      provider: String(values[4]),
      source_artifact_ids: String(values[5]),
      file_path: String(values[6]),
      file_size: Number(values[7]),
      file_hash: String(values[8]),
      created_at: Number(values[9]),
    }
  }

  return {
    id: String(values[0]),
    task_id: String(values[1]),
    print_id: String(values[2]),
    step: String(values[3]),
    provider: String(values[4]),
    model_or_workflow: String(values[5]),
    source_artifact_ids: String(values[6]),
    file_path: String(values[7]),
    file_size: Number(values[8]),
    file_hash: String(values[9]),
    prompt_snapshot: String(values[10]),
    params_snapshot: String(values[11]),
    created_at: Number(values[12]),
  }
}

function createWorkflow(input: {
  id: string
  capability: ComfyuiWorkflowCategory
  inputSlots: CachedComfyuiWorkflow['inputSlots']
  outputNodeId: string
}): CachedComfyuiWorkflow {
  return {
    id: input.id,
    version: '1.0.0',
    name: input.id,
    capability: input.capability,
    workflowJson: {
      '1': { inputs: { image: '' } },
      '2': { inputs: { text: '' } },
      '3': { inputs: { image: '' } },
      [input.outputNodeId]: { inputs: {} },
    },
    inputSlots: input.inputSlots,
    outputSlots: [{ name: 'result', nodeId: input.outputNodeId, field: 'images' }],
    requiredModels: [],
  }
}

function createWorkflowCache(workflows: CachedComfyuiWorkflow[]) {
  return {
    get: vi.fn(async (workflowId: string, category: ComfyuiWorkflowCategory, version?: string) => {
      const workflow = workflows.find(
        (item) =>
          item.id === workflowId &&
          item.capability === category &&
          (version === undefined || item.version === version),
      )
      if (!workflow) {
        throw new Error(`missing workflow ${workflowId}:${category}:${version ?? 'latest'}`)
      }
      return workflow
    }),
  }
}

function createComfyuiAdapter(db: FakeDb, workflows: CachedComfyuiWorkflow[]) {
  return new ComfyuiChenyuAdapter({
    instanceManager: new ComfyuiInstanceManager({
      readConfig: async () => ({ workbench_root: workbenchRoot }),
      openDatabase: () => db as unknown as TestDatabase,
      chenyu: new ChenyuCloudClient('cy-key'),
    }),
    comfyHttp: new ComfyHttpClient(comfyBaseUrl, { pollIntervalMs: 1, pollTimeoutMs: 50 }),
    workflowCache: createWorkflowCache(workflows),
    workbenchRoot,
    openDatabase: () => db as unknown as TestDatabase,
  })
}

function extractMaskSkill(overrides: Partial<Skill> = {}): Skill {
  return {
    id: 'matting-mask-v1',
    module: 'generation',
    category: 'matting-mask',
    platform: null,
    language: null,
    version: '1.0.0',
    enabled: true,
    recommendedModel: 'nano-banana-2',
    notes: null,
    systemPrompt: 'Make a white background black print mask.',
    variables: [],
    ...overrides,
  }
}

function seedPrintArtifact(db: FakeDb, filePath: string) {
  db.artifacts.push({
    id: 'print-artifact',
    task_id: 'source-task',
    print_id: 'pri_print',
    step: 'extract',
    provider: 'comfyui-chenyu',
    source_artifact_ids: '[]',
    file_path: filePath,
    created_at: 1_700_000_000_000,
  })
}

async function createImage(path: string, content: string) {
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, content)
}

function outputArtifact(db: FakeDb, step: string) {
  const row = db.artifacts.find((artifact) => artifact.step === step && artifact.file_size)
  if (!row) {
    throw new Error(`missing ${step} artifact`)
  }
  return row
}

function useComfyHandlers() {
  server.use(
    http.get(`${CHENYU_BASE_URL}/instance/info`, ({ request }) => {
      expect(request.headers.get('authorization')).toBe('Bearer cy-key')
      expect(new URL(request.url).searchParams.get('instance_uuid')).toBe('inst-e2e')
      return HttpResponse.json({
        code: 0,
        msg: '成功',
        data: {
          instance_uuid: 'inst-e2e',
          status: ChenyuInstanceStatus.Running,
          server_map: [{ title: 'ComfyUI', port_type: 'http', url: comfyBaseUrl }],
        },
      })
    }),
    http.post(`${comfyBaseUrl}/upload/image`, async ({ request }) => {
      const form = await request.formData()
      const image = form.get('image')
      const originalName =
        image && typeof image === 'object' && 'name' in image ? String(image.name) : 'image.png'
      const uploadedName = `uploaded-${uploadedNames.length + 1}.png`
      uploadedNames.push(originalName)
      return HttpResponse.json({
        name: uploadedName,
        subfolder: '',
        type: 'input',
      })
    }),
    http.post(`${comfyBaseUrl}/prompt`, async ({ request }) => {
      const body = (await request.json()) as { prompt?: unknown }
      queuedPrompts.push(body.prompt)
      return HttpResponse.json({
        prompt_id: 'prompt-e2e',
        number: queuedPrompts.length,
        node_errors: {},
      })
    }),
    http.get(`${comfyBaseUrl}/history/prompt-e2e`, () =>
      HttpResponse.json({
        'prompt-e2e': {
          status: { completed: true },
          outputs: {
            [historyNodeId]: {
              images: [{ filename: historyFilename, subfolder: 'outputs', type: 'output' }],
            },
          },
        },
      }),
    ),
    http.get(`${comfyBaseUrl}/view`, ({ request }) => {
      const filename = new URL(request.url).searchParams.get('filename') ?? ''
      viewedFilenames.push(filename)
      return new HttpResponse(Buffer.from(`image:${filename}`))
    }),
  )
}

beforeAll(() => {
  server.listen({ onUnhandledRequest: 'error' })
})

beforeEach(async () => {
  const { mkdtemp } = await import('node:fs/promises')
  tempRoot = await mkdtemp(join(tmpdir(), 'tengyu-generation-comfyui-e2e-'))
  workbenchRoot = join(tempRoot, 'workbench')
  uploadedNames = []
  queuedPrompts = []
  viewedFilenames = []
  historyNodeId = '9'
  historyFilename = 'result.png'
  useComfyHandlers()
  await mkdir(join(workbenchRoot, '01-采集'), { recursive: true })
})

afterEach(async () => {
  server.resetHandlers()
  await rm(tempRoot, { recursive: true, force: true })
})

afterAll(() => {
  server.close()
})

describe('generation ComfyUI mocked E2E', () => {
  it('runs extract through Chenyu and ComfyUI, injects inputs, parses output filename, and writes the extract artifact', async () => {
    const sourcePath = join(workbenchRoot, '01-采集', 'sku-a', 'source.png')
    await createImage(sourcePath, 'source-image')
    const db = new FakeDb()
    const workflow = createWorkflow({
      id: 'extract-e2e',
      capability: 'extract',
      outputNodeId: '90',
      inputSlots: [
        { name: 'sourceImage', nodeId: '1', field: 'image' },
        { name: 'prompt', nodeId: '2', field: 'text' },
      ],
    })
    historyNodeId = '90'
    historyFilename = 'extract-result.webp'

    const result = await runComfyuiExtractBatch(
      {
        sourceImagePaths: [sourcePath],
        workflowId: 'extract-e2e',
        workflowVersion: '1.0.0',
        prompt: 'extract print',
        taskId: 'extract-e2e-task',
      },
      {
        readConfig: async () => ({ workbench_root: workbenchRoot }),
        getSecret: async () => 'cy-key',
        openDatabase: () => db as unknown as TestDatabase,
        createComfyuiAdapter: () => createComfyuiAdapter(db, [workflow]),
      },
    )

    expect(result.failures).toEqual([])
    expect(result).toMatchObject({ taskId: 'extract-e2e-task', succeeded: 1, failed: 0 })
    expect(uploadedNames).toEqual(['reference-1.png'])
    expect(queuedPrompts[0]).toEqual({
      '1': { inputs: { image: 'uploaded-1.png' } },
      '2': { inputs: { text: 'extract print' } },
      '3': { inputs: { image: '' } },
      '90': { inputs: {} },
    })
    expect(viewedFilenames).toEqual(['extract-result.webp'])
    expect(result.images[0]?.localPath).toContain(join('02-生图', '03-提取'))
    expect(result.images[0]?.localPath).toMatch(/\.webp$/)
    await expect(readFile(result.images[0]?.localPath ?? '', 'utf8')).resolves.toBe(
      'image:extract-result.webp',
    )
    const artifact = outputArtifact(db, 'extract')
    expect(artifact.provider).toBe('comfyui-chenyu')
    expect(artifact.model_or_workflow).toBe('extract-e2e')
    expect(artifact.file_path).toBe(result.images[0]?.localPath)
  })

  it('runs img2img through Chenyu and ComfyUI, injects inputs, and writes a versioned print output', async () => {
    const printPath = join(workbenchRoot, '02-生图', '03-提取', 'print.png')
    await createImage(printPath, 'print-image')
    const db = new FakeDb()
    seedPrintArtifact(db, printPath)
    const workflow = createWorkflow({
      id: 'img2img-e2e',
      capability: 'img2img',
      outputNodeId: '91',
      inputSlots: [
        { name: 'sourceImage', nodeId: '1', field: 'image' },
        { name: 'prompt', nodeId: '2', field: 'text' },
      ],
    })
    historyNodeId = '91'
    historyFilename = 'ignored-comfy-name.jpg'

    const result = await runComfyuiImg2imgBatch(
      {
        sourceArtifactIds: ['print-artifact'],
        workflowId: 'img2img-e2e',
        workflowVersion: '1.0.0',
        prompt: 'make a variation',
        taskId: 'img2img-e2e-task',
      },
      {
        readConfig: async () => ({ workbench_root: workbenchRoot }),
        getSecret: async () => 'cy-key',
        openDatabase: () => db as unknown as TestDatabase,
        createComfyuiAdapter: () => createComfyuiAdapter(db, [workflow]),
      },
    )

    const expectedPath = join(workbenchRoot, '02-生图', '02-图生图', 'pri_print_v1.png')
    expect(result.failures).toEqual([])
    expect(result).toMatchObject({ taskId: 'img2img-e2e-task', succeeded: 1, failed: 0 })
    expect(queuedPrompts[0]).toEqual({
      '1': { inputs: { image: 'uploaded-1.png' } },
      '2': { inputs: { text: 'make a variation' } },
      '3': { inputs: { image: '' } },
      '91': { inputs: {} },
    })
    expect(viewedFilenames).toEqual(['ignored-comfy-name.jpg'])
    expect(result.images[0]?.localPath).toBe(expectedPath)
    await expect(readFile(expectedPath, 'utf8')).resolves.toBe('image:ignored-comfy-name.jpg')
    const artifact = outputArtifact(db, 'img2img')
    expect(artifact.file_path).toBe(expectedPath)
    expect(artifact.source_artifact_ids).toBe(JSON.stringify(['print-artifact']))
  })

  it('runs direct matting through Chenyu and ComfyUI, injects inputs, and writes the transparent PNG output', async () => {
    const printPath = join(workbenchRoot, '02-生图', '03-提取', 'print.png')
    await createImage(printPath, 'print-image')
    const db = new FakeDb()
    seedPrintArtifact(db, printPath)
    const workflow = createWorkflow({
      id: 'matting-e2e',
      capability: 'matting',
      outputNodeId: '92',
      inputSlots: [
        { name: 'sourceImage', nodeId: '1', field: 'image' },
        { name: 'prompt', nodeId: '2', field: 'text' },
      ],
    })
    historyNodeId = '92'
    historyFilename = 'direct-alpha.webp'

    const result = await runComfyuiMattingBatch(
      {
        sourceArtifactIds: ['print-artifact'],
        workflowId: 'matting-e2e',
        workflowVersion: '1.0.0',
        prompt: 'remove background',
        taskId: 'matting-e2e-task',
      },
      {
        readConfig: async () => ({ workbench_root: workbenchRoot }),
        getSecret: async () => 'cy-key',
        openDatabase: () => db as unknown as TestDatabase,
        createComfyuiAdapter: () => createComfyuiAdapter(db, [workflow]),
      },
    )

    const expectedPath = join(workbenchRoot, '02-生图', '04-抠图', 'pri_print.png')
    expect(result.failures).toEqual([])
    expect(result).toMatchObject({ taskId: 'matting-e2e-task', succeeded: 1, failed: 0 })
    expect(queuedPrompts[0]).toEqual({
      '1': { inputs: { image: 'uploaded-1.png' } },
      '2': { inputs: { text: 'remove background' } },
      '3': { inputs: { image: '' } },
      '92': { inputs: {} },
    })
    expect(viewedFilenames).toEqual(['direct-alpha.webp'])
    expect(result.images[0]?.localPath).toBe(expectedPath)
    await expect(readFile(expectedPath, 'utf8')).resolves.toBe('image:direct-alpha.webp')
    const artifact = outputArtifact(db, 'matting')
    expect(artifact.provider).toBe('comfyui-chenyu')
    expect(artifact.file_path).toBe(expectedPath)
  })

  it('runs mixed matting with a Grsai mask, injects source and mask slots separately, writes the mixed artifact, and cleans temp files', async () => {
    const printPath = join(workbenchRoot, '02-生图', '03-提取', 'print.png')
    await createImage(printPath, 'print-image')
    const db = new FakeDb()
    seedPrintArtifact(db, printPath)
    const workflow = createWorkflow({
      id: 'matting-mixed-e2e',
      capability: 'matting-mixed',
      outputNodeId: '93',
      inputSlots: [
        { name: 'sourceImage', nodeId: '1', field: 'image' },
        { name: 'prompt', nodeId: '2', field: 'text' },
        { name: 'maskImage', nodeId: '3', field: 'image' },
      ],
    })
    historyNodeId = '93'
    historyFilename = 'mixed-alpha.png'
    const tempDir = join(workbenchRoot, '.workbench', 'tmp', 'matting', 'mixed-e2e-task')
    const maskPath = join(tempDir, 'mask.png')
    const createTaskDir = vi.fn(async () => {
      await mkdir(tempDir, { recursive: true })
      return tempDir
    })
    const cleanupTask = vi.fn(async () => {
      await rm(tempDir, { recursive: true, force: true })
    })
    const generateMask = vi.fn().mockResolvedValue({
      status: 'succeeded',
      images: [{ url: 'https://example.test/mask.png' }],
    })

    const result = await runMixedMattingBatch(
      {
        sourceArtifactIds: ['print-artifact'],
        workflowId: 'matting-mixed-e2e',
        workflowVersion: '1.0.0',
        prompt: 'composite alpha',
        taskId: 'mixed-e2e-task',
      },
      {
        readConfig: async () => ({ workbench_root: workbenchRoot }),
        getSecret: async (key) => (key === 'grsai' ? 'sk-grsai' : 'cy-key'),
        openDatabase: () => db as unknown as TestDatabase,
        createComfyuiAdapter: () => createComfyuiAdapter(db, [workflow]),
        skillCache: {
          listSkills: vi.fn().mockResolvedValue([extractMaskSkill()]),
          getSkill: vi.fn().mockResolvedValue(extractMaskSkill()),
        },
        createGrsaiAdapter: () => ({ generate: generateMask }),
        downloadImage: vi.fn().mockResolvedValue(Buffer.from('mask-image')),
        tempFiles: { createTaskDir, cleanupTask },
      },
    )

    const expectedPath = join(workbenchRoot, '02-生图', '04-抠图', 'pri_print.png')
    expect(result.failures).toEqual([])
    expect(result).toMatchObject({ taskId: 'mixed-e2e-task', succeeded: 1, failed: 0 })
    expect(generateMask).toHaveBeenCalledWith(
      expect.objectContaining({
        capability: 'img2img',
        prompt: 'Make a white background black print mask.',
      }),
    )
    expect(uploadedNames).toEqual(['reference-1.png', 'reference-2.png'])
    expect(queuedPrompts[0]).toEqual({
      '1': { inputs: { image: 'uploaded-1.png' } },
      '2': { inputs: { text: 'composite alpha' } },
      '3': { inputs: { image: 'uploaded-2.png' } },
      '93': { inputs: {} },
    })
    expect(viewedFilenames).toEqual(['mixed-alpha.png'])
    expect(result.images[0]?.localPath).toBe(expectedPath)
    await expect(readFile(expectedPath, 'utf8')).resolves.toBe('image:mixed-alpha.png')
    const artifact = outputArtifact(db, 'matting')
    expect(artifact.provider).toBe('grsai+comfyui-mask')
    expect(artifact.file_path).toBe(expectedPath)
    expect(createTaskDir).toHaveBeenCalledWith('matting', 'mixed-e2e-task')
    expect(cleanupTask).toHaveBeenCalledWith('matting', 'mixed-e2e-task')
    await expect(stat(maskPath)).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(stat(tempDir)).rejects.toMatchObject({ code: 'ENOENT' })
  })
})
