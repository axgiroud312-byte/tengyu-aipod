import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ChenyuInstanceStatus, type ChenyuServerMapEntry } from './chenyu-cloud-client'
import {
  ComfyuiInstanceManager,
  comfyuiUrlCandidates,
  estimateComfyuiCost,
  extractComfyuiUrl,
  resolveComfyuiUrl,
  stateFromChenyuStatus,
} from './comfyui-instance-manager'
import type { SqliteDatabase } from './sqlite'

type TestDatabase = Pick<SqliteDatabase, 'exec' | 'prepare' | 'close'>
type Statement = {
  run: (...values: unknown[]) => void
  get: () => unknown
}

type FakeRow = {
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

class FakeDb {
  row: FakeRow | null = null
  execCalls: string[] = []
  closed = false

  exec(sql: string) {
    this.execCalls.push(sql)
  }

  prepare(sql: string): Statement {
    if (sql.includes('INSERT INTO comfyui_instances')) {
      return {
        run: (...values: unknown[]) => {
          this.row = {
            provider: values[0] as 'chenyu',
            instanceUuid: String(values[1]),
            comfyuiUrl: String(values[2]),
            podUuid: values[3] === null ? null : String(values[3]),
            gpuUuid: values[4] === null ? null : String(values[4]),
            gpuName: values[5] === null ? null : String(values[5]),
            status: String(values[6]),
            podPriceHour: Number(values[7]),
            gpuPriceHour: Number(values[8]),
            autoShutdownAt: values[9] === null ? null : Number(values[9]),
            createdAt: Number(values[10]),
            lastUsedAt: values[11] === null ? null : Number(values[11]),
          }
        },
        get: () => undefined,
      }
    }

    if (sql.includes('SELECT') && sql.includes('FROM comfyui_instances')) {
      return {
        get: () => this.row,
        run: () => undefined,
      }
    }

    if (sql.includes('DELETE FROM comfyui_instances')) {
      return {
        run: () => {
          this.row = null
        },
        get: () => undefined,
      }
    }

    return {
      run: () => undefined,
      get: () => undefined,
    }
  }

  close() {
    this.closed = true
  }
}

vi.mock('electron', () => ({
  ipcMain: {
    handle: vi.fn(),
  },
}))

let db: FakeDb
let now = 1_700_000_000_000

function serverMap(url = 'https://comfy.example'): ChenyuServerMapEntry[] {
  return [{ title: 'ComfyUI', port_type: 'http', url }]
}

function manager(
  chenyu: Partial<ConstructorParameters<typeof ComfyuiInstanceManager>[0]['chenyu']>,
  extra?: Partial<ConstructorParameters<typeof ComfyuiInstanceManager>[0]>,
) {
  return new ComfyuiInstanceManager({
    readConfig: async () => ({ workbench_root: '/tmp/workbench' }),
    openDatabase: () => db as unknown as TestDatabase,
    now: () => now,
    chenyu: {
      createByPod: vi.fn(),
      getInstanceInfo: vi.fn(),
      startup: vi.fn(),
      shutdown: vi.fn(),
      restart: vi.fn(),
      destroy: vi.fn(),
      setShutdownTimer: vi.fn(),
      getBalance: vi.fn(),
      ...chenyu,
    },
    ...extra,
  })
}

beforeEach(() => {
  db = new FakeDb()
  now = 1_700_000_000_000
})

describe('ComfyuiInstanceManager', () => {
  it('creates an instance, sets shutdown timer, extracts ComfyUI URL, and stores singleton row', async () => {
    const createByPod = vi.fn().mockResolvedValue({
      instance_uuid: 'inst-1',
      status: ChenyuInstanceStatus.Initializing,
    })
    const setShutdownTimer = vi.fn().mockResolvedValue({ instance_uuid: 'inst-1' })
    const getInstanceInfo = vi.fn().mockResolvedValue({
      instance_uuid: 'inst-1',
      status: ChenyuInstanceStatus.Running,
      server_map: serverMap(),
    })
    const service = manager({ createByPod, setShutdownTimer, getInstanceInfo })

    const result = await service.createInstance({
      pod: { uuid: 'pod-1', title: 'ComfyUI Default', pod_tag: ['latest'], price: { hour: 2 } },
      gpu: { gpu_uuid: 'gpu-1', gpu_name: 'RTX 4090', status: 1, price: { hour: 5 } },
    })

    expect(createByPod).toHaveBeenCalledWith({
      pod_uuid: 'pod-1',
      pod_tag: 'latest',
      gpu_uuid: 'gpu-1',
      gpu_nums: 1,
    })
    expect(setShutdownTimer).toHaveBeenCalledWith({
      instance_uuid: 'inst-1',
      enable: true,
      shutdown_time: 1_700_003_600,
    })
    expect(result).toMatchObject({
      instanceUuid: 'inst-1',
      comfyuiUrl: 'https://comfy.example',
      status: 'running',
      podPriceHour: 2,
      gpuPriceHour: 5,
      autoShutdownAt: 1_700_003_600,
    })
    expect(db.row).toMatchObject({ instanceUuid: 'inst-1', status: 'running' })
  })

  it('detects ComfyUI from a generic frontend URL when the service title is not stable', async () => {
    const fetchImpl = vi.fn(async (url: string | URL | Request) => {
      expect(String(url)).toBe('https://front.example/system_stats')
      return new Response(JSON.stringify({ system: {}, devices: [] }))
    }) as unknown as typeof fetch
    const createByPod = vi.fn().mockResolvedValue({
      instance_uuid: 'inst-1',
      status: ChenyuInstanceStatus.Initializing,
    })
    const getInstanceInfo = vi.fn().mockResolvedValue({
      instance_uuid: 'inst-1',
      status: ChenyuInstanceStatus.Running,
      server_map: [{ title: 'Frontend', port_type: 'http', url: 'https://front.example/' }],
    })
    const service = manager(
      { createByPod, getInstanceInfo },
      { fetch: fetchImpl, sleep: async () => undefined },
    )

    const result = await service.createInstance({
      pod: { uuid: 'pod-1', title: 'ComfyUI Default', pod_tag: ['4.64'] },
      gpu: { gpu_uuid: 'gpu-1', gpu_name: 'RTX 4080', status: 1 },
      autoShutdownMinutes: null,
    })

    expect(result.comfyuiUrl).toBe('https://front.example')
    expect(db.row).toMatchObject({ comfyuiUrl: 'https://front.example' })
  })

  it('accepts a manually selected ComfyUI URL when setting the current instance', async () => {
    const service = manager({})

    const result = await service.setCurrentInstance(
      {
        instance_uuid: 'inst-1',
        status: ChenyuInstanceStatus.Running,
        server_map: [{ title: 'Jupyter', port_type: 'http', url: 'https://jupyter.example' }],
      },
      { comfyuiUrl: 'https://manual.example/' },
    )

    expect(result.comfyuiUrl).toBe('https://manual.example')
    expect(db.row).toMatchObject({ instanceUuid: 'inst-1', comfyuiUrl: 'https://manual.example' })
  })

  it('requires a ComfyUI http server_map entry when creating', async () => {
    const service = manager({
      createByPod: vi.fn().mockResolvedValue({ instance_uuid: 'inst-1', status: 1 }),
      setShutdownTimer: vi.fn().mockResolvedValue({}),
      getInstanceInfo: vi.fn().mockResolvedValue({
        instance_uuid: 'inst-1',
        status: ChenyuInstanceStatus.Running,
        server_map: [{ title: 'SSH Terminal', port_type: 'ssh', url: 'ssh://host' }],
      }),
    })

    await expect(
      service.createInstance({
        pod: { uuid: 'pod-1', title: 'ComfyUI Default' },
        gpu: { gpu_uuid: 'gpu-1', gpu_name: 'RTX 4090', status: 1 },
      }),
    ).rejects.toMatchObject({
      code: 'HTTP_5XX',
      retryable: true,
    })
  })

  it('refreshes current instance and maps Chenyu statuses', async () => {
    db.row = {
      provider: 'chenyu',
      instanceUuid: 'inst-1',
      comfyuiUrl: 'https://old.example',
      podUuid: 'pod-1',
      gpuUuid: 'gpu-1',
      gpuName: 'RTX 4090',
      status: 'starting',
      podPriceHour: 2,
      gpuPriceHour: 5,
      autoShutdownAt: null,
      createdAt: now - 30 * 60_000,
      lastUsedAt: null,
    }
    const service = manager({
      getInstanceInfo: vi.fn().mockResolvedValue({
        instance_uuid: 'inst-1',
        status: ChenyuInstanceStatus.Stopped,
        server_map: serverMap('https://new.example'),
      }),
    })

    await expect(service.refreshCurrentInstance()).resolves.toMatchObject({
      comfyuiUrl: 'https://new.example',
      status: 'stopped',
      runningMinutes: 30,
      estimatedCost: 3.5,
    })
    expect(db.row).toMatchObject({ comfyuiUrl: 'https://new.example', status: 'stopped' })
  })

  it('runs lifecycle actions and updates local status', async () => {
    db.row = currentRow()
    const shutdown = vi.fn().mockResolvedValue({})
    const restart = vi.fn().mockResolvedValue({})
    const destroy = vi.fn().mockResolvedValue({})
    const service = manager({ shutdown, restart, destroy })

    await expect(service.shutdownCurrentInstance()).resolves.toMatchObject({
      status: 'shutting_down',
    })
    expect(shutdown).toHaveBeenCalledWith('inst-1')

    await expect(service.restartCurrentInstance()).resolves.toMatchObject({ status: 'starting' })
    expect(restart).toHaveBeenCalledWith('inst-1')

    await service.destroyCurrentInstance()
    expect(destroy).toHaveBeenCalledWith('inst-1')
    expect(db.row).toBeNull()
  })

  it('extends shutdown time from now using timestamp seconds', async () => {
    db.row = currentRow()
    const setShutdownTimer = vi.fn().mockResolvedValue({})
    const service = manager({ setShutdownTimer })

    await expect(service.extendShutdown(30)).resolves.toMatchObject({
      autoShutdownAt: 1_700_001_800,
    })
    expect(setShutdownTimer).toHaveBeenCalledWith({
      instance_uuid: 'inst-1',
      enable: true,
      shutdown_time: 1_700_001_800,
    })
  })

  it('delegates balance checks to Chenyu', async () => {
    const getBalance = vi.fn().mockResolvedValue({ balance: 10, card_balance: 2 })
    const service = manager({ getBalance })

    await expect(service.getBalance()).resolves.toEqual({ balance: 10, card_balance: 2 })
  })

  it('exposes pure helpers for URL extraction, status mapping, and cost estimation', () => {
    expect(extractComfyuiUrl(serverMap('https://comfy.example'))).toBe('https://comfy.example')
    expect(
      extractComfyuiUrl([{ title: 'Frontend', port_type: 'http', url: 'https://front.example' }]),
    ).toBe('https://front.example')
    expect(
      extractComfyuiUrl([{ title: 'Jupyter', port_type: 'http', url: 'https://jupyter' }]),
    ).toBeNull()
    expect(
      comfyuiUrlCandidates([], ['https://server.example', 'ssh://ignored']).map(
        (candidate) => candidate.url,
      ),
    ).toEqual(['https://server.example'])
    expect(stateFromChenyuStatus(ChenyuInstanceStatus.Initializing)).toBe('starting')
    expect(stateFromChenyuStatus(ChenyuInstanceStatus.Running)).toBe('running')
    expect(stateFromChenyuStatus(ChenyuInstanceStatus.ShuttingDown)).toBe('shutting_down')
    expect(stateFromChenyuStatus(ChenyuInstanceStatus.Stopped)).toBe('stopped')
    expect(stateFromChenyuStatus(999)).toBe('none')
    expect(
      estimateComfyuiCost({ createdAt: now - 90 * 60_000, podPriceHour: 2, gpuPriceHour: 4 }, now),
    ).toEqual({ runningMinutes: 90, estimatedCost: 9 })
  })

  it('probes ambiguous URLs before choosing a ComfyUI endpoint', async () => {
    const fetchImpl = vi.fn(async (url: string | URL | Request) => {
      if (String(url) === 'https://web.example/system_stats') {
        return new Response(JSON.stringify({ system: {}, devices: [] }))
      }
      return new Response('not found', { status: 404 })
    }) as unknown as typeof fetch

    await expect(
      resolveComfyuiUrl(
        {
          server_map: [
            { title: 'Jupyter', port_type: 'http', url: 'https://jupyter.example' },
            { title: 'Web', port_type: 'http', url: 'https://web.example' },
          ],
          server_url: [],
        },
        { fetch: fetchImpl, timeoutMs: 1 },
      ),
    ).resolves.toBe('https://web.example')
  })
})

function currentRow(): FakeRow {
  return {
    provider: 'chenyu',
    instanceUuid: 'inst-1',
    comfyuiUrl: 'https://comfy.example',
    podUuid: 'pod-1',
    gpuUuid: 'gpu-1',
    gpuName: 'RTX 4090',
    status: 'running',
    podPriceHour: 2,
    gpuPriceHour: 5,
    autoShutdownAt: null,
    createdAt: now,
    lastUsedAt: null,
  }
}
