import { useGenerationStore } from '@/store/generation'
import { useEffect, useMemo, useState } from 'react'
import {
  type ChenyuConfig,
  type ChenyuGpu,
  type ChenyuInstance,
  type ChenyuPod,
  type ChenyuSettingsSnapshot,
  type ConnectionStatus,
  DEFAULT_GPU_NUMS,
  type GenerationConfig,
  type GenerationSettingsSnapshot,
  type InstanceAction,
  type LocalWorkflowSummary,
  POLL_INTERVAL_MS,
  SHUTDOWN_POLL_TIMEOUT_MS,
  STARTUP_POLL_TIMEOUT_MS,
  type SettingsTab,
  type SkillSyncResult,
  type WorkspaceState,
  defaultGenerationConfig,
  delay,
  emptyConfig,
  errorMessage,
  formatLogBytes,
  parseTags,
  selectPreferredGpu,
  statusText,
} from './types'

export function useSettingsPageModel({
  onWorkspaceSaved,
}: {
  onWorkspaceSaved?: ((root: string) => void) | undefined
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
  const [bitBrowserBaseUrl, setBitBrowserBaseUrl] = useState('')
  const [savingBitBrowserBaseUrl, setSavingBitBrowserBaseUrl] = useState(false)
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
  const [pods, setPods] = useState<ChenyuPod[]>([])
  const [instances, setInstances] = useState<ChenyuInstance[]>([])
  const [createInstanceTitle, setCreateInstanceTitle] = useState('')
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
  const [openingLogs, setOpeningLogs] = useState(false)
  const [exportingLogs, setExportingLogs] = useState(false)
  const [instanceUrlDrafts, setInstanceUrlDrafts] = useState<Record<string, string>>({})
  const [instanceTitleDrafts, setInstanceTitleDrafts] = useState<Record<string, string>>({})
  const [activeSettingsTab, setActiveSettingsTab] = useState<SettingsTab>('general')

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
    void loadBitBrowserSettings()
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

  async function loadBitBrowserSettings() {
    try {
      setBitBrowserBaseUrl((await window.api.bitBrowser.getBaseUrl()) ?? '')
    } catch (nextError) {
      setError(errorMessage(nextError, '读取比特浏览器地址失败'))
    }
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
      const [podsResult, gpusResult, instancesResult] = await Promise.allSettled([
        window.api.chenyu.listPods(),
        window.api.chenyu.listGpus(),
        window.api.chenyu.listInstances(),
      ])
      if (gpusResult.status === 'rejected') {
        throw gpusResult.reason
      }
      if (instancesResult.status === 'rejected') {
        throw instancesResult.reason
      }
      const nextGpus = gpusResult.value
      const nextInstances = instancesResult.value
      setConnectionStatus('connected')
      if (podsResult.status === 'fulfilled') {
        setPods(podsResult.value)
      } else {
        setError(errorMessage(podsResult.reason, 'POD 列表加载失败，请使用搜索或手动填写 UUID'))
      }
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

  function updateTagsText(value: string) {
    setTagsText(value)
    const tags = parseTags(value)
    updateConfig({
      pod_tags: tags,
      default_pod_tag: config.default_pod_tag || tags[0] || '',
    })
  }

  function selectPod(podUuid: string) {
    const pod = pods.find((item) => item.uuid === podUuid)
    if (!pod) {
      updateConfig({ pod_uuid: podUuid })
      return
    }
    const tags = pod.pod_tag ?? []
    updateConfig({
      pod_title: pod.title,
      pod_uuid: pod.uuid,
      pod_tags: tags,
      default_pod_tag: tags[0] ?? '',
    })
    setTagsText(tags.join('\n'))
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
      useGenerationStore.getState().notifyGenerationSettingsUpdated(snapshot)
    } catch (nextError) {
      setError(errorMessage(nextError, '保存本地生图设置失败'))
    } finally {
      setSavingGenerationSettings(false)
    }
  }

  async function saveBitBrowserSettings() {
    setSavingBitBrowserBaseUrl(true)
    setError(null)
    setMessage(null)
    try {
      const saved = await window.api.bitBrowser.saveBaseUrl(bitBrowserBaseUrl)
      setBitBrowserBaseUrl(saved)
      setMessage('比特浏览器地址已保存')
    } catch (nextError) {
      setError(errorMessage(nextError, '保存比特浏览器地址失败'))
    } finally {
      setSavingBitBrowserBaseUrl(false)
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

  async function openLogsDirectory() {
    setOpeningLogs(true)
    setError(null)
    setMessage(null)
    try {
      const result = await window.api.logs.openDir()
      if (!result.ok) {
        setError(result.error.message)
        return
      }
      setMessage(`已打开日志目录：${result.data.path}`)
    } catch (nextError) {
      setError(errorMessage(nextError, '打开日志目录失败'))
    } finally {
      setOpeningLogs(false)
    }
  }

  async function exportLogsZip() {
    setExportingLogs(true)
    setError(null)
    setMessage(null)
    try {
      const result = await window.api.logs.exportZip()
      if (!result.ok) {
        if (result.error.code !== 'CANCELLED') {
          setError(result.error.message)
        }
        return
      }
      setMessage(
        `日志包已导出：${result.data.files} 个文件，${formatLogBytes(result.data.bytes)} · ${
          result.data.path
        }`,
      )
    } catch (nextError) {
      setError(errorMessage(nextError, '导出日志包失败'))
    } finally {
      setExportingLogs(false)
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
      useGenerationStore.getState().notifyComfyuiWorkflowsUpdated()
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
        setError('未找到杭州慎思comfyui镜像，请确认晨羽账号权限后重试')
        return
      }
      setPods(result.pods)
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
      setError(errorMessage(nextError, '刷新杭州慎思 POD 失败'))
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
      await window.api.chenyu.createPodInstance({
        podUuid: config.pod_uuid,
        podTitle: config.pod_title,
        podTag: currentVersion,
        instanceTitle: createInstanceTitle,
        gpuUuid: effectiveGpuUuid,
        gpuNums: DEFAULT_GPU_NUMS,
        autoShutdownMinutes: config.auto_shutdown_minutes ?? null,
      })
      setMessage('实例已创建，并已设为默认云机')
      setCreateInstanceTitle('')
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

  async function renameInstance(instance: ChenyuInstance) {
    const title = (instanceTitleDrafts[instance.instanceUuid] ?? instance.title).trim()
    if (!title || title === instance.title) {
      return
    }
    setBusyInstance({ uuid: instance.instanceUuid, action: 'rename' })
    setError(null)
    setMessage(null)
    try {
      await window.api.chenyu.renameInstance({ instanceUuid: instance.instanceUuid, title })
      setMessage('云机名称已更新')
      await refreshInstancesOnly()
    } catch (nextError) {
      setError(errorMessage(nextError, '更新云机名称失败'))
    } finally {
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

  function updateInstanceTitleDraft(instanceUuid: string, title: string) {
    setInstanceTitleDrafts((current) => ({ ...current, [instanceUuid]: title }))
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

  return {
    state: {
      activeSettingsTab,
      apiKey,
      apiKeyConfigured,
      bailianApiKey,
      bitBrowserBaseUrl,
      busyInstance,
      config,
      connectionError,
      connectionStatus,
      createOpen,
      createInstanceTitle,
      creating,
      currentVersion,
      deleteLogsOpen,
      deletingLogs,
      destroyConfirm,
      destroySuffix,
      destroyTarget,
      discovering,
      effectiveGpuName,
      effectiveGpuUuid,
      error,
      exportingLogs,
      generationConfig,
      generationSettings,
      gpus,
      grsaiApiKey,
      importingWorkflow,
      instanceUrlDrafts,
      instanceTitleDrafts,
      instances,
      loading,
      message,
      openingLogs,
      pods,
      refreshing,
      saving,
      savingBitBrowserBaseUrl,
      savingGenerationSettings,
      savingWorkspace,
      statusOverrides,
      syncResult,
      syncingConfig,
      tagsText,
      workflowDirectoryPath,
      workflows,
      workspace,
      workspaceDraft,
    },
    actions: {
      chooseWorkflowDirectory,
      chooseWorkspaceRoot,
      createInstance,
      deleteAllLogs,
      destroyInstance,
      discoverPod,
      exportLogsZip,
      importWorkflowDirectory,
      openLogsDirectory,
      refreshRemoteData,
      removeLocalWorkflow,
      renameInstance,
      runInstanceAction,
      saveBitBrowserSettings,
      saveGenerationSettings,
      saveSettings,
      saveWorkspaceRoot,
      setActiveSettingsTab,
      setApiKey,
      setBailianApiKey,
      setBitBrowserBaseUrl,
      setCreateOpen,
      setCreateInstanceTitle,
      setDeleteLogsOpen,
      setDestroyConfirm,
      setDestroyTarget,
      setGrsaiApiKey,
      setWorkflowDirectoryPath,
      setWorkspaceDraft,
      syncBackendConfig,
      selectPod,
      updateConfig,
      updateGenerationConfig,
      updateInstanceUrlDraft,
      updateInstanceTitleDraft,
      updateTagsText,
    },
  }
}

export type SettingsPageModel = ReturnType<typeof useSettingsPageModel>
