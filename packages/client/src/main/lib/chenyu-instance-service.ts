import { AppErrorClass } from '@tengyu-aipod/shared'
import { ipcMain } from 'electron'
import { z } from 'zod'
import {
  ChenyuCloudClient,
  type ChenyuGpu,
  type ChenyuInstanceInfo,
  type ChenyuPod,
  chenyuStatusName,
} from './chenyu-cloud-client'
import {
  ComfyuiInstanceManager,
  type ComfyuiInstanceSummary,
  comfyuiUrlCandidates,
  extractComfyuiUrl,
} from './comfyui-instance-manager'
import { getSecret, setSecret } from './keychain'
import { type ChenyuConfig, readAppConfig, writeAppConfig } from './workbench-config'

export type ChenyuSettingsSnapshot = {
  apiKeyConfigured: boolean
  config: ChenyuConfig
}

export type ChenyuSaveSettingsInput = {
  apiKey?: string | undefined
  config: ChenyuConfig
}

export type ChenyuPodDiscoveryResult = {
  pods: ChenyuPod[]
  selected: ChenyuPod | null
  tags: string[]
}

export type ChenyuManagedInstance = {
  instanceUuid: string
  title: string
  status: number
  statusName: ReturnType<typeof chenyuStatusName>
  imageName: string | null
  podUuid: string | null
  podTag: string | null
  gpuUuid: string | null
  gpuName: string | null
  comfyuiUrl: string | null
  serverUrls: string[]
  isCurrent: boolean
  isFixedPod: boolean
  raw: ChenyuInstanceInfo
}

export type ChenyuCreatePodInstanceInput = {
  podUuid?: string | undefined
  podTitle?: string | undefined
  podTag?: string | undefined
  instanceTitle?: string | undefined
  gpuUuid?: string | undefined
  gpuNums?: number | undefined
  autoShutdownMinutes?: number | null | undefined
}

const DEFAULT_GPU_NUMS = 1
const POD_DISCOVERY_PAGE_SIZE = 50
const GPU_PAGE_SIZE = 100
export const ALLOWED_CHENYU_POD_TITLE = '杭州慎思comfyui镜像'
const rawChenyuConfigSchema = z.object({
  pod_search_keyword: z.string().optional(),
  pod_title: z.string().optional(),
  pod_uuid: z.string().optional(),
  pod_tags: z.array(z.string()).optional(),
  default_pod_tag: z.string().optional(),
  default_gpu_uuid: z.string().optional(),
  default_gpu_name: z.string().optional(),
  default_gpu_nums: z.number().optional(),
  auto_shutdown_minutes: z.number().nullable().optional(),
})
const chenyuConfigSchema = rawChenyuConfigSchema.transform((config): ChenyuConfig => {
  const result: ChenyuConfig = {}
  if (config.pod_search_keyword !== undefined) {
    result.pod_search_keyword = config.pod_search_keyword
  }
  if (config.pod_title !== undefined) {
    result.pod_title = config.pod_title
  }
  if (config.pod_uuid !== undefined) {
    result.pod_uuid = config.pod_uuid
  }
  if (config.pod_tags !== undefined) {
    result.pod_tags = config.pod_tags
  }
  if (config.default_pod_tag !== undefined) {
    result.default_pod_tag = config.default_pod_tag
  }
  if (config.default_gpu_uuid !== undefined) {
    result.default_gpu_uuid = config.default_gpu_uuid
  }
  if (config.default_gpu_name !== undefined) {
    result.default_gpu_name = config.default_gpu_name
  }
  if (config.default_gpu_nums !== undefined) {
    result.default_gpu_nums = config.default_gpu_nums
  }
  if (config.auto_shutdown_minutes !== undefined) {
    result.auto_shutdown_minutes = config.auto_shutdown_minutes
  }
  return result
})
const chenyuSaveSettingsInputSchema = z
  .object({
    apiKey: z.string().optional(),
    config: chenyuConfigSchema,
  })
  .transform((input): ChenyuSaveSettingsInput => {
    const result: ChenyuSaveSettingsInput = { config: input.config }
    if (input.apiKey !== undefined) {
      result.apiKey = input.apiKey
    }
    return result
  })
