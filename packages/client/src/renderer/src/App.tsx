import { Button } from '@/components/ui/button'
import { APP_VERSION } from '@tengyu-aipod/shared'
import { CheckCircle2, FolderOpen, KeyRound, MonitorCheck, PlayCircle } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'

type OnboardingStep = 1 | 2 | 3 | 4

const apiKeyFields = [
  { key: 'chenyu', label: '晨羽智云 API Key', placeholder: '用于 ComfyUI 生图' },
  { key: 'grsai', label: 'Grsai API Key', placeholder: '用于付费生图' },
  { key: 'bailian', label: '阿里云百炼 API Key', placeholder: '用于检测和标题' },
  { key: 'bit_browser_url', label: '比特浏览器地址', placeholder: '127.0.0.1:54345' },
]

function normalizeActivationCode(value: string) {
  return value
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, 16)
    .replace(/(.{4})(?=.)/g, '$1-')
}

function defaultDeviceName() {
  return `我的${navigator.platform.includes('Mac') ? 'Mac' : '工作电脑'}`
}

function MainWorkbench() {
  const [pingResult, setPingResult] = useState('未测试')

  const handlePing = async () => {
    const result = await window.api.ping()
    setPingResult(result)
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-8 text-foreground">
      <section className="w-full max-w-xl space-y-6">
        <div className="space-y-2">
          <p className="text-sm font-medium text-muted-foreground">Workbench</p>
          <h1 className="text-3xl font-semibold tracking-normal">
            腾域 aipod - 版本 {APP_VERSION}
          </h1>
          <p className="text-base text-muted-foreground">软件已准备就绪</p>
        </div>
        <div className="flex items-center gap-3">
          <Button type="button" onClick={handlePing}>
            IPC Ping
          </Button>
          <span className="text-sm text-muted-foreground">结果：{pingResult}</span>
        </div>
      </section>
    </main>
  )
}

function StepHeader({ step }: { step: OnboardingStep }) {
  const steps = [
    { number: 1, label: '激活', icon: MonitorCheck },
    { number: 2, label: '素材目录', icon: FolderOpen },
    { number: 3, label: 'API Keys', icon: KeyRound },
    { number: 4, label: '完成', icon: CheckCircle2 },
  ]

  return (
    <div className="grid grid-cols-4 gap-3">
      {steps.map((item) => {
        const Icon = item.icon
        const isCurrent = item.number === step
        const isDone = item.number < step
        return (
          <div
            className={`rounded-md border p-3 ${
              isCurrent || isDone ? 'border-primary bg-muted' : 'bg-background'
            }`}
            key={item.number}
          >
            <div className="flex items-center gap-2 text-sm font-medium">
              <Icon className="h-4 w-4" />
              Step {item.number}/4
            </div>
            <div className="mt-1 text-xs text-muted-foreground">{item.label}</div>
          </div>
        )
      })}
    </div>
  )
}

