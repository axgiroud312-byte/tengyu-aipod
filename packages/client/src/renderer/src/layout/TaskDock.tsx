import {
  type LightweightTaskSummary,
  lightweightTaskFromCollectionEvent,
  lightweightTaskFromDetectionCompleted,
  lightweightTaskFromDetectionProgress,
  lightweightTaskFromGenerationCompleted,
  lightweightTaskFromGenerationProgress,
  lightweightTaskFromListingProgress,
  lightweightTaskFromPhotoshopProgress,
  lightweightTaskFromTitleCompleted,
  lightweightTaskFromTitleProgress,
  lightweightTaskFromVideoCompleted,
  lightweightTaskFromVideoProgress,
} from '@/store/lightweight-task'
import { useTaskDockStore } from '@/store/task-dock'
import type { PipelineRunRecord } from '@tengyu-aipod/shared'
import {
  Activity,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  CircleStop,
  Clock3,
} from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'

function runStatus(status: PipelineRunRecord['status'], softStopping: boolean) {
  if (softStopping) {
    return { icon: CircleStop, label: '正在停止', tone: 'text-amber-700' }
  }
  if (status === 'running') {
    return { icon: Activity, label: '运行中', tone: 'text-primary' }
  }
  if (status === 'completed') {
    return { icon: CheckCircle2, label: '已完成', tone: 'text-emerald-700' }
  }
  if (status === 'failed') {
    return { icon: CircleAlert, label: '失败', tone: 'text-destructive' }
  }
  if (status === 'interrupted') {
    return { icon: CircleAlert, label: '已中断', tone: 'text-amber-700' }
  }
  return { icon: CircleStop, label: '已取消', tone: 'text-muted-foreground' }
}

function lightweightStatus(task: LightweightTaskSummary) {
  if (task.status === 'waiting') {
    return { icon: Clock3, label: '等待资源', tone: 'text-amber-700' }
  }
  if (task.status === 'running') {
    return { icon: Activity, label: '运行中', tone: 'text-primary' }
  }
  if (task.status === 'failed') {
    return { icon: CircleAlert, label: '失败', tone: 'text-destructive' }
  }
  if (task.status === 'cancelled') {
    return { icon: CircleStop, label: '已取消', tone: 'text-muted-foreground' }
  }
  if ((task.counts?.failed ?? 0) > 0) {
    return { icon: CircleAlert, label: '已完成，有失败', tone: 'text-amber-700' }
  }
  return { icon: CheckCircle2, label: '已完成', tone: 'text-emerald-700' }
}

function LightweightTaskButton({ task }: { task: LightweightTaskSummary }) {
  const navigate = useNavigate()
  const status = lightweightStatus(task)
  const StatusIcon = status.icon
  const countText = task.counts
    ? `${task.counts.completed} / ${task.counts.total}${
        task.counts.failed === undefined ? '' : ` · 失败 ${task.counts.failed}`
      }`
    : null

  return (
    <button
      aria-label={`打开轻量任务 ${task.title}`}
      className="w-full rounded-md border border-transparent px-3 py-3 text-left outline-none transition-colors motion-reduce:transition-none hover:border-border hover:bg-muted/60 focus-visible:ring-2 focus-visible:ring-primary"
      onClick={() => navigate(task.route)}
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

export function TaskDock() {
  const navigate = useNavigate()
  const [loadError, setLoadError] = useState<string | null>(null)
  const expanded = useTaskDockStore((state) => state.expanded)
  const lightweightTasks = useTaskDockStore((state) => state.lightweightTasks)
  const runs = useTaskDockStore((state) => state.completeTaskRuns)
  const selectedRunId = useTaskDockStore((state) => state.selectedRunId)
  const softStoppingRunIds = useTaskDockStore((state) => state.softStoppingRunIds)
  const patchRunStatus = useTaskDockStore((state) => state.patchCompleteTaskRunStatus)
  const replaceRuns = useTaskDockStore((state) => state.replaceCompleteTaskRuns)
  const selectRun = useTaskDockStore((state) => state.selectCompleteTaskRun)
  const setExpanded = useTaskDockStore((state) => state.setExpanded)
  const upsertRun = useTaskDockStore((state) => state.upsertCompleteTaskRun)
  const upsertLightweightTask = useTaskDockStore((state) => state.upsertLightweightTask)

  const refreshRuns = useCallback(async () => {
    try {
      replaceRuns(await window.api.pipeline.listRuns())
      setLoadError(null)
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : '读取完整任务记录失败')
    }
  }, [replaceRuns])

  useEffect(() => {
    void refreshRuns()
  }, [refreshRuns])

  useEffect(() => {
    const offProgress = window.api.pipeline.onProgress((progress) => {
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
      if (event.ok) {
        upsertRun(event.result.run)
      } else {
        patchRunStatus(event.run_id, 'failed')
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
      offVideoProgress()
      offVideoCompleted()
    }
  }, [upsertLightweightTask])

  useEffect(() => {
    if (!expanded) {
      return
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && window.matchMedia('(max-width: 1399px)').matches) {
        setExpanded(false)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [expanded, setExpanded])

  let runningCount = 0
  let exceptionCount = 0
  for (const run of runs) {
    if (run.status === 'running') {
      runningCount += 1
    } else if (run.status === 'failed' || run.status === 'interrupted') {
      exceptionCount += 1
    }
  }
  for (const task of lightweightTasks) {
    if (task.status === 'running' || task.status === 'waiting') {
      runningCount += 1
    }
    if (task.status === 'failed' || (task.counts?.failed ?? 0) > 0) {
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
                <h3 className="px-3 pb-1 text-xs font-medium text-muted-foreground">完整任务</h3>
                <div className="space-y-1">
                  {runs.slice(0, 12).map((run) => {
                    const status = runStatus(run.status, softStoppingRunIds.includes(run.id))
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
                          selectRun(run.id)
                          navigate('/pipeline')
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
