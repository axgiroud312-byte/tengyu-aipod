import { describe, expect, it } from 'vitest'
import {
  EXECUTION_PLAN_STORAGE_KEY,
  LAST_USED_EXECUTION_PLAN_STORAGE_KEY,
  applyExecutionPlanConfig,
  captureExecutionPlanConfig,
  createExecutionPlan,
  readExecutionPlanDocument,
  readLastUsedExecutionPlanId,
  saveExecutionPlan,
  validateExecutionPlanConfig,
  writeLastUsedExecutionPlanId,
} from './pipeline-execution-plans'

function memoryStorage() {
  const values = new Map<string, string>()
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
  }
}

function planInput() {
  return {
    sourceMode: 'img2img' as const,
    existingPrintStartStep: 'detection' as const,
    stages: {
      matting: true,
      detection: true,
      photoshop: true,
      title: true,
    },
    source: {
      extractProvider: 'comfyui-chenyu' as const,
      extractSkillId: 'extract@@1.0.0',
      extractWorkflowId: 'wf-extract',
      extractInstanceUuid: 'machine-extract',
      txt2imgProvider: 'grsai' as const,
      txt2imgComfyuiWorkflowId: 'wf-txt2img',
      txt2imgComfyuiInstanceUuid: 'machine-txt2img',
      img2imgProvider: 'comfyui-chenyu' as const,
      img2imgComfyuiWorkflowId: 'wf-img2img',
      img2imgComfyuiInstanceUuid: 'machine-img2img',
      img2imgComfyuiBatchSize: '3',
      img2imgComfyuiPromptMode: 'workflow' as const,
      img2imgReferenceMode: 'style' as const,
      sendReferenceToImageModel: true,
    },
    generation: {
      promptCount: '6',
      promptSkillId: 'prompt@@2.0.0',
      promptModel: 'qwen3-vl-plus',
      grsaiModel: 'gpt-image-2',
      aspectRatio: '1024x1024',
      grsaiConcurrency: '4',
      width: '1200',
      height: '1400',
    },
    matting: {
      workflowId: 'wf-matting',
      instanceUuid: 'machine-matting',
    },
    detection: {
      passRule: 'pass-only' as const,
      compression: false,
      model: 'qwen3-vl-flash',
      skillKey: 'detect@@1.0.0',
      threshold: { passMax: 25, reviewMax: 60 },
      variables: { marketplace: 'global' },
    },
    photoshop: {
      templatePaths: ['C:\\mockups\\shirt.psd'],
      outputRoot: 'C:\\output',
      skipCompleted: false,
      replaceRange: 'topmost' as const,
      smartObjectReplaceMode: 'replaceContents' as const,
      smartObjectInnerFitMode: 'fill' as const,
      clipMode: 'auto' as const,
      format: 'jpg' as const,
      maxRetries: '2',
    },
    title: {
      platform: 'temu',
      language: 'en',
      model: 'qwen3.6-flash',
      fileName: '标题',
      imageIndex: '1',
      existingStrategy: 'skip' as const,
      maxRetries: '2',
      keywordGroupSeparator: ' ',
      compression: true,
      maxSize: '1024',
    },
    sourceDrafts: {
      collection: {
        name: 'secret task',
        printSkuCode: 'SKU-001',
        filenameSeparator: '_',
        printMode: 'full' as const,
        sourceFolder: 'C:\\source',
      },
      txt2img: {
        name: 'txt task',
        printSkuCode: 'TXT-001',
        filenameSeparator: '-',
        printMode: 'local' as const,
        promptRequirement: 'copyrighted character',
      },
      img2img: {
        name: 'img task',
        printSkuCode: 'IMG-001',
        filenameSeparator: '-',
        printMode: 'local' as const,
        sourceFolder: 'C:\\img2img-source',
        promptRequirement: 'copy this content',
        referenceImages: [
          {
            id: 'reference-1',
            name: 'reference.png',
            dataUrl: 'data:image/png;base64,SECRET_IMAGE',
            base64: 'SECRET_IMAGE',
            mime_type: 'image/png',
          },
        ],
      },
      existing_prints: {
        name: 'prints task',
        printSkuCode: 'OLD-001',
        filenameSeparator: '-',
        printMode: 'local' as const,
        sourceFolder: 'C:\\prints',
        startStep: 'detection' as const,
      },
    },
    apiKey: 'SECRET_API_KEY',
    taskRecords: [{ id: 'task-1' }],
    titleExtraRequirement: 'per-run title content',
    titleKeywordGroups: [{ prefix: 'per-run keyword' }],
  }
}

