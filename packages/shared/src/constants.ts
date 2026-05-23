export const APP_VERSION = '0.0.0'

export const DEFAULT_TASK_CONCURRENCY = 3
export const ACTIVATION_MAX_OFFLINE_DAYS = 7
export const CACHE_REFRESH_INTERVAL_MINUTES = 30
export const TEMP_FILE_MAX_AGE_HOURS = 24

export const API_PATHS = {
  activate: '/api/activate',
  status: '/api/status',
  skills: '/api/skills',
  providers: '/api/providers',
  comfyuiWorkflows: '/api/comfyui-workflows',
  announcements: '/api/announcements',
  clientVersion: '/api/client-version',
  telemetry: '/api/telemetry',
} as const

export const WORKBENCH_DIRECTORIES = {
  collection: '01-采集',
  generation: '02-生图',
  detection: '03-检测',
  mattingInput: '04-待套版印花',
  productImages: '05-货号成品',
  metadata: '.workbench',
} as const

export const DETECTION_MODEL_PRICES = {
  'qwen3-vl-flash': { input: 0.15, output: 1.5 },
  'qwen3-vl-plus': { input: 1, output: 10 },
  'qwen-vl-max': { input: 1.6, output: 4 },
} as const

export type DetectionModel = keyof typeof DETECTION_MODEL_PRICES

export function estimateDetectionCost(
  imageCount: number,
  model: DetectionModel | string,
  withCompression: boolean,
): { yuan: number; tokensPerImage: number } {
  const safeImageCount = Number.isFinite(imageCount) ? Math.max(0, Math.floor(imageCount)) : 0
  const price =
    DETECTION_MODEL_PRICES[model as DetectionModel] ?? DETECTION_MODEL_PRICES['qwen3-vl-flash']
  const tokensPerImagePixels = withCompression ? 256 : 1024
  const tokensOutput = 100
  const yuan =
    (safeImageCount * tokensPerImagePixels * price.input) / 1_000_000 +
    (safeImageCount * tokensOutput * price.output) / 1_000_000
  return { yuan, tokensPerImage: tokensPerImagePixels + tokensOutput }
}
