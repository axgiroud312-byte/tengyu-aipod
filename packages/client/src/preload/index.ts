import type { ActivationBadgeState } from '@tengyu-aipod/shared'
import { contextBridge, ipcRenderer } from 'electron'

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
