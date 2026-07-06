import type { GenerationCapability } from '@tengyu-aipod/shared'
import { useEffect, useRef, useState } from 'react'
import type {
  GenerationProgress,
  GenerationRunImage,
  GenerationRunResult,
  GenerationTaskEvent,
} from '../../../../../main/lib/generation-service'

export function useGenerationTaskEvents({
  expectedCapability,
  setProgress,
  setPreviewImages,
  setResult,
  setError,
  setRunning,
}: {
  expectedCapability: GenerationCapability
  setProgress: (progress: GenerationProgress) => void
  setPreviewImages: (images: GenerationRunImage[]) => void
  setResult: (result: GenerationRunResult | null) => void
  setError: (error: string | null) => void
  setRunning: (running: boolean) => void
}) {
  const [taskId, setTaskId] = useState<string | null>(null)
  const activeTaskIdRef = useRef<string | null>(null)
  const awaitingTaskStartRef = useRef(false)
  const handledTaskEventRef = useRef(false)
  const cancelWhenTaskStartsRef = useRef(false)

  useEffect(() => {
    const shouldHandleTask = (nextTaskId: string, nextCapability?: GenerationCapability) => {
      const activeTaskId = activeTaskIdRef.current ?? taskId
      if (activeTaskId) {
        return nextTaskId === activeTaskId
      }
      if (
        awaitingTaskStartRef.current &&
        (!nextCapability || nextCapability === expectedCapability)
      ) {
        activeTaskIdRef.current = nextTaskId
        awaitingTaskStartRef.current = false
        setTaskId(nextTaskId)
        return true
      }
      return false
    }

    const offProgress = window.api.generation.onProgress((nextProgress) => {
      if (!shouldHandleTask(nextProgress.task_id, nextProgress.capability)) {
        return
      }
      handledTaskEventRef.current = true
      setProgress(nextProgress)
      if (nextProgress.images) {
        setPreviewImages(nextProgress.images)
      }
    })
    const offCompleted = window.api.generation.onCompleted((event: GenerationTaskEvent) => {
      const nextTaskId = event.ok ? event.result.taskId : event.taskId
      if (!shouldHandleTask(nextTaskId)) {
        return
      }
      handledTaskEventRef.current = true
      setRunning(false)
      awaitingTaskStartRef.current = false
      if (event.ok) {
        setResult(event.result)
        setPreviewImages(event.result.images)
        setError(null)
        return
      }
      setError(event.error)
    })
    return () => {
      offProgress()
      offCompleted()
    }
  }, [expectedCapability, taskId, setError, setPreviewImages, setProgress, setResult, setRunning])

  return {
    beginTask() {
      activeTaskIdRef.current = null
      awaitingTaskStartRef.current = true
      handledTaskEventRef.current = false
      cancelWhenTaskStartsRef.current = false
      setTaskId(null)
    },
    activateTask(nextTaskId: string) {
      const alreadyHandled = activeTaskIdRef.current === nextTaskId && handledTaskEventRef.current
      activeTaskIdRef.current = nextTaskId
      awaitingTaskStartRef.current = false
      setTaskId(nextTaskId)
      if (cancelWhenTaskStartsRef.current) {
        cancelWhenTaskStartsRef.current = false
        void window.api.generation.cancel({ task_id: nextTaskId })
      }
      return alreadyHandled
    },
    async cancelTask() {
      const activeTaskId = activeTaskIdRef.current ?? taskId
      if (!activeTaskId && awaitingTaskStartRef.current) {
        cancelWhenTaskStartsRef.current = true
        setError(null)
        return true
      }
      if (!activeTaskId) {
        setError('没有正在运行的生图任务')
        return false
      }
      const response = await window.api.generation.cancel({ task_id: activeTaskId })
      if (!response.ok) {
        setError('当前生图任务已结束，无法取消')
        return false
      }
      setError(null)
      return true
    },
    clearTaskStart() {
      awaitingTaskStartRef.current = false
      cancelWhenTaskStartsRef.current = false
    },
    taskId,
  }
}
