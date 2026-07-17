import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Progress } from '@/components/ui/progress'
import { cn } from '@/lib/utils'
import { t } from '@/locale/t'
import { CheckCircle2, KeyRound, PlayCircle } from 'lucide-react'
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
    label: t('接口密钥'),
    title: t('保存本机密钥'),
    detail: t('密钥只进入系统加密存储'),
    icon: KeyRound,
  },
  {
    number: 2,
    label: t('完成'),
    title: t('进入工作台'),
    detail: t('进入完整任务工作区'),
    icon: CheckCircle2,
  },
]

const defaultStepMeta: StepMeta = {
  number: 1,
  label: t('接口密钥'),
  title: t('保存本机密钥'),
  detail: t('密钥只进入系统加密存储'),
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
    label: t('晨羽智云密钥'),
    placeholder: t('用于云端 ComfyUI 工作流'),
    type: 'password',
  },
  { key: 'grsai', label: t('Grsai 密钥'), placeholder: t('用于付费生图'), type: 'password' },
  {
    key: 'bailian',
    label: t('阿里云百炼密钥'),
    placeholder: t('用于检测和标题生成'),
    type: 'password',
  },
  {
    key: 'bit_browser_url',
    label: t('比特浏览器地址'),
    placeholder: t('127.0.0.1:54345'),
    type: 'text',
  },
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
              'flex items-start gap-3 rounded-md border p-3 transition-colors duration-150 motion-reduce:transition-none',
              isCurrent
                ? 'border-primary/30 bg-primary/10 text-foreground'
                : isDone
                  ? 'border-emerald-200 bg-emerald-50 text-emerald-950'
                  : 'border-border bg-muted/30 text-muted-foreground',
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
                {t('第 {step} 步，共 2 步 · {label}')
                  .replace('{step}', String(item.number))
                  .replace('{label}', item.label)}
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
    <main
      aria-label={t('首次设置')}
      className="min-h-dvh bg-muted/30 px-4 py-6 text-foreground sm:px-8 sm:py-8"
    >
      <section className="mx-auto flex min-h-[calc(100dvh-64px)] w-full max-w-5xl flex-col justify-center gap-6">
        <header className="flex items-center gap-4 border-b pb-5">
          <img
            alt={t('腾域 aipod')}
            className="size-12 rounded-md border bg-background object-contain"
            loading="lazy"
            src="brand/brand-logo.svg"
          />
          <div className="min-w-0">
            <p className="text-sm font-medium text-muted-foreground">{t('腾域 aipod')}</p>
            <h1 className="mt-0.5 text-2xl font-semibold">{t('首次设置')}</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              {t('保存本机连接信息后即可进入工作台；工作区可稍后在设置页选择。')}
            </p>
          </div>
        </header>

        <div className="grid gap-5 lg:grid-cols-[280px_minmax(0,1fr)]">
          <aside
            aria-label={t('设置步骤')}
            className="self-start rounded-md border bg-background p-5"
          >
            <div className="space-y-3">
              <div className="flex items-center justify-between text-sm">
                <span className="font-medium">{t('设置进度')}</span>
                <span className="tabular-nums text-muted-foreground">
                  {t('{progress}%').replace('{progress}', String(stepProgress(step)))}
                </span>
              </div>
              <Progress aria-label={t('设置进度')} value={stepProgress(step)} />
            </div>
            <div className="mt-5">
              <StepRail step={step} />
            </div>
          </aside>

          <section
            aria-label={t('{label}设置').replace('{label}', meta.label)}
            className="self-start rounded-md border bg-background p-6"
          >
            <header className="border-b pb-4">
              <p className="text-sm font-medium text-primary">
                {t('第 {step} 步，共 2 步 · {label}')
                  .replace('{step}', String(step))
                  .replace('{label}', meta.label)}
              </p>
              <h2 className="mt-1 text-xl font-semibold">{meta.title}</h2>
              <p className="mt-1 text-sm text-muted-foreground">{meta.detail}</p>
            </header>

            {error ? (
              <div
                className="mt-4 rounded-md border border-destructive/20 bg-destructive/10 px-3 py-2 text-sm text-destructive"
                role="alert"
              >
                {error}
              </div>
            ) : null}

            {step === 1 ? (
              <div className="mt-5 grid gap-5">
                <div className="grid gap-4">
                  {apiKeyFields.map((field) => (
                    <div className="grid gap-2" key={field.key}>
                      <label className="text-sm font-medium" htmlFor={`onboarding-${field.key}`}>
                        {field.label}
                      </label>
                      <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto]">
                        <Input
                          className="h-10 min-w-0"
                          id={`onboarding-${field.key}`}
                          disabled={saving}
                          onChange={(event) => onApiKeyChange(field.key, event.target.value)}
                          placeholder={field.placeholder}
                          type={field.type}
                          value={apiKeys[field.key]}
                        />
                        <Button
                          aria-label={t('跳过{name}').replace('{name}', field.label)}
                          className="h-10"
                          disabled={saving}
                          onClick={() => onApiKeyChange(field.key, '')}
                          type="button"
                          variant="secondary"
                        >
                          {t('跳过')}
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>

                <div className="rounded-md border bg-muted/40 p-4 text-sm text-muted-foreground">
                  {t('可全部跳过并稍后在设置中补充。已填写的密钥只写入本机密钥存储。')}
                </div>

                <div className="flex flex-wrap justify-end gap-2 border-t pt-4">
                  <Button
                    disabled={saving}
                    onClick={onSaveApiKeys}
                    type="button"
                    variant="secondary"
                  >
                    {t('全部跳过')}
                  </Button>
                  <Button disabled={saving} onClick={onSaveApiKeys} type="button">
                    {saving ? t('正在保存...') : t('保存并继续')}
                  </Button>
                </div>
              </div>
            ) : null}

            {step === 2 ? (
              <div className="mt-5 grid gap-5">
                <div className="flex items-start gap-3 rounded-md border border-emerald-200 bg-emerald-50 p-4 text-emerald-950">
                  <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0" />
                  <div>
                    <h2 className="font-semibold">{t('设置已完成')}</h2>
                    <p className="mt-1 text-sm leading-6">
                      {t(
                        '本机连接信息已保存。进入后默认打开完整任务；工作区和密钥可继续在设置中调整。',
                      )}
                    </p>
                  </div>
                </div>
                <div className="flex flex-wrap justify-end gap-2 border-t pt-4">
                  <Button
                    disabled={completing}
                    onClick={onOpenTutorial}
                    type="button"
                    variant="secondary"
                  >
                    <PlayCircle className="mr-2 h-4 w-4" />
                    {t('查看操作教程')}
                  </Button>
                  <Button disabled={completing} onClick={onComplete} type="button">
                    {completing ? t('正在进入...') : t('开始使用')}
                  </Button>
                </div>
              </div>
            ) : null}
          </section>
        </div>
      </section>
    </main>
  )
}
