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
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Boxes, CheckCircle2, CloudCog, Loader2, RefreshCw, Settings2 } from 'lucide-react'
import { AdvancedSettings } from './components/AdvancedSettings'
import { BitBrowserSettingsCard } from './components/BitBrowserSettingsCard'
import { ConnectionCard } from './components/ConnectionCard'
import { CreateInstanceCard } from './components/CreateInstanceCard'
import { GenerationLocalSettingsCard } from './components/GenerationLocalSettingsCard'
import { InstanceManagementCard } from './components/InstanceManagementCard'
import { LocalWorkflowCard } from './components/LocalWorkflowCard'
import { LogsSettingsCard } from './components/LogsSettingsCard'
import { SkillSyncCard } from './components/SkillSyncCard'
import { WorkspaceSettingsCard } from './components/WorkspaceSettingsCard'
import { useSettingsPageModel } from './useSettingsPageModel'

export function SettingsPage({
  onWorkspaceSaved,
}: {
  onWorkspaceSaved?: (root: string) => void
}) {
  const { actions, state } = useSettingsPageModel({ onWorkspaceSaved })
  const {
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
  } = state
  const {
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
  } = actions

  if (loading) {
    return (
      <div className="grid min-h-[420px] place-items-center rounded-md border bg-background text-sm text-muted-foreground">
        正在读取设置...
      </div>
    )
  }

  return (
    <section aria-label="本机设置" className="space-y-5">
      <header className="border-b pb-4">
        <p className="text-sm font-medium text-muted-foreground">设置</p>
        <h2 className="mt-1 text-xl font-semibold">本机配置</h2>
      </header>

      <div className="min-w-0 space-y-5">
        <Tabs
          className="min-w-0 space-y-5"
          onValueChange={(value) => {
            if (value === 'general' || value === 'models' || value === 'chenyu') {
              setActiveSettingsTab(value)
            }
          }}
          value={activeSettingsTab}
        >
          <TabsList
            aria-label="设置分类"
            className="grid h-auto w-full max-w-2xl grid-cols-3 gap-1 p-1"
          >
            <TabsTrigger className="min-h-11 min-w-0 justify-center gap-2 px-3" value="general">
              <Settings2 className="h-4 w-4 shrink-0" />
              <span className="truncate">常规</span>
            </TabsTrigger>
            <TabsTrigger className="min-h-11 min-w-0 justify-center gap-2 px-3" value="models">
              <Boxes className="h-4 w-4 shrink-0" />
              <span className="truncate">模型与工作流</span>
            </TabsTrigger>
            <TabsTrigger className="min-h-11 min-w-0 justify-center gap-2 px-3" value="chenyu">
              <CloudCog className="h-4 w-4 shrink-0" />
              <span className="truncate">晨羽智云</span>
            </TabsTrigger>
          </TabsList>

          <div className="min-w-0 space-y-5">
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
          </div>

          <TabsContent className="mt-0 data-[state=inactive]:hidden" forceMount value="general">
            <section aria-label="常规设置" className="space-y-5">
              <div className="border-b pb-3">
                <h2 className="text-lg font-semibold">常规</h2>
                <p className="mt-1 text-sm text-muted-foreground">工作区、浏览器连接和本地日志。</p>
              </div>
              <WorkspaceSettingsCard
                saving={savingWorkspace}
                workspace={workspace}
                workspaceDraft={workspaceDraft}
                onChooseRoot={() => void chooseWorkspaceRoot()}
                onSaveRoot={() => void saveWorkspaceRoot()}
                onWorkspaceDraftChange={setWorkspaceDraft}
              />
              <div className="grid gap-5 2xl:grid-cols-2">
                <BitBrowserSettingsCard
                  baseUrl={bitBrowserBaseUrl}
                  saving={savingBitBrowserBaseUrl}
                  onBaseUrlChange={setBitBrowserBaseUrl}
                  onSave={() => void saveBitBrowserSettings()}
                />
                <LogsSettingsCard
                  deleting={deletingLogs}
                  exporting={exportingLogs}
                  opening={openingLogs}
                  workspace={workspace}
                  onDeleteAll={() => setDeleteLogsOpen(true)}
                  onExportZip={() => void exportLogsZip()}
                  onOpenDirectory={() => void openLogsDirectory()}
                />
              </div>
            </section>
          </TabsContent>

          <TabsContent className="mt-0 data-[state=inactive]:hidden" forceMount value="models">
            <section aria-label="模型与工作流设置" className="space-y-5">
              <div className="border-b pb-3">
                <h2 className="text-lg font-semibold">模型与工作流</h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  本地模型、接口密钥、Skill 缓存和 ComfyUI Workflow。
                </p>
              </div>
              <div className="grid gap-5 2xl:grid-cols-[420px_minmax(0,1fr)]">
                <div className="space-y-5">
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
            </section>
          </TabsContent>

          <TabsContent className="mt-0 data-[state=inactive]:hidden" forceMount value="chenyu">
            <section aria-label="晨羽智云设置" className="space-y-5">
              <div className="flex flex-wrap items-start justify-between gap-3 border-b pb-3">
                <div>
                  <h2 className="text-lg font-semibold">晨羽智云</h2>
                  <p className="mt-1 text-sm text-muted-foreground">
                    连接、创建云机、实例操作和默认 ComfyUI 云机。
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
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

              <div className="grid gap-5 2xl:grid-cols-[420px_minmax(0,1fr)]">
                <div className="space-y-5">
                  <ConnectionCard
                    apiKey={apiKey}
                    apiKeyConfigured={apiKeyConfigured}
                    connectionError={connectionError}
                    connectionStatus={connectionStatus}
                    onApiKeyChange={setApiKey}
                  />
                  <CreateInstanceCard
                    apiKeyConfigured={apiKeyConfigured}
                    config={config}
                    createOpen={createOpen}
                    creating={creating}
                    currentVersion={currentVersion}
                    effectiveGpuName={effectiveGpuName}
                    effectiveGpuUuid={effectiveGpuUuid}
                    gpus={gpus}
                    instanceTitle={createInstanceTitle}
                    pods={pods}
                    onCreate={() => void createInstance()}
                    onCreateOpenChange={setCreateOpen}
                    onInstanceTitleChange={setCreateInstanceTitle}
                    onSelectPod={selectPod}
                    onUpdateConfig={updateConfig}
                  />
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
                    onTagsTextChange={updateTagsText}
                    onUpdateConfig={updateConfig}
                    tagsText={tagsText}
                  />
                </div>
                <InstanceManagementCard
                  busyInstance={busyInstance}
                  instances={instances}
                  refreshing={refreshing}
                  statusOverrides={statusOverrides}
                  titleDrafts={instanceTitleDrafts}
                  urlDrafts={instanceUrlDrafts}
                  onRefresh={() => void refreshRemoteData()}
                  onRename={(instance) => void renameInstance(instance)}
                  onSetDefault={(instance) => void runInstanceAction(instance, 'active')}
                  onShutdown={(instance) => void runInstanceAction(instance, 'shutdown')}
                  onStartup={(instance) => void runInstanceAction(instance, 'startup')}
                  onUpdateUrl={updateInstanceUrlDraft}
                  onUpdateTitle={updateInstanceTitleDraft}
                />
              </div>
            </section>
          </TabsContent>
        </Tabs>
      </div>

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
            <AlertDialogAction
              disabled={deletingLogs}
              onClick={() => void deleteAllLogs()}
              variant="destructive"
            >
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
              variant="destructive"
            >
              确认销毁
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  )
}
