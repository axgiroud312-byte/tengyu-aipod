import { ipcMain } from 'electron'
import { getSecret, setSecret } from './keychain'
import { type GenerationLocalConfig, readAppConfig, writeAppConfig } from './workbench-config'

export type LocalModelModality = 'text' | 'vision'

export type LocalModelOption = {
  id: string
  label: string
  modality: LocalModelModality
}

export type GrsaiImageModelOption = {
  id: 'gpt-image-2' | 'gpt-image-2-vip'
  label: string
  sizes: string[]
  allowCustomSize: boolean
}

export type GenerationLocalSettingsSnapshot = {
  grsaiKeyConfigured: boolean
  bailianKeyConfigured: boolean
  config: Required<GenerationLocalConfig>
  grsaiModels: GrsaiImageModelOption[]
  bailianTextModels: LocalModelOption[]
  bailianVisionModels: LocalModelOption[]
}

export type SaveGenerationLocalSettingsInput = {
  grsaiApiKey?: string
  bailianApiKey?: string
  config: GenerationLocalConfig
}

export const GRSAI_IMAGE_MODELS: GrsaiImageModelOption[] = [
  {
    id: 'gpt-image-2',
    label: 'gpt-image-2',
    allowCustomSize: false,
    sizes: [
      '1024x1024',
      '1672x941',
      '941x1672',
      '1443x1090',
      '1090x1443',
      '1536x1024',
      '1024x1536',
      '1408x1120',
      '1120x1408',
      '1920x832',
      '832x1920',
      '896x1792',
      '1792x896',
    ],
  },
  {
    id: 'gpt-image-2-vip',
    label: 'gpt-image-2-vip',
    allowCustomSize: true,
    sizes: [
      '1024x1024',
      '2048x2048',
      '2880x2880',
      '1280x720',
      '2048x1152',
      '3840x2160',
      '720x1280',
      '1152x2048',
      '2160x3840',
      '1152x864',
      '2304x1728',
      '3264x2448',
      '864x1152',
      '1728x2304',
      '2448x3264',
      '1536x1024',
      '2048x1360',
      '3504x2336',
      '1024x1536',
      '1360x2048',
      '2336x3504',
      '1120x896',
      '2240x1792',
      '3200x2560',
      '896x1120',
      '1792x2240',
      '2560x3200',
      '1456x624',
      '2912x1248',
      '3840x1648',
      '624x1456',
      '1248x2912',
      '1648x3840',
      '688x2048',
      '1280x3840',
      '2048x688',
      '3840x1280',
      '1536x768',
      '3072x1536',
      '3840x1920',
      '768x1536',
      '1536x3072',
      '1920x3840',
    ],
  },
]

export const BAILIAN_TEXT_MODELS: LocalModelOption[] = [
  { id: 'qwen-plus', label: 'qwen-plus', modality: 'text' },
  { id: 'qwen-turbo', label: 'qwen-turbo', modality: 'text' },
  { id: 'qwen-max', label: 'qwen-max', modality: 'text' },
  { id: 'qwen-long', label: 'qwen-long', modality: 'text' },
  { id: 'qwen3-max', label: 'qwen3-max', modality: 'text' },
  { id: 'qwen3.6-plus', label: 'qwen3.6-plus', modality: 'text' },
  { id: 'qwen3.6-flash', label: 'qwen3.6-flash', modality: 'text' },
  { id: 'qwen3.5-plus', label: 'qwen3.5-plus', modality: 'text' },
  { id: 'qwen3.5-plus-2026-02-15', label: 'qwen3.5-plus-2026-02-15', modality: 'text' },
  { id: 'qwen3.5-flash', label: 'qwen3.5-flash', modality: 'text' },
  { id: 'qwen3.5-flash-2026-02-23', label: 'qwen3.5-flash-2026-02-23', modality: 'text' },
  { id: 'qwen3.5-397b-a17b', label: 'qwen3.5-397b-a17b', modality: 'text' },
  { id: 'qwen3.5-122b-a10b', label: 'qwen3.5-122b-a10b', modality: 'text' },
  { id: 'qwen3.5-27b', label: 'qwen3.5-27b', modality: 'text' },
  { id: 'qwen3.5-35b-a3b', label: 'qwen3.5-35b-a3b', modality: 'text' },
]