const chenyuDiscoverPodInputSchema = z.object({ keyword: z.string().optional() }).optional()
const chenyuCreatePodInstanceInputSchema = z
  .object({
    podUuid: z.string().optional(),
    podTitle: z.string().optional(),
    podTag: z.string().optional(),
    instanceTitle: z.string().optional(),
    gpuUuid: z.string().optional(),
    gpuNums: z.number().optional(),
    autoShutdownMinutes: z.number().nullable().optional(),
  })
  .transform((input): ChenyuCreatePodInstanceInput => {
    const result: ChenyuCreatePodInstanceInput = {}
    if (input.podUuid !== undefined) {
      result.podUuid = input.podUuid
    }
    if (input.podTitle !== undefined) {
      result.podTitle = input.podTitle
    }
    if (input.podTag !== undefined) {
      result.podTag = input.podTag
    }
    if (input.instanceTitle !== undefined) {
      result.instanceTitle = input.instanceTitle
    }
    if (input.gpuUuid !== undefined) {
      result.gpuUuid = input.gpuUuid
    }
    if (input.gpuNums !== undefined) {
      result.gpuNums = input.gpuNums
    }
    if (input.autoShutdownMinutes !== undefined) {
      result.autoShutdownMinutes = input.autoShutdownMinutes
    }
    return result
  })
const chenyuStartupInstanceInputSchema = z
  .object({
    instanceUuid: z.string(),
    gpuUuid: z.string().optional(),
    gpuNums: z.number().optional(),
  })
  .transform((input): { instanceUuid: string; gpuUuid?: string; gpuNums?: number } => {
    const result: { instanceUuid: string; gpuUuid?: string; gpuNums?: number } = {
      instanceUuid: input.instanceUuid,
    }
    if (input.gpuUuid !== undefined) {
      result.gpuUuid = input.gpuUuid
    }
    if (input.gpuNums !== undefined) {
      result.gpuNums = input.gpuNums
    }
    return result
  })
const chenyuInstanceUuidInputSchema = z.object({ instanceUuid: z.string() })
const chenyuRenameInstanceInputSchema = z.object({
  instanceUuid: z.string(),
  title: z.string().trim().min(1),
})
const chenyuSetActiveInstanceInputSchema = z.object({
  instanceUuid: z.string(),
  comfyuiUrl: z.string().optional(),
})

function parseChenyuIpcInput<T>(schema: z.ZodType<T>, input: unknown, message: string): T {
  const parsed = schema.safeParse(input)
  if (!parsed.success) {
    throw new AppErrorClass('INVALID_INPUT', message, false, {
      issues: parsed.error.issues,
    })
  }
  return parsed.data
}

export async function readChenyuSettings(): Promise<ChenyuSettingsSnapshot> {
  const config = await readAppConfig()
  return {
    apiKeyConfigured: Boolean(await getSecret(await chenyuApiKeySecretKey())),
    config: normalizeConfig(config.chenyu ?? {}),
  }
}

export async function saveChenyuSettings(input: ChenyuSaveSettingsInput) {
  const config = await readAppConfig()
  const trimmedApiKey = input.apiKey?.trim()
  if (trimmedApiKey) {
    await setSecret(await chenyuApiKeySecretKey(), trimmedApiKey)
  }
  await writeAppConfig({
    ...config,
    chenyu: normalizeConfig(input.config),
  })
  return readChenyuSettings()
}

export async function testChenyuConnection() {
  const client = await requireChenyuClient()
  return client.getBalance()
}

export async function discoverChenyuPod(_keyword?: string): Promise<ChenyuPodDiscoveryResult> {
  const client = await requireChenyuClient()
  const pods = await allowedChenyuPods(client)
  const selected = pods[0] ?? null
  return {
    pods,
    selected,
    tags: selected?.pod_tag ?? [],
  }
}

export async function listChenyuGpus() {
  const client = await requireChenyuClient()
  const result = await client.listGpus({ page: 1, page_size: GPU_PAGE_SIZE })
  return result.items
}

export async function listChenyuPods(_name?: string) {
  const client = await requireChenyuClient()
  return allowedChenyuPods(client)
}

export async function listChenyuInstances() {
  const client = await requireChenyuClient()
  const [settings, current, result] = await Promise.all([
    readChenyuSettings(),
    readCurrentInstanceSafely(),
    client.listInstances(),
  ])
  return result.items.map((item) => mapManagedInstance(item, current, settings.config))
}

