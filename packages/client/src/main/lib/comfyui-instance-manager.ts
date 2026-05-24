import { join } from 'node:path'
import { AppErrorClass } from '@tengyu-aipod/shared'
import Database from 'better-sqlite3'
import { ipcMain } from 'electron'
import { readAppConfig } from '../onboarding'
import {
  type ChenyuBalance,
  type ChenyuCloudClient,
  type ChenyuCreateByPodInput,
  type ChenyuGpu,
  type ChenyuInstanceInfo,
  ChenyuInstanceStatus,
  type ChenyuPod,
} from './chenyu-cloud-client'

export type ComfyuiInstanceState = 'none' | 'starting' | 'running' | 'shutting_down' | 'stopped'

export type ComfyuiInstanceRecord = {
  provider: 'chenyu'
  instanceUuid: string
  comfyuiUrl: string
  podUuid: string | null
  gpuUuid: string | null
  gpuName: string | null
  status: ComfyuiInstanceState
  podPriceHour: number
  gpuPriceHour: number
  autoShutdownAt: number | null
  createdAt: number
  lastUsedAt: number | null
}

export type ComfyuiInstanceSummary = ComfyuiInstanceRecord & {
  runningMinutes: number
  estimatedCost: number
}

export type CreateComfyuiInstanceInput = {
  pod: ChenyuPod
  gpu: ChenyuGpu
  podTag?: string
  gpuNums?: number
  autoShutdownMinutes?: number
}

export type ComfyuiInstanceManagerDependencies = {
  readConfig?: typeof readAppConfig
  openDatabase?: (workbenchRoot: string) => ComfyuiInstanceDatabase
  chenyu: Pick<
    ChenyuCloudClient,
    | 'createByPod'
    | 'getInstanceInfo'
    | 'startup'
    | 'shutdown'
    | 'restart'
    | 'destroy'
    | 'setShutdownTimer'
    | 'getBalance'
  >
  now?: () => number
}

type ComfyuiInstanceDatabase = Pick<Database.Database, 'exec' | 'prepare' | 'close'>

type ComfyuiInstanceRow = {
  provider: 'chenyu'
  instanceUuid: string
  comfyuiUrl: string
  podUuid: string | null
  gpuUuid: string | null
  gpuName: string | null
  status: ComfyuiInstanceState
  podPriceHour: number
  gpuPriceHour: number
  autoShutdownAt: number | null
  createdAt: number
  lastUsedAt: number | null
}

const DEFAULT_AUTO_SHUTDOWN_MINUTES = 60
const MINUTE_MS = 60_000

function workbenchDbPath(workbenchRoot: string) {
  return join(workbenchRoot, '.workbench', 'workbench.db')
}

function openWorkbenchDatabase(workbenchRoot: string) {
  return new Database(workbenchDbPath(workbenchRoot))
}

