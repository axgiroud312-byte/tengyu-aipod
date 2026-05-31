import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Progress } from '@/components/ui/progress'
import { Separator } from '@/components/ui/separator'
import { cn } from '@/lib/utils'
import {
  CheckCircle2,
  CircleDot,
  KeyRound,
  LockKeyhole,
  MonitorCheck,
  PlayCircle,
  ShieldCheck,
  Sparkles,
} from 'lucide-react'
import type { ComponentType, ReactNode, SVGProps } from 'react'

export type OnboardingStep = 1 | 2 | 3
export type OnboardingApiKey = 'chenyu' | 'grsai' | 'bailian' | 'bit_browser_url'
export type OnboardingApiKeys = Record<OnboardingApiKey, string>

interface OnboardingPageProps {
  step: OnboardingStep
  activationBadge: ReactNode
  activationCode: string
  deviceName: string
  activationMessage: string | null
  isActivating: boolean
  canActivate: boolean
  apiKeys: OnboardingApiKeys
  onActivationCodeChange: (value: string) => void
  onDeviceNameChange: (value: string) => void
  onApiKeyChange: (key: OnboardingApiKey, value: string) => void
  onActivate: () => void
  onSaveApiKeys: () => void
  onComplete: () => void
  onNavigateStep: (step: OnboardingStep) => void
}

interface StepMeta {
  number: OnboardingStep
  label: string
  title: string
  detail: string
  icon: ComponentType<SVGProps<SVGSVGElement>>
}

const stepMetas: StepMeta[] = [
  {
    number: 1,
    label: '激活',
    title: '绑定本机授权',
    detail: '输入激活码并确认设备名称',
    icon: MonitorCheck,
  },
  {
    number: 2,
    label: '接口密钥',
    title: '保存本机密钥',
    detail: '密钥只进入系统加密存储',
    icon: KeyRound,
  },
  {
    number: 3,
    label: '完成',
    title: '进入工作台',
    detail: '开始使用 6 个生产模块',
    icon: CheckCircle2,
  },
]

const defaultStepMeta: StepMeta = {
  number: 1,
  label: '激活',
  title: '绑定本机授权',
  detail: '输入激活码并确认设备名称',
  icon: MonitorCheck,
}

const apiKeyFields: Array<{
  key: OnboardingApiKey
  label: string
  placeholder: string
  type: 'password' | 'text'
}> = [
  {
    key: 'chenyu',
    label: '晨羽智云密钥',
    placeholder: '用于云端 ComfyUI 工作流',
    type: 'password',
  },
  { key: 'grsai', label: 'Grsai 密钥', placeholder: '用于付费生图', type: 'password' },
  { key: 'bailian', label: '阿里云百炼密钥', placeholder: '用于检测和标题生成', type: 'password' },
  { key: 'bit_browser_url', label: '比特浏览器地址', placeholder: '127.0.0.1:54345', type: 'text' },
]

function currentStepMeta(step: OnboardingStep) {
  return stepMetas.find((item) => item.number === step) ?? defaultStepMeta
}

function stepProgress(step: OnboardingStep) {
  return Math.round((step / 3) * 100)
}

function StepRail({ step }: { step: OnboardingStep }) {
  return (
    <div className="space-y-2">
      {stepMetas.map((item) => {
        const Icon = item.icon
        const isCurrent = item.number === step
        const isDone = item.number < step
        return (
          <div
            className={cn(
              'flex items-start gap-3 rounded-md border p-3 transition-colors duration-150',
              isCurrent
                ? 'border-primary bg-primary/5 text-foreground shadow-xs'
                : isDone
                  ? 'border-emerald-200 bg-emerald-50 text-emerald-950'
                  : 'border-border bg-background/70 text-muted-foreground',
            )}
            key={item.number}
          >
            <div
              className={cn(
                'mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-sm border',
                isCurrent
                  ? 'border-primary bg-primary text-primary-foreground'
                  : isDone
                    ? 'border-emerald-200 bg-emerald-600 text-white'
                    : 'border-border bg-muted text-muted-foreground',
              )}
            >
              <Icon className="h-4 w-4" />
            </div>
            <div className="min-w-0">
              <p className="text-sm font-semibold">
                第 {item.number} 步 共 3 步 · {item.label}
              </p>
              <p className="mt-0.5 text-xs leading-4 opacity-80">{item.detail}</p>
            </div>
          </div>
        )
      })}
    </div>
  )
}

