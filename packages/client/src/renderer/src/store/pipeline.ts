import {
  type PipelineSourceDraftMap,
  createPipelineSourceDrafts,
} from '@/features/pipeline/pipeline-source-drafts'
import type { PipelineSourceMode } from '@tengyu-aipod/shared'
import { create } from 'zustand'

type PipelineDraftState = {
  sourceMode: PipelineSourceMode
  sourceDrafts: PipelineSourceDraftMap
  setSourceMode: (sourceMode: PipelineSourceMode) => void
  setSourceDrafts: (sourceDrafts: PipelineSourceDraftMap) => void
}

export const usePipelineDraftStore = create<PipelineDraftState>((set) => ({
  sourceMode: 'collection',
  sourceDrafts: createPipelineSourceDrafts(),
  setSourceMode: (sourceMode) => set({ sourceMode }),
  setSourceDrafts: (sourceDrafts) => set({ sourceDrafts }),
}))
