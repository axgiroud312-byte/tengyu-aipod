import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  CheckCircle2,
  Cloud,
  FileJson,
  FolderOpen,
  Loader2,
  PlugZap,
  Power,
  PowerOff,
  RefreshCw,
  RotateCcw,
  Server,
  Settings2,
  Trash2,
} from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'

type ChenyuSettingsSnapshot = Awaited<ReturnType<typeof window.api.chenyu.getSettings>>
type ChenyuConfig = ChenyuSettingsSnapshot['config']
type ChenyuGpu = Awaited<ReturnType<typeof window.api.chenyu.listGpus>>[number]
type ChenyuInstance = Awaited<ReturnType<typeof window.api.chenyu.listInstances>>[number]
type GenerationSettingsSnapshot = Awaited<ReturnType<typeof window.api.generationSettings.get>>
type GenerationConfig = GenerationSettingsSnapshot['config']
type WorkspaceState = Awaited<ReturnType<typeof window.api.workspace.getState>>
type SkillSyncResult = Awaited<ReturnType<typeof window.api.skill.refresh>>
type LocalWorkflowSummary = Awaited<ReturnType<typeof window.api.workflow.listLocal>>[number]
type ConnectionStatus = 'unchecked' | 'checking' | 'connected' | 'failed'
type InstanceAction = 'startup' | 'shutdown' | 'restart' | 'active'

const DEFAULT_GPU_NUMS = 1
const POLL_INTERVAL_MS = 2_500
const STARTUP_POLL_TIMEOUT_MS = 10 * 60_000
const SHUTDOWN_POLL_TIMEOUT_MS = 5 * 60_000

const fieldIds = {
  apiKey: 'chenyu-api-key',
  podKeyword: 'chenyu-pod-keyword',
  podUuid: 'chenyu-pod-uuid',
  podTags: 'chenyu-pod-tags',
  podVersion: 'chenyu-pod-version',
  gpu: 'chenyu-gpu',
  shutdown: 'chenyu-shutdown-minutes',
}

const emptyConfig: ChenyuConfig = {
  pod_search_keyword: '杭州慎思comfyui镜像',
  pod_tags: [],
  default_gpu_nums: DEFAULT_GPU_NUMS,
  auto_shutdown_minutes: null,
}

const defaultGenerationConfig: GenerationConfig = {
  bailian_text_model: 'qwen3.6-flash',
  bailian_vision_model: 'qwen3.6-flash',
  grsai_node: 'cn',
  default_concurrency: 20,
  grsai_concurrency: 20,
  grsai_retries: 2,
}
const GENERATION_SETTINGS_UPDATED_EVENT = 'tengyu:generation-settings-updated'

const workflowCategoryOptions: Array<{ key: LocalWorkflowSummary['capability']; label: string }> = [
  { key: 'txt2img', label: '文生图' },
  { key: 'img2img', label: '图生图' },
  { key: 'extract', label: '提取' },
  { key: 'matting', label: '抠图' },
  { key: 'matting-mixed', label: '混合抠图' },
]

