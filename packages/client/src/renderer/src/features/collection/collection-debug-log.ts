import type { CollectionDebugLogEntry } from '../../../../main/lib/collection-session-manager'

export function collectionDebugLogLevelCounts(logs: CollectionDebugLogEntry[]) {
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

export function formatCollectionDebugLogLine(entry: CollectionDebugLogEntry) {
  const parts = [
    `[${formatCollectionDebugTimestamp(entry.timestamp)}]`,
    `[${entry.level.toUpperCase()}]`,
    `[${collectionDebugOperationLabel(entry)}]`,
    entry.message,
  ]
  const detailText = collectionDebugDetailText(entry.details)
  return detailText ? `${parts.join(' ')} · ${detailText}` : parts.join(' ')
}

function formatCollectionDebugTimestamp(timestamp: number) {
  const date = new Date(timestamp)
  const pad = (value: number, size = 2) => String(value).padStart(size, '0')
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}.${pad(
    date.getMilliseconds(),
    3,
  )}`
}

function collectionDebugOperationLabel(entry: CollectionDebugLogEntry) {
  switch (entry.details?.operation) {
    case 'scan':
      return '扫描'
    case 'download':
      return '下载'
    case 'click':
      return '点击'
    case 'session':
      return '会话'
    default:
      return '采集'
  }
}

function collectionDebugDetailText(details: CollectionDebugLogEntry['details']) {
  if (!details) {
    return ''
  }
  const parts: string[] = []
  if (typeof details.bytes === 'number') {
    parts.push(formatCollectionDebugBytes(details.bytes))
  }
  if (typeof details.durationMs === 'number') {
    parts.push(formatCollectionDebugDuration(details.durationMs))
  }
  if (typeof details.added === 'number') {
    parts.push(`新增 ${details.added}`)
  }
  if (typeof details.existing === 'number') {
    parts.push(`已存在 ${details.existing}`)
  }
  if (typeof details.saved === 'number') {
    parts.push(`成功 ${details.saved}`)
  }
  if (typeof details.failed === 'number') {
    parts.push(`失败 ${details.failed}`)
  }
  if (typeof details.total === 'number') {
    parts.push(`总数 ${details.total}`)
  }
  if (typeof details.collectableCount === 'number') {
    parts.push(`可下载 ${details.collectableCount}`)
  }
  if (typeof details.imageCount === 'number') {
    parts.push(`页面图片 ${details.imageCount}`)
  }
  if (typeof details.outputDir === 'string') {
    parts.push(details.outputDir)
  }
  if (typeof details.savedPath === 'string') {
    parts.push(details.savedPath)
  }
  if (typeof details.error === 'string') {
    parts.push(details.error)
  }
  if (typeof details.pageUrl === 'string') {
    parts.push(details.pageUrl)
  }
  return parts.join(' · ')
}

function formatCollectionDebugBytes(bytes: number) {
  if (bytes < 1024 * 1024) {
    return `${Math.max(1, Math.round(bytes / 1024))} KB`
  }
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

function formatCollectionDebugDuration(durationMs: number) {
  if (durationMs < 1000) {
    return `${Math.max(0, Math.round(durationMs))}ms`
  }
  return `${(durationMs / 1000).toFixed(1)}s`
}