export async function createPodInstance(input: ChenyuCreatePodInstanceInput) {
  const client = await requireChenyuClient()
  const settings = await readChenyuSettings()
  const allowedPod = await requireAllowedChenyuPod(client)
  const requestedPodUuid = (input.podUuid ?? settings.config.pod_uuid ?? '').trim()
  if (requestedPodUuid && requestedPodUuid !== allowedPod.uuid) {
    throw new AppErrorClass('INVALID_INPUT', `只允许使用${ALLOWED_CHENYU_POD_TITLE}`, false, {
      provider: 'comfyui-chenyu',
    })
  }
  const podUuid = allowedPod.uuid

  const podTag = (input.podTag ?? settings.config.default_pod_tag ?? '').trim()
  if (!podTag) {
    throw new AppErrorClass('HTTP_4XX', '请先选择 POD 版本', false, {
      provider: 'comfyui-chenyu',
    })
  }
  if (allowedPod.pod_tag?.length && !allowedPod.pod_tag.includes(podTag)) {
    throw new AppErrorClass('INVALID_INPUT', '所选版本不属于指定 POD，请重新选择', false, {
      provider: 'comfyui-chenyu',
    })
  }

  const gpuUuid = (input.gpuUuid ?? settings.config.default_gpu_uuid ?? '').trim()
  if (!gpuUuid) {
    throw new AppErrorClass('HTTP_4XX', '请先选择 GPU 型号', false, {
      provider: 'comfyui-chenyu',
    })
  }

  const gpu = await resolveGpu(client, gpuUuid, settings.config.default_gpu_name)
  const manager = new ComfyuiInstanceManager({ chenyu: client })
  return manager.createInstance({
    pod: {
      uuid: podUuid,
      title: allowedPod.title,
      pod_tag: [podTag],
    },
    gpu,
    ...(input.instanceTitle?.trim() ? { instanceTitle: input.instanceTitle.trim() } : {}),
    podTag,
    gpuNums: input.gpuNums ?? settings.config.default_gpu_nums ?? DEFAULT_GPU_NUMS,
    autoShutdownMinutes:
      input.autoShutdownMinutes === undefined
        ? (settings.config.auto_shutdown_minutes ?? null)
        : input.autoShutdownMinutes,
  })
}

export async function renameChenyuInstance(instanceUuid: string, title: string) {
  const client = await requireChenyuClient()
  return client.updateTitle({ instance_uuid: instanceUuid, title })
}

export async function startupChenyuInstance(input: {
  instanceUuid: string
  gpuUuid?: string | undefined
  gpuNums?: number | undefined
}) {
  const client = await requireChenyuClient()
  return client.startup({
    instance_uuid: input.instanceUuid,
    ...(input.gpuUuid ? { gpu_uuid: input.gpuUuid } : {}),
    ...(input.gpuNums ? { gpu_nums: input.gpuNums } : {}),
  })
}

export async function shutdownChenyuInstance(instanceUuid: string) {
  const client = await requireChenyuClient()
  return client.shutdown(instanceUuid)
}

export async function restartChenyuInstance(instanceUuid: string) {
  const client = await requireChenyuClient()
  return client.restart(instanceUuid)
}

export async function destroyChenyuInstance(instanceUuid: string) {
  const client = await requireChenyuClient()
  await client.destroy(instanceUuid)
  const current = await readCurrentInstanceSafely()
  if (current?.instanceUuid === instanceUuid) {
    await clearCurrentInstanceSafely()
  }
  return { ok: true as const }
}

export async function setActiveChenyuInstance(
  instanceUuid: string,
  input: { comfyuiUrl?: string } = {},
): Promise<ComfyuiInstanceSummary> {
  const client = await requireChenyuClient()
  const info = await client.getInstanceInfo(instanceUuid)
  const manager = new ComfyuiInstanceManager({ chenyu: client })
  return manager.setCurrentInstance(info, input.comfyuiUrl ? { comfyuiUrl: input.comfyuiUrl } : {})
}

export async function getActiveChenyuInstance() {
  return readCurrentInstanceSafely()
}

export async function refreshActiveChenyuInstance() {
  const client = await requireChenyuClient()
  const manager = new ComfyuiInstanceManager({ chenyu: client })
  return manager.refreshCurrentInstance()
}

