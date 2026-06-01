import type { GenerationDebugLogEntry } from '../../../../main/lib/generation-service'

export function generationDebugLogLevelCounts(logs: GenerationDebugLogEntry[]) {
  return logs.reduce(
    (counts, item) => {
      if (item.level === 'warn') {
        counts.warn += 1
      }
      if (item.level === 'error') {
        counts.error += 1
      }
      return counts
    },
    { warn: 0, error: 0 },
  )
}

export function formatGenerationDebugLogLine(entry: GenerationDebugLogEntry) {
  const parts = [
    `[${formatGenerationDebugTimestamp(entry.timestamp)}]`,
    `[${entry.level.toUpperCase()}]`,
    `[${generationDebugCapabilityLabel(entry)}]`,
    entry.message,
  ]
  const detailText = generationDebugDetailText(entry)
  return detailText ? `${parts.join(' ')} · ${detailText}` : parts.join(' ')
}

function formatGenerationDebugTimestamp(timestamp: number) {
  const date = new Date(timestamp)
  const pad = (value: number, size = 2) => String(value).padStart(size, '0')
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}.${pad(
    date.getMilliseconds(),
    3,
  )}`
}

function generationDebugCapabilityLabel(entry: GenerationDebugLogEntry) {
  switch (entry.capability) {
    case 'txt2img':
      return '文生图'
    case 'img2img':
      return '图生图'
    case 'extract':
      return '提取'
    case 'matting':
      return '抠图'
    default:
      return generationDebugOperationLabel(entry)
  }
}

function generationDebugOperationLabel(entry: GenerationDebugLogEntry) {
  switch (entry.details?.operation) {
    case 'prompt':
      return '提示词'
    case 'submit':
      return '提交'
    case 'request':
      return '请求'
    case 'progress':
      return '进度'
    case 'completed':
      return '结果'
    default:
      return '生图'
  }
}

function generationDebugDetailText(entry: GenerationDebugLogEntry) {
  const details = entry.details
  if (!details) {
    return entry.taskId ? `task=${entry.taskId}` : ''
  }
  const parts: string[] = []
  if (entry.taskId) {
    parts.push(`task=${entry.taskId}`)
  }
  if (typeof details.provider === 'string') {
    parts.push(details.provider)
  }
  if (typeof details.model === 'string') {
    parts.push(`model=${details.model}`)
  }
  if (typeof details.responseModel === 'string') {
    parts.push(`返回模型=${details.responseModel}`)
  }
  if (typeof details.skillId === 'string') {
    parts.push(`skill=${details.skillId}`)
  }
  if (typeof details.skillCategory === 'string') {
    parts.push(`skill=${details.skillCategory}`)
  }
  if (typeof details.skillVersion === 'string') {
    parts.push(`skillVersion=${details.skillVersion}`)
  }
  if (typeof details.workflowName === 'string') {
    parts.push(`workflow=${details.workflowName}`)
  }
  if (typeof details.workflowVersion === 'string') {
    parts.push(`version=${details.workflowVersion}`)
  }
  if (typeof details.workflowId === 'string') {
    parts.push(
      typeof details.workflowName === 'string'
        ? `workflowId=${details.workflowId}`
        : `workflow=${details.workflowId}`,
    )
  }
  if (typeof details.count === 'number') {
    parts.push(`数量 ${details.count}`)
  }
  if (typeof details.total === 'number') {
    const processed = typeof details.processed === 'number' ? details.processed : null
    parts.push(processed === null ? `总数 ${details.total}` : `进度 ${processed}/${details.total}`)
  }
  if (typeof details.sourceCount === 'number') {
    parts.push(`源图 ${details.sourceCount}`)
  }
  if (typeof details.sourceIndex === 'number') {
    parts.push(`第 ${details.sourceIndex} 项`)
  }
  if (typeof details.sourceImage === 'string') {
    parts.push(`源图=${details.sourceImage}`)
  }
  if (typeof details.promptIndex === 'number') {
    parts.push(`第 ${details.promptIndex} 条`)
  }
  if (typeof details.succeeded === 'number') {
    parts.push(`成功 ${details.succeeded}`)
  }
  if (typeof details.failed === 'number') {
    parts.push(`失败 ${details.failed}`)
  }
  if (typeof details.concurrency === 'number') {
    parts.push(`并发 ${details.concurrency}`)
  }
  if (typeof details.referenceImageCount === 'number') {
    parts.push(`参考图 ${details.referenceImageCount}`)
  }
  if (typeof details.width === 'number' && typeof details.height === 'number') {
    parts.push(`${details.width}x${details.height}`)
  }
  if (typeof details.aspectRatio === 'string') {
    parts.push(details.aspectRatio)
  }
  if (typeof details.requirement === 'string') {
    parts.push(`需求=${details.requirement}`)
  }
  if (typeof details.prompt === 'string') {
    parts.push(details.prompt)
  }
  if (typeof details.savedPath === 'string') {
    parts.push(details.savedPath)
  }
  if (typeof details.error === 'string') {
    parts.push(details.error)
  }
  if (typeof details.expected === 'number' || typeof details.actual === 'number') {
    parts.push(`期望 ${details.expected ?? '-'} / 实际 ${details.actual ?? '-'}`)
  }
  if (typeof details.finishReason === 'string') {
    parts.push(`finish=${details.finishReason}`)
  }
  if (typeof details.rawResponsePreview === 'string') {
    parts.push(`原始返回=${details.rawResponsePreview}`)
  }
  return parts.join(' · ')
}
