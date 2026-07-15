import {
  type PipelineSourceDraftMap,
  createPipelineSourceDrafts,
  transitionPipelineSourceDraft,
} from '@/features/pipeline/pipeline-source-drafts'
import type { PipelineSourceMode } from '@tengyu-aipod/shared'
import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'

type PipelineDraftState = {
  sourceMode: PipelineSourceMode
  sourceDrafts: PipelineSourceDraftMap
  switchSourceMode: (sourceMode: PipelineSourceMode) => void
  updateSourceDraft: <Mode extends PipelineSourceMode>(
    sourceMode: Mode,
    draft: PipelineSourceDraftMap[Mode],
  ) => void
  applySourceState: (sourceMode: PipelineSourceMode, sourceDrafts: PipelineSourceDraftMap) => void
}

export const usePipelineDraftStore = create<PipelineDraftState>()(
  persist(
    (set) => ({
      sourceMode: 'collection',
      sourceDrafts: createPipelineSourceDrafts(),
      switchSourceMode: (sourceMode) =>
        set((state) => {
          const transition = transitionPipelineSourceDraft(
            state.sourceDrafts,
            state.sourceMode,
            state.sourceDrafts[state.sourceMode],
            sourceMode,
          )
          return { sourceMode, sourceDrafts: transition.drafts }
        }),
      updateSourceDraft: (sourceMode, draft) =>
        set((state) => ({
          sourceDrafts: {
            ...state.sourceDrafts,
            [sourceMode]: draft,
          },
        })),
      applySourceState: (sourceMode, sourceDrafts) => set({ sourceMode, sourceDrafts }),
    }),
    {
      name: 'tengyu-aipod:pipeline-drafts',
      storage: createJSONStorage(() => sessionStorage),
      partialize: ({ sourceMode, sourceDrafts }) => ({ sourceMode, sourceDrafts }),
    },
  ),
)
