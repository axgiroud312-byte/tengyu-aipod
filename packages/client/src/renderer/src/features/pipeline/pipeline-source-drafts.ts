import type { PipelinePrintMode, PipelineSourceMode, PipelineStartStep } from '@tengyu-aipod/shared'

export type PipelineReferenceImageDraft = {
  id: string
  name: string
  dataUrl: string
  base64: string
  mime_type: string
}

type CommonSourceDraft = {
  name: string
  printSkuCode: string
  filenameSeparator: string
  printMode: PipelinePrintMode
}

export type PipelineSourceDraftMap = {
  collection: CommonSourceDraft & {
    sourceFolder: string
  }
  txt2img: CommonSourceDraft & {
    promptRequirement: string
  }
  img2img: CommonSourceDraft & {
    sourceFolder: string
    promptRequirement: string
    referenceImages: PipelineReferenceImageDraft[]
  }
  existing_prints: CommonSourceDraft & {
    sourceFolder: string
    startStep: PipelineStartStep
  }
}

function commonSourceDraft(): CommonSourceDraft {
  return {
    name: '',
    printSkuCode: '',
    filenameSeparator: '-',
    printMode: 'local',
  }
}

export function createPipelineSourceDrafts(): PipelineSourceDraftMap {
  return {
    collection: {
      ...commonSourceDraft(),
      sourceFolder: '',
    },
    txt2img: {
      ...commonSourceDraft(),
      promptRequirement: '',
    },
    img2img: {
      ...commonSourceDraft(),
      sourceFolder: '',
      promptRequirement: '',
      referenceImages: [],
    },
    existing_prints: {
      ...commonSourceDraft(),
      sourceFolder: '',
      startStep: 'photoshop',
    },
  }
}

export function transitionPipelineSourceDraft<
  CurrentMode extends PipelineSourceMode,
  NextMode extends PipelineSourceMode,
>(
  drafts: PipelineSourceDraftMap,
  currentMode: CurrentMode,
  currentDraft: PipelineSourceDraftMap[CurrentMode],
  nextMode: NextMode,
): {
  drafts: PipelineSourceDraftMap
  activeDraft: PipelineSourceDraftMap[NextMode]
} {
  const nextDrafts = {
    ...drafts,
    [currentMode]: currentDraft,
  }
  return {
    drafts: nextDrafts,
    activeDraft: nextDrafts[nextMode],
  }
}
