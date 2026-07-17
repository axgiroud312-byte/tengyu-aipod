import type { ListingProgress, PhotoshopProgressInfo } from '@tengyu-aipod/shared'
import type { PhotoshopProgressLogEntry } from '@tengyu-aipod/shared'
import type { CollectionSessionEvent } from '../../../main/lib/collection-session-manager'
import type { DetectionProgress, DetectionTaskEvent } from '../../../main/lib/detection-service'
import type { GenerationProgress, GenerationTaskEvent } from '../../../main/lib/generation-service'
import type { TitleProgress, TitleTaskEvent } from '../../../main/lib/title-service'
import type {
  VideoCompletedEvent,
  VideoProgressEvent,
} from '../../../main/lib/video-generation-service'

export type LightweightTaskStatus = 'running' | 'waiting' | 'completed' | 'failed' | 'cancelled'

export type LightweightTaskModule =
  | 'collection'
  | 'generation'
  | 'detection'
  | 'photoshop'
  | 'title'
  | 'listing'
  | 'video'

export type LightweightTaskSummary = {
  id: string
  module: LightweightTaskModule
  route: string
  status: LightweightTaskStatus
  startsNewRun?: boolean
  title: string
  updatedAt: number
  hasException?: boolean
  waitingReason?: string
  counts?: {
    finished: number
    total: number
    failed?: number
  }
}

export function mergeLightweightTaskSummary(
  current: LightweightTaskSummary,
  next: LightweightTaskSummary,
): LightweightTaskSummary {
  if (next.startsNewRun) {
    return next
  }
  const counts = next.counts ?? current.counts
  const waitingReason =
    next.status === 'completed' || next.status === 'failed' || next.status === 'cancelled'
      ? undefined
      : (next.waitingReason ??
        (current.module === 'listing' && next.module === 'listing'
          ? current.waitingReason
          : undefined))
  return {
    ...next,
    ...(current.hasException || next.hasException ? { hasException: true } : {}),
    ...(counts ? { counts } : {}),
    ...(waitingReason ? { waitingReason } : {}),
  }
}

const collectionPauseReasons = {
  manual_intervention: '请回到目标平台页面后继续采集',
  browser_closed: '比特浏览器已关闭，请重新打开后继续采集',
  window_closed: '采集窗口已关闭，请重新打开后继续采集',
} as const

export function lightweightTaskFromCollectionEvent(
  event: CollectionSessionEvent,
  updatedAt: number,
): LightweightTaskSummary | null {
  if (
    event.type !== 'session-started' &&
    event.type !== 'session-paused' &&
    event.type !== 'session-resumed' &&
    event.type !== 'session-stopped'
  ) {
    return null
  }

  const status =
    event.type === 'session-paused'
      ? 'waiting'
      : event.type === 'session-stopped'
        ? 'completed'
        : 'running'

  return {
    id: `collection:${event.session.id}`,
    module: 'collection',
    route: '/collection',
    status,
    title: '采集任务',
    updatedAt,
    ...(event.type === 'session-paused'
      ? { waitingReason: collectionPauseReasons[event.reason] }
      : {}),
  }
}

function generationTaskTitle(capability: GenerationProgress['capability']) {
  switch (capability) {
    case 'txt2img':
      return '文生图任务'
    case 'img2img':
      return '图生图任务'
    case 'extract':
      return '提取任务'
    case 'matting':
      return '抠图任务'
  }
}

export function lightweightTaskFromGenerationProgress(
  progress: GenerationProgress,
  updatedAt: number,
): LightweightTaskSummary {
  return {
    id: `generation:${progress.task_id}`,
    module: 'generation',
    route: '/generation',
    status: progress.status === 'cancelled' ? 'cancelled' : 'running',
    title: generationTaskTitle(progress.capability),
    updatedAt,
    counts: {
      finished: progress.processed,
      total: progress.total,
      failed: progress.failed,
    },
  }
}

export function lightweightTaskFromGenerationCompleted(
  event: GenerationTaskEvent,
  updatedAt: number,
): LightweightTaskSummary {
  if (!event.ok) {
    return {
      id: `generation:${event.taskId}`,
      module: 'generation',
      route: '/generation',
      status: 'failed',
      title: '生图任务',
      updatedAt,
    }
  }
  return {
    id: `generation:${event.result.taskId}`,
    module: 'generation',
    route: '/generation',
    status: event.result.cancelled ? 'cancelled' : 'completed',
    title: '生图任务',
    updatedAt,
    counts: {
      finished: event.result.succeeded + event.result.failed,
      total: event.result.total,
      failed: event.result.failed,
    },
  }
}

export function lightweightTaskFromDetectionProgress(
  progress: DetectionProgress,
  updatedAt: number,
): LightweightTaskSummary {
  return {
    id: `detection:${progress.task_id}`,
    module: 'detection',
    route: '/detection',
    status: progress.status === 'cancelled' ? 'cancelled' : 'running',
    title: '侵权检测任务',
    updatedAt,
    counts: {
      finished: progress.processed,
      total: progress.total,
      failed: progress.failed,
    },
  }
}