function Onboarding() {
  const [step, setStep] = useState<OnboardingStep>(1)
  const [activationCode, setActivationCode] = useState('')
  const [deviceName, setDeviceName] = useState(defaultDeviceName)
  const [activationMessage, setActivationMessage] = useState<string | null>(null)
  const [isActivating, setIsActivating] = useState(false)
  const [workbenchRoot, setWorkbenchRoot] = useState('')
  const [apiKeys, setApiKeys] = useState<Record<string, string>>({
    chenyu: '',
    grsai: '',
    bailian: '',
    bit_browser_url: '127.0.0.1:54345',
  })
  const [ready, setReady] = useState(false)

  useEffect(() => {
    async function loadState() {
      const state = await window.api.onboarding.getState()
      setWorkbenchRoot(state.default_workbench_root)
      if (!state.needs_onboarding) {
        setReady(true)
      }
    }

    void loadState()
  }, [])

  const canActivate = useMemo(
    () => /^POD-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(activationCode),
    [activationCode],
  )

  async function activate() {
    setActivationMessage(null)
    setIsActivating(true)
    const result = await window.api.activation.activate({
      code: activationCode,
      device_name: deviceName.trim() || defaultDeviceName(),
    })
    setIsActivating(false)

    if (!result.ok) {
      setActivationMessage(result.error.message)
      return
    }

    setActivationMessage(
      `激活成功，可用设备 ${result.data.used_devices}/${result.data.max_devices}`,
    )
    setStep(2)
  }

  async function chooseWorkbenchRoot() {
    const result = await window.api.onboarding.chooseWorkbenchRoot()
    if (result.ok) {
      setWorkbenchRoot(result.data.path)
    }
  }

  async function saveWorkbenchRoot() {
    await window.api.onboarding.saveWorkbenchRoot(workbenchRoot)
    setStep(3)
  }

  async function saveApiKeys(nextStep: OnboardingStep = 4) {
    const cleaned = Object.fromEntries(
      Object.entries(apiKeys).map(([key, value]) => [key, value.trim()]),
    )
    await window.api.onboarding.saveApiKeys(cleaned)
    setStep(nextStep)
  }

  async function complete() {
    await window.api.onboarding.complete()
    setReady(true)
  }

  if (ready) {
    return <MainWorkbench />
  }

  return (
    <main className="min-h-screen bg-background px-8 py-10 text-foreground">
      <section className="mx-auto max-w-5xl space-y-6">
        <div className="space-y-2">
          <p className="text-sm font-medium text-muted-foreground">首次启动</p>
          <h1 className="text-3xl font-semibold tracking-normal">欢迎使用腾域 aipod</h1>
        </div>
        <StepHeader step={step} />

        <div className="rounded-lg border bg-background p-6 shadow-sm">
          {step === 1 ? (
            <div className="space-y-5">
              <div>
                <h2 className="text-xl font-semibold">Step 1/4 - 激活</h2>
              </div>
              <label className="block space-y-2 text-sm font-medium">
                <span>激活码</span>
                <input
                  className="h-11 w-full rounded-md border px-3 font-mono text-base outline-none focus-visible:ring-2 focus-visible:ring-primary"
                  onChange={(event) =>
                    setActivationCode(normalizeActivationCode(event.target.value))
                  }
                  placeholder="POD-XXXX-YYYY-ZZZZ"
                  value={activationCode}
                />
              </label>
              <label className="block space-y-2 text-sm font-medium">
                <span>本机名称</span>
                <input
                  className="h-11 w-full rounded-md border px-3 text-base outline-none focus-visible:ring-2 focus-visible:ring-primary"
                  onChange={(event) => setDeviceName(event.target.value)}
                  value={deviceName}
                />
              </label>
              {activationMessage ? (
                <p className="text-sm text-muted-foreground">{activationMessage}</p>
              ) : null}
              <div className="flex items-center gap-3">
                <Button
                  disabled={!canActivate || isActivating}
                  onClick={() => void activate()}
                  type="button"
                >
                  {isActivating ? '激活中...' : '激活'}
                </Button>
                <a
                  className="text-sm text-muted-foreground underline"
                  href="https://example.com/support"
                >
                  联系客服微信
                </a>
              </div>
            </div>
          ) : null}

          {step === 2 ? (
            <div className="space-y-5">
              <h2 className="text-xl font-semibold">Step 2/4 - 素材总目录</h2>
              <label className="block space-y-2 text-sm font-medium">
                <span>素材根目录</span>
                <div className="flex gap-2">
                  <input
                    className="h-11 min-w-0 flex-1 rounded-md border px-3 text-base outline-none focus-visible:ring-2 focus-visible:ring-primary"
                    onChange={(event) => setWorkbenchRoot(event.target.value)}
                    value={workbenchRoot}
                  />
                  <Button
                    onClick={() => void chooseWorkbenchRoot()}
                    type="button"
                    variant="secondary"
                  >
                    浏览...
                  </Button>
                </div>
              </label>
              <div className="rounded-md bg-muted p-4 text-sm text-muted-foreground">
                软件会创建 01-采集、02-生图、03-检测、04-待套版印花、05-货号成品 和 .workbench。
              </div>
              <div className="flex gap-2">
                <Button onClick={() => setStep(1)} type="button" variant="secondary">
                  上一步
                </Button>
                <Button onClick={() => void saveWorkbenchRoot()} type="button">
                  下一步
                </Button>
              </div>
            </div>
          ) : null}

          {step === 3 ? (
            <div className="space-y-5">
              <h2 className="text-xl font-semibold">Step 3/4 - API Keys</h2>
              <div className="grid gap-4">
                {apiKeyFields.map((field) => (
                  <label className="block space-y-2 text-sm font-medium" key={field.key}>
                    <span>{field.label}</span>
                    <div className="flex gap-2">
                      <input
                        className="h-11 min-w-0 flex-1 rounded-md border px-3 text-base outline-none focus-visible:ring-2 focus-visible:ring-primary"
                        onChange={(event) =>
                          setApiKeys((current) => ({ ...current, [field.key]: event.target.value }))
                        }
                        placeholder={field.placeholder}
                        type={field.key === 'bit_browser_url' ? 'text' : 'password'}
                        value={apiKeys[field.key] ?? ''}
                      />
                      <Button
                        onClick={() => setApiKeys((current) => ({ ...current, [field.key]: '' }))}
                        type="button"
                        variant="secondary"
                      >
                        跳过
                      </Button>
                      <Button type="button" variant="secondary">
                        测试连接
                      </Button>
                    </div>
                  </label>
                ))}
              </div>
              <div className="flex gap-2">
                <Button onClick={() => setStep(2)} type="button" variant="secondary">
                  上一步
                </Button>
                <Button onClick={() => void saveApiKeys()} type="button" variant="secondary">
                  全部跳过
                </Button>
                <Button onClick={() => void saveApiKeys()} type="button">
                  下一步
                </Button>
              </div>
            </div>
          ) : null}

          {step === 4 ? (
            <div className="space-y-5 text-center">
              <CheckCircle2 className="mx-auto h-14 w-14 text-foreground" />
              <div>
                <h2 className="text-2xl font-semibold">软件已准备就绪</h2>
              </div>
              <div className="flex justify-center gap-2">
                <Button asChild variant="secondary">
                  <a href="https://example.com/tutorial">
                    <PlayCircle className="mr-2 h-4 w-4" />
                    查看教程视频
                  </a>
                </Button>
                <Button onClick={() => void complete()} type="button">
                  开始使用
                </Button>
              </div>
            </div>
          ) : null}
        </div>
      </section>
    </main>
  )
}

export function App() {
  return <Onboarding />
}
