/// <reference types="vite/client" />

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
    }
  }
}
