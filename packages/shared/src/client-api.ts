import type {
  ListingItem,
  ListingProgress,
  ListingTaskInput,
  ListingTaskRecord,
  ListingTaskStatus,
  ListingTemplateConfig,
  ListingWorkspaceInput,
  ListingWorkspaceRecord,
  ListingWorkspaceStatus,
} from './listing-types'
import type {
  PipelineProgress,
  PipelineRunConfig,
  PipelineRunDetail,
  PipelineRunRecord,
  PipelineTaskEvent,
  Skill,
  SkillSummary,
} from './types'

export type IpcOk<TData> = { ok: true; data: TData }
export type IpcFail = { ok: false; error: { code: string; message: string } }
export type IpcResult<TData> = IpcOk<TData> | IpcFail

export type ClientApi = {
  ping: () => Promise<string>
  skill: {
    list: (filter?: {
      module?: 'generation' | 'detection' | 'title'
      category?: string
      platform?: string
      language?: string
    }) => Promise<SkillSummary[]>
    get: (input: { id: string; version?: string }) => Promise<Skill>
    refresh: () => Promise<
      { ok: true; count: number } | { ok: false; count: number; error: string }
    >
  }
  pipeline: {
    run: (input: PipelineRunConfig) => Promise<string>
    resume: (input: { run_id: string }) => Promise<string>
    cancel: (input: { run_id: string }) => Promise<{ ok: boolean }>
    listRuns: () => Promise<PipelineRunRecord[]>
    getRun: (input: { run_id: string }) => Promise<PipelineRunDetail | null>
    onProgress: (callback: (progress: PipelineProgress) => void) => () => void
    onCompleted: (callback: (event: PipelineTaskEvent) => void) => () => void
  }
  listing: {
    listTemplates: () => Promise<ListingTemplateConfig[]>
    listSavedWorkspaces: () => Promise<ListingWorkspaceRecord[]>
    saveWorkspace: (input: ListingWorkspaceInput) => Promise<ListingWorkspaceRecord>
    updateWorkspaceStatus: (input: {
      workspaceId: string
      status: ListingWorkspaceStatus
      currentTaskId: string | null
    }) => Promise<ListingWorkspaceRecord | null>
    listTasks: (input?: {
      workspaceId?: string
      status?: ListingTaskStatus
    }) => Promise<ListingTaskRecord[]>
    createTask: (input: ListingTaskInput) => Promise<ListingTaskRecord>
    onProgress: (callback: (progress: ListingProgress) => void) => () => void
    run: (input: { config: unknown; items: ListingItem[] }) => Promise<string>
  }
}
