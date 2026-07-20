import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ChenyuInstanceStatus } from './chenyu-cloud-client'

const allowedPod = {
  uuid: 'pod-hangzhou-shensi',
  title: '杭州慎思comfyui镜像',
  pod_tag: ['v1', 'v2'],
}

const mocks = vi.hoisted(() => ({
  currentInstance: null as null | {
    instanceUuid: string
    comfyuiUrl: string
  },
  listInstances: vi.fn(),
  listPods: vi.fn(),
  listGpus: vi.fn(),
  updateTitle: vi.fn(),
  createInstance: vi.fn(),
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
      listPods = mocks.listPods
      listGpus = mocks.listGpus
      updateTitle = mocks.updateTitle
    },
  }
})

vi.mock('./comfyui-instance-manager', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./comfyui-instance-manager')>()
  return {
    ...actual,
    ComfyuiInstanceManager: class {
      createInstance = mocks.createInstance

      async getCurrentInstance() {
        return mocks.currentInstance
      }
    },
  }
})

describe('Chenyu instance service', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('creates only the allowed Pod version with a custom instance title', async () => {
    mocks.listPods.mockResolvedValueOnce({ items: [allowedPod], total: 1 })
    mocks.listGpus.mockResolvedValueOnce({
      items: [{ gpu_uuid: 'gpu-1', gpu_name: 'RTX 4090', status: 1 }],
      total: 1,
    })
    mocks.createInstance.mockResolvedValueOnce({ instanceUuid: 'inst-1' })

    const { createPodInstance } = await import('./chenyu-instance-service')
    await createPodInstance({
      podUuid: allowedPod.uuid,
      podTitle: 'My ComfyUI Pod',
      podTag: 'v2',
      instanceTitle: '主力生图 4090',
      gpuUuid: 'gpu-1',
      gpuNums: 1,
      autoShutdownMinutes: 60,
    })

    expect(mocks.createInstance).toHaveBeenCalledWith({
      pod: { uuid: allowedPod.uuid, title: allowedPod.title, pod_tag: ['v2'] },
      gpu: { gpu_uuid: 'gpu-1', gpu_name: 'RTX 4090', status: 1 },
      instanceTitle: '主力生图 4090',
      podTag: 'v2',
      gpuNums: 1,
      autoShutdownMinutes: 60,
    })
  })

  it('lists selectable Pods and renames an existing instance', async () => {
    mocks.listPods.mockResolvedValueOnce({
      items: [{ uuid: 'pod-other', title: '其他 ComfyUI', pod_tag: ['latest'] }, allowedPod],
      total: 2,
    })
    mocks.updateTitle.mockResolvedValueOnce({ ok: true })

    const { listChenyuPods, renameChenyuInstance } = await import('./chenyu-instance-service')

    await expect(listChenyuPods('ComfyUI')).resolves.toEqual([allowedPod])
    await expect(renameChenyuInstance('inst-1', '备用云机')).resolves.toEqual({ ok: true })
    expect(mocks.listPods).toHaveBeenCalledWith({
      page: 1,
      page_size: 50,
      name: allowedPod.title,
    })
    expect(mocks.updateTitle).toHaveBeenCalledWith({
      instance_uuid: 'inst-1',
      title: '备用云机',
    })
  })

  it('rejects creating an instance with any other Pod UUID', async () => {
    mocks.listPods.mockResolvedValueOnce({ items: [allowedPod], total: 1 })

    const { createPodInstance } = await import('./chenyu-instance-service')

    await expect(
      createPodInstance({
        podUuid: 'pod-other',
        podTag: 'v2',
        gpuUuid: 'gpu-1',
      }),
    ).rejects.toThrow('只允许使用杭州慎思comfyui镜像')
    expect(mocks.createInstance).not.toHaveBeenCalled()
  })

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
