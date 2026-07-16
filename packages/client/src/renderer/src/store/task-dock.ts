import type { PipelineRunRecord, PipelineRunStatus } from '@tengyu-aipod/shared'
import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'

type TaskDockState = {
  completeTaskRuns: PipelineRunRecord[]
  expanded: boolean
  selectedRunId: string | null
  softStoppingRunIds: string[]
  markRunSoftStopping: (runId: string) => void
  patchCompleteTaskRunStatus: (runId: string, status: PipelineRunStatus) => void
  replaceCompleteTaskRuns: (runs: PipelineRunRecord[]) => void
  selectCompleteTaskRun: (runId: string | null) => void
  setExpanded: (expanded: boolean) => void
  upsertCompleteTaskRun: (run: PipelineRunRecord) => void
}

export const useTaskDockStore = create<TaskDockState>()(
  persist(
    (set) => ({
      completeTaskRuns: [],
      expanded: true,
      selectedRunId: null,
      softStoppingRunIds: [],
      markRunSoftStopping: (runId) =>
        set((state) => ({
          softStoppingRunIds: state.softStoppingRunIds.includes(runId)
            ? state.softStoppingRunIds
            : [...state.softStoppingRunIds, runId],
        })),
      patchCompleteTaskRunStatus: (runId, status) =>
        set((state) => ({
          completeTaskRuns: state.completeTaskRuns.map((run) =>
            run.id === runId ? { ...run, status } : run,
          ),
          softStoppingRunIds:
            status === 'running'
              ? state.softStoppingRunIds
              : state.softStoppingRunIds.filter((id) => id !== runId),
        })),
      replaceCompleteTaskRuns: (completeTaskRuns) => set({ completeTaskRuns }),
      selectCompleteTaskRun: (selectedRunId) => set({ selectedRunId }),
      setExpanded: (expanded) => set({ expanded }),
      upsertCompleteTaskRun: (nextRun) =>
        set((state) => {
          const exists = state.completeTaskRuns.some((run) => run.id === nextRun.id)
          return {
            completeTaskRuns: exists
              ? state.completeTaskRuns.map((run) => (run.id === nextRun.id ? nextRun : run))
              : [nextRun, ...state.completeTaskRuns],
            softStoppingRunIds: state.softStoppingRunIds.filter((id) => id !== nextRun.id),
          }
        }),
    }),
    {
      name: 'tengyu-aipod:task-dock',
      storage: createJSONStorage(() => localStorage),
      partialize: ({ expanded }) => ({ expanded }),
    },
  ),
)