function MessageBox({ message }: { message: string | null }) {
  if (!message) {
    return null
  }

  return (
    <div className="rounded-md border border-primary/20 bg-primary/5 px-3 py-2 text-sm text-primary">
      {message}
    </div>
  )
}

export function OnboardingPage({
  step,
  activationBadge,
  activationCode,
  deviceName,
  activationMessage,
  isActivating,
  canActivate,
  apiKeys,
  onActivationCodeChange,
  onDeviceNameChange,
  onApiKeyChange,
  onActivate,
  onSaveApiKeys,
  onComplete,
  onNavigateStep,
}: OnboardingPageProps) {
  const meta = currentStepMeta(step)

  return (
    <main className="min-h-screen overflow-hidden bg-[radial-gradient(circle_at_top_left,_rgba(37,99,235,0.16),_transparent_32%),linear-gradient(135deg,_hsl(var(--background))_0%,_hsl(var(--muted))_100%)] px-8 py-8 text-foreground">
      <div className="fixed right-8 top-6 z-20">{activationBadge}</div>

      <section className="mx-auto grid min-h-[calc(100vh-64px)] max-w-6xl gap-6 lg:grid-cols-[360px_minmax(0,1fr)]">
        <aside className="flex flex-col justify-between rounded-lg border bg-background/80 p-6 shadow-sm backdrop-blur">
          <div className="space-y-6">
            <div className="space-y-4">
              <div className="flex items-center gap-3">
                <div className="grid h-10 w-10 place-items-center rounded-md bg-primary shadow-xs">
                  <span className="h-4 w-4 rounded-sm bg-primary-foreground" />
                </div>
                <div>
                  <p className="text-lg font-semibold tracking-normal">腾域 aipod</p>
                  <p className="text-xs text-muted-foreground">跨境电商生产工作台</p>
                </div>
              </div>

              <Badge className="border-primary/20 bg-primary/10 text-primary" variant="outline">
                首次配置
              </Badge>
              <div className="space-y-2">
                <h1 className="text-3xl font-semibold leading-9 tracking-normal">
                  把本机接入腾域工作台
                </h1>
                <p className="text-sm leading-6 text-muted-foreground">
                  只需完成激活和密钥保存。工作区可稍后在设置页选择，图片、任务数据和密钥都留在本机。
                </p>
              </div>
            </div>

            <div className="space-y-3">
              <div className="flex items-center justify-between text-sm">
                <span className="font-medium">配置进度</span>
                <span className="tabular-nums text-muted-foreground">{stepProgress(step)}%</span>
              </div>
              <Progress value={stepProgress(step)} />
            </div>

            <StepRail step={step} />
          </div>

          <div className="mt-6 grid gap-2 text-xs text-muted-foreground">
            <div className="flex items-center gap-2 rounded-sm bg-muted px-3 py-2">
              <ShieldCheck className="h-4 w-4 text-primary" />
              服务端不接触用户图片和任务数据
            </div>
            <div className="flex items-center gap-2 rounded-sm bg-muted px-3 py-2">
              <LockKeyhole className="h-4 w-4 text-primary" />
              密钥写入系统加密存储
            </div>
          </div>
        </aside>

        <Card className="self-center rounded-lg border bg-card/95 shadow-sm backdrop-blur">
          <CardHeader className="space-y-4 p-6">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0 space-y-1">
                <p className="text-sm font-medium text-primary">
                  第 {step} 步 共 3 步 · {meta.label}
                </p>
                <CardTitle className="text-2xl leading-8">{meta.title}</CardTitle>
                <p className="text-sm text-muted-foreground">{meta.detail}</p>
              </div>
              <div className="grid h-11 w-11 shrink-0 place-items-center rounded-md bg-primary/10 text-primary">
                <CircleDot className="h-5 w-5" />
              </div>
            </div>
            <Separator />
          </CardHeader>

          <CardContent className="p-6 pt-0">
            {step === 1 ? (
              <div className="grid gap-5">
                <div className="grid gap-4 md:grid-cols-[1.3fr_1fr]">
                  <label className="space-y-2 text-sm font-medium" htmlFor="activation-code">
                    <span>激活码</span>
                    <Input
                      className="h-11 font-mono text-base tracking-[0.18em]"
                      id="activation-code"
                      onChange={(event) => onActivationCodeChange(event.target.value)}
                      placeholder="POD-XXXX-YYYY-ZZZZ"
                      value={activationCode}
                    />
                  </label>
                  <label className="space-y-2 text-sm font-medium" htmlFor="device-name">
                    <span>本机名称</span>
                    <Input
                      className="h-11 text-base"
                      id="device-name"
                      onChange={(event) => onDeviceNameChange(event.target.value)}
                      value={deviceName}
                    />
                  </label>
                </div>

                <div className="rounded-md border bg-muted/60 p-4 text-sm text-muted-foreground">
                  激活只绑定当前设备授权，不上传素材、图片、密钥和任务数据。
                </div>
                <MessageBox message={activationMessage} />

                <div className="flex items-center justify-between gap-3 pt-1">
                  <Button
                    disabled={!canActivate || isActivating}
                    onClick={onActivate}
                    type="button"
                  >
                    {isActivating ? '激活中...' : '激活并继续'}
                  </Button>
                  <a
                    className="text-sm font-medium text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
                    href="https://example.com/support"
                  >
                    联系客服微信
                  </a>
                </div>
              </div>
            ) : null}

            {step === 2 ? (
              <div className="grid gap-5">
                <div className="grid gap-3">
                  {apiKeyFields.map((field) => (
                    <label
                      className="grid gap-2 text-sm font-medium"
                      htmlFor={`onboarding-${field.key}`}
                      key={field.key}
                    >
                      <span>{field.label}</span>
                      <div className="flex gap-2">
                        <Input
                          className="h-10 min-w-0 flex-1"
                          id={`onboarding-${field.key}`}
                          onChange={(event) => onApiKeyChange(field.key, event.target.value)}
                          placeholder={field.placeholder}
                          type={field.type}
                          value={apiKeys[field.key]}
                        />
                        <Button
                          className="h-10"
                          onClick={() => onApiKeyChange(field.key, '')}
                          type="button"
                          variant="secondary"
                        >
                          跳过
                        </Button>
                        <Button className="h-10" type="button" variant="secondary">
                          测试连接
                        </Button>
                      </div>
                    </label>
                  ))}
                </div>

                <div className="rounded-md border border-primary/20 bg-primary/5 p-4 text-sm text-primary">
                  可先跳过，稍后在设置中补充；已填写的密钥会写入系统加密存储。
                </div>

                <div className="flex items-center justify-between gap-3 pt-1">
                  <Button onClick={() => onNavigateStep(1)} type="button" variant="secondary">
                    上一步
                  </Button>
                  <div className="flex gap-2">
                    <Button onClick={onSaveApiKeys} type="button" variant="secondary">
                      全部跳过
                    </Button>
                    <Button onClick={onSaveApiKeys} type="button">
                      保存并继续
                    </Button>
                  </div>
                </div>
              </div>
            ) : null}

            {step === 3 ? (
              <div className="grid gap-6 text-center">
                <div className="mx-auto grid h-16 w-16 place-items-center rounded-lg bg-primary/10 text-primary">
                  <CheckCircle2 className="h-8 w-8" />
                </div>
                <div className="space-y-2">
                  <h2 className="text-2xl font-semibold tracking-normal">软件已准备就绪</h2>
                  <p className="mx-auto max-w-lg text-sm text-muted-foreground">
                    现在可以进入蓝白工作台，开始采集、生图、检测、套版、标题生成和上架流程。
                  </p>
                </div>
                <div className="grid gap-3 rounded-md border bg-muted/50 p-4 text-left text-sm md:grid-cols-3">
                  <div className="flex items-center gap-2">
                    <ShieldCheck className="h-4 w-4 text-primary" />
                    授权已绑定
                  </div>
                  <div className="flex items-center gap-2">
                    <KeyRound className="h-4 w-4 text-primary" />
                    密钥可补充
                  </div>
                  <div className="flex items-center gap-2">
                    <Sparkles className="h-4 w-4 text-primary" />
                    模块可启动
                  </div>
                </div>
                <div className="flex justify-center gap-2">
                  <Button asChild variant="secondary">
                    <a href="https://example.com/tutorial">
                      <PlayCircle className="mr-2 h-4 w-4" />
                      查看教程视频
                    </a>
                  </Button>
                  <Button onClick={onComplete} type="button">
                    开始使用
                  </Button>
                </div>
              </div>
            ) : null}
          </CardContent>
        </Card>
      </section>
    </main>
  )
}
