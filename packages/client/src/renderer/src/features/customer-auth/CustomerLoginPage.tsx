import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import { CircleAlert, Loader2, LogOut, MessageCircle, RefreshCcw, Smartphone } from 'lucide-react'
import { type FormEvent, useCallback, useEffect, useRef, useState } from 'react'
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

const WECHAT_POLL_INTERVAL_MS = 1500
const AUTH_DATE_FORMAT = new Intl.DateTimeFormat('zh-CN', {
  dateStyle: 'medium',
  hour12: false,
  timeStyle: 'short',
})

const STATUS_TEXT: Record<CustomerAuthStatus, { label: string; message: string }> = {
  active: { label: '已授权', message: '账号已授权，可以进入工作台。' },
  anonymous: { label: '未登录', message: '请使用微信或手机号登录。' },
  disabled: {
    label: '账号当前不可用',
    message: '此账号当前不可进入工作台。请联系管理员确认授权状态。',
  },
  expired: {
    label: '授权已到期',
    message: '账号授权已到期。请联系管理员续期，然后重新校验。',
  },
  nologin: { label: '登录失效', message: '本机登录状态已失效。请重新登录。' },
  pending: {
    label: '等待开通',
    message: '账号已登录，授权尚未开通。页面会自动检查，开通后将直接进入工作台。',
  },
}

function noticeClassName(status: CustomerAuthStatus) {
  return cn(
    'block rounded-md border px-4 py-3 text-sm leading-6 text-pretty',
    status === 'active' && 'border-emerald-200 bg-emerald-50 text-emerald-800',
    status === 'pending' && 'border-amber-200 bg-amber-50 text-amber-800',
    status === 'expired' && 'border-orange-200 bg-orange-50 text-orange-800',
    status === 'disabled' && 'border-red-200 bg-red-50 text-red-800',
    status === 'nologin' && 'border-red-200 bg-red-50 text-red-800',
    status === 'anonymous' && 'border-border bg-muted/40 text-muted-foreground',
  )
}

function isWechatTerminalMessage(message: string | null) {
  return Boolean(message && /过期|失败|失效/.test(message))
}

function authDisplayName(state: CustomerAuthState) {
  return (
    state.customer?.nickname ||
    state.customer?.account ||
    state.customer?.phone ||
    (state.customer?.php_uid ? `UID ${state.customer.php_uid}` : null)
  )
}

function shouldShowAuthNotice(state: CustomerAuthState, checking: boolean) {
  return checking || state.status !== 'anonymous' || Boolean(state.message)
}

