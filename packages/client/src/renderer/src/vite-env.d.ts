/// <reference types="vite/client" />

declare global {
  interface Window {
    api: {
      ping: () => Promise<string>
      onboarding: {
        getState: () => Promise<{
          needs_onboarding: boolean
          default_workbench_root: string
        }>
        chooseWorkbenchRoot: () => Promise<
          | { ok: true; data: { path: string } }
          | { ok: false; error: { code: string; message: string } }
        >
        saveWorkbenchRoot: (path: string) => Promise<{ ok: true; data: { path: string } }>
        saveApiKeys: (apiKeys: Record<string, string>) => Promise<{ ok: true }>
        complete: () => Promise<{ ok: true }>
      }
      keychain: {
        has: (key: string) => Promise<boolean>
      }
      activation: {
        activate: (input: { code: string; device_name: string }) => Promise<
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
        >
        getStatus: () => Promise<import('@tengyu-aipod/shared').ActivationBadgeState>
        syncStatus: () => Promise<import('@tengyu-aipod/shared').ActivationBadgeState>
        onStatusChanged: (
          callback: (status: import('@tengyu-aipod/shared').ActivationBadgeState) => void,
        ) => () => void
      }
      photoshop: {
        getStatus: () => Promise<import('@tengyu-aipod/shared').PhotoshopStatus>
        scanTemplate: (
          input: import('@tengyu-aipod/shared').PhotoshopScanTemplateRequest,
        ) => Promise<import('@tengyu-aipod/shared').PsdTemplate>
        listCachedTemplates: () => Promise<import('@tengyu-aipod/shared').PsdTemplate[]>
      }
    }
  }
}

export {}
