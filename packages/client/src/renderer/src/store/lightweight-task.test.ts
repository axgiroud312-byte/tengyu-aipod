import { describe, expect, it } from 'vitest'
import type { CollectionSessionEvent } from '../../../main/lib/collection-session-manager'
import {
  lightweightTaskFromCollectionEvent,
  lightweightTaskFromDetectionCompleted,
  lightweightTaskFromDetectionProgress,
  lightweightTaskFromGenerationCompleted,
  lightweightTaskFromGenerationProgress,
  lightweightTaskFromListingProgress,
  lightweightTaskFromPhotoshopLog,
  lightweightTaskFromPhotoshopProgress,
  lightweightTaskFromTitleCompleted,
  lightweightTaskFromTitleProgress,
  lightweightTaskFromVideoCompleted,
  lightweightTaskFromVideoProgress,
  mergeLightweightTaskSummary,
} from './lightweight-task'

const session = {
  id: 'collection-session-1',
  platform: 'temu',
  profile_id: 'profile-1',
  mode: 'click' as const,
  status: 'active' as const,
  output_dir: 'C:\\workbench\\01-采集工作区\\temu-run',
  started_at: 100,
}

describe('lightweight task public event adapters', () => {
  it('tracks a collection session and only shows a proven pause reason', () => {
    const started = lightweightTaskFromCollectionEvent({ type: 'session-started', session }, 1_000)
    expect(started).toMatchObject({
      id: 'collection:collection-session-1',
      module: 'collection',
      route: '/collection',
      status: 'running',
      title: '采集任务',
      updatedAt: 1_000,
    })
    expect(started).not.toHaveProperty('waitingReason')

    expect(
      lightweightTaskFromCollectionEvent(
        {
          type: 'session-paused',
          session: { ...session, status: 'paused', pause_reason: 'browser_closed' },
          reason: 'browser_closed',
        },
        2_000,
      ),
    ).toMatchObject({
      status: 'waiting',
      waitingReason: '比特浏览器已关闭，请重新打开后继续采集',
    })

    const resumed = lightweightTaskFromCollectionEvent({ type: 'session-resumed', session }, 3_000)
    const paused = lightweightTaskFromCollectionEvent(
      {
        type: 'session-paused',
        session: { ...session, status: 'paused', pause_reason: 'browser_closed' },
        reason: 'browser_closed',
      },
      2_000,
    )
    expect(resumed).toMatchObject({ status: 'running' })
    expect(paused).not.toBeNull()
    if (!paused || !resumed) {
      throw new Error('Expected collection lifecycle events to create task summaries')
    }
    expect(mergeLightweightTaskSummary(paused, resumed)).not.toHaveProperty('waitingReason')

    expect(
      lightweightTaskFromCollectionEvent(
        { type: 'session-stopped', session: { ...session, status: 'completed' } },
        4_000,
      ),
    ).toMatchObject({ status: 'completed' })

    const ignored: CollectionSessionEvent = {
      type: 'debug-log',
      entry: { id: 'log-1', timestamp: 1, level: 'info', message: 'scanning' },
    }
    expect(lightweightTaskFromCollectionEvent(ignored, 5_000)).toBeNull()
  })

  it('uses only generation progress and completion counts exposed by public events', () => {
    expect(
      lightweightTaskFromGenerationProgress(
        {
          task_id: 'generation-1',
          capability: 'img2img',
          processed: 3,
          total: 8,
          succeeded: 2,
          failed: 1,
        },
        1_000,
      ),
    ).toMatchObject({
      id: 'generation:generation-1',
      module: 'generation',
      route: '/generation',
      status: 'running',
      title: '图生图任务',
      counts: { finished: 3, total: 8, failed: 1 },
    })

    expect(
      lightweightTaskFromGenerationCompleted(
        {
          ok: true,
          result: {
            taskId: 'generation-1',
            total: 8,
            succeeded: 7,
            failed: 1,
            images: [],
            failures: [],
          },
        },
        2_000,
      ),
    ).toMatchObject({
      status: 'completed',
      counts: { finished: 8, total: 8, failed: 1 },
    })

    expect(
      lightweightTaskFromGenerationCompleted(
        { ok: false, taskId: 'generation-2', error: 'provider unavailable' },
        3_000,
      ),
    ).toMatchObject({
      id: 'generation:generation-2',
      status: 'failed',
      title: '生图任务',
    })
  })

  it('tracks detection status and counts without retaining image payloads', () => {
    expect(
      lightweightTaskFromDetectionProgress(
        {
          task_id: 'detection-1',
          processed: 4,
          total: 10,
          succeeded: 3,
          failed: 1,
          skipped: 0,
          current_image: 'C:\\private\\print.png',
        },
        1_000,
      ),
    ).toEqual({
      id: 'detection:detection-1',
      module: 'detection',
      route: '/detection',
      status: 'running',
      title: '侵权检测任务',
      updatedAt: 1_000,
      counts: { finished: 4, total: 10, failed: 1 },
    })

    expect(
      lightweightTaskFromDetectionCompleted(
        {
          ok: false,
          taskId: 'detection-1',
          error: 'model unavailable',
        },
        2_000,
      ),
    ).toMatchObject({ status: 'failed' })
  })

  it('tracks title progress and terminal status from public events', () => {
    expect(
      lightweightTaskFromTitleProgress(
        {
          task_id: 'title-1',
          processed: 6,
          total: 12,
          succeeded: 5,
          failed: 1,
          skipped: 0,
        },
        1_000,
      ),
    ).toMatchObject({
      id: 'title:title-1',
      module: 'title',
      route: '/title',
      status: 'running',
      title: '标题生成任务',
      counts: { finished: 6, total: 12, failed: 1 },
    })

    expect(
      lightweightTaskFromTitleCompleted(
        {
          ok: true,
          result: {
            taskId: 'title-1',
            xlsxPath: 'C:\\private\\标题.xlsx',
            total: 12,
            succeeded: 5,
            failed: 1,
            skipped: 0,
            results: [],
            cancelled: true,
          },
        },
        2_000,
      ),
    ).toMatchObject({
      status: 'cancelled',
      counts: { finished: 6, total: 12, failed: 1 },
    })
  })

  it('shows a listing resource wait only when the structured error proves it', () => {
    const progress = {
      batchId: 'listing-1',
      profileId: 'profile-7',
      status: 'failed' as const,
      totalCount: 20,
      finishedCount: 3,
      lastError: {
        code: 'PROFILE_LOCKED' as const,
        appErrorCode: 'PROFILE_LOCKED' as const,
        message: 'profile occupied',
        retryable: false,
        stage: 'enter_page' as const,
        url: 'https://private.example/listing',
      },
    }
    expect(lightweightTaskFromListingProgress(progress, 1_000)).toEqual({
      id: 'listing:listing-1',
      module: 'listing',
      route: '/listing',
      status: 'waiting',
      title: '上架任务',
      updatedAt: 1_000,
      waitingReason: '比特浏览器环境 profile-7 被占用，请先结束冲突的采集或上架任务',
      counts: { finished: 3, total: 20 },
    })

    expect(
      lightweightTaskFromListingProgress(
        {
          ...progress,
          profileId: 'profile-8',
          currentSku: 'SKU-1',
          lastError: { ...progress.lastError, code: 'PUBLISH_FAILED', appErrorCode: 'HTTP_4XX' },
        },
        2_000,
      ),
    ).toMatchObject({
      id: 'listing:listing-1',
      status: 'running',
      hasException: true,
    })

    expect(
      lightweightTaskFromListingProgress(
        {
          ...progress,
          profileId: 'profile-8',
          lastError: {
            ...progress.lastError,
            code: 'BROWSER_NOT_CONNECTED',
            appErrorCode: 'BROWSER_NOT_CONNECTED',
          },
        },
        2_500,
      ),
    ).toMatchObject({ status: 'failed', hasException: true })

    expect(
      lightweightTaskFromListingProgress(
        {
          batchId: progress.batchId,
          profileId: 'profile-9',
          status: 'success',
          totalCount: progress.totalCount,
          finishedCount: 4,
        },
        3_000,
      ),
    ).toMatchObject({ status: 'running' })

    const failedItem = lightweightTaskFromListingProgress(
      {
        ...progress,
        currentSku: 'SKU-1',
        lastError: { ...progress.lastError, code: 'PUBLISH_FAILED', appErrorCode: 'HTTP_4XX' },
      },
      4_000,
    )
    const nextItem = lightweightTaskFromListingProgress(
      {
        batchId: progress.batchId,
        profileId: 'profile-9',
        status: 'uploading',
        totalCount: progress.totalCount,
        finishedCount: 4,
      },
      5_000,
    )
    expect(mergeLightweightTaskSummary(failedItem, nextItem)).toMatchObject({
      id: 'listing:listing-1',
      status: 'running',
      hasException: true,
      counts: { finished: 4, total: 20 },
    })
    expect(
      mergeLightweightTaskSummary(lightweightTaskFromListingProgress(progress, 1_000), nextItem),
    ).toMatchObject({
      status: 'running',
      waitingReason: '比特浏览器环境 profile-7 被占用，请先结束冲突的采集或上架任务',
    })

    const restarted = lightweightTaskFromListingProgress(
      {
        batchId: progress.batchId,
        profileId: '',
        status: 'pending',
        totalCount: progress.totalCount,
        finishedCount: 0,
      },
      6_000,
    )
    expect(
      mergeLightweightTaskSummary(
        mergeLightweightTaskSummary(
          lightweightTaskFromListingProgress(progress, 1_000),
          failedItem,
        ),
        restarted,
      ),
    ).toEqual(restarted)
  })

  it('uses Photoshop progress as the only lifecycle contract', () => {
    const progress = {
      task_id: 'photoshop-1',
      total_groups: 6,
      completed: 2,
      failed: 1,
      skipped: 0,
      current_group: 4,
      current_stage: 'group_start' as const,
      verified_outputs: 4,
    }
    expect(lightweightTaskFromPhotoshopProgress(progress, 1_000)).toMatchObject({
      id: 'photoshop:photoshop-1',
      module: 'photoshop',
      route: '/photoshop',
      status: 'running',
      title: 'PS 套版任务',
      counts: { finished: 3, total: 6, failed: 1 },
    })
    expect(
      lightweightTaskFromPhotoshopProgress(
        { ...progress, completed: 5, current_stage: 'task_complete' },
        2_000,
      ),
    ).toMatchObject({ status: 'completed' })
    expect(
      lightweightTaskFromPhotoshopProgress({ ...progress, current_stage: 'cancelled' }, 3_000),
    ).toMatchObject({ status: 'cancelled' })

    expect(
      lightweightTaskFromPhotoshopLog(
        {
          ts: 4_000,
          level: 'error',
          stage: 'group_complete',
          task_id: 'photoshop-1',
          message: 'Photoshop 执行失败',
        },
        4_000,
      ),
    ).toMatchObject({
      id: 'photoshop:photoshop-1',
      status: 'failed',
      title: 'PS 套版任务',
    })
  })

  it('maps video lifecycle without treating remote pending as a resource wait', () => {
    expect(
      lightweightTaskFromVideoProgress(
        {
          task_id: 'video-1',
          mode: 'reference-to-video',
          status: 'pending',
          message: 'remote pending',
          videoUrl: 'https://private.example/video.mp4',
        },
        1_000,
      ),
    ).toEqual({
      id: 'video:video-1',
      module: 'video',
      route: '/video',
      status: 'running',
      title: '参考生视频任务',
      updatedAt: 1_000,
    })

    expect(
      lightweightTaskFromVideoCompleted(
        {
          ok: false,
          task_id: 'video-1',
          mode: 'reference-to-video',
          error: 'quota exceeded',
        },
        2_000,
      ),
    ).toMatchObject({ status: 'failed' })
  })
})
