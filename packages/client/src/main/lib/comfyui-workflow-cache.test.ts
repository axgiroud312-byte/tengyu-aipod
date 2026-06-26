import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

let userDataDir = ''
let workbenchRoot = ''

vi.mock('electron', () => ({
  app: {
    getPath: (name: string) => {
      if (name !== 'userData') {
        throw new Error(`unexpected path: ${name}`)
      }
      return userDataDir
    },
    isPackaged: false,
  },
}))

vi.mock('../onboarding', () => ({
  readAppConfig: () => ({ workbench_root: workbenchRoot }),
}))

const { ComfyuiWorkflowCacheManager, comfyuiUiWorkflowToApiPrompt } = await import(
  './comfyui-workflow-cache'
)

beforeEach(async () => {
  userDataDir = await mkdtemp(join(tmpdir(), 'tengyu-workflow-cache-'))
  workbenchRoot = await mkdtemp(join(tmpdir(), 'tengyu-workbench-'))
  vi.useRealTimers()
  vi.stubGlobal('fetch', vi.fn())
})

afterEach(async () => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
  await rm(userDataDir, { recursive: true, force: true })
  await rm(workbenchRoot, { recursive: true, force: true })
})

describe('ComfyuiWorkflowCacheManager', () => {
  it('imports and lists local workflow summaries without fetching the server', async () => {
    const manager = new ComfyuiWorkflowCacheManager()

    const imported = await manager.importWorkflow({
      name: 'Img2Img',
      capability: 'img2img',
      workflowJsonText: JSON.stringify({
        '1': { class_type: 'LoadImage', inputs: {} },
        '2': { class_type: 'SaveImage', inputs: {} },
      }),
    })

    expect(imported).toMatchObject({ capability: 'img2img', name: 'Img2Img' })
    await expect(manager.listWorkflows('img2img')).resolves.toMatchObject([
      { id: imported.id, capability: 'img2img' },
    ])
    await expect(manager.get(imported.id, 'img2img')).resolves.toMatchObject({
      id: imported.id,
      inputSlots: [{ nodeId: '1', field: 'image' }],
      outputSlots: [{ nodeId: '2', field: 'images' }],
    })
    expect(fetch).not.toHaveBeenCalled()
  })

  it('imports workflows from a categorized directory and detects common input slots', async () => {
    const manager = new ComfyuiWorkflowCacheManager()
    const root = await mkdtemp(join(tmpdir(), 'tengyu-workflow-library-'))
    const txt2imgDir = join(root, '文生图')
    const img2imgDir = join(root, '图生图')
    const unknownDir = join(root, '杂项')
    await Promise.all([mkdir(txt2imgDir), mkdir(img2imgDir), mkdir(unknownDir)])
    await writeFile(
      join(txt2imgDir, '局部印花.json'),
      JSON.stringify({
        '1': {
          class_type: 'CLIPTextEncode',
          inputs: { text: 'old prompt' },
          _meta: { title: 'Prompt' },
        },
        '2': { class_type: 'EmptyLatentImage', inputs: { width: 512, height: 512 } },
        '3': { class_type: 'Flux2Scheduler', inputs: { steps: 4, width: 512, height: 512 } },
        '4': { class_type: 'SaveImage', inputs: {} },
      }),
      'utf8',
    )
    await writeFile(
      join(img2imgDir, '参考图.json'),
      JSON.stringify({
        '1': {
          class_type: 'CLIPTextEncode',
          inputs: { text: 'old prompt' },
          _meta: { title: 'Prompt' },
        },
        '2': { class_type: 'LoadImage', inputs: { image: '' } },
        '3': { class_type: 'Image Save', inputs: {} },
      }),
      'utf8',
    )
    await writeFile(join(unknownDir, '不会导入.json'), '{"1":{}}', 'utf8')

    try {
      const result = await manager.importWorkflowDirectory({ directoryPath: root })

      expect(result.importedCount).toBe(2)
      expect(result.skippedCount).toBe(1)
      await expect(manager.listWorkflows('txt2img')).resolves.toMatchObject([
        { name: '局部印花', capability: 'txt2img' },
      ])
      const txtWorkflow = (await manager.listWorkflows('txt2img'))[0]
      expect(txtWorkflow).toBeDefined()
      if (!txtWorkflow) {
        throw new Error('txt2img workflow was not imported')
      }
      await expect(manager.get(txtWorkflow.id, 'txt2img')).resolves.toMatchObject({
        inputSlots: expect.arrayContaining([
          { name: 'prompt', nodeId: '1', field: 'text' },
          { name: 'width', nodeId: '2', field: 'width' },
          { name: 'height', nodeId: '2', field: 'height' },
          { name: 'width', nodeId: '3', field: 'width' },
          { name: 'height', nodeId: '3', field: 'height' },
        ]),
        outputSlots: [{ name: 'output_1', nodeId: '4', field: 'images' }],
      })
      await expect(manager.listWorkflows('img2img')).resolves.toMatchObject([
        { name: '参考图', capability: 'img2img' },
      ])
      const imgWorkflow = (await manager.listWorkflows('img2img'))[0]
      expect(imgWorkflow).toBeDefined()
      if (!imgWorkflow) {
        throw new Error('img2img workflow was not imported')
      }
      await expect(manager.get(imgWorkflow.id, 'img2img')).resolves.toMatchObject({
        inputSlots: expect.arrayContaining([
          { name: 'prompt', nodeId: '1', field: 'text' },
          { name: 'image_1', nodeId: '2', field: 'image', imageIndex: 0 },
        ]),
        outputSlots: [{ name: 'output_1', nodeId: '3', field: 'images' }],
      })
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('detects linked prompt and primitive size input nodes', async () => {
    const manager = new ComfyuiWorkflowCacheManager()

    const imported = await manager.importWorkflow({
      name: 'Linked Txt2Img',
      capability: 'txt2img',
      workflowJsonText: JSON.stringify({
        '1': {
          class_type: 'CLIPTextEncode',
          inputs: { text: ['2', 0] },
          _meta: { title: 'CLIP Text Encode (Positive Prompt)' },
        },
        '2': { class_type: 'CR Prompt Text', inputs: { prompt: '' }, _meta: { title: '提示词' } },
        '3': { class_type: 'PrimitiveInt', inputs: { value: 1024 }, _meta: { title: '宽' } },
        '4': { class_type: 'PrimitiveInt', inputs: { value: 1024 }, _meta: { title: '高' } },
        '5': {
          class_type: 'EmptyFlux2LatentImage',
          inputs: { width: ['3', 0], height: ['4', 0] },
        },
        '6': { class_type: 'SaveImage', inputs: {} },
      }),
    })

    await expect(manager.get(imported.id, 'txt2img')).resolves.toMatchObject({
      inputSlots: expect.arrayContaining([
        { name: 'prompt', nodeId: '2', field: 'prompt' },
        { name: 'width', nodeId: '3', field: 'value' },
        { name: 'height', nodeId: '4', field: 'value' },
      ]),
      outputSlots: [{ name: 'output_1', nodeId: '6', field: 'images' }],
    })
  })

  it('imports UI workflow JSON and detects linked batch size input nodes', async () => {
    const manager = new ComfyuiWorkflowCacheManager()

    const imported = await manager.importWorkflow({
      name: 'UI Img2Img',
      capability: 'img2img',
      workflowJsonText: JSON.stringify({
        nodes: [
          { id: 204, type: 'LoadImage', widgets_values: ['source.png', 'image'] },
          {
            id: 165,
            type: 'CLIPTextEncode',
            title: 'CLIP Text Encode (Positive Prompt)',
            inputs: [{ name: 'text', type: 'STRING', link: 46 }],
          },
          {
            id: 194,
            type: 'TextUtils_Merger',
            inputs: [{ name: '文本_1', type: 'STRING', link: 54 }],
          },
          { id: 191, type: 'CR Prompt Text', title: '提示词', widgets_values: ['make print'] },
          { id: 179, type: 'PrimitiveInt', title: '宽', widgets_values: [1024, 'fixed'] },
          { id: 180, type: 'PrimitiveInt', title: '高', widgets_values: [1024, 'fixed'] },
          { id: 213, type: 'PrimitiveInt', widgets_values: [4, 'fixed'] },
          {
            id: 175,
            type: 'EmptyImage',
            inputs: [
              { name: 'width', type: 'INT', link: 50 },
              { name: 'height', type: 'INT', link: 51 },
              { name: 'batch_size', type: 'INT', link: 70 },
            ],
            widgets_values: [512, 512, 4, 0],
          },
          { id: 187, type: 'Image Save', inputs: [{ name: 'images', type: 'IMAGE', link: 52 }] },
        ],
        links: [
          [46, 194, 0, 165, 1, 'STRING'],
          [54, 191, 0, 194, 0, 'STRING'],
          [50, 179, 0, 175, 0, 'INT'],
          [51, 180, 0, 175, 1, 'INT'],
          [70, 213, 0, 175, 2, 'INT'],
          [52, 175, 0, 187, 0, 'IMAGE'],
        ],
      }),
    })

    await expect(manager.get(imported.id, 'img2img')).resolves.toMatchObject({
      workflowFormat: 'ui',
      inputSlots: expect.arrayContaining([
        { name: 'image_1', nodeId: '204', field: 'image', imageIndex: 0 },
        { name: 'prompt', nodeId: '191', field: 'prompt' },
        { name: 'width', nodeId: '179', field: 'value' },
        { name: 'height', nodeId: '180', field: 'value' },
        { name: 'batchSize', nodeId: '213', field: 'value' },
      ]),
      outputSlots: [{ name: 'output_1', nodeId: '187', field: 'images' }],
    })
    await expect(manager.listWorkflows('img2img')).resolves.toMatchObject([
      expect.objectContaining({
        detection: expect.objectContaining({ batchInputs: 1 }),
      }),
    ])
  })

  it('converts UI workflow JSON to API prompt with object info widget order', () => {
    const converted = comfyuiUiWorkflowToApiPrompt(
      {
        nodes: [
          { id: 179, type: 'PrimitiveInt', title: '宽', widgets_values: [1024, 'fixed'] },
          { id: 213, type: 'PrimitiveInt', widgets_values: [4, 'fixed'] },
          {
            id: 175,
            type: 'EmptyImage',
            inputs: [
              { name: 'width', type: 'INT', link: 50 },
              { name: 'batch_size', type: 'INT', link: 70 },
            ],
            widgets_values: [512, 512, 1, 0],
          },
        ],
        links: [
          [50, 179, 0, 175, 0, 'INT'],
          [70, 213, 0, 175, 2, 'INT'],
        ],
      },
      {
        PrimitiveInt: {
          input: {
            required: { value: ['INT', {}] },
            optional: { control_after_generate: [['fixed'], {}] },
          },
          input_order: { required: ['value'], optional: ['control_after_generate'] },
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
      },
      { requireObjectInfo: true },
    )

    expect(converted).toMatchObject({
      '179': { inputs: { value: 1024, control_after_generate: 'fixed' } },
      '213': { inputs: { value: 4, control_after_generate: 'fixed' } },
      '175': { inputs: { width: ['179', 0], height: 512, batch_size: ['213', 0], color: 0 } },
    })
  })
})
