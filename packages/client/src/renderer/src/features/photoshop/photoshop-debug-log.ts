import type { PhotoshopProgressLogEntry, PhotoshopProgressStage } from '@tengyu-aipod/shared'
import { formatTimestamp, levelCounts } from '../../lib/debug-log'

export function photoshopDebugLogLevelCounts(logs: PhotoshopProgressLogEntry[]) {
  return levelCounts(logs)
}

export function formatPhotoshopDebugLogLine(entry: PhotoshopProgressLogEntry) {
  const parts = [
    `[${formatTimestamp(entry.ts)}]`,
    `[${entry.level.toUpperCase()}]`,
    `[${photoshopStageLabel(entry.stage)}]`,
    entry.message ?? photoshopStageLabel(entry.stage),
  ]
  const detailText = photoshopDebugDetailText(entry)
  return detailText ? `${parts.join(' ')} · ${detailText}` : parts.join(' ')
}

function photoshopStageLabel(stage: PhotoshopProgressStage) {
  switch (stage) {
    case 'task_start':
      return '开始'
    case 'template_start':
      return '模板'
    case 'template_open':
      return '打开'
    case 'template_path_profile':
      return '路径'
    case 'native_slice_detected':
      return '切片'
    case 'native_slice_fallback':
      return '切片回退'
    case 'native_slice_export':
      return '切片导出'
    case 'native_slice_export_fallback':
      return '切片回退'
    case 'native_slice_extra_ignored':
      return '切片碎片'
    case 'purge_histories':
      return '清理缓存'
    case 'group_start':
      return '分组'
    case 'jsx_generate':
      return '脚本'
    case 'jsx_exec':
      return '执行'
    case 'so_find':
      return '定位'
    case 'so_replace':
      return '替换'
    case 'so_edit_open':
      return '打开 SO'
    case 'so_inner_place':
      return '内部置入'
    case 'so_edit_save':
      return '保存 SO'
    case 'export_start':
      return '导出'
    case 'export_complete':
      return '导出'
    case 'output_verify':
      return '校验'
    case 'group_complete':
      return '完成'
    case 'task_complete':
      return '结束'
    case 'cancelled':
      return '取消'
    default:
      return '套版'
  }
}

function photoshopDebugDetailText(entry: PhotoshopProgressLogEntry) {
  const parts: string[] = []
  if (entry.task_id) {
    parts.push(`task=${entry.task_id}`)
  }
  if (entry.template_name) {
    parts.push(`模板=${entry.template_name}`)
  }
  if (typeof entry.group === 'number') {
    parts.push(`组=${entry.group + 1}`)
  }
  if (entry.sku_folder) {
    parts.push(`货号=${entry.sku_folder}`)
  }
  if (entry.smart_object) {
    parts.push(`SO=${entry.smart_object}`)
  }
  if (entry.input) {
    parts.push(`输入=${entry.input}`)
  }
  if (entry.replace_mode) {
    parts.push(`替换方式=${entry.replace_mode}`)
  }
  if (entry.inner_layer_path) {
    parts.push(`内部图层=${entry.inner_layer_path}`)
  } else if (entry.inner_layer_name) {
    parts.push(`内部图层=${entry.inner_layer_name}`)
  }
  if (entry.fit_mode) {
    parts.push(`缩放=${entry.fit_mode}`)
  }
  if (entry.output_file) {
    parts.push(`输出=${entry.output_file}`)
  }
  if (typeof entry.attempt === 'number') {
    parts.push(`尝试=${entry.attempt + 1}`)
  }
  if (typeof entry.duration_ms === 'number') {
    parts.push(`耗时=${entry.duration_ms}ms`)
  }
  if (entry.export_path) {
    parts.push(`导出=${entry.export_path}`)
  }
  if (entry.path_tags && entry.path_tags.length > 0) {
    parts.push(`标签=${entry.path_tags.join(',')}`)
  }
  if (typeof entry.native_slice_count === 'number') {
    parts.push(`切片=${entry.native_slice_count}`)
  }
  if (typeof entry.smart_object_count === 'number') {
    parts.push(`SO=${entry.smart_object_count}`)
  }
  if (typeof entry.purge_every_groups === 'number') {
    parts.push(`purge每=${entry.purge_every_groups}组`)
  }
  if (entry.error) {
    parts.push(entry.error)
  }
  return parts.join(' · ')
}