export function lightweightTaskFromDetectionCompleted(
  event: DetectionTaskEvent,
  updatedAt: number,
): LightweightTaskSummary {
  if (!event.ok) {
    return {
      id: `detection:${event.taskId}`,
      module: 'detection',
      route: '/detection',
      status: 'failed',
      title: '侵权检测任务',
      updatedAt,
    }
  }
  return {
    id: `detection:${event.result.taskId}`,
    module: 'detection',
    route: '/detection',
    status: event.result.cancelled ? 'cancelled' : 'completed',
    title: '侵权检测任务',
    updatedAt,
    counts: {
      finished: event.result.succeeded + event.result.failed + event.result.skipped,
      total: event.result.total,
      failed: event.result.failed,
    },
  }
}

export function lightweightTaskFromTitleProgress(
  progress: TitleProgress,
  updatedAt: number,
): LightweightTaskSummary {
  return {
    id: `title:${progress.task_id}`,
    module: 'title',
    route: '/title',
    status: progress.status === 'cancelled' ? 'cancelled' : 'running',
    title: '标题生成任务',
    updatedAt,
    counts: {
      finished: progress.processed,
      total: progress.total,
      failed: progress.failed,
    },
  }
}

export function lightweightTaskFromTitleCompleted(
  event: TitleTaskEvent,
  updatedAt: number,
): LightweightTaskSummary {
  if (!event.ok) {
    return {
      id: `title:${event.taskId}`,
      module: 'title',
      route: '/title',
      status: 'failed',
      title: '标题生成任务',
      updatedAt,
    }
  }
  return {
    id: `title:${event.result.taskId}`,
    module: 'title',
    route: '/title',
    status: event.result.cancelled ? 'cancelled' : 'completed',
    title: '标题生成任务',
    updatedAt,
    counts: {
      finished: event.result.succeeded + event.result.failed + event.result.skipped,
      total: event.result.total,
      failed: event.result.failed,
    },
  }
}

export function lightweightTaskFromListingProgress(
  progress: ListingProgress,
  updatedAt: number,
): LightweightTaskSummary {
  const profileLocked =
    progress.status === 'failed' && progress.lastError?.code === 'PROFILE_LOCKED'
  const loginRequired =
    progress.status === 'failed' && progress.lastError?.code === 'LOGIN_REQUIRED'
  const waitingReason = profileLocked
    ? `比特浏览器环境 ${progress.profileId} 被占用，请先结束冲突的采集或上架任务`
    : loginRequired
      ? `比特浏览器环境 ${progress.profileId} 需要重新登录店小秘，请登录后重试上架`
      : undefined
  const terminalFailure = progress.status === 'failed' && progress.currentSku === undefined
  const status = waitingReason
    ? 'waiting'
    : progress.status === 'cancelled'
      ? 'cancelled'
      : progress.status === 'failed'
        ? terminalFailure || progress.finishedCount >= progress.totalCount
          ? 'failed'
          : 'running'
        : progress.finishedCount >= progress.totalCount &&
            (progress.status === 'success' || progress.status === 'skipped')
          ? 'completed'
          : 'running'

  return {
    id: `listing:${progress.batchId}`,
    module: 'listing',
    route: '/listing',
    status,
    title: '上架任务',
    updatedAt,
    ...(progress.status === 'pending' ? { startsNewRun: true } : {}),
    ...(progress.status === 'failed' && !waitingReason ? { hasException: true } : {}),
    ...(waitingReason ? { waitingReason } : {}),
    counts: {
      finished: progress.finishedCount,
      total: progress.totalCount,
    },
  }
}

export function lightweightTaskFromPhotoshopProgress(
  progress: PhotoshopProgressInfo,
  updatedAt: number,
): LightweightTaskSummary {
  return {
    id: `photoshop:${progress.task_id}`,
    module: 'photoshop',
    route: '/photoshop',
    status:
      progress.current_stage === 'cancelled'
        ? 'cancelled'
        : progress.current_stage === 'task_complete'
          ? 'completed'
          : 'running',
    title: 'PS 套版任务',
    updatedAt,
    counts: {
      finished: progress.completed + progress.failed + progress.skipped,
      total: progress.total_groups,
      failed: progress.failed,
    },
  }
}

export function lightweightTaskFromPhotoshopLog(
  entry: PhotoshopProgressLogEntry,
  updatedAt: number,
): LightweightTaskSummary | null {
  if (entry.level !== 'error' || !entry.task_id) {
    return null
  }
  return {
    id: `photoshop:${entry.task_id}`,
    module: 'photoshop',
    route: '/photoshop',
    status: 'failed',
    title: 'PS 套版任务',
    updatedAt,
    hasException: true,
  }
}

function videoTaskTitle(mode: VideoProgressEvent['mode']) {
  return mode === 'image-to-video' ? '图生视频任务' : '参考生视频任务'
}

export function lightweightTaskFromVideoProgress(
  progress: VideoProgressEvent,
  updatedAt: number,
): LightweightTaskSummary {
  const status =
    progress.status === 'failed'
      ? 'failed'
      : progress.status === 'stopped'
        ? 'cancelled'
        : progress.status === 'succeeded'
          ? 'completed'
          : 'running'
  return {
    id: `video:${progress.task_id}`,
    module: 'video',
    route: '/video',
    status,
    title: videoTaskTitle(progress.mode),
    updatedAt,
  }
}

export function lightweightTaskFromVideoCompleted(
  event: VideoCompletedEvent,
  updatedAt: number,
): LightweightTaskSummary {
  return {
    id: `video:${event.task_id}`,
    module: 'video',
    route: '/video',
    status: event.ok ? 'completed' : 'failed',
    title: videoTaskTitle(event.mode),
    updatedAt,
  }
}
