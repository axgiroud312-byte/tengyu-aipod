import { describe, expect, it } from 'vitest'
import type { GenerationDebugLogEntry } from '../../../../main/lib/generation-service'
import { formatGenerationDebugLogLine, generationDebugLogLevelCounts } from './generation-debug-log'

describe('generation debug log formatter', () => {
  it('formats progress details into one terminal line', () => {
    const entry: GenerationDebugLogEntry = {
      id: '1',
      timestamp: new Date('2026-05-31T08:09:10.011Z').getTime(),
      level: 'debug',
      message: '正在处理提示词',
      taskId: 'gen_1',
      capability: 'txt2img',
      details: {
        operation: 'progress',
        processed: 3,
        total: 10,
        succeeded: 2,
        failed: 1,
        prompt: 'centered y2k print',
      },
    }

    expect(formatGenerationDebugLogLine(entry)).toContain('[DEBUG] [文生图] 正在处理提示词')
    expect(formatGenerationDebugLogLine(entry)).toContain('task=gen_1')
    expect(formatGenerationDebugLogLine(entry)).toContain('进度 3/10')
    expect(formatGenerationDebugLogLine(entry)).toContain('centered y2k print')
  })

  it('counts warning and error logs', () => {
    expect(
      generationDebugLogLevelCounts([
        debugEntry('1', 'debug'),
        debugEntry('2', 'warn'),
        debugEntry('3', 'error'),
      ]),
    ).toEqual({ warn: 1, error: 1 })
  })
})

function debugEntry(id: string, level: GenerationDebugLogEntry['level']): GenerationDebugLogEntry {
  return {
    id,
    timestamp: 0,
    level,
    message: 'log',
  }
}