function formatAuthDate(value: string) {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : AUTH_DATE_FORMAT.format(date)
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
  const showAuthNotice = shouldShowAuthNotice(state, checking)

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
      if (nextState.status === 'active') {
        setWechatMessage('登录成功，正在进入工作台...')
      } else {
        setWechatMessage(nextState.message ?? STATUS_TEXT[nextState.status].message)
      }

      if (nextState.status === 'anonymous' && !isWechatTerminalMessage(nextState.message)) {
        return
      }

      if (nextState.status === 'anonymous') {
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

    void checkWechatOnce()
    const timer = window.setInterval(() => {
      void checkWechatOnce()
    }, WECHAT_POLL_INTERVAL_MS)
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
      setWechatMessage('微信登录页已打开，请在微信中确认。')
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
      setPhoneMessage(
        nextState.status === 'active'
          ? '登录成功，正在进入工作台...'
          : (nextState.message ?? STATUS_TEXT[nextState.status].message),
      )
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
    <main
      aria-label="客户登录"
      className="min-h-dvh bg-muted/30 px-4 py-6 text-foreground sm:px-8 sm:py-8"
    >
      <div className="mx-auto flex min-h-[calc(100dvh-64px)] w-full max-w-5xl flex-col justify-center gap-6">
        <header className="flex items-center gap-4 border-b pb-5">
          <img
            alt="腾域 aipod"
            className="size-12 rounded-md border bg-background object-contain"
            loading="lazy"
            src="brand/brand-logo.svg"
          />
          <div className="min-w-0">
            <p className="text-sm font-medium text-muted-foreground">腾域 aipod</p>
            <h1 className="mt-0.5 text-2xl font-semibold">客户登录</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              登录后系统会检查账号授权；已授权账号将进入首次设置或完整任务。
            </p>
          </div>
        </header>

        {showAuthNotice ? (
          <output
            aria-label="账号授权状态"
            aria-live="polite"
            className={noticeClassName(state.status)}
          >
            <div className="flex items-start gap-2">
              {checking ? (
                <Loader2 className="mt-1 size-4 shrink-0 animate-spin motion-reduce:animate-none" />
              ) : (
                <CircleAlert className="mt-1 size-4 shrink-0" />
              )}
              <div>
                <p className="font-medium">
                  {checking ? '正在检查本机登录状态' : statusMeta.label}
                </p>
                <p>{state.message ?? statusMeta.message}</p>
                {authName ? (
                  <p className="mt-1 text-xs tabular-nums">当前账号：{authName}</p>
                ) : null}
                {state.customer?.expires_at ? (
                  <p className="text-xs tabular-nums">
                    到期时间：{formatAuthDate(state.customer.expires_at)}
                  </p>
                ) : null}
              </div>
            </div>
          </output>
        ) : null}

        <div className="grid gap-5 lg:grid-cols-2">
          <section aria-label="微信登录" className="rounded-md border bg-background p-6">
            <div className="flex items-start gap-3">
              <div className="grid size-9 shrink-0 place-items-center rounded-sm border bg-muted text-primary">
                <MessageCircle className="size-4" />
              </div>
              <div>
                <h2 className="text-lg font-semibold">微信登录</h2>
                <p className="mt-1 text-sm leading-6 text-muted-foreground">
                  在默认浏览器打开微信登录页，当前窗口会继续等待确认结果。
                </p>
              </div>
            </div>
            <Button
              className="mt-6 h-11 w-full"
              disabled={wechatBusy}
              onClick={() => void handleStartWechatLogin()}
            >
              {wechatBusy ? (
                <Loader2 className="mr-2 size-4 animate-spin motion-reduce:animate-none" />
              ) : (
                <MessageCircle className="mr-2 size-4" />
              )}
              {hasWechatSession ? '重新打开微信登录页' : '打开微信登录页'}
            </Button>
            <p aria-live="polite" className="mt-3 min-h-6 text-sm leading-6 text-muted-foreground">
              {wechatMessage ?? (polling ? '正在等待微信确认。' : '尚未打开微信登录页。')}
            </p>
          </section>

          <form
            aria-label="手机号登录"
            className="rounded-md border bg-background p-6"
            onSubmit={(event) => void handlePhoneLogin(event)}
          >
            <div className="flex items-start gap-3">
              <div className="grid size-9 shrink-0 place-items-center rounded-sm border bg-muted text-primary">
                <Smartphone className="size-4" />
              </div>
              <div>
                <h2 className="text-lg font-semibold">手机号登录</h2>
                <p className="mt-1 text-sm leading-6 text-muted-foreground">
                  使用已绑定手机号接收验证码并登录。
                </p>
              </div>
            </div>
            <div className="mt-6 grid gap-3 sm:grid-cols-[minmax(0,1fr)_136px]">
              <Input
                aria-label="手机号"
                autoComplete="tel"
                inputMode="tel"
                onChange={(event) => setPhone(event.target.value)}
                placeholder="手机号"
                value={phone}
              />
              <Button
                disabled={phoneBusy || smsRemaining > 0}
                onClick={() => void handleSendSms()}
                type="button"
                variant="outline"
              >
                {phoneBusy ? (
                  <Loader2 className="mr-2 size-4 animate-spin motion-reduce:animate-none" />
                ) : null}
                {smsRemaining > 0 ? `${smsRemaining}s` : '发送验证码'}
              </Button>
            </div>
            <div className="mt-3 grid gap-3 sm:grid-cols-[minmax(0,1fr)_136px]">
              <Input
                aria-label="验证码"
                autoComplete="one-time-code"
                inputMode="numeric"
                onChange={(event) => setCode(event.target.value)}
                placeholder="验证码"
                value={code}
              />
              <Button disabled={phoneBusy} type="submit" variant="secondary">
                验证登录
              </Button>
            </div>
            <p aria-live="polite" className="mt-3 min-h-5 text-sm text-muted-foreground">
              {phoneMessage ?? '请输入手机号并获取验证码。'}
            </p>
          </form>
        </div>

        <footer className="flex flex-wrap justify-end gap-2 border-t pt-4">
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
        </footer>
      </div>
    </main>
  )
}
