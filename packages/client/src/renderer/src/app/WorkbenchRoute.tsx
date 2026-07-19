import { Button } from '@/components/ui/button'
import { getDefaultWorkbenchRoute, isWorkbenchRoute } from '@/layout/navigation'
import { formatIpcError } from '@tengyu-aipod/shared'
import type { PipelineRunDetail, PipelineRunRecord } from '@tengyu-aipod/shared'
import { AlertTriangle, Loader2, RefreshCw } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { Navigate, useLocation, useNavigate } from 'react-router-dom'
import { MainWorkbench } from './MainWorkbench'

function onboardingPath(step: 1 | 2) {
  return `/onboarding/${step}`
}

function runUpdatedAt(detail: PipelineRunDetail) {
  return Math.max(
    detail.run.completed_at ?? detail.run.started_at ?? detail.run.created_at,
    ...detail.steps.map((step) => step.updated_at),
    ...(detail.items ?? []).map((item) => item.updated_at),
  )
}

async function mostRecentlyUpdatedRunningRunId() {
  let runningRuns: PipelineRunRecord[]
  try {
    runningRuns = (await window.api.pipeline.listRuns()).filter((run) => run.status === 'running')
  } catch {
    return null
  }
  const details = await Promise.allSettled(
    runningRuns.map((run) => window.api.pipeline.getRun({ run_id: run.id })),
  )
  let selected: PipelineRunDetail | null = null
  for (const result of details) {
    if (result.status !== 'fulfilled') {
      continue
    }
    const detail = result.value
    if (detail && (!selected || runUpdatedAt(detail) > runUpdatedAt(selected))) {
      selected = detail
    }
  }
  return selected?.run.id ?? null
}

function EnteringWorkbench() {
  return (
    <main className="grid min-h-screen place-items-center bg-background text-foreground">
      <div className="flex items-center gap-3 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" />
        正在进入工作台...
      </div>
    </main>
  )
}

export function WorkbenchRoute() {
  const navigate = useNavigate()
  const location = useLocation()
  const [needsOnboarding, setNeedsOnboarding] = useState<boolean | null>(null)
  const [initialPipelineRunId, setInitialPipelineRunId] = useState<string | null | undefined>()
  const [loadError, setLoadError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  const loadState = useCallback(async () => {
    setLoading(true)
    setLoadError(null)
    try {
      const state = await window.api.onboarding.getState()
      setNeedsOnboarding(state.needs_onboarding)
      if (state.needs_onboarding) {
        navigate(onboardingPath(1), { replace: true })
        setInitialPipelineRunId(null)
      } else if (state.workbench_root) {
        setInitialPipelineRunId(await mostRecentlyUpdatedRunningRunId())
      } else {
        setInitialPipelineRunId(null)
      }
    } catch (error) {
      setNeedsOnboarding(null)
      setLoadError(formatIpcError(error))
    } finally {
      setLoading(false)
    }
  }, [navigate])

  useEffect(() => {
    void loadState()
  }, [loadState])

  if (loadError) {
    return (
      <main className="grid min-h-screen place-items-center bg-background px-6 text-foreground">
        <section className="w-full max-w-md rounded-md border bg-card p-6 shadow-lg">
          <div className="flex items-start gap-3">
            <AlertTriangle className="mt-0.5 size-5 shrink-0 text-destructive" />
            <div className="min-w-0 space-y-4">
              <div className="space-y-2">
                <h1 className="text-lg font-semibold">进入工作台失败</h1>
                <p className="break-words text-sm text-muted-foreground">{loadError}</p>
              </div>
              <Button disabled={loading} onClick={() => void loadState()} type="button">
                {loading ? (
                  <Loader2 className="mr-2 size-4 animate-spin" />
                ) : (
                  <RefreshCw className="mr-2 size-4" />
                )}
                重试
              </Button>
            </div>
          </div>
        </section>
      </main>
    )
  }

  if (needsOnboarding === null || initialPipelineRunId === undefined) {
    return <EnteringWorkbench />
  }

  if (needsOnboarding) {
    return null
  }

  const activePath = isWorkbenchRoute(location.pathname)
    ? location.pathname
    : getDefaultWorkbenchRoute()

  if (activePath !== location.pathname) {
    return <Navigate replace to={activePath} />
  }

  return <MainWorkbench initialPipelineRunId={initialPipelineRunId} />
}
