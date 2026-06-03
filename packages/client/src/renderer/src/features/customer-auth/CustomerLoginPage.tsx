import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { cn } from '@/lib/utils'
import {
  CheckCircle2,
  CircleAlert,
  Clock3,
  ExternalLink,
  KeyRound,
  Loader2,
  LogOut,
  MessageCircle,
  RefreshCcw,
  ShieldCheck,
  Smartphone,
} from 'lucide-react'
import { type FormEvent, type ReactNode, useCallback, useEffect, useRef, useState } from 'react'
import type {
  CustomerAuthQrcode,
  CustomerAuthState,
  CustomerAuthStatus,
} from '../../../../main/lib/customer-auth'

type CustomerLoginPageProps = {
  checking: boolean
  onRetryVerify: () => Promise<void>
  onStateChange: (state: CustomerAuthState) => void
  state: CustomerAuthState
}

type LoginStepProps = {
  active?: boolean
  description: string
  done?: boolean
  icon: ReactNode
  title: string
}

const STATUS_TEXT: Record<CustomerAuthStatus, { label: string; message: string }> = {
  active: { label: '已授权', message: '账号已授权，可以进入工作台。' },
  anonymous: { label: '未登录', message: '请使用微信或手机号登录。' },
  disabled: { label: '已禁用', message: '账号已被后台禁用。' },
  expired: { label: '已到期', message: '账号授权已到期。' },
  nologin: { label: '登录失效', message: '登录状态已失效，请重新登录。' },
  pending: { label: '待授权', message: '账号已登录，等待管理员后台授权。' },
}

function statusClassName(status: CustomerAuthStatus) {
  return cn(
    'rounded-md border p-4 text-sm leading-6 text-pretty',
    status === 'active' && 'border-emerald-200 bg-emerald-50 text-emerald-800',
    status === 'pending' && 'border-amber-200 bg-amber-50 text-amber-800',
    status === 'expired' && 'border-orange-200 bg-orange-50 text-orange-800',
    status === 'disabled' && 'border-red-200 bg-red-50 text-red-800',
    status === 'nologin' && 'border-red-200 bg-red-50 text-red-800',
    status === 'anonymous' && 'border-border bg-muted/30 text-muted-foreground',
  )
}

function isBlockedStatus(status: CustomerAuthStatus) {
  return status === 'pending' || status === 'disabled' || status === 'expired'
}

function authDisplayName(state: CustomerAuthState) {
  return (
    state.customer?.nickname ||
    state.customer?.account ||
    state.customer?.phone ||
    (state.customer?.php_uid ? `UID ${state.customer.php_uid}` : null)
  )
}

function isWechatTerminalMessage(message: string | null) {
  return Boolean(message && /过期|失败|失效/.test(message))
}

function LoginStep({ active = false, description, done = false, icon, title }: LoginStepProps) {
  return (
    <div
      className={cn(
        'flex gap-3 rounded-md border bg-background p-3',
        active && 'border-primary/40 bg-primary/5',
        done && 'border-emerald-200 bg-emerald-50',
      )}
    >
      <div
        className={cn(
          'grid size-9 shrink-0 place-items-center rounded-sm border bg-card text-muted-foreground',
          active && 'border-primary/30 text-primary',
          done && 'border-emerald-200 bg-white text-emerald-700',
        )}
      >
        {icon}
      </div>
      <div className="min-w-0">
        <p className="font-medium text-foreground">{title}</p>
        <p className="mt-1 text-sm leading-5 text-muted-foreground text-pretty">{description}</p>
      </div>
    </div>
  )
}

