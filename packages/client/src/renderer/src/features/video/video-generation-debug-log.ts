import type { VideoRuntimeLogEntry } from '../../../../main/lib/video-generation-service'

export function videoDebugLogLevelCounts(logs: VideoRuntimeLogEntry[]) {
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

export function formatVideoDebugLogLine(entry: VideoRuntimeLogEntry) {
  const parts = [
    `[${formatVideoDebugTimestamp(entry.timestamp)}]`,
    `[${entry.level.toUpperCase()}]`,
    `[${entry.mode === 'image-to-video' ? '图生视频' : '参考生视频'}]`,
    entry.message,
  ]
  const detailText = videoDebugDetailText(entry)
  return detailText ? `${parts.join(' ')} · ${detailText}` : parts.join(' ')
}

function formatVideoDebugTimestamp(timestamp: number) {
  const date = new Date(timestamp)
  const pad = (value: number, size = 2) => String(value).padStart(size, '0')
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}.${pad(
    date.getMilliseconds(),
    3,
  )}`
}

function videoDebugDetailText(entry: VideoRuntimeLogEntry) {
  const details = entry.details
  if (!details) {
    return entry.taskId ? `task=${entry.taskId}` : ''
  }
  const parts: string[] = []
  if (entry.taskId) {
    parts.push(`task=${entry.taskId}`)
  }
  if (details.remoteTaskId) {
    parts.push(`remote=${details.remoteTaskId}`)
  }
  if (details.taskStatus) {
    parts.push(`status=${details.taskStatus}`)
  }
  if (details.model) {
    parts.push(`model=${details.model}`)
  }
  if (details.resolution) {
    parts.push(details.resolution)
  }
  if (typeof details.duration === 'number') {
    parts.push(`${details.duration}s`)
  }
  if (details.ratio) {
    parts.push(details.ratio)
  }
  if (typeof details.imageCount === 'number') {
    parts.push(`图片 ${details.imageCount}`)
  }
  if (details.outputPath) {
    parts.push(details.outputPath)
  }
  if (details.videoUrl) {
    parts.push(details.videoUrl)
  }
  if (details.error) {
    parts.push(details.error)
  }
  return parts.join(' · ')
}
