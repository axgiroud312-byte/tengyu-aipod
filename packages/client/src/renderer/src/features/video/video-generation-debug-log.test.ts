import { describe, expect, it } from 'vitest'
import { formatVideoDebugLogLine, videoDebugLogLevelCounts } from './video-generation-debug-log'

describe('video generation debug log', () => {
  it('counts warn and error logs', () => {
    expect(
      videoDebugLogLevelCounts([
        {
          id: '1',
          timestamp: 1,
          level: 'info',
          mode: 'image-to-video',
          message: 'ok',
        },
        {
          id: '2',
          timestamp: 1,
          level: 'warn',
          mode: 'image-to-video',
          message: 'warn',
        },
        {
          id: '3',
          timestamp: 1,
          level: 'error',
          mode: 'reference-to-video',
          message: 'error',
        },
      ]),
    ).toEqual({ warn: 1, error: 1 })
  })

  it('formats a log line with details', () => {
    expect(
      formatVideoDebugLogLine({
        id: '1',
        timestamp: new Date('2026-06-30T12:34:56.789Z').getTime(),
        level: 'info',
        mode: 'image-to-video',
        message: '提交 HappyHorse 任务',
        taskId: 'video_1',
        details: {
          operation: 'submit',
          model: 'happyhorse-1.1-i2v',
          resolution: '720P',
          duration: 5,
        },
      }),
    ).toContain('[INFO] [图生视频] 提交 HappyHorse 任务')
  })
})
