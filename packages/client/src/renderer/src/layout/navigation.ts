export type WorkbenchModule =
  | 'collection'
  | 'pipeline'
  | 'title'
  | 'generation'
  | 'detection'
  | 'listing'
  | 'video'
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
  {
    key: 'video',
    path: '/video',
    label: '视频生成',
    title: '视频生成模块',
    description: '用 HappyHorse 生成本地 MP4 视频',
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

export const pipelineRunsModule: WorkbenchModuleMeta = {
  key: 'pipeline',
  path: '/pipeline/runs',
  label: '运行记录',
  title: '完整任务运行记录',
  description: '查看固定完整任务的运行状态与已保留成果',
}

export const navigationGroups = [
  {
    label: '生产',
    modules: [
      ...workbenchModules.filter((module) => module.key === 'pipeline'),
      pipelineRunsModule,
    ],
  },
  {
    label: '单步工具',
    modules: workbenchModules.filter((module) => module.key !== 'pipeline'),
  },
  {
    label: '支持',
    modules: [settingsModule, tutorialModule],
  },
] satisfies Array<{ label: string; modules: WorkbenchModuleMeta[] }>

const defaultWorkbenchRoute = '/pipeline'
const defaultWorkbenchModule: WorkbenchModuleMeta = {
  key: 'pipeline',
  path: defaultWorkbenchRoute,
  label: '完整任务',
  title: '完整任务',
  description: '按来源、抠图、检测、套版和标题顺序执行',
}

export function moduleFromPath(pathname: string) {
  if (pathname === pipelineRunsModule.path) {
    return pipelineRunsModule.key
  }
  if (pathname === settingsModule.path) {
    return settingsModule.key
  }
  if (pathname === tutorialModule.path) {
    return tutorialModule.key
  }
  return workbenchModules.find((module) => module.path === pathname)?.key ?? null
}

export function moduleMetaFromPath(pathname: string) {
  if (pathname === pipelineRunsModule.path) {
    return pipelineRunsModule
  }
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
    pathname === pipelineRunsModule.path ||
    workbenchModules.some((module) => module.path === pathname)
  )
}

export function getStoredWorkbenchRoute() {
  return defaultWorkbenchRoute
}
