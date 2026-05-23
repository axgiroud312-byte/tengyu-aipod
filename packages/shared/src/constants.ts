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
