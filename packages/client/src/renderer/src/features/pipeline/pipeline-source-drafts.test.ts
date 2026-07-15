import { describe, expect, it } from 'vitest'
import {
  createPipelineSourceDrafts,
  resetPipelineSourceDraftsForAnotherRun,
  transitionPipelineSourceDraft,
} from './pipeline-source-drafts'

describe('pipeline source session drafts', () => {
  it('restores each source variables without copying values between source drafts', () => {
    const drafts = createPipelineSourceDrafts()
    const collection = {
      ...drafts.collection,
      name: 'collection task',
      printSkuCode: 'COL',
      filenameSeparator: '_',
      printMode: 'full' as const,
      sourceFolder: 'C:/collection',
    }

    const switchedToImg2img = transitionPipelineSourceDraft(
      { ...drafts, collection },
      'collection',
      collection,
      'img2img',
    )

    expect(switchedToImg2img.activeDraft).toEqual({
      ...drafts.img2img,
      referenceImages: [],
    })

    const img2img = {
      ...switchedToImg2img.activeDraft,
      name: 'image task',
      printSkuCode: 'IMG',
      filenameSeparator: '+',
      printMode: 'local' as const,
      sourceFolder: 'C:/references',
      promptRequirement: 'Keep the layout only',
      referenceImages: [
        {
          id: 'reference-1',
          name: 'reference.png',
          dataUrl: 'data:image/png;base64,cmVm',
          base64: 'cmVm',
          mime_type: 'image/png',
        },
      ],
    }
    const switchedBack = transitionPipelineSourceDraft(
      switchedToImg2img.drafts,
      'img2img',
      img2img,
      'collection',
    )

    expect(switchedBack.activeDraft).toEqual(collection)
    expect(switchedBack.drafts.img2img).toEqual(img2img)
    expect(JSON.parse(JSON.stringify(switchedBack))).toEqual(switchedBack)
    expect(switchedBack.drafts.collection).not.toMatchObject({
      sourceFolder: img2img.sourceFolder,
      promptRequirement: img2img.promptRequirement,
      referenceImages: img2img.referenceImages,
    })
  })

  it('clears every current-task variable when creating another run', () => {
    const drafts = createPipelineSourceDrafts()
    const populated = {
      collection: {
        ...drafts.collection,
        name: '采集任务',
        printSkuCode: 'COL',
        sourceFolder: 'C:/采集',
      },
      txt2img: {
        ...drafts.txt2img,
        name: '文生图任务',
        printSkuCode: 'TXT',
        promptRequirement: '圣诞印花',
      },
      img2img: {
        ...drafts.img2img,
        name: '图生图任务',
        printSkuCode: 'IMG',
        sourceFolder: 'C:/参考',
        promptRequirement: '保留构图',
        referenceImages: [
          {
            id: 'reference-1',
            name: 'reference.png',
            dataUrl: 'data:image/png;base64,cmVm',
            base64: 'cmVm',
            mime_type: 'image/png',
          },
        ],
      },
      existing_prints: {
        ...drafts.existing_prints,
        name: '已有印花任务',
        printSkuCode: 'OLD',
        sourceFolder: 'C:/印花',
        startStep: 'detection' as const,
      },
    }

    expect(resetPipelineSourceDraftsForAnotherRun(populated)).toEqual({
      ...createPipelineSourceDrafts(),
      existing_prints: {
        ...createPipelineSourceDrafts().existing_prints,
        startStep: 'detection',
      },
    })
  })
})