export function CustomerLoginPage({
  checking,
  onRetryVerify,
  onStateChange,
  state,
}: CustomerLoginPageProps) {
  const [phone, setPhone] = useState('')
  const [code, setCode] = useState('')
  const [phoneMessage, setPhoneMessage] = useState<string | null>(null)
  const [phoneBusy, setPhoneBusy] = useState(false)
  const [smsRemaining, setSmsRemaining] = useState(0)
  const [qrcode, setQrcode] = useState<CustomerAuthQrcode | null>(null)
  const [wechatMessage, setWechatMessage] = useState<string | null>(null)
  const [wechatBusy, setWechatBusy] = useState(false)
  const [polling, setPolling] = useState(false)
  const pollingRef = useRef(false)
  const authName = authDisplayName(state)
  const statusMeta = STATUS_TEXT[state.status]
  const canRetryAuthorization = state.status !== 'anonymous' || Boolean(state.message)
  const hasWechatSession = Boolean(qrcode?.token)

  useEffect(() => {
    let active = true
    window.api.customerAuth
      .getSmsCountdown()
      .then((result) => {
        if (active) {
          setSmsRemaining(result.remaining_seconds)
        }
      })
      .catch(() => null)
    return () => {
      active = false
    }
  }, [])

  useEffect(() => {
    if (smsRemaining <= 0) {
      return
    }

    const timer = window.setInterval(() => {
      setSmsRemaining((current) => Math.max(0, current - 1))
    }, 1000)
    return () => window.clearInterval(timer)
  }, [smsRemaining])

  const applyLoginState = useCallback(
    (nextState: CustomerAuthState) => {
      onStateChange(nextState)
      if (nextState.status !== 'anonymous') {
        setPolling(false)
      }
    },
    [onStateChange],
  )

  const checkWechatOnce = useCallback(async () => {
    if (!qrcode?.token || pollingRef.current) {
      return
    }

    pollingRef.current = true
    try {
      const nextState = await window.api.customerAuth.checkWechatLogin({ token: qrcode.token })
      setWechatMessage(nextState.message ?? STATUS_TEXT[nextState.status].message)
      if (nextState.status === 'anonymous' && isWechatTerminalMessage(nextState.message)) {
        setPolling(false)
      }
      applyLoginState(nextState)
    } catch (error) {
      setWechatMessage(error instanceof Error ? error.message : '微信登录状态查询失败')
    } finally {
      pollingRef.current = false
    }
  }, [applyLoginState, qrcode?.token])

  useEffect(() => {
    if (!polling || !qrcode?.token) {
      return
    }

    const timer = window.setInterval(() => {
      void checkWechatOnce()
    }, 3000)
    return () => window.clearInterval(timer)
  }, [checkWechatOnce, polling, qrcode?.token])

  async function handleStartWechatLogin() {
    setWechatBusy(true)
    setWechatMessage(null)
    setPolling(false)
    try {
      const nextQrcode = await window.api.customerAuth.startWechatLogin()
      setQrcode(nextQrcode)
      setPolling(true)
      setWechatMessage('已打开默认浏览器，请在微信客户端确认登录。')
    } catch (error) {
      setQrcode(null)
      setWechatMessage(error instanceof Error ? error.message : '微信登录页打开失败')
    } finally {
      setWechatBusy(false)
    }
  }

  async function handleSendSms() {
    setPhoneBusy(true)
    setPhoneMessage(null)
    try {
      const result = await window.api.customerAuth.sendSms({ phone })
      setSmsRemaining(result.remaining_seconds)
      setPhoneMessage(result.message)
    } catch (error) {
      setPhoneMessage(error instanceof Error ? error.message : '验证码发送失败')
    } finally {
      setPhoneBusy(false)
    }
  }

  async function handlePhoneLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setPhoneBusy(true)
    setPhoneMessage(null)
    try {
      const nextState = await window.api.customerAuth.loginByPhone({ code, invite: '', phone })
      setPhoneMessage(nextState.message ?? STATUS_TEXT[nextState.status].message)
      applyLoginState(nextState)
    } catch (error) {
      setPhoneMessage(error instanceof Error ? error.message : '手机号登录失败')
    } finally {
      setPhoneBusy(false)
    }
  }

  async function handleLogout() {
    const nextState = await window.api.customerAuth.logout()
    setQrcode(null)
    setPolling(false)
    setPhoneMessage(null)
    setWechatMessage(null)
    onStateChange(nextState)
  }

  return (
    <main className="min-h-dvh bg-background text-foreground">
      <div className="grid min-h-dvh grid-cols-[380px_minmax(0,1fr)]">
        <aside className="flex min-h-dvh flex-col justify-between border-r bg-card px-8 py-7">
          <div className="space-y-8">
            <div className="flex items-center gap-3">
              <div className="grid size-11 place-items-center rounded-sm bg-primary text-primary-foreground">
                <ShieldCheck className="size-5" />
              </div>
              <div>
                <p className="text-lg font-semibold leading-6">腾域 aipod</p>
                <p className="text-sm text-muted-foreground">客户授权登录</p>
              </div>
            </div>

            <section className="space-y-3">
              <div className="flex items-center justify-between gap-3">
                <p className="text-sm font-medium">授权状态</p>
                <Badge variant={isBlockedStatus(state.status) ? 'outline' : 'secondary'}>
                  {statusMeta.label}
                </Badge>
              </div>

              <div className={statusClassName(state.status)}>
                {checking ? (
                  <div className="mb-2 flex items-center gap-2">
                    <span className="inline-flex items-center gap-1 text-xs">
                      <Loader2 className="size-3.5 animate-spin" />
                      校验中
                    </span>
                  </div>
                ) : null}
                <p>{state.message ?? statusMeta.message}</p>
                {authName ? (
                  <p className="mt-2 text-xs tabular-nums">当前账号：{authName}</p>
                ) : null}
                {state.customer?.expires_at ? (
                  <p className="text-xs tabular-nums">到期时间：{state.customer.expires_at}</p>
                ) : null}
              </div>
            </section>

            <section className="space-y-3 rounded-md border bg-background p-4">
              <div className="flex items-center gap-2">
                <KeyRound className="size-4 text-primary" />
                <p className="font-medium">进入 Workbench 的条件</p>
              </div>
              <p className="text-sm leading-6 text-muted-foreground text-pretty">
                登录只确认身份，后台授权为 active 且未到期后，才会进入工作台并同步 Skill。
              </p>
            </section>
          </div>

          <div className="flex flex-wrap gap-2">
            {canRetryAuthorization ? (
              <Button disabled={checking} onClick={() => void onRetryVerify()} variant="outline">
                <RefreshCcw className="mr-2 size-4" />
                重新校验
              </Button>
            ) : null}
            {state.status !== 'anonymous' ? (
              <Button onClick={() => void handleLogout()} variant="ghost">
                <LogOut className="mr-2 size-4" />
                退出登录
              </Button>
            ) : null}
          </div>
        </aside>

        <section className="flex min-h-dvh items-center justify-center px-10 py-8">
          <div className="w-full max-w-4xl space-y-6">
            <div className="space-y-3">
              <Badge variant="secondary">云端后台授权</Badge>
              <div className="space-y-2">
                <h1 className="text-3xl font-semibold leading-tight text-balance">
                  登录后进入 Workbench
                </h1>
                <p className="max-w-2xl text-sm leading-6 text-muted-foreground text-pretty">
                  微信官方登录页会在浏览器中打开，当前窗口会持续等待登录结果。
                </p>
              </div>
            </div>

            <Tabs className="w-full" defaultValue="wechat">
              <TabsList className="grid h-11 w-full max-w-md grid-cols-2">
                <TabsTrigger value="wechat">
                  <MessageCircle className="mr-2 size-4" />
                  微信登录
                </TabsTrigger>
                <TabsTrigger value="phone">
                  <Smartphone className="mr-2 size-4" />
                  手机号
                </TabsTrigger>
              </TabsList>

              <TabsContent className="pt-4" value="wechat">
                <section className="grid gap-5 rounded-md border bg-card p-6 shadow-sm lg:grid-cols-[minmax(0,1fr)_320px]">
                  <div className="space-y-5">
                    <div className="flex items-start gap-4">
                      <div className="grid size-12 place-items-center rounded-sm bg-primary text-primary-foreground">
                        <MessageCircle className="size-5" />
                      </div>
                      <div className="min-w-0 space-y-1">
                        <h2 className="text-xl font-semibold leading-7">微信授权登录</h2>
                        <p className="text-sm leading-6 text-muted-foreground text-pretty">
                          点击后打开微信官方页；如果看到“微信快捷登录”，请在微信客户端确认。
                        </p>
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-3">
                      <Button
                        className="min-w-44"
                        disabled={wechatBusy}
                        onClick={() => void handleStartWechatLogin()}
                      >
                        {wechatBusy ? (
                          <Loader2 className="mr-2 size-4 animate-spin" />
                        ) : (
                          <ExternalLink className="mr-2 size-4" />
                        )}
                        {hasWechatSession ? '重新打开登录页' : '打开微信登录页'}
                      </Button>
                      {polling ? (
                        <span className="inline-flex items-center gap-2 text-sm text-muted-foreground">
                          <Loader2 className="size-4 animate-spin" />
                          等待微信确认
                        </span>
                      ) : null}
                    </div>

                    <div
                      className={cn(
                        'min-h-12 rounded-md border bg-muted/30 px-4 py-3 text-sm leading-6 text-muted-foreground text-pretty',
                        wechatMessage && 'border-primary/20 bg-primary/5 text-foreground',
                      )}
                    >
                      {wechatMessage ??
                        (hasWechatSession
                          ? '登录页已打开，可以重新打开或继续等待结果。'
                          : '点击按钮后开始微信登录。')}
                    </div>
                  </div>

                  <div className="space-y-3">
                    <LoginStep
                      active={!hasWechatSession && !polling}
                      description="应用会用默认浏览器打开官方登录页。"
                      icon={<ExternalLink className="size-4" />}
                      title="打开登录页"
                    />
                    <LoginStep
                      active={polling}
                      description="扫码或快捷登录后，在微信客户端完成确认。"
                      icon={<Clock3 className="size-4" />}
                      title="等待确认"
                    />
                    <LoginStep
                      active={state.status !== 'anonymous'}
                      description="后台返回 pending、active、disabled 或 expired。"
                      done={state.status === 'active'}
                      icon={<CheckCircle2 className="size-4" />}
                      title="校验授权"
                    />
                  </div>
                </section>
              </TabsContent>

              <TabsContent className="pt-4" value="phone">
                <section className="rounded-md border bg-card p-6 shadow-sm">
                  <form className="space-y-5" onSubmit={(event) => void handlePhoneLogin(event)}>
                    <div className="flex items-start gap-4">
                      <div className="grid size-12 place-items-center rounded-sm bg-secondary text-secondary-foreground">
                        <Smartphone className="size-5" />
                      </div>
                      <div className="min-w-0 space-y-1">
                        <h2 className="text-xl font-semibold leading-7">手机号验证码登录</h2>
                        <p className="text-sm leading-6 text-muted-foreground text-pretty">
                          输入旧登录系统绑定手机号，验证后继续走后台授权校验。
                        </p>
                      </div>
                    </div>

                    <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_180px]">
                      <label className="space-y-2" htmlFor="customer-phone">
                        <span className="text-sm font-medium">手机号</span>
                        <Input
                          autoComplete="tel"
                          id="customer-phone"
                          inputMode="tel"
                          onChange={(event) => setPhone(event.target.value)}
                          placeholder="请输入手机号"
                          value={phone}
                        />
                      </label>
                      <div className="flex items-end">
                        <Button
                          className="w-full"
                          disabled={phoneBusy || smsRemaining > 0}
                          onClick={() => void handleSendSms()}
                          type="button"
                          variant="outline"
                        >
                          {phoneBusy ? <Loader2 className="mr-2 size-4 animate-spin" /> : null}
                          {smsRemaining > 0 ? `${smsRemaining}s` : '发送验证码'}
                        </Button>
                      </div>
                    </div>

                    <label className="block space-y-2" htmlFor="customer-code">
                      <span className="text-sm font-medium">验证码</span>
                      <Input
                        autoComplete="one-time-code"
                        id="customer-code"
                        inputMode="numeric"
                        onChange={(event) => setCode(event.target.value)}
                        placeholder="请输入验证码"
                        value={code}
                      />
                    </label>

                    <div className="flex flex-wrap items-center gap-3">
                      <Button disabled={phoneBusy} type="submit">
                        {phoneBusy ? <Loader2 className="mr-2 size-4 animate-spin" /> : null}
                        验证码登录
                      </Button>
                      <p className="min-h-6 text-sm text-muted-foreground text-pretty">
                        {phoneMessage ?? '等待输入验证码。'}
                      </p>
                    </div>
                  </form>
                </section>
              </TabsContent>
            </Tabs>

            {state.status === 'pending' ? (
              <div className="flex gap-3 rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm leading-6 text-amber-800">
                <CircleAlert className="mt-0.5 size-4 shrink-0" />
                <p>当前账号已登录但还未授权，请在 Admin 后台通过客户账号授权。</p>
              </div>
            ) : null}
          </div>
        </section>
      </div>
    </main>
  )
}