function ensureComfyuiInstanceTable(db: Pick<Database.Database, 'exec'>) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS comfyui_instances (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      provider TEXT NOT NULL,
      instance_uuid TEXT NOT NULL,
      comfyui_url TEXT NOT NULL,
      pod_uuid TEXT,
      gpu_uuid TEXT,
      gpu_name TEXT,
      status TEXT NOT NULL,
      pod_price_hour REAL NOT NULL DEFAULT 0,
      gpu_price_hour REAL NOT NULL DEFAULT 0,
      auto_shutdown_at INTEGER,
      created_at INTEGER NOT NULL,
      last_used_at INTEGER
    );
  `)
}

export class ComfyuiInstanceManager {
  private readonly readConfig: typeof readAppConfig
  private readonly openDatabase: (workbenchRoot: string) => ComfyuiInstanceDatabase
  private readonly now: () => number

  constructor(private readonly dependencies: ComfyuiInstanceManagerDependencies) {
    this.readConfig = dependencies.readConfig ?? readAppConfig
    this.openDatabase = dependencies.openDatabase ?? openWorkbenchDatabase
    this.now = dependencies.now ?? Date.now
  }

  async createInstance(input: CreateComfyuiInstanceInput) {
    const workbenchRoot = await this.readWorkbenchRoot()
    const now = this.now()
    const autoShutdownMinutes = input.autoShutdownMinutes ?? DEFAULT_AUTO_SHUTDOWN_MINUTES
    const autoShutdownAt = Math.floor((now + autoShutdownMinutes * MINUTE_MS) / 1000)
    const gpuNums = input.gpuNums ?? 1
    const payload: ChenyuCreateByPodInput = {
      pod_uuid: input.pod.uuid,
      pod_tag: input.podTag ?? input.pod.pod_tag?.[0] ?? 'latest',
      gpu_uuid: input.gpu.gpu_uuid,
      gpu_nums: gpuNums,
    }

    const created = await this.dependencies.chenyu.createByPod(payload)
    await this.dependencies.chenyu.setShutdownTimer({
      instance_uuid: created.instance_uuid,
      enable: true,
      shutdown_time: autoShutdownAt,
    })
    const latest = await this.dependencies.chenyu.getInstanceInfo(created.instance_uuid)
    const comfyuiUrl = extractComfyuiUrl(latest.server_map ?? created.server_map)
    if (!comfyuiUrl) {
      throw new AppErrorClass('HTTP_5XX', '晨羽实例未返回 ComfyUI 地址', true, {
        kind: 'network',
        provider: 'comfyui-chenyu',
        instanceUuid: created.instance_uuid,
      })
    }

    const record: ComfyuiInstanceRecord = {
      provider: 'chenyu',
      instanceUuid: created.instance_uuid,
      comfyuiUrl,
      podUuid: input.pod.uuid,
      gpuUuid: input.gpu.gpu_uuid,
      gpuName: input.gpu.gpu_name,
      status: stateFromChenyuStatus(latest.status ?? created.status),
      podPriceHour: priceHour(input.pod),
      gpuPriceHour: priceHour(input.gpu) * gpuNums,
      autoShutdownAt,
      createdAt: now,
      lastUsedAt: now,
    }

    return this.withDb(workbenchRoot, (db) => {
      saveInstanceRecord(db, record)
      return toSummary(record, now)
    })
  }

  async getCurrentInstance() {
    const workbenchRoot = await this.readWorkbenchRoot()
    return this.withDb(workbenchRoot, (db) => {
      const record = readInstanceRecord(db)
      return record ? toSummary(record, this.now()) : null
    })
  }

  async refreshCurrentInstance() {
    const current = await this.getCurrentInstance()
    if (!current) {
      return null
    }

    const latest = await this.dependencies.chenyu.getInstanceInfo(current.instanceUuid)
    const updated = mergeInstanceInfo(current, latest, this.now())
    const workbenchRoot = await this.readWorkbenchRoot()
    return this.withDb(workbenchRoot, (db) => {
      saveInstanceRecord(db, updated)
      return toSummary(updated, this.now())
    })
  }

  async shutdownCurrentInstance() {
    const current = await this.requireCurrentInstance()
    await this.dependencies.chenyu.shutdown(current.instanceUuid)
    return this.updateStatus('shutting_down')
  }

  async restartCurrentInstance() {
    const current = await this.requireCurrentInstance()
    await this.dependencies.chenyu.restart(current.instanceUuid)
    return this.updateStatus('starting')
  }

  async destroyCurrentInstance() {
    const current = await this.requireCurrentInstance()
    await this.dependencies.chenyu.destroy(current.instanceUuid)
    const workbenchRoot = await this.readWorkbenchRoot()
    this.withDb(workbenchRoot, (db) => clearInstanceRecord(db))
  }

  async extendShutdown(minutesFromNow: number) {
    const current = await this.requireCurrentInstance()
    const autoShutdownAt = Math.floor((this.now() + minutesFromNow * MINUTE_MS) / 1000)
    await this.dependencies.chenyu.setShutdownTimer({
      instance_uuid: current.instanceUuid,
      enable: true,
      shutdown_time: autoShutdownAt,
    })
    return this.updateRecord((record) => ({
      ...record,
      autoShutdownAt,
    }))
  }

  getBalance(): Promise<ChenyuBalance> {
    return this.dependencies.chenyu.getBalance()
  }

  private async updateStatus(status: ComfyuiInstanceState) {
    return this.updateRecord((record) => ({
      ...record,
      status,
      lastUsedAt: this.now(),
    }))
  }

  private async updateRecord(updater: (record: ComfyuiInstanceRecord) => ComfyuiInstanceRecord) {
    const current = await this.requireCurrentInstance()
    const next = updater(current)
    const workbenchRoot = await this.readWorkbenchRoot()
    return this.withDb(workbenchRoot, (db) => {
      saveInstanceRecord(db, next)
      return toSummary(next, this.now())
    })
  }

  private async requireCurrentInstance() {
    const current = await this.getCurrentInstance()
    if (!current) {
      throw new AppErrorClass('CHENYU_INSTANCE_DOWN', '请先创建 ComfyUI 实例', false, {
        provider: 'comfyui-chenyu',
      })
    }
    return current
  }

  private async readWorkbenchRoot() {
    const config = await this.readConfig()
    if (!config.workbench_root) {
      throw new AppErrorClass('HTTP_4XX', '请先设置素材总目录', false)
    }
    return config.workbench_root
  }

  private withDb<T>(workbenchRoot: string, callback: (db: ComfyuiInstanceDatabase) => T) {
    const db = this.openDatabase(workbenchRoot)
    try {
      ensureComfyuiInstanceTable(db)
      return callback(db)
    } finally {
      db.close()
    }
  }
}

export function extractComfyuiUrl(serverMap: ChenyuInstanceInfo['server_map']) {
  const entry = (serverMap ?? []).find(
    (item) => item.port_type === 'http' && /comfyui/i.test(item.title ?? ''),
  )
  return entry?.url ?? null
}

export function stateFromChenyuStatus(status: number | undefined): ComfyuiInstanceState {
  if (status === ChenyuInstanceStatus.Initializing) {
    return 'starting'
  }
  if (status === ChenyuInstanceStatus.Running) {
    return 'running'
  }
  if (status === ChenyuInstanceStatus.ShuttingDown) {
    return 'shutting_down'
  }
  if (status === ChenyuInstanceStatus.Stopped) {
    return 'stopped'
  }
  return 'none'
}

export function estimateComfyuiCost(
  record: Pick<ComfyuiInstanceRecord, 'createdAt' | 'podPriceHour' | 'gpuPriceHour'>,
  now: number,
) {
  const runningMinutes = Math.max(0, Math.floor((now - record.createdAt) / MINUTE_MS))
  const hourlyPrice = record.podPriceHour + record.gpuPriceHour
  return {
    runningMinutes,
    estimatedCost: (runningMinutes / 60) * hourlyPrice,
  }
}

function toSummary(record: ComfyuiInstanceRecord, now: number): ComfyuiInstanceSummary {
  return {
    ...record,
    ...estimateComfyuiCost(record, now),
  }
}

function mergeInstanceInfo(
  current: ComfyuiInstanceRecord,
  latest: ChenyuInstanceInfo,
  now: number,
): ComfyuiInstanceRecord {
  return {
    ...current,
    comfyuiUrl: extractComfyuiUrl(latest.server_map) ?? current.comfyuiUrl,
    status: stateFromChenyuStatus(latest.status),
    lastUsedAt: now,
  }
}

function priceHour(item: { price?: { hour?: number } }) {
  const value = item.price?.hour
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

function saveInstanceRecord(db: Pick<Database.Database, 'prepare'>, record: ComfyuiInstanceRecord) {
  db.prepare(
    `
      INSERT INTO comfyui_instances (
        id,
        provider,
        instance_uuid,
        comfyui_url,
        pod_uuid,
        gpu_uuid,
        gpu_name,
        status,
        pod_price_hour,
        gpu_price_hour,
        auto_shutdown_at,
        created_at,
        last_used_at
      )
      VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        provider = excluded.provider,
        instance_uuid = excluded.instance_uuid,
        comfyui_url = excluded.comfyui_url,
        pod_uuid = excluded.pod_uuid,
        gpu_uuid = excluded.gpu_uuid,
        gpu_name = excluded.gpu_name,
        status = excluded.status,
        pod_price_hour = excluded.pod_price_hour,
        gpu_price_hour = excluded.gpu_price_hour,
        auto_shutdown_at = excluded.auto_shutdown_at,
        created_at = excluded.created_at,
        last_used_at = excluded.last_used_at
    `,
  ).run(
    record.provider,
    record.instanceUuid,
    record.comfyuiUrl,
    record.podUuid,
    record.gpuUuid,
    record.gpuName,
    record.status,
    record.podPriceHour,
    record.gpuPriceHour,
    record.autoShutdownAt,
    record.createdAt,
    record.lastUsedAt,
  )
}

function readInstanceRecord(db: Pick<Database.Database, 'prepare'>): ComfyuiInstanceRecord | null {
  const row = db
    .prepare(
      `
        SELECT
          provider,
          instance_uuid AS instanceUuid,
          comfyui_url AS comfyuiUrl,
          pod_uuid AS podUuid,
          gpu_uuid AS gpuUuid,
          gpu_name AS gpuName,
          status,
          pod_price_hour AS podPriceHour,
          gpu_price_hour AS gpuPriceHour,
          auto_shutdown_at AS autoShutdownAt,
          created_at AS createdAt,
          last_used_at AS lastUsedAt
        FROM comfyui_instances
        WHERE id = 1
      `,
    )
    .get() as ComfyuiInstanceRow | undefined

  return row ?? null
}

function clearInstanceRecord(db: Pick<Database.Database, 'prepare'>) {
  db.prepare('DELETE FROM comfyui_instances WHERE id = 1').run()
}

export function registerComfyuiInstanceManagerIpc(manager: ComfyuiInstanceManager) {
  ipcMain.handle('chenyu:get-instance-status', () => manager.refreshCurrentInstance())
  ipcMain.handle('chenyu:shutdown-instance', () => manager.shutdownCurrentInstance())
  ipcMain.handle('chenyu:restart-instance', () => manager.restartCurrentInstance())
  ipcMain.handle('chenyu:destroy-instance', () => manager.destroyCurrentInstance())
  ipcMain.handle('chenyu:get-balance', () => manager.getBalance())
}