export function registerChenyuInstanceIpc() {
  ipcMain.handle('chenyu:get-settings', () => readChenyuSettings())
  ipcMain.handle('chenyu:save-settings', (_event, input: unknown) =>
    saveChenyuSettings(
      parseChenyuIpcInput(chenyuSaveSettingsInputSchema, input, '晨羽设置参数不正确'),
    ),
  )
  ipcMain.handle('chenyu:test-connection', () => testChenyuConnection())
  ipcMain.handle('chenyu:discover-pod', (_event, input: unknown) =>
    discoverChenyuPod(
      parseChenyuIpcInput(chenyuDiscoverPodInputSchema, input, '晨羽 POD 查询参数不正确')?.keyword,
    ),
  )
  ipcMain.handle('chenyu:list-gpus', () => listChenyuGpus())
  ipcMain.handle('chenyu:list-pods', (_event, input: unknown) => {
    const parsed = parseChenyuIpcInput(
      chenyuDiscoverPodInputSchema,
      input,
      '晨羽 POD 查询参数不正确',
    )
    return listChenyuPods(parsed?.keyword)
  })
  ipcMain.handle('chenyu:list-instances', () => listChenyuInstances())
  ipcMain.handle('chenyu:create-pod-instance', (_event, input: unknown) =>
    createPodInstance(
      parseChenyuIpcInput(chenyuCreatePodInstanceInputSchema, input, '晨羽创建云机参数不正确'),
    ),
  )
  ipcMain.handle('chenyu:rename-instance', (_event, input: unknown) => {
    const parsed = parseChenyuIpcInput(
      chenyuRenameInstanceInputSchema,
      input,
      '晨羽云机名称参数不正确',
    )
    return renameChenyuInstance(parsed.instanceUuid, parsed.title)
  })
  ipcMain.handle('chenyu:startup-instance', (_event, input: unknown) =>
    startupChenyuInstance(
      parseChenyuIpcInput(chenyuStartupInstanceInputSchema, input, '晨羽启动云机参数不正确'),
    ),
  )
  ipcMain.handle('chenyu:shutdown-instance', (_event, input: unknown) =>
    shutdownChenyuInstance(
      parseChenyuIpcInput(chenyuInstanceUuidInputSchema, input, '晨羽关机参数不正确').instanceUuid,
    ),
  )
  ipcMain.handle('chenyu:restart-instance', (_event, input: unknown) =>
    restartChenyuInstance(
      parseChenyuIpcInput(chenyuInstanceUuidInputSchema, input, '晨羽重启参数不正确').instanceUuid,
    ),
  )
  ipcMain.handle('chenyu:destroy-instance', (_event, input: unknown) =>
    destroyChenyuInstance(
      parseChenyuIpcInput(chenyuInstanceUuidInputSchema, input, '晨羽销毁参数不正确').instanceUuid,
    ),
  )
  ipcMain.handle('chenyu:set-active-instance', (_event, input: unknown) => {
    const parsed = parseChenyuIpcInput(
      chenyuSetActiveInstanceInputSchema,
      input,
      '晨羽当前云机参数不正确',
    )
    return setActiveChenyuInstance(
      parsed.instanceUuid,
      parsed.comfyuiUrl ? { comfyuiUrl: parsed.comfyuiUrl } : {},
    )
  })
  ipcMain.handle('chenyu:get-active-instance', () => getActiveChenyuInstance())
  ipcMain.handle('chenyu:refresh-active-instance', () => refreshActiveChenyuInstance())
}

async function requireChenyuClient() {
  const apiKey = await getSecret(await chenyuApiKeySecretKey())
  if (!apiKey) {
    throw new AppErrorClass('HTTP_4XX', '缺少晨羽智云 API Key', false, {
      provider: 'comfyui-chenyu',
    })
  }
  return new ChenyuCloudClient(apiKey)
}

async function chenyuApiKeySecretKey() {
  return 'chenyu'
}

async function resolveGpu(client: ChenyuCloudClient, gpuUuid: string, fallbackName?: string) {
  const result = await client.listGpus({ page: 1, page_size: GPU_PAGE_SIZE })
  const gpu = result.items.find((item) => item.gpu_uuid === gpuUuid)
  return (
    gpu ?? {
      gpu_uuid: gpuUuid,
      gpu_name: fallbackName || gpuUuid,
      status: 1,
    }
  )
}

