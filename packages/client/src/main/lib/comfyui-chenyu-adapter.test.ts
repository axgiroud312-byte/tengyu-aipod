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
    expect(viewImage).toHaveBeenCalledWith({ filename: 'result.png' })
    expect(response.images[0]?.local_path).toContain('/workbench/02-印花工作区/提取/task-1/')
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

  it('can persist temporary outputs without registering artifacts and only keep the first output', async () => {
    const db = createDb()
    const viewImage = vi.fn().mockResolvedValue(Buffer.from('result-bytes'))
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
          outputs: {
            '9': {
              images: [{ filename: 'first.png' }, { filename: 'second.png' }],
            },
          },
        }),
        viewImage,
      },
      workflowCache: { get: vi.fn().mockResolvedValue(workflow) },
      workbenchRoot: '/workbench',
      openDatabase: () => db.db,
      now: () => 1_700_000_000_000,
    })

    const response = await adapter.generate({
      capability: 'extract',
      prompt: 'temporary extract',
      workflow_id: 'extract-v3',
      reference_images: [
        { base64: Buffer.from('source').toString('base64'), mime_type: 'image/png' },
      ],
      output: { format: 'png' },
      options: {
        taskId: 'extract-temp-task',
        printId: 'pri_temp',
        outputFolderOverride: '/workbench/.workbench/tmp/matting/extract-temp-task/extract-1',
        registerArtifact: false,
        maxOutputs: 1,
      },
    })

    expect(response.images).toHaveLength(1)
    expect(response.images[0]?.local_path).toBe(
      '/workbench/.workbench/tmp/matting/extract-temp-task/extract-1/pri_temp.png',
    )
    expect(viewImage).toHaveBeenCalledTimes(1)
    expect(viewImage).toHaveBeenCalledWith({ filename: 'first.png' })
    expect(db.rows).toHaveLength(0)
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
    expect(viewImage).toHaveBeenCalledWith({ filename: 'result.png' })
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

    expect(response.images[0]?.local_path).toBe(
      '/workbench/02-印花工作区/图生图/img2img-task/pri_print_v1.png',
    )
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

  it('converts UI workflow JSON and injects img2img batch size', async () => {
    const uiWorkflow: CachedComfyuiWorkflow = {
      id: 'ui-img2img-v1',
      version: '1.0.0',
      name: 'UI Img2Img',
      capability: 'img2img',
      workflowFormat: 'ui',
      workflowJson: {
        nodes: [
          { id: 1, type: 'LoadImage', widgets_values: ['source.png', 'image'] },
          { id: 2, type: 'PrimitiveInt', widgets_values: [1, 'fixed'] },
          { id: 3, type: 'CLIPTextEncode', widgets_values: ['old prompt'] },
          {
            id: 4,
            type: 'EmptyImage',
            inputs: [{ name: 'batch_size', type: 'INT', link: 20 }],
            widgets_values: [512, 512, 1, 0],
          },
          { id: 9, type: 'SaveImage', inputs: [{ name: 'images', type: 'IMAGE', link: 21 }] },
        ],
        links: [
          [20, 2, 0, 4, 2, 'INT'],
          [21, 4, 0, 9, 0, 'IMAGE'],
        ],
      },
      inputSlots: [
        { name: 'image_1', nodeId: '1', field: 'image', imageIndex: 0 },
        { name: 'batchSize', nodeId: '2', field: 'value' },
        { name: 'prompt', nodeId: '3', field: 'text' },
      ],
      outputSlots: [{ name: 'result', nodeId: '9', field: 'images' }],
      requiredModels: [],
    }
    const db = createDb()
    const queuePrompt = vi.fn().mockResolvedValue('prompt-1')
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
        queuePrompt,
        getHistory: vi.fn().mockResolvedValue({
          status: { completed: true },
          outputs: { '9': { images: [{ filename: 'result.png' }] } },
        }),
        viewImage: vi.fn().mockResolvedValue(Buffer.from('result-bytes')),
        getObjectInfo: vi.fn().mockResolvedValue({
          LoadImage: {
            input: { required: { image: ['IMAGEUPLOAD', {}] } },
            input_order: { required: ['image'] },
          },
          PrimitiveInt: {
            input: {
              required: { value: ['INT', {}] },
              optional: { control_after_generate: [['fixed'], {}] },
            },
            input_order: { required: ['value'], optional: ['control_after_generate'] },
          },
          CLIPTextEncode: {
            input: { required: { text: ['STRING', {}] } },
            input_order: { required: ['text'] },
          },
          EmptyImage: {
            input: {
              required: {
                width: ['INT', {}],
                height: ['INT', {}],
                batch_size: ['INT', {}],
                color: ['INT', {}],
              },
            },
            input_order: { required: ['width', 'height', 'batch_size', 'color'] },
          },
          SaveImage: {
            input: { required: { images: ['IMAGE', {}] } },
            input_order: { required: ['images'] },
          },
        }),
      },
      workflowCache: { get: vi.fn().mockResolvedValue(uiWorkflow) },
      workbenchRoot: '/workbench',
      openDatabase: () => db.db,
    })

    await adapter.generate({
      capability: 'img2img',
      prompt: 'variation',
      workflow_id: 'ui-img2img-v1',
      reference_images: [
        { base64: Buffer.from('source').toString('base64'), mime_type: 'image/png' },
      ],
      output: { format: 'png' },
      options: { taskId: 'ui-task', batchSize: 4 },
    })

    expect(queuePrompt).toHaveBeenCalledWith(
      expect.objectContaining({
        '1': expect.objectContaining({
          inputs: expect.objectContaining({ image: 'uploaded.png' }),
        }),
        '2': expect.objectContaining({ inputs: expect.objectContaining({ value: 4 }) }),
        '3': expect.objectContaining({ inputs: expect.objectContaining({ text: 'variation' }) }),
        '4': expect.objectContaining({
          inputs: expect.objectContaining({ batch_size: ['2', 0] }),
        }),
      }),
    )
  })

  it('rejects img2img multi-output runs when the workflow has no batch input', async () => {
    const adapter = new ComfyuiChenyuAdapter({
      instanceManager: {
        refreshCurrentInstance: vi.fn().mockResolvedValue({
          status: 'running',
          instanceUuid: 'inst-1',
          comfyuiUrl: 'https://comfy.example',
        }),
      },
      comfyHttp: {
        uploadImage: vi.fn(),
        queuePrompt: vi.fn(),
        getHistory: vi.fn(),
        viewImage: vi.fn(),
      },
      workflowCache: {
        get: vi.fn().mockResolvedValue({
          ...workflow,
          capability: 'img2img',
        }),
      },
      workbenchRoot: '/workbench',
      openDatabase: () => createDb().db,
    })

    await expect(
      adapter.generate({
        capability: 'img2img',
        prompt: 'variation',
        workflow_id: 'img2img-v1',
        reference_images: [
          { base64: Buffer.from('source').toString('base64'), mime_type: 'image/png' },
        ],
        output: { format: 'png' },
        options: { taskId: 'task-1', batchSize: 2 },
      }),
    ).rejects.toThrow('当前工作流不支持一次多图')
  })

  it('runs txt2img workflows without uploading reference images', async () => {
    const txt2imgWorkflow: ComfyuiWorkflow = {
      ...workflow,
      id: 'txt2img-v1',
      capability: 'txt2img',
      workflowJson: {
        '2': { inputs: { text: '' } },
        '3': { inputs: { width: 0, height: 0 } },
        '9': { inputs: {} },
      },
      inputSlots: [
        { name: 'prompt', nodeId: '2', field: 'text' },
        { name: 'width', nodeId: '3', field: 'width' },
        { name: 'height', nodeId: '3', field: 'height' },
      ],
    }
    const db = createDb()
    const uploadImage = vi.fn()
    const queuePrompt = vi.fn().mockResolvedValue('prompt-1')
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
        queuePrompt,
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
    expect(queuePrompt).toHaveBeenCalledWith({
      '2': { inputs: { text: 'centered floral print' } },
      '3': { inputs: { width: 1024, height: 1024 } },
      '9': { inputs: {} },
    })
    expect(response.images[0]?.local_path).toContain(
      '/workbench/02-印花工作区/文生图/txt2img-task/',
    )
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

    expect(response.images[0]?.local_path).toBe(
      '/workbench/02-印花工作区/抠图/matting-task/pri_print.png',
    )
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

  it('preserves workflow prompt slots when requested while still injecting other inputs', () => {
    const injected = injectComfyuiInputs(
      {
        '1': { inputs: { text: 'workflow default prompt' } },
        '2': { inputs: { width: 0 } },
        '3': { inputs: { image: '' } },
      },
      [
        { name: 'prompt', nodeId: '1', field: 'text' },
        { name: 'width', nodeId: '2', field: 'width' },
        { name: 'sourceImage', nodeId: '3', field: 'image' },
      ],
      {
        capability: 'img2img',
        prompt: '',
        reference_images: [
          { base64: Buffer.from('source').toString('base64'), mime_type: 'image/png' },
        ],
        output: { size_px: { width: 1600, height: 1200 } },
        options: { preserveWorkflowPrompt: true },
      },
      { uploadedImages: ['source.png'] },
    )

    expect(injected).toEqual({
      '1': { inputs: { text: 'workflow default prompt' } },
      '2': { inputs: { width: 1600 } },
      '3': { inputs: { image: 'source.png' } },
    })
  })

  it('requires output images from configured output slots', () => {
    expect(() =>
      outputsFromHistory({ outputs: { '9': { text: ['not image'] } } }, [
        { name: 'result', nodeId: '9', field: 'images' },
      ]),
    ).toThrow('ComfyUI 未返回输出图片')
  })

  it('prefers persisted output images over temp previews', () => {
    expect(
      outputsFromHistory(
        {
          outputs: {
            '9': {
              images: [
                { filename: 'preview.png', type: 'temp' },
                { filename: 'saved.png', subfolder: '2026-05-31', type: 'output' },
              ],
            },
          },
        },
        [{ name: 'result', nodeId: '9', field: 'images' }],
      ),
    ).toEqual([{ filename: 'saved.png', subfolder: '2026-05-31', type: 'output' }])
  })
})
