import { describe, expect, it } from 'vitest'
import { createPipelineSourceDrafts, transitionPipelineSourceDraft } from './pipeline-source-drafts'

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
})
