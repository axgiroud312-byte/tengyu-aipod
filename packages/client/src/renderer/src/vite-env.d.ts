/// <reference types="vite/client" />

declare global {
  interface Window {
    api: {
      ping: () => Promise<string>
      onboarding: {
        getState: () => Promise<{
          needs_onboarding: boolean
          default_workbench_root: string
        }>
        chooseWorkbenchRoot: () => Promise<
          | { ok: true; data: { path: string } }
          | { ok: false; error: { code: string; message: string } }
        >
        saveWorkbenchRoot: (path: string) => Promise<{ ok: true; data: { path: string } }>
        saveApiKeys: (apiKeys: Record<string, string>) => Promise<{ ok: true }>
        complete: () => Promise<{ ok: true }>
      }
      keychain: {
        has: (key: string) => Promise<boolean>
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
      }
      tempFile: {
        getUsage: () => Promise<Record<string, number>>
        cleanupAll: () => Promise<{ ok: true }>
      }
      collection: {
        startSession: (
          input: import('../../main/lib/collection-session-manager').CollectionSessionConfig,
        ) => Promise<import('../../main/lib/collection-session-manager').CollectionSession>
        stopSession: () => Promise<
          import('../../main/lib/collection-session-manager').CollectionSession | null
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
        listExtractSources: () => Promise<
          import('../../main/lib/generation-service').ExtractSourcesResult
        >
        listImg2imgSources: () => Promise<
          import('../../main/lib/generation-service').Img2imgSourcesResult
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
        parseManualPrompts: (text: string) => Promise<string[]>
        runTxt2img: (
          input: import('../../main/lib/generation-service').Txt2imgRunInput,
        ) => Promise<string>
        runExtract: (
          input: import('../../main/lib/generation-service').ExtractRunInput,
        ) => Promise<string>
        runComfyuiExtract: (
          input: import('../../main/lib/generation-service').ComfyuiExtractRunInput,
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
      }
      detection: {
        getConfig: () => Promise<import('../../main/lib/detection-config').DetectionConfig | null>
        saveConfig: (
          input: import('../../main/lib/detection-config').DetectionConfig,
        ) => Promise<import('../../main/lib/detection-config').DetectionConfig>
        listInputSources: () => Promise<
          import('../../main/lib/detection-service').DetectionInputSources
        >
        scanFolder: (input: { folder: string }) => Promise<
          import('../../main/lib/detection-service').DetectionImageInfo[]
        >
        listModels: () => Promise<string[]>
        run: (
          input: import('../../main/lib/detection-service').DetectionBatchConfig,
        ) => Promise<string>
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
        scanBatchDir: (input: { batchDir: string }) => Promise<{
          skuCount: number
          existingTitles: Record<string, string>
        }>
        run: (input: import('../../main/lib/title-service').TitleBatchConfig) => Promise<string>
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
      activation: {
        activate: (input: { code: string; device_name: string }) => Promise<
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
        >
        getStatus: () => Promise<import('@tengyu-aipod/shared').ActivationBadgeState>
        syncStatus: () => Promise<import('@tengyu-aipod/shared').ActivationBadgeState>
        onStatusChanged: (
          callback: (status: import('@tengyu-aipod/shared').ActivationBadgeState) => void,
        ) => () => void
      }
    }
  }
}

export {}
