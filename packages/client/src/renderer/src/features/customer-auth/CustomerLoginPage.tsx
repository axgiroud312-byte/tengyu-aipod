import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { cn } from '@/lib/utils'
import { Loader2, LogOut, QrCode, RefreshCcw, ShieldCheck, Smartphone } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
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

const STATUS_TEXT: Record<CustomerAuthStatus, { label: string; message: string }> = {
  active: { label: '已授权', message: '账号已授权，可以进入工作台。' },
  anonymous: { label: '未登录', message: '请使用微信扫码或手机号验证码登录。' },
  disabled: { label: '已禁用', message: '账号已被后台禁用。' },
  expired: { label: '已到期', message: '账号授权已到期。' },
  nologin: { label: '登录失效', message: '登录状态已失效，请重新登录。' },
  pending: { label: '待授权', message: '账号已登录，等待管理员后台授权。' },
}

function statusClassName(status: CustomerAuthStatus) {
  return cn(
    'rounded-sm border p-4 text-sm leading-6 text-pretty',
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
  const shouldShowAuthNotice = state.status !== 'anonymous' || checking || Boolean(state.message)
  const canRetryAuthorization = state.status !== 'anonymous' || Boolean(state.message)

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

  async function handleGetQrcode() {
    setWechatBusy(true)
    setWechatMessage(null)
    setPolling(false)
    try {
      const nextQrcode = await window.api.customerAuth.getQrcode()
      setQrcode(nextQrcode)
      setPolling(true)
      setWechatMessage('二维码已生成，等待扫码确认。')
    } catch (error) {
      setQrcode(null)
      setWechatMessage(error instanceof Error ? error.message : '二维码获取失败')
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

  async function handlePhoneLogin(event: React.FormEvent<HTMLFormElement>) {
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
    <main className="grid min-h-dvh place-items-center bg-background px-6 py-8 text-foreground">
      <Card className="w-full max-w-xl">
        <CardHeader className="space-y-5">
          <div className="flex items-center gap-3">
            <div className="grid size-11 place-items-center rounded-sm bg-primary text-primary-foreground">
              <ShieldCheck className="size-5" />
            </div>
            <div>
              <CardTitle>腾域 aipod</CardTitle>
              <CardDescription>登录后进入工作台。</CardDescription>
            </div>
          </div>

          {shouldShowAuthNotice ? (
            <div className={statusClassName(state.status)}>
              <div className="mb-2 flex items-center gap-2">
                <Badge variant={isBlockedStatus(state.status) ? 'outline' : 'secondary'}>
                  {statusMeta.label}
                </Badge>
                {checking ? (
                  <span className="inline-flex items-center gap-1 text-xs">
                    <Loader2 className="size-3.5 animate-spin" />
                    校验中
                  </span>
                ) : null}
              </div>
              <p>{state.message ?? statusMeta.message}</p>
              {authName ? <p className="mt-2 text-xs tabular-nums">当前账号：{authName}</p> : null}
              {state.customer?.expires_at ? (
                <p className="text-xs tabular-nums">到期时间：{state.customer.expires_at}</p>
              ) : null}
            </div>
          ) : null}

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
        </CardHeader>
        <CardContent>
          <Tabs className="w-full" defaultValue="wechat">
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="wechat">
                <QrCode className="mr-2 size-4" />
                微信扫码
              </TabsTrigger>
              <TabsTrigger value="phone">
                <Smartphone className="mr-2 size-4" />
                手机号
              </TabsTrigger>
            </TabsList>

            <TabsContent className="space-y-4 pt-4" value="wechat">
              <div className="mx-auto grid h-96 w-full place-items-center overflow-hidden rounded-md border bg-muted/20">
                {qrcode ? (
                  <iframe
                    className="size-full border-0"
                    referrerPolicy="no-referrer"
                    sandbox="allow-forms allow-popups allow-same-origin allow-scripts"
                    src={qrcode.qrcode_url}
                    title="微信登录二维码"
                  />
                ) : (
                  <QrCode className="size-16 text-muted-foreground" />
                )}
              </div>
              <Button
                className="w-full"
                disabled={wechatBusy}
                onClick={() => void handleGetQrcode()}
              >
                {wechatBusy ? <Loader2 className="mr-2 size-4 animate-spin" /> : null}
                {qrcode ? '刷新二维码' : '获取二维码'}
              </Button>
              <p className="min-h-6 text-center text-sm text-muted-foreground text-pretty">
                {wechatMessage ?? (polling ? '正在等待扫码确认。' : '获取二维码后扫码登录。')}
              </p>
            </TabsContent>

            <TabsContent className="pt-4" value="phone">
              <form className="space-y-4" onSubmit={(event) => void handlePhoneLogin(event)}>
                <div className="grid gap-4 md:grid-cols-[1fr_160px]">
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

                <label className="space-y-2" htmlFor="customer-code">
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

                <Button disabled={phoneBusy} type="submit">
                  {phoneBusy ? <Loader2 className="mr-2 size-4 animate-spin" /> : null}
                  验证码登录
                </Button>

                <p className="min-h-6 text-sm text-muted-foreground text-pretty">
                  {phoneMessage ?? '等待输入验证码。'}
                </p>
              </form>
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>
    </main>
  )
}
