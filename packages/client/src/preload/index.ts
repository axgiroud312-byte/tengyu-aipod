import type {
  ActivationBadgeState,
  ListingItem,
  ListingProgress,
  ListingTaskInput,
  ListingTaskRecord,
  ListingTaskStatus,
  ListingTemplateConfig,
  ListingWorkspaceInput,
  ListingWorkspaceRecord,
  ListingWorkspaceStatus,
  PhotoshopProgressInfo,
  PhotoshopScanTemplateRequest,
  PhotoshopStatus,
  PsdTemplate,
  Skill,
  SkillSummary,
} from '@tengyu-aipod/shared'
import { contextBridge, ipcRenderer } from 'electron'
import type {
  BitBrowserCdpEndpoint,
  BitBrowserProfile,
  BitBrowserProfileWithStatus,
} from '../main/lib/bit-browser-client'
import type { BrowserProfileHolder } from '../main/lib/browser-profile-lock'
import type {
  ChenyuWorkflowMarketInfo,
  ChenyuWorkflowMarketList,
} from '../main/lib/chenyu-cloud-client'
import type {
  ChenyuCreateFixedPodInstanceInput,
  ChenyuManagedInstance,
  ChenyuPodDiscoveryResult,
  ChenyuSaveSettingsInput,
  ChenyuSettingsSnapshot,
} from '../main/lib/chenyu-instance-service'
import type {
  CollectionClickEvent,
  CollectionClickResult,
  CollectionScrollEvent,
  CollectionScrollResult,
} from '../main/lib/collection-click-service'
import type { CollectionConfig } from '../main/lib/collection-config'
import type {
  CollectionCurrentPageResult,
  CollectionImageIndexClickResult,
  CollectionImageIndexDownloadResult,
  CollectionImageIndexItem,
  CollectionImageIndexScanResult,
} from '../main/lib/collection-image-index-service'
import type { CollectionPlatformRule } from '../main/lib/collection-injected-script'
import type {
  CollectionRecordRow,
  CollectionRecordStatus,
} from '../main/lib/collection-record-store'
import type {
  CollectionSession,
  CollectionSessionConfig,
  CollectionSessionEvent,
} from '../main/lib/collection-session-manager'
import type { ComfyuiInstanceSummary } from '../main/lib/comfyui-instance-manager'
import type {
  ChooseLocalComfyuiWorkflowDirectoryResult,
  ComfyuiWorkflowCategory,
  ComfyuiWorkflowSummary,
  ImportLocalComfyuiWorkflowDirectoryInput,
  ImportLocalComfyuiWorkflowDirectoryResult,
  ImportLocalComfyuiWorkflowInput,
} from '../main/lib/comfyui-workflow-cache'
import type { DetectionConfig } from '../main/lib/detection-config'
import type {
  DetectionBatchConfig,
  DetectionImageInfo,
  DetectionInputSources,
  DetectionProgress,
  DetectionStoredResult,
  DetectionTaskEvent,
} from '../main/lib/detection-service'
import type {
  GenerationLocalSettingsSnapshot,
  SaveGenerationLocalSettingsInput,
} from '../main/lib/generation-local-config'
import type {
  ChenyuWorkflowMarketListInput,
  ChenyuWorkflowRunInput,
  ComfyuiExtractRunInput,
  ComfyuiImg2imgRunInput,
  ComfyuiMattingRunInput,
  ComfyuiTxt2imgRunInput,
  ExtractRunInput,
  ExtractSourcesResult,
  GenerationDebugLogEntry,
  GenerationProgress,
  GenerationPromptInput,
  GenerationTaskEvent,
  Img2imgReferencePayload,
  Img2imgSourcesResult,
  MixedMattingRunInput,
  Txt2imgPromptDraft,
  Txt2imgRunInput,
} from '../main/lib/generation-service'
import type { ListingBatchLoadResult } from '../main/lib/listing-batch-loader'
import type { TitleBatchConfig, TitleProgress, TitleTaskEvent } from '../main/lib/title-service'
import type { ListingRunConfig, ListingStatusRow } from '../modules/listing/runner'