export const BAILIAN_VISION_MODELS: LocalModelOption[] = [
  { id: 'qwen3.6-plus', label: 'qwen3.6-plus', modality: 'vision' },
  { id: 'qwen3.6-flash', label: 'qwen3.6-flash', modality: 'vision' },
  { id: 'qwen3.5-plus', label: 'qwen3.5-plus', modality: 'vision' },
  { id: 'qwen3.5-plus-2026-02-15', label: 'qwen3.5-plus-2026-02-15', modality: 'vision' },
  { id: 'qwen3.5-flash', label: 'qwen3.5-flash', modality: 'vision' },
  { id: 'qwen3.5-flash-2026-02-23', label: 'qwen3.5-flash-2026-02-23', modality: 'vision' },
  { id: 'qwen3.5-397b-a17b', label: 'qwen3.5-397b-a17b', modality: 'vision' },
  { id: 'qwen3.5-122b-a10b', label: 'qwen3.5-122b-a10b', modality: 'vision' },
  { id: 'qwen3.5-27b', label: 'qwen3.5-27b', modality: 'vision' },
  { id: 'qwen3.5-35b-a3b', label: 'qwen3.5-35b-a3b', modality: 'vision' },
  { id: 'qwen3-vl-plus', label: 'qwen3-vl-plus', modality: 'vision' },
  { id: 'qwen3-vl-plus-2026-01-25', label: 'qwen3-vl-plus-2026-01-25', modality: 'vision' },
  { id: 'qwen3-vl-flash', label: 'qwen3-vl-flash', modality: 'vision' },
  { id: 'qwen3-vl-flash-2026-01-25', label: 'qwen3-vl-flash-2026-01-25', modality: 'vision' },
  { id: 'qwen-vl-max', label: 'qwen-vl-max', modality: 'vision' },
  { id: 'qwen-vl-plus', label: 'qwen-vl-plus', modality: 'vision' },
  { id: 'qwen-vl-ocr', label: 'qwen-vl-ocr', modality: 'vision' },
  { id: 'qwen-vl-ocr-latest', label: 'qwen-vl-ocr-latest', modality: 'vision' },
  { id: 'qwen-vl-ocr-2025-07-14', label: 'qwen-vl-ocr-2025-07-14', modality: 'vision' },
  { id: 'qwen2.5-vl-72b-instruct', label: 'qwen2.5-vl-72b-instruct', modality: 'vision' },
  { id: 'qwen2.5-vl-32b-instruct', label: 'qwen2.5-vl-32b-instruct', modality: 'vision' },
  { id: 'qwen2.5-vl-7b-instruct', label: 'qwen2.5-vl-7b-instruct', modality: 'vision' },
  { id: 'qwen2.5-vl-3b-instruct', label: 'qwen2.5-vl-3b-instruct', modality: 'vision' },
  { id: 'qwen2-vl-72b-instruct', label: 'qwen2-vl-72b-instruct', modality: 'vision' },
  { id: 'qwen2-vl-7b-instruct', label: 'qwen2-vl-7b-instruct', modality: 'vision' },
  { id: 'qvq-max', label: 'qvq-max', modality: 'vision' },
  { id: 'qvq-plus', label: 'qvq-plus', modality: 'vision' },
]

export const DEFAULT_GENERATION_LOCAL_CONFIG: Required<GenerationLocalConfig> = {
  bailian_text_model: 'qwen-plus',
  bailian_vision_model: 'qwen3-vl-plus',
  grsai_node: 'cn',
  grsai_concurrency: 3,
  grsai_retries: 2,
}

export function clampGenerationInt(value: unknown, min: number, max: number, fallback: number) {
  const parsed = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(parsed)) {
    return fallback
  }
  return Math.max(min, Math.min(max, Math.floor(parsed)))
}

export function normalizeGenerationLocalConfig(
  config: GenerationLocalConfig = {},
): Required<GenerationLocalConfig> {
  const textModel = BAILIAN_TEXT_MODELS.some((model) => model.id === config.bailian_text_model)
    ? config.bailian_text_model
    : DEFAULT_GENERATION_LOCAL_CONFIG.bailian_text_model
  const visionModel = BAILIAN_VISION_MODELS.some((model) => model.id === config.bailian_vision_model)
    ? config.bailian_vision_model
    : DEFAULT_GENERATION_LOCAL_CONFIG.bailian_vision_model

  return {
    bailian_text_model: textModel ?? DEFAULT_GENERATION_LOCAL_CONFIG.bailian_text_model,
    bailian_vision_model: visionModel ?? DEFAULT_GENERATION_LOCAL_CONFIG.bailian_vision_model,
    grsai_node: config.grsai_node === 'global' ? 'global' : 'cn',
    grsai_concurrency: clampGenerationInt(config.grsai_concurrency, 1, 20, 3),
    grsai_retries: clampGenerationInt(config.grsai_retries, 0, 5, 2),
  }
}

export async function readGenerationLocalSettings(): Promise<GenerationLocalSettingsSnapshot> {
  const appConfig = await readAppConfig()
  return {
    grsaiKeyConfigured: Boolean(await getSecret('grsai')),
    bailianKeyConfigured: Boolean(await getSecret('bailian')),
    config: normalizeGenerationLocalConfig(appConfig.generation),
    grsaiModels: GRSAI_IMAGE_MODELS,
    bailianTextModels: BAILIAN_TEXT_MODELS,
    bailianVisionModels: BAILIAN_VISION_MODELS,
  }
}

export async function saveGenerationLocalSettings(input: SaveGenerationLocalSettingsInput) {
  const grsaiApiKey = input.grsaiApiKey?.trim()
  const bailianApiKey = input.bailianApiKey?.trim()
  if (grsaiApiKey) {
    await setSecret('grsai', grsaiApiKey)
  }
  if (bailianApiKey) {
    await setSecret('bailian', bailianApiKey)
  }

  const appConfig = await readAppConfig()
  await writeAppConfig({
    ...appConfig,
    generation: normalizeGenerationLocalConfig(input.config),
  })
  return readGenerationLocalSettings()
}

export function registerGenerationLocalConfigIpc() {
  ipcMain.handle('generation-settings:get', () => readGenerationLocalSettings())
  ipcMain.handle('generation-settings:save', (_event, input: SaveGenerationLocalSettingsInput) =>
    saveGenerationLocalSettings(input),
  )
}
