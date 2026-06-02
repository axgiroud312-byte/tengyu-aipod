import type { PhotoshopProgressLogEntry } from '@tengyu-aipod/shared'
import { describe, expect, it } from 'vitest'
import { formatPhotoshopDebugLogLine, photoshopDebugLogLevelCounts } from './photoshop-debug-log'

describe('photoshop debug log formatter', () => {
  it('formats detailed runtime events into one timeline line', () => {
    const entry: PhotoshopProgressLogEntry = {
      ts: new Date('2026-06-02T08:01:02.345Z').getTime(),
      level: 'info',
      stage: 'so_replace',
      message: '替换智能对象',
      task_id: 'ps-task-1',
      template_name: 'mockup',
      group: 2,
      sku_folder: 'group-003',
      smart_object: 'front/SO 1',
      input: 'C:\\prints\\a.png',
      output_file: 'C:\\outputs\\group-003\\mockup\\01.jpg',
      duration_ms: 1234,
    }

    const line = formatPhotoshopDebugLogLine(entry)

    expect(line).toContain('[INFO] [替换]')
    expect(line).toContain('替换智能对象')
    expect(line).toContain('task=ps-task-1')
    expect(line).toContain('模板=mockup')
    expect(line).toContain('组=3')
    expect(line).toContain('货号=group-003')
    expect(line).toContain('SO=front/SO 1')
    expect(line).toContain('耗时=1234ms')
  })

  it('counts warning and error logs', () => {
    expect(
      photoshopDebugLogLevelCounts([
        { ts: 1, level: 'info', stage: 'task_start' },
        { ts: 2, level: 'warn', stage: 'cancelled' },
        { ts: 3, level: 'error', stage: 'group_complete' },
      ]),
    ).toEqual({ warn: 1, error: 1 })
  })
})
