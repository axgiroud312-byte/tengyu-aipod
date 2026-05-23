import type { ActivationBadgeState } from '@tengyu-aipod/shared'
import { create } from 'zustand'

interface ActivationStore {
  status: ActivationBadgeState | null
  initialized: boolean
  setStatus: (status: ActivationBadgeState) => void
  refresh: () => Promise<void>
}

export const useActivationStore = create<ActivationStore>((set) => ({
  status: null,
  initialized: false,
  setStatus: (status) => set({ status, initialized: true }),
  refresh: async () => {
    const status = await window.api.activation.syncStatus()
    set({ status, initialized: true })
  },
}))

export async function initializeActivationStore() {
  const status = await window.api.activation.getStatus()
  useActivationStore.getState().setStatus(status)

  return window.api.activation.onStatusChanged((nextStatus) => {
    useActivationStore.getState().setStatus(nextStatus)
  })
}
