import { useGenerationStore } from '@/store/generation'
import { useEffect } from 'react'

export function useGenerationLocalSettings() {
  const settings = useGenerationStore((state) => state.generationSettings)
  const error = useGenerationStore((state) => state.generationSettingsError)
  const settingsVersion = useGenerationStore((state) => state.settingsVersion)
  const loadGenerationSettings = useGenerationStore((state) => state.loadGenerationSettings)

  useEffect(() => {
    void settingsVersion
    void loadGenerationSettings()
  }, [loadGenerationSettings, settingsVersion])

  return { settings, error }
}
