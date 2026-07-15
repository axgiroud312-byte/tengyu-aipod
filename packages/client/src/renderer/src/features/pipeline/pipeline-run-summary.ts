import type { PipelineRunConfig, PipelineStartStep } from '@tengyu-aipod/shared'
import type { PipelineConfigStage } from './types'

export type PipelineRunSummaryStageState =
  | 'enabled'
  | 'skipped'
  | 'locked-enabled'
  | 'locked-skipped'

export type PipelineRunSummary = {
  source: { label: string; detail: string }
  stages: Array<{
    key: PipelineConfigStage
    label: string
    state: PipelineRunSummaryStageState
    detail: string
  }>
  resources: Array<{ label: string; value: string }>
  taskVariables: Array<{ label: string; value: string }>
  expectedOutput: string
}

const sourceLabels: Record<PipelineRunConfig['source']['mode'], string> = {
  collection: '采集 + 提取',
  txt2img: '文生图',
  img2img: '图生图',
  existing_prints: '已有印花',
}

const startStepLabels: Record<PipelineStartStep, string> = {
  matting: '抠图',
  detection: '侵权检测',
  photoshop: 'PS 套版',
}

function providerLabel(provider: 'grsai' | 'comfyui-chenyu') {
  return provider === 'grsai' ? 'Grsai' : '晨羽智云'
}

function finalPathPart(path: string) {
  return path.split(/[\\/]/).filter(Boolean).at(-1) ?? path
}

function skillValue(id: string, version?: string) {
  return version ? `${id}@${version}` : id
}

function sourceSummary(config: PipelineRunConfig): PipelineRunSummary['source'] {
  const source = config.source
  if (source.mode === 'collection') {
    return {
      label: sourceLabels.collection,
      detail: `${finalPathPart(source.sourceFolder)} · ${providerLabel(source.extract.provider)}`,
    }
  }
  if (source.mode === 'txt2img') {
    const count =
      source.prompt.mode === 'ai' ? source.prompt.count : (source.prompt.prompts?.length ?? 0)
    return {
      label: sourceLabels.txt2img,
      detail: `${providerLabel(source.provider)} · ${count} 张`,
    }
  }
  if (source.mode === 'img2img') {
    const input =
      source.provider === 'grsai'
        ? `${source.referenceImages?.length ?? 0} 张参考图`
        : finalPathPart(source.sourceFolder)
    return { label: sourceLabels.img2img, detail: `${providerLabel(source.provider)} · ${input}` }
  }
  return {
    label: sourceLabels.existing_prints,
    detail: `${finalPathPart(source.printFolder)} · 从${startStepLabels[source.startStep ?? 'photoshop']}开始`,
  }
}

function optionalStage(
  key: Exclude<PipelineConfigStage, 'source'>,
  label: string,
  enabled: boolean,
): PipelineRunSummary['stages'][number] {
  return {
    key,
    label,
    state: enabled ? 'enabled' : 'skipped',
    detail: enabled ? '本次执行' : '本次跳过',
  }
}

function stageSummary(config: PipelineRunConfig): PipelineRunSummary['stages'] {
  const stages: PipelineRunSummary['stages'] = [
    {
      key: 'source',
      label: '任务起点',
      state: 'enabled',
      detail: sourceLabels[config.source.mode],
    },
    optionalStage('matting', '抠图', config.matting.enabled),
    optionalStage('detection', '侵权检测', config.detection.enabled),
    optionalStage('photoshop', 'PS 套版', Boolean(config.photoshop.enabled)),
    optionalStage('title', '标题生成', Boolean(config.title.enabled)),
  ]

  if (config.source.mode === 'existing_prints') {
    const orderedStartSteps: PipelineStartStep[] = ['matting', 'detection', 'photoshop']
    const startIndex = orderedStartSteps.indexOf(config.source.startStep ?? 'photoshop')
    for (let index = 0; index <= startIndex; index += 1) {
      const stageKey = orderedStartSteps[index]
      const stage = stages.find((item) => item.key === stageKey)
      if (!stage) {
        continue
      }
      if (index === startIndex) {
        stage.state = 'locked-enabled'
        stage.detail = '本次起始步骤，锁定执行'
      } else {
        stage.state = 'locked-skipped'
        stage.detail = '当前起始步骤在该阶段之后，本次锁定跳过'
      }
    }
  }

  if (!config.photoshop.enabled) {
    const title = stages.find((stage) => stage.key === 'title')
    if (title) {
      title.state = 'locked-skipped'
      title.detail = '依赖 PS 套版，本次跳过'
    }
  }
  return stages
}

function sourceResources(config: PipelineRunConfig) {
  const resources: PipelineRunSummary['resources'] = []
  const source = config.source
  if (source.mode === 'collection') {
    if (source.extract.skillId) {
      resources.push({
        label: '提取 Skill',
        value: skillValue(source.extract.skillId, source.extract.skillVersion),
      })
    }
    if (source.extract.provider === 'grsai') {
      resources.push({ label: '提取模型', value: source.extract.grsai?.model ?? '未选择' })
    } else {
      resources.push({
        label: '提取工作流',
        value: source.extract.comfyui?.workflowId ?? '未选择',
      })
      if (source.extract.comfyui?.instanceUuid) {
        resources.push({ label: '提取运行云机', value: source.extract.comfyui.instanceUuid })
      }
    }
  }
  if (source.mode === 'txt2img' || source.mode === 'img2img') {
    if (source.prompt?.mode === 'ai') {
      if (source.prompt.model) {
        resources.push({ label: '提示词模型', value: source.prompt.model })
      }
      if (source.prompt.skillId) {
        resources.push({
          label: '提示词 Skill',
          value: skillValue(source.prompt.skillId, source.prompt.skillVersion),
        })
      }
    }
    if (source.provider === 'grsai') {
      resources.push({ label: '生图模型', value: source.grsai?.model ?? '未选择' })
    } else {
      resources.push({ label: '生图工作流', value: source.comfyui.workflowId })
      if (source.comfyui.instanceUuid) {
        resources.push({ label: '生图运行云机', value: source.comfyui.instanceUuid })
      }
    }
  }
  return resources
}