const statusText: Record<ChenyuInstance['statusName'], string> = {
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

const statusClassName: Record<ChenyuInstance['statusName'], string> = {
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

const connectionText: Record<ConnectionStatus, string> = {
  unchecked: '未配置',
  checking: '检测中',
  connected: '连接成功',
  failed: '连接失败',
}

const connectionClassName: Record<ConnectionStatus, string> = {
  unchecked: 'border-slate-200 bg-slate-50 text-slate-700',
  checking: 'border-blue-200 bg-blue-50 text-blue-700',
  connected: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  failed: 'border-red-200 bg-red-50 text-red-700',
}

export function SettingsPage({
  onWorkspaceSaved,
}: {
  onWorkspaceSaved?: (root: string) => void
}) {
  const [workspace, setWorkspace] = useState<WorkspaceState | null>(null)
  const [workspaceDraft, setWorkspaceDraft] = useState('')
  const [savingWorkspace, setSavingWorkspace] = useState(false)
  const [config, setConfig] = useState<ChenyuConfig>(emptyConfig)
  const [apiKey, setApiKey] = useState('')
  const [apiKeyConfigured, setApiKeyConfigured] = useState(false)
  const [generationSettings, setGenerationSettings] = useState<GenerationSettingsSnapshot | null>(
    null,
  )
  const [generationConfig, setGenerationConfig] =
    useState<GenerationConfig>(defaultGenerationConfig)
  const [grsaiApiKey, setGrsaiApiKey] = useState('')
  const [bailianApiKey, setBailianApiKey] = useState('')
  const [savingGenerationSettings, setSavingGenerationSettings] = useState(false)
  const [syncingConfig, setSyncingConfig] = useState(false)
  const [syncResult, setSyncResult] = useState<SkillSyncResult | null>(null)
  const [workflows, setWorkflows] = useState<LocalWorkflowSummary[]>([])
  const [workflowDirectoryPath, setWorkflowDirectoryPath] = useState('')
  const [importingWorkflow, setImportingWorkflow] = useState(false)
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>('unchecked')
  const [connectionError, setConnectionError] = useState<string | null>(null)
  const [tagsText, setTagsText] = useState('')
  const [gpus, setGpus] = useState<ChenyuGpu[]>([])
  const [instances, setInstances] = useState<ChenyuInstance[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [discovering, setDiscovering] = useState(false)
  const [creating, setCreating] = useState(false)
  const [busyInstance, setBusyInstance] = useState<{
    uuid: string
    action: InstanceAction
  } | null>(null)
  const [statusOverrides, setStatusOverrides] = useState<
    Record<string, ChenyuInstance['statusName']>
  >({})
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [createOpen, setCreateOpen] = useState(false)
  const [destroyTarget, setDestroyTarget] = useState<ChenyuInstance | null>(null)
  const [destroyConfirm, setDestroyConfirm] = useState('')
  const [deleteLogsOpen, setDeleteLogsOpen] = useState(false)
  const [deletingLogs, setDeletingLogs] = useState(false)
  const [instanceUrlDrafts, setInstanceUrlDrafts] = useState<Record<string, string>>({})
  const [activeSettingsTab, setActiveSettingsTab] = useState<'general' | 'chenyu'>('general')

  const currentVersion = config.default_pod_tag ?? ''
  const currentGpuUuid = config.default_gpu_uuid ?? ''
  const destroySuffix = destroyTarget ? destroyTarget.instanceUuid.slice(-6) : ''
  const preferredGpu = useMemo(() => selectPreferredGpu(gpus), [gpus])
  const effectiveGpuUuid = currentGpuUuid || preferredGpu?.gpu_uuid || ''
  const effectiveGpuName =
    gpus.find((gpu) => gpu.gpu_uuid === effectiveGpuUuid)?.gpu_name ??
    config.default_gpu_name ??
    effectiveGpuUuid

  useEffect(() => {
    void load()
    void loadWorkspaceSettings()
    void loadSkillCacheStatus()
  }, [])

  async function loadWorkspaceSettings() {
    try {
      const state = await window.api.workspace.getState()
      setWorkspace(state)
      setWorkspaceDraft(state.root ?? '')
    } catch (nextError) {
      setError(errorMessage(nextError, '读取工作区失败'))
    }
  }

  async function load() {
    setLoading(true)
    setError(null)
    try {
      const settings = await window.api.chenyu.getSettings()
      applySettings(settings)
      await loadGenerationSettings()
      if (settings.apiKeyConfigured) {
        await refreshRemoteData(settings.config)
      } else {
        setConnectionStatus('unchecked')
      }
    } catch (nextError) {
      setConnectionStatus('failed')
      setConnectionError(errorMessage(nextError, '读取设置失败'))
    } finally {
      setLoading(false)
    }
  }

  async function loadGenerationSettings() {
    const [settings, nextWorkflows] = await Promise.all([
      window.api.generationSettings.get(),
      window.api.workflow.listLocal(),
    ])
    setGenerationSettings(settings)
    setGenerationConfig(settings.config)
    setGrsaiApiKey('')
    setBailianApiKey('')
    setWorkflows(nextWorkflows)
  }

  async function loadSkillCacheStatus() {
    try {
      const skills = await window.api.skill.list()
      setSyncResult({ ok: true, count: skills.length })
    } catch (nextError) {
      setSyncResult({
        ok: false,
        count: 0,
        error: errorMessage(nextError, '读取 Skill 缓存失败'),
      })
    }
  }

  function applySettings(settings: ChenyuSettingsSnapshot) {
    const nextConfig = { ...emptyConfig, ...settings.config }
    setApiKeyConfigured(settings.apiKeyConfigured)
    setConfig(nextConfig)
    setTagsText((nextConfig.pod_tags ?? []).join('\n'))
    if (!settings.apiKeyConfigured) {
      setConnectionStatus('unchecked')
    }
  }

  async function refreshRemoteData(nextConfig = config) {
    setRefreshing(true)
    setConnectionStatus('checking')
    setConnectionError(null)
    try {
      await window.api.chenyu.testConnection()
      const [nextGpus, nextInstances] = await Promise.all([
        window.api.chenyu.listGpus(),
        window.api.chenyu.listInstances(),
      ])
      setConnectionStatus('connected')
      setGpus(nextGpus)
      setInstances(nextInstances)
      if (!nextConfig.default_gpu_uuid) {
        const nextPreferredGpu = selectPreferredGpu(nextGpus)
        if (nextPreferredGpu) {
          updateConfig({
            default_gpu_uuid: nextPreferredGpu.gpu_uuid,
            default_gpu_name: nextPreferredGpu.gpu_name,
          })
        }
      }
    } catch (nextError) {
      setConnectionStatus('failed')
      setConnectionError(errorMessage(nextError, '晨羽连接失败'))
    } finally {
      setRefreshing(false)
    }
  }

  function updateConfig(patch: Partial<ChenyuConfig>) {
    setConfig((current) => ({ ...current, ...patch }))
  }

  async function saveSettings() {
    setSaving(true)
    setError(null)
    setMessage(null)
    try {
      const nextTags = parseTags(tagsText)
      const snapshot = await window.api.chenyu.saveSettings({
        apiKey,
        config: {
          ...config,
          pod_tags: nextTags,
          default_pod_tag: config.default_pod_tag || nextTags[0] || '',
          default_gpu_uuid: effectiveGpuUuid,
          default_gpu_name: effectiveGpuName,
        },
      })
      applySettings(snapshot)
      setApiKey('')
      setMessage('晨羽设置已保存')
      if (snapshot.apiKeyConfigured) {
        await refreshRemoteData(snapshot.config)
      }
    } catch (nextError) {
      setConnectionStatus('failed')
      setConnectionError(errorMessage(nextError, '保存晨羽设置失败'))
    } finally {
      setSaving(false)
    }
  }

  function updateGenerationConfig(patch: Partial<GenerationConfig>) {
    setGenerationConfig((current) => ({ ...current, ...patch }))
  }

  async function saveGenerationSettings() {
    setSavingGenerationSettings(true)
    setError(null)
    setMessage(null)
    try {
      const snapshot = await window.api.generationSettings.save({
        grsaiApiKey,
        bailianApiKey,
        config: generationConfig,
      })
      setGenerationSettings(snapshot)
      setGenerationConfig(snapshot.config)
      setGrsaiApiKey('')
      setBailianApiKey('')
      setMessage('本地生图设置已保存')
      window.dispatchEvent(new Event(GENERATION_SETTINGS_UPDATED_EVENT))
    } catch (nextError) {
      setError(errorMessage(nextError, '保存本地生图设置失败'))
    } finally {
      setSavingGenerationSettings(false)
    }
  }

  async function syncBackendConfig() {
    setSyncingConfig(true)
    setError(null)
    setMessage(null)
    try {
      const result = await window.api.skill.refresh()
      setSyncResult(result)
      if (result.ok) {
        setMessage(`Skill 已同步：${result.count} 条`)
      } else {
        setError(result.error || 'Skill 同步失败')
      }
    } catch (nextError) {
      setError(errorMessage(nextError, '同步 Skill 失败'))
    } finally {
      setSyncingConfig(false)
    }
  }

  async function chooseWorkflowDirectory() {
    setError(null)
    setMessage(null)
    const result = await window.api.workflow.chooseDirectory()
    if (!result.ok) {
      if (result.error.code !== 'CANCELLED') {
        setError(result.error.message)
      }
      return
    }
    setWorkflowDirectoryPath(result.data.path)
  }

  async function chooseWorkspaceRoot() {
    setError(null)
    setMessage(null)
    const result = await window.api.workspace.chooseRoot()
    if (!result.ok) {
      if (result.error.code !== 'CANCELLED') {
        setError(result.error.message)
      }
      return
    }
    setWorkspaceDraft(result.data.path)
  }

  async function saveWorkspaceRoot() {
    setSavingWorkspace(true)
    setError(null)
    setMessage(null)
    try {
      const result = await window.api.workspace.saveRoot(workspaceDraft)
      if (!result.ok) {
        setError(result.error.message)
        return
      }
      const nextState = {
        root: result.data.path,
        directories: result.data.directories,
      }
      setWorkspace(nextState)
      setWorkspaceDraft(result.data.path)
      onWorkspaceSaved?.(result.data.path)
      setMessage('工作区已保存，目录已自动创建')
      await loadSkillCacheStatus()
    } catch (nextError) {
      setError(errorMessage(nextError, '保存工作区失败'))
    } finally {
      setSavingWorkspace(false)
    }
  }

  async function deleteAllLogs() {
    setDeletingLogs(true)
    setError(null)
    setMessage(null)
    try {
      const result = await window.api.logs.deleteAll()
      if (!result.ok) {
        setError(result.error.message)
        return
      }
      setDeleteLogsOpen(false)
      setMessage(
        `日志已清理：删除 ${result.data.deletedFiles} 个文件，释放 ${formatLogBytes(
          result.data.deletedBytes,
        )}`,
      )
    } catch (nextError) {
      setError(errorMessage(nextError, '删除日志失败'))
    } finally {
      setDeletingLogs(false)
    }
  }

  async function importWorkflowDirectory() {
    setImportingWorkflow(true)
    setError(null)
    setMessage(null)
    try {
      const imported = await window.api.workflow.importDirectory({
        directoryPath: workflowDirectoryPath,
      })
      setWorkflows(imported.workflows)
      setMessage(
        `已导入 ${imported.importedCount} 个 Workflow${
          imported.skippedCount ? `，跳过 ${imported.skippedCount} 个文件` : ''
        }`,
      )
      await loadGenerationSettings()
    } catch (nextError) {
      setError(errorMessage(nextError, '导入 Workflow 文件夹失败'))
    } finally {
      setImportingWorkflow(false)
    }
  }

  async function removeLocalWorkflow(id: string) {
    setError(null)
    setMessage(null)
    try {
      await window.api.workflow.removeLocal({ id })
      await loadGenerationSettings()
      setMessage('本地 Workflow 已删除')
    } catch (nextError) {
      setError(errorMessage(nextError, '删除本地 Workflow 失败'))
    }
  }

  async function discoverPod() {
    setDiscovering(true)
    setError(null)
    setMessage(null)
    try {
      const result = await window.api.chenyu.discoverPod(
        config.pod_search_keyword ? { keyword: config.pod_search_keyword } : undefined,
      )
      if (!result.selected) {
        setError('没有搜索到匹配的 POD，可以手动填写 POD UUID 和版本')
        return
      }
      const tags = result.tags
      updateConfig({
        pod_title: result.selected.title,
        pod_uuid: result.selected.uuid,
        pod_tags: tags,
        default_pod_tag: tags[0] ?? config.default_pod_tag ?? '',
      })
      setTagsText(tags.join('\n'))
      setMessage(`已发现 POD：${result.selected.title}`)
    } catch (nextError) {
      setError(errorMessage(nextError, '自动发现 POD 失败'))
    } finally {
      setDiscovering(false)
    }
  }

  async function createInstance() {
    setCreating(true)
    setError(null)
    setMessage(null)
    try {
      await window.api.chenyu.saveSettings({
        config: {
          ...config,
          pod_tags: parseTags(tagsText),
          default_gpu_uuid: effectiveGpuUuid,
          default_gpu_name: effectiveGpuName,
          default_gpu_nums: DEFAULT_GPU_NUMS,
          auto_shutdown_minutes: config.auto_shutdown_minutes ?? null,
        },
      })
      await window.api.chenyu.createFixedPodInstance({
        podTag: currentVersion,
        gpuUuid: effectiveGpuUuid,
        gpuNums: DEFAULT_GPU_NUMS,
        autoShutdownMinutes: config.auto_shutdown_minutes ?? null,
      })
      setMessage('实例已创建，并已设为默认云机')
      setCreateOpen(false)
      await refreshRemoteData()
    } catch (nextError) {
      setError(errorMessage(nextError, '创建实例失败'))
    } finally {
      setCreating(false)
    }
  }

  async function runInstanceAction(instance: ChenyuInstance, action: InstanceAction) {
    setBusyInstance({ uuid: instance.instanceUuid, action })
    setError(null)
    setMessage(null)
    try {
      if (action === 'startup') {
        setStatusOverride(instance.instanceUuid, 'starting')
        await window.api.chenyu.startupInstance({ instanceUuid: instance.instanceUuid })
        await pollInstanceStatus(instance.instanceUuid, {
          waiting: ['created', 'initializing', 'starting'],
          success: ['running'],
          timeoutMs: STARTUP_POLL_TIMEOUT_MS,
          timeoutMessage: '等待云机开机超时，请稍后刷新状态',
        })
        setMessage('云机已运行')
      } else if (action === 'shutdown') {
        setStatusOverride(instance.instanceUuid, 'shutting_down')
        await window.api.chenyu.shutdownInstance({ instanceUuid: instance.instanceUuid })
        await pollInstanceStatus(instance.instanceUuid, {
          waiting: ['running', 'shutting_down'],
          success: ['stopped'],
          timeoutMs: SHUTDOWN_POLL_TIMEOUT_MS,
          timeoutMessage: '等待云机关机超时，请稍后刷新状态',
        })
        setMessage('云机已关机')
      } else if (action === 'restart') {
        setStatusOverride(instance.instanceUuid, 'restarting')
        await window.api.chenyu.restartInstance({ instanceUuid: instance.instanceUuid })
        await pollInstanceStatus(instance.instanceUuid, {
          waiting: ['created', 'initializing', 'starting', 'restarting'],
          success: ['running'],
          timeoutMs: STARTUP_POLL_TIMEOUT_MS,
          timeoutMessage: '等待云机重启超时，请稍后刷新状态',
        })
        setMessage('云机已重启')
      } else {
        const comfyuiUrl = currentInstanceUrl(instance).trim()
        await window.api.chenyu.setActiveInstance({
          instanceUuid: instance.instanceUuid,
          ...(comfyuiUrl ? { comfyuiUrl } : {}),
        })
        setMessage('已设为默认云机')
        await refreshInstancesOnly()
      }
    } catch (nextError) {
      setError(errorMessage(nextError, '实例操作失败'))
      await refreshInstancesOnly().catch(() => undefined)
    } finally {
      clearStatusOverride(instance.instanceUuid)
      setBusyInstance(null)
    }
  }

  async function pollInstanceStatus(
    instanceUuid: string,
    options: {
      waiting: ChenyuInstance['statusName'][]
      success: ChenyuInstance['statusName'][]
      timeoutMs: number
      timeoutMessage: string
    },
  ) {
    const startedAt = Date.now()
    while (Date.now() - startedAt <= options.timeoutMs) {
      await delay(POLL_INTERVAL_MS)
      const nextInstances = await window.api.chenyu.listInstances()
      setInstances(nextInstances)
      const latest = nextInstances.find((item) => item.instanceUuid === instanceUuid)
      if (!latest) {
        throw new Error('实例不存在或已被删除')
      }
      if (options.success.includes(latest.statusName)) {
        return latest
      }
      if (!options.waiting.includes(latest.statusName)) {
        throw new Error(`实例状态异常：${statusText[latest.statusName]}`)
      }
    }
    throw new Error(options.timeoutMessage)
  }

  async function refreshInstancesOnly() {
    const nextInstances = await window.api.chenyu.listInstances()
    setInstances(nextInstances)
  }

  function setStatusOverride(instanceUuid: string, statusName: ChenyuInstance['statusName']) {
    setStatusOverrides((current) => ({ ...current, [instanceUuid]: statusName }))
  }

  function clearStatusOverride(instanceUuid: string) {
    setStatusOverrides((current) => {
      const next = { ...current }
      delete next[instanceUuid]
      return next
    })
  }

  function updateInstanceUrlDraft(instanceUuid: string, comfyuiUrl: string) {
    setInstanceUrlDrafts((current) => ({
      ...current,
      [instanceUuid]: comfyuiUrl,
    }))
  }

  function currentInstanceUrl(instance: ChenyuInstance) {
    return (
      instanceUrlDrafts[instance.instanceUuid] ??
      instance.comfyuiUrl ??
      instance.serverUrls[0] ??
      ''
    )
  }

  async function destroyInstance() {
    if (!destroyTarget || destroyConfirm.trim() !== destroySuffix) {
      return
    }
    setBusyInstance({ uuid: destroyTarget.instanceUuid, action: 'shutdown' })
    setError(null)
    setMessage(null)
    try {
      await window.api.chenyu.destroyInstance({ instanceUuid: destroyTarget.instanceUuid })
      setMessage('实例已销毁')
      setDestroyTarget(null)
      setDestroyConfirm('')
      await refreshInstancesOnly()
    } catch (nextError) {
      setError(errorMessage(nextError, '销毁实例失败'))
    } finally {
      setBusyInstance(null)
    }
  }

  if (loading) {
    return (
      <div className="grid min-h-[420px] place-items-center rounded-md border bg-background text-sm text-muted-foreground">
        正在读取设置...
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <Tabs
        onValueChange={(value) => {
          if (value === 'general' || value === 'chenyu') {
            setActiveSettingsTab(value)
          }
        }}
        value={activeSettingsTab}
      >
        <TabsList className="grid h-auto w-full max-w-md grid-cols-2 p-1">
          <TabsTrigger className="h-10" value="general">
            通用
          </TabsTrigger>
          <TabsTrigger className="h-10" value="chenyu">
            晨羽智云
          </TabsTrigger>
        </TabsList>
      </Tabs>

      {message ? (
        <div className="rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
          {message}
        </div>
      ) : null}
      {error ? (
        <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          {error}
        </div>
      ) : null}

      {activeSettingsTab === 'general' ? (
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>工作区</CardTitle>
              <CardDescription>
                选择后会在本地自动创建采集、印花、检测和上架工作区。
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <label className="grid gap-2 text-sm font-medium" htmlFor="workspace-root">
                <span>选择工作区</span>
                <div className="flex gap-2">
                  <Input
                    className="min-w-0 flex-1"
                    id="workspace-root"
                    onChange={(event) => setWorkspaceDraft(event.target.value)}
                    placeholder="例如 /Users/you/Documents/腾域aipod工作区"
                    value={workspaceDraft}
                  />
                  <Button
                    onClick={() => void chooseWorkspaceRoot()}
                    type="button"
                    variant="secondary"
                  >
                    <FolderOpen className="mr-2 h-4 w-4" />
                    浏览
                  </Button>
                  <Button
                    disabled={savingWorkspace || !workspaceDraft.trim()}
                    onClick={() => void saveWorkspaceRoot()}
                    type="button"
                  >
                    {savingWorkspace ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : (
                      <CheckCircle2 className="mr-2 h-4 w-4" />
                    )}
                    保存工作区
                  </Button>
                </div>
              </label>
              <div className="grid gap-2 text-sm md:grid-cols-2 xl:grid-cols-3">
                {(workspace?.directories ?? []).map((directory) => (
                  <div className="rounded-md border bg-muted/40 px-3 py-2" key={directory}>
                    {directory}
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>日志</CardTitle>
              <CardDescription>
                清理当前工作区 `.workbench/logs/` 下的运行日志、诊断日志和崩溃日志。
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0 text-sm text-muted-foreground">
                <p className="break-all">
                  {workspace?.root ? `${workspace.root}/.workbench/logs` : '请先选择工作区'}
                </p>
              </div>
              <Button
                disabled={deletingLogs || !workspace?.root}
                onClick={() => setDeleteLogsOpen(true)}
                type="button"
                variant="destructive"
              >
                {deletingLogs ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Trash2 className="mr-2 h-4 w-4" />
                )}
                删除所有日志
              </Button>
            </CardContent>
          </Card>

          <div className="grid gap-6 xl:grid-cols-[420px_minmax(0,1fr)]">
            <div className="space-y-6">
              <GenerationLocalSettingsCard
                bailianApiKey={bailianApiKey}
                config={generationConfig}
                grsaiApiKey={grsaiApiKey}
                saving={savingGenerationSettings}
                settings={generationSettings}
                onBailianApiKeyChange={setBailianApiKey}
                onConfigChange={updateGenerationConfig}
                onGrsaiApiKeyChange={setGrsaiApiKey}
                onSave={() => void saveGenerationSettings()}
              />

              <SkillSyncCard
                result={syncResult}
                syncing={syncingConfig}
                onSync={() => void syncBackendConfig()}
              />
            </div>

            <LocalWorkflowCard
              directoryPath={workflowDirectoryPath}
              importing={importingWorkflow}
              workflows={workflows}
              onChooseDirectory={() => void chooseWorkflowDirectory()}
              onDirectoryPathChange={setWorkflowDirectoryPath}
              onImport={() => void importWorkflowDirectory()}
              onRemove={(id) => void removeLocalWorkflow(id)}
            />
          </div>
        </div>
      ) : (
        <div className="space-y-6">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-2xl font-semibold tracking-normal">晨羽智云设置</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                管理连接、创建杭州慎思云机，并指定 ComfyUI 生图默认云机。
              </p>
            </div>
            <div className="flex gap-2">
              <Button
                disabled={refreshing || !apiKeyConfigured}
                onClick={() => void refreshRemoteData()}
                type="button"
                variant="outline"
              >
                {refreshing ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <RefreshCw className="mr-2 h-4 w-4" />
                )}
                刷新
              </Button>
              <Button disabled={saving} onClick={() => void saveSettings()} type="button">
                {saving ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <CheckCircle2 className="mr-2 h-4 w-4" />
                )}
                保存设置
              </Button>
            </div>
          </div>

          <div className="grid gap-6 xl:grid-cols-[420px_minmax(0,1fr)]">
            <div className="space-y-6">
              <ConnectionCard
                apiKey={apiKey}
                apiKeyConfigured={apiKeyConfigured}
                connectionError={connectionError}
                connectionStatus={connectionStatus}
                onApiKeyChange={setApiKey}
              />

              <Card>
                <CardHeader>
                  <CardTitle>创建云机</CardTitle>
                  <CardDescription>创建固定杭州慎思 POD 的新实例。</CardDescription>
                </CardHeader>
                <CardContent>
                  <Accordion
                    collapsible
                    onValueChange={(value) => setCreateOpen(value === 'create')}
                    type="single"
                    value={createOpen ? 'create' : ''}
                  >
                    <AccordionItem className="rounded-md border px-4" value="create">
                      <AccordionTrigger className="py-3">
                        <div className="flex min-w-0 items-center gap-3">
                          <Server className="h-4 w-4 shrink-0 text-primary" />
                          <div className="min-w-0 text-left">
                            <p className="font-medium">创建杭州慎思云机</p>
                            <p className="truncate text-xs text-muted-foreground">
                              {currentVersion || '未选版本'} · {effectiveGpuName || '未选 GPU'}
                            </p>
                          </div>
                        </div>
                      </AccordionTrigger>
                      <AccordionContent className="space-y-4">
                        <ReadOnlyField label="固定 POD UUID" value={config.pod_uuid ?? '未配置'} />
                        <label
                          className="block space-y-2 text-sm font-medium"
                          htmlFor={fieldIds.podVersion}
                        >
                          <span>版本</span>
                          {config.pod_tags?.length ? (
                            <select
                              className="h-10 w-full rounded-md border bg-background px-3 text-sm"
                              id={fieldIds.podVersion}
                              onChange={(event) =>
                                updateConfig({ default_pod_tag: event.target.value })
                              }
                              value={currentVersion}
                            >
                              {config.pod_tags.map((tag) => (
                                <option key={tag} value={tag}>
                                  {tag}
                                </option>
                              ))}
                            </select>
                          ) : (
                            <Input
                              id={fieldIds.podVersion}
                              onChange={(event) =>
                                updateConfig({ default_pod_tag: event.target.value })
                              }
                              placeholder="例如 4.64"
                              value={currentVersion}
                            />
                          )}
                        </label>
                        <label
                          className="block space-y-2 text-sm font-medium"
                          htmlFor={fieldIds.gpu}
                        >
                          <span>显卡</span>
                          {gpus.length ? (
                            <select
                              className="h-10 w-full rounded-md border bg-background px-3 text-sm"
                              id={fieldIds.gpu}
                              onChange={(event) => {
                                const gpu = gpus.find(
                                  (item) => item.gpu_uuid === event.target.value,
                                )
                                updateConfig({
                                  default_gpu_uuid: event.target.value,
                                  default_gpu_name: gpu?.gpu_name,
                                })
                              }}
                              value={effectiveGpuUuid}
                            >
                              {gpus.map((gpu) => (
                                <option key={gpu.gpu_uuid} value={gpu.gpu_uuid}>
                                  {gpu.gpu_name}
                                </option>
                              ))}
                            </select>
                          ) : (
                            <Input
                              id={fieldIds.gpu}
                              onChange={(event) =>
                                updateConfig({ default_gpu_uuid: event.target.value })
                              }
                              placeholder="GPU UUID"
                              value={effectiveGpuUuid}
                            />
                          )}
                        </label>
                        <Button
                          className="w-full"
                          disabled={creating || !apiKeyConfigured}
                          onClick={() => void createInstance()}
                          type="button"
                        >
                          {creating ? (
                            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                          ) : (
                            <Cloud className="mr-2 h-4 w-4" />
                          )}
                          创建实例
                        </Button>
                      </AccordionContent>
                    </AccordionItem>
                  </Accordion>
                </CardContent>
              </Card>

              <AdvancedSettings
                busyInstance={busyInstance}
                config={config}
                destroyingInstanceUuid={destroyTarget?.instanceUuid ?? null}
                discovering={discovering}
                instances={instances}
                onDestroy={(instance) => {
                  setDestroyTarget(instance)
                  setDestroyConfirm('')
                }}
                onDiscoverPod={() => void discoverPod()}
                onRestart={(instance) => void runInstanceAction(instance, 'restart')}
                onTagsTextChange={(value) => {
                  setTagsText(value)
                  const tags = parseTags(value)
                  updateConfig({
                    pod_tags: tags,
                    default_pod_tag: config.default_pod_tag || tags[0] || '',
                  })
                }}
                onUpdateConfig={updateConfig}
                tagsText={tagsText}
              />
            </div>

            <InstanceManagementCard
              busyInstance={busyInstance}
              instances={instances}
              refreshing={refreshing}
              statusOverrides={statusOverrides}
              urlDrafts={instanceUrlDrafts}
              onRefresh={() => void refreshRemoteData()}
              onSetDefault={(instance) => void runInstanceAction(instance, 'active')}
              onShutdown={(instance) => void runInstanceAction(instance, 'shutdown')}
              onStartup={(instance) => void runInstanceAction(instance, 'startup')}
              onUpdateUrl={updateInstanceUrlDraft}
            />
          </div>
        </div>
      )}

      <AlertDialog onOpenChange={setDeleteLogsOpen} open={deleteLogsOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>删除所有日志</AlertDialogTitle>
            <AlertDialogDescription>
              将清空当前工作区 `.workbench/logs/`
              下的运行日志、诊断日志和崩溃日志。此操作不可恢复，不会删除业务图片、数据库、临时文件或
              API Key。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deletingLogs}>取消</AlertDialogCancel>
            <AlertDialogAction disabled={deletingLogs} onClick={() => void deleteAllLogs()}>
              {deletingLogs ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              确认删除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={Boolean(destroyTarget)}
        onOpenChange={(open) => !open && setDestroyTarget(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>销毁晨羽实例</AlertDialogTitle>
            <AlertDialogDescription>
              销毁不可恢复。请输入实例 ID 后 6 位 {destroySuffix} 来确认。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <Input
            onChange={(event) => setDestroyConfirm(event.target.value)}
            placeholder={destroySuffix}
            value={destroyConfirm}
          />
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setDestroyConfirm('')}>取消</AlertDialogCancel>
            <AlertDialogAction
              disabled={destroyConfirm.trim() !== destroySuffix}
              onClick={() => void destroyInstance()}
            >
              确认销毁
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

function ConnectionCard({
  apiKey,
  apiKeyConfigured,
  connectionError,
  connectionStatus,
  onApiKeyChange,
}: {
  apiKey: string
  apiKeyConfigured: boolean
  connectionError: string | null
  connectionStatus: ConnectionStatus
  onApiKeyChange: (value: string) => void
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>连接信息</CardTitle>
        <CardDescription>只保存晨羽 API Key，并检测当前连接是否可用。</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <label className="block space-y-2 text-sm font-medium" htmlFor={fieldIds.apiKey}>
          <span>晨羽 API Key</span>
          <Input
            id={fieldIds.apiKey}
            onChange={(event) => onApiKeyChange(event.target.value)}
            placeholder={apiKeyConfigured ? '已保存，留空则不修改' : '粘贴晨羽 API Key'}
            type="password"
            value={apiKey}
          />
        </label>
        <div className="flex items-center justify-between rounded-md border bg-muted/30 px-3 py-3">
          <div>
            <p className="text-xs text-muted-foreground">连接状态</p>
            <p className="mt-1 text-sm font-medium">
              {connectionStatus === 'checking'
                ? '正在检测晨羽连接'
                : connectionText[connectionStatus]}
            </p>
          </div>
          <span
            className={`inline-flex items-center gap-1 rounded-sm border px-2.5 py-1 text-xs font-medium ${connectionClassName[connectionStatus]}`}
          >
            {connectionStatus === 'checking' ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
            {connectionText[connectionStatus]}
          </span>
        </div>
        {connectionError ? (
          <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
            {connectionError}
          </p>
        ) : null}
      </CardContent>
    </Card>
  )
}

function GenerationLocalSettingsCard({
  bailianApiKey,
  config,
  grsaiApiKey,
  saving,
  settings,
  onBailianApiKeyChange,
  onConfigChange,
  onGrsaiApiKeyChange,
  onSave,
}: {
  bailianApiKey: string
  config: GenerationConfig
  grsaiApiKey: string
  saving: boolean
  settings: GenerationSettingsSnapshot | null
  onBailianApiKeyChange: (value: string) => void
  onConfigChange: (patch: Partial<GenerationConfig>) => void
  onGrsaiApiKeyChange: (value: string) => void
  onSave: () => void
}) {
  const [concurrencyDraft, setConcurrencyDraft] = useState(String(config.default_concurrency))
  const [retriesDraft, setRetriesDraft] = useState(String(config.grsai_retries))

  useEffect(() => {
    setConcurrencyDraft(String(config.default_concurrency))
  }, [config.default_concurrency])

  useEffect(() => {
    setRetriesDraft(String(config.grsai_retries))
  }, [config.grsai_retries])

  function updateNumberDraft(
    value: string,
    min: number,
    max: number,
    onValue: (value: number) => void,
  ) {
    if (!value.trim()) {
      return
    }
    const parsed = Number(value)
    if (!Number.isFinite(parsed)) {
      return
    }
    onValue(Math.max(min, Math.min(max, Math.floor(parsed))))
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>本地生图设置</CardTitle>
        <CardDescription>Grsai、百炼模型和密钥只保存在本机，不上传服务器。</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <label className="block space-y-2 text-sm font-medium" htmlFor="grsai-api-key">
          <span className="flex items-center justify-between gap-2">
            <span>Grsai API Key</span>
            <Badge variant={settings?.grsaiKeyConfigured ? 'default' : 'secondary'}>
              {settings?.grsaiKeyConfigured ? '已保存' : '未保存'}
            </Badge>
          </span>
          <Input
            id="grsai-api-key"
            onChange={(event) => onGrsaiApiKeyChange(event.target.value)}
            placeholder={
              settings?.grsaiKeyConfigured ? '已保存，留空则不修改' : '粘贴 Grsai API Key'
            }
            type="password"
            value={grsaiApiKey}
          />
        </label>

        <label className="block space-y-2 text-sm font-medium" htmlFor="bailian-api-key">
          <span className="flex items-center justify-between gap-2">
            <span>阿里云百炼 API Key</span>
            <Badge variant={settings?.bailianKeyConfigured ? 'default' : 'secondary'}>
              {settings?.bailianKeyConfigured ? '已保存' : '未保存'}
            </Badge>
          </span>
          <Input
            id="bailian-api-key"
            onChange={(event) => onBailianApiKeyChange(event.target.value)}
            placeholder={
              settings?.bailianKeyConfigured ? '已保存，留空则不修改' : '粘贴百炼 API Key'
            }
            type="password"
            value={bailianApiKey}
          />
        </label>

        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block space-y-2 text-sm font-medium" htmlFor="grsai-node">
            <span>Grsai 节点</span>
            <select
              className="h-10 w-full rounded-md border bg-background px-3 text-sm"
              id="grsai-node"
              onChange={(event) =>
                onConfigChange({ grsai_node: event.target.value === 'global' ? 'global' : 'cn' })
              }
              value={config.grsai_node}
            >
              <option value="cn">国内节点</option>
              <option value="global">全球节点</option>
            </select>
          </label>
          <label className="block space-y-2 text-sm font-medium" htmlFor="default-concurrency">
            <span>全局默认并发</span>
            <Input
              id="default-concurrency"
              max={20}
              min={1}
              onBlur={() => setConcurrencyDraft(String(config.default_concurrency))}
              onChange={(event) => {
                const value = event.target.value
                setConcurrencyDraft(value)
                updateNumberDraft(value, 1, 20, (nextValue) =>
                  onConfigChange({ default_concurrency: nextValue, grsai_concurrency: nextValue }),
                )
              }}
              type="number"
              value={concurrencyDraft}
            />
          </label>
          <label className="block space-y-2 text-sm font-medium" htmlFor="grsai-retries">
            <span>自动重试次数</span>
            <Input
              id="grsai-retries"
              max={10}
              min={0}
              onBlur={() => setRetriesDraft(String(config.grsai_retries))}
              onChange={(event) => {
                const value = event.target.value
                setRetriesDraft(value)
                updateNumberDraft(value, 0, 10, (nextValue) =>
                  onConfigChange({ grsai_retries: nextValue }),
                )
              }}
              type="number"
              value={retriesDraft}
            />
          </label>
          <label className="block space-y-2 text-sm font-medium" htmlFor="bailian-text-model">
            <span>百炼文本模型</span>
            <select
              className="h-10 w-full rounded-md border bg-background px-3 text-sm"
              id="bailian-text-model"
              onChange={(event) => onConfigChange({ bailian_text_model: event.target.value })}
              value={config.bailian_text_model}
            >
              {(settings?.bailianTextModels ?? []).map((model) => (
                <option key={model.id} value={model.id}>
                  {model.label}
                </option>
              ))}
            </select>
          </label>
          <label
            className="block space-y-2 text-sm font-medium sm:col-span-2"
            htmlFor="bailian-vision-model"
          >
            <span>百炼视觉模型</span>
            <select
              className="h-10 w-full rounded-md border bg-background px-3 text-sm"
              id="bailian-vision-model"
              onChange={(event) => onConfigChange({ bailian_vision_model: event.target.value })}
              value={config.bailian_vision_model}
            >
              {(settings?.bailianVisionModels ?? []).map((model) => (
                <option key={model.id} value={model.id}>
                  {model.label}
                </option>
              ))}
            </select>
          </label>
        </div>

        <Button className="w-full" disabled={saving} onClick={onSave} type="button">
          {saving ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <CheckCircle2 className="mr-2 h-4 w-4" />
          )}
          保存本地设置
        </Button>
      </CardContent>
    </Card>
  )
}

function SkillSyncCard({
  result,
  syncing,
  onSync,
}: {
  result: SkillSyncResult | null
  syncing: boolean
  onSync: () => void
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>云端 Skill 同步</CardTitle>
        <CardDescription>
          服务器只下发系统提示词；模型、密钥和 Workflow 不从云端同步。
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 text-sm">
          {result ? (
            <SyncStatusRow
              label="Skill 缓存"
              value={result.ok ? `${result.count} 条` : result.error}
            />
          ) : (
            <SyncStatusRow label="Skill 缓存" value="正在读取缓存" />
          )}
        </div>
        <Button
          className="w-full"
          disabled={syncing}
          onClick={onSync}
          type="button"
          variant="outline"
        >
          {syncing ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <RefreshCw className="mr-2 h-4 w-4" />
          )}
          同步 Skill
        </Button>
      </CardContent>
    </Card>
  )
}

function LocalWorkflowCard({
  directoryPath,
  importing,
  workflows,
  onChooseDirectory,
  onDirectoryPathChange,
  onImport,
  onRemove,
}: {
  directoryPath: string
  importing: boolean
  workflows: LocalWorkflowSummary[]
  onChooseDirectory: () => void
  onDirectoryPathChange: (value: string) => void
  onImport: () => void
  onRemove: (id: string) => void
}) {
  const groupedWorkflows = workflowCategoryOptions
    .map((category) => ({
      ...category,
      workflows: workflows.filter((workflow) => workflow.capability === category.key),
    }))
    .filter((category) => category.workflows.length > 0)

  return (
    <Card>
      <CardHeader>
        <CardTitle>本地 Workflow</CardTitle>
        <CardDescription>
          选择一个总文件夹，按子文件夹名称自动归类并缓存 ComfyUI API JSON。
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <label className="block space-y-2 text-sm font-medium" htmlFor="workflow-directory">
            <span>Workflow 文件夹</span>
            <Input
              id="workflow-directory"
              onChange={(event) => onDirectoryPathChange(event.target.value)}
              placeholder="选择或粘贴 ComfyUI Workflow 总文件夹路径"
              value={directoryPath}
            />
          </label>
          <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
            <Button onClick={onChooseDirectory} type="button" variant="secondary">
              <FolderOpen className="mr-2 h-4 w-4" />
              选择文件夹
            </Button>
            <Button disabled={importing || !directoryPath.trim()} onClick={onImport} type="button">
              {importing ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <RefreshCw className="mr-2 h-4 w-4" />
              )}
              导入并刷新缓存
            </Button>
          </div>
          <p className="text-xs leading-5 text-muted-foreground">
            支持子文件夹：文生图 / 图生图 / 提取 / 抠图，也支持 txt2img / img2img / extract /
            matting。重新导入会用这个文件夹刷新本机缓存。
          </p>
        </div>

        <div className="space-y-2">
          {groupedWorkflows.length ? (
            groupedWorkflows.map((group) => (
              <div className="rounded-md border bg-muted/20 p-3" key={group.key}>
                <div className="mb-2 flex items-center justify-between gap-3">
                  <p className="text-sm font-medium">{group.label}</p>
                  <Badge variant="secondary">{group.workflows.length}</Badge>
                </div>
                <div className="space-y-2">
                  {group.workflows.map((workflow) => (
                    <div
                      className="flex items-center justify-between gap-3 rounded-md border bg-background px-3 py-2 text-sm"
                      key={`${workflow.id}@${workflow.version}`}
                    >
                      <div className="min-w-0">
                        <div className="flex min-w-0 flex-wrap items-center gap-2">
                          <p className="truncate font-medium">{workflow.name}</p>
                          <WorkflowDetectionBadge workflow={workflow} />
                        </div>
                        <p className="mt-1 truncate text-xs text-muted-foreground">
                          {workflow.version} · 图像 {workflow.detection.imageInputs} · 提示词{' '}
                          {workflow.detection.promptInputs} · 尺寸 {workflow.detection.sizeInputs} ·
                          输出 {workflow.detection.outputImages}
                        </p>
                        {workflow.detection.warnings.length ? (
                          <p className="mt-1 line-clamp-2 text-xs text-amber-700">
                            {workflow.detection.warnings.join('；')}
                          </p>
                        ) : null}
                      </div>
                      <Button
                        className="h-8 px-2"
                        onClick={() => onRemove(workflow.id)}
                        type="button"
                        variant="ghost"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  ))}
                </div>
              </div>
            ))
          ) : (
            <div className="rounded-md border border-dashed bg-muted/30 px-3 py-6 text-center text-sm text-muted-foreground">
              <FileJson className="mx-auto mb-2 h-5 w-5" />
              暂无本地 Workflow
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  )
}

function WorkflowDetectionBadge({ workflow }: { workflow: LocalWorkflowSummary }) {
  if (workflow.detection.status === 'ready') {
    return <Badge className="bg-emerald-50 text-emerald-700">可运行</Badge>
  }
  if (workflow.detection.status === 'warning') {
    return <Badge className="bg-amber-50 text-amber-800">可运行，有提示</Badge>
  }
  return <Badge className="bg-red-50 text-red-700">需检查</Badge>
}

function SyncStatusRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-md border bg-muted/30 px-3 py-2">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-right font-medium">{value}</span>
    </div>
  )
}

function InstanceManagementCard({
  busyInstance,
  instances,
  refreshing,
  statusOverrides,
  urlDrafts,
  onRefresh,
  onSetDefault,
  onShutdown,
  onStartup,
  onUpdateUrl,
}: {
  busyInstance: { uuid: string; action: InstanceAction } | null
  instances: ChenyuInstance[]
  refreshing: boolean
  statusOverrides: Record<string, ChenyuInstance['statusName']>
  urlDrafts: Record<string, string>
  onRefresh: () => void
  onSetDefault: (instance: ChenyuInstance) => void
  onShutdown: (instance: ChenyuInstance) => void
  onStartup: (instance: ChenyuInstance) => void
  onUpdateUrl: (instanceUuid: string, value: string) => void
}) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-4 space-y-0">
        <div>
          <CardTitle>实例管理</CardTitle>
          <CardDescription>管理当前 API Key 下的云机，并选择 ComfyUI 默认云机。</CardDescription>
        </div>
        <Button disabled={refreshing} onClick={onRefresh} type="button" variant="outline">
          {refreshing ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <RefreshCw className="mr-2 h-4 w-4" />
          )}
          刷新
        </Button>
      </CardHeader>
      <CardContent>
        {instances.length === 0 ? (
          <div className="rounded-md border border-dashed bg-muted/30 px-4 py-10 text-center text-sm text-muted-foreground">
            暂无实例，或 API Key 尚未连接成功。
          </div>
        ) : (
          <div className="space-y-3">
            {instances.map((instance) => {
              const busy = busyInstance?.uuid === instance.instanceUuid
              const statusName = statusOverrides[instance.instanceUuid] ?? instance.statusName
              const urlDraft =
                urlDrafts[instance.instanceUuid] ??
                instance.comfyuiUrl ??
                instance.serverUrls[0] ??
                ''
              const canSetDefault = Boolean(instance.comfyuiUrl || urlDraft.trim())
              return (
                <div
                  className="rounded-md border bg-background px-4 py-4"
                  key={instance.instanceUuid}
                >
                  <div className="space-y-4">
                    <div className="min-w-0 flex-1 space-y-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-xs font-medium text-muted-foreground">实例 UUID</span>
                        {instance.isCurrent ? <Badge className="shrink-0">默认云机</Badge> : null}
                      </div>
                      <p className="break-all font-mono text-xs font-medium">
                        {instance.instanceUuid}
                      </p>
                      <div className="grid gap-3 md:grid-cols-[112px_minmax(0,1fr)] md:items-center">
                        <div className="space-y-1">
                          <p className="text-xs font-medium text-muted-foreground">状态</p>
                          <StatusBadge busy={busy} statusName={statusName} />
                        </div>
                        <div className="min-w-0 space-y-1">
                          <p className="text-xs font-medium text-muted-foreground">ComfyUI 地址</p>
                          {instance.comfyuiUrl ? (
                            <p className="break-all font-mono text-xs text-muted-foreground">
                              {instance.comfyuiUrl}
                            </p>
                          ) : (
                            <div className="space-y-1">
                              <Input
                                aria-label="ComfyUI 地址"
                                className="h-9 font-mono text-xs"
                                list={`chenyu-instance-urls-${instance.instanceUuid}`}
                                onChange={(event) =>
                                  onUpdateUrl(instance.instanceUuid, event.target.value)
                                }
                                placeholder="未识别，粘贴 ComfyUI 地址"
                                value={urlDraft}
                              />
                              {instance.serverUrls.length ? (
                                <datalist id={`chenyu-instance-urls-${instance.instanceUuid}`}>
                                  {instance.serverUrls.map((url) => (
                                    <option key={url} value={url} />
                                  ))}
                                </datalist>
                              ) : null}
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-2 border-t pt-3 sm:justify-end">
                      <Button
                        className="h-9 min-w-20 px-3"
                        disabled={busy || statusName === 'running'}
                        onClick={() => onStartup(instance)}
                        type="button"
                        variant="outline"
                      >
                        {busy && busyInstance?.action === 'startup' ? (
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        ) : (
                          <Power className="mr-2 h-4 w-4" />
                        )}
                        开机
                      </Button>
                      <Button
                        className="h-9 min-w-20 px-3"
                        disabled={busy || statusName === 'stopped'}
                        onClick={() => onShutdown(instance)}
                        type="button"
                        variant="outline"
                      >
                        {busy && busyInstance?.action === 'shutdown' ? (
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        ) : (
                          <PowerOff className="mr-2 h-4 w-4" />
                        )}
                        关机
                      </Button>
                      <Button
                        aria-label="设为默认云机"
                        className="h-9 min-w-32 px-3"
                        disabled={busy || instance.isCurrent || !canSetDefault}
                        onClick={() => onSetDefault(instance)}
                        title="设为默认云机"
                        type="button"
                        variant={instance.isCurrent ? 'secondary' : 'default'}
                      >
                        设为默认云机
                      </Button>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

function StatusBadge({
  busy,
  statusName,
}: {
  busy: boolean
  statusName: ChenyuInstance['statusName']
}) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-sm border px-2 py-1 text-xs font-medium ${statusClassName[statusName]}`}
    >
      {busy ||
      statusName === 'starting' ||
      statusName === 'initializing' ||
      statusName === 'shutting_down' ? (
        <Loader2 className="h-3 w-3 animate-spin" />
      ) : null}
      {statusText[statusName]}
    </span>
  )
}

function AdvancedSettings({
  busyInstance,
  config,
  destroyingInstanceUuid,
  discovering,
  instances,
  onDestroy,
  onDiscoverPod,
  onRestart,
  onTagsTextChange,
  onUpdateConfig,
  tagsText,
}: {
  busyInstance: { uuid: string; action: InstanceAction } | null
  config: ChenyuConfig
  destroyingInstanceUuid: string | null
  discovering: boolean
  instances: ChenyuInstance[]
  onDestroy: (instance: ChenyuInstance) => void
  onDiscoverPod: () => void
  onRestart: (instance: ChenyuInstance) => void
  onTagsTextChange: (value: string) => void
  onUpdateConfig: (patch: Partial<ChenyuConfig>) => void
  tagsText: string
}) {
  return (
    <Card>
      <CardContent className="pt-2">
        <Accordion collapsible type="single">
          <AccordionItem className="border-0" value="advanced">
            <AccordionTrigger>
              <div className="flex items-center gap-2">
                <Settings2 className="h-4 w-4 text-muted-foreground" />
                高级设置
              </div>
            </AccordionTrigger>
            <AccordionContent className="space-y-5">
              <div className="space-y-4 rounded-md border bg-muted/20 p-4">
                <label
                  className="block space-y-2 text-sm font-medium"
                  htmlFor={fieldIds.podKeyword}
                >
                  <span>POD 名称关键词</span>
                  <div className="flex gap-2">
                    <Input
                      id={fieldIds.podKeyword}
                      onChange={(event) =>
                        onUpdateConfig({ pod_search_keyword: event.target.value })
                      }
                      value={config.pod_search_keyword ?? ''}
                    />
                    <Button
                      aria-label="自动发现 POD"
                      disabled={discovering}
                      onClick={onDiscoverPod}
                      title="自动发现 POD"
                      type="button"
                      variant="secondary"
                    >
                      {discovering ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <PlugZap className="h-4 w-4" />
                      )}
                    </Button>
                  </div>
                </label>
                <label className="block space-y-2 text-sm font-medium" htmlFor={fieldIds.podUuid}>
                  <span>手动 POD UUID</span>
                  <Input
                    id={fieldIds.podUuid}
                    onChange={(event) => onUpdateConfig({ pod_uuid: event.target.value })}
                    placeholder="自动获取失败时手动填写"
                    value={config.pod_uuid ?? ''}
                  />
                </label>
                <label className="block space-y-2 text-sm font-medium" htmlFor={fieldIds.podTags}>
                  <span>手动版本列表</span>
                  <textarea
                    className="min-h-20 w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-primary"
                    id={fieldIds.podTags}
                    onChange={(event) => onTagsTextChange(event.target.value)}
                    placeholder={'4.64\n4.633'}
                    value={tagsText}
                  />
                </label>
                <label className="block space-y-2 text-sm font-medium" htmlFor={fieldIds.shutdown}>
                  <span>定时关机分钟</span>
                  <Input
                    id={fieldIds.shutdown}
                    min={0}
                    onChange={(event) => {
                      const value = Number(event.target.value)
                      onUpdateConfig({
                        auto_shutdown_minutes:
                          Number.isFinite(value) && value > 0 ? Math.floor(value) : null,
                      })
                    }}
                    placeholder="留空表示关闭"
                    type="number"
                    value={config.auto_shutdown_minutes ?? ''}
                  />
                </label>
              </div>

              {instances.length ? (
                <div className="space-y-2 rounded-md border bg-muted/20 p-4">
                  <p className="text-sm font-medium">高级实例操作</p>
                  <div className="space-y-2">
                    {instances.map((instance) => {
                      const busy = busyInstance?.uuid === instance.instanceUuid
                      return (
                        <div
                          className="flex items-center justify-between gap-3 rounded-md border bg-background px-3 py-2"
                          key={instance.instanceUuid}
                        >
                          <p className="min-w-0 truncate font-mono text-xs">
                            {instance.instanceUuid}
                          </p>
                          <div className="flex shrink-0 gap-2">
                            <Button
                              className="h-8 px-2"
                              disabled={busy}
                              onClick={() => onRestart(instance)}
                              type="button"
                              variant="outline"
                            >
                              {busy && busyInstance?.action === 'restart' ? (
                                <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
                              ) : (
                                <RotateCcw className="mr-1 h-3.5 w-3.5" />
                              )}
                              重启
                            </Button>
                            <Button
                              className="h-8 px-2"
                              disabled={busy || destroyingInstanceUuid === instance.instanceUuid}
                              onClick={() => onDestroy(instance)}
                              type="button"
                              variant="outline"
                            >
                              <Trash2 className="mr-1 h-3.5 w-3.5" />
                              销毁
                            </Button>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>
              ) : null}
            </AccordionContent>
          </AccordionItem>
        </Accordion>
      </CardContent>
    </Card>
  )
}

function ReadOnlyField({ label, value }: { label: string; value: string }) {
  return (
    <div className="space-y-2 text-sm">
      <p className="font-medium">{label}</p>
      <div className="min-h-10 rounded-md border bg-muted/30 px-3 py-2 font-mono text-xs">
        {value}
      </div>
    </div>
  )
}

function selectPreferredGpu(gpus: ChenyuGpu[]) {
  return gpus.find((gpu) => /rtx\s*4080/i.test(gpu.gpu_name)) ?? gpus[0] ?? null
}

function parseTags(value: string) {
  return Array.from(
    new Set(
      value
        .split(/[\n,，]/)
        .map((item) => item.trim())
        .filter(Boolean),
    ),
  )
}

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback
}

function formatLogBytes(bytes: number) {
  if (bytes < 1024) {
    return `${bytes} B`
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`
  }
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

function delay(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms))
}
