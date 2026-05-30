import type { ComfyuiWorkflow } from '@tengyu-aipod/shared'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  ComfyuiChenyuAdapter,
  type ComfyuiExecutionDatabase,
  injectComfyuiInputs,
  outputsFromHistory,
} from './comfyui-chenyu-adapter'
import type { CachedComfyuiWorkflow } from './comfyui-workflow-cache'

const workflow: ComfyuiWorkflow = {
  id: 'extract-v3',
  version: '3.0.1',
  name: 'Extract',
  capability: 'extract',
  workflowJson: {
    '1': { inputs: { image: '' } },
    '2': { inputs: { text: '' } },
    '9': { inputs: {} },
  },
  inputSlots: [
    { name: 'sourceImage', nodeId: '1', field: 'image' },
    { name: 'prompt', nodeId: '2', field: 'text' },
  ],
  outputSlots: [{ name: 'result', nodeId: '9', field: 'images' }],
  requiredModels: [],
}

let files = new Map<string, Buffer>()

vi.mock('node:fs/promises', async (importOriginal) => {
  const original = await importOriginal<typeof import('node:fs/promises')>()
  return {
    ...original,
    mkdir: vi.fn(),
    writeFile: vi.fn(async (path: string, buffer: Buffer) => {
      files.set(path, buffer)
    }),
    readFile: vi.fn(async (path: string) => files.get(path) ?? Buffer.from('')),
    stat: vi.fn(async (path: string) => {
      const buffer = files.get(path)
      if (!buffer) {
        const error = new Error('ENOENT') as NodeJS.ErrnoException
        error.code = 'ENOENT'
        throw error
      }
      return { size: buffer.byteLength }
    }),
  }
})

function createDb() {
  const rows: unknown[][] = []
  return {
    rows,
    db: {
      exec: vi.fn(),
      prepare: vi.fn(() => ({
        run: (...values: unknown[]) => rows.push(values),
      })),
      close: vi.fn(),
    } as unknown as ComfyuiExecutionDatabase,
  }
}

beforeEach(() => {
  files = new Map<string, Buffer>()
})

