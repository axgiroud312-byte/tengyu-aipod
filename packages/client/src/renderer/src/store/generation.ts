import type { GenerationCapability } from '@tengyu-aipod/shared'
import { create } from 'zustand'

export type GenerationProvider = 'grsai' | 'comfyui-chenyu'
export type GenerationUiCapability = GenerationCapability | 'extract-matting'

export type GenerationTabState = {
  provider: GenerationProvider
}

export type GenerationState = {
  activeCapability: GenerationUiCapability
  tabs: Record<GenerationUiCapability, GenerationTabState>
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
