import type { GenerationCapability } from '@tengyu-aipod/shared'
import { create } from 'zustand'

export type GenerationProvider = 'grsai' | 'comfyui-chenyu'

export type GenerationTabState = {
  provider: GenerationProvider
}

export type GenerationState = {
  activeCapability: GenerationCapability
  tabs: Record<GenerationCapability, GenerationTabState>
  setActiveCapability: (capability: GenerationCapability) => void
  setProvider: (capability: GenerationCapability, provider: GenerationProvider) => void
}

export const generationCapabilities: Array<{
  key: GenerationCapability
  label: string
  outputDir: string
}> = [
  { key: 'txt2img', label: '文生图', outputDir: '02-生图 / 01-文生图' },
  { key: 'img2img', label: '图生图', outputDir: '02-生图 / 02-图生图' },
  { key: 'extract', label: '提取', outputDir: '02-生图 / 03-提取' },
  { key: 'matting', label: '抠图', outputDir: '02-生图 / 04-抠图' },
]

export const generationProviders: Array<{ key: GenerationProvider; label: string }> = [
  { key: 'grsai', label: '付费 Grsai' },
  { key: 'comfyui-chenyu', label: 'ComfyUI 晨羽' },
]

export const generationProviderMatrix: Record<GenerationCapability, GenerationProvider[]> = {
  txt2img: ['grsai', 'comfyui-chenyu'],
  img2img: ['grsai', 'comfyui-chenyu'],
  extract: ['grsai', 'comfyui-chenyu'],
  matting: ['comfyui-chenyu'],
}

const defaultTabs: Record<GenerationCapability, GenerationTabState> = {
  txt2img: { provider: 'grsai' },
  img2img: { provider: 'grsai' },
  extract: { provider: 'grsai' },
  matting: { provider: 'comfyui-chenyu' },
}

export function isGenerationProviderAvailable(
  capability: GenerationCapability,
  provider: GenerationProvider,
) {
  return generationProviderMatrix[capability].includes(provider)
}

function defaultProviderFor(capability: GenerationCapability) {
  return generationProviderMatrix[capability][0] ?? 'grsai'
}

export const useGenerationStore = create<GenerationState>((set) => ({
  activeCapability: 'txt2img',
  tabs: defaultTabs,
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
