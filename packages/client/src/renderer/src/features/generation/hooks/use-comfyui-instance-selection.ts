import { useEffect, useMemo, useState } from 'react'
import { COMFYUI_INSTANCE_SELECTION_STORAGE_PREFIX } from '../lib/constants'

export type ActiveComfyuiInstance = Awaited<ReturnType<typeof window.api.chenyu.getActiveInstance>>
export type ChenyuManagedInstance = Awaited<
  ReturnType<typeof window.api.chenyu.listInstances>
>[number]
export type ComfyuiRunTarget = { instanceUuid: string }
export type ComfyuiInstanceStatus = NonNullable<ActiveComfyuiInstance>['status'] | 'none'

export function instanceComfyuiUrl(instance: ChenyuManagedInstance) {
  return instance.comfyuiUrl ?? instance.serverUrls[0] ?? ''
}

export function useComfyuiInstanceSelection(scope: string, enabled = true) {
  const storageKey = `${COMFYUI_INSTANCE_SELECTION_STORAGE_PREFIX}${scope}`
  const [instances, setInstances] = useState<ChenyuManagedInstance[]>([])
  const [selectedInstanceUuid, setSelectedInstanceUuid] = useState(() => {
    try {
      return window.localStorage.getItem(storageKey) ?? ''
    } catch {
      return ''
    }
  })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!enabled) {
      return
    }
    void refreshInstances()
  }, [enabled])

  const runningInstances = useMemo(
    () =>
      instances.filter(
        (instance) => instance.statusName === 'running' && Boolean(instanceComfyuiUrl(instance)),
      ),
    [instances],
  )
  const selectedInstance =
    runningInstances.find((instance) => instance.instanceUuid === selectedInstanceUuid) ?? null
  const runTarget = selectedInstance
    ? {
        instanceUuid: selectedInstance.instanceUuid,
      }
    : null

  useEffect(() => {
    if (runningInstances.length === 0) {
      if (selectedInstanceUuid) {
        setSelectedInstanceUuid('')
      }
      return
    }
    if (runningInstances.some((instance) => instance.instanceUuid === selectedInstanceUuid)) {
      return
    }
    const fallback = runningInstances.find((instance) => instance.isCurrent) ?? runningInstances[0]
    setSelectedInstanceUuid(fallback?.instanceUuid ?? '')
  }, [runningInstances, selectedInstanceUuid])

  useEffect(() => {
    try {
      if (selectedInstanceUuid) {
        window.localStorage.setItem(storageKey, selectedInstanceUuid)
      } else {
        window.localStorage.removeItem(storageKey)
      }
    } catch {}
  }, [selectedInstanceUuid, storageKey])

  async function refreshInstances() {
    setLoading(true)
    setError(null)
    try {
      const nextInstances = await window.api.chenyu.listInstances()
      setInstances(nextInstances)
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : '刷新云机列表失败')
    } finally {
      setLoading(false)
    }
  }

  function selectInstance(instanceUuid: string) {
    setSelectedInstanceUuid(instanceUuid)
  }

  return {
    error,
    loading,
    refreshInstances,
    runTarget,
    runningInstances,
    selectedInstance,
    selectedInstanceUuid,
    selectInstance,
  }
}
