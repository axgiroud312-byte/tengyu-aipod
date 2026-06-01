export const APP_VERSION = '0.0.0'

export const DEFAULT_TASK_CONCURRENCY = 3
export const CACHE_REFRESH_INTERVAL_MINUTES = 30
export const TEMP_FILE_MAX_AGE_HOURS = 24

export const API_PATHS = {
  skills: '/api/skills',
  announcements: '/api/announcements',
  clientVersion: '/api/client-version',
  telemetry: '/api/telemetry',
} as const

export const WORKBENCH_DIRECTORIES = {
  collection: '01-采集工作区',
  generation: '02-印花工作区',
  detection: '03-检测工作区',
  listing: '04-上架工作区',
  productImages: '04-上架工作区',
  metadata: '.workbench',
} as const

export const VISION_MODEL_PRICES = {
  'qwen3.6-flash': { input: 1.2, output: 7.2 },
} as const

export type VisionModelKey = keyof typeof VISION_MODEL_PRICES

export type VisionModelOption = {
  key: VisionModelKey
  label: string
  inputPrice: number
  outputPrice: number
  recommendedFor: 'title' | 'detection' | 'general'
}

const VISION_MODEL_OPTIONS: VisionModelOption[] = [
  {
    key: 'qwen3.6-flash',
    label: 'qwen3.6-flash',
    inputPrice: VISION_MODEL_PRICES['qwen3.6-flash'].input,
    outputPrice: VISION_MODEL_PRICES['qwen3.6-flash'].output,
    recommendedFor: 'general',
  },
]

export function listVisionModels(): VisionModelOption[] {
  return VISION_MODEL_OPTIONS.map((model) => ({ ...model }))
}

export const DETECTION_MODEL_PRICES = VISION_MODEL_PRICES

export type DetectionModel = keyof typeof DETECTION_MODEL_PRICES

export function estimateDetectionCost(
  imageCount: number,
  model: DetectionModel | string,
  withCompression: boolean,
): { yuan: number; tokensPerImage: number } {
  const safeImageCount = Number.isFinite(imageCount) ? Math.max(0, Math.floor(imageCount)) : 0
  const price =
    DETECTION_MODEL_PRICES[model as DetectionModel] ?? DETECTION_MODEL_PRICES['qwen3.6-flash']
  const tokensPerImagePixels = withCompression ? 256 : 1024
  const tokensOutput = 100
  const yuan =
    (safeImageCount * tokensPerImagePixels * price.input) / 1_000_000 +
    (safeImageCount * tokensOutput * price.output) / 1_000_000
  return { yuan, tokensPerImage: tokensPerImagePixels + tokensOutput }
}
