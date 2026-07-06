export type ChenyuSettingsSnapshot = Awaited<ReturnType<typeof window.api.chenyu.getSettings>>
export type ChenyuConfig = ChenyuSettingsSnapshot['config']
export type ChenyuGpu = Awaited<ReturnType<typeof window.api.chenyu.listGpus>>[number]
export type ChenyuInstance = Awaited<ReturnType<typeof window.api.chenyu.listInstances>>[number]
export type GenerationSettingsSnapshot = Awaited<
  ReturnType<typeof window.api.generationSettings.get>
>
export type GenerationConfig = GenerationSettingsSnapshot['config']
export type WorkspaceState = Awaited<ReturnType<typeof window.api.workspace.getState>>
export type SkillSyncResult = Awaited<ReturnType<typeof window.api.skill.refresh>>
export type LocalWorkflowSummary = Awaited<ReturnType<typeof window.api.workflow.listLocal>>[number]
export type ConnectionStatus = 'unchecked' | 'checking' | 'connected' | 'failed'
export type InstanceAction = 'startup' | 'shutdown' | 'restart' | 'active'
export type SettingsTab = 'general' | 'chenyu'

export const DEFAULT_GPU_NUMS = 1
export const POLL_INTERVAL_MS = 2_500
export const STARTUP_POLL_TIMEOUT_MS = 10 * 60_000
export const SHUTDOWN_POLL_TIMEOUT_MS = 5 * 60_000

export const fieldIds = {
  apiKey: 'chenyu-api-key',
  podKeyword: 'chenyu-pod-keyword',
  podUuid: 'chenyu-pod-uuid',
  podTags: 'chenyu-pod-tags',
  podVersion: 'chenyu-pod-version',
  gpu: 'chenyu-gpu',
  shutdown: 'chenyu-shutdown-minutes',
}

export const emptyConfig: ChenyuConfig = {
  pod_search_keyword: '杭州慎思comfyui镜像',
  pod_tags: [],
  default_gpu_nums: DEFAULT_GPU_NUMS,
  auto_shutdown_minutes: null,
}

export const defaultGenerationConfig: GenerationConfig = {
  bailian_text_model: 'qwen3.6-flash',
  bailian_vision_model: 'qwen3.6-flash',
  grsai_node: 'cn',
  default_concurrency: 20,
  grsai_concurrency: 20,
  grsai_retries: 2,
}

export const workflowCategoryOptions: Array<{
  key: LocalWorkflowSummary['capability']
  label: string
}> = [
  { key: 'txt2img', label: '文生图' },
  { key: 'img2img', label: '图生图' },
  { key: 'extract', label: '提取' },
  { key: 'matting', label: '抠图' },
  { key: 'matting-mixed', label: '混合抠图' },
]

export const statusText: Record<ChenyuInstance['statusName'], string> = {
  created: '已创建',
  initializing: '初始化等待中',
  running: '运行中',
  shutting_down: '关闭中',
  stopped: '已关机',
  abnormal_stopped: '异常停止',
  starting: '初始化等待中',
  restarting: '重启中',
  unknown: '未知',
}

export const statusClassName: Record<ChenyuInstance['statusName'], string> = {
  created: 'border-slate-200 bg-slate-50 text-slate-700',
  initializing: 'border-blue-200 bg-blue-50 text-blue-700',
  running: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  shutting_down: 'border-amber-200 bg-amber-50 text-amber-800',
  stopped: 'border-slate-200 bg-slate-50 text-slate-700',
  abnormal_stopped: 'border-red-200 bg-red-50 text-red-700',
  starting: 'border-blue-200 bg-blue-50 text-blue-700',
  restarting: 'border-blue-200 bg-blue-50 text-blue-700',
  unknown: 'border-slate-200 bg-slate-50 text-slate-700',
}

export const connectionText: Record<ConnectionStatus, string> = {
  unchecked: '未配置',
  checking: '检测中',
  connected: '连接成功',
  failed: '连接失败',
}

export const connectionClassName: Record<ConnectionStatus, string> = {
  unchecked: 'border-slate-200 bg-slate-50 text-slate-700',
  checking: 'border-blue-200 bg-blue-50 text-blue-700',
  connected: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  failed: 'border-red-200 bg-red-50 text-red-700',
}

export function selectPreferredGpu(gpus: ChenyuGpu[]) {
  return gpus.find((gpu) => /rtx\s*4080/i.test(gpu.gpu_name)) ?? gpus[0] ?? null
}

export function parseTags(value: string) {
  return Array.from(
    new Set(
      value
        .split(/[\n,，]/)
        .map((item) => item.trim())
        .filter(Boolean),
    ),
  )
}

export function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback
}

export function formatLogBytes(bytes: number) {
  if (bytes < 1024) {
    return `${bytes} B`
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`
  }
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

export function delay(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms))
}