function normalizeConfig(config: ChenyuConfig): ChenyuConfig {
  const tags = uniqueStrings(config.pod_tags ?? [])
  const defaultTag =
    config.default_pod_tag && tags.includes(config.default_pod_tag)
      ? config.default_pod_tag
      : (config.default_pod_tag ?? tags[0] ?? '')
  return {
    pod_search_keyword: cleanString(config.pod_search_keyword),
    pod_title: cleanString(config.pod_title),
    pod_uuid: cleanString(config.pod_uuid),
    pod_tags: tags,
    default_pod_tag: cleanString(defaultTag),
    default_gpu_uuid: cleanString(config.default_gpu_uuid),
    default_gpu_name: cleanString(config.default_gpu_name),
    default_gpu_nums: positiveInt(config.default_gpu_nums, DEFAULT_GPU_NUMS),
    auto_shutdown_minutes:
      typeof config.auto_shutdown_minutes === 'number' && config.auto_shutdown_minutes > 0
        ? Math.floor(config.auto_shutdown_minutes)
        : null,
  }
}

async function allowedChenyuPods(client: Pick<ChenyuCloudClient, 'listPods'>) {
  const result = await client.listPods({
    page: 1,
    page_size: POD_DISCOVERY_PAGE_SIZE,
    name: ALLOWED_CHENYU_POD_TITLE,
  })
  return result.items.filter((pod) => pod.title.trim() === ALLOWED_CHENYU_POD_TITLE)
}

async function requireAllowedChenyuPod(client: Pick<ChenyuCloudClient, 'listPods'>) {
  const pod = (await allowedChenyuPods(client))[0]
  if (!pod) {
    throw new AppErrorClass('HTTP_4XX', `未找到指定 POD：${ALLOWED_CHENYU_POD_TITLE}`, false, {
      provider: 'comfyui-chenyu',
    })
  }
  return pod
}

function mapManagedInstance(
  info: ChenyuInstanceInfo,
  current: ComfyuiInstanceSummary | null,
  config: ChenyuConfig,
): ChenyuManagedInstance {
  const podUuid = stringField(info, 'pod_uuid')
  const podTag = stringField(info, 'pod_tag') ?? stringField(info, 'image_tag')
  const title = stringField(info, 'title') ?? stringField(info, 'image_name') ?? info.instance_uuid
  const isCurrent = current?.instanceUuid === info.instance_uuid
  const savedComfyuiUrl = isCurrent ? current?.comfyuiUrl : null
  const serverUrls = uniqueStrings([
    ...comfyuiUrlCandidates(info.server_map, info.server_url).map((candidate) => candidate.url),
    ...(savedComfyuiUrl ? [savedComfyuiUrl] : []),
  ])
  const comfyuiUrl = extractComfyuiUrl(info.server_map) ?? savedComfyuiUrl ?? serverUrls[0] ?? null
  return {
    instanceUuid: info.instance_uuid,
    title,
    status: info.status,
    statusName: chenyuStatusName(info.status),
    imageName: stringField(info, 'image_name'),
    podUuid,
    podTag,
    gpuUuid: stringField(info, 'gpu_uuid'),
    gpuName: stringField(info, 'gpu_name'),
    comfyuiUrl,
    serverUrls,
    isCurrent,
    isFixedPod: Boolean(config.pod_uuid && podUuid === config.pod_uuid),
    raw: info,
  }
}

async function readCurrentInstanceSafely() {
  try {
    const client = await requireChenyuClient()
    return await new ComfyuiInstanceManager({ chenyu: client }).getCurrentInstance()
  } catch {
    return null
  }
}

async function clearCurrentInstanceSafely() {
  try {
    const client = await requireChenyuClient()
    await new ComfyuiInstanceManager({ chenyu: client }).clearCurrentInstance()
  } catch {}
}

function uniqueStrings(values: string[]) {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)))
}

function cleanString(value: string | undefined) {
  return value?.trim() || undefined
}

function positiveInt(value: number | undefined, fallback: number) {
  return Number.isFinite(value) && value && value > 0 ? Math.floor(value) : fallback
}

function stringField(record: Record<string, unknown>, key: string) {
  const value = record[key]
  return typeof value === 'string' && value.trim() ? value : null
}
