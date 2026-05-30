import { mkdtemp, rm } from 'node:fs/promises'
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
})
