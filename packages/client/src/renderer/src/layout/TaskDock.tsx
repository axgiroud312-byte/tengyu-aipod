import { completedPipelineRunHasException } from '@/features/pipeline/pipeline-run-outcome'
import { t } from '@/locale/t'
import {
  type LightweightTaskSummary,
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
} from '@/store/lightweight-task'
import { TASK_DOCK_OVERLAY_MAX_WIDTH, useTaskDockStore } from '@/store/task-dock'
import { type PipelineRunRecord, formatIpcError } from '@tengyu-aipod/shared'
import {
  Activity,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  CircleStop,
  Clock3,
} from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'

function collapseTaskDockOverlay(setExpanded: (expanded: boolean) => void) {
  if (window.matchMedia(`(max-width: ${TASK_DOCK_OVERLAY_MAX_WIDTH}px)`).matches) {
    setExpanded(false)
  }
}

function useTaskDockOverlayMode() {
  const query = `(max-width: ${TASK_DOCK_OVERLAY_MAX_WIDTH}px)`
  const [overlay, setOverlay] = useState(() => window.matchMedia(query).matches)

  useEffect(() => {
    const media = window.matchMedia(query)
    const update = () => setOverlay(media.matches)
    update()
    media.addEventListener('change', update)
    return () => media.removeEventListener('change', update)
  }, [query])

  return overlay
}

function runStatus(run: PipelineRunRecord, softStopping: boolean) {
  if (softStopping) {
    return { icon: CircleStop, label: t('正在停止'), tone: 'text-amber-700' }
  }
  if (run.status === 'running') {
    return { icon: Activity, label: '运行中', tone: 'text-primary' }
  }
  if (completedPipelineRunHasException(run)) {
    return { icon: CircleAlert, label: t('已完成，有异常'), tone: 'text-amber-700' }
  }
  if (run.status === 'completed') {
    return { icon: CheckCircle2, label: '已完成', tone: 'text-emerald-700' }
  }
  if (run.status === 'failed') {
    return { icon: CircleAlert, label: '失败', tone: 'text-destructive' }
  }
  if (run.status === 'interrupted') {
    return { icon: CircleAlert, label: '已中断', tone: 'text-amber-700' }
  }
  return { icon: CircleStop, label: '已取消', tone: 'text-muted-foreground' }
}

function lightweightStatus(task: LightweightTaskSummary) {
  if (task.status === 'waiting') {
    return { icon: Clock3, label: '等待资源', tone: 'text-amber-700' }
  }
  if (task.status === 'running') {
    if (task.hasException) {
      return { icon: CircleAlert, label: '运行中，有失败', tone: 'text-amber-700' }
    }
    return { icon: Activity, label: '运行中', tone: 'text-primary' }
  }
  if (task.status === 'failed') {
    return { icon: CircleAlert, label: '失败', tone: 'text-destructive' }
  }
  if (task.status === 'cancelled') {
    return { icon: CircleStop, label: '已取消', tone: 'text-muted-foreground' }
  }
  if (task.hasException || (task.counts?.failed ?? 0) > 0) {
    return { icon: CircleAlert, label: '已完成，有失败', tone: 'text-amber-700' }
  }
  return { icon: CheckCircle2, label: '已完成', tone: 'text-emerald-700' }
}

function LightweightTaskButton({ task }: { task: LightweightTaskSummary }) {
  const navigate = useNavigate()
  const setExpanded = useTaskDockStore((state) => state.setExpanded)
  const status = lightweightStatus(task)
  const StatusIcon = status.icon
  const countText = task.counts
    ? `${task.counts.finished} / ${task.counts.total}${
        task.counts.failed === undefined ? '' : ` · 失败 ${task.counts.failed}`
      }`
    : null

  return (
    <button
      aria-label={`打开轻量任务 ${task.title}`}
      className="w-full rounded-md border border-transparent px-3 py-3 text-left outline-none transition-colors motion-reduce:transition-none hover:border-border hover:bg-muted/60 focus-visible:ring-2 focus-visible:ring-primary"
      onClick={() => {
        navigate(task.route)
        collapseTaskDockOverlay(setExpanded)
      }}
      type="button"
    >
      <span className="block truncate text-sm font-medium">{task.title}</span>
      <span className={`mt-1 flex items-center gap-1.5 text-xs ${status.tone}`}>
        <StatusIcon aria-hidden="true" className="size-3.5 shrink-0" />
        {status.label}
      </span>
      {countText ? (
        <span className="mt-1 block text-xs tabular-nums text-muted-foreground">{countText}</span>
      ) : null}
      {task.waitingReason ? (
        <span className="mt-1 block text-xs leading-5 text-amber-800">{task.waitingReason}</span>
      ) : null}
    </button>
  )
}

