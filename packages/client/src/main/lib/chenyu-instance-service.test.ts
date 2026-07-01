import { describe, expect, it, vi } from 'vitest'
import { ChenyuInstanceStatus } from './chenyu-cloud-client'

const mocks = vi.hoisted(() => ({
  currentInstance: null as null | {
    instanceUuid: string
    comfyuiUrl: string
  },
  listInstances: vi.fn(),
}))

vi.mock('electron', () => ({
  ipcMain: {
    handle: vi.fn(),
  },
}))

vi.mock('./keychain', () => ({
  getSecret: vi.fn(async () => 'chenyu-key'),
  setSecret: vi.fn(),
}))

vi.mock('./workbench-config', () => ({
  readAppConfig: vi.fn(async () => ({ chenyu: {} })),
  writeAppConfig: vi.fn(),
}))

vi.mock('./chenyu-cloud-client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./chenyu-cloud-client')>()
  return {
    ...actual,
    ChenyuCloudClient: class {
      listInstances = mocks.listInstances
    },
  }
})

vi.mock('./comfyui-instance-manager', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./comfyui-instance-manager')>()
  return {
    ...actual,
    ComfyuiInstanceManager: class {
      async getCurrentInstance() {
        return mocks.currentInstance
      }
    },
  }
})

describe('Chenyu instance service', () => {
  it('uses the saved default ComfyUI URL when listing the current running instance', async () => {
    mocks.currentInstance = {
      instanceUuid: 'inst-current',
      comfyuiUrl: 'https://saved-comfy.example',
    }
    mocks.listInstances.mockResolvedValueOnce({
      items: [
        {
          instance_uuid: 'inst-current',
          status: ChenyuInstanceStatus.Running,
          title: 'Saved default instance',
          server_map: [],
          server_url: [],
        },
      ],
      total: 1,
    })

    const { listChenyuInstances } = await import('./chenyu-instance-service')
    const instances = await listChenyuInstances()

    expect(instances[0]).toMatchObject({
      instanceUuid: 'inst-current',
      statusName: 'running',
      isCurrent: true,
      comfyuiUrl: 'https://saved-comfy.example',
      serverUrls: ['https://saved-comfy.example'],
    })
  })
})
