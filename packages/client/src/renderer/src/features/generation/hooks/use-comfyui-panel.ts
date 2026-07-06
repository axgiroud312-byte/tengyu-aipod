import type { GenerationCapability } from '@tengyu-aipod/shared'
import { useEffect, useMemo, useState } from 'react'
import type { ComfyuiWorkflowSummary } from '../../../../../main/lib/comfyui-workflow-cache'
import type {
  GenerationImageSource,
  GenerationProgress,
  GenerationRunImage,
  GenerationRunResult,
} from '../../../../../main/lib/generation-service'
import { useGenerationStore } from '../../../store/generation'
import { rememberWorkflowKey, workflowKeyOrFallback, workflowOptionKey } from '../lib/format'
import { useComfyuiInstanceSelection } from './use-comfyui-instance-selection'
import { useGenerationTaskEvents } from './use-generation-task-events'

type WorkflowSlotConfig = {
  id: string
  load: () => Promise<ComfyuiWorkflowSummary[]>
  scope: string
}

type WorkflowSlotState = {
  selectedWorkflow: ComfyuiWorkflowSummary | null
  setWorkflowKey: (key: string) => void
  workflowKey: string
  workflows: ComfyuiWorkflowSummary[]
}

export type UseComfyuiPanelOptions = {
  capability: GenerationCapability
  instanceScope: string
  workflowErrorMessage: string
  workflowSlots: WorkflowSlotConfig[]
}

export function useComfyuiPanel({
  capability,
  instanceScope,
  workflowErrorMessage,
  workflowSlots,
}: UseComfyuiPanelOptions) {
  const workflowsVersion = useGenerationStore((state) => state.workflowsVersion)
  const comfyuiInstanceSelection = useComfyuiInstanceSelection(instanceScope)
  const [sourceFolder, setSourceFolder] = useState('')
  const [sources, setSources] = useState<GenerationImageSource[]>([])
  const [workflowsById, setWorkflowsById] = useState<Record<string, ComfyuiWorkflowSummary[]>>({})
  const [workflowKeysById, setWorkflowKeysById] = useState<Record<string, string>>({})
  const [, setProgress] = useState<GenerationProgress | null>(null)
  const [previewImages, setPreviewImages] = useState<GenerationRunImage[]>([])
  const [result, setResult] = useState<GenerationRunResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loadingSources, setLoadingSources] = useState(false)
  const [running, setRunning] = useState(false)
  const workflowSlotById = useMemo(
    () => new Map(workflowSlots.map((slot) => [slot.id, slot])),
    [workflowSlots],
  )
  const taskEvents = useGenerationTaskEvents({
    expectedCapability: capability,
    setProgress,
    setPreviewImages,
    setResult,
    setError,
    setRunning,
  })

  useEffect(() => {
    void workflowsVersion
    void loadWorkflows()
  }, [workflowsVersion])

  async function chooseSourceFolder() {
    setError(null)
    const response = await window.api.generation.chooseImageFolder()
    if (!response.ok) {
      if (response.error.code !== 'CANCELLED') {
        setError(response.error.message)
      }
      return
    }
    setSourceFolder(response.data.path)
    setSources([])
  }

  async function loadWorkflows() {
    try {
      const loadedEntries = await Promise.all(
        workflowSlots.map(async (slot) => [slot.id, await slot.load()] as const),
      )
      setWorkflowsById(Object.fromEntries(loadedEntries))
      setWorkflowKeysById((current) => {
        const next = { ...current }
        for (const [slotId, nextWorkflows] of loadedEntries) {
          const slot = workflowSlotById.get(slotId)
          if (!slot) {
            continue
          }
          const currentKey = next[slotId] ?? ''
          next[slotId] =
            currentKey &&
            nextWorkflows.some((workflow) => workflowOptionKey(workflow) === currentKey)
              ? currentKey
              : workflowKeyOrFallback(slot.scope, nextWorkflows)
        }
        return next
      })
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : workflowErrorMessage)
    }
  }

  async function scanSourceFolder() {
    if (!sourceFolder) {
      setError('请先选择图片文件夹')
      return
    }
    setLoadingSources(true)
    setError(null)
    try {
      const images = await window.api.generation.scanImageFolder({ folder: sourceFolder })
      setSources(images)
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : '检索图片失败')
    } finally {
      setLoadingSources(false)
    }
  }

  function beginRun() {
    setResult(null)
    setPreviewImages([])
    setRunning(true)
    taskEvents.beginTask()
  }

  function handleRunStartFailure(error: unknown, fallbackMessage: string) {
    taskEvents.clearTaskStart()
    setRunning(false)
    setError(error instanceof Error ? error.message : fallbackMessage)
  }

  function workflowSlot(slotId: string): WorkflowSlotState {
    const workflows = workflowsById[slotId] ?? []
    const workflowKey = workflowKeysById[slotId] ?? ''
    const selectedWorkflow =
      workflows.find((workflow) => workflowOptionKey(workflow) === workflowKey) ?? null
    const slot = workflowSlotById.get(slotId)
    return {
      selectedWorkflow,
      setWorkflowKey: (key: string) => {
        if (slot) {
          rememberWorkflowKey(slot.scope, key)
        }
        setWorkflowKeysById((current) => ({ ...current, [slotId]: key }))
      },
      workflowKey,
      workflows,
    }
  }

  return {
    beginRun,
    chooseSourceFolder,
    comfyuiInstanceSelection,
    error,
    handleRunStartFailure,
    loadingSources,
    previewImages,
    result,
    running,
    scanSourceFolder,
    setError,
    setProgress,
    sourceFolder,
    sources,
    taskEvents,
    workflowSlot,
  }
}
