export type WorkbenchModule =
  | 'collection'
  | 'pipeline'
  | 'title'
  | 'generation'
  | 'detection'
  | 'listing'
  | 'ps'
  | 'settings'
  | 'tutorial'

export interface WorkbenchModuleMeta {
  key: WorkbenchModule
  path: string
  label: string
  title: string
  description: string
}

export const SIDEBAR_COLLAPSED_STORAGE_KEY = 'tengyu.ui.sidebar.collapsed'
export const LAST_ROUTE_STORAGE_KEY = 'tengyu.ui.lastRoute'

export const workbenchModules: WorkbenchModuleMeta[] = [
  {
    key: 'collection',
    path: '/collection',
    label: '采集',
    title: '采集模块',
    description: '扫描当前页面图池并选择下载图片',
  },
  {
    key: 'pipeline',
    path: '/pipeline',
    label: '完整任务',
    title: '完整任务',
    description: '按来源、抠图、检测、套版和标题顺序执行',
  },
  {
    key: 'generation',
    path: '/generation',
    label: '生图',
    title: '生图模块',
    description: '按文生图、图生图、提取、抠图组织生产路径',
  },
  {
    key: 'detection',
    path: '/detection',
    label: '侵权检测',
    title: '侵权检测模块',
    description: '批量检测印花风险并流转结果',
  },
  {
    key: 'ps',
    path: '/photoshop',
    label: 'PS 套版',
    title: 'PS 套版模块',
    description: '扫描 PSD 模板并准备 Photoshop 套版执行',
  },
  {
    key: 'title',
    path: '/title',
    label: '标题生成',
    title: '标题生成模块',
    description: '从货号成品图批量生成跨境标题',
  },
  {
    key: 'listing',
    path: '/listing',
    label: '上架',
    title: '上架模块',
    description: '批量操作店小秘草稿并保留真实页面证据',
  },
]

export const settingsModule: WorkbenchModuleMeta = {
  key: 'settings',
  path: '/settings',
  label: '设置',
  title: '设置',
  description: '管理本机配置、接口密钥和晨羽云实例',
}

export const tutorialModule: WorkbenchModuleMeta = {
  key: 'tutorial',
  path: '/tutorial',
  label: '教程',
  title: '教程',
  description: '采集、生图和 PS 套版操作手册',
}

const defaultWorkbenchRoute = '/collection'
const defaultWorkbenchModule: WorkbenchModuleMeta = {
  key: 'collection',
  path: defaultWorkbenchRoute,
  label: '采集',
  title: '采集模块',
  description: '扫描当前页面图池并选择下载图片',
}

export function moduleFromPath(pathname: string) {
  if (pathname === settingsModule.path) {
    return settingsModule.key
  }
  if (pathname === tutorialModule.path) {
    return tutorialModule.key
  }
  return workbenchModules.find((module) => module.path === pathname)?.key ?? null
}

export function moduleMetaFromPath(pathname: string) {
  if (pathname === settingsModule.path) {
    return settingsModule
  }
  if (pathname === tutorialModule.path) {
    return tutorialModule
  }
  return workbenchModules.find((module) => module.path === pathname) ?? defaultWorkbenchModule
}

export function isWorkbenchRoute(pathname: string) {
  return (
    pathname === settingsModule.path ||
    pathname === tutorialModule.path ||
    workbenchModules.some((module) => module.path === pathname)
  )
}

export function getStoredWorkbenchRoute() {
  const storedRoute = window.localStorage.getItem(LAST_ROUTE_STORAGE_KEY)
  return storedRoute && isWorkbenchRoute(storedRoute) ? storedRoute : defaultWorkbenchRoute
}
