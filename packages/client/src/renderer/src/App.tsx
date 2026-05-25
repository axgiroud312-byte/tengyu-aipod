import { Button } from '@/components/ui/button'
import { initializeActivationStore, useActivationStore } from '@/store/activation'
import type { ActivationBadgeState, PhotoshopStatus } from '@tengyu-aipod/shared'
import { APP_VERSION } from '@tengyu-aipod/shared'
import {
  AlertTriangle,
  CheckCircle2,
  FolderOpen,
  KeyRound,
  MonitorCheck,
  PlayCircle,
  RefreshCw,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'

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

function formatStatusTime(timestamp: number | null) {
  if (!timestamp) {
    return '未同步'
  }

  const date = new Date(timestamp)
  return `${date.toLocaleDateString('zh-CN')} ${date.toLocaleTimeString('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
  })}`
}

function statusToneClassName(tone: ActivationBadgeState['tone']) {
  switch (tone) {
    case 'green':
      return 'border-emerald-200 bg-emerald-50 text-emerald-800'
    case 'yellow':
      return 'border-amber-200 bg-amber-50 text-amber-900'
    case 'red':
      return 'border-red-200 bg-red-50 text-red-800'
    default:
      return 'border-border bg-muted text-muted-foreground'
  }
}

function statusDotClassName(tone: ActivationBadgeState['tone']) {
  switch (tone) {
    case 'green':
      return 'bg-emerald-500'
    case 'yellow':
      return 'bg-amber-500'
    case 'red':
      return 'bg-red-500'
    default:
      return 'bg-muted-foreground'
  }
}

function photoshopStatusLabel(status: PhotoshopStatus | null) {
  if (!status) {
    return '检测中'
  }
  if (status.com_connected) {
    return `已连接${status.version ? ` · v${status.version}` : ''}`
  }
  if (status.running) {
    return '运行中 · COM 未连接'
  }
  if (status.installed) {
    return '已安装 · 未启动'
  }
  return '仅支持 Windows / 未安装'
}

function photoshopStatusTone(status: PhotoshopStatus | null) {
  if (!status) {
    return 'border-border bg-muted text-muted-foreground'
  }
  if (status.com_connected) {
    return 'border-emerald-200 bg-emerald-50 text-emerald-800'
  }
  if (status.running || status.installed) {
    return 'border-amber-200 bg-amber-50 text-amber-900'
  }
  return 'border-red-200 bg-red-50 text-red-800'
}

function photoshopStatusDot(status: PhotoshopStatus | null) {
  if (!status) {
    return 'bg-muted-foreground'
  }
  if (status.com_connected) {
    return 'bg-emerald-500'
  }
  if (status.running || status.installed) {
    return 'bg-amber-500'
  }
  return 'bg-red-500'
}

function PhotoshopStatusBar() {
  const [status, setStatus] = useState<PhotoshopStatus | null>(null)
  const [checking, setChecking] = useState(false)

  const refreshStatus = useCallback(async () => {
    setChecking(true)
    try {
      const nextStatus = await window.api.photoshop.getStatus()
      setStatus(nextStatus)
    } finally {
      setChecking(false)
    }
  }, [])

  useEffect(() => {
    void refreshStatus()
    const timer = window.setInterval(() => {
      void refreshStatus()
    }, 30_000)

    return () => window.clearInterval(timer)
  }, [refreshStatus])

  return (
    <div
      className={`flex items-center justify-between gap-3 rounded-md border px-4 py-3 text-sm ${photoshopStatusTone(
        status,
      )}`}
    >
      <div className="flex min-w-0 items-center gap-2">
        <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${photoshopStatusDot(status)}`} />
        <div className="min-w-0">
          <p className="font-medium">Photoshop 状态：{photoshopStatusLabel(status)}</p>
          {status?.error_message ? (
            <p className="truncate text-xs opacity-80">{status.error_message}</p>
          ) : null}
        </div>
      </div>
      <Button
        className="h-8 shrink-0 px-3"
        disabled={checking}
        onClick={() => void refreshStatus()}
        type="button"
        variant="secondary"
      >
        <RefreshCw className="mr-2 h-3.5 w-3.5" />
        刷新状态
      </Button>
    </div>
  )
}

function ActivationBadge({
  onEnterActivation,
}: {
  onEnterActivation: () => void
}) {
  const status = useActivationStore((state) => state.status)
  const refresh = useActivationStore((state) => state.refresh)
  const [open, setOpen] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const displayStatus =
    status ??
    ({
      kind: 'inactive',
      tone: 'muted',
      label: '读取中',
      detail: '正在读取激活状态',
      daysRemaining: null,
      maxDevices: null,
      usedDevices: null,
      deviceName: null,
      customerName: null,
      customerHasContact: false,
      codeSuffix: null,
      lastServerCheck: null,
      localBlockReason: null,
      localBlockMessage: null,
      cachedStatus: null,
    } satisfies ActivationBadgeState)

  async function syncStatus() {
    setSyncing(true)
    try {
      await refresh()
    } finally {
      setSyncing(false)
    }
  }

  return (
    <div className="relative">
      <button
        className={`inline-flex h-10 min-w-40 items-center justify-center gap-2 rounded-md border px-3 text-sm font-medium shadow-sm transition-colors ${statusToneClassName(
          displayStatus.tone,
        )}`}
        onClick={() => setOpen((current) => !current)}
        type="button"
      >
        <span className={`h-2.5 w-2.5 rounded-full ${statusDotClassName(displayStatus.tone)}`} />
        <span>{displayStatus.label}</span>
      </button>

      {open ? (
        <div className="absolute right-0 top-12 z-20 w-80 rounded-md border bg-background p-4 text-sm shadow-lg">
          <div className="space-y-1">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="font-semibold text-foreground">{displayStatus.label}</p>
                <p className="text-muted-foreground">{displayStatus.detail}</p>
              </div>
              {displayStatus.tone === 'red' ? (
                <AlertTriangle className="h-5 w-5 shrink-0 text-red-600" />
              ) : null}
            </div>
          </div>

          <dl className="mt-4 grid grid-cols-2 gap-3 text-xs">
            <div>
              <dt className="text-muted-foreground">本机名称</dt>
              <dd className="mt-1 font-medium">{displayStatus.deviceName ?? '-'}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">绑定设备</dt>
              <dd className="mt-1 font-medium">
                {displayStatus.usedDevices !== null && displayStatus.maxDevices !== null
                  ? `${displayStatus.usedDevices}/${displayStatus.maxDevices}`
                  : '-'}
              </dd>
            </div>
            <div>
              <dt className="text-muted-foreground">激活码后 4 位</dt>
              <dd className="mt-1 font-mono font-medium">{displayStatus.codeSuffix ?? '-'}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">上次联网</dt>
              <dd className="mt-1 font-medium">
                {formatStatusTime(displayStatus.lastServerCheck)}
              </dd>
            </div>
          </dl>

          {displayStatus.localBlockMessage ? (
            <div className="mt-4 rounded-md border border-red-200 bg-red-50 p-3 text-xs text-red-800">
              {displayStatus.localBlockMessage}
            </div>
          ) : null}

          <div className="mt-4 flex items-center justify-between gap-2">
            <Button
              className="h-9 px-3"
              disabled
              title="服务端解绑接口尚未接入"
              type="button"
              variant="secondary"
            >
              解绑本机
            </Button>
            <div className="flex gap-2">
              <Button
                className="h-9 px-3"
                disabled={syncing}
                onClick={() => void syncStatus()}
                type="button"
                variant="secondary"
              >
                <RefreshCw className="mr-2 h-3.5 w-3.5" />
                同步
              </Button>
              <Button
                className="h-9 px-3"
                onClick={() => {
                  setOpen(false)
                  onEnterActivation()
                }}
                type="button"
              >
                输入新激活码
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}

function MainWorkbench({ onEnterActivation }: { onEnterActivation: () => void }) {
  const status = useActivationStore((state) => state.status)
  const [pingResult, setPingResult] = useState('未测试')
  const isBlocked =
    status?.kind === 'expired' || status?.kind === 'banned' || status?.kind === 'blocked'

  const handlePing = async () => {
    const result = await window.api.ping()
    setPingResult(result)
  }

  return (
    <main className="min-h-screen bg-background text-foreground">
      <header className="flex h-16 items-center justify-between border-b px-8">
        <div>
          <p className="text-sm font-medium text-muted-foreground">Workbench</p>
          <h1 className="text-lg font-semibold tracking-normal">腾域 aipod</h1>
        </div>
        <ActivationBadge onEnterActivation={onEnterActivation} />
      </header>

      <section className="mx-auto flex min-h-[calc(100vh-4rem)] w-full max-w-xl flex-col justify-center space-y-6 px-8">
        {isBlocked ? (
          <div className="space-y-5 rounded-md border border-red-200 bg-red-50 p-6 text-red-900">
            <div className="space-y-2">
              <h1 className="text-2xl font-semibold tracking-normal">
                {status?.label ?? '激活状态异常'}
              </h1>
              <p className="text-sm">{status?.localBlockMessage ?? status?.detail}</p>
            </div>
            <Button onClick={onEnterActivation} type="button">
              输入新激活码
            </Button>
          </div>
        ) : (
          <>
            <div className="space-y-2">
              <h1 className="text-3xl font-semibold tracking-normal">
                腾域 aipod - 版本 {APP_VERSION}
              </h1>
              <p className="text-base text-muted-foreground">软件已准备就绪</p>
            </div>
            <PhotoshopStatusBar />
            <div className="flex items-center gap-3">
              <Button type="button" onClick={handlePing}>
                IPC Ping
              </Button>
              <span className="text-sm text-muted-foreground">结果：{pingResult}</span>
            </div>
          </>
        )}
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

  function enterActivation() {
    setReady(false)
    setStep(1)
  }

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
    return <MainWorkbench onEnterActivation={enterActivation} />
  }

  return (
    <main className="min-h-screen bg-background px-8 py-10 text-foreground">
      <div className="fixed right-8 top-6 z-20">
        <ActivationBadge onEnterActivation={enterActivation} />
      </div>
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
  useEffect(() => {
    let cleanup: (() => void) | null = null

    void initializeActivationStore().then((nextCleanup) => {
      cleanup = nextCleanup
    })

    return () => {
      cleanup?.()
    }
  }, [])

  return <Onboarding />
}
