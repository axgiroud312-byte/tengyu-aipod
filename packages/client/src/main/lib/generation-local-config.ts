import { createRequire } from 'node:module'
import { AppErrorClass } from '@tengyu-aipod/shared'
import type { ipcMain as ElectronIpcMain } from 'electron'
import { z } from 'zod'
import { getSecret, setSecret } from './keychain'
import { type GenerationLocalConfig, readAppConfig, writeAppConfig } from './workbench-config'

const nodeRequire = createRequire(import.meta.url)

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
  config: NormalizedGenerationLocalConfig
  grsaiModels: GrsaiImageModelOption[]
  bailianTextModels: LocalModelOption[]
  bailianVisionModels: LocalModelOption[]
}

export type NormalizedGenerationLocalConfig = {
  bailian_text_model: string
  bailian_vision_model: string
  grsai_node: 'cn' | 'global'
  default_concurrency: number
  grsai_concurrency: number
  grsai_retries: number
}

export type SaveGenerationLocalSettingsInput = {
  grsaiApiKey?: string | undefined
  bailianApiKey?: string | undefined
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
  { id: 'qwen3.6-flash', label: 'qwen3.6-flash', modality: 'text' },
  { id: 'qwen3-vl-flash', label: 'qwen3-vl-flash', modality: 'text' },
]

export const BAILIAN_VISION_MODELS: LocalModelOption[] = [
  { id: 'qwen3.6-flash', label: 'qwen3.6-flash', modality: 'vision' },
  { id: 'qwen3-vl-flash', label: 'qwen3-vl-flash', modality: 'vision' },
]

export const DEFAULT_GENERATION_LOCAL_CONFIG: NormalizedGenerationLocalConfig = {
  bailian_text_model: 'qwen3.6-flash',
  bailian_vision_model: 'qwen3.6-flash',
  grsai_node: 'cn',
  default_concurrency: 20,
  grsai_concurrency: 20,
  grsai_retries: 2,
}

const rawGenerationLocalConfigSchema = z.object({
  bailian_text_model: z.string().optional(),
  bailian_vision_model: z.string().optional(),
  grsai_node: z.enum(['cn', 'global']).optional(),
  default_concurrency: z.number().optional(),
  grsai_concurrency: z.number().optional(),
  grsai_retries: z.number().optional(),
})
const generationLocalConfigSchema = rawGenerationLocalConfigSchema.transform(
  (config): GenerationLocalConfig => {
    const result: GenerationLocalConfig = {}
    if (config.bailian_text_model !== undefined) {
      result.bailian_text_model = config.bailian_text_model
    }
    if (config.bailian_vision_model !== undefined) {
      result.bailian_vision_model = config.bailian_vision_model
    }
    if (config.grsai_node !== undefined) {
      result.grsai_node = config.grsai_node
    }
    if (config.default_concurrency !== undefined) {
      result.default_concurrency = config.default_concurrency
    }
    if (config.grsai_concurrency !== undefined) {
      result.grsai_concurrency = config.grsai_concurrency
    }
    if (config.grsai_retries !== undefined) {
      result.grsai_retries = config.grsai_retries
    }
    return result
  },
)
const saveGenerationLocalSettingsInputSchema = z
  .object({
    grsaiApiKey: z.string().optional(),
    bailianApiKey: z.string().optional(),
    config: generationLocalConfigSchema,
  })
  .transform((input): SaveGenerationLocalSettingsInput => {
    const result: SaveGenerationLocalSettingsInput = { config: input.config }
    if (input.grsaiApiKey !== undefined) {
      result.grsaiApiKey = input.grsaiApiKey
    }
    if (input.bailianApiKey !== undefined) {
      result.bailianApiKey = input.bailianApiKey
    }
    return result
  })

function parseGenerationSettingsIpcInput<T>(
  schema: z.ZodType<T>,
  input: unknown,
  message: string,
): T {
  const parsed = schema.safeParse(input)
  if (!parsed.success) {
    throw new AppErrorClass('INVALID_INPUT', message, false, {
      issues: parsed.error.issues,
    })
  }
  return parsed.data
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
): NormalizedGenerationLocalConfig {
  const configuredTextModel = config.bailian_text_model
  const textModel =
    configuredTextModel && BAILIAN_TEXT_MODELS.some((model) => model.id === configuredTextModel)
      ? configuredTextModel
      : DEFAULT_GENERATION_LOCAL_CONFIG.bailian_text_model
  const configuredVisionModel = config.bailian_vision_model
  const visionModel =
    configuredVisionModel &&
    BAILIAN_VISION_MODELS.some((model) => model.id === configuredVisionModel)
      ? configuredVisionModel
      : DEFAULT_GENERATION_LOCAL_CONFIG.bailian_vision_model

  const defaultConcurrency = clampGenerationInt(
    config.default_concurrency ?? config.grsai_concurrency,
    1,
    20,
    DEFAULT_GENERATION_LOCAL_CONFIG.default_concurrency,
  )

  return {
    bailian_text_model: textModel ?? DEFAULT_GENERATION_LOCAL_CONFIG.bailian_text_model,
    bailian_vision_model: visionModel ?? DEFAULT_GENERATION_LOCAL_CONFIG.bailian_vision_model,
    grsai_node: config.grsai_node === 'global' ? 'global' : 'cn',
    default_concurrency: defaultConcurrency,
    grsai_concurrency: defaultConcurrency,
    grsai_retries: clampGenerationInt(config.grsai_retries, 0, 10, 2),
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

function electronIpcMain(): typeof ElectronIpcMain {
  return (nodeRequire('electron') as typeof import('electron')).ipcMain
}

export function registerGenerationLocalConfigIpc() {
  const ipcMain = electronIpcMain()
  ipcMain.handle('generation-settings:get', () => readGenerationLocalSettings())
  ipcMain.handle('generation-settings:save', (_event, input: unknown) =>
    saveGenerationLocalSettings(
      parseGenerationSettingsIpcInput(
        saveGenerationLocalSettingsInputSchema,
        input,
        '生图本地设置参数不正确',
      ),
    ),
  )
}
