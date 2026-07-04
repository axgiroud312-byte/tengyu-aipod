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
  PlayCircle,
  ShieldCheck,
  Sparkles,
} from 'lucide-react'
import type { ComponentType, SVGProps } from 'react'

export type OnboardingStep = 1 | 2
export type OnboardingApiKey = 'chenyu' | 'grsai' | 'bailian' | 'bit_browser_url'
export type OnboardingApiKeys = Record<OnboardingApiKey, string>

interface OnboardingPageProps {
  step: OnboardingStep
  apiKeys: OnboardingApiKeys
  error?: string | null
  completing?: boolean
  saving?: boolean
  onApiKeyChange: (key: OnboardingApiKey, value: string) => void
  onSaveApiKeys: () => void
  onComplete: () => void
  onOpenTutorial: () => void
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
    label: '接口密钥',
    title: '保存本机密钥',
    detail: '密钥只进入系统加密存储',
    icon: KeyRound,
  },
  {
    number: 2,
    label: '完成',
    title: '进入工作台',
    detail: '开始使用 6 个生产模块',
    icon: CheckCircle2,
  },
]

const defaultStepMeta: StepMeta = {
  number: 1,
  label: '接口密钥',
  title: '保存本机密钥',
  detail: '密钥只进入系统加密存储',
  icon: KeyRound,
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
  return Math.round((step / 2) * 100)
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
                ? 'border-primary/30 bg-primary/10 text-foreground shadow-[0_10px_28px_rgba(37,99,235,0.1)]'
                : isDone
                  ? 'border-emerald-200 bg-emerald-50 text-emerald-950'
                  : 'border-white/70 bg-white/70 text-muted-foreground',
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
                第 {item.number} 步 共 2 步 · {item.label}
              </p>
              <p className="mt-0.5 text-xs leading-4 opacity-80">{item.detail}</p>
            </div>
          </div>
        )
      })}
    </div>
  )
}

export function OnboardingPage({
  step,
  apiKeys,
  error,
  completing = false,
  saving = false,
  onApiKeyChange,
  onSaveApiKeys,
  onComplete,
  onOpenTutorial,
}: OnboardingPageProps) {
  const meta = currentStepMeta(step)

  return (
    <main className="auth-brand-surface relative min-h-screen overflow-hidden px-8 py-8 text-foreground">
      <div
        aria-hidden="true"
        className="absolute inset-0 bg-cover bg-center opacity-40"
        style={{ backgroundImage: 'url("brand/visuals/entrance-hero.png")' }}
      />
      <div
        aria-hidden="true"
        className="absolute inset-0 bg-[linear-gradient(90deg,_rgba(248,251,255,0.94),_rgba(248,251,255,0.78)_48%,_rgba(248,251,255,0.58))]"
      />
      <section className="mx-auto grid min-h-[calc(100vh-64px)] max-w-6xl gap-6 lg:grid-cols-[360px_minmax(0,1fr)]">
        <aside className="relative flex flex-col justify-between rounded-md border border-white/70 bg-white/80 p-6 shadow-[0_22px_56px_rgba(30,64,175,0.1)] backdrop-blur-xl">
          <div className="space-y-6">
            <div className="space-y-4">
              <div className="flex items-center gap-3">
                <img
                  alt=""
                  aria-hidden="true"
                  className="h-10 w-10 rounded-md border border-white/70 bg-white object-contain shadow-[0_12px_24px_rgba(37,99,235,0.12)]"
                  src="brand/brand-logo.svg"
                />
                <div>
                  <p className="brand-wordmark bg-clip-text text-lg font-black tracking-normal">
                    腾域Ai
                  </p>
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
                  只需完成密钥保存。工作区可稍后在设置页选择，图片、任务数据和密钥都留在本机。
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
            <div className="flex items-center gap-2 rounded-sm border border-white/70 bg-white/70 px-3 py-2">
              <ShieldCheck className="h-4 w-4 text-primary" />
              服务端不接触用户图片和任务数据
            </div>
            <div className="flex items-center gap-2 rounded-sm border border-white/70 bg-white/70 px-3 py-2">
              <LockKeyhole className="h-4 w-4 text-primary" />
              密钥写入系统加密存储
            </div>
          </div>
        </aside>

        <Card className="relative self-center border-white/70 bg-card/95 shadow-[0_28px_72px_rgba(30,64,175,0.12)]">
          <CardHeader className="space-y-4 p-6">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0 space-y-1">
                <p className="text-sm font-medium text-primary">
                  第 {step} 步 共 2 步 · {meta.label}
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
            {error ? (
              <div className="mb-4 rounded-md border border-destructive/20 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                {error}
              </div>
            ) : null}

            {step === 1 ? (
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
                          disabled={saving}
                          onChange={(event) => onApiKeyChange(field.key, event.target.value)}
                          placeholder={field.placeholder}
                          type={field.type}
                          value={apiKeys[field.key]}
                        />
                        <Button
                          className="h-10"
                          disabled={saving}
                          onClick={() => onApiKeyChange(field.key, '')}
                          type="button"
                          variant="secondary"
                        >
                          跳过
                        </Button>
                        <Button
                          className="h-10"
                          disabled={saving}
                          type="button"
                          variant="secondary"
                        >
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
                  <div />
                  <div className="flex gap-2">
                    <Button
                      disabled={saving}
                      onClick={onSaveApiKeys}
                      type="button"
                      variant="secondary"
                    >
                      全部跳过
                    </Button>
                    <Button disabled={saving} onClick={onSaveApiKeys} type="button">
                      {saving ? '正在保存...' : '保存并继续'}
                    </Button>
                  </div>
                </div>
              </div>
            ) : null}

            {step === 2 ? (
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
                    本机已配置
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
                  <Button
                    disabled={completing}
                    onClick={onOpenTutorial}
                    type="button"
                    variant="secondary"
                  >
                    <PlayCircle className="mr-2 h-4 w-4" />
                    查看操作教程
                  </Button>
                  <Button disabled={completing} onClick={onComplete} type="button">
                    {completing ? '正在进入...' : '开始使用'}
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