describe('ComfyuiChenyuAdapter', () => {
  it('uploads inputs, injects workflow, queues prompt, downloads outputs, and registers artifacts', async () => {
    const db = createDb()
    const uploadImage = vi.fn().mockResolvedValue('uploaded.png')
    const queuePrompt = vi.fn().mockResolvedValue('prompt-1')
    const getHistory = vi.fn().mockResolvedValue({
      status: { completed: true },
      outputs: { '9': { images: [{ filename: 'result.png' }] } },
    })
    const viewImage = vi.fn().mockResolvedValue(Buffer.from('result-bytes'))
    const adapter = new ComfyuiChenyuAdapter({
      instanceManager: {
        refreshCurrentInstance: vi.fn().mockResolvedValue({
          status: 'running',
          instanceUuid: 'inst-1',
          comfyuiUrl: 'https://comfy.example',
        }),
      },
      comfyHttp: { uploadImage, queuePrompt, getHistory, viewImage },
      workflowCache: { get: vi.fn().mockResolvedValue(workflow) },
      workbenchRoot: '/workbench',
      openDatabase: () => db.db,
      now: () => 1_700_000_000_000,
    })

    const response = await adapter.generate({
      capability: 'extract',
      prompt: 'extract the floral print',
      workflow_id: 'extract-v3',
      reference_images: [
        { base64: Buffer.from('source').toString('base64'), mime_type: 'image/png' },
      ],
      output: { format: 'png' },
      options: { taskId: 'task-1', sourceArtifactIds: ['source-artifact'] },
    })

    expect(response.status).toBe('succeeded')
    expect(uploadImage).toHaveBeenCalledWith(Buffer.from('source'), 'reference-1.png')
    expect(queuePrompt).toHaveBeenCalledWith({
      '1': { inputs: { image: 'uploaded.png' } },
      '2': { inputs: { text: 'extract the floral print' } },
      '9': { inputs: {} },
    })
    expect(getHistory).toHaveBeenCalledWith('prompt-1')
    expect(viewImage).toHaveBeenCalledWith('result.png')
    expect(response.images[0]?.local_path).toContain('/workbench/02-生图/03-提取/')
    expect(db.rows[0]).toEqual(
      expect.arrayContaining([
        'task-1',
        'extract',
        'comfyui-chenyu',
        'extract-v3',
        JSON.stringify(['source-artifact']),
        'extract the floral print',
      ]),
    )
    expect(db.db.close).toHaveBeenCalledTimes(1)
  })

  it('uses the refreshed instance URL when creating the ComfyUI client', async () => {
    const db = createDb()
    const txtWorkflow: ComfyuiWorkflow = {
      ...workflow,
      capability: 'txt2img',
      inputSlots: [{ name: 'prompt', nodeId: '2', field: 'text' }],
    }
    const uploadImage = vi.fn()
    const queuePrompt = vi.fn().mockResolvedValue('prompt-1')
    const getHistory = vi.fn().mockResolvedValue({
      status: { completed: true },
      outputs: { '9': { images: [{ filename: 'result.png' }] } },
    })
    const viewImage = vi.fn().mockResolvedValue(Buffer.from('result-bytes'))
    const createComfyHttp = vi.fn(() => ({
      uploadImage,
      queuePrompt,
      getHistory,
      viewImage,
    }))
    const adapter = new ComfyuiChenyuAdapter({
      instanceManager: {
        refreshCurrentInstance: vi.fn().mockResolvedValue({
          status: 'running',
          instanceUuid: 'inst-1',
          comfyuiUrl: 'https://fresh-comfy.example',
        }),
      },
      createComfyHttp,
      workflowCache: { get: vi.fn().mockResolvedValue(txtWorkflow) },
      workbenchRoot: '/workbench',
      openDatabase: () => db.db,
      now: () => 1_700_000_000_000,
    })

    await adapter.generate({
      capability: 'txt2img',
      prompt: 'flower print',
      workflow_id: 'txt2img-v1',
      output: { format: 'png' },
      options: { taskId: 'task-1' },
    })

    expect(createComfyHttp).toHaveBeenCalledWith('https://fresh-comfy.example')
    expect(queuePrompt).toHaveBeenCalled()
    expect(viewImage).toHaveBeenCalledWith('result.png')
  })

  it('writes img2img outputs with source print id version names', async () => {
    const img2imgWorkflow: ComfyuiWorkflow = {
      ...workflow,
      id: 'img2img-v1',
      capability: 'img2img',
    }
    const db = createDb()
    const adapter = new ComfyuiChenyuAdapter({
      instanceManager: {
        refreshCurrentInstance: vi.fn().mockResolvedValue({
          status: 'running',
          instanceUuid: 'inst-1',
          comfyuiUrl: 'https://comfy.example',
        }),
      },
      comfyHttp: {
        uploadImage: vi.fn().mockResolvedValue('uploaded.png'),
        queuePrompt: vi.fn().mockResolvedValue('prompt-1'),
        getHistory: vi.fn().mockResolvedValue({
          status: { completed: true },
          outputs: { '9': { images: [{ filename: 'result.png' }] } },
        }),
        viewImage: vi.fn().mockResolvedValue(Buffer.from('result-bytes')),
      },
      workflowCache: { get: vi.fn().mockResolvedValue(img2imgWorkflow) },
      workbenchRoot: '/workbench',
      openDatabase: () => db.db,
    })

    const response = await adapter.generate({
      capability: 'img2img',
      prompt: 'variation',
      workflow_id: 'img2img-v1',
      reference_images: [
        { base64: Buffer.from('source').toString('base64'), mime_type: 'image/png' },
      ],
      output: { format: 'png' },
      options: {
        taskId: 'img2img-task',
        sourceArtifactIds: ['source-artifact'],
        printId: 'pri_print',
      },
    })

    expect(response.images[0]?.local_path).toBe('/workbench/02-生图/02-图生图/pri_print_v1.png')
    expect(db.rows[0]).toEqual(
      expect.arrayContaining([
        'img2img-task',
        'pri_print',
        'img2img',
        'comfyui-chenyu',
        'img2img-v1',
        JSON.stringify(['source-artifact']),
      ]),
    )
  })

  it('runs txt2img workflows without uploading reference images', async () => {
    const txt2imgWorkflow: ComfyuiWorkflow = {
      ...workflow,
      id: 'txt2img-v1',
      capability: 'txt2img',
      workflowJson: {
        '2': { inputs: { text: '' } },
        '9': { inputs: {} },
      },
      inputSlots: [{ name: 'prompt', nodeId: '2', field: 'text' }],
    }
    const db = createDb()
    const uploadImage = vi.fn()
    const adapter = new ComfyuiChenyuAdapter({
      instanceManager: {
        refreshCurrentInstance: vi.fn().mockResolvedValue({
          status: 'running',
          instanceUuid: 'inst-1',
          comfyuiUrl: 'https://comfy.example',
        }),
      },
      comfyHttp: {
        uploadImage,
        queuePrompt: vi.fn().mockResolvedValue('prompt-1'),
        getHistory: vi.fn().mockResolvedValue({
          status: { completed: true },
          outputs: { '9': { images: [{ filename: 'result.png' }] } },
        }),
        viewImage: vi.fn().mockResolvedValue(Buffer.from('result-bytes')),
      },
      workflowCache: { get: vi.fn().mockResolvedValue(txt2imgWorkflow) },
      workbenchRoot: '/workbench',
      openDatabase: () => db.db,
    })

    const response = await adapter.generate({
      capability: 'txt2img',
      prompt: 'centered floral print',
      workflow_id: 'txt2img-v1',
      output: { format: 'png', size_px: { width: 1024, height: 1024 } },
      options: { taskId: 'txt2img-task', width: 1024, height: 1024 },
    })

    expect(uploadImage).not.toHaveBeenCalled()
    expect(response.images[0]?.local_path).toContain('/workbench/02-生图/01-文生图/')
    expect(db.rows[0]).toEqual(
      expect.arrayContaining([
        'txt2img-task',
        'txt2img',
        'comfyui-chenyu',
        'txt2img-v1',
        JSON.stringify([]),
        'centered floral print',
      ]),
    )
  })

  it('writes matting outputs with source print id png names', async () => {
    const mattingWorkflow: ComfyuiWorkflow = {
      ...workflow,
      id: 'matting-v1',
      capability: 'matting',
    }
    const db = createDb()
    const adapter = new ComfyuiChenyuAdapter({
      instanceManager: {
        refreshCurrentInstance: vi.fn().mockResolvedValue({
          status: 'running',
          instanceUuid: 'inst-1',
          comfyuiUrl: 'https://comfy.example',
        }),
      },
      comfyHttp: {
        uploadImage: vi.fn().mockResolvedValue('uploaded.png'),
        queuePrompt: vi.fn().mockResolvedValue('prompt-1'),
        getHistory: vi.fn().mockResolvedValue({
          status: { completed: true },
          outputs: { '9': { images: [{ filename: 'result.webp' }] } },
        }),
        viewImage: vi.fn().mockResolvedValue(Buffer.from('result-bytes')),
      },
      workflowCache: { get: vi.fn().mockResolvedValue(mattingWorkflow) },
      workbenchRoot: '/workbench',
      openDatabase: () => db.db,
    })

    const response = await adapter.generate({
      capability: 'matting',
      prompt: 'remove background',
      workflow_id: 'matting-v1',
      reference_images: [
        { base64: Buffer.from('source').toString('base64'), mime_type: 'image/png' },
      ],
      output: { format: 'png' },
      options: {
        taskId: 'matting-task',
        sourceArtifactIds: ['source-artifact'],
        printId: 'pri_print',
      },
    })

    expect(response.images[0]?.local_path).toBe('/workbench/02-生图/04-抠图/pri_print.png')
    expect(db.rows[0]).toEqual(
      expect.arrayContaining([
        'matting-task',
        'pri_print',
        'matting',
        'comfyui-chenyu',
        'matting-v1',
        JSON.stringify(['source-artifact']),
      ]),
    )
  })

  it('registers mixed matting outputs with the mixed provider', async () => {
    const mixedWorkflow: CachedComfyuiWorkflow = {
      ...workflow,
      id: 'matting-mixed-v1',
      capability: 'matting-mixed',
    }
    const db = createDb()
    const adapter = new ComfyuiChenyuAdapter({
      instanceManager: {
        refreshCurrentInstance: vi.fn().mockResolvedValue({
          status: 'running',
          instanceUuid: 'inst-1',
          comfyuiUrl: 'https://comfy.example',
        }),
      },
      comfyHttp: {
        uploadImage: vi.fn().mockResolvedValue('uploaded.png'),
        queuePrompt: vi.fn().mockResolvedValue('prompt-1'),
        getHistory: vi.fn().mockResolvedValue({
          status: { completed: true },
          outputs: { '9': { images: [{ filename: 'result.png' }] } },
        }),
        viewImage: vi.fn().mockResolvedValue(Buffer.from('result-bytes')),
      },
      workflowCache: { get: vi.fn().mockResolvedValue(mixedWorkflow) },
      workbenchRoot: '/workbench',
      openDatabase: () => db.db,
    })

    await adapter.generate({
      capability: 'matting',
      prompt: 'composite',
      workflow_id: 'matting-mixed-v1',
      reference_images: [
        { base64: Buffer.from('source').toString('base64'), mime_type: 'image/png' },
        { base64: Buffer.from('mask').toString('base64'), mime_type: 'image/png' },
      ],
      output: { format: 'png' },
      options: {
        taskId: 'mixed-task',
        sourceArtifactIds: ['source-artifact'],
        printId: 'pri_print',
        workflowCategory: 'matting-mixed',
        artifactProvider: 'grsai+comfyui-mask',
      },
    })

    expect(db.rows[0]).toEqual(
      expect.arrayContaining([
        'mixed-task',
        'pri_print',
        'matting',
        'grsai+comfyui-mask',
        'matting-mixed-v1',
      ]),
    )
  })

  it('injects mixed matting source and mask images into separate workflow slots', () => {
    const injected = injectComfyuiInputs(
      {
        '1': { inputs: { image: '' } },
        '2': { inputs: { image: '' } },
      },
      [
        { name: 'sourceImage', nodeId: '1', field: 'image', imageIndex: 0 },
        { name: 'maskImage', nodeId: '2', field: 'image', imageIndex: 1 },
      ],
      {
        capability: 'matting',
        prompt: 'mix',
        workflow_id: 'matting-mixed-v1',
        reference_images: [
          { base64: Buffer.from('source').toString('base64'), mime_type: 'image/png' },
          { base64: Buffer.from('mask').toString('base64'), mime_type: 'image/png' },
        ],
        output: { format: 'png' },
      },
      { uploadedImages: ['source.png', 'mask.png'] },
    )

    expect(injected).toEqual({
      '1': { inputs: { image: 'source.png' } },
      '2': { inputs: { image: 'mask.png' } },
    })
  })

  it('throws CHENYU_INSTANCE_DOWN when no running instance is available', async () => {
    const adapter = new ComfyuiChenyuAdapter({
      instanceManager: { refreshCurrentInstance: vi.fn().mockResolvedValue({ status: 'stopped' }) },
      comfyHttp: {
        uploadImage: vi.fn(),
        queuePrompt: vi.fn(),
        getHistory: vi.fn(),
        viewImage: vi.fn(),
      },
      workflowCache: { get: vi.fn() },
      workbenchRoot: '/workbench',
      openDatabase: () => createDb().db,
    })

    await expect(
      adapter.generate({ capability: 'extract', prompt: 'x', workflow_id: 'wf', output: {} }),
    ).rejects.toMatchObject({
      code: 'CHENYU_INSTANCE_DOWN',
      message: '默认云机未运行，请先到设置页开机',
      retryable: false,
    })
  })

  it('injects options into matching slots and keeps the original workflow unchanged', () => {
    const injected = injectComfyuiInputs(
      { '1': { inputs: { strength: 0 } } },
      [{ name: 'strength', nodeId: '1', field: 'strength' }],
      {
        capability: 'img2img',
        prompt: 'prompt',
        output: {},
        options: { strength: 0.7 },
      },
      { uploadedImages: [] },
    )

    expect(injected).toEqual({ '1': { inputs: { strength: 0.7 } } })
  })

  it('requires output images from configured output slots', () => {
    expect(() =>
      outputsFromHistory({ outputs: { '9': { text: ['not image'] } } }, [
        { name: 'result', nodeId: '9', field: 'images' },
      ]),
    ).toThrow('ComfyUI 未返回输出图片')
  })
})
