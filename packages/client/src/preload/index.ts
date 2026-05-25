import type {
  ActivationBadgeState,
  ListingItem,
  ListingProgress,
  ListingTemplateConfig,
  Skill,
  SkillSummary,
} from '@tengyu-aipod/shared'
import { contextBridge, ipcRenderer } from 'electron'
import type { BitBrowserProfile } from '../main/lib/bit-browser-client'
import type { BrowserProfileHolder } from '../main/lib/browser-profile-lock'
import type {
  CollectionClickEvent,
  CollectionClickResult,
  CollectionScrollEvent,
  CollectionScrollResult,
} from '../main/lib/collection-click-service'
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
import type { ComfyuiWorkflowSummary } from '../main/lib/comfyui-workflow-cache'
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
  ComfyuiExtractRunInput,
  ComfyuiImg2imgRunInput,
  ComfyuiMattingRunInput,
  ExtractRunInput,
  ExtractSourcesResult,
  GenerationProgress,
  GenerationPromptInput,
  GenerationRunResult,
  GenerationTaskEvent,
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
  },
  tempFile: {
    getUsage: () => ipcRenderer.invoke('temp-file:get-usage') as Promise<Record<string, number>>,
    cleanupAll: () =>
      ipcRenderer.invoke('temp-file:cleanup-all') as Promise<{
        ok: true
      }>,
  },
  collection: {
    startSession: (input: CollectionSessionConfig) =>
      ipcRenderer.invoke('collection:start-session', input) as Promise<CollectionSession>,
    stopSession: () =>
      ipcRenderer.invoke('collection:stop-session') as Promise<CollectionSession | null>,
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
  },
  generation: {
    generatePrompts: (input: GenerationPromptInput) =>
      ipcRenderer.invoke('generation:generate-prompts', input) as Promise<Txt2imgPromptDraft[]>,
    listExtractSources: () =>
      ipcRenderer.invoke('generation:list-extract-sources') as Promise<ExtractSourcesResult>,
    listImg2imgSources: () =>
      ipcRenderer.invoke('generation:list-img2img-sources') as Promise<Img2imgSourcesResult>,
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
    parseManualPrompts: (text: string) =>
      ipcRenderer.invoke('generation:parse-manual-prompts', text) as Promise<string[]>,
    runTxt2img: (input: Txt2imgRunInput) =>
      ipcRenderer.invoke('generation:run-txt2img', input) as Promise<string>,
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
}

contextBridge.exposeInMainWorld('api', api)