export function TaskDockScrim() {
  const expanded = useTaskDockStore((state) => state.expanded)
  const setExpanded = useTaskDockStore((state) => state.setExpanded)

  if (!expanded) {
    return null
  }

  return (
    <button
      aria-label={t('关闭任务坞')}
      className="task-dock-scrim"
      onClick={() => setExpanded(false)}
      tabIndex={-1}
      type="button"
    />
  )
}

export function TaskDock() {
  const location = useLocation()
  const navigate = useNavigate()
  const [loadError, setLoadError] = useState<string | null>(null)
  const expanded = useTaskDockStore((state) => state.expanded)
  const overlay = useTaskDockOverlayMode()
  const lightweightTasks = useTaskDockStore((state) => state.lightweightTasks)
  const runs = useTaskDockStore((state) => state.completeTaskRuns)
  const selectedRunId = useTaskDockStore((state) => state.selectedRunId)
  const softStoppingRunIds = useTaskDockStore((state) => state.softStoppingRunIds)
  const patchRunStatus = useTaskDockStore((state) => state.patchCompleteTaskRunStatus)
  const replaceRuns = useTaskDockStore((state) => state.replaceCompleteTaskRuns)
  const requestRun = useTaskDockStore((state) => state.requestCompleteTaskRun)
  const setExpanded = useTaskDockStore((state) => state.setExpanded)
  const upsertRun = useTaskDockStore((state) => state.upsertCompleteTaskRun)
  const upsertLightweightTask = useTaskDockStore((state) => state.upsertLightweightTask)
  const previousPathnameRef = useRef(location.pathname)
  const dockRef = useRef<HTMLElement>(null)
  const closeButtonRef = useRef<HTMLButtonElement>(null)
  const runActivityRevisionRef = useRef(0)
  const runListRequestRevisionRef = useRef(0)

  const refreshRuns = useCallback(async () => {
    const requestRevision = ++runListRequestRevisionRef.current
    const activityRevision = runActivityRevisionRef.current
    try {
      const nextRuns = await window.api.pipeline.listRuns()
      if (
        requestRevision !== runListRequestRevisionRef.current ||
        activityRevision !== runActivityRevisionRef.current
      ) {
        return
      }
      replaceRuns(nextRuns)
      setLoadError(null)
    } catch (error) {
      if (
        requestRevision !== runListRequestRevisionRef.current ||
        activityRevision !== runActivityRevisionRef.current
      ) {
        return
      }
      const message = formatIpcError(error)
      if (message === '请先在设置里选择工作区' || message === 'AppError: 请先在设置里选择工作区') {
        replaceRuns([])
        setLoadError(null)
        return
      }
      setLoadError(message)
    }
  }, [replaceRuns])

  useEffect(() => {
    void refreshRuns()
  }, [refreshRuns])

  useEffect(() => {
    const offProgress = window.api.pipeline.onProgress((progress) => {
      runActivityRevisionRef.current += 1
      const runExists = useTaskDockStore
        .getState()
        .completeTaskRuns.some((run) => run.id === progress.run_id)
      if (runExists) {
        patchRunStatus(progress.run_id, progress.status)
      } else {
        void refreshRuns()
      }
    })
    const offCompleted = window.api.pipeline.onCompleted((event) => {
      runActivityRevisionRef.current += 1
      if (event.ok) {
        upsertRun(event.result.run)
      } else {
        const runExists = useTaskDockStore
          .getState()
          .completeTaskRuns.some((run) => run.id === event.run_id)
        if (runExists) {
          patchRunStatus(event.run_id, 'failed')
        } else {
          void refreshRuns()
        }
      }
    })
    return () => {
      offProgress()
      offCompleted()
    }
  }, [patchRunStatus, refreshRuns, upsertRun])

  useEffect(() => {
    const upsert = (task: LightweightTaskSummary | null) => {
      if (task) {
        upsertLightweightTask(task)
      }
    }
    const offCollection = window.api.collection.onEvent((event) =>
      upsert(lightweightTaskFromCollectionEvent(event, Date.now())),
    )
    const offGenerationProgress = window.api.generation.onProgress((event) =>
      upsert(lightweightTaskFromGenerationProgress(event, Date.now())),
    )
    const offGenerationCompleted = window.api.generation.onCompleted((event) =>
      upsert(lightweightTaskFromGenerationCompleted(event, Date.now())),
    )
    const offDetectionProgress = window.api.detection.onProgress((event) =>
      upsert(lightweightTaskFromDetectionProgress(event, Date.now())),
    )
    const offDetectionCompleted = window.api.detection.onCompleted((event) =>
      upsert(lightweightTaskFromDetectionCompleted(event, Date.now())),
    )
    const offTitleProgress = window.api.title.onProgress((event) =>
      upsert(lightweightTaskFromTitleProgress(event, Date.now())),
    )
    const offTitleCompleted = window.api.title.onCompleted((event) =>
      upsert(lightweightTaskFromTitleCompleted(event, Date.now())),
    )
    const offListingProgress = window.api.listing.onProgress((event) =>
      upsert(lightweightTaskFromListingProgress(event, Date.now())),
    )
    const offPhotoshopProgress = window.api.photoshop.onProgress((event) =>
      upsert(lightweightTaskFromPhotoshopProgress(event, Date.now())),
    )
    const offPhotoshopLog = window.api.photoshop.onLog((event) =>
      upsert(lightweightTaskFromPhotoshopLog(event, Date.now())),
    )
    const offVideoProgress = window.api.video.onProgress((event) =>
      upsert(lightweightTaskFromVideoProgress(event, Date.now())),
    )
    const offVideoCompleted = window.api.video.onCompleted((event) =>
      upsert(lightweightTaskFromVideoCompleted(event, Date.now())),
    )
    return () => {
      offCollection()
      offGenerationProgress()
      offGenerationCompleted()
      offDetectionProgress()
      offDetectionCompleted()
      offTitleProgress()
      offTitleCompleted()
      offListingProgress()
      offPhotoshopProgress()
      offPhotoshopLog()
      offVideoProgress()
      offVideoCompleted()
    }
  }, [upsertLightweightTask])

  useEffect(() => {
    if (!expanded) {
      return
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (
        event.key === 'Escape' &&
        window.matchMedia(`(max-width: ${TASK_DOCK_OVERLAY_MAX_WIDTH}px)`).matches
      ) {
        setExpanded(false)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [expanded, setExpanded])

  useEffect(() => {
    if (!expanded || !overlay) {
      return
    }
    const shell = dockRef.current?.closest('.workbench-shell')
    if (!shell) {
      return
    }
    const background = Array.from(shell.children).filter(
      (element): element is HTMLElement =>
        element instanceof HTMLElement && element.dataset.workbenchRegion === 'central',
    )
    const previousInert = background.map((element) => element.inert)
    for (const element of background) {
      element.inert = true
    }
    closeButtonRef.current?.focus()

    return () => {
      for (const [index, element] of background.entries()) {
        element.inert = previousInert[index] ?? false
      }
      requestAnimationFrame(() => {
        const expandButton = document.querySelector<HTMLButtonElement>(
          '[data-workbench-region="task-dock"][data-state="collapsed"] button',
        )
        expandButton?.focus()
      })
    }
  }, [expanded, overlay])

  useEffect(() => {
    const previousPathname = previousPathnameRef.current
    previousPathnameRef.current = location.pathname
    if (previousPathname !== location.pathname && expanded) {
      collapseTaskDockOverlay(setExpanded)
    }
  }, [expanded, location.pathname, setExpanded])

  let runningCount = 0
  let exceptionCount = 0
  for (const run of runs) {
    if (run.status === 'running') {
      runningCount += 1
    } else if (
      run.status === 'failed' ||
      run.status === 'interrupted' ||
      completedPipelineRunHasException(run)
    ) {
      exceptionCount += 1
    }
  }
  for (const task of lightweightTasks) {
    if (task.status === 'running' || task.status === 'waiting') {
      runningCount += 1
    }
    if (task.status === 'failed' || task.hasException || (task.counts?.failed ?? 0) > 0) {
      exceptionCount += 1
    }
  }

  const sortedLightweightTasks = [...lightweightTasks].sort(
    (left, right) => right.updatedAt - left.updatedAt,
  )

  if (!expanded) {
    return (
      <aside
        aria-label="任务坞"
        className="flex h-full w-11 shrink-0 flex-col items-center border-l bg-card py-2"
        data-state="collapsed"
        data-workbench-region="task-dock"
      >
        <button
          aria-label={`展开任务坞，${runningCount} 个运行中，${exceptionCount} 个异常`}
          className="flex size-9 items-center justify-center rounded-md text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-primary"
          onClick={() => setExpanded(true)}
          title="展开任务坞"
          type="button"
        >
          <ChevronLeft aria-hidden="true" className="size-4" />
        </button>
        <div className="mt-4 flex flex-col items-center gap-3 text-xs tabular-nums">
          <span
            aria-label={`${runningCount} 个运行中`}
            className="grid size-7 place-items-center rounded-md bg-primary/10 font-semibold text-primary"
          >
            {runningCount}
          </span>
          <span
            aria-label={`${exceptionCount} 个异常`}
            className="grid size-7 place-items-center rounded-md bg-destructive/10 font-semibold text-destructive"
          >
            {exceptionCount}
          </span>
        </div>
      </aside>
    )
  }

  return (
    <aside
      aria-label="任务坞"
      className="flex h-full w-[310px] shrink-0 flex-col border-l bg-card"
      data-state="expanded"
      data-workbench-region="task-dock"
      ref={dockRef}
    >
      <header className="flex items-start justify-between gap-3 border-b px-4 py-4">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold">任务坞</h2>
          <p className="mt-1 text-xs text-muted-foreground">完整任务与当前会话轻量任务</p>
        </div>
        <button
          aria-label="折叠任务坞"
          className="flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-primary"
          onClick={() => setExpanded(false)}
          ref={closeButtonRef}
          title="折叠任务坞"
          type="button"
        >
          <ChevronRight aria-hidden="true" className="size-4" />
        </button>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {loadError ? (
          <p className="m-2 rounded-md border border-destructive/30 bg-destructive/5 p-2 text-xs text-destructive">
            {loadError}
          </p>
        ) : runs.length > 0 || sortedLightweightTasks.length > 0 ? (
          <div className="space-y-4">
            {runs.length > 0 ? (
              <section aria-label="完整任务">
                <h3 className="px-3 pb-1 text-xs font-medium text-muted-foreground">
                  完整任务运行
                </h3>
                <div className="space-y-1">
                  {runs.slice(0, 12).map((run) => {
                    const status = runStatus(run, softStoppingRunIds.includes(run.id))
                    const StatusIcon = status.icon
                    const selected = run.id === selectedRunId
                    return (
                      <button
                        aria-current={selected ? 'true' : undefined}
                        aria-label={`打开完整任务 ${run.name}`}
                        className={`w-full rounded-md border px-3 py-3 text-left outline-none transition-colors motion-reduce:transition-none focus-visible:ring-2 focus-visible:ring-primary ${
                          selected
                            ? 'border-primary/40 bg-primary/5'
                            : 'border-transparent hover:border-border hover:bg-muted/60'
                        }`}
                        key={run.id}
                        onClick={() => {
                          requestRun(run.id)
                          navigate('/pipeline')
                          collapseTaskDockOverlay(setExpanded)
                        }}
                        type="button"
                      >
                        <span className="block truncate text-sm font-medium">{run.name}</span>
                        <span className={`mt-1 flex items-center gap-1.5 text-xs ${status.tone}`}>
                          <StatusIcon aria-hidden="true" className="size-3.5 shrink-0" />
                          {status.label}
                        </span>
                      </button>
                    )
                  })}
                </div>
                {runs.length > 12 ? (
                  <button
                    className="mt-2 w-full rounded-md px-3 py-2 text-left text-xs font-medium text-primary outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-primary"
                    onClick={() => {
                      navigate('/pipeline/runs')
                      collapseTaskDockOverlay(setExpanded)
                    }}
                    type="button"
                  >
                    {t('查看全部 {count} 条运行记录').replace('{count}', String(runs.length))}
                  </button>
                ) : null}
              </section>
            ) : null}
            {sortedLightweightTasks.length > 0 ? (
              <section aria-label="轻量任务">
                <h3 className="px-3 pb-1 text-xs font-medium text-muted-foreground">轻量任务</h3>
                <div className="space-y-1">
                  {sortedLightweightTasks.map((task) => (
                    <LightweightTaskButton key={task.id} task={task} />
                  ))}
                </div>
              </section>
            ) : null}
          </div>
        ) : (
          <p className="px-2 py-6 text-center text-xs text-muted-foreground">暂无任务</p>
        )}
      </div>
    </aside>
  )
}
