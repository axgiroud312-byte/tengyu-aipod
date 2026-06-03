import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import {
  CircleAlert,
  ExternalLink,
  Loader2,
  LogOut,
  MessageCircle,
  RefreshCcw,
  Smartphone,
} from 'lucide-react'
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

type PlatformLogo = {
  alt: string
  src: string
}

const PLATFORM_LOGOS: PlatformLogo[] = [
  { alt: 'Temu', src: '/brand/platforms/temu.svg' },
  { alt: 'Shein', src: '/brand/platforms/shein.svg' },
  { alt: 'TikTok Shop', src: '/brand/platforms/tiktok-shop.svg' },
  { alt: 'Amazon Global Selling', src: '/brand/platforms/amazon-global-selling.svg' },
  { alt: 'eBay', src: '/brand/platforms/ebay.svg' },
  { alt: 'Shopee', src: '/brand/platforms/shopee.svg' },
  { alt: 'AliExpress', src: '/brand/platforms/aliexpress.svg' },
  { alt: 'Lazada', src: '/brand/platforms/lazada.svg' },
]

const FLOW_STEPS = ['采集', '生图', '检测', '套版', '标题', '上架']
const WECHAT_POLL_INTERVAL_MS = 1500

const STATUS_TEXT: Record<CustomerAuthStatus, { label: string; message: string }> = {
  active: { label: '已授权', message: '账号已授权，可以进入工作台。' },
  anonymous: { label: '未登录', message: '请使用微信或手机号登录。' },
  disabled: { label: '账号已禁用', message: '账号已被后台禁用，请联系管理员处理。' },
  expired: { label: '授权已到期', message: '账号授权已到期，请联系管理员续期。' },
  nologin: { label: '登录失效', message: '登录状态已失效，请重新登录。' },
  pending: { label: '等待开通', message: '账号已登录，正在等待管理员开通使用权限。' },
}

function noticeClassName(status: CustomerAuthStatus) {
  return cn(
    'rounded-md border px-4 py-3 text-sm leading-6 text-pretty',
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
      setWechatMessage('已打开微信官方登录页，请在微信客户端确认。')
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
    <main className="min-h-dvh bg-[#f3f7fc] text-foreground">
      <div className="grid min-h-dvh lg:grid-cols-[minmax(420px,0.95fr)_minmax(0,1.05fr)]">
        <section className="flex flex-col justify-between bg-card px-6 py-8 sm:px-10 lg:min-h-dvh lg:px-12 lg:py-10">
          <div className="space-y-10">
            <div className="flex items-center gap-4">
              <img
                alt="腾域 aipod"
                className="size-14 rounded-md border bg-background object-cover shadow-sm"
                src="/brand/tengyu-ai-icon-256.png"
              />
              <div>
                <p className="text-xl font-semibold leading-6">腾域 aipod</p>
                <p className="mt-1 text-sm text-muted-foreground">跨境 POD 生产工作台</p>
              </div>
            </div>

            <div className="max-w-xl space-y-5">
              <Badge className="rounded-sm" variant="secondary">
                云端授权登录
              </Badge>
              <div className="space-y-4">
                <h1 className="text-4xl font-semibold leading-tight text-balance sm:text-5xl">
                  从素材到上架
                </h1>
                <p className="text-base leading-8 text-muted-foreground text-pretty">
                  腾域 aipod 把采集、生图、检测、套版、标题和上架收进同一个桌面工作台。
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                {FLOW_STEPS.map((step) => (
                  <span
                    className="rounded-sm border bg-background px-3 py-1.5 text-sm text-muted-foreground"
                    key={step}
                  >
                    {step}
                  </span>
                ))}
              </div>
            </div>

            <section className="max-w-xl space-y-4">
              <Button
                className="h-12 w-full justify-center text-base"
                disabled={wechatBusy}
                onClick={() => void handleStartWechatLogin()}
              >
                {wechatBusy ? (
                  <Loader2 className="mr-2 size-4 animate-spin" />
                ) : (
                  <MessageCircle className="mr-2 size-4" />
                )}
                {hasWechatSession ? '重新打开微信登录页' : '微信登录，开始使用'}
              </Button>

              <div className="min-h-6 text-sm leading-6 text-muted-foreground text-pretty">
                {wechatMessage ??
                  (polling
                    ? '正在等待微信确认。'
                    : '登录页会在默认浏览器中打开，当前窗口会自动等待结果。')}
              </div>

              {showAuthNotice ? (
                <div className={noticeClassName(state.status)}>
                  <div className="flex items-start gap-2">
                    {checking ? (
                      <Loader2 className="mt-1 size-4 shrink-0 animate-spin" />
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
                          到期时间：{state.customer.expires_at}
                        </p>
                      ) : null}
                    </div>
                  </div>
                </div>
              ) : null}

              <form
                className="rounded-md border bg-background p-4"
                onSubmit={(event) => void handlePhoneLogin(event)}
              >
                <div className="mb-3 flex items-center gap-2 text-sm font-medium">
                  <Smartphone className="size-4 text-primary" />
                  手机号验证码登录
                </div>
                <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_136px]">
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
                    {phoneBusy ? <Loader2 className="mr-2 size-4 animate-spin" /> : null}
                    {smsRemaining > 0 ? `${smsRemaining}s` : '发送验证码'}
                  </Button>
                </div>
                <div className="mt-3 grid gap-3 md:grid-cols-[minmax(0,1fr)_136px]">
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
                <p className="mt-3 min-h-5 text-sm text-muted-foreground text-pretty">
                  {phoneMessage ?? '微信不可用时，可使用旧登录系统绑定手机号。'}
                </p>
              </form>
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
        </section>

        <section className="flex items-center px-6 py-8 sm:px-10 sm:py-10 lg:min-h-dvh">
          <div className="w-full space-y-5">
            <div className="overflow-hidden rounded-md border bg-card shadow-lg">
              <img
                alt="POD 商品生产与上架工作流"
                className="aspect-video w-full object-cover"
                src="/brand/pod-login-hero.png"
              />
            </div>

            <div className="rounded-md border bg-card p-5 shadow-sm">
              <div className="mb-4 flex items-center justify-between gap-4">
                <div>
                  <p className="font-medium">跨境平台场景</p>
                  <p className="text-sm text-muted-foreground">
                    围绕主流跨境平台准备图片、标题和上架素材。
                  </p>
                </div>
                <ExternalLink className="size-4 text-muted-foreground" />
              </div>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                {PLATFORM_LOGOS.map((logo) => (
                  <div
                    className="flex h-12 items-center justify-center rounded-sm border bg-background px-3"
                    key={logo.src}
                  >
                    <img
                      alt={logo.alt}
                      className="max-h-7 max-w-full object-contain"
                      src={logo.src}
                    />
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>
      </div>
    </main>
  )
}
