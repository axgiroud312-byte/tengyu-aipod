import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

const MATERIAL_DIR_NAME = '腾域aipod素材'
const CONFIG_FILE_NAME = 'app-config.json'

export const workbenchSubdirectories = [
  '01-采集',
  '02-生图',
  '03-检测',
  '04-待套版印花',
  '05-货号成品',
  '.workbench',
] as const

export interface AppConfig {
  workbench_root?: string
  chenyu?: ChenyuConfig
  generation?: GenerationLocalConfig
}

export interface ChenyuConfig {
  pod_search_keyword?: string | undefined
  pod_title?: string | undefined
  pod_uuid?: string | undefined
  pod_tags?: string[]
  default_pod_tag?: string | undefined
  default_gpu_uuid?: string | undefined
  default_gpu_name?: string | undefined
  default_gpu_nums?: number
  auto_shutdown_minutes?: number | null
}

export interface GenerationLocalConfig {
  bailian_text_model?: string
  bailian_vision_model?: string
  grsai_node?: 'cn' | 'global'
  grsai_concurrency?: number
  grsai_retries?: number
}

async function electronApp() {
  const electron = await import('electron')
  return electron.app
}

export async function configPath() {
  const app = await electronApp()
  return join(app.getPath('userData'), CONFIG_FILE_NAME)
}

export async function defaultWorkbenchRoot() {
  const app = await electronApp()
  return join(app.getPath('documents'), MATERIAL_DIR_NAME)
}

export async function readAppConfig(): Promise<AppConfig> {
  try {
    return JSON.parse(await readFile(await configPath(), 'utf8')) as AppConfig
  } catch {
    return {}
  }
}

export async function writeAppConfig(config: AppConfig) {
  const path = await configPath()
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, JSON.stringify(config, null, 2), 'utf8')
}

export async function getWorkbenchRoot() {
  const config = await readAppConfig()
  return config.workbench_root ?? (await defaultWorkbenchRoot())
}

export async function ensureWorkbenchDirectories(root: string) {
  await Promise.all(
    workbenchSubdirectories.map((directory) => mkdir(join(root, directory), { recursive: true })),
  )
}
