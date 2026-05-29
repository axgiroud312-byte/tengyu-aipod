import { describe, expect, it } from 'vitest'
import type { CollectionDebugLogEntry } from '../../../../main/lib/collection-session-manager'
import { collectionDebugLogLevelCounts, formatCollectionDebugLogLine } from './collection-debug-log'

describe('collection debug log formatting', () => {
  it('formats download progress like a command line log', () => {
    const entry: CollectionDebugLogEntry = {
      id: 'log-1',
      timestamp: new Date(2026, 0, 1, 10, 37, 56, 123).getTime(),
      level: 'info',
      message: '第 3/20 张成功',
      details: {
        operation: 'download',
        bytes: 420 * 1024,
        durationMs: 1200,
      },
    }

    expect(formatCollectionDebugLogLine(entry)).toBe(
      '[10:37:56.123] [INFO] [下载] 第 3/20 张成功 · 420 KB · 1.2s',
    )
  })

  it('counts warn and error logs for the log button badge', () => {
    expect(
      collectionDebugLogLevelCounts([
        debugEntry('1', 'info'),
        debugEntry('2', 'warn'),
        debugEntry('3', 'error'),
        debugEntry('4', 'error'),
      ]),
    ).toEqual({ warn: 1, error: 2 })
  })
})

function debugEntry(id: string, level: CollectionDebugLogEntry['level']): CollectionDebugLogEntry {
  return {
    id,
    timestamp: 0,
    level,
    message: id,
  }
}
