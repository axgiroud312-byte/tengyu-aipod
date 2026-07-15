import { describe, expect, it } from 'vitest'
import {
  EXECUTION_PLAN_STORAGE_KEY,
  LAST_USED_EXECUTION_PLAN_STORAGE_KEY,
  applyExecutionPlanConfig,
  captureExecutionPlanConfig,
  createExecutionPlan,
  deleteExecutionPlan,
  overwriteExecutionPlan,
  readExecutionPlanDocument,
  readLastUsedExecutionPlanId,
  renameExecutionPlan,
  resolveExecutionPlanProviders,
  saveExecutionPlan,
  validateExecutionPlanConfig,
  validateExecutionPlanReferences,
  writeLastUsedExecutionPlanId,
} from './pipeline-execution-plans'

function memoryStorage() {
  const values = new Map<string, string>()
  return {
    getItem: (key: string) => values.get(key) ?? null,
    removeItem: (key: string) => values.delete(key),
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
  it('derives available Providers from current local model, workflow, and machine options', () => {
    expect(
      resolveExecutionPlanProviders({
        grsaiModels: ['gpt-image-2'],
        comfyuiWorkflows: ['wf-img2img'],
        runningMachineIds: [],
      }),
    ).toEqual(['grsai', 'comfyui-chenyu'])
    expect(
      resolveExecutionPlanProviders({
        grsaiModels: [],
        comfyuiWorkflows: [],
        runningMachineIds: [],
      }),
    ).toEqual([])
  })

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

  it('marks every stale local resource on its relevant stage without changing the saved reference', () => {
    const config = captureExecutionPlanConfig(planInput())
    const available = {
      providers: ['comfyui-chenyu'] as const,
      grsaiModels: ['gpt-image-2'],
      promptModels: ['qwen3-vl-plus'],
      titleModels: ['qwen3.6-flash'],
      detectionModels: ['qwen3-vl-flash'],
      generationSkills: ['extract@@1.0.0', 'prompt@@2.0.0'],
      detectionSkills: ['detect@@1.0.0'],
      txt2imgWorkflows: ['wf-txt2img'],
      img2imgWorkflows: ['wf-img2img'],
      extractWorkflows: ['wf-extract'],
      mattingWorkflows: ['wf-matting'],
      runningMachineIds: ['machine-img2img', 'machine-matting'],
      psdTemplatePaths: ['C:\\mockups\\shirt.psd'],
    }
    const cases = [
      {
        label: 'Provider',
        available: { providers: [] },
        expected: { stage: 'source', field: 'source.img2imgProvider', value: 'comfyui-chenyu' },
      },
      {
        label: '提示词模型',
        config: {
          ...config,
          source: { ...config.source, img2imgComfyuiPromptMode: 'ai' as const },
        },
        available: { promptModels: [] },
        expected: { stage: 'source', field: 'generation.promptModel', value: 'qwen3-vl-plus' },
      },
      {
        label: '提示词 Skill',
        config: {
          ...config,
          source: { ...config.source, img2imgComfyuiPromptMode: 'ai' as const },
        },
        available: { generationSkills: ['extract@@1.0.0'] },
        expected: { stage: 'source', field: 'generation.promptSkillId', value: 'prompt@@2.0.0' },
      },
      {
        label: '图生图工作流',
        available: { img2imgWorkflows: [] },
        expected: {
          stage: 'source',
          field: 'source.img2imgComfyuiWorkflowId',
          value: 'wf-img2img',
        },
      },
      {
        label: '图生图运行云机',
        available: { runningMachineIds: ['machine-matting'] },
        expected: {
          stage: 'source',
          field: 'source.img2imgComfyuiInstanceUuid',
          value: 'machine-img2img',
        },
      },
      {
        label: '抠图工作流',
        available: { mattingWorkflows: [] },
        expected: { stage: 'matting', field: 'matting.workflowId', value: 'wf-matting' },
      },
      {
        label: '检测模型',
        available: { detectionModels: [] },
        expected: { stage: 'detection', field: 'detection.model', value: 'qwen3-vl-flash' },
      },
      {
        label: '检测 Skill',
        available: { detectionSkills: [] },
        expected: { stage: 'detection', field: 'detection.skillKey', value: 'detect@@1.0.0' },
      },
      {
        label: 'PSD 模板',
        available: { psdTemplatePaths: [] },
        expected: {
          stage: 'photoshop',
          field: 'photoshop.templatePaths',
          value: 'C:\\mockups\\shirt.psd',
        },
      },
      {
        label: '标题模型',
        available: { titleModels: [] },
        expected: { stage: 'title', field: 'title.model', value: 'qwen3.6-flash' },
      },
    ] as const

    for (const testCase of cases) {
      const testConfig = 'config' in testCase ? testCase.config : config
      const beforeValidation = structuredClone(testConfig)
      const issues = validateExecutionPlanReferences(testConfig, {
        ...available,
        ...testCase.available,
      })
      expect(issues, testCase.label).toContainEqual({
        ...testCase.expected,
        message: `${testCase.label} ${testCase.expected.value} 已不可用，请重新选择。`,
      })
      expect(testConfig, testCase.label).toEqual(beforeValidation)
    }
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
    expect(document).toEqual({ ok: true, document: { schema_version: 1, plans: [plan] } })
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

    const invalidDocuments = [
      {
        raw: '{not json',
        code: 'corrupt-json',
        message: '执行方案数据已损坏，无法解析。请删除损坏数据后重新保存方案。',
      },
      {
        raw: JSON.stringify({ schema_version: 2, plans: [] }),
        code: 'unsupported-version',
        message: '执行方案数据版本 2 不受支持，请升级 Workbench 或删除后重新保存。',
      },
      {
        raw: JSON.stringify({ schema_version: 1, plans: [{ id: 'broken' }] }),
        code: 'invalid-structure',
        message: '执行方案数据结构无效，请删除损坏数据后重新保存方案。',
      },
    ] as const

    for (const invalidDocument of invalidDocuments) {
      storage.setItem(EXECUTION_PLAN_STORAGE_KEY, invalidDocument.raw)
      expect(readExecutionPlanDocument(storage)).toEqual({
        ok: false,
        error: {
          code: 'INVALID_INPUT',
          message: invalidDocument.message,
          retryable: false,
          details: {
            kind: invalidDocument.code,
            storage_key: EXECUTION_PLAN_STORAGE_KEY,
          },
        },
      })
    }
  })

  it('overwrites, renames, and deletes a plan by id without creating a duplicate', () => {
    const storage = memoryStorage()
    const original = createExecutionPlan('Original', captureExecutionPlanConfig(planInput()), {
      id: 'plan-1',
      createdAt: 1,
    })
    expect(saveExecutionPlan(storage, original)).toMatchObject({ ok: true })

    const replacementConfig = {
      ...original.config,
      generation: { ...original.config.generation, promptCount: '9' },
    }
    expect(overwriteExecutionPlan(storage, 'plan-1', replacementConfig)).toMatchObject({
      ok: true,
    })
    expect(renameExecutionPlan(storage, 'plan-1', 'Renamed')).toMatchObject({ ok: true })

    const renamed = readExecutionPlanDocument(storage)
    expect(renamed).toMatchObject({
      ok: true,
      document: {
        plans: [
          {
            id: 'plan-1',
            name: 'Renamed',
            created_at: 1,
            config: { generation: { promptCount: '9' } },
          },
        ],
      },
    })
    expect(deleteExecutionPlan(storage, 'plan-1')).toEqual({
      ok: true,
      document: { schema_version: 1, plans: [] },
    })
  })

  it('rejects lifecycle writes when persisted data is invalid or the plan is missing', () => {
    const storage = memoryStorage()
    const config = captureExecutionPlanConfig(planInput())
    storage.setItem(EXECUTION_PLAN_STORAGE_KEY, '{broken')

    expect(saveExecutionPlan(storage, createExecutionPlan('Plan', config))).toMatchObject({
      ok: false,
      reason: 'invalid-storage',
    })
    expect(overwriteExecutionPlan(storage, 'missing', config)).toMatchObject({
      ok: false,
      reason: 'invalid-storage',
    })

    storage.setItem(EXECUTION_PLAN_STORAGE_KEY, JSON.stringify({ schema_version: 1, plans: [] }))
    expect(renameExecutionPlan(storage, 'missing', 'Renamed')).toEqual({
      ok: false,
      reason: 'not-found',
    })
    expect(deleteExecutionPlan(storage, 'missing')).toEqual({
      ok: false,
      reason: 'not-found',
    })
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
    const document = readExecutionPlanDocument(storage)
    expect(document.ok ? document.document.plans : []).toHaveLength(5)

    writeLastUsedExecutionPlanId(storage, 'plan-3')
    expect(storage.getItem(LAST_USED_EXECUTION_PLAN_STORAGE_KEY)).toBe('plan-3')
    expect(readLastUsedExecutionPlanId(storage, document.ok ? document.document.plans : [])).toBe(
      'plan-3',
    )
  })
})