function resourcesSummary(config: PipelineRunConfig) {
  const resources = sourceResources(config)
  if (config.matting.enabled) {
    if (config.matting.workflowId) {
      resources.push({ label: '抠图工作流', value: config.matting.workflowId })
    }
    if (config.matting.instanceUuid) {
      resources.push({ label: '抠图运行云机', value: config.matting.instanceUuid })
    }
  }
  if (config.detection.enabled) {
    if (config.detection.model) {
      resources.push({ label: '检测模型', value: config.detection.model })
    }
    if (config.detection.skillId) {
      resources.push({
        label: '检测 Skill',
        value: skillValue(config.detection.skillId, config.detection.skillVersion),
      })
    }
  }
  if (config.photoshop.enabled) {
    resources.push({
      label: 'PSD 模板',
      value: config.photoshop.templates.map(finalPathPart).join('、'),
    })
  }
  if (config.title.enabled) {
    resources.push({
      label: '标题设置',
      value: `${config.title.platform} · ${config.title.language} · ${config.title.model}`,
    })
  }
  return resources
}

function taskVariableSummary(config: PipelineRunConfig) {
  const variables: PipelineRunSummary['taskVariables'] = []
  if (config.name) {
    variables.push({ label: '任务名', value: config.name })
  }
  variables.push({ label: '印花类型', value: config.printMode === 'local' ? '局部印花' : '满印' })
  if (config.photoshop.enabled && config.printSkuCode) {
    variables.push({ label: '印花货号', value: config.printSkuCode })
    variables.push({ label: '文件名分隔符', value: config.filenameSeparator ?? '-' })
  }
  if (config.source.mode === 'collection') {
    variables.push({ label: '采集文件夹', value: config.source.sourceFolder })
  }
  if (config.source.mode === 'existing_prints') {
    variables.push({ label: '已有印花文件夹', value: config.source.printFolder })
  }
  if (config.source.mode === 'img2img' && config.source.provider === 'comfyui-chenyu') {
    variables.push({ label: '图片文件夹', value: config.source.sourceFolder })
  }
  if (config.source.mode === 'img2img' && config.source.provider === 'grsai') {
    const referenceNames = config.source.referenceImages?.map((image) => image.name) ?? []
    if (referenceNames.length > 0) {
      variables.push({ label: '参考图片', value: referenceNames.join('、') })
    }
  }
  if (
    (config.source.mode === 'txt2img' || config.source.mode === 'img2img') &&
    config.source.prompt?.mode === 'ai'
  ) {
    variables.push({ label: '印花要求', value: config.source.prompt.requirement ?? '' })
  }
  return variables
}

function knownSourcePrintCount(config: PipelineRunConfig): number | null {
  if (config.source.mode !== 'txt2img') {
    return null
  }
  return config.source.prompt.mode === 'ai'
    ? (config.source.prompt.count ?? 0)
    : (config.source.prompt.prompts?.length ?? 0)
}

function titleFileLabel(config: PipelineRunConfig) {
  const fileName = config.title.titleFileName?.trim() || '标题'
  return fileName.toLowerCase().endsWith('.xlsx') ? fileName : `${fileName}.xlsx`
}

function expectedOutput(config: PipelineRunConfig) {
  if (config.photoshop.enabled) {
    const templateCount = config.photoshop.templates.length
    const sourcePrintCount = knownSourcePrintCount(config)
    const titleSuffix = config.title.enabled
      ? `，并逐货号写入${titleFileLabel(config)}。`
      : '，任务在 PS 套版后结束。'
    if (sourcePrintCount !== null && !config.detection.enabled) {
      return `预计生成 ${sourcePrintCount * templateCount} 个货号（${sourcePrintCount} 张印花 × ${templateCount} 个 PSD 模板）${titleSuffix}`
    }
    if (sourcePrintCount !== null) {
      return `预计最多生成 ${sourcePrintCount * templateCount} 个货号（${sourcePrintCount} 张印花 × ${templateCount} 个 PSD 模板），侵权检测未通过的印花不会进入 PS 套版${titleSuffix}`
    }
    return `预计每张进入 PS 的印花按 ${templateCount} 个 PSD 模板生成货号${titleSuffix}`
  }
  if (config.detection.enabled) {
    return '预计输出侵权检测通过的印花，任务在侵权检测后结束。'
  }
  if (config.matting.enabled) {
    return '预计输出抠图印花，任务在抠图后结束。'
  }
  if (config.source.mode === 'txt2img') {
    const count =
      config.source.prompt.mode === 'ai'
        ? config.source.prompt.count
        : (config.source.prompt.prompts?.length ?? 0)
    return `预计生成 ${count} 张文生图印花，任务在文生图后结束。`
  }
  if (config.source.mode === 'img2img') {
    return '预计输出图生图印花，任务在图生图后结束。'
  }
  if (config.source.mode === 'collection') {
    return '预计从采集原图提取印花，任务在提取后结束。'
  }
  return '本次使用已有印花作为来源，不产生新的后续产物。'
}

export function buildPipelineRunSummary(config: PipelineRunConfig): PipelineRunSummary {
  return {
    source: sourceSummary(config),
    stages: stageSummary(config),
    resources: resourcesSummary(config),
    taskVariables: taskVariableSummary(config),
    expectedOutput: expectedOutput(config),
  }
}
