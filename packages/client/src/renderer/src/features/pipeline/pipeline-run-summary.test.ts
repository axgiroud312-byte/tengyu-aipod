import type { PipelineRunConfig } from '@tengyu-aipod/shared'
import { describe, expect, it } from 'vitest'
import { buildPipelineRunSummary } from './pipeline-run-summary'

function baseConfig(source: PipelineRunConfig['source']): PipelineRunConfig {
  return {
    name: '夏季新品',
    printSkuCode: 'SUMMER',
    filenameSeparator: '-',
    printMode: 'local',
    source,
    matting: { enabled: false, mode: 'comfyui' },
    detection: { enabled: false },
    photoshop: { enabled: false, templates: [] },
    title: {
      enabled: false,
      platform: 'temu',
      language: 'en',
      model: 'qwen3.6-flash',
    },
  }
}

describe('buildPipelineRunSummary', () => {
  it('summarizes current task variables, stable resources, and expected txt2img output', () => {
    const config = baseConfig({
      mode: 'txt2img',
      provider: 'grsai',
      prompt: {
        mode: 'ai',
        requirement: '复古花卉，不要文字',
        count: 4,
        model: 'qwen3-vl-plus',
        skillId: 'txt2img-local-print',
        skillVersion: '1.0.0',
      },
      grsai: { model: 'gpt-image-2', aspectRatio: '1:1', concurrency: 4 },
    })

    expect(buildPipelineRunSummary(config)).toEqual({
      source: { label: '文生图', detail: 'Grsai · 4 张' },
      stages: [
        { key: 'source', label: '任务起点', state: 'enabled', detail: '文生图' },
        { key: 'matting', label: '抠图', state: 'skipped', detail: '本次跳过' },
        { key: 'detection', label: '侵权检测', state: 'skipped', detail: '本次跳过' },
        { key: 'photoshop', label: 'PS 套版', state: 'skipped', detail: '本次跳过' },
        {
          key: 'title',
          label: '标题生成',
          state: 'locked-skipped',
          detail: '依赖 PS 套版，本次跳过',
        },
      ],
      resources: [
        { label: '提示词模型', value: 'qwen3-vl-plus' },
        { label: '提示词 Skill', value: 'txt2img-local-print@1.0.0' },
        { label: '生图模型', value: 'gpt-image-2' },
      ],
      taskVariables: [
        { label: '任务名', value: '夏季新品' },
        { label: '印花类型', value: '局部印花' },
        { label: '印花要求', value: '复古花卉，不要文字' },
      ],
      expectedOutput: '预计生成 4 张文生图印花，任务在文生图后结束。',
    })
  })

  it('describes the three non-text source contracts and locked existing-print stages', () => {
    const collection = buildPipelineRunSummary(
      baseConfig({
        mode: 'collection',
        sourceFolder: 'C:/采集/夏季',
        extract: {
          provider: 'comfyui-chenyu',
          skillId: 'extract-print',
          comfyui: {
            workflowId: 'wf-extract',
            instanceUuid: 'machine-a',
            width: 1024,
            height: 1024,
            concurrency: 1,
          },
        },
      }),
    )
    expect(collection.source).toEqual({ label: '采集 + 提取', detail: '夏季 · 晨羽智云' })
    expect(collection.resources).toEqual(
      expect.arrayContaining([
        { label: '提取工作流', value: 'wf-extract' },
        { label: '提取运行云机', value: 'machine-a' },
      ]),
    )

    const img2img = buildPipelineRunSummary(
      baseConfig({
        mode: 'img2img',
        provider: 'grsai',
        referenceImages: [
          { name: 'front.png', base64: 'data', mime_type: 'image/png' },
          { name: 'back.png', base64: 'data', mime_type: 'image/png' },
        ],
        prompt: { mode: 'ai', requirement: '保留构图', count: 2, model: 'qwen-vl' },
        sendReferenceImages: true,
        grsai: { model: 'gpt-image-2', aspectRatio: '1:1' },
      }),
    )
    expect(img2img.source).toEqual({ label: '图生图', detail: 'Grsai · 2 张参考图' })

    const existingConfig = baseConfig({
      mode: 'existing_prints',
      printFolder: 'C:/印花/ready',
      startStep: 'detection',
    })
    existingConfig.detection = {
      enabled: true,
      allowReview: false,
      skillId: 'infringement',
      skillVersion: '2',
      model: 'qwen-vl-max',
    }
    const existing = buildPipelineRunSummary(existingConfig)
    expect(existing.source).toEqual({ label: '已有印花', detail: 'ready · 从侵权检测开始' })
    expect(existing.stages).toEqual([
      { key: 'source', label: '任务起点', state: 'enabled', detail: '已有印花' },
      {
        key: 'matting',
        label: '抠图',
        state: 'locked-skipped',
        detail: '当前起始步骤在该阶段之后，本次锁定跳过',
      },
      {
        key: 'detection',
        label: '侵权检测',
        state: 'locked-enabled',
        detail: '本次起始步骤，锁定执行',
      },
      { key: 'photoshop', label: 'PS 套版', state: 'skipped', detail: '本次跳过' },
      {
        key: 'title',
        label: '标题生成',
        state: 'locked-skipped',
        detail: '依赖 PS 套版，本次跳过',
      },
    ])
    expect(existing.expectedOutput).toBe('预计输出侵权检测通过的印花，任务在侵权检测后结束。')
  })

  it('reports PSD and title resources when the fixed tail is enabled', () => {
    const config = baseConfig({
      mode: 'existing_prints',
      printFolder: 'C:/印花/ready',
      startStep: 'photoshop',
    })
    config.photoshop = {
      enabled: true,
      templates: ['C:/PSD/正面.psd', 'C:/PSD/背面.psd'],
      outputRoot: 'C:/上架',
    }
    config.title = {
      enabled: true,
      platform: 'temu',
      language: 'en',
      model: 'qwen3.6-flash',
      titleFileName: '标题',
    }

    const summary = buildPipelineRunSummary(config)
    expect(summary.resources).toEqual(
      expect.arrayContaining([
        { label: 'PSD 模板', value: '正面.psd、背面.psd' },
        { label: '标题设置', value: 'temu · en · qwen3.6-flash' },
      ]),
    )
    expect(summary.expectedOutput).toBe(
      '预计每张进入 PS 的印花按 2 个 PSD 模板生成货号，并逐货号写入标题.xlsx。',
    )
  })

  it('calculates known txt2img and PSD fan-out without treating templates as products', () => {
    const config = baseConfig({
      mode: 'txt2img',
      provider: 'grsai',
      prompt: { mode: 'ai', requirement: '花卉', count: 4 },
      grsai: { model: 'gpt-image-2', aspectRatio: '1:1' },
    })
    config.photoshop = {
      enabled: true,
      templates: ['C:/PSD/正面.psd', 'C:/PSD/背面.psd'],
    }

    expect(buildPipelineRunSummary(config).expectedOutput).toBe(
      '预计生成 8 个货号（4 张印花 × 2 个 PSD 模板），任务在 PS 套版后结束。',
    )
  })
})
