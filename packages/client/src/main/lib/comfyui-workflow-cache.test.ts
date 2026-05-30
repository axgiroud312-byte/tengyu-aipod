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

const { ComfyuiWorkflowCacheManager } = await import('./comfyui-workflow-cache')

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
})
