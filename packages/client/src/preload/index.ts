import type { ActivationBadgeState, Skill, SkillSummary } from '@tengyu-aipod/shared'
import { contextBridge, ipcRenderer } from 'electron'
import type {
  DetectionBatchConfig,
  DetectionProgress,
  DetectionTaskEvent,
} from '../main/lib/detection-service'
import type { TitleBatchConfig, TitleProgress, TitleTaskEvent } from '../main/lib/title-service'

const api = {
  ping: () => ipcRenderer.invoke('app:ping') as Promise<string>,
  onboarding: {
    getState: () =>
      ipcRenderer.invoke('onboarding:get-state') as Promise<{
        needs_onboarding: boolean
        default_workbench_root: string
      }>,
    chooseWorkbenchRoot: () =>
      ipcRenderer.invoke('onboarding:choose-workbench-root') as Promise<
        | { ok: true; data: { path: string } }
        | { ok: false; error: { code: string; message: string } }
      >,
    saveWorkbenchRoot: (path: string) =>
      ipcRenderer.invoke('onboarding:save-workbench-root', path) as Promise<{
        ok: true
        data: { path: string }
      }>,
    saveApiKeys: (apiKeys: Record<string, string>) =>
      ipcRenderer.invoke('onboarding:save-api-keys', apiKeys) as Promise<{ ok: true }>,
    complete: () => ipcRenderer.invoke('onboarding:complete') as Promise<{ ok: true }>,
  },
  keychain: {
    has: (key: string) => ipcRenderer.invoke('keychain:has', { key }) as Promise<boolean>,
  },
  skill: {
    list: (filter?: {
      module?: 'generation' | 'detection' | 'title'
      category?: string
      platform?: string
      language?: string
    }) => ipcRenderer.invoke('skill:list', filter) as Promise<SkillSummary[]>,
    get: (input: { id: string; version?: string }) =>
      ipcRenderer.invoke('skill:get', input) as Promise<Skill>,
  },
  tempFile: {
    getUsage: () => ipcRenderer.invoke('temp-file:get-usage') as Promise<Record<string, number>>,
    cleanupAll: () =>
      ipcRenderer.invoke('temp-file:cleanup-all') as Promise<{
        ok: true
      }>,
  },
  detection: {
    listModels: () => ipcRenderer.invoke('detection:list-models') as Promise<string[]>,
    run: (input: DetectionBatchConfig) =>
      ipcRenderer.invoke('detection:run', input) as Promise<string>,
    onProgress: (callback: (progress: DetectionProgress) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, progress: DetectionProgress) => {
        callback(progress)
      }
      ipcRenderer.on('detection:progress', listener)

      return () => {
        ipcRenderer.removeListener('detection:progress', listener)
      }
    },
    onCompleted: (callback: (event: DetectionTaskEvent) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, event: DetectionTaskEvent) => {
        callback(event)
      }
      ipcRenderer.on('detection:completed', listener)

      return () => {
        ipcRenderer.removeListener('detection:completed', listener)
      }
    },
  },
  title: {
    listPlatforms: () =>
      ipcRenderer.invoke('title:list-platforms') as Promise<Array<{ key: string; label: string }>>,
    listLanguages: () =>
      ipcRenderer.invoke('title:list-languages') as Promise<Array<{ key: string; label: string }>>,
    listModels: () =>
      ipcRenderer.invoke('title:list-models') as Promise<Array<{ key: string; label: string }>>,
    chooseBatchDir: () =>
      ipcRenderer.invoke('title:choose-batch-dir') as Promise<
        | { ok: true; data: { path: string } }
        | { ok: false; error: { code: string; message: string } }
      >,
    scanBatchDir: (input: { batchDir: string }) =>
      ipcRenderer.invoke('title:scan-batch-dir', input) as Promise<{
        skuCount: number
        existingTitles: Record<string, string>
      }>,
    run: (input: TitleBatchConfig) => ipcRenderer.invoke('title:run', input) as Promise<string>,
    retryFailed: (input: { task_id: string }) =>
      ipcRenderer.invoke('title:retry-failed', input) as Promise<string>,
    getResult: (input: { sku_code: string; batch_dir: string }) =>
      ipcRenderer.invoke('title:get-result', input) as Promise<unknown | null>,
    openPath: (input: { path: string }) =>
      ipcRenderer.invoke('title:open-path', input) as Promise<
        { ok: true } | { ok: false; error: { code: string; message: string } }
      >,
    onProgress: (callback: (progress: TitleProgress) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, progress: TitleProgress) => {
        callback(progress)
      }
      ipcRenderer.on('title:progress', listener)

      return () => {
        ipcRenderer.removeListener('title:progress', listener)
      }
    },
    onCompleted: (callback: (event: TitleTaskEvent) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, event: TitleTaskEvent) => {
        callback(event)
      }
      ipcRenderer.on('title:completed', listener)

      return () => {
        ipcRenderer.removeListener('title:completed', listener)
      }
    },
  },
  activation: {
    activate: (input: { code: string; device_name: string }) =>
      ipcRenderer.invoke('activation:activate', input) as Promise<
        | {
            ok: true
            data: {
              activation_token: string
              expires_at: number
              max_devices: number
              used_devices: number
              device_name: string
            }
          }
        | { ok: false; error: { code: string; message: string } }
      >,
    getStatus: () => ipcRenderer.invoke('activation:get-status') as Promise<ActivationBadgeState>,
    syncStatus: () => ipcRenderer.invoke('activation:sync-status') as Promise<ActivationBadgeState>,
    onStatusChanged: (callback: (status: ActivationBadgeState) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, status: ActivationBadgeState) => {
        callback(status)
      }
      ipcRenderer.on('activation:status-changed', listener)

      return () => {
        ipcRenderer.removeListener('activation:status-changed', listener)
      }
    },
  },
}

contextBridge.exposeInMainWorld('api', api)
