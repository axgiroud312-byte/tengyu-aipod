import type { GenerationCapability } from '@tengyu-aipod/shared'
import { create } from 'zustand'

export type GenerationProvider = 'grsai' | 'comfyui-chenyu'
export type GenerationUiCapability = GenerationCapability | 'extract-matting'

export type GenerationTabState = {
  provider: GenerationProvider
}

export type GenerationSettingsSnapshot = Awaited<
  ReturnType<typeof window.api.generationSettings.get>
>

export type GenerationState = {
  activeCapability: GenerationUiCapability
  generationSettings: GenerationSettingsSnapshot | null
  generationSettingsError: string | null
  generationSettingsLoading: boolean
  settingsLoadedVersion: number
  settingsVersion: number
  tabs: Record<GenerationUiCapability, GenerationTabState>
  workflowsVersion: number
  loadGenerationSettings: () => Promise<void>
  notifyComfyuiWorkflowsUpdated: () => void
  notifyGenerationSettingsUpdated: (settings?: GenerationSettingsSnapshot) => void
  setActiveCapability: (capability: GenerationUiCapability) => void
  setProvider: (capability: GenerationUiCapability, provider: GenerationProvider) => void
}

export const generationCapabilities: Array<{
  key: GenerationUiCapability
  label: string
  outputDir: string
}> = [
  { key: 'txt2img', label: '文生图', outputDir: '02-印花工作区 / 文生图' },
  { key: 'img2img', label: '图生图', outputDir: '02-印花工作区 / 图生图' },
  { key: 'extract', label: '提取', outputDir: '02-印花工作区 / 提取' },
  { key: 'matting', label: '抠图', outputDir: '02-印花工作区 / 抠图' },
  { key: 'extract-matting', label: '提取后抠图', outputDir: '02-印花工作区 / 抠图' },
]

export const generationProviders: Array<{ key: GenerationProvider; label: string }> = [
  { key: 'grsai', label: '付费 Grsai' },
  { key: 'comfyui-chenyu', label: 'ComfyUI 晨羽' },
]

export const generationProviderMatrix: Record<GenerationUiCapability, GenerationProvider[]> = {
  txt2img: ['grsai', 'comfyui-chenyu'],
  img2img: ['grsai', 'comfyui-chenyu'],
  extract: ['grsai', 'comfyui-chenyu'],
  matting: ['comfyui-chenyu'],
  'extract-matting': ['comfyui-chenyu'],
}

const defaultTabs: Record<GenerationUiCapability, GenerationTabState> = {
  txt2img: { provider: 'grsai' },
  img2img: { provider: 'grsai' },
  extract: { provider: 'grsai' },
  matting: { provider: 'comfyui-chenyu' },
  'extract-matting': { provider: 'comfyui-chenyu' },
}

export function isGenerationProviderAvailable(
  capability: GenerationUiCapability,
  provider: GenerationProvider,
) {
  return generationProviderMatrix[capability].includes(provider)
}

function defaultProviderFor(capability: GenerationUiCapability) {
  return generationProviderMatrix[capability][0] ?? 'grsai'
}

function generationSettingsErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : '读取本地生图设置失败'
}

export const useGenerationStore = create<GenerationState>((set, get) => ({
  activeCapability: 'txt2img',
  generationSettings: null,
  generationSettingsError: null,
  generationSettingsLoading: false,
  settingsLoadedVersion: -1,
  settingsVersion: 0,
  tabs: defaultTabs,
  workflowsVersion: 0,
  loadGenerationSettings: async () => {
    const current = get()
    if (
      current.generationSettingsLoading ||
      (current.generationSettings && current.settingsLoadedVersion === current.settingsVersion)
    ) {
      return
    }

    const targetVersion = current.settingsVersion
    set({ generationSettingsError: null, generationSettingsLoading: true })
    try {
      const settings = await window.api.generationSettings.get()
      set({
        generationSettings: settings,
        generationSettingsError: null,
        settingsLoadedVersion: targetVersion,
      })
    } catch (error) {
      set({
        generationSettingsError: generationSettingsErrorMessage(error),
        settingsLoadedVersion: targetVersion,
      })
    } finally {
      set({ generationSettingsLoading: false })
    }
  },
  notifyComfyuiWorkflowsUpdated: () =>
    set((state) => ({ workflowsVersion: state.workflowsVersion + 1 })),
  notifyGenerationSettingsUpdated: (settings) =>
    set((state) => {
      const nextVersion = state.settingsVersion + 1
      return {
        generationSettings: settings ?? state.generationSettings,
        generationSettingsError: settings ? null : state.generationSettingsError,
        settingsLoadedVersion: settings ? nextVersion : state.settingsLoadedVersion,
        settingsVersion: nextVersion,
      }
    }),
  setActiveCapability: (capability) =>
    set((state) => {
      const currentProvider = state.tabs[capability].provider
      if (isGenerationProviderAvailable(capability, currentProvider)) {
        return { activeCapability: capability }
      }

      return {
        activeCapability: capability,
        tabs: {
          ...state.tabs,
          [capability]: { provider: defaultProviderFor(capability) },
        },
      }
    }),
  setProvider: (capability, provider) =>
    set((state) => {
      if (!isGenerationProviderAvailable(capability, provider)) {
        return state
      }

      return {
        tabs: {
          ...state.tabs,
          [capability]: { provider },
        },
      }
    }),
}))