const api = {
  ping: () => ipcRenderer.invoke('app:ping') as Promise<string>,
  onboarding: {
    getState: () =>
      ipcRenderer.invoke('onboarding:get-state') as Promise<{
        needs_onboarding: boolean
        default_workbench_root: string
      }>,
    chooseWorkbenchRoot: () =>
      ipcRenderer.invoke('onboarding:choose-workbench-root') as Promise<
        | { ok: true; data: { path: string } }
        | { ok: false; error: { code: string; message: string } }
      >,
    saveWorkbenchRoot: (path: string) =>
      ipcRenderer.invoke('onboarding:save-workbench-root', path) as Promise<{
        ok: true
        data: { path: string }
      }>,
    saveApiKeys: (apiKeys: Record<string, string>) =>
      ipcRenderer.invoke('onboarding:save-api-keys', apiKeys) as Promise<{ ok: true }>,
    complete: () => ipcRenderer.invoke('onboarding:complete') as Promise<{ ok: true }>,
  },
  keychain: {
    has: (key: string) => ipcRenderer.invoke('keychain:has', { key }) as Promise<boolean>,
  },
  chenyu: {
    getSettings: () => ipcRenderer.invoke('chenyu:get-settings') as Promise<ChenyuSettingsSnapshot>,
    saveSettings: (input: ChenyuSaveSettingsInput) =>
      ipcRenderer.invoke('chenyu:save-settings', input) as Promise<ChenyuSettingsSnapshot>,
    testConnection: () =>
      ipcRenderer.invoke('chenyu:test-connection') as Promise<{
        balance: number
        card_balance: number
      }>,
    discoverPod: (input?: { keyword?: string }) =>
      ipcRenderer.invoke('chenyu:discover-pod', input) as Promise<ChenyuPodDiscoveryResult>,
    listGpus: () =>
      ipcRenderer.invoke('chenyu:list-gpus') as Promise<
        import('../main/lib/chenyu-cloud-client').ChenyuGpu[]
      >,
    listInstances: () =>
      ipcRenderer.invoke('chenyu:list-instances') as Promise<ChenyuManagedInstance[]>,
    createFixedPodInstance: (input: ChenyuCreateFixedPodInstanceInput) =>
      ipcRenderer.invoke(
        'chenyu:create-fixed-pod-instance',
        input,
      ) as Promise<ComfyuiInstanceSummary>,
    startupInstance: (input: { instanceUuid: string; gpuUuid?: string; gpuNums?: number }) =>
      ipcRenderer.invoke('chenyu:startup-instance', input) as Promise<
        import('../main/lib/chenyu-cloud-client').ChenyuInstanceInfo
      >,
    shutdownInstance: (input: { instanceUuid: string }) =>
      ipcRenderer.invoke('chenyu:shutdown-instance', input) as Promise<
        import('../main/lib/chenyu-cloud-client').ChenyuInstanceInfo
      >,
    restartInstance: (input: { instanceUuid: string }) =>
      ipcRenderer.invoke('chenyu:restart-instance', input) as Promise<
        import('../main/lib/chenyu-cloud-client').ChenyuInstanceInfo
      >,
    destroyInstance: (input: { instanceUuid: string }) =>
      ipcRenderer.invoke('chenyu:destroy-instance', input) as Promise<{ ok: true }>,
    setActiveInstance: (input: { instanceUuid: string; comfyuiUrl?: string }) =>
      ipcRenderer.invoke('chenyu:set-active-instance', input) as Promise<ComfyuiInstanceSummary>,
    getActiveInstance: () =>
      ipcRenderer.invoke('chenyu:get-active-instance') as Promise<ComfyuiInstanceSummary | null>,
    refreshActiveInstance: () =>
      ipcRenderer.invoke(
        'chenyu:refresh-active-instance',
      ) as Promise<ComfyuiInstanceSummary | null>,
  },
  browserProfileLock: {
    list: () => ipcRenderer.invoke('browser-profile-lock:list') as Promise<BrowserProfileHolder[]>,
  },
  skill: {
    list: (filter?: {
      module?: 'generation' | 'detection' | 'title'
      category?: string
      platform?: string
      language?: string
    }) => ipcRenderer.invoke('skill:list', filter) as Promise<SkillSummary[]>,
    get: (input: { id: string; version?: string }) =>
      ipcRenderer.invoke('skill:get', input) as Promise<Skill>,
    refresh: () =>
      ipcRenderer.invoke('skill:refresh') as Promise<
        { ok: true; count: number } | { ok: false; count: number; error: string }
      >,
  },
  generationSettings: {
    get: () =>
      ipcRenderer.invoke('generation-settings:get') as Promise<GenerationLocalSettingsSnapshot>,
    save: (input: SaveGenerationLocalSettingsInput) =>
      ipcRenderer.invoke(
        'generation-settings:save',
        input,
      ) as Promise<GenerationLocalSettingsSnapshot>,
  },
  workflow: {
    chooseDirectory: () =>
      ipcRenderer.invoke(
        'workflow:choose-directory',
      ) as Promise<ChooseLocalComfyuiWorkflowDirectoryResult>,
    listLocal: (category?: ComfyuiWorkflowCategory) =>
      ipcRenderer.invoke('workflow:list-local', category) as Promise<ComfyuiWorkflowSummary[]>,
    importLocal: (input: ImportLocalComfyuiWorkflowInput) =>
      ipcRenderer.invoke('workflow:import-local', input) as Promise<ComfyuiWorkflowSummary>,
    importDirectory: (input: ImportLocalComfyuiWorkflowDirectoryInput) =>
      ipcRenderer.invoke(
        'workflow:import-directory',
        input,
      ) as Promise<ImportLocalComfyuiWorkflowDirectoryResult>,
    removeLocal: (input: { id: string }) =>
      ipcRenderer.invoke('workflow:remove-local', input) as Promise<{ ok: true }>,
  },
  tempFile: {
    getUsage: () => ipcRenderer.invoke('temp-file:get-usage') as Promise<Record<string, number>>,
    cleanupAll: () =>
      ipcRenderer.invoke('temp-file:cleanup-all') as Promise<{
        ok: true
      }>,
  },
  collection: {
    getConfig: () =>
      ipcRenderer.invoke('collection:get-config') as Promise<CollectionConfig | null>,
    saveConfig: (input: CollectionConfig) =>
      ipcRenderer.invoke('collection:save-config', input) as Promise<CollectionConfig>,
    listPlatforms: () =>
      ipcRenderer.invoke('collection:list-platforms') as Promise<CollectionPlatformRule[]>,
    listProfiles: () =>
      ipcRenderer.invoke('collection:list-profiles') as Promise<BitBrowserProfileWithStatus[]>,
    getCurrentPage: (input: { platform: string; profile_id: string }) =>
      ipcRenderer.invoke(
        'collection:get-current-page',
        input,
      ) as Promise<CollectionCurrentPageResult>,
    openPage: (input: { platform: string; profile_id: string; page_url: string }) =>
      ipcRenderer.invoke('collection:open-page', input) as Promise<CollectionCurrentPageResult>,
    startSession: (input: CollectionSessionConfig) =>
      ipcRenderer.invoke('collection:start-session', input) as Promise<CollectionSession>,
    stopSession: () =>
      ipcRenderer.invoke('collection:stop-session') as Promise<CollectionSession | null>,
    resumeSession: () =>
      ipcRenderer.invoke('collection:resume-session') as Promise<CollectionSession | null>,
    openProfile: (input: { profile_id: string }) =>
      ipcRenderer.invoke('collection:open-profile', input) as Promise<BitBrowserCdpEndpoint>,
    handleClick: (input: { event: CollectionClickEvent; platformRule: CollectionPlatformRule }) =>
      ipcRenderer.invoke('collection:handle-click', input) as Promise<CollectionClickResult>,
    handleScroll: (input: {
      event: CollectionScrollEvent
      platformRule: CollectionPlatformRule
    }) => ipcRenderer.invoke('collection:handle-scroll', input) as Promise<CollectionScrollResult>,
    setSku: (input: { goods_link: string; sku_code: string }) =>
      ipcRenderer.invoke('collection:set-sku', input) as Promise<{
        ok: true
        results: CollectionClickResult[]
      }>,
    onEvent: (callback: (event: CollectionSessionEvent) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, event: CollectionSessionEvent) => {
        callback(event)
      }
      ipcRenderer.on('collection:event', listener)

      return () => {
        ipcRenderer.removeListener('collection:event', listener)
      }
    },
    getActiveSession: () =>
      ipcRenderer.invoke('collection:get-active-session') as Promise<CollectionSession | null>,
    listRecords: (input: {
      session_id: string
      status?: CollectionRecordStatus
      limit?: number
    }) => ipcRenderer.invoke('collection:list-records', input) as Promise<CollectionRecordRow[]>,
    retryRecord: (input: { record_id: string }) =>
      ipcRenderer.invoke('collection:retry-record', input) as Promise<CollectionScrollResult>,
    deleteRecord: (input: { record_id: string }) =>
      ipcRenderer.invoke('collection:delete-record', input) as Promise<{
        ok: true
        record_id: string
      }>,
    scanImageIndex: (input: {
      platform: string
      profile_id: string
      output_dir?: string
      page_url?: string
      limit?: number
    }) =>
      ipcRenderer.invoke(
        'collection:scan-image-index',
        input,
      ) as Promise<CollectionImageIndexScanResult>,
    probeImageIndexClick: (input: {
      platform: string
      profile_id: string
      output_dir?: string
      page_url?: string
      limit?: number
    }) =>
      ipcRenderer.invoke(
        'collection:probe-image-index-click',
        input,
      ) as Promise<CollectionImageIndexClickResult>,
    downloadImageIndexSample: (input: {
      platform: string
      profile_id: string
      output_dir?: string
      page_url?: string
      limit?: number
    }) =>
      ipcRenderer.invoke(
        'collection:download-image-index-sample',
        input,
      ) as Promise<CollectionImageIndexDownloadResult>,
    downloadImageIndexItems: (input: {
      platform: string
      profile_id: string
      output_dir?: string
      page_url?: string
      items: CollectionImageIndexItem[]
    }) =>
      ipcRenderer.invoke(
        'collection:download-image-index-items',
        input,
      ) as Promise<CollectionImageIndexDownloadResult>,
  },
  generation: {
    generatePrompts: (input: GenerationPromptInput) =>
      ipcRenderer.invoke('generation:generate-prompts', input) as Promise<Txt2imgPromptDraft[]>,
    listExtractSources: () =>
      ipcRenderer.invoke('generation:list-extract-sources') as Promise<ExtractSourcesResult>,
    listImg2imgSources: () =>
      ipcRenderer.invoke('generation:list-img2img-sources') as Promise<Img2imgSourcesResult>,
    resolveImg2imgReferences: (input: { artifactIds: string[] }) =>
      ipcRenderer.invoke('generation:resolve-img2img-references', input) as Promise<
        Img2imgReferencePayload[]
      >,
    listComfyuiTxt2imgWorkflows: () =>
      ipcRenderer.invoke('generation:list-comfyui-txt2img-workflows') as Promise<
        ComfyuiWorkflowSummary[]
      >,
    listComfyuiImg2imgWorkflows: () =>
      ipcRenderer.invoke('generation:list-comfyui-img2img-workflows') as Promise<
        ComfyuiWorkflowSummary[]
      >,
    listComfyuiExtractWorkflows: () =>
      ipcRenderer.invoke('generation:list-comfyui-extract-workflows') as Promise<
        ComfyuiWorkflowSummary[]
      >,
    listComfyuiMattingWorkflows: () =>
      ipcRenderer.invoke('generation:list-comfyui-matting-workflows') as Promise<
        ComfyuiWorkflowSummary[]
      >,
    listComfyuiMixedMattingWorkflows: () =>
      ipcRenderer.invoke('generation:list-comfyui-mixed-matting-workflows') as Promise<
        ComfyuiWorkflowSummary[]
      >,
    listChenyuWorkflows: (input?: ChenyuWorkflowMarketListInput) =>
      ipcRenderer.invoke(
        'generation:list-chenyu-workflows',
        input,
      ) as Promise<ChenyuWorkflowMarketList>,
    getChenyuWorkflow: (input: { workflowId: string }) =>
      ipcRenderer.invoke(
        'generation:get-chenyu-workflow',
        input,
      ) as Promise<ChenyuWorkflowMarketInfo>,
    parseManualPrompts: (text: string) =>
      ipcRenderer.invoke('generation:parse-manual-prompts', text) as Promise<string[]>,
    runTxt2img: (input: Txt2imgRunInput) =>
      ipcRenderer.invoke('generation:run-txt2img', input) as Promise<string>,
    runComfyuiTxt2img: (input: ComfyuiTxt2imgRunInput) =>
      ipcRenderer.invoke('generation:run-comfyui-txt2img', input) as Promise<string>,
    runExtract: (input: ExtractRunInput) =>
      ipcRenderer.invoke('generation:run-extract', input) as Promise<string>,
    runComfyuiExtract: (input: ComfyuiExtractRunInput) =>
      ipcRenderer.invoke('generation:run-comfyui-extract', input) as Promise<string>,
    runComfyuiMatting: (input: ComfyuiMattingRunInput) =>
      ipcRenderer.invoke('generation:run-comfyui-matting', input) as Promise<string>,
    runMixedMatting: (input: MixedMattingRunInput) =>
      ipcRenderer.invoke('generation:run-mixed-matting', input) as Promise<string>,
    runComfyuiImg2img: (input: ComfyuiImg2imgRunInput) =>
      ipcRenderer.invoke('generation:run-comfyui-img2img', input) as Promise<string>,
    runChenyuWorkflow: (input: ChenyuWorkflowRunInput) =>
      ipcRenderer.invoke('generation:run-chenyu-workflow', input) as Promise<string>,
    onProgress: (callback: (progress: GenerationProgress) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, progress: GenerationProgress) => {
        callback(progress)
      }
      ipcRenderer.on('generation:progress', listener)

      return () => {
        ipcRenderer.removeListener('generation:progress', listener)
      }
    },
    onCompleted: (callback: (event: GenerationTaskEvent) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, event: GenerationTaskEvent) => {
        callback(event)
      }
      ipcRenderer.on('generation:completed', listener)

      return () => {
        ipcRenderer.removeListener('generation:completed', listener)
      }
    },
    onDebugLog: (callback: (entry: GenerationDebugLogEntry) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, entry: GenerationDebugLogEntry) => {
        callback(entry)
      }
      ipcRenderer.on('generation:debug-log', listener)

      return () => {
        ipcRenderer.removeListener('generation:debug-log', listener)
      }
    },
  },
  detection: {
    getConfig: () => ipcRenderer.invoke('detection:get-config') as Promise<DetectionConfig | null>,
    saveConfig: (input: DetectionConfig) =>
      ipcRenderer.invoke('detection:save-config', input) as Promise<DetectionConfig>,
    listInputSources: () =>
      ipcRenderer.invoke('detection:list-input-sources') as Promise<DetectionInputSources>,
    scanFolder: (input: { folder: string }) =>
      ipcRenderer.invoke('detection:scan-folder', input) as Promise<DetectionImageInfo[]>,
    listModels: () => ipcRenderer.invoke('detection:list-models') as Promise<string[]>,
    run: (input: DetectionBatchConfig) =>
      ipcRenderer.invoke('detection:run', input) as Promise<string>,
    listResults: (input?: {
      task_id?: string | null
      risk_level?: 'pass' | 'review' | 'block' | null
    }) => ipcRenderer.invoke('detection:list-results', input) as Promise<DetectionStoredResult[]>,
    getResult: (input: { artifact_id: string }) =>
      ipcRenderer.invoke('detection:get-result', input) as Promise<DetectionStoredResult | null>,
    retest: (input: { artifact_ids: string[] }) =>
      ipcRenderer.invoke('detection:retest', input) as Promise<string>,
    promoteToMatting: (input: { artifact_ids: string[]; mode?: 'copy' | 'move' }) =>
      ipcRenderer.invoke('detection:promote-to-matting', input) as Promise<number>,
    deleteResult: (input: { artifact_id: string }) =>
      ipcRenderer.invoke('detection:delete-result', input) as Promise<number>,
    onProgress: (callback: (progress: DetectionProgress) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, progress: DetectionProgress) => {
        callback(progress)
      }
      ipcRenderer.on('detection:progress', listener)

      return () => {
        ipcRenderer.removeListener('detection:progress', listener)
      }
    },
    onCompleted: (callback: (event: DetectionTaskEvent) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, event: DetectionTaskEvent) => {
        callback(event)
      }
      ipcRenderer.on('detection:completed', listener)

      return () => {
        ipcRenderer.removeListener('detection:completed', listener)
      }
    },
  },
  title: {
    listPlatforms: () =>
      ipcRenderer.invoke('title:list-platforms') as Promise<Array<{ key: string; label: string }>>,
    listLanguages: () =>
      ipcRenderer.invoke('title:list-languages') as Promise<Array<{ key: string; label: string }>>,
    listModels: () =>
      ipcRenderer.invoke('title:list-models') as Promise<Array<{ key: string; label: string }>>,
    chooseBatchDir: () =>
      ipcRenderer.invoke('title:choose-batch-dir') as Promise<
        | { ok: true; data: { path: string } }
        | { ok: false; error: { code: string; message: string } }
      >,
    scanBatchDir: (input: { batchDir: string }) =>
      ipcRenderer.invoke('title:scan-batch-dir', input) as Promise<{
        skuCount: number
        existingTitles: Record<string, string>
      }>,
    run: (input: TitleBatchConfig) => ipcRenderer.invoke('title:run', input) as Promise<string>,
    retryFailed: (input: { task_id: string }) =>
      ipcRenderer.invoke('title:retry-failed', input) as Promise<string>,
    getResult: (input: { sku_code: string; batch_dir: string }) =>
      ipcRenderer.invoke('title:get-result', input) as Promise<unknown | null>,
    openPath: (input: { path: string }) =>
      ipcRenderer.invoke('title:open-path', input) as Promise<
        { ok: true } | { ok: false; error: { code: string; message: string } }
      >,
    onProgress: (callback: (progress: TitleProgress) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, progress: TitleProgress) => {
        callback(progress)
      }
      ipcRenderer.on('title:progress', listener)

      return () => {
        ipcRenderer.removeListener('title:progress', listener)
      }
    },
    onCompleted: (callback: (event: TitleTaskEvent) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, event: TitleTaskEvent) => {
        callback(event)
      }
      ipcRenderer.on('title:completed', listener)

      return () => {
        ipcRenderer.removeListener('title:completed', listener)
      }
    },
  },
  listing: {
    listTemplates: () =>
      ipcRenderer.invoke('listing:list-templates') as Promise<ListingTemplateConfig[]>,
    listProfiles: () => ipcRenderer.invoke('listing:list-profiles') as Promise<BitBrowserProfile[]>,
    listSavedWorkspaces: () =>
      ipcRenderer.invoke('listing:list-saved-workspaces') as Promise<ListingWorkspaceRecord[]>,
    saveWorkspace: (input: ListingWorkspaceInput) =>
      ipcRenderer.invoke('listing:save-workspace', input) as Promise<ListingWorkspaceRecord>,
    updateWorkspaceStatus: (input: {
      workspaceId: string
      status: ListingWorkspaceStatus
      currentTaskId: string | null
    }) =>
      ipcRenderer.invoke(
        'listing:update-workspace-status',
        input,
      ) as Promise<ListingWorkspaceRecord | null>,
    listTasks: (input?: { workspaceId?: string; status?: ListingTaskStatus }) =>
      ipcRenderer.invoke('listing:list-tasks', input) as Promise<ListingTaskRecord[]>,
    createTask: (input: ListingTaskInput) =>
      ipcRenderer.invoke('listing:create-task', input) as Promise<ListingTaskRecord>,
    updateTaskStatus: (input: {
      taskId: string
      status: ListingTaskStatus
      lastRunTaskId?: string | null
    }) =>
      ipcRenderer.invoke('listing:update-task-status', input) as Promise<ListingTaskRecord | null>,
    deleteTask: (input: { taskId: string }) =>
      ipcRenderer.invoke('listing:delete-task', input) as Promise<void>,
    chooseBatchDir: () =>
      ipcRenderer.invoke('listing:choose-batch-dir') as Promise<
        | { ok: true; data: { path: string } }
        | { ok: false; error: { code: string; message: string } }
      >,
    scanBatchDir: (input: { batchDir: string; templateKey: string }) =>
      ipcRenderer.invoke('listing:scan-batch-dir', input) as Promise<ListingBatchLoadResult>,
    listStatus: (input: { batchDir: string; platform?: string; status?: string }) =>
      ipcRenderer.invoke('listing:list-status', input) as Promise<ListingStatusRow[]>,
    openPath: (input: { path: string }) =>
      ipcRenderer.invoke('listing:open-path', input) as Promise<
        { ok: true } | { ok: false; error: { code: string; message: string } }
      >,
    run: (input: { config: ListingRunConfig; items: ListingItem[] }) =>
      ipcRenderer.invoke('listing:run', input) as Promise<string>,
    onProgress: (callback: (progress: ListingProgress) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, progress: ListingProgress) => {
        callback(progress)
      }
      ipcRenderer.on('listing:progress', listener)

      return () => {
        ipcRenderer.removeListener('listing:progress', listener)
      }
    },
  },
  activation: {
    activate: (input: { code: string; device_name: string }) =>
      ipcRenderer.invoke('activation:activate', input) as Promise<
        | {
            ok: true
            data: {
              activation_token: string
              expires_at: number
              max_devices: number
              used_devices: number
              device_name: string
            }
          }
        | { ok: false; error: { code: string; message: string } }
      >,
    getStatus: () => ipcRenderer.invoke('activation:get-status') as Promise<ActivationBadgeState>,
    syncStatus: () => ipcRenderer.invoke('activation:sync-status') as Promise<ActivationBadgeState>,
    onStatusChanged: (callback: (status: ActivationBadgeState) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, status: ActivationBadgeState) => {
        callback(status)
      }
      ipcRenderer.on('activation:status-changed', listener)

      return () => {
        ipcRenderer.removeListener('activation:status-changed', listener)
      }
    },
  },
  photoshop: {
    getStatus: () => ipcRenderer.invoke('photoshop:get-status') as Promise<PhotoshopStatus>,
    choosePrintFolder: () =>
      ipcRenderer.invoke('photoshop:choose-print-folder') as Promise<
        | { ok: true; data: { path: string } }
        | { ok: false; error: { code: string; message: string } }
      >,
    chooseTemplates: () =>
      ipcRenderer.invoke('photoshop:choose-templates') as Promise<
        | { ok: true; data: { paths: string[] } }
        | { ok: false; error: { code: string; message: string } }
      >,
    openPath: (path: string) =>
      ipcRenderer.invoke('photoshop:open-path', { path }) as Promise<{ ok: true }>,
    scanTemplate: (input: PhotoshopScanTemplateRequest) =>
      ipcRenderer.invoke('photoshop:scan-template', input) as Promise<PsdTemplate>,
    listCachedTemplates: () =>
      ipcRenderer.invoke('photoshop:list-cached-templates') as Promise<PsdTemplate[]>,
    onProgress: (callback: (progress: PhotoshopProgressInfo) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, progress: PhotoshopProgressInfo) => {
        callback(progress)
      }
      ipcRenderer.on('photoshop:progress', listener)

      return () => {
        ipcRenderer.removeListener('photoshop:progress', listener)
      }
    },
  },
}

contextBridge.exposeInMainWorld('api', api)
