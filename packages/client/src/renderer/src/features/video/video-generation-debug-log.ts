import type { VideoRuntimeLogEntry } from '../../../../main/lib/video-generation-service'
import { formatTimestamp, levelCounts } from '../../lib/debug-log'

export function videoDebugLogLevelCounts(logs: VideoRuntimeLogEntry[]) {
  return levelCounts(logs)
}

export function formatVideoDebugLogLine(entry: VideoRuntimeLogEntry) {
  const parts = [
    `[${formatTimestamp(entry.timestamp)}]`,
    `[${entry.level.toUpperCase()}]`,
    `[${entry.mode === 'image-to-video' ? '图生视频' : '参考生视频'}]`,
    entry.message,
  ]
  const detailText = videoDebugDetailText(entry)
  return detailText ? `${parts.join(' ')} · ${detailText}` : parts.join(' ')
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
