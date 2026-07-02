/// <reference types="vite/client" />

import type {
  ChooseLocalComfyuiWorkflowDirectoryResult as WorkflowDirectoryChooseResult,
  ImportLocalComfyuiWorkflowDirectoryInput as WorkflowDirectoryImportInput,
  ImportLocalComfyuiWorkflowDirectoryResult as WorkflowDirectoryImportResult,
} from '../../main/lib/comfyui-workflow-cache'

declare global {
  interface Window {
    api: {
      ping: () => Promise<string>
      logs: {
        deleteAll: () => Promise<
          | { ok: true; data: { path: string; deletedFiles: number; deletedBytes: number } }
          | { ok: false; error: { code: string; message: string } }
        >
      }
      onboarding: {
        getState: () => Promise<{
          needs_onboarding: boolean
          default_workbench_root: string
          workbench_root: string | null
        }>
        chooseWorkbenchRoot: () => Promise<
          | { ok: true; data: { path: string } }
          | { ok: false; error: { code: string; message: string } }
        >
        saveWorkbenchRoot: (path: string) => Promise<{ ok: true; data: { path: string } }>
        saveApiKeys: (apiKeys: Record<string, string>) => Promise<{ ok: true }>
        complete: () => Promise<{ ok: true }>
      }
      workspace: {
        getState: () => Promise<{
          root: string | null
          directories: string[]
        }>
        chooseRoot: () => Promise<
          | { ok: true; data: { path: string } }
          | { ok: false; error: { code: string; message: string } }
        >
        saveRoot: (
          path: string,
        ) => Promise<
          | { ok: true; data: { path: string; directories: string[] } }
          | { ok: false; error: { code: string; message: string } }
        >
      }
      keychain: {
        has: (key: string) => Promise<boolean>
      }
      customerAuth: {
        getState: () => Promise<import('../../main/lib/customer-auth').CustomerAuthState>
        getQrcode: () => Promise<import('../../main/lib/customer-auth').CustomerAuthQrcode>
        startWechatLogin: () => Promise<import('../../main/lib/customer-auth').CustomerAuthQrcode>
        checkWechatLogin: (input: {
          token: string
        }) => Promise<import('../../main/lib/customer-auth').CustomerAuthState>
        sendSms: (input: {
          phone: string
        }) => Promise<import('../../main/lib/customer-auth').CustomerAuthSmsResult>
        getSmsCountdown: () => Promise<{ remaining_seconds: number }>
        loginByPhone: (input: {
          code: string
          invite?: string
          phone: string
        }) => Promise<import('../../main/lib/customer-auth').CustomerAuthState>
        verify: (input?: {
          allowStaleOnTransientFailure?: boolean
        }) => Promise<import('../../main/lib/customer-auth').CustomerAuthState>
        logout: () => Promise<import('../../main/lib/customer-auth').CustomerAuthState>
      }
      chenyu: {
        getSettings: () => Promise<
          import('../../main/lib/chenyu-instance-service').ChenyuSettingsSnapshot
        >
        saveSettings: (
          input: import('../../main/lib/chenyu-instance-service').ChenyuSaveSettingsInput,
        ) => Promise<import('../../main/lib/chenyu-instance-service').ChenyuSettingsSnapshot>
        testConnection: () => Promise<{ balance: number; card_balance: number }>
        discoverPod: (input?: { keyword?: string }) => Promise<
          import('../../main/lib/chenyu-instance-service').ChenyuPodDiscoveryResult
        >
        listGpus: () => Promise<import('../../main/lib/chenyu-cloud-client').ChenyuGpu[]>
        listInstances: () => Promise<
          import('../../main/lib/chenyu-instance-service').ChenyuManagedInstance[]
        >
        createFixedPodInstance: (
          input: import('../../main/lib/chenyu-instance-service').ChenyuCreateFixedPodInstanceInput,
        ) => Promise<import('../../main/lib/comfyui-instance-manager').ComfyuiInstanceSummary>
        startupInstance: (input: {
          instanceUuid: string
          gpuUuid?: string
          gpuNums?: number
        }) => Promise<import('../../main/lib/chenyu-cloud-client').ChenyuInstanceInfo>
        shutdownInstance: (input: {
          instanceUuid: string
        }) => Promise<import('../../main/lib/chenyu-cloud-client').ChenyuInstanceInfo>
        restartInstance: (input: {
          instanceUuid: string
        }) => Promise<import('../../main/lib/chenyu-cloud-client').ChenyuInstanceInfo>
        destroyInstance: (input: { instanceUuid: string }) => Promise<{ ok: true }>
        setActiveInstance: (input: {
          instanceUuid: string
          comfyuiUrl?: string
        }) => Promise<import('../../main/lib/comfyui-instance-manager').ComfyuiInstanceSummary>
        getActiveInstance: () => Promise<
          import('../../main/lib/comfyui-instance-manager').ComfyuiInstanceSummary | null
        >
        refreshActiveInstance: () => Promise<
          import('../../main/lib/comfyui-instance-manager').ComfyuiInstanceSummary | null
        >
      }
      browserProfileLock: {
        list: () => Promise<import('../../main/lib/browser-profile-lock').BrowserProfileHolder[]>
      }
      skill: {
        list: (filter?: {
          module?: 'generation' | 'detection' | 'title'
          category?: string
          platform?: string
          language?: string
        }) => Promise<import('@tengyu-aipod/shared').SkillSummary[]>
        get: (input: {
          id: string
          version?: string
        }) => Promise<import('@tengyu-aipod/shared').Skill>
        refresh: () => Promise<
          { ok: true; count: number } | { ok: false; count: number; error: string }
        >
      }
      generationSettings: {
        get: () => Promise<
          import('../../main/lib/generation-local-config').GenerationLocalSettingsSnapshot
        >
        save: (
          input: import('../../main/lib/generation-local-config').SaveGenerationLocalSettingsInput,
        ) => Promise<
          import('../../main/lib/generation-local-config').GenerationLocalSettingsSnapshot
        >
      }
      video: {
        chooseImages: (input?: { multiple?: boolean }) => Promise<
          | { ok: true; data: { paths: string[] } }
          | { ok: false; error: { code: string; message: string } }
        >
        run: (
          input: import('../../main/lib/video-generation-service').VideoRunInput,
        ) => Promise<string>
        stop: (input: { task_id: string }) => Promise<{ ok: boolean }>
        openPath: (input: { path: string }) => Promise<
          { ok: true } | { ok: false; error: { code: string; message: string } }
        >
        onProgress: (
          callback: (
            progress: import('../../main/lib/video-generation-service').VideoProgressEvent,
          ) => void,
        ) => () => void
        onCompleted: (
          callback: (
            event: import('../../main/lib/video-generation-service').VideoCompletedEvent,
          ) => void,
        ) => () => void
        onDebugLog: (
          callback: (
            entry: import('../../main/lib/video-generation-service').VideoRuntimeLogEntry,
          ) => void,
        ) => () => void
      }
      workflow: {
        chooseDirectory: () => Promise<WorkflowDirectoryChooseResult>
        listLocal: (
          category?: import('../../main/lib/comfyui-workflow-cache').ComfyuiWorkflowCategory,
        ) => Promise<import('../../main/lib/comfyui-workflow-cache').ComfyuiWorkflowSummary[]>
        importLocal: (
          input: import('../../main/lib/comfyui-workflow-cache').ImportLocalComfyuiWorkflowInput,
        ) => Promise<import('../../main/lib/comfyui-workflow-cache').ComfyuiWorkflowSummary>
        importDirectory: (
          input: WorkflowDirectoryImportInput,
        ) => Promise<WorkflowDirectoryImportResult>
        removeLocal: (input: { id: string }) => Promise<{ ok: true }>
      }
      tempFile: {
        getUsage: () => Promise<Record<string, number>>
        cleanupAll: () => Promise<{ ok: true }>
      }
      collection: {
        getConfig: () => Promise<import('../../main/lib/collection-config').CollectionConfig | null>
        saveConfig: (
          input: import('../../main/lib/collection-config').CollectionConfig,
        ) => Promise<import('../../main/lib/collection-config').CollectionConfig>
        listPlatforms: () => Promise<
          import('../../main/lib/collection-injected-script').CollectionPlatformRule[]
        >
        listProfiles: () => Promise<
          import('../../main/lib/bit-browser-client').BitBrowserProfileWithStatus[]
        >
        getCurrentPage: (input: {
          platform: string
          profile_id: string
        }) => Promise<
          import('../../main/lib/collection-image-index-service').CollectionCurrentPageResult
        >
        openPage: (input: {
          platform: string
          profile_id: string
          page_url: string
        }) => Promise<
          import('../../main/lib/collection-image-index-service').CollectionCurrentPageResult
        >
        startSession: (
          input: import('../../main/lib/collection-session-manager').CollectionSessionConfig,
        ) => Promise<import('../../main/lib/collection-session-manager').CollectionSession>
        stopSession: () => Promise<
          import('../../main/lib/collection-session-manager').CollectionSession | null
        >
        resumeSession: () => Promise<
          import('../../main/lib/collection-session-manager').CollectionSession | null
        >
        openProfile: (input: { profile_id: string }) => Promise<
          import('../../main/lib/bit-browser-client').BitBrowserCdpEndpoint
        >
        handleClick: (input: {
          event: import('../../main/lib/collection-click-service').CollectionClickEvent
          platformRule: import('../../main/lib/collection-injected-script').CollectionPlatformRule
        }) => Promise<import('../../main/lib/collection-click-service').CollectionClickResult>
        handleScroll: (input: {
          event: import('../../main/lib/collection-click-service').CollectionScrollEvent
          platformRule: import('../../main/lib/collection-injected-script').CollectionPlatformRule
        }) => Promise<import('../../main/lib/collection-click-service').CollectionScrollResult>
        setSku: (input: { goods_link: string; sku_code: string }) => Promise<{
          ok: true
          results: import('../../main/lib/collection-click-service').CollectionClickResult[]
        }>
        listRecords: (input: {
          session_id: string
          status?: import('../../main/lib/collection-record-store').CollectionRecordStatus
          limit?: number
        }) => Promise<import('../../main/lib/collection-record-store').CollectionRecordRow[]>
        retryRecord: (input: { record_id: string }) => Promise<
          import('../../main/lib/collection-click-service').CollectionScrollResult
        >
        deleteRecord: (input: { record_id: string }) => Promise<{
          ok: true
          record_id: string
        }>
        scanImageIndex: (input: {
          platform: string
          profile_id: string
          output_dir?: string
          page_url?: string
          limit?: number
          see_more_clicks?: number
        }) => Promise<
          import('../../main/lib/collection-image-index-service').CollectionImageIndexScanResult
        >
        probeImageIndexClick: (input: {
          platform: string
          profile_id: string
          output_dir?: string
          page_url?: string
          limit?: number
        }) => Promise<
          import('../../main/lib/collection-image-index-service').CollectionImageIndexClickResult
        >
        downloadImageIndexSample: (input: {
          platform: string
          profile_id: string
          output_dir?: string
          page_url?: string
          limit?: number
        }) => Promise<
          import('../../main/lib/collection-image-index-service').CollectionImageIndexDownloadResult
        >
        downloadImageIndexItems: (input: {
          platform: string
          profile_id: string
          output_dir?: string
          page_url?: string
          items: import('../../main/lib/collection-image-index-service').CollectionImageIndexItem[]
        }) => Promise<
          import('../../main/lib/collection-image-index-service').CollectionImageIndexDownloadResult
        >
        getActiveSession: () => Promise<
          import('../../main/lib/collection-session-manager').CollectionSession | null
        >
        onEvent: (
          callback: (
            event: import('../../main/lib/collection-session-manager').CollectionSessionEvent,
          ) => void,
        ) => () => void
      }
      generation: {
        generatePrompts: (
          input: import('../../main/lib/generation-service').GenerationPromptInput,
        ) => Promise<import('../../main/lib/generation-service').Txt2imgPromptDraft[]>
        chooseImageFolder: () => Promise<
          import('../../main/lib/generation-service').ChooseGenerationImageFolderResult
        >
        scanImageFolder: (input: { folder: string }) => Promise<
          import('../../main/lib/generation-service').GenerationImageSource[]
        >
        listExtractSources: () => Promise<
          import('../../main/lib/generation-service').ExtractSourcesResult
        >
        listImg2imgSources: () => Promise<
          import('../../main/lib/generation-service').Img2imgSourcesResult
        >
        resolveImg2imgReferences: (input: { artifactIds: string[] }) => Promise<
          import('../../main/lib/generation-service').Img2imgReferencePayload[]
        >
        listComfyuiTxt2imgWorkflows: () => Promise<
          import('../../main/lib/comfyui-workflow-cache').ComfyuiWorkflowSummary[]
        >
        listComfyuiImg2imgWorkflows: () => Promise<
          import('../../main/lib/comfyui-workflow-cache').ComfyuiWorkflowSummary[]
        >
        listComfyuiExtractWorkflows: () => Promise<
          import('../../main/lib/comfyui-workflow-cache').ComfyuiWorkflowSummary[]
        >
        listComfyuiMattingWorkflows: () => Promise<
          import('../../main/lib/comfyui-workflow-cache').ComfyuiWorkflowSummary[]
        >
        listComfyuiMixedMattingWorkflows: () => Promise<
          import('../../main/lib/comfyui-workflow-cache').ComfyuiWorkflowSummary[]
        >
        listChenyuWorkflows: (
          input?: import('../../main/lib/generation-service').ChenyuWorkflowMarketListInput,
        ) => Promise<import('../../main/lib/chenyu-cloud-client').ChenyuWorkflowMarketList>
        getChenyuWorkflow: (input: { workflowId: string }) => Promise<
          import('../../main/lib/chenyu-cloud-client').ChenyuWorkflowMarketInfo
        >
        parseManualPrompts: (text: string) => Promise<string[]>
        runTxt2img: (
          input: import('../../main/lib/generation-service').Txt2imgRunInput,
        ) => Promise<string>
        runComfyuiTxt2img: (
          input: import('../../main/lib/generation-service').ComfyuiTxt2imgRunInput,
        ) => Promise<string>
        runExtract: (
          input: import('../../main/lib/generation-service').ExtractRunInput,
        ) => Promise<string>
        runComfyuiExtract: (
          input: import('../../main/lib/generation-service').ComfyuiExtractRunInput,
        ) => Promise<string>
        runComfyuiExtractMatting: (
          input: import('../../main/lib/generation-service').ComfyuiExtractMattingRunInput,
        ) => Promise<string>
        runComfyuiMatting: (
          input: import('../../main/lib/generation-service').ComfyuiMattingRunInput,
        ) => Promise<string>
        runMixedMatting: (
          input: import('../../main/lib/generation-service').MixedMattingRunInput,
        ) => Promise<string>
        runComfyuiImg2img: (
          input: import('../../main/lib/generation-service').ComfyuiImg2imgRunInput,
        ) => Promise<string>
        runChenyuWorkflow: (
          input: import('../../main/lib/generation-service').ChenyuWorkflowRunInput,
        ) => Promise<string>
        cancel: (input: { task_id: string }) => Promise<{ ok: boolean }>
        onProgress: (
          callback: (
            progress: import('../../main/lib/generation-service').GenerationProgress,
          ) => void,
        ) => () => void
        onCompleted: (
          callback: (
            event: import('../../main/lib/generation-service').GenerationTaskEvent,
          ) => void,
        ) => () => void
        onDebugLog: (
          callback: (
            entry: import('../../main/lib/generation-service').GenerationDebugLogEntry,
          ) => void,
        ) => () => void
      }
      detection: {
        getConfig: () => Promise<import('../../main/lib/detection-config').DetectionConfig | null>
        saveConfig: (
          input: import('../../main/lib/detection-config').DetectionConfig,
        ) => Promise<import('../../main/lib/detection-config').DetectionConfig>
        chooseInputFolder: () => Promise<
          import('../../main/lib/detection-service').ChooseDetectionInputFolderResult
        >
        listInputSources: () => Promise<
          import('../../main/lib/detection-service').DetectionInputSources
        >
        scanFolder: (input: { folder: string }) => Promise<
          import('../../main/lib/detection-service').DetectionImageInfo[]
        >
        scanPaths: (input: { paths: string[] }) => Promise<
          import('../../main/lib/detection-service').DetectionImageInfo[]
        >
        listModels: () => Promise<string[]>
        run: (
          input: import('../../main/lib/detection-service').DetectionBatchConfig,
        ) => Promise<string>
        cancel: (input: { task_id: string }) => Promise<{ ok: boolean }>
        listResults: (input?: {
          task_id?: string | null
          risk_level?: import('@tengyu-aipod/shared').RiskLevel | null
        }) => Promise<import('../../main/lib/detection-service').DetectionStoredResult[]>
        getResult: (input: { artifact_id: string }) => Promise<
          import('../../main/lib/detection-service').DetectionStoredResult | null
        >
        retest: (input: { artifact_ids: string[] }) => Promise<string>
        promoteToMatting: (input: {
          artifact_ids: string[]
          mode?: 'copy' | 'move'
        }) => Promise<number>
        listMattingCandidates: () => Promise<
          import('../../main/lib/detection-service').MattingCandidate[]
        >
        deleteResult: (input: { artifact_id: string }) => Promise<number>
        onProgress: (
          callback: (
            progress: import('../../main/lib/detection-service').DetectionProgress,
          ) => void,
        ) => () => void
        onCompleted: (
          callback: (event: import('../../main/lib/detection-service').DetectionTaskEvent) => void,
        ) => () => void
      }
      title: {
        listPlatforms: () => Promise<Array<{ key: string; label: string }>>
        listLanguages: () => Promise<Array<{ key: string; label: string }>>
        listModels: () => Promise<Array<{ key: string; label: string }>>
        chooseBatchDir: () => Promise<
          | { ok: true; data: { path: string } }
          | { ok: false; error: { code: string; message: string } }
        >
        scanBatchDir: (input: { batchDir: string; titleFileName?: string }) => Promise<{
          skuCount: number
          skuCodes: string[]
          existingTitles: Record<string, string>
        }>
        run: (input: import('../../main/lib/title-service').TitleBatchConfig) => Promise<string>
        cancel: (input: { task_id: string }) => Promise<{ ok: boolean }>
        retryFailed: (input: { task_id: string }) => Promise<string>
        getResult: (input: { sku_code: string; batch_dir: string }) => Promise<unknown | null>
        openPath: (input: { path: string }) => Promise<
          { ok: true } | { ok: false; error: { code: string; message: string } }
        >
        onProgress: (
          callback: (progress: import('../../main/lib/title-service').TitleProgress) => void,
        ) => () => void
        onCompleted: (
          callback: (event: import('../../main/lib/title-service').TitleTaskEvent) => void,
        ) => () => void
      }
      pipeline: {
        run: (input: import('@tengyu-aipod/shared').PipelineRunConfig) => Promise<string>
        cancel: (input: { run_id: string }) => Promise<{ ok: boolean }>
        listRuns: () => Promise<import('@tengyu-aipod/shared').PipelineRunRecord[]>
        getRun: (input: { run_id: string }) => Promise<
          import('@tengyu-aipod/shared').PipelineRunDetail | null
        >
        onProgress: (
          callback: (progress: import('@tengyu-aipod/shared').PipelineProgress) => void,
        ) => () => void
        onCompleted: (
          callback: (event: import('@tengyu-aipod/shared').PipelineTaskEvent) => void,
        ) => () => void
      }
      listing: {
        listTemplates: () => Promise<import('@tengyu-aipod/shared').ListingTemplateConfig[]>
        listProfiles: () => Promise<import('../../main/lib/bit-browser-client').BitBrowserProfile[]>
        chooseBatchDir: () => Promise<
          | { ok: true; data: { path: string } }
          | { ok: false; error: { code: string; message: string } }
        >
        scanBatchDir: (input: {
          batchDir: string
          templateKey: string
        }) => Promise<import('../../main/lib/listing-batch-loader').ListingBatchLoadResult>
        listSavedWorkspaces: () => Promise<import('@tengyu-aipod/shared').ListingWorkspaceRecord[]>
        saveWorkspace: (
          input: import('@tengyu-aipod/shared').ListingWorkspaceInput,
        ) => Promise<import('@tengyu-aipod/shared').ListingWorkspaceRecord>
        updateWorkspaceStatus: (input: {
          workspaceId: string
          status: import('@tengyu-aipod/shared').ListingWorkspaceStatus
          currentTaskId: string | null
        }) => Promise<import('@tengyu-aipod/shared').ListingWorkspaceRecord | null>
        listTasks: (input?: {
          workspaceId?: string
          status?: import('@tengyu-aipod/shared').ListingTaskStatus
        }) => Promise<import('@tengyu-aipod/shared').ListingTaskRecord[]>
        createTask: (
          input: import('@tengyu-aipod/shared').ListingTaskInput,
        ) => Promise<import('@tengyu-aipod/shared').ListingTaskRecord>
        updateTaskStatus: (input: {
          taskId: string
          status: import('@tengyu-aipod/shared').ListingTaskStatus
          lastRunTaskId?: string | null
        }) => Promise<import('@tengyu-aipod/shared').ListingTaskRecord | null>
        deleteTask: (input: { taskId: string }) => Promise<void>
        listStatus: (input: {
          batchDir: string
          platform?: string
          status?: string
        }) => Promise<import('../../modules/listing/runner').ListingStatusRow[]>
        openPath: (input: { path: string }) => Promise<
          { ok: true } | { ok: false; error: { code: string; message: string } }
        >
        run: (input: {
          config: import('../../modules/listing/runner').ListingRunConfig
          items: import('@tengyu-aipod/shared').ListingItem[]
        }) => Promise<string>
        onProgress: (
          callback: (progress: import('@tengyu-aipod/shared').ListingProgress) => void,
        ) => () => void
      }
      photoshop: {
        getStatus: () => Promise<import('@tengyu-aipod/shared').PhotoshopStatus>
        choosePrintFolder: () => Promise<
          | { ok: true; data: { path: string } }
          | { ok: false; error: { code: string; message: string } }
        >
        chooseTemplates: () => Promise<
          | { ok: true; data: { paths: string[] } }
          | { ok: false; error: { code: string; message: string } }
        >
        chooseOutputFolder: () => Promise<
          | { ok: true; data: { path: string } }
          | { ok: false; error: { code: string; message: string } }
        >
        openPath: (path: string) => Promise<{ ok: true }>
        scanPrintFolder: (input: { excluded_file_paths?: string[]; folder: string }) => Promise<
          import('../../main/photoshop/print-folder').PhotoshopPrintFolderScan
        >
        scanTemplate: (
          input: import('@tengyu-aipod/shared').PhotoshopScanTemplateRequest,
        ) => Promise<import('@tengyu-aipod/shared').PsdTemplate>
        runBatch: (input: {
          print_folder: string
          excluded_print_paths?: string[]
          templates: string[]
          replace_range: 'auto' | 'topmost' | 'top' | 'all'
          output_layout: import('@tengyu-aipod/shared').PhotoshopOutputLayout
          format: import('@tengyu-aipod/shared').PhotoshopExportFormat
          clip_mode: import('@tengyu-aipod/shared').PhotoshopClipMode
          skip_completed: boolean
          max_retries: number
          output_root: string
        }) => Promise<import('@tengyu-aipod/shared').PhotoshopBatchResult>
        cancel: (input: { task_id: string }) => Promise<{ ok: boolean }>
        listCachedTemplates: () => Promise<import('@tengyu-aipod/shared').PsdTemplate[]>
        onProgress: (
          callback: (progress: import('@tengyu-aipod/shared').PhotoshopProgressInfo) => void,
        ) => () => void
        onLog: (
          callback: (entry: import('@tengyu-aipod/shared').PhotoshopProgressLogEntry) => void,
        ) => () => void
      }
    }
  }
}