describe('execution plan persistence', () => {
  it('maps every stable setting while preserving all per-source task variables', () => {
    const input = planInput()
    const currentDrafts = {
      ...input.sourceDrafts,
      existing_prints: { ...input.sourceDrafts.existing_prints, startStep: 'photoshop' as const },
    }

    const application = applyExecutionPlanConfig(captureExecutionPlanConfig(input), currentDrafts)

    expect(application.sourceMode).toBe('img2img')
    expect(application.sourceDrafts).toEqual({
      ...currentDrafts,
      existing_prints: { ...currentDrafts.existing_prints, startStep: 'detection' },
    })
    expect(application.sessionValues).toEqual({
      sendReferenceToImageModel: true,
      txt2imgProvider: 'grsai',
      txt2imgComfyuiWorkflowId: 'wf-txt2img',
      txt2imgComfyuiInstanceUuid: 'machine-txt2img',
      img2imgProvider: 'comfyui-chenyu',
      img2imgComfyuiWorkflowId: 'wf-img2img',
      img2imgComfyuiInstanceUuid: 'machine-img2img',
      img2imgComfyuiBatchSize: '3',
      img2imgComfyuiPromptMode: 'workflow',
      extractProvider: 'comfyui-chenyu',
      img2imgReferenceMode: 'style',
      promptCount: '6',
      promptSkillId: 'prompt@@2.0.0',
      promptModel: 'qwen3-vl-plus',
      grsaiModel: 'gpt-image-2',
      aspectRatio: '1024x1024',
      grsaiConcurrency: '4',
      extractSkillId: 'extract@@1.0.0',
      extractWorkflowId: 'wf-extract',
      extractInstanceUuid: 'machine-extract',
      width: '1200',
      height: '1400',
      mattingEnabled: true,
      mattingWorkflowId: 'wf-matting',
      mattingInstanceUuid: 'machine-matting',
      skipCompleted: false,
      replaceRange: 'topmost',
      smartObjectReplaceMode: 'replaceContents',
      smartObjectInnerFitMode: 'fill',
      clipMode: 'auto',
      format: 'jpg',
      photoshopMaxRetries: '2',
      templatePaths: ['C:\\mockups\\shirt.psd'],
      outputRoot: 'C:\\output',
      photoshopEnabled: true,
      detectionEnabled: true,
      detectionPassRule: 'pass-only',
      detectionCompression: false,
      detectionModel: 'qwen3-vl-flash',
      detectionSkillKey: 'detect@@1.0.0',
      titlePlatform: 'temu',
      titleLanguage: 'en',
      titleModel: 'qwen3.6-flash',
      titleFileName: '标题',
      titleImageIndex: '1',
      titleKeywordGroupSeparator: ' ',
      titleExistingStrategy: 'skip',
      titleMaxRetries: '2',
      titleCompression: true,
      titleMaxSize: '1024',
      titleEnabled: true,
    })
    expect(application.detectionConfig).toEqual({
      threshold: { passMax: 25, reviewMax: 60 },
      skillId: 'detect',
      skillVersion: '1.0.0',
      model: 'qwen3-vl-flash',
      variables: { marketplace: 'global' },
    })
  })

  it('validates stable settings without requiring excluded per-run variables', () => {
    const input = planInput()
    input.sourceDrafts = {
      collection: {
        ...input.sourceDrafts.collection,
        name: '',
        printSkuCode: '',
        sourceFolder: '',
      },
      txt2img: { ...input.sourceDrafts.txt2img, name: '', printSkuCode: '', promptRequirement: '' },
      img2img: {
        ...input.sourceDrafts.img2img,
        name: '',
        printSkuCode: '',
        sourceFolder: '',
        promptRequirement: '',
        referenceImages: [],
      },
      existing_prints: {
        ...input.sourceDrafts.existing_prints,
        name: '',
        printSkuCode: '',
        sourceFolder: '',
      },
    }
    expect(validateExecutionPlanConfig(captureExecutionPlanConfig(input))).toEqual([])
  })

  it('rejects missing stable settings required by the selected source and enabled stages', () => {
    const config = captureExecutionPlanConfig(planInput())
    const invalid = {
      ...config,
      sourceMode: 'collection' as const,
      source: {
        ...config.source,
        extractSkillId: '',
        extractWorkflowId: '',
        extractInstanceUuid: '',
      },
      detection: { ...config.detection, skillKey: '', model: '' },
      photoshop: { ...config.photoshop, templatePaths: [] },
      title: { ...config.title, model: '' },
    }

    expect(validateExecutionPlanConfig(invalid).map((issue) => issue.field)).toEqual([
      'source.extractSkillId',
      'source.extractWorkflowId',
      'source.extractInstanceUuid',
      'detection.model',
      'detection.skillKey',
      'photoshop.templatePaths',
      'title.model',
    ])
  })

  it('captures only stable allowlisted settings and validates schema version 1 on read', () => {
    const storage = memoryStorage()
    const plan = createExecutionPlan(
      'Standard production',
      captureExecutionPlanConfig(planInput()),
      {
        id: 'plan-1',
        createdAt: 1,
      },
    )

    expect(saveExecutionPlan(storage, plan)).toMatchObject({ ok: true })
    const document = readExecutionPlanDocument(storage)
    expect(document).toEqual({ schema_version: 1, plans: [plan] })
    expect(plan.config).toMatchObject({
      sourceMode: 'img2img',
      existingPrintStartStep: 'detection',
      generation: { grsaiConcurrency: '4', width: '1200' },
      detection: {
        model: 'qwen3-vl-flash',
        skillKey: 'detect@@1.0.0',
        threshold: { passMax: 25, reviewMax: 60 },
        variables: { marketplace: 'global' },
      },
      photoshop: { templatePaths: ['C:\\mockups\\shirt.psd'] },
      title: { platform: 'temu', fileName: '标题' },
    })

    const serialized = storage.getItem(EXECUTION_PLAN_STORAGE_KEY) ?? ''
    for (const excluded of [
      'SECRET_API_KEY',
      'SECRET_IMAGE',
      'secret task',
      'SKU-001',
      'C:\\source',
      'C:\\img2img-source',
      'copyrighted character',
      'copy this content',
      'task-1',
      'per-run title content',
      'per-run keyword',
      'filenameSeparator',
      'printMode',
      'referenceImages',
    ]) {
      expect(serialized).not.toContain(excluded)
    }

    storage.setItem(EXECUTION_PLAN_STORAGE_KEY, JSON.stringify({ schema_version: 2, plans: [] }))
    expect(readExecutionPlanDocument(storage)).toBeNull()
  })

  it('keeps at most five plans and persists the last used plan separately', () => {
    const storage = memoryStorage()
    const config = captureExecutionPlanConfig(planInput())
    for (let index = 1; index <= 5; index += 1) {
      expect(
        saveExecutionPlan(
          storage,
          createExecutionPlan(`Plan ${index}`, config, { id: `plan-${index}`, createdAt: index }),
        ),
      ).toMatchObject({ ok: true })
    }

    expect(
      saveExecutionPlan(
        storage,
        createExecutionPlan('Plan 6', config, { id: 'plan-6', createdAt: 6 }),
      ),
    ).toEqual({ ok: false, reason: 'limit' })
    expect(readExecutionPlanDocument(storage)?.plans).toHaveLength(5)

    writeLastUsedExecutionPlanId(storage, 'plan-3')
    expect(storage.getItem(LAST_USED_EXECUTION_PLAN_STORAGE_KEY)).toBe('plan-3')
    expect(
      readLastUsedExecutionPlanId(storage, readExecutionPlanDocument(storage)?.plans ?? []),
    ).toBe('plan-3')
  })
})
