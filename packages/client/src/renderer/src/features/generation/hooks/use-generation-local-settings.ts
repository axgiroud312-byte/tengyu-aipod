import { useEffect, useState } from 'react'
import { GENERATION_SETTINGS_UPDATED_EVENT } from '../lib/constants'
import type { GenerationSettingsSnapshot } from '../lib/format'

export function useGenerationLocalSettings() {
  const [settings, setSettings] = useState<GenerationSettingsSnapshot | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    const loadSettings = () => {
      window.api.generationSettings
        .get()
        .then((nextSettings) => {
          if (!cancelled) {
            setSettings(nextSettings)
            setError(null)
          }
        })
        .catch((nextError) => {
          if (!cancelled) {
            setError(nextError instanceof Error ? nextError.message : '读取本地生图设置失败')
          }
        })
    }

    loadSettings()
    window.addEventListener(GENERATION_SETTINGS_UPDATED_EVENT, loadSettings)

    return () => {
      cancelled = true
      window.removeEventListener(GENERATION_SETTINGS_UPDATED_EVENT, loadSettings)
    }
  }, [])

  return { settings, error }
}
