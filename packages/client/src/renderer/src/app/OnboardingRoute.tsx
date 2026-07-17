import { Button } from '@/components/ui/button'
import {
  type OnboardingApiKey,
  type OnboardingApiKeys,
  OnboardingPage,
  type OnboardingStep,
} from '@/features/onboarding/OnboardingPage'
import { getDefaultWorkbenchRoute } from '@/layout/navigation'
import { t } from '@/locale/t'
import { formatIpcError } from '@tengyu-aipod/shared'
import { AlertTriangle, RefreshCw } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { MainWorkbench } from './MainWorkbench'

function parseOnboardingStep(value: string | undefined): OnboardingStep {
  const parsed = Number(value)
  return parsed === 1 || parsed === 2 || parsed === 3 ? parsed : 1
}

function onboardingPath(step: OnboardingStep) {
  return `/onboarding/${step}`
}

export function OnboardingRoute() {
  const navigate = useNavigate()
  const params = useParams()
  const step = parseOnboardingStep(params.step)
  const requestedStep = params.step
  const [workbenchRoot, setWorkbenchRoot] = useState('')
  const [workbenchRootSaved, setWorkbenchRootSaved] = useState(false)
  const [apiKeys, setApiKeys] = useState<OnboardingApiKeys>({
    chenyu: '',
    grsai: '',
    bailian: '',
    bit_browser_url: '127.0.0.1:54345',
  })
  const [isStateLoaded, setIsStateLoaded] = useState(false)
  const [onboardingLoadError, setOnboardingLoadError] = useState<string | null>(null)
  const [onboardingActionError, setOnboardingActionError] = useState<string | null>(null)
  const [choosingWorkbenchRoot, setChoosingWorkbenchRoot] = useState(false)
  const [savingWorkbenchRoot, setSavingWorkbenchRoot] = useState(false)
  const [savingApiKeys, setSavingApiKeys] = useState(false)
  const [testingBitBrowser, setTestingBitBrowser] = useState(false)
  const [bitBrowserTestMessage, setBitBrowserTestMessage] = useState<string | null>(null)
  const [completing, setCompleting] = useState(false)
  const [ready, setReady] = useState(false)

  const loadState = useCallback(async () => {
    setIsStateLoaded(false)
    setOnboardingLoadError(null)
    try {
      const state = await window.api.onboarding.getState()
      if (!state.needs_onboarding) {
        setReady(true)
        navigate(getDefaultWorkbenchRoute(), { replace: true })
        return
      }
      setWorkbenchRoot(state.workbench_root ?? '')
      setWorkbenchRootSaved(Boolean(state.workbench_root))
    } catch (error) {
      setOnboardingLoadError(formatIpcError(error))
    } finally {
      setIsStateLoaded(true)
    }
  }, [navigate])

  useEffect(() => {
    void loadState()
  }, [loadState])

  useEffect(() => {
    if (requestedStep && onboardingPath(step) !== `/onboarding/${requestedStep}`) {
      navigate(onboardingPath(step), { replace: true })
    }
  }, [navigate, requestedStep, step])

  useEffect(() => {
    if (isStateLoaded && step > 1 && !workbenchRootSaved) {
      navigate(onboardingPath(1), { replace: true })
    }
  }, [isStateLoaded, navigate, step, workbenchRootSaved])

  async function chooseWorkbenchRoot() {
    if (choosingWorkbenchRoot || savingWorkbenchRoot) {
      return
    }
    setChoosingWorkbenchRoot(true)
    setOnboardingActionError(null)
    try {
      const result = await window.api.onboarding.chooseWorkbenchRoot()
      if (!result.ok) {
        setOnboardingActionError(result.error.message)
        return
      }
      setWorkbenchRoot(result.data.path)
      setWorkbenchRootSaved(false)
    } catch (error) {
      setOnboardingActionError(formatIpcError(error))
    } finally {
      setChoosingWorkbenchRoot(false)
    }
  }

  async function saveWorkbenchRoot() {
    if (savingWorkbenchRoot || choosingWorkbenchRoot) {
      return
    }
    const nextRoot = workbenchRoot.trim()
    if (!nextRoot) {
      setOnboardingActionError(t('请先选择工作区'))
      return
    }
    setSavingWorkbenchRoot(true)
    setOnboardingActionError(null)
    try {
      const result = await window.api.onboarding.saveWorkbenchRoot(nextRoot)
      setWorkbenchRoot(result.data.path)
      setWorkbenchRootSaved(true)
      navigate(onboardingPath(2))
    } catch (error) {
      setOnboardingActionError(formatIpcError(error))
    } finally {
      setSavingWorkbenchRoot(false)
    }
  }

  async function saveApiKeys() {
    if (savingApiKeys) {
      return
    }
    const cleaned: OnboardingApiKeys = {
      chenyu: apiKeys.chenyu.trim(),
      grsai: apiKeys.grsai.trim(),
      bailian: apiKeys.bailian.trim(),
      bit_browser_url: apiKeys.bit_browser_url.trim(),
    }
    setSavingApiKeys(true)
    setOnboardingActionError(null)
    try {
      await window.api.onboarding.saveApiKeys(cleaned)
      navigate(onboardingPath(3))
    } catch (error) {
      setOnboardingActionError(formatIpcError(error))
    } finally {
      setSavingApiKeys(false)
    }
  }

  function updateApiKey(key: OnboardingApiKey, value: string) {
    setApiKeys((current) => ({ ...current, [key]: value }))
    if (key === 'bit_browser_url') {
      setBitBrowserTestMessage(null)
    }
  }

  async function testBitBrowser() {
    const baseUrl = apiKeys.bit_browser_url.trim()
    if (!baseUrl) {
      setBitBrowserTestMessage(t('请先填写比特浏览器地址'))
      return
    }
    setTestingBitBrowser(true)
    setBitBrowserTestMessage(null)
    try {
      const result = await window.api.onboarding.testBitBrowser({ base_url: baseUrl })
      setBitBrowserTestMessage(
        t('连接成功，已读取 {count} 个浏览器档案').replace('{count}', String(result.profile_count)),
      )
    } catch (error) {
      setBitBrowserTestMessage(formatIpcError(error))
    } finally {
      setTestingBitBrowser(false)
    }
  }

  function skipApiKeys() {
    setApiKeys({
      chenyu: '',
      grsai: '',
      bailian: '',
      bit_browser_url: '',
    })
    setOnboardingActionError(null)
    navigate(onboardingPath(3))
  }

  async function complete() {
    if (completing) {
      return
    }
    setCompleting(true)
    setOnboardingActionError(null)
    try {
      await window.api.onboarding.complete()
      setReady(true)
      navigate(getDefaultWorkbenchRoute(), { replace: true })
    } catch (error) {
      setOnboardingActionError(formatIpcError(error))
    } finally {
      setCompleting(false)
    }
  }

  async function openTutorial() {
    if (completing) {
      return
    }
    setCompleting(true)
    setOnboardingActionError(null)
    try {
      await window.api.onboarding.complete()
      setReady(true)
      navigate('/tutorial', { replace: true })
    } catch (error) {
      setOnboardingActionError(formatIpcError(error))
    } finally {
      setCompleting(false)
    }
  }

  if (ready) {
    return <MainWorkbench initialPipelineRunId={null} />
  }

  if (!isStateLoaded) {
    return (
      <main className="grid min-h-screen place-items-center bg-background text-sm text-muted-foreground">
        正在读取启动状态...
      </main>
    )
  }

  if (onboardingLoadError && !ready) {
    return (
      <main className="grid min-h-screen place-items-center bg-background px-6 text-foreground">
        <section className="w-full max-w-md rounded-md border bg-card p-6 shadow-lg">
          <div className="flex items-start gap-3">
            <AlertTriangle className="mt-0.5 size-5 shrink-0 text-destructive" />
            <div className="min-w-0 space-y-4">
              <div className="space-y-2">
                <h1 className="text-lg font-semibold">启动状态读取失败</h1>
                <p className="break-words text-sm text-muted-foreground">{onboardingLoadError}</p>
              </div>
              <Button onClick={() => void loadState()} type="button">
                <RefreshCw className="mr-2 size-4" />
                重试
              </Button>
            </div>
          </div>
        </section>
      </main>
    )
  }

  return (
    <OnboardingPage
      apiKeys={apiKeys}
      bitBrowserTestMessage={bitBrowserTestMessage}
      choosingWorkbenchRoot={choosingWorkbenchRoot}
      completing={completing}
      error={onboardingActionError}
      onApiKeyChange={updateApiKey}
      onChooseWorkbenchRoot={() => void chooseWorkbenchRoot()}
      onComplete={() => void complete()}
      onOpenTutorial={() => void openTutorial()}
      onPrevious={() => navigate(onboardingPath(1))}
      onSaveApiKeys={() => void saveApiKeys()}
      onSaveWorkbenchRoot={() => void saveWorkbenchRoot()}
      onSkipApiKeys={skipApiKeys}
      onTestBitBrowser={() => void testBitBrowser()}
      saving={savingApiKeys}
      savingWorkbenchRoot={savingWorkbenchRoot}
      step={step}
      testingBitBrowser={testingBitBrowser}
      workbenchRoot={workbenchRoot}
    />
  )
}
